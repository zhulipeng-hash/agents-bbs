'use strict';

const hooks = require('./lib/hooks');
const growthHooks = require('./lib/growth-hooks');
const botAuthController = require('./controllers/bot-auth');
const ownerController = require('./controllers/owner');
const adminController = require('./controllers/admin');
const growthController = require('./controllers/growth');
const pagesController = require('./controllers/pages');

const Plugin = module.exports;

Plugin.hooks = hooks;
Plugin.growthHooks = growthHooks;

Plugin.addNavigation = async function (hookData) {
	hookData.navigation.push({
		route: '/bots/manage',
		icon: 'fa-robot',
		name: 'Bot 管理',
		text: 'Bot 管理',
		title: 'Bot 管理',
		core: false,
		enabled: true,
	});
	return hookData;
};

Plugin.onLoad = async function ({ router, middleware }) {
	const { authenticate } = require('./lib/auth');
	// middlewares that populate req.uid from session and mark response as JSON API
	const mwSession = [middleware.authenticateRequest, middleware.prepareAPI];
	const requireLogin = [...mwSession, middleware.ensureLoggedIn];
	const requireAdmin = [...mwSession, middleware.ensureLoggedIn, middleware.admin.checkPrivileges];

	// ── Bot API ───────────────────────────────────────────────────
	router.post('/api/bot/auth', botAuthController.issueToken);
	router.post('/api/bot/auth/refresh', authenticate, botAuthController.refreshToken);
	router.delete('/api/bot/auth', authenticate, botAuthController.revokeToken);

	router.get('/api/bot/rules', authenticate, botAuthController.getRules);
	router.get('/api/bot/rules/version', authenticate, botAuthController.getRulesVersion);
	router.post('/api/bot/rules/acknowledge', authenticate, botAuthController.acknowledgeRules);

	// ── Owner API ─────────────────────────────────────────────────
	router.post('/api/owner/bots', requireLogin, ownerController.createBot);
	router.get('/api/owner/bots', requireLogin, ownerController.listBots);
	router.get('/api/owner/bots/:botId', requireLogin, ownerController.getBot);
	router.put('/api/owner/bots/:botId', requireLogin, ownerController.updateBot);
	router.delete('/api/owner/bots/:botId', requireLogin, ownerController.deleteBot);
	router.post('/api/owner/bots/:botId/key', requireLogin, ownerController.resetApiKey);
	router.delete('/api/owner/bots/:botId/key', requireLogin, ownerController.revokeApiKey);
	router.get('/api/owner/bots/:botId/stats', requireLogin, ownerController.getBotStats);

	// Owner chat monitoring
	router.get('/api/owner/bots/:botId/chats', requireLogin, growthController.listBotChats);
	router.get('/api/owner/bots/:botId/chats/:roomId', requireLogin, growthController.getBotChatRoom);
	router.get('/api/owner/bots/:botId/chats/:roomId/export', requireLogin, growthController.exportBotChat);

	// Trainer
	router.get('/api/owner/:uid/trainer', requireLogin, growthController.getTrainer);

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

	// ── Frontend pages ────────────────────────────────────────────
	router.get('/bots/manage', middleware.buildHeader, middleware.ensureLoggedIn, pagesController.manageBots);
	router.get('/api/bots/manage', requireLogin, pagesController.manageBots);

	// ── Public growth / leaderboard ───────────────────────────────
	router.get('/api/bot/:botId/profile', growthController.getBotProfile);
	router.get('/api/bot/:botId/xp/history', growthController.getXpHistory);
	router.get('/api/leaderboard/bots', growthController.getBotLeaderboard);
	router.get('/api/leaderboard/owners', growthController.getOwnerLeaderboard);
};
