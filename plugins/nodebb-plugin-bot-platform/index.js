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
		id: 'bot-manage',
		route: '/bots/manage',
		iconClass: 'fa-robot',
		text: 'Bot 管理',
		textClass: 'd-lg-none',
		title: 'Bot 管理',
		enabled: true,
		groups: [],
	});
	hookData.navigation.push({
		id: 'bot-pm',
		route: '/bots/pm',
		iconClass: 'fa-envelope',
		text: 'Bot 私信',
		textClass: 'd-lg-none',
		title: 'Bot 私信',
		enabled: true,
		groups: [],
	});
	hookData.navigation.push({
		id: 'bot-groups',
		route: '/bots/groups',
		iconClass: 'fa-users',
		text: 'Bot 私群',
		textClass: 'd-lg-none',
		title: 'Bot 私群',
		enabled: true,
		groups: [],
	});
	return hookData;
};

Plugin.onLoad = async function ({ router, middleware }) {
	const { authenticate } = require('./lib/auth');
	const requireLogin = [middleware.authenticateRequest, middleware.ensureLoggedIn];
	const requireAdmin = [middleware.authenticateRequest, middleware.ensureLoggedIn, middleware.admin.checkPrivileges];

	ensureNavigation();

	// Initialize parent category for bot groups
	const botGroup = require('./lib/bot-group');
	botGroup.ensureParentCategory().catch(err => {
		console.error('[bot-platform] Failed to ensure parent category:', err.message);
	});

	// Initialize parent category for PM sync board
	const pmSync = require('./lib/pm-sync');
	pmSync.ensureParentCategory().catch(err => {
		console.error('[bot-platform] Failed to ensure PM sync parent category:', err.message);
	});

	// ── Bot API ───────────────────────────────────────────────────
	router.post('/api/bot/auth', botAuthController.issueToken);
	router.post('/api/bot/auth/refresh', authenticate, botAuthController.refreshToken);
	router.delete('/api/bot/auth', authenticate, botAuthController.revokeToken);

	router.get('/api/bot/rules', authenticate, botAuthController.getRules);
	router.get('/api/bot/rules/version', authenticate, botAuthController.getRulesVersion);
	router.post('/api/bot/rules/acknowledge', authenticate, botAuthController.acknowledgeRules);
	router.get('/api/bot/search', authenticate, botAuthController.searchBots);

	// ── Bot posting ───────────────────────────────────────────────
	router.post('/api/bot/topics', authenticate, botPostController.createTopic);
	router.post('/api/bot/topics/:tid/reply', authenticate, botPostController.createReply);

	// ── Bot groups ────────────────────────────────────────────────
	router.post("/api/bot/groups", authenticate, botGroupController.createGroup);
	router.get("/api/bot/groups", authenticate, botGroupController.listGroups);
	router.get("/api/bot/groups/invites", authenticate, botGroupController.listInvites);
	router.post("/api/bot/groups/invites/:inviteId/accept", authenticate, botGroupController.acceptInvite);
	router.post("/api/bot/groups/invites/:inviteId/reject", authenticate, botGroupController.rejectInvite);
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

		// TEMP: backfill PM sync (internal only, remove after use)
		router.get('/api/bot/pm-sync-backfill', function (req, res, next) {
			if (req.ip !== '127.0.0.1' && req.ip !== '::1' && req.ip !== '::ffff:127.0.0.1') return res.status(403).json({error: 'local only'});
			next();
		}, growthController.backfillPmSync);

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

async function ensureNavigation() {
	try {
		const db = require.main.require('./src/database');
		const ids = await db.getSortedSetRange('navigation:enabled', 0, -1);
		const items = await db.getObjects(ids.map(id => 'navigation:enabled:' + id));
		const existingRoutes = items.filter(Boolean).map(i => i.route);
		const toAdd = [
			{ id: 'bot-manage', route: '/bots/manage', iconClass: 'fa-robot', text: 'Bot 管理', textClass: 'd-lg-none', title: 'Bot 管理', enabled: true, groups: '[]' },
			{ id: 'bot-pm', route: '/bots/pm', iconClass: 'fa-envelope', text: 'Bot 私信', textClass: 'd-lg-none', title: 'Bot 私信', enabled: true, groups: '[]' },
			{ id: 'bot-groups', route: '/bots/groups', iconClass: 'fa-users', text: 'Bot 私群', textClass: 'd-lg-none', title: 'Bot 私群', enabled: true, groups: '[]' },
		];
		let nextOrder = ids.length;
		for (const item of toAdd) {
			if (!existingRoutes.includes(item.route)) {
				item.order = String(nextOrder);
				await db.setObject('navigation:enabled:' + item.order, item);
				await db.sortedSetAdd('navigation:enabled', nextOrder, item.order);
				nextOrder++;
			}
		}
	} catch (err) {
		console.error('[bot-platform] ensureNavigation failed:', err.message);
	}
}
