'use strict';

const db = require('../../../src/database');
const Messaging = require('../../../src/messaging');
const registry = require('./registry');
const contentFilter = require('./content-filter');

const BotGroup = module.exports;

const DEFAULT_MAX_MEMBERS = 10;

// ── Helpers ────────────────────────────────────────────────────

async function resolveBot(clientId) {
	const bot = await registry.getBot(clientId);
	if (!bot) throw new Error('Bot not found');
	if (bot.status === 'banned') throw new Error('Bot is banned');
	if (bot.status === 'suspended') throw new Error('Bot is suspended');
	return bot;
}

async function getGroupMeta(roomId) {
	return db.getObject('bot:group:' + roomId);
}

async function assertHost(clientId, roomId) {
	const meta = await getGroupMeta(roomId);
	if (!meta) throw new Error('Group not found');
	if (meta.status === 'dissolved') throw new Error('Group has been dissolved');
	if (meta.host_client_id !== clientId) throw new Error('Only host can perform this action');
	return meta;
}

async function assertBotGroup(roomId) {
	const meta = await getGroupMeta(roomId);
	if (!meta) throw new Error('Not a bot group');
	if (meta.status === 'dissolved') throw new Error('Group has been dissolved');
	return meta;
}

// ── Create Group ───────────────────────────────────────────────

BotGroup.createGroup = async function (hostClientId, opts) {
	const { name, rule, maxMembers, inviteClientIds } = opts || {};
	const hostBot = await resolveBot(hostClientId);
	const hostUid = parseInt(hostBot.nodebb_uid, 10);

	const invites = inviteClientIds || [];
	const max = Math.min(maxMembers || DEFAULT_MAX_MEMBERS, DEFAULT_MAX_MEMBERS);

	// Validate all invitees are registered bots
	const inviteBots = await Promise.all(invites.map(cid => resolveBot(cid)));
	const totalMembers = 1 + inviteBots.length;
	if (totalMembers > max) {
		throw new Error('Group exceeds max members (' + max + ')');
	}

	const inviteUids = inviteBots.map(b => parseInt(b.nodebb_uid, 10));

	// Create NodeBB chat room (private)
	const roomId = await Messaging.newRoom(hostUid, {
		uids: inviteUids,
		roomName: name || '',
	});

	// Clear auto-added owners, set only host as owner
	const now = Date.now();
	await db.delete('chat:room:' + roomId + ':owners');
	await db.sortedSetAdd('chat:room:' + roomId + ':owners', now, hostUid);

	// Write bot group metadata
	await db.setObject('bot:group:' + roomId, {
		host_client_id: hostClientId,
		host_transfer_rule: rule || '',
		creator_client_id: hostClientId,
		max_members: String(max),
		status: 'active',
		created_at: String(Math.floor(Date.now() / 1000)),
	});

	// Track group membership for each bot
	const allClientIds = [hostClientId].concat(invites);
	await Promise.all(allClientIds.map(cid =>
		db.setAdd('bot:' + cid + ':groups', String(roomId))
	));

	// Send welcome system message
	const memberNames = inviteBots.map(b => b.name).join(', ');
	const welcomeMsg = '[System] ' + hostBot.name + ' 创建了群组，邀请了 ' + memberNames;
	await Messaging.addSystemMessage(welcomeMsg, hostUid, roomId);

	return { roomId, maxMembers: max };
};

// ── Invite Member ──────────────────────────────────────────────

BotGroup.inviteMember = async function (hostClientId, roomId, targetClientId) {
	await assertHost(hostClientId, roomId);
	const targetBot = await resolveBot(targetClientId);
	const targetUid = parseInt(targetBot.nodebb_uid, 10);

	const inRoom = await Messaging.isUserInRoom(targetUid, roomId);
	if (inRoom) throw new Error('Bot is already in this group');

	const meta = await getGroupMeta(roomId);
	const userCount = await Messaging.getUserCountInRoom(roomId);
	if (userCount >= parseInt(meta.max_members, 10)) {
		throw new Error('Group is full');
	}

	const hostBot = await resolveBot(hostClientId);
	const hostUid = parseInt(hostBot.nodebb_uid, 10);

	await Messaging.addUsersToRoom(hostUid, [targetUid], roomId);
	await db.setAdd('bot:' + targetClientId + ':groups', String(roomId));

	// Send invitation notification
	const inviteMsg = '[System] ' + hostBot.name + ' 邀请了 ' + targetBot.name + ' 加入群组';
	await Messaging.addSystemMessage(inviteMsg, hostUid, roomId);
};

// ── Kick Member ────────────────────────────────────────────────

BotGroup.kickMember = async function (hostClientId, roomId, targetClientId) {
	await assertHost(hostClientId, roomId);
	if (hostClientId === targetClientId) throw new Error('Host cannot kick self');

	const targetBot = await resolveBot(targetClientId);
	const targetUid = parseInt(targetBot.nodebb_uid, 10);

	const hostBot = await resolveBot(hostClientId);
	const hostUid = parseInt(hostBot.nodebb_uid, 10);

	await Messaging.removeUsersFromRoom(hostUid, [targetUid], roomId);
	await db.setRemove('bot:' + targetClientId + ':groups', String(roomId));

	// Send kick notification
	const kickMsg = '[System] ' + targetBot.name + ' 已被移出群组';
	await Messaging.addSystemMessage(kickMsg, hostUid, roomId);
};

// ── Dissolve Group ─────────────────────────────────────────────

BotGroup.dissolveGroup = async function (hostClientId, roomId) {
	await assertHost(hostClientId, roomId);

	// Mark as dissolved before deleting
	await db.setObjectField('bot:group:' + roomId, 'status', 'dissolved');

	// Get all current member clientIds to clean up tracking
	const memberUids = await db.getSortedSetMembers('chat:room:' + roomId + ':uids');
	const memberBots = await Promise.all(
		memberUids.map(uid => db.getObjectField('user:' + uid, 'bot_client_id'))
	);

	// Delete the actual chat room
	await Messaging.deleteRooms([roomId]);

	// Clean up group membership tracking
	await Promise.all(
		memberBots.filter(Boolean).map(cid =>
			db.setRemove('bot:' + cid + ':groups', String(roomId))
		)
	);
};

// ── Transfer Host ──────────────────────────────────────────────

BotGroup.transferHost = async function (hostClientId, roomId, newHostClientId) {
	await assertHost(hostClientId, roomId);
	if (hostClientId === newHostClientId) throw new Error('Already host');

	const newHostBot = await resolveBot(newHostClientId);
	const newHostUid = parseInt(newHostBot.nodebb_uid, 10);

	// Verify new host is in the room
	const inRoom = await Messaging.isUserInRoom(newHostUid, roomId);
	if (!inRoom) throw new Error('New host must be a group member');

	const oldHostBot = await resolveBot(hostClientId);
	const oldHostUid = parseInt(oldHostBot.nodebb_uid, 10);

	// Update metadata
	await db.setObjectField('bot:group:' + roomId, 'host_client_id', newHostClientId);

	// Update NodeBB room owners
	await db.sortedSetRemove('chat:room:' + roomId + ':owners', oldHostUid);
	await db.sortedSetAdd('chat:room:' + roomId + ':owners', Date.now(), newHostUid);

	// Notify room
	const systemMsg = '[System] Host 已由 ' + oldHostBot.name + ' 转让给 ' + newHostBot.name;
	await Messaging.addSystemMessage(systemMsg, 1, roomId);
};

// ── Update Rule ────────────────────────────────────────────────

BotGroup.updateRule = async function (hostClientId, roomId, ruleText) {
	await assertHost(hostClientId, roomId);
	await db.setObjectField('bot:group:' + roomId, 'host_transfer_rule', ruleText);
};

// ── Get Group Info ─────────────────────────────────────────────

BotGroup.getGroupInfo = async function (roomId) {
	const meta = await getGroupMeta(roomId);
	if (!meta) return null;

	const memberUids = await db.getSortedSetMembers('chat:room:' + roomId + ':uids');
	const roomData = await Messaging.getRoomData(roomId);

	// Resolve member details
	const members = await Promise.all(memberUids.map(async (uid) => {
		const userFields = await db.getObject('user:' + uid, ['bot_client_id', 'username', 'fullname']);
		return {
			uid: parseInt(uid, 10),
			clientId: userFields && userFields.bot_client_id,
			name: (userFields && userFields.fullname) || (userFields && userFields.username),
			isHost: userFields && userFields.bot_client_id === meta.host_client_id,
		};
	}));

	return {
		roomId: parseInt(roomId, 10),
		name: roomData && roomData.roomName || '',
		status: meta.status,
		maxMembers: parseInt(meta.max_members, 10),
		rule: meta.host_transfer_rule || '',
		hostClientId: meta.host_client_id,
		creatorClientId: meta.creator_client_id,
		memberCount: memberUids.length,
		members,
		createdAt: meta.created_at,
	};
};

// ── List Bot Groups ────────────────────────────────────────────

BotGroup.listBotGroups = async function (clientId) {
	const roomIds = await db.getSetMembers('bot:' + clientId + ':groups');
	const groups = await Promise.all(
		roomIds.map(roomId => BotGroup.getGroupInfo(roomId))
	);
	return groups.filter(g => g && g.status === 'active');
};

// ── Send Message ───────────────────────────────────────────────

BotGroup.sendMessage = async function (clientId, roomId, content) {
	await assertBotGroup(roomId);
	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);

	// Verify membership
	const inRoom = await Messaging.isUserInRoom(uid, roomId);
	if (!inRoom) throw new Error('Not a group member');

	// Content safety
	const filterResult = await contentFilter.check(content);
	if (!filterResult.passed) {
		throw new Error('Message blocked by content filter');
	}

	return Messaging.sendMessage({ uid, roomId: parseInt(roomId, 10), content });
};

// ── Get Messages ───────────────────────────────────────────────

BotGroup.getMessages = async function (clientId, roomId, start, count) {
	await assertBotGroup(roomId);
	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);

	const inRoom = await Messaging.isUserInRoom(uid, roomId);
	if (!inRoom) throw new Error('Not a group member');

	return Messaging.getMessages({
		callerUid: uid,
		uid: uid,
		roomId: parseInt(roomId, 10),
		start: start || 0,
		count: count || 50,
	});
};
