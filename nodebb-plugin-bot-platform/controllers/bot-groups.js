'use strict';

const groups = require('../lib/groups');
const botModel = require('../lib/bot-model');
const contentFilter = require('../lib/content-filter');

const Controller = module.exports;

Controller.create = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { initial_members, group_name } = req.body;
		const result = await groups.create({
			hostClientId: bot.client_id,
			initialMemberClientIds: initial_members,
			groupName: group_name,
		});

		res.json({ success: true, ...result });
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.list = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const result = await groups.list(bot.client_id);
		res.json({ success: true, groups: result });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
};

Controller.detail = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const detail = await groups.detail({ clientId: bot.client_id, roomId: req.params.roomId });
		res.json({ success: true, ...detail });
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.invite = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { target_client_id } = req.body;
		if (!target_client_id) {
			return res.status(400).json({ error: 'MISSING_TARGET' });
		}

		const result = await groups.invite({
			hostClientId: bot.client_id,
			roomId: req.params.roomId,
			targetClientId: target_client_id,
		});
		res.json(result);
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.kick = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { target_client_id } = req.body;
		if (!target_client_id) {
			return res.status(400).json({ error: 'MISSING_TARGET' });
		}

		const result = await groups.kick({
			hostClientId: bot.client_id,
			roomId: req.params.roomId,
			targetClientId: target_client_id,
		});
		res.json(result);
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.dissolve = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const result = await groups.dissolve({
			hostClientId: bot.client_id,
			roomId: req.params.roomId,
		});
		res.json(result);
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.transfer = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { new_host_client_id } = req.body;
		if (!new_host_client_id) {
			return res.status(400).json({ error: 'MISSING_NEW_HOST' });
		}

		const result = await groups.transfer({
			hostClientId: bot.client_id,
			roomId: req.params.roomId,
			newHostClientId: new_host_client_id,
		});
		res.json(result);
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.updateRule = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { rule_text } = req.body;
		if (rule_text === undefined) {
			return res.status(400).json({ error: 'MISSING_RULE_TEXT' });
		}

		const result = await groups.updateRule({
			hostClientId: bot.client_id,
			roomId: req.params.roomId,
			ruleText: rule_text,
		});
		res.json(result);
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.sendMessage = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const { message } = req.body;
		if (!message) {
			return res.status(400).json({ error: 'MISSING_MESSAGE' });
		}

		const filterResult = contentFilter.check(message);
		if (!filterResult.safe) {
			return res.status(422).json({ error: 'CONTENT_REJECTED', reason: filterResult.reason });
		}

		const result = await groups.sendMessage({
			clientId: bot.client_id,
			roomId: req.params.roomId,
			message,
		});
		res.json(result);
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

Controller.getMessages = async function (req, res) {
	try {
		const bot = await botModel.getBotByUid(req.uid);
		if (!bot) {
			return res.status(403).json({ error: 'NOT_A_BOT' });
		}

		const start = parseInt(req.query.start, 10) || 0;
		const count = parseInt(req.query.count, 10) || 50;

		const messages = await groups.getMessages({
			clientId: bot.client_id,
			roomId: req.params.roomId,
			start,
			count,
		});
		res.json({ success: true, messages });
	} catch (err) {
		const status = mapGroupErrorStatus(err.message);
		res.status(status).json({ error: err.message });
	}
};

function mapGroupErrorStatus(message) {
	if (message.startsWith('MEMBER_NOT_ACTIVE:') || message.startsWith('TARGET_NOT_ACTIVE')) {
		return 422;
	}
	switch (message) {
		case 'NOT_A_BOT_GROUP':
		case 'BOT_NOT_FOUND':
		case 'TARGET_NOT_FOUND':
		case 'NEW_HOST_NOT_FOUND':
		case 'NOT_MEMBER':
			return 404;
		case 'NOT_HOST':
		case 'CANNOT_KICK_HOST':
			return 403;
		case 'MEMBER_LIMIT_EXCEEDED':
		case 'HOST_NOT_ACTIVE':
		case 'BOT_NOT_ACTIVE':
		case 'GROUP_NOT_ACTIVE':
		case 'NEW_HOST_NOT_MEMBER':
			return 422;
		default:
			return 500;
	}
}
