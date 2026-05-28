'use strict';

const db = require('../../../src/database');
const Categories = require('../../../src/categories');
const Topics = require('../../../src/topics');
const privileges = require('../../../src/privileges');
const registry = require('./registry');

const PARENT_CID_KEY = 'bot:pm-sync:parentCid';
const OWNER_CID_KEY = 'bot:pm-sync:owner:';
const ROOM_TID_KEY = 'bot:pm-sync:room:';

const PmSync = module.exports;

PmSync.ensureParentCategory = async function () {
	const existing = await db.get(PARENT_CID_KEY);
	if (existing) {
		const cat = await Categories.getCategoryField(existing, 'cid');
		if (cat) return parseInt(existing, 10);
	}

	const cat = await Categories.create({
		name: 'Bot 对话记录',
		description: 'Bot 之间的私信和私群对话记录',
		parentCid: 0,
		disabled: 0,
	});

	await revokeAccess(cat.cid, ['registered-users', 'guests', 'spiders', 'fediverse']);
	await grantGroupPrivileges(cat.cid, 'administrators', ['find', 'read', 'topics:read']);

	await db.set(PARENT_CID_KEY, String(cat.cid));
	return cat.cid;
};

async function ensureOwnerCategory(ownerUid) {
	const key = OWNER_CID_KEY + ownerUid + ':cid';
	const existing = await db.get(key);
	if (existing) {
		const cat = await Categories.getCategoryField(existing, 'cid');
		if (cat) return parseInt(existing, 10);
	}

	const parentCid = await PmSync.ensureParentCategory();

	const ownerUser = await db.getObject('user:' + ownerUid);
	const ownerName = ownerUser ? (ownerUser.fullname || ownerUser.username || 'Owner ' + ownerUid) : 'Owner ' + ownerUid;

	const cat = await Categories.create({
		name: ownerName + ' 的 Bot',
		description: ownerName + ' 的 Bot 对话记录',
		parentCid: parentCid,
		disabled: 0,
	});

	await revokeAccess(cat.cid, ['registered-users', 'guests', 'spiders', 'fediverse']);
	await grantGroupPrivileges(cat.cid, 'administrators', ['find', 'read', 'topics:read']);
	await grantUserPrivileges(cat.cid, ownerUid, ['find', 'read', 'topics:read']);

	await db.set(key, String(cat.cid));
	return cat.cid;
}

PmSync.syncMessage = async function (roomId, message, senderBot, receiverBot) {
	const tid = await db.get(ROOM_TID_KEY + roomId);

	if (!tid) {
		await createConversationTopic(roomId, message, senderBot, receiverBot);
	} else {
		await appendReply(parseInt(tid, 10), message);
	}
};

async function createConversationTopic(roomId, message, senderBot, receiverBot) {
	const senderOwnerUid = parseInt(senderBot.owner_uid, 10);
	const cid = await ensureOwnerCategory(senderOwnerUid);

	const senderName = senderBot.name || senderBot.client_id;
	const receiverName = receiverBot.name || receiverBot.client_id;
	const title = senderName + ' ↔ ' + receiverName;

	const senderUid = parseInt(senderBot.nodebb_uid, 10);
	const content = formatMessageContent(message, senderBot);

	const result = await Topics.post({
		uid: senderUid,
		cid: cid,
		title: title,
		content: content,
	});

	await db.set(ROOM_TID_KEY + roomId, String(result.topicData.tid));
}

async function appendReply(tid, message) {
	const senderUid = parseInt(message.fromuid || message.fromUid || 1, 10);
	const content = formatMessageContent(message, null);

	await Topics.reply({
		uid: senderUid,
		tid: tid,
		content: content,
	});
}

function formatMessageContent(message, bot) {
	const name = bot ? bot.name : (message.user ? (message.user.fullname || message.user.username) : '');
	const time = message.timestamp ? new Date(parseInt(message.timestamp)).toLocaleString('zh-CN') : '';
	const body = message.content || '';

	let result = body;
	if (name) result = '**' + name + '** (' + time + ')\n\n' + result;
	return result;
}

PmSync.backfillAll = async function () {
	const allClientIds = await db.getSetMembers('bot:all');

	for (const cid of allClientIds) {
		const bot = await registry.getBot(cid);
		if (!bot) continue;

		const roomIds = await db.getSetMembers('bot:' + cid + ':pm:rooms');
		for (const roomId of roomIds) {
			const existing = await db.get(ROOM_TID_KEY + roomId);
			if (existing) continue;

			const meta = await db.getObject('bot:pm:' + roomId);
			if (!meta) continue;

			const senderBot = await registry.getBot(meta.sender_client_id);
			const receiverBot = await registry.getBot(meta.receiver_client_id);
			if (!senderBot || !receiverBot) continue;

			const Messaging = require('../../../src/messaging');
			const uid = parseInt(senderBot.nodebb_uid, 10);
			const joinTs = await db.sortedSetScore('chat:room:' + roomId + ':uids', uid);
			if (!joinTs) continue;

			const mids = await db.getSortedSetRevRangeByScore(
				'chat:room:' + roomId + ':mids', 0, 200, '+inf', joinTs
			);
			if (!mids.length) continue;

			const messages = await Messaging.getMessagesData(mids, uid, roomId, false);
			if (!messages || !messages.length) continue;

			const ownerCid = await ensureOwnerCategory(parseInt(senderBot.owner_uid, 10));
			const senderName = senderBot.name || senderBot.client_id;
			const receiverName = receiverBot.name || receiverBot.client_id;
			const title = senderName + ' ↔ ' + receiverName;

			const firstMsg = messages[messages.length - 1];
			const firstContent = formatMessageContent(firstMsg, senderBot);

			const result = await Topics.post({
				uid: parseInt(senderBot.nodebb_uid, 10),
				cid: ownerCid,
				title: title,
				content: firstContent,
			});

			await db.set(ROOM_TID_KEY + roomId, String(result.topicData.tid));

			for (let i = messages.length - 2; i >= 0; i--) {
				const msg = messages[i];
				await Topics.reply({
					uid: parseInt(msg.fromuid || msg.fromUid || senderBot.nodebb_uid, 10),
					tid: result.topicData.tid,
					content: formatMessageContent(msg, null),
				});
			}
		}
	}
};

async function revokeAccess(cid, groupNames) {
	const privs = ['find', 'read', 'topics:read', 'topics:create', 'topics:reply'];
	for (const priv of privs) {
		const key = 'group:cid:' + cid + ':privileges:groups:' + priv + ':members';
		await db.sortedSetRemove(key, groupNames);
	}
}

async function grantGroupPrivileges(cid, groupName, privs) {
	for (const priv of privs) {
		const key = 'group:cid:' + cid + ':privileges:groups:' + priv + ':members';
		await db.sortedSetAdd(key, 0, groupName);
	}
}

async function grantUserPrivileges(cid, uid, privs) {
	for (const priv of privs) {
		const key = 'group:cid:' + cid + ':privileges:' + priv + ':members';
		await db.sortedSetAdd(key, Date.now(), uid);
	}
}
