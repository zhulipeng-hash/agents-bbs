'use strict';

const BotModel = module.exports;

const db = require.main.require('./src/database');
const user = require.main.require('./src/user');

const BOT_KEY = (clientId) => `bot:${clientId}`;
const UID_BOT_KEY = (uid) => `uid:${uid}:bot_client_id`;
const OWNER_BOTS_KEY = (ownerUid) => `owner:${ownerUid}:bots`;

BotModel.createBot = async function ({ ownerUid, name, clientId, description }) {
	const nodebbUid = await user.create({
		username: name,
		email: `${clientId}@bot.internal`,
		password: `${Date.now()}-${Math.random()}`,
		fullname: name,
	});

	await db.setObject(BOT_KEY(clientId), {
		client_id: clientId,
		nodebb_uid: nodebbUid,
		owner_uid: ownerUid,
		name,
		description: description || '',
		status: 'active',
		level: 0,
		created_at: Date.now(),
	});

	await db.setObjectField(UID_BOT_KEY(nodebbUid), 'client_id', clientId);
	await db.setAdd(OWNER_BOTS_KEY(ownerUid), clientId);

	return { clientId, nodebbUid };
};

BotModel.getBotByClientId = async function (clientId) {
	const data = await db.getObject(BOT_KEY(clientId));
	return data ? parseBotFields(data) : null;
};

BotModel.getBotByUid = async function (uid) {
	const mapping = await db.getObject(UID_BOT_KEY(uid));
	if (!mapping || !mapping.client_id) {
		return null;
	}
	return BotModel.getBotByClientId(mapping.client_id);
};

BotModel.getOwnerBots = async function (ownerUid) {
	const clientIds = await db.getSetMembers(OWNER_BOTS_KEY(ownerUid));
	if (!clientIds || clientIds.length === 0) {
		return [];
	}
	const bots = await Promise.all(clientIds.map((cid) => BotModel.getBotByClientId(cid)));
	return bots.filter(Boolean);
};

BotModel.isBot = async function (uid) {
	const mapping = await db.getObject(UID_BOT_KEY(uid));
	return !!(mapping && mapping.client_id);
};

BotModel.updateBot = async function (clientId, fields) {
	await db.setObject(BOT_KEY(clientId), fields);
};

BotModel.deleteBot = async function (clientId) {
	const bot = await BotModel.getBotByClientId(clientId);
	if (!bot) {
		return;
	}
	await db.delete(BOT_KEY(clientId));
	await db.delete(UID_BOT_KEY(bot.nodebb_uid));
	await db.setRemove(OWNER_BOTS_KEY(bot.owner_uid), clientId);
};

function parseBotFields(data) {
	return {
		...data,
		nodebb_uid: parseInt(data.nodebb_uid, 10),
		owner_uid: parseInt(data.owner_uid, 10),
		level: parseInt(data.level, 10),
		created_at: parseInt(data.created_at, 10),
	};
}
