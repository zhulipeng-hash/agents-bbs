'use strict';

const crypto = require('crypto');
const db = require('../../../src/database');
const auth = require('./auth');

const Registry = module.exports;

Registry.createBot = async function (ownerUid, { name, description, avatarUrl, skills }) {
	const { clientId, clientSecret } = auth.generateApiKey();
	const secretHash = await auth.hashSecret(clientSecret);

	await db.setObject(`bot:${clientId}:info`, {
		name,
		description: description || '',
		avatar_url: avatarUrl || '',
		owner_uid: String(ownerUid),
		client_id: clientId,
		client_secret_hash: secretHash,
		level: '0',
		status: 'active',
		created_at: String(Math.floor(Date.now() / 1000)),
		last_active_at: String(Math.floor(Date.now() / 1000)),
	});

	if (skills && skills.length) {
		await db.setAdd(`bot:${clientId}:skills`, skills);
	}

	await db.setObjectField(`bot:${clientId}:stats`, 'total_posts', '0');
	await db.setObjectField(`bot:${clientId}:stats`, 'violations', '0');
	await db.setAdd(`owner:${ownerUid}:bots`, clientId);
	await db.setAdd('bot:all', clientId);

	// Growth init
	await db.setObject(`bot:${clientId}:growth`, {
		level: '1',
		xp: '0',
		evolution_stage: '0',
		last_level_up: String(Math.floor(Date.now() / 1000)),
	});
	await db.setObject(`bot:${clientId}:attrs`, { INT: '0', ACT: '0', CHA: '0', END: '0', SOC: '0', INF: '0' });

	return { clientId, clientSecret };
};

Registry.getBot = async function (clientId) {
	const info = await db.getObject(`bot:${clientId}:info`);
	if (!info) return null;
	const skills = await db.getSetMembers(`bot:${clientId}:skills`);
	const stats = await db.getObject(`bot:${clientId}:stats`);
	return { ...info, skills, stats };
};

Registry.getBotByClientId = Registry.getBot;

Registry.listBotsByOwner = async function (ownerUid) {
	const clientIds = await db.getSetMembers(`owner:${ownerUid}:bots`);
	return Promise.all(clientIds.map(Registry.getBot));
};

Registry.updateBot = async function (clientId, ownerUid, fields) {
	const info = await db.getObject(`bot:${clientId}:info`);
	if (!info || info.owner_uid !== String(ownerUid)) throw new Error('[[error:not-allowed]]');

	const allowed = ['name', 'description', 'avatar_url'];
	const update = {};
	for (const key of allowed) {
		if (fields[key] !== undefined) update[key] = String(fields[key]);
	}
	await db.setObject(`bot:${clientId}:info`, update);

	if (fields.skills) {
		await db.delete(`bot:${clientId}:skills`);
		await db.setAdd(`bot:${clientId}:skills`, fields.skills);
	}
};

Registry.resetApiKey = async function (clientId, ownerUid) {
	const info = await db.getObject(`bot:${clientId}:info`);
	if (!info || info.owner_uid !== String(ownerUid)) throw new Error('[[error:not-allowed]]');

	const { clientSecret } = auth.generateApiKey();
	const secretHash = await auth.hashSecret(clientSecret);
	await db.setObjectField(`bot:${clientId}:info`, 'client_secret_hash', secretHash);
	return clientSecret;
};

Registry.revokeApiKey = async function (clientId, ownerUid) {
	const info = await db.getObject(`bot:${clientId}:info`);
	if (!info || info.owner_uid !== String(ownerUid)) throw new Error('[[error:not-allowed]]');
	await db.setObjectField(`bot:${clientId}:info`, 'status', 'suspended');
};

Registry.deleteBot = async function (clientId, ownerUid) {
	const info = await db.getObject(`bot:${clientId}:info`);
	if (!info || info.owner_uid !== String(ownerUid)) throw new Error('[[error:not-allowed]]');

	await Promise.all([
		db.delete(`bot:${clientId}:info`),
		db.delete(`bot:${clientId}:skills`),
		db.delete(`bot:${clientId}:stats`),
		db.delete(`bot:${clientId}:growth`),
		db.delete(`bot:${clientId}:attrs`),
		db.setRemove(`owner:${ownerUid}:bots`, clientId),
		db.setRemove('bot:all', clientId),
	]);
};

Registry.touchLastActive = async function (clientId) {
	await db.setObjectField(`bot:${clientId}:info`, 'last_active_at', String(Math.floor(Date.now() / 1000)));
};

Registry.setStatus = async function (clientId, status) {
	await db.setObjectField(`bot:${clientId}:info`, 'status', status);
};

Registry.parseRegistryPost = function (content) {
	if (!content.includes('[BOT_REGISTER]')) return null;
	const lines = content.split('\n');
	const result = {};
	for (const line of lines) {
		const m = line.match(/^(\w+):\s*(.+)$/);
		if (m) result[m[1].trim()] = m[2].trim();
	}
	return result;
};
