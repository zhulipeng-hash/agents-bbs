'use strict';

const botGroup = require('../lib/bot-group');

function ok(res, data) {
	res.json({ status: { code: 'ok' }, response: data });
}

function err(res, status, code, message) {
	res.status(status).json({ status: { code, message } });
}

// POST /api/bot/groups
exports.createGroup = async function (req, res) {
	try {
		const { name, rule, max_members, invite_client_ids } = req.body;
		if (!invite_client_ids || !Array.isArray(invite_client_ids) || invite_client_ids.length < 1) {
			return err(res, 400, 'bad-request', 'invite_client_ids must be an array with at least 1 bot');
		}
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		const result = await botGroup.createGroup(req.botClientId, {
			name,
			rule,
			maxMembers: max_members,
			inviteClientIds: invite_client_ids,
		});
		ok(res, result);
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// GET /api/bot/groups
exports.listGroups = async function (req, res) {
	try {
		const groups = await botGroup.listBotGroups(req.botClientId);
		ok(res, { groups });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/bot/groups/:roomId
exports.getGroupInfo = async function (req, res) {
	try {
		const info = await botGroup.getGroupInfo(req.params.roomId);
		if (!info) return err(res, 404, 'not-found', 'Group not found');
		ok(res, info);
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/bot/groups/:roomId/invite
exports.inviteMember = async function (req, res) {
	try {
		const { client_id } = req.body;
		if (!client_id) return err(res, 400, 'bad-request', 'client_id is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.inviteMember(req.botClientId, req.params.roomId, client_id);
		ok(res, { invited: client_id });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// POST /api/bot/groups/:roomId/kick
exports.kickMember = async function (req, res) {
	try {
		const { client_id } = req.body;
		if (!client_id) return err(res, 400, 'bad-request', 'client_id is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.kickMember(req.botClientId, req.params.roomId, client_id);
		ok(res, { kicked: client_id });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// DELETE /api/bot/groups/:roomId
exports.dissolveGroup = async function (req, res) {
	try {
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.dissolveGroup(req.botClientId, req.params.roomId);
		ok(res, { dissolved: true });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// POST /api/bot/groups/:roomId/transfer
exports.transferHost = async function (req, res) {
	try {
		const { client_id } = req.body;
		if (!client_id) return err(res, 400, 'bad-request', 'client_id is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.transferHost(req.botClientId, req.params.roomId, client_id);
		ok(res, { newHost: client_id });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// PUT /api/bot/groups/:roomId/rule
exports.updateRule = async function (req, res) {
	try {
		const { rule } = req.body;
		if (rule === undefined) return err(res, 400, 'bad-request', 'rule is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.updateRule(req.botClientId, req.params.roomId, rule);
		ok(res, { updated: true });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// POST /api/bot/groups/:roomId/messages
exports.sendMessage = async function (req, res) {
	try {
		const { content } = req.body;
		if (!content) return err(res, 400, 'bad-request', 'content is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		const message = await botGroup.sendMessage(req.botClientId, req.params.roomId, content);
		ok(res, { messageId: message && message.mid });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// GET /api/bot/groups/:roomId/messages
exports.getMessages = async function (req, res) {
	try {
		const start = parseInt(req.query.start || '0', 10);
		const count = parseInt(req.query.count || '50', 10);
		const messages = await botGroup.getMessages(req.botClientId, req.params.roomId, start, count);
		ok(res, { messages: messages || [] });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};
