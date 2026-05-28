'use strict';

const auth = require('../lib/auth');
const rules = require('../lib/rules');
const registry = require('../lib/registry');

function ok(res, data) {
	res.json({ status: { code: 'ok' }, response: data });
}

function err(res, status, code, message, extra) {
	res.status(status).json({ status: { code, message }, ...extra });
}

// POST /api/bot/auth
exports.issueToken = async function (req, res) {
	try {
		const { client_id, client_secret, timestamp, signature } = req.body;
		if (!client_id || !client_secret || !timestamp || !signature) {
			return err(res, 400, 'bad-request', 'Missing required fields');
		}

		const bot = await registry.getBot(client_id);
		if (!bot) return err(res, 401, 'not-authorised', 'Unknown client_id');
		if (bot.status === 'banned') return err(res, 403, 'forbidden', 'Bot is banned');
		if (bot.status === 'suspended') return err(res, 403, 'forbidden', 'Bot is suspended');

		// Verify HMAC signature
		const secretOk = await auth.verifySecret(client_secret, bot.client_secret_hash);
		if (!secretOk) return err(res, 401, 'not-authorised', 'Invalid credentials');

		if (!auth.verifySignature(client_id, timestamp, signature, client_secret)) {
			return err(res, 401, 'not-authorised', 'Invalid signature or timestamp');
		}

		const { token, expiresIn } = await auth.issueToken(client_id, 'rules_only');
		await registry.touchLastActive(client_id);

		ok(res, { access_token: token, scope: 'rules_only', expires_in: expiresIn, bot_level: parseInt(bot.level || 0, 10) });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/bot/auth/refresh
exports.refreshToken = async function (req, res) {
	try {
		await auth.revokeToken(req.botToken);
		const bot = await registry.getBot(req.botClientId);
		const { token, expiresIn } = await auth.issueToken(req.botClientId, req.botScope);
		ok(res, { access_token: token, scope: req.botScope, expires_in: expiresIn, bot_level: parseInt(bot.level || 0, 10) });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// DELETE /api/bot/auth
exports.revokeToken = async function (req, res) {
	try {
		await auth.revokeToken(req.botToken);
		ok(res, { loggedOut: true });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/bot/rules
exports.getRules = async function (req, res) {
	try {
		const data = await rules.get();
		if (!data) return err(res, 404, 'not-found', 'No rules published yet');
		ok(res, data);
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/bot/rules/version
exports.getRulesVersion = async function (req, res) {
	try {
		const version = await rules.getCurrentVersion();
		ok(res, { version });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/bot/rules/acknowledge
exports.acknowledgeRules = async function (req, res) {
	try {
		const { version } = req.body;
		if (!version) return err(res, 400, 'bad-request', 'version is required');

		await rules.acknowledge(req.botClientId, req.botToken, version);
		await auth.upgradeTokenScope(req.botToken, 'full');

		const bot = await registry.getBot(req.botClientId);
		const quotaLimits = { day: [100, 500, 2000, 999999][parseInt(bot.level || 0, 10)] };

		ok(res, { access_token: req.botToken, scope: 'full', rules_version: version, quota: quotaLimits });
	} catch (e) {
		if (e.message.includes('rules-version-mismatch')) {
			return err(res, 400, 'version-mismatch', 'Rules version mismatch', { latest: e.latest, yours: e.yours });
		}
		err(res, 500, 'internal-error', e.message);
	}
};
