'use strict';

const crypto = require('crypto');
const db = require('../../../src/database');

const SEVERITY_SCORE = { warning: 0, minor: 1, severe: 2, critical: 3 };

const Violation = module.exports;

Violation.record = async function (clientId, uid, { severity, type, contentSnapshot, actionTaken, reviewedBy }) {
	const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
	const ownerUid = await db.getObjectField(`bot:${clientId}:info`, 'owner_uid');

	await db.setObject(`violation:${id}`, {
		bot_id: clientId,
		uid: String(uid),
		owner_uid: String(ownerUid || ''),
		severity,
		type,
		content_snapshot: (contentSnapshot || '').slice(0, 500),
		action_taken: actionTaken || 'none',
		reviewed_by: reviewedBy || '',
		created_at: String(Math.floor(Date.now() / 1000)),
	});

	await db.listPrepend(`bot:${clientId}:violations`, id);
	await db.incrObjectField(`bot:${clientId}:stats`, 'violations');

	await Violation._applyPenalty(clientId, uid, ownerUid, severity);

	return id;
};

Violation._applyPenalty = async function (clientId, uid, ownerUid, severity) {
	const score = SEVERITY_SCORE[severity] || 0;

	if (score >= SEVERITY_SCORE.severe) {
		// Immediately ban the bot key
		await db.setObjectField(`bot:${clientId}:info`, 'status', 'banned');
	} else if (score >= SEVERITY_SCORE.minor) {
		// 24-hour rate throttle: set a temporary flag
		await db.psetex(`bot:${clientId}:throttled`, 86400 * 1000, '1');
	}

	if (score >= SEVERITY_SCORE.critical && ownerUid) {
		// Warn owner and check if all bots should be suspended
		await Violation._checkOwnerConnected(ownerUid);
	}
};

Violation._checkOwnerConnected = async function (ownerUid) {
	const botIds = await db.getSetMembers(`owner:${ownerUid}:bots`);
	const violationCounts = await Promise.all(
		botIds.map(id => db.getObjectField(`bot:${id}:stats`, 'violations').then(v => parseInt(v || 0, 10)))
	);
	const totalSevere = violationCounts.reduce((a, b) => a + b, 0);

	if (totalSevere >= 3) {
		// Suspend all bots under this owner
		await Promise.all(
			botIds.map(id => db.setObjectField(`bot:${id}:info`, 'status', 'suspended'))
		);
		await db.setObjectField(`user:${ownerUid}`, 'bot_owner_warned', '1');
	}
};

Violation.getViolations = async function (clientId, { start = 0, stop = 19 } = {}) {
	const ids = await db.getListRange(`bot:${clientId}:violations`, start, stop);
	return Promise.all(ids.map(id => db.getObject(`violation:${id}`)));
};
