'use strict';

const chatProxy = require('../lib/chat-proxy');

const Controller = module.exports;

Controller.listChats = async function (req, res) {
	try {
		const { botId } = req.params;
		const bot = await chatProxy.verifyOwnership(req.uid, botId);

		const chats = await chatProxy.listBotChats(bot);
		res.json({ success: true, chats });
	} catch (err) {
		const status = err.message === 'FORBIDDEN' ? 403 : 500;
		res.status(status).json({ error: err.message });
	}
};

Controller.getChatMessages = async function (req, res) {
	try {
		const { botId, roomId } = req.params;
		const bot = await chatProxy.verifyOwnership(req.uid, botId);

		const start = parseInt(req.query.start, 10) || 0;
		const count = parseInt(req.query.count, 10) || 50;

		const messages = await chatProxy.getChatMessages({ bot, roomId, start, count });
		res.json({ success: true, messages });
	} catch (err) {
		const status = mapProxyError(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.exportChat = async function (req, res) {
	try {
		const { botId, roomId } = req.params;
		const bot = await chatProxy.verifyOwnership(req.uid, botId);

		const format = req.query.format === 'csv' ? 'csv' : 'json';
		const result = await chatProxy.exportChat({ bot, roomId, format });

		res.setHeader('Content-Type', result.contentType);
		res.send(result.data);
	} catch (err) {
		const status = mapProxyError(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.listGroups = async function (req, res) {
	try {
		const { botId } = req.params;
		const bot = await chatProxy.verifyOwnership(req.uid, botId);

		const groups = await chatProxy.listBotGroups(bot);
		res.json({ success: true, groups });
	} catch (err) {
		const status = err.message === 'FORBIDDEN' ? 403 : 500;
		res.status(status).json({ error: err.message });
	}
};

Controller.getGroupMessages = async function (req, res) {
	try {
		const { botId, roomId } = req.params;
		const bot = await chatProxy.verifyOwnership(req.uid, botId);

		const start = parseInt(req.query.start, 10) || 0;
		const count = parseInt(req.query.count, 10) || 50;

		const messages = await chatProxy.getGroupMessages({ bot, roomId, start, count });
		res.json({ success: true, messages });
	} catch (err) {
		const status = mapProxyError(err.message);
		res.status(status).json({ error: err.message });
	}
};

function mapProxyError(message) {
	switch (message) {
		case 'FORBIDDEN':
			return 403;
		case 'BOT_NOT_FOUND':
		case 'ROOM_NOT_FOUND':
		case 'NOT_A_BOT_GROUP':
			return 404;
		default:
			return 500;
	}
}
