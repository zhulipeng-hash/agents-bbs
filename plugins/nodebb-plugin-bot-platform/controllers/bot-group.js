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

// GET /api/bot/groups/:cid
exports.getGroupInfo = async function (req, res) {
	try {
		const info = await botGroup.getGroupInfo(req.params.cid);
		if (!info) return err(res, 404, 'not-found', 'Group not found');
		ok(res, info);
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/bot/groups/:cid/invite
exports.inviteMember = async function (req, res) {
	try {
		const { client_id } = req.body;
		if (!client_id) return err(res, 400, 'bad-request', 'client_id is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		const result = await botGroup.sendInvite(req.botClientId, req.params.cid, client_id);
		ok(res, { invited: client_id, inviteId: result.inviteId });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// POST /api/bot/groups/:cid/kick
exports.kickMember = async function (req, res) {
	try {
		const { client_id } = req.body;
		if (!client_id) return err(res, 400, 'bad-request', 'client_id is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.kickMember(req.botClientId, req.params.cid, client_id);
		ok(res, { kicked: client_id });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// DELETE /api/bot/groups/:cid
exports.dissolveGroup = async function (req, res) {
	try {
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.dissolveGroup(req.botClientId, req.params.cid);
		ok(res, { dissolved: true });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// POST /api/bot/groups/:cid/transfer
exports.transferAdmin = async function (req, res) {
	try {
		const { client_id } = req.body;
		if (!client_id) return err(res, 400, 'bad-request', 'client_id is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.transferAdmin(req.botClientId, req.params.cid, client_id);
		ok(res, { newAdmin: client_id });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// PUT /api/bot/groups/:cid/rule
exports.updateRule = async function (req, res) {
	try {
		const { rule } = req.body;
		if (rule === undefined) return err(res, 400, 'bad-request', 'rule is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		await botGroup.updateRule(req.botClientId, req.params.cid, rule);
		ok(res, { updated: true });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// POST /api/bot/groups/:cid/messages
exports.sendMessage = async function (req, res) {
	try {
		const { content } = req.body;
		if (!content) return err(res, 400, 'bad-request', 'content is required');
		if (req.botScope !== 'full') {
			return err(res, 403, 'forbidden', 'Token scope must be full');
		}
		const message = await botGroup.sendMessage(req.botClientId, req.params.cid, content);
		ok(res, { postId: message && message.postId });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// GET /api/bot/groups/:cid/messages
exports.getMessages = async function (req, res) {
	try {
		const start = parseInt(req.query.start || '0', 10);
		const count = parseInt(req.query.count || '50', 10);
		const messages = await botGroup.getMessages(req.botClientId, req.params.cid, start, count);
		ok(res, { messages: messages || [] });
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// GET /api/bot/groups/invites
exports.listInvites = async function (req, res) {
	try {
		const invites = await botGroup.listPendingInvites(req.botClientId);
		ok(res, { invites });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/bot/groups/invites/:inviteId/accept
exports.acceptInvite = async function (req, res) {
	try {
		const result = await botGroup.acceptInvite(req.botClientId, req.params.inviteId);
		ok(res, result);
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};

// POST /api/bot/groups/invites/:inviteId/reject
exports.rejectInvite = async function (req, res) {
	try {
		const result = await botGroup.rejectInvite(req.botClientId, req.params.inviteId);
		ok(res, result);
	} catch (e) {
		err(res, 400, 'bad-request', e.message);
	}
};
