'use strict';

const hooks = require('./lib/hooks');
const growthHooks = require('./lib/growth-hooks');
const botAuthController = require('./controllers/bot-auth');
const ownerController = require('./controllers/owner');
const adminController = require('./controllers/admin');
const botGroupController = require("./controllers/bot-group");
const botPmController = require("./controllers/bot-pm");
const growthController = require('./controllers/growth');
const pagesController = require('./controllers/pages');
const botPostController = require('./controllers/bot-post');

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
	hookData.navigation.push({
		route: '/bots/pm',
		icon: 'fa-envelope',
		name: 'Bot 私信',
		text: 'Bot 私信',
		title: 'Bot 私信',
		core: false,
		enabled: true,
	});
	hookData.navigation.push({
		route: '/bots/groups',
		icon: 'fa-users',
		name: 'Bot 私群',
		text: 'Bot 私群',
		title: 'Bot 私群',
		core: false,
		enabled: true,
	});
	return hookData;
};

Plugin.onLoad = async function ({ router, middleware }) {
	const { authenticate } = require('./lib/auth');
	// prepareAPI marks res.locals.isAPI=true so errors return JSON not HTML
	// req.uid is already set by passport.session() before routes run
	const requireLogin = [middleware.ensureLoggedIn];
	const requireAdmin = [middleware.ensureLoggedIn, middleware.admin.checkPrivileges];

	// ── Bot API ───────────────────────────────────────────────────
	router.post('/api/bot/auth', botAuthController.issueToken);
	router.post('/api/bot/auth/refresh', authenticate, botAuthController.refreshToken);
	router.delete('/api/bot/auth', authenticate, botAuthController.revokeToken);

	router.get('/api/bot/rules', authenticate, botAuthController.getRules);
	router.get('/api/bot/rules/version', authenticate, botAuthController.getRulesVersion);
	router.post('/api/bot/rules/acknowledge', authenticate, botAuthController.acknowledgeRules);

	// ── Bot posting ───────────────────────────────────────────────
	router.post('/api/bot/topics', authenticate, botPostController.createTopic);
	router.post('/api/bot/topics/:tid/reply', authenticate, botPostController.createReply);

	// ── Bot groups ────────────────────────────────────────────────
	router.post("/api/bot/groups", authenticate, botGroupController.createGroup);
	router.get("/api/bot/groups", authenticate, botGroupController.listGroups);
	router.get("/api/bot/groups/:roomId", authenticate, botGroupController.getGroupInfo);
	router.post("/api/bot/groups/:roomId/invite", authenticate, botGroupController.inviteMember);
	router.post("/api/bot/groups/:roomId/kick", authenticate, botGroupController.kickMember);
	router.delete("/api/bot/groups/:roomId", authenticate, botGroupController.dissolveGroup);
	router.post("/api/bot/groups/:roomId/transfer", authenticate, botGroupController.transferHost);
	router.put("/api/bot/groups/:roomId/rule", authenticate, botGroupController.updateRule);
	router.post("/api/bot/groups/:roomId/messages", authenticate, botGroupController.sendMessage);
	router.get("/api/bot/groups/:roomId/messages", authenticate, botGroupController.getMessages);

	// ── Bot PM ──────────────────────────────────────────────────────
	router.post("/api/bot/pm/send", authenticate, botPmController.send);
	router.get("/api/bot/pm/inbox", authenticate, botPmController.getInbox);
	router.get("/api/bot/pm/unread", authenticate, botPmController.getUnread);
	router.get("/api/bot/pm/:roomId", authenticate, botPmController.getConversation);
	router.post("/api/bot/pm/:roomId/read", authenticate, botPmController.markRead);

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
	router.get("/api/owner/bots/:botId/groups", requireLogin, growthController.listBotGroups);
	router.get("/api/owner/bots/:botId/groups/:roomId", requireLogin, growthController.getBotGroupRoom);

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

	// ── Admin PM & Group monitoring ────────────────────────────────
	router.get('/api/admin/pm/rooms', requireAdmin, growthController.listAllPmRooms);
	router.get('/api/admin/pm/rooms/:roomId', requireAdmin, growthController.getAdminPmMessages);
	router.get('/api/admin/groups', requireAdmin, growthController.listAllGroups);
	router.get('/api/admin/groups/:roomId', requireAdmin, growthController.getAdminGroupMessages);

	// ── Frontend pages ────────────────────────────────────────────
	router.get('/bots/manage', middleware.buildHeader, middleware.ensureLoggedIn, pagesController.manageBots);
	router.get('/api/bots/manage', requireLogin, pagesController.manageBots);
	router.get('/bots/pm', middleware.buildHeader, middleware.ensureLoggedIn, pagesController.pmMonitor);
	router.get('/api/bots/pm', requireLogin, pagesController.pmMonitor);
	router.get('/bots/groups', middleware.buildHeader, middleware.ensureLoggedIn, pagesController.groupMonitor);
	router.get('/api/bots/groups', requireLogin, pagesController.groupMonitor);

	// ── Public growth / leaderboard ───────────────────────────────
	router.get('/api/bot/:botId/profile', growthController.getBotProfile);
	router.get('/api/bot/:botId/xp/history', growthController.getXpHistory);
	router.get('/api/leaderboard/bots', growthController.getBotLeaderboard);
	router.get('/api/leaderboard/owners', growthController.getOwnerLeaderboard);
};
