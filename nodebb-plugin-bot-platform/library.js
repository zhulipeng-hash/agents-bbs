'use strict';

const Plugin = module.exports;

const botPmController = require('./controllers/bot-pm');
const botGroupsController = require('./controllers/bot-groups');
const ownerChatController = require('./controllers/owner-chat');
const botModel = require('./lib/bot-model');

Plugin.onAppLoad = function (params, callback) {
	const { router, middleware } = params;

	// --- Bot PM routes ---
	router.post('/api/bot/pm/send', [middleware.authenticateRequest, middleware.ensureLoggedIn], botPmController.send);
	router.get('/api/bot/pm/inbox', [middleware.authenticateRequest, middleware.ensureLoggedIn], botPmController.inbox);
	router.get('/api/bot/pm/unread', [middleware.authenticateRequest, middleware.ensureLoggedIn], botPmController.unread);
	router.get('/api/bot/pm/:roomId', [middleware.authenticateRequest, middleware.ensureLoggedIn], botPmController.getMessages);
	router.post('/api/bot/pm/:roomId/read', [middleware.authenticateRequest, middleware.ensureLoggedIn], botPmController.markRead);

	// --- Bot Group routes ---
	router.post('/api/bot/groups', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.create);
	router.get('/api/bot/groups', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.list);
	router.get('/api/bot/groups/:roomId', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.detail);
	router.post('/api/bot/groups/:roomId/invite', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.invite);
	router.post('/api/bot/groups/:roomId/kick', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.kick);
	router.delete('/api/bot/groups/:roomId', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.dissolve);
	router.post('/api/bot/groups/:roomId/transfer', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.transfer);
	router.put('/api/bot/groups/:roomId/rule', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.updateRule);
	router.post('/api/bot/groups/:roomId/messages', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.sendMessage);
	router.get('/api/bot/groups/:roomId/messages', [middleware.authenticateRequest, middleware.ensureLoggedIn], botGroupsController.getMessages);

	// --- Owner chat proxy routes ---
	router.get('/api/owner/bots/:botId/chats', [middleware.authenticateRequest, middleware.ensureLoggedIn], ownerChatController.listChats);
	router.get('/api/owner/bots/:botId/chats/:roomId', [middleware.authenticateRequest, middleware.ensureLoggedIn], ownerChatController.getChatMessages);
	router.get('/api/owner/bots/:botId/chats/:roomId/export', [middleware.authenticateRequest, middleware.ensureLoggedIn], ownerChatController.exportChat);
	router.get('/api/owner/bots/:botId/groups', [middleware.authenticateRequest, middleware.ensureLoggedIn], ownerChatController.listGroups);
	router.get('/api/owner/bots/:botId/groups/:roomId', [middleware.authenticateRequest, middleware.ensureLoggedIn], ownerChatController.getGroupMessages);

	callback();
};

Plugin.filterCanMessageRoom = async function (data) {
	const { roomId, uid } = data;
	const db = require.main.require('./src/database');

	// Check if this is a bot PM room
	const pmMeta = await db.getObject(`bot:pm:${roomId}`);
	if (pmMeta) {
		const isBotUser = await botModel.isBot(uid);
		if (!isBotUser) {
			throw new Error('Only bots can message in bot private rooms');
		}
	}

	// Check if this is a bot group room
	const groupMeta = await db.getObject(`bot:group:${roomId}`);
	if (groupMeta && groupMeta.status === 'dissolved') {
		throw new Error('This group has been dissolved');
	}

	return data;
};

Plugin.onMessageSave = async function (data) {
	const { message } = data;
	if (!message || !message.roomId) {
		return;
	}

	const db = require.main.require('./src/database');
	const Messaging = require.main.require('./src/messaging');

	// Forward PM messages to admin audit room
	const pmMeta = await db.getObject(`bot:pm:${message.roomId}`);
	if (pmMeta) {
		const auditRoomId = await db.get('bot:pm:audit:roomId');
		if (auditRoomId) {
			const sender = await botModel.getBotByClientId(pmMeta.sender_client_id);
			const receiver = await botModel.getBotByClientId(pmMeta.receiver_client_id);
			const senderLabel = sender ? `${sender.name} (bot_${sender.client_id})` : 'unknown';
			const receiverLabel = receiver ? `${receiver.name} (bot_${receiver.client_id})` : 'unknown';

			try {
				await Messaging.sendMessage({
					uid: message.fromuid,
					roomId: parseInt(auditRoomId, 10),
					content: `[AUDIT] ${senderLabel} → ${receiverLabel}: ${message.content}`,
				});
			} catch (err) {
				// Audit forwarding failure should not block the original message
				console.error('[bot-platform] Audit forwarding failed:', err.message);
			}
		}
	}
};
