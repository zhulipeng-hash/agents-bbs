'use strict';

const db = require('../../../src/database');
const Messaging = require('../../../src/messaging');
const registry = require('./registry');
const contentFilter = require('./content-filter');

const BotPM = module.exports;

// ── Helpers ────────────────────────────────────────────────────

async function resolveBot(clientId) {
	const bot = await registry.getBot(clientId);
	if (!bot) throw new Error('Bot not found');
	if (bot.status === 'banned') throw new Error('Bot is banned');
	if (bot.status === 'suspended') throw new Error('Bot is suspended');
	return bot;
}

function getDisplayName(bot) {
	const fullname = bot.fullname || bot.name || '';
	const username = bot.nodebb_uid ? ('bot_' + bot.client_id.slice(0, 12)) : '';
	return fullname ? fullname + ' (' + username + ')' : username;
}

async function getOrCreateAuditRoom() {
	const existing = await db.get('bot:pm:audit:roomId');
	if (existing) return parseInt(existing, 10);

	// Create audit room with admin as sole member
	const roomId = await Messaging.newRoom(1, { uids: [], roomName: '' });
	await db.set('bot:pm:audit:roomId', String(roomId));

	// Set room name explicitly
	await db.setObjectField('chat:room:' + roomId, 'roomName', 'Bot PM Audit');
	return roomId;
}

async function forwardToAuditRoom(senderBot, receiverBot, content) {
	const auditRoomId = await getOrCreateAuditRoom();
	const senderDisplay = getDisplayName(senderBot);
	const receiverDisplay = getDisplayName(receiverBot);
	const auditMsg = senderDisplay + ' → ' + receiverDisplay + '\n\n' + content;
	await Messaging.sendMessage({ uid: 1, roomId: auditRoomId, content: auditMsg });
}

// ── Find existing PM room between two bots ──────────────────────

async function findExistingRoom(senderClientId, receiverClientId) {
	const senderRooms = await db.getSetMembers('bot:' + senderClientId + ':pm:rooms');
	if (!senderRooms || !senderRooms.length) return null;

	for (const roomId of senderRooms) {
		const meta = await db.getObject('bot:pm:' + roomId);
		if (!meta) continue;
		if (
			(meta.sender_client_id === senderClientId && meta.receiver_client_id === receiverClientId) ||
			(meta.sender_client_id === receiverClientId && meta.receiver_client_id === senderClientId)
		) {
			return parseInt(roomId, 10);
		}
	}
	return null;
}

// ── Send PM ────────────────────────────────────────────────────

BotPM.send = async function (senderClientId, receiverClientId, content) {
	if (senderClientId === receiverClientId) throw new Error('Cannot send PM to self');

	const senderBot = await resolveBot(senderClientId);
	const receiverBot = await resolveBot(receiverClientId);
	const senderUid = parseInt(senderBot.nodebb_uid, 10);
	const receiverUid = parseInt(receiverBot.nodebb_uid, 10);

	// Content safety
	const filterResult = await contentFilter.check(content);
	if (!filterResult.passed) {
		throw new Error('Message blocked by content filter');
	}

	// Find or create room
	let roomId = await findExistingRoom(senderClientId, receiverClientId);

	if (!roomId) {
		roomId = await Messaging.newRoom(senderUid, { uids: [receiverUid] });

		// Store PM metadata
		await db.setObject('bot:pm:' + roomId, {
			sender_client_id: senderClientId,
			receiver_client_id: receiverClientId,
			created_at: String(Math.floor(Date.now() / 1000)),
		});

		// Track for both bots
		await db.setAdd('bot:' + senderClientId + ':pm:rooms', String(roomId));
		await db.setAdd('bot:' + receiverClientId + ':pm:rooms', String(roomId));
	}

	// Send message
	const message = await Messaging.sendMessage({
		uid: senderUid,
		roomId: roomId,
		content: content,
	});

	// Forward to admin audit room (async, non-blocking)
	forwardToAuditRoom(senderBot, receiverBot, content).catch(() => {});

	return { roomId, messageId: message && message.mid };
};

// ── Get Inbox ──────────────────────────────────────────────────

BotPM.getInbox = async function (clientId, start, count) {
	const roomIds = await db.getSetMembers('bot:' + clientId + ':pm:rooms');
	if (!roomIds || !roomIds.length) return [];

	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);

	const inbox = await Promise.all(roomIds.map(async (roomId) => {
		const meta = await db.getObject('bot:pm:' + roomId);
		if (!meta) return null;

		// Determine the other party
		const otherClientId = meta.sender_client_id === clientId
			? meta.receiver_client_id : meta.sender_client_id;
		const otherBot = await registry.getBot(otherClientId);
		if (!otherBot) return null;

		// Check membership
		const inRoom = await Messaging.isUserInRoom(uid, parseInt(roomId, 10));
		if (!inRoom) return null;

		// Get last message
		const messages = await Messaging.getMessages({
			callerUid: uid,
			uid: uid,
			roomId: parseInt(roomId, 10),
			start: 0,
			count: 1,
		});
		const lastMsg = messages && messages[0];

		return {
			roomId: parseInt(roomId, 10),
			with: {
				clientId: otherClientId,
				name: otherBot.fullname || otherBot.name,
				displayName: getDisplayName(otherBot),
			},
			lastMessage: lastMsg ? lastMsg.content : '',
			lastMessageTime: lastMsg ? lastMsg.timestamp : 0,
		};
	}));

	// Sort by last message time, newest first
	return inbox
		.filter(Boolean)
		.sort((a, b) => b.lastMessageTime - a.lastMessageTime)
		.slice(start || 0, (start || 0) + (count || 20));
};

// ── Get Conversation ───────────────────────────────────────────

BotPM.getConversation = async function (clientId, roomId, start, count) {
	const meta = await db.getObject('bot:pm:' + roomId);
	if (!meta) throw new Error('PM room not found');

	// Verify participant
	if (meta.sender_client_id !== clientId && meta.receiver_client_id !== clientId) {
		throw new Error('Not a participant of this PM');
	}

	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);

	return Messaging.getMessages({
		callerUid: uid,
		uid: uid,
		roomId: parseInt(roomId, 10),
		start: start || 0,
		count: count || 50,
	});
};

// ── Get Unread Count ───────────────────────────────────────────

BotPM.getUnread = async function (clientId) {
	const roomIds = await db.getSetMembers('bot:' + clientId + ':pm:rooms');
	if (!roomIds || !roomIds.length) return { unreadCount: 0, senders: [] };

	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);

	let totalUnread = 0;
	const senders = [];

	for (const roomId of roomIds) {
		const meta = await db.getObject('bot:pm:' + roomId);
		if (!meta) continue;

		// Check unread
		const isUnread = await db.isSortedSetMember('uid:' + uid + ':chat:rooms:unread', roomId);
		if (!isUnread) continue;

		totalUnread++;

		// Get other party info
		const otherClientId = meta.sender_client_id === clientId
			? meta.receiver_client_id : meta.sender_client_id;
		const otherBot = await registry.getBot(otherClientId);
		if (!otherBot) continue;

		// Get last message
		const messages = await Messaging.getMessages({
			callerUid: uid,
			uid: uid,
			roomId: parseInt(roomId, 10),
			start: 0,
			count: 1,
		});
		const lastMsg = messages && messages[0];

		senders.push({
			clientId: otherClientId,
			name: otherBot.fullname || otherBot.name,
			displayName: getDisplayName(otherBot),
			lastMessage: lastMsg ? (lastMsg.content || '').slice(0, 100) : '',
			timestamp: lastMsg ? lastMsg.timestamp : 0,
			roomId: parseInt(roomId, 10),
		});
	}

	return {
		unreadCount: totalUnread,
		senders: senders.sort((a, b) => b.timestamp - a.timestamp),
	};
};

// ── Mark Read ──────────────────────────────────────────────────

BotPM.markRead = async function (clientId, roomId) {
	const meta = await db.getObject('bot:pm:' + roomId);
	if (!meta) throw new Error('PM room not found');

	if (meta.sender_client_id !== clientId && meta.receiver_client_id !== clientId) {
		throw new Error('Not a participant of this PM');
	}

	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);
	await Messaging.markRead(uid, parseInt(roomId, 10));
};
