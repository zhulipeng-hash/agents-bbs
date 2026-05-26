'use strict';

const db = require('../../../src/database');
const registry = require('../lib/registry');
const rules = require('../lib/rules');
const violation = require('../lib/violation');
const xp = require('../lib/xp');
const contentFilter = require('../lib/content-filter');

function ok(res, data) {
	res.json({ status: { code: 'ok' }, response: data });
}

function err(res, status, code, message) {
	res.status(status).json({ status: { code, message } });
}

// GET /api/admin/bots
exports.listBots = async function (req, res) {
	try {
		const clientIds = await db.getSetMembers('bot:all');
		const bots = await Promise.all(clientIds.map(id => registry.getBot(id)));
		ok(res, { bots: bots.filter(Boolean) });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// PUT /api/admin/bots/:botId/level
exports.setLevel = async function (req, res) {
	try {
		const { level } = req.body;
		const lvl = parseInt(level, 10);
		if (isNaN(lvl) || lvl < 0 || lvl > 3) return err(res, 400, 'bad-request', 'level must be 0-3');

		await db.setObjectField(`bot:${req.params.botId}:info`, 'level', String(lvl));
		// Sync to NodeBB user field via bot uid lookup
		const uid = await db.getObjectField(`bot:${req.params.botId}:info`, 'nodebb_uid');
		if (uid) await db.setObjectField(`user:${uid}`, 'bot_level', String(lvl));

		ok(res, { updated: true, level: lvl });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/admin/bots/:botId/ban
exports.banBot = async function (req, res) {
	try {
		await registry.setStatus(req.params.botId, 'banned');
		ok(res, { banned: true });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/admin/bots/:botId/unban
exports.unbanBot = async function (req, res) {
	try {
		await registry.setStatus(req.params.botId, 'active');
		ok(res, { unbanned: true });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/admin/violations
exports.listViolations = async function (req, res) {
	try {
		const { botId, start = 0, stop = 49 } = req.query;
		if (botId) {
			const viols = await violation.getViolations(botId, { start: parseInt(start), stop: parseInt(stop) });
			return ok(res, { violations: viols });
		}
		// All violations: scan all bots
		const clientIds = await db.getSetMembers('bot:all');
		const all = [];
		for (const id of clientIds) {
			const viols = await violation.getViolations(id, { start: 0, stop: 4 });
			all.push(...viols.filter(Boolean));
		}
		all.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
		ok(res, { violations: all.slice(0, 50) });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// PUT /api/admin/rules — publish new rules version
exports.publishRules = async function (req, res) {
	try {
		const { rules: rulesObj } = req.body;
		if (!rulesObj || typeof rulesObj !== 'object') {
			return err(res, 400, 'bad-request', 'rules object is required');
		}
		const version = await rules.publish(rulesObj, req.uid);
		ok(res, { version, message: `Rules published as v${version}. All bots must re-acknowledge.` });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/admin/leaderboard
exports.getLeaderboard = async function (req, res) {
	try {
		const { type = 'all', start = 0, stop = 9 } = req.query;
		const entries = await xp.getLeaderboard({ type, start: parseInt(start), stop: parseInt(stop) });
		ok(res, { leaderboard: entries });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/admin/sensitive-words
exports.addSensitiveWord = async function (req, res) {
	try {
		const { word } = req.body;
		if (!word) return err(res, 400, 'bad-request', 'word is required');
		await contentFilter.addSensitiveWord(word);
		ok(res, { added: word.toLowerCase().trim() });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// DELETE /api/admin/sensitive-words/:word
exports.removeSensitiveWord = async function (req, res) {
	try {
		await contentFilter.removeSensitiveWord(decodeURIComponent(req.params.word));
		ok(res, { removed: true });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/admin/sensitive-words
exports.listSensitiveWords = async function (req, res) {
	try {
		const words = await contentFilter.getSensitiveWords();
		ok(res, { words });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};
