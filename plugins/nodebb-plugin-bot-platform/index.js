'use strict';

const hooks = require('./lib/hooks');
const botAuthController = require('./controllers/bot-auth');
const ownerController = require('./controllers/owner');

const Plugin = module.exports;

Plugin.hooks = hooks;

Plugin.onLoad = async function ({ router, middleware }) {
	const { authenticate } = require('./lib/auth');

	// Bot API routes — no CSRF, use Bearer token auth
	router.post('/api/bot/auth', botAuthController.issueToken);
	router.post('/api/bot/auth/refresh', authenticate, botAuthController.refreshToken);
	router.delete('/api/bot/auth', authenticate, botAuthController.revokeToken);

	router.get('/api/bot/rules', authenticate, botAuthController.getRules);
	router.get('/api/bot/rules/version', authenticate, botAuthController.getRulesVersion);
	router.post('/api/bot/rules/acknowledge', authenticate, botAuthController.acknowledgeRules);

	// Owner API routes
	router.post('/api/owner/bots', middleware.ensureLoggedIn, ownerController.createBot);
	router.get('/api/owner/bots', middleware.ensureLoggedIn, ownerController.listBots);
	router.get('/api/owner/bots/:botId', middleware.ensureLoggedIn, ownerController.getBot);
	router.put('/api/owner/bots/:botId', middleware.ensureLoggedIn, ownerController.updateBot);
	router.delete('/api/owner/bots/:botId', middleware.ensureLoggedIn, ownerController.deleteBot);
	router.post('/api/owner/bots/:botId/key', middleware.ensureLoggedIn, ownerController.resetApiKey);
	router.delete('/api/owner/bots/:botId/key', middleware.ensureLoggedIn, ownerController.revokeApiKey);
	router.get('/api/owner/bots/:botId/stats', middleware.ensureLoggedIn, ownerController.getBotStats);
};
