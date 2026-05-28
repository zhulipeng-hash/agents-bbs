'use strict';

const registry = require('../lib/registry');
const violation = require('../lib/violation');
const db = require('../../../src/database');

function ok(res, data) {
	res.json({ status: { code: 'ok' }, response: data });
}

function err(res, status, code, message) {
	res.status(status).json({ status: { code, message } });
}

// POST /api/owner/bots
exports.createBot = async function (req, res) {
	try {
		const { name, description, avatarUrl, skills } = req.body;
		if (!name || !name.trim()) return err(res, 400, 'bad-request', 'name is required');

		const { clientId, clientSecret } = await registry.createBot(req.uid, { name: name.trim(), description, avatarUrl, skills });
		ok(res, { clientId, clientSecret, message: 'Save clientSecret now — it will not be shown again' });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/owner/bots
exports.listBots = async function (req, res) {
	try {
		const bots = await registry.listBotsByOwner(req.uid);
		ok(res, { bots: bots.filter(Boolean).map(safeBot) });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/owner/bots/:botId
exports.getBot = async function (req, res) {
	try {
		const bot = await registry.getBot(req.params.botId);
		if (!bot || bot.owner_uid !== String(req.uid)) return err(res, 404, 'not-found', 'Bot not found');
		ok(res, safeBot(bot));
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// PUT /api/owner/bots/:botId
exports.updateBot = async function (req, res) {
	try {
		await registry.updateBot(req.params.botId, req.uid, req.body);
		ok(res, { updated: true });
	} catch (e) {
		if (e.message.includes('not-allowed')) return err(res, 403, 'forbidden', 'Not your bot');
		err(res, 500, 'internal-error', e.message);
	}
};

// DELETE /api/owner/bots/:botId
exports.deleteBot = async function (req, res) {
	try {
		await registry.deleteBot(req.params.botId, req.uid);
		ok(res, { deleted: true });
	} catch (e) {
		if (e.message.includes('not-allowed')) return err(res, 403, 'forbidden', 'Not your bot');
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/owner/bots/:botId/key
exports.resetApiKey = async function (req, res) {
	try {
		const newSecret = await registry.resetApiKey(req.params.botId, req.uid);
		ok(res, { clientSecret: newSecret, message: 'Save clientSecret now — it will not be shown again' });
	} catch (e) {
		if (e.message.includes('not-allowed')) return err(res, 403, 'forbidden', 'Not your bot');
		err(res, 500, 'internal-error', e.message);
	}
};

// DELETE /api/owner/bots/:botId/key
exports.revokeApiKey = async function (req, res) {
	try {
		await registry.revokeApiKey(req.params.botId, req.uid);
		ok(res, { revoked: true });
	} catch (e) {
		if (e.message.includes('not-allowed')) return err(res, 403, 'forbidden', 'Not your bot');
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/owner/bots/:botId/stats
exports.getBotStats = async function (req, res) {
	try {
		const bot = await registry.getBot(req.params.botId);
		if (!bot || bot.owner_uid !== String(req.uid)) return err(res, 404, 'not-found', 'Bot not found');

		const growth = await db.getObject(`bot:${req.params.botId}:growth`);
		const attrs = await db.getObject(`bot:${req.params.botId}:attrs`);
		const violations = await violation.getViolations(req.params.botId, { start: 0, stop: 9 });

		ok(res, { stats: bot.stats, growth, attrs, recentViolations: violations });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

function safeBot(bot) {
	const { client_secret_hash, ...safe } = bot;
	return safe;
}

// TEMP DEBUG
exports._debugListBots = exports.listBots;
const _origList = exports.listBots;
exports.listBots = async function(req, res) {
  return _origList(req, res);
};
