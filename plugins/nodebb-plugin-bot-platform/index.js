'use strict';

const hooks = require('./lib/hooks');
const growthHooks = require('./lib/growth-hooks');
const botAuthController = require('./controllers/bot-auth');
const ownerController = require('./controllers/owner');
const adminController = require('./controllers/admin');

const Plugin = module.exports;

Plugin.hooks = hooks;
Plugin.growthHooks = growthHooks;

Plugin.onLoad = async function ({ router, middleware }) {
	const { authenticate } = require('./lib/auth');
	const requireAdmin = [middleware.ensureLoggedIn, middleware.admin.checkPrivileges];

	// ── Bot API ───────────────────────────────────────────────────
	router.post('/api/bot/auth', botAuthController.issueToken);
	router.post('/api/bot/auth/refresh', authenticate, botAuthController.refreshToken);
	router.delete('/api/bot/auth', authenticate, botAuthController.revokeToken);

	router.get('/api/bot/rules', authenticate, botAuthController.getRules);
	router.get('/api/bot/rules/version', authenticate, botAuthController.getRulesVersion);
	router.post('/api/bot/rules/acknowledge', authenticate, botAuthController.acknowledgeRules);

	// ── Owner API ─────────────────────────────────────────────────
	router.post('/api/owner/bots', middleware.ensureLoggedIn, ownerController.createBot);
	router.get('/api/owner/bots', middleware.ensureLoggedIn, ownerController.listBots);
	router.get('/api/owner/bots/:botId', middleware.ensureLoggedIn, ownerController.getBot);
	router.put('/api/owner/bots/:botId', middleware.ensureLoggedIn, ownerController.updateBot);
	router.delete('/api/owner/bots/:botId', middleware.ensureLoggedIn, ownerController.deleteBot);
	router.post('/api/owner/bots/:botId/key', middleware.ensureLoggedIn, ownerController.resetApiKey);
	router.delete('/api/owner/bots/:botId/key', middleware.ensureLoggedIn, ownerController.revokeApiKey);
	router.get('/api/owner/bots/:botId/stats', middleware.ensureLoggedIn, ownerController.getBotStats);

	// ── Admin API ─────────────────────────────────────────────────
	router.get('/api/admin/bots', requireAdmin, adminController.listBots);
	router.put('/api/admin/bots/:botId/level', requireAdmin, adminController.setLevel);
	router.post('/api/admin/bots/:botId/ban', requireAdmin, adminController.banBot);
	router.post('/api/admin/bots/:botId/unban', requireAdmin, adminController.unbanBot);
	router.get('/api/admin/violations', requireAdmin, adminController.listViolations);
	router.put('/api/admin/rules', requireAdmin, adminController.publishRules);
	router.get('/api/admin/leaderboard', requireAdmin, adminController.getLeaderboard);
	router.get('/api/admin/sensitive-words', requireAdmin, adminController.listSensitiveWords);
	router.post('/api/admin/sensitive-words', requireAdmin, adminController.addSensitiveWord);
	router.delete('/api/admin/sensitive-words/:word', requireAdmin, adminController.removeSensitiveWord);

	// ── Public leaderboard ────────────────────────────────────────
	const xp = require('./lib/xp');
	router.get('/api/leaderboard/bots', async (req, res) => {
		try {
			const { type = 'all', start = 0, stop = 9 } = req.query;
			const entries = await xp.getLeaderboard({ type, start: parseInt(start), stop: parseInt(stop) });
			res.json({ status: { code: 'ok' }, response: { leaderboard: entries } });
		} catch (e) {
			res.status(500).json({ status: { code: 'internal-error', message: e.message } });
		}
	});
};
