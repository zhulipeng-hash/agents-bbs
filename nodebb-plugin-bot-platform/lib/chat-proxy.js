'use strict';

const ChatProxy = module.exports;

const db = require.main.require('./src/database');
const Messaging = require.main.require('./src/messaging');
const botModel = require('./bot-model');

const PM_KEY = (roomId) => `bot:pm:${roomId}`;
const GROUP_KEY = (roomId) => `bot:group:${roomId}`;
const BOT_PM_ROOMS = (clientId) => `bot:${clientId}:pm:rooms`;

ChatProxy.verifyOwnership = async function (ownerUid, botClientId) {
	const bot = await botModel.getBotByClientId(botClientId);
	if (!bot) {
		throw new Error('BOT_NOT_FOUND');
	}
	if (bot.owner_uid !== ownerUid) {
		throw new Error('FORBIDDEN');
	}
	return bot;
};

ChatProxy.listBotChats = async function (bot) {
	const roomIds = await db.getSortedSetRevRange(`uid:${bot.nodebb_uid}:chat:rooms`, 0, -1);
	if (!roomIds || roomIds.length === 0) {
		return [];
	}

	const chats = await Promise.all(
		roomIds.map(async (roomId) => {
			const pmMeta = await db.getObject(PM_KEY(roomId));
			if (pmMeta) {
				const otherClientId = pmMeta.sender_client_id === bot.client_id
					? pmMeta.receiver_client_id
					: pmMeta.sender_client_id;
				const otherBot = await botModel.getBotByClientId(otherClientId);
				const roomData = await Messaging.getRoomData(roomId, ['messageCount']);
				return {
					roomId: parseInt(roomId, 10),
					type: 'pm',
					otherBot: otherBot
						? { client_id: otherClientId, name: otherBot.name }
						: { client_id: otherClientId, name: 'unknown' },
					messageCount: roomData ? parseInt(roomData.messageCount, 10) : 0,
				};
			}

			const groupMeta = await db.getObject(GROUP_KEY(roomId));
			if (groupMeta && groupMeta.status !== 'dissolved') {
				const roomData = await Messaging.getRoomData(roomId, ['roomName', 'messageCount']);
				return {
					roomId: parseInt(roomId, 10),
					type: 'group',
					roomName: roomData ? roomData.roomName : '',
					messageCount: roomData ? parseInt(roomData.messageCount, 10) : 0,
					hostClientId: groupMeta.host_client_id,
				};
			}

			return null;
		}),
	);

	return chats.filter(Boolean);
};

ChatProxy.getChatMessages = async function ({ bot, roomId, start, count }) {
	const isMember = await Messaging.isUserInRoom(bot.nodebb_uid, roomId);
	if (!isMember) {
		throw new Error('ROOM_NOT_FOUND');
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

ChatProxy.exportChat = async function ({ bot, roomId, format }) {
	const messages = await ChatProxy.getChatMessages({ bot, roomId, start: 0, count: 1000 });

	if (format === 'csv') {
		const lines = messages.map((msg) => {
			const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : '';
			const from = msg.fromuid || '';
			const content = (msg.content || '').replace(/"/g, '""');
			return `"${ts}","${from}","${content}"`;
		});
		const header = '"timestamp","from_uid","content"';
		return { data: [header, ...lines].join('\n'), contentType: 'text/csv' };
	}

	return { data: JSON.stringify(messages, null, 2), contentType: 'application/json' };
};

ChatProxy.listBotGroups = async function (bot) {
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
				hostClientId: groupMeta.host_client_id,
				isHost: groupMeta.host_client_id === bot.client_id,
			};
		}),
	);

	return groups.filter(Boolean);
};

ChatProxy.getGroupMessages = async function ({ bot, roomId, start, count }) {
	const groupMeta = await db.getObject(GROUP_KEY(roomId));
	if (!groupMeta) {
		throw new Error('NOT_A_BOT_GROUP');
	}

	return ChatProxy.getChatMessages({ bot, roomId, start, count });
};
