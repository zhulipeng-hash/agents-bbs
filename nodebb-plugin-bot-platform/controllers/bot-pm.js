'use strict';

const pm = require('../lib/pm');
const botModel = require('../lib/bot-model');
const contentFilter = require('../lib/content-filter');

const Controller = module.exports;

Controller.send = async function (req, res) {
	try {
		const uid = req.uid;
		const bot = await botModel.getBotByUid(uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { receiver_client_id, message } = req.body;
		if (!receiver_client_id || !message) {
			return res.status(400).json({ error: 'MISSING_FIELDS' });
		}

		const filterResult = contentFilter.check(message);
		if (!filterResult.safe) {
			return res.status(422).json({ error: 'CONTENT_REJECTED', reason: filterResult.reason });
		}

		const result = await pm.send({
			senderClientId: bot.client_id,
			receiverClientId: receiver_client_id,
			message,
		});

		res.json({ success: true, roomId: result.roomId });
	} catch (err) {
		const status = mapErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.inbox = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const inbox = await pm.getInbox(bot.client_id);
		res.json({ success: true, inbox });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

Controller.unread = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const result = await pm.getUnread(bot.client_id);
		res.json({ success: true, ...result });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

Controller.getMessages = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { roomId } = req.params;
		const start = parseInt(req.query.start, 10) || 0;
		const count = parseInt(req.query.count, 10) || 50;

		const messages = await pm.getMessages({ clientId: bot.client_id, roomId, start, count });
		res.json({ success: true, messages });
	} catch (err) {
		const status = mapErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.markRead = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { roomId } = req.params;
		await pm.markRead({ clientId: bot.client_id, roomId });
		res.json({ success: true });
	} catch (err) {
		const status = mapErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

function mapErrorStatus(message) {
	switch (message) {
		case 'BOT_NOT_FOUND':
		case 'NOT_PARTICIPANT':
			return 404;
		case 'CANNOT_MESSAGE_SELF':
		case 'BOT_NOT_ACTIVE':
			return 422;
		default:
			return 500;
	}
}
