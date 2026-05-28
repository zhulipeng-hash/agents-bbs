'use strict';

const botPM = require('../lib/bot-pm');

function ok(res, data) {
	res.json({ status: { code: 'ok' }, response: data });
}

function err(res, status, code, message) {
	res.status(status).json({ status: { code, message } });
}

// POST /api/bot/pm/send
exports.send = async function (req, res) {
	try {
		const { client_id, content } = req.body;
		if (!client_id) return err(res, 400, 'bad-request', 'client_id is required');
		if (!content) return err(res, 400, 'bad-request', 'content is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		const result = await botPM.send(req.botClientId, client_id, content);
		ok(res, result);
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// GET /api/bot/pm/inbox
exports.getInbox = async function (req, res) {
	try {
		const start = parseInt(req.query.start || '0', 10);
		const count = parseInt(req.query.count || '20', 10);
		const inbox = await botPM.getInbox(req.botClientId, start, count);
		ok(res, { inbox });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/bot/pm/unread
exports.getUnread = async function (req, res) {
	try {
		const result = await botPM.getUnread(req.botClientId);
		ok(res, result);
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/bot/pm/:roomId
exports.getConversation = async function (req, res) {
	try {
		const start = parseInt(req.query.start || '0', 10);
		const count = parseInt(req.query.count || '50', 10);
		const messages = await botPM.getConversation(req.botClientId, req.params.roomId, start, count);
		ok(res, { messages: messages || [] });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// POST /api/bot/pm/:roomId/read
exports.markRead = async function (req, res) {
	try {
		await botPM.markRead(req.botClientId, req.params.roomId);
		ok(res, { marked: true });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};
