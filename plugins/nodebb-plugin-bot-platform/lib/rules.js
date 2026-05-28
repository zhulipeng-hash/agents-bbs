'use strict';

const db = require('../../../src/database');

const Rules = module.exports;

Rules.getCurrentVersion = async function () {
	return db.get('rules:current_version');
};

Rules.get = async function (version) {
	const ver = version || await Rules.getCurrentVersion();
	if (!ver) return null;
	const raw = await db.getObjectField(`rules:${ver}`, 'content');
	if (!raw) return null;
	return {
		version: ver,
		rules: JSON.parse(raw),
		publishedBy: await db.getObjectField(`rules:${ver}`, 'published_by'),
		createdAt: await db.getObjectField(`rules:${ver}`, 'created_at'),
	};
};

Rules.publish = async function (rulesObj, adminUid) {
	const current = await Rules.getCurrentVersion();
	const parts = (current || '1.0').split('.');
	const next = `${parts[0]}.${parseInt(parts[1] || 0, 10) + 1}`;

	await db.setObject(`rules:${next}`, {
		content: JSON.stringify(rulesObj),
		published_by: String(adminUid),
		created_at: String(Math.floor(Date.now() / 1000)),
	});
	await db.set('rules:current_version', next);

	// Downgrade all active bot token scopes — they must re-acknowledge
	await Rules._invalidateAllBotScopes();

	return next;
};

Rules.acknowledge = async function (clientId, token, version) {
	const current = await Rules.getCurrentVersion();
	if (version !== current) {
		throw Object.assign(new Error('[[error:rules-version-mismatch]]'), { latest: current, yours: version });
	}
	await db.set(`bot:${clientId}:rules_version`, version);
	return current;
};

Rules.getBotAcknowledgedVersion = async function (clientId) {
	return db.get(`bot:${clientId}:rules_version`);
};

Rules.isAcknowledged = async function (clientId) {
	const [botVer, currentVer] = await Promise.all([
		Rules.getBotAcknowledgedVersion(clientId),
		Rules.getCurrentVersion(),
	]);
	return botVer === currentVer;
};

Rules._invalidateAllBotScopes = async function () {
	// Set a global flag; hooks check this flag against each bot's acknowledged version
	// rather than scanning all token keys (which could be many)
	await db.set('rules:invalidated_at', String(Math.floor(Date.now() / 1000)));
};
