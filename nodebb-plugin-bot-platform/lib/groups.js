'use strict';

const Groups = module.exports;

const db = require.main.require('./src/database');
const Messaging = require.main.require('./src/messaging');
const botModel = require('./bot-model');

const GROUP_KEY = (roomId) => `bot:group:${roomId}`;
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 10;

Groups.create = async function ({ hostClientId, initialMemberClientIds, groupName }) {
	const host = await botModel.getBotByClientId(hostClientId);
	if (!host || host.status !== 'active') {
		throw new Error('HOST_NOT_ACTIVE');
	}

	const memberUids = [host.nodebb_uid];
	const validatedMembers = [];

	// Validate initial members if provided
	if (initialMemberClientIds && initialMemberClientIds.length > 0) {
		const totalMembers = 1 + initialMemberClientIds.length;
		if (totalMembers > MAX_MEMBERS) {
			throw new Error('MEMBER_LIMIT_EXCEEDED');
		}

		for (const clientId of initialMemberClientIds) {
			if (clientId === hostClientId) {
				continue;
			}
			const member = await botModel.getBotByClientId(clientId);
			if (!member || member.status !== 'active') {
				throw new Error(`MEMBER_NOT_ACTIVE:${clientId}`);
			}
			memberUids.push(member.nodebb_uid);
			validatedMembers.push(clientId);
		}
	}

	if (memberUids.length < MIN_MEMBERS) {
		// Creating with just host is ok, but group needs at least 2 eventually
	}

	const room = await Messaging.newRoom(host.nodebb_uid, {
		uids: memberUids.length > 1 ? memberUids.slice(1) : [],
		roomName: groupName || undefined,
	});

	const roomId = room.roomId;
	await db.setObject(GROUP_KEY(roomId), {
		host_client_id: hostClientId,
		creator_client_id: hostClientId,
		host_transfer_rule: '',
		max_members: MAX_MEMBERS,
		status: 'active',
		created_at: Date.now(),
	});

	return { roomId, memberCount: memberUids.length };
};

Groups.list = async function (clientId) {
	const bot = await botModel.getBotByClientId(clientId);
	if (!bot) {
		throw new Error('BOT_NOT_FOUND');
	}

	// Get all chat rooms for this bot
	const roomIds = await db.getSortedSetRevRange(`uid:${bot.nodebb_uid}:chat:rooms`, 0, -1);
	if (!roomIds || roomIds.length === 0) {
		return [];
	}

	const groups = await Promise.all(
		roomIds.map(async (roomId) => {
			const groupMeta = await db.getObject(GROUP_KEY(roomId));
			if (!groupMeta || groupMeta.status === 'dissolved') {
				return null;
			}

			const roomData = await Messaging.getRoomData(roomId, ['roomName', 'messageCount']);
			const memberCount = await Messaging.getUserCountInRoom(roomId);

			return {
				roomId: parseInt(roomId, 10),
				roomName: roomData ? roomData.roomName : '',
				memberCount,
				isHost: groupMeta.host_client_id === clientId,
				hostClientId: groupMeta.host_client_id,
				createdAt: groupMeta.created_at ? parseInt(groupMeta.created_at, 10) : null,
			};
		}),
	);

	return groups.filter(Boolean);
};

Groups.detail = async function ({ clientId, roomId }) {
	const bot = await botModel.getBotByClientId(clientId);
	if (!bot) {
		throw new Error('BOT_NOT_FOUND');
	}

	const isMember = await Messaging.isUserInRoom(bot.nodebb_uid, roomId);
	if (!isMember) {
		throw new Error('NOT_MEMBER');
	}

	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta) {
		throw new Error('NOT_A_BOT_GROUP');
	}

	const roomData = await Messaging.getRoomData(roomId);
	const memberCount = await Messaging.getUserCountInRoom(roomId);

	return {
		roomId: parseInt(roomId, 10),
		roomName: roomData ? roomData.roomName : '',
		memberCount,
		hostClientId: groupMeta.host_client_id,
		creatorClientId: groupMeta.creator_client_id,
		hostTransferRule: groupMeta.host_transfer_rule || '',
		status: groupMeta.status,
		isHost: groupMeta.host_client_id === clientId,
		createdAt: groupMeta.created_at ? parseInt(groupMeta.created_at, 10) : null,
	};
};

Groups.invite = async function ({ hostClientId, roomId, targetClientId }) {
	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta) {
		throw new Error('NOT_A_BOT_GROUP');
	}
	if (groupMeta.status !== 'active') {
		throw new Error('GROUP_NOT_ACTIVE');
	}
	if (groupMeta.host_client_id !== hostClientId) {
		throw new Error('NOT_HOST');
	}

	const target = await botModel.getBotByClientId(targetClientId);
	if (!target || target.status !== 'active') {
		throw new Error('TARGET_NOT_ACTIVE');
	}

	const currentCount = await Messaging.getUserCountInRoom(roomId);
	if (currentCount >= MAX_MEMBERS) {
		throw new Error('MEMBER_LIMIT_EXCEEDED');
	}

	const host = await botModel.getBotByClientId(hostClientId);
	await Messaging.addUsersToRoom(host.nodebb_uid, [target.nodebb_uid], roomId);

	return { success: true, memberCount: currentCount + 1 };
};

Groups.kick = async function ({ hostClientId, roomId, targetClientId }) {
	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta) {
		throw new Error('NOT_A_BOT_GROUP');
	}
	if (groupMeta.host_client_id !== hostClientId) {
		throw new Error('NOT_HOST');
	}
	if (groupMeta.host_client_id === targetClientId) {
		throw new Error('CANNOT_KICK_HOST');
	}

	const target = await botModel.getBotByClientId(targetClientId);
	if (!target) {
		throw new Error('TARGET_NOT_FOUND');
	}

	const host = await botModel.getBotByClientId(hostClientId);
	await Messaging.removeUsersFromRoom(host.nodebb_uid, [target.nodebb_uid], roomId);

	return { success: true };
};

Groups.dissolve = async function ({ hostClientId, roomId }) {
	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta) {
		throw new Error('NOT_A_BOT_GROUP');
	}
	if (groupMeta.host_client_id !== hostClientId) {
		throw new Error('NOT_HOST');
	}

	// Mark as dissolved
	await db.setObjectField(GROUP_KEY(roomId), 'status', 'dissolved');

	// Remove all members from the room
	const host = await botModel.getBotByClientId(hostClientId);
	const roomUids = await db.getSortedSetRange(`chat:room:${roomId}:uids`, 0, -1);
	if (roomUids && roomUids.length > 0) {
		const otherUids = roomUids.map(Number).filter((uid) => uid !== host.nodebb_uid);
		if (otherUids.length > 0) {
			await Messaging.removeUsersFromRoom(host.nodebb_uid, otherUids, roomId);
		}
	}

	return { success: true };
};

Groups.transfer = async function ({ hostClientId, roomId, newHostClientId }) {
	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta) {
		throw new Error('NOT_A_BOT_GROUP');
	}
	if (groupMeta.host_client_id !== hostClientId) {
		throw new Error('NOT_HOST');
	}

	const newHost = await botModel.getBotByClientId(newHostClientId);
	if (!newHost) {
		throw new Error('NEW_HOST_NOT_FOUND');
	}

	// Verify new host is a member
	const isMember = await Messaging.isUserInRoom(newHost.nodebb_uid, roomId);
	if (!isMember) {
		throw new Error('NEW_HOST_NOT_MEMBER');
	}

	// Update host in metadata
	await db.setObjectField(GROUP_KEY(roomId), 'host_client_id', newHostClientId);

	// Update NodeBB room ownership
	const oldHost = await botModel.getBotByClientId(hostClientId);
	await Messaging.toggleOwner(oldHost.nodebb_uid, roomId, false);
	await Messaging.toggleOwner(newHost.nodebb_uid, roomId, true);

	return { success: true, newHostClientId };
};

Groups.updateRule = async function ({ hostClientId, roomId, ruleText }) {
	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta) {
		throw new Error('NOT_A_BOT_GROUP');
	}
	if (groupMeta.host_client_id !== hostClientId) {
		throw new Error('NOT_HOST');
	}

	await db.setObjectField(GROUP_KEY(roomId), 'host_transfer_rule', ruleText);
	return { success: true };
};

Groups.sendMessage = async function ({ clientId, roomId, message }) {
	const bot = await botModel.getBotByClientId(clientId);
	if (!bot || bot.status !== 'active') {
		throw new Error('BOT_NOT_ACTIVE');
	}

	const isMember = await Messaging.isUserInRoom(bot.nodebb_uid, roomId);
	if (!isMember) {
		throw new Error('NOT_MEMBER');
	}

	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta || groupMeta.status !== 'active') {
		throw new Error('GROUP_NOT_ACTIVE');
	}

	await Messaging.sendMessage({
		uid: bot.nodebb_uid,
		roomId: parseInt(roomId, 10),
		content: message,
	});

	return { success: true };
};

Groups.getMessages = async function ({ clientId, roomId, start, count }) {
	const bot = await botModel.getBotByClientId(clientId);
	if (!bot) {
		throw new Error('BOT_NOT_FOUND');
	}

	const isMember = await Messaging.isUserInRoom(bot.nodebb_uid, roomId);
	if (!isMember) {
		throw new Error('NOT_MEMBER');
	}

	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta) {
		throw new Error('NOT_A_BOT_GROUP');
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
