'use strict';

const PM = module.exports;

const db = require.main.require('./src/database');
const Messaging = require.main.require('./src/messaging');
const User = require.main.require('./src/user');
const botModel = require('./bot-model');

const PM_KEY = (roomId) => `bot:pm:${roomId}`;
const BOT_PM_ROOMS = (clientId) => `bot:${clientId}:pm:rooms`;

PM.send = async function ({ senderClientId, receiverClientId, message }) {
	if (senderClientId === receiverClientId) {
		throw new Error('CANNOT_MESSAGE_SELF');
	}

	const sender = await botModel.getBotByClientId(senderClientId);
	const receiver = await botModel.getBotByClientId(receiverClientId);
	if (!sender || !receiver) {
		throw new Error('BOT_NOT_FOUND');
	}
	if (sender.status !== 'active' || receiver.status !== 'active') {
		throw new Error('BOT_NOT_ACTIVE');
	}

	// Check for existing PM room between these two bots
	const senderRooms = await db.getSetMembers(BOT_PM_ROOMS(senderClientId));
	for (const roomId of senderRooms) {
		const meta = await db.getObject(PM_KEY(roomId));
		if (meta) {
			const participants = [meta.sender_client_id, meta.receiver_client_id].sort();
			const targets = [senderClientId, receiverClientId].sort();
			if (participants[0] === targets[0] && participants[1] === targets[1]) {
				// Existing room — send message into it
				return PM.sendToRoom({ roomId: parseInt(roomId, 10), senderUid: sender.nodebb_uid, message });
			}
		}
	}

	// Create new room
	const room = await Messaging.newRoom(sender.nodebb_uid, {
		uids: [receiver.nodebb_uid],
	});

	const roomId = room.roomId;
	await db.setObject(PM_KEY(roomId), {
		sender_client_id: senderClientId,
		receiver_client_id: receiverClientId,
		created_at: Date.now(),
	});
	await db.setAdd(BOT_PM_ROOMS(senderClientId), roomId);
	await db.setAdd(BOT_PM_ROOMS(receiverClientId), roomId);

	// Send the message
	await PM.sendToRoom({ roomId, senderUid: sender.nodebb_uid, message });

	return { roomId };
};

PM.sendToRoom = async function ({ roomId, senderUid, message }) {
	await Messaging.sendMessage({
		uid: senderUid,
		roomId,
		content: message,
	});
};

PM.getInbox = async function (clientId) {
	const roomIds = await db.getSetMembers(BOT_PM_ROOMS(clientId));
	if (!roomIds || roomIds.length === 0) {
		return [];
	}

	const rooms = await Promise.all(
		roomIds.map(async (roomId) => {
			const meta = await db.getObject(PM_KEY(roomId));
			if (!meta) {
				return null;
			}

			const otherClientId = meta.sender_client_id === clientId
				? meta.receiver_client_id
				: meta.sender_client_id;
			const otherBot = await botModel.getBotByClientId(otherClientId);
			const otherUser = otherBot
				? await User.getUserData(otherBot.nodebb_uid)
				: null;

			const roomData = await Messaging.getRoomData(roomId, ['messageCount', 'timestamp']);
			return {
				roomId: parseInt(roomId, 10),
				otherBot: otherUser
					? {
							client_id: otherClientId,
							displayName: `${otherUser.fullname || otherUser.username} (bot_${otherClientId})`,
						}
					: { client_id: otherClientId, displayName: `bot_${otherClientId}` },
				messageCount: roomData ? parseInt(roomData.messageCount, 10) : 0,
				createdAt: meta.created_at ? parseInt(meta.created_at, 10) : null,
			};
		}),
	);

	return rooms.filter(Boolean);
};

PM.getUnread = async function (clientId) {
	const bot = await botModel.getBotByClientId(clientId);
	if (!bot) {
		throw new Error('BOT_NOT_FOUND');
	}

	const roomIds = await db.getSetMembers(BOT_PM_ROOMS(clientId));
	if (!roomIds || roomIds.length === 0) {
		return { count: 0, senders: [] };
	}

	const unreadRooms = [];
	for (const roomId of roomIds) {
		const hasRead = await Messaging.hasRead(bot.nodebb_uid, roomId);
		if (!hasRead) {
			unreadRooms.push(roomId);
		}
	}

	const senders = await Promise.all(
		unreadRooms.map(async (roomId) => {
			const meta = await db.getObject(PM_KEY(roomId));
			if (!meta) {
				return null;
			}
			const otherClientId = meta.sender_client_id === clientId
				? meta.receiver_client_id
				: meta.sender_client_id;
			const otherBot = await botModel.getBotByClientId(otherClientId);
			return {
				client_id: otherClientId,
				name: otherBot ? otherBot.name : 'unknown',
			};
		}),
	);

	return {
		count: unreadRooms.length,
		senders: senders.filter(Boolean),
	};
};

PM.getMessages = async function ({ clientId, roomId, start, count }) {
	const bot = await botModel.getBotByClientId(clientId);
	if (!bot) {
		throw new Error('BOT_NOT_FOUND');
	}

	// Verify this room belongs to the bot
	const isMember = await db.isSetMember(BOT_PM_ROOMS(clientId), roomId);
	if (!isMember) {
		throw new Error('NOT_PARTICIPANT');
	}

	const messages = await Messaging.getMessages({
		callerUid: bot.nodebb_uid,
		uid: bot.nodebb_uid,
		roomId: parseInt(roomId, 10),
		start: start || 0,
		count: count || 50,
	});

	return messages;
};

PM.markRead = async function ({ clientId, roomId }) {
	const bot = await botModel.getBotByClientId(clientId);
	if (!bot) {
		throw new Error('BOT_NOT_FOUND');
	}

	const isMember = await db.isSetMember(BOT_PM_ROOMS(clientId), roomId);
	if (!isMember) {
		throw new Error('NOT_PARTICIPANT');
	}

	await Messaging.markRead(bot.nodebb_uid, roomId);
};
