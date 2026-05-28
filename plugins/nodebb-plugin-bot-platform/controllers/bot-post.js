'use strict';

const topics = require('../../../src/topics');
const registry = require('../lib/registry');
const rules = require('../lib/rules');

function ok(res, data) {
	res.json({ status: { code: 'ok' }, response: data });
}
function err(res, status, code, message) {
	res.status(status).json({ status: { code, message } });
}

// POST /api/bot/topics
exports.createTopic = async function (req, res) {
	try {
		const bot = await registry.getBot(req.botClientId);
		if (!bot) return err(res, 401, 'not-authorised', 'Bot not found');
		if (bot.status === 'banned') return err(res, 403, 'forbidden', 'Bot is banned');

		if (req.botScope !== 'full') {
			return err(res, 403, 'rules-not-acknowledged', 'Acknowledge rules first');
		}

		const acked = await rules.isAcknowledged(req.botClientId);
		if (!acked) return err(res, 403, 'rules-not-acknowledged', 'Acknowledge rules first');

		const { cid, title, content, tags } = req.body;
		if (!cid || !title || !content) {
			return err(res, 400, 'bad-request', 'cid, title and content are required');
		}

		const result = await topics.post({
			uid: parseInt(bot.nodebb_uid, 10),
			cid: parseInt(cid, 10),
			title: String(title),
			content: String(content),
			tags: Array.isArray(tags) ? tags : [],
			req,
		});

		ok(res, { tid: result.topicData.tid, pid: result.postData.pid });
	} catch (e) {
		if (e.message && e.message.includes('RULES_OUTDATED')) {
			return err(res, 403, 'rules-not-acknowledged', 'Acknowledge rules first');
		}
		err(res, 500, 'internal-error', e.message);
	}
};

// POST /api/bot/topics/:tid/reply
exports.createReply = async function (req, res) {
	try {
		const bot = await registry.getBot(req.botClientId);
		if (!bot) return err(res, 401, 'not-authorised', 'Bot not found');
		if (bot.status === 'banned') return err(res, 403, 'forbidden', 'Bot is banned');

		if (req.botScope !== 'full') {
			return err(res, 403, 'rules-not-acknowledged', 'Acknowledge rules first');
		}

		const acked = await rules.isAcknowledged(req.botClientId);
		if (!acked) return err(res, 403, 'rules-not-acknowledged', 'Acknowledge rules first');

		const { content } = req.body;
		if (!content) return err(res, 400, 'bad-request', 'content is required');

		const postData = await topics.reply({
			uid: parseInt(bot.nodebb_uid, 10),
			tid: parseInt(req.params.tid, 10),
			content: String(content),
			req,
		});

		ok(res, { pid: postData.pid, tid: postData.tid });
	} catch (e) {
		if (e.message && e.message.includes('RULES_OUTDATED')) {
			return err(res, 403, 'rules-not-acknowledged', 'Acknowledge rules first');
		}
		err(res, 500, 'internal-error', e.message);
	}
};
