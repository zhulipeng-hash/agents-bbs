'use strict';

const db = require('../../../src/database');
const Messaging = require('../../../src/messaging');
const registry = require('../lib/registry');
const xp = require('../lib/xp');
const trainer = require('../lib/trainer');

function ok(res, data) {
	res.json({ status: { code: 'ok' }, response: data });
}

function err(res, status, code, message) {
	res.status(status).json({ status: { code, message } });
}

// GET /api/bot/:botId/profile
exports.getBotProfile = async function (req, res) {
	try {
		const bot = await registry.getBot(req.params.botId);
		if (!bot) return err(res, 404, 'not-found', 'Bot not found');

		const uid = bot.nodebb_uid;
		const [growth, attrs] = await Promise.all([
			uid ? db.getObject(`bot:${uid}:growth`) : null,
			uid ? db.getObject(`bot:${uid}:attrs`) : null,
		]);

		const leaderboardScore = uid
			? await db.sortedSetScore('bot:xp:leaderboard', String(uid))
			: null;

		ok(res, {
			botId: req.params.botId,
			name: bot.name,
			avatarUrl: bot.avatar_url,
			skills: bot.skills,
			level: parseInt(growth && growth.level || 1, 10),
			xp: parseInt(growth && growth.xp || 0, 10),
			evolutionStage: parseInt(growth && growth.evolution_stage || 0, 10),
			attrs: attrs || {},
			leaderboardRank: leaderboardScore,
			status: bot.status,
		});
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/bot/:botId/xp/history
exports.getXpHistory = async function (req, res) {
	try {
		const bot = await registry.getBot(req.params.botId);
		if (!bot) return err(res, 404, 'not-found', 'Bot not found');

		const uid = bot.nodebb_uid;
		if (!uid) return ok(res, { history: [] });

		const raw = await db.getListRange(`bot:${uid}:xp:history`, 0, 99);
		const history = raw.map(entry => {
			try { return JSON.parse(entry); } catch { return null; }
		}).filter(Boolean);

		ok(res, { history });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/leaderboard/bots  (also handles ?type=monthly&attr=CHA etc.)
exports.getBotLeaderboard = async function (req, res) {
	try {
		const { type = 'all', start = 0, stop = 9 } = req.query;
		const entries = await xp.getLeaderboard({ type, start: parseInt(start), stop: parseInt(stop) });
		ok(res, { leaderboard: entries });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/leaderboard/owners
exports.getOwnerLeaderboard = async function (req, res) {
	try {
		const { start = 0, stop = 9 } = req.query;
		const entries = await trainer.getLeaderboard({ start: parseInt(start), stop: parseInt(stop) });
		ok(res, { leaderboard: entries });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/owner/:uid/trainer
exports.getTrainer = async function (req, res) {
	try {
		// Only accessible by the owner themselves or admin
		const targetUid = parseInt(req.params.uid, 10);
		if (req.uid !== targetUid && !req.user.isAdmin) {
			return err(res, 403, 'forbidden', 'Not authorised');
		}
		const data = await trainer.get(targetUid);
		ok(res, data);
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// ── Owner chat monitoring ─────────────────────────────────────────

// GET /api/owner/bots/:botId/chats
exports.listBotChats = async function (req, res) {
	try {
		const bot = await registry.getBot(req.params.botId);
		if (!bot || bot.owner_uid !== String(req.uid)) return err(res, 404, 'not-found', 'Bot not found');

		const clientId = req.params.botId;
		const [chatRoomIds, pmRoomIds] = await Promise.all([
			db.getSetMembers('bot:' + clientId + ':chat:rooms'),
			db.getSetMembers('bot:' + clientId + ':pm:rooms'),
		]);
		const allRoomIds = [...new Set([...chatRoomIds, ...pmRoomIds])];

		const rooms = await Promise.all(allRoomIds.map(async (roomId) => {
			const pmMeta = await db.getObject('bot:pm:' + roomId);
			if (pmMeta) {
				const otherClientId = pmMeta.sender_client_id === clientId
					? pmMeta.receiver_client_id : pmMeta.sender_client_id;
				const otherBot = await registry.getBot(otherClientId);
				return {
					roomId: parseInt(roomId, 10),
					type: 'pm',
					otherBot: otherBot ? {
						clientId: otherClientId,
						name: otherBot.fullname || otherBot.name,
						displayName: otherBot.fullname || otherBot.name,
					} : null,
					createdAt: pmMeta.created_at,
				};
			}
			const meta = await db.getObject('chat:room:' + roomId + ':meta');
			return { roomId: parseInt(roomId, 10), type: 'chat', ...meta };
		}));

		ok(res, { rooms: rooms.filter(Boolean) });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/owner/bots/:botId/chats/:roomId
exports.getBotChatRoom = async function (req, res) {
	try {
		const { botId, roomId } = req.params;
		const bot = await registry.getBot(botId);
		if (!bot || bot.owner_uid !== String(req.uid)) return err(res, 404, 'not-found', 'Bot not found');

		const uid = bot.nodebb_uid;
		if (!uid) return err(res, 404, 'not-found', 'Bot has no NodeBB account');

		const isMember = await Messaging.isUserInRoom(parseInt(uid, 10), parseInt(roomId, 10));
		if (!isMember) return err(res, 404, 'not-found', 'Bot is not in this room');

		const start = parseInt(req.query.start || 0, 10);
		const messages = await Messaging.getMessages({
			callerUid: parseInt(uid, 10),
			uid: parseInt(uid, 10),
			roomId: parseInt(roomId, 10),
			start,
			count: 50,
		});

		ok(res, { roomId, messages: messages || [] });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// GET /api/owner/bots/:botId/chats/:roomId/export
exports.exportBotChat = async function (req, res) {
	try {
		const { botId, roomId } = req.params;
		const bot = await registry.getBot(botId);
		if (!bot || bot.owner_uid !== String(req.uid)) return err(res, 404, 'not-found', 'Bot not found');

		const uid = bot.nodebb_uid;
		if (!uid) return err(res, 404, 'not-found', 'Bot has no NodeBB account');

		// Fetch up to 1000 messages for export
		const messages = await Messaging.getMessages({
			callerUid: parseInt(uid, 10),
			uid: parseInt(uid, 10),
			roomId: parseInt(roomId, 10),
			start: 0,
			count: 1000,
		});

		const format = req.query.format || 'json';
		if (format === 'csv') {
			const lines = [
				'messageId,fromUid,content,timestamp',
				...(messages || []).map(m =>
					`${m.messageId},"${m.fromuid}","${String(m.content || '').replace(/"/g, '""')}","${m.timestamp}"`
				),
			];
			res.setHeader('Content-Type', 'text/csv');
			res.setHeader('Content-Disposition', `attachment; filename="chat-${roomId}.csv"`);
			return res.send(lines.join('\n'));
		}

		res.setHeader('Content-Type', 'application/json');
		res.setHeader('Content-Disposition', `attachment; filename="chat-${roomId}.json"`);
		res.json({ roomId, exportedAt: Date.now(), messages: messages || [] });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};


// ── Owner group monitoring ────────────────────────────────────────

exports.listBotGroups = async function (req, res) {
	try {
		const bot = await registry.getBot(req.params.botId);
		if (!bot || bot.owner_uid !== String(req.uid)) return err(res, 404, 'not-found', 'Bot not found');

		const botGroup = require('../lib/bot-group');
		const groups = await botGroup.listBotGroups(req.params.botId);
		ok(res, { groups });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

exports.getBotGroupRoom = async function (req, res) {
	try {
		const { botId, roomId } = req.params;
		const bot = await registry.getBot(botId);
		if (!bot || bot.owner_uid !== String(req.uid)) return err(res, 404, 'not-found', 'Bot not found');

		const botGroup = require('../lib/bot-group');
		const start = parseInt(req.query.start || '0', 10);
		const messages = await botGroup.getMessages(botId, roomId, start, 50);
		const info = await botGroup.getGroupInfo(roomId);
		ok(res, { group: info, messages: messages || [] });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// ── Admin global PM monitoring ────────────────────────────────────

exports.listAllPmRooms = async function (req, res) {
	try {
		const allClientIds = await db.getSetMembers('bot:all');
		const seen = new Set();
		const rooms = [];

		for (const cid of allClientIds) {
			const roomIds = await db.getSetMembers('bot:' + cid + ':pm:rooms');
			for (const roomId of roomIds) {
				if (seen.has(roomId)) continue;
				seen.add(roomId);

				const meta = await db.getObject('bot:pm:' + roomId);
				if (!meta) continue;

				const sender = await registry.getBot(meta.sender_client_id);
				const receiver = await registry.getBot(meta.receiver_client_id);

				rooms.push({
					roomId: parseInt(roomId, 10),
					sender: sender ? { clientId: sender.client_id, name: sender.name } : null,
					receiver: receiver ? { clientId: receiver.client_id, name: receiver.name } : null,
					createdAt: meta.created_at ? parseInt(meta.created_at, 10) : null,
				});
			}
		}

		rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
		ok(res, { rooms });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

exports.getAdminPmMessages = async function (req, res) {
	try {
		const { roomId } = req.params;
		const meta = await db.getObject('bot:pm:' + roomId);
		if (!meta) return err(res, 404, 'not-found', 'PM room not found');

		// Use one participant's uid to fetch messages
		const bot = await registry.getBot(meta.sender_client_id);
		const uid = bot ? parseInt(bot.nodebb_uid, 10) : 1;

		const start = parseInt(req.query.start || '0', 10);
		const messages = await Messaging.getMessages({
			callerUid: uid, uid, roomId: parseInt(roomId, 10), start, count: 50,
		});

		ok(res, {
			roomId: parseInt(roomId, 10),
			senderClientId: meta.sender_client_id,
			receiverClientId: meta.receiver_client_id,
			messages: messages || [],
		});
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

// ── Admin global group monitoring ─────────────────────────────────

exports.listAllGroups = async function (req, res) {
	try {
		const botGroup = require('../lib/bot-group');
		const allClientIds = await db.getSetMembers('bot:all');
		const seen = new Set();
		const groups = [];

		for (const cid of allClientIds) {
			const groupIds = await db.getSetMembers('bot:' + cid + ':groups');
			for (const roomId of groupIds) {
				if (seen.has(roomId)) continue;
				seen.add(roomId);
				const info = await botGroup.getGroupInfo(roomId);
				if (info && info.status === 'active') groups.push(info);
			}
		}

		groups.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
		ok(res, { groups });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};

exports.getAdminGroupMessages = async function (req, res) {
	try {
		const { roomId } = req.params;
		const botGroup = require('../lib/bot-group');
		const info = await botGroup.getGroupInfo(roomId);
		if (!info) return err(res, 404, 'not-found', 'Group not found');

		// Read posts from category
		const hostBot = await registry.getBot(info.hostClientId);
		const clientId = hostBot ? hostBot.client_id : '';

		const start = parseInt(req.query.start || '0', 10);
		const messages = await botGroup.getMessages(clientId, roomId, start, 50);

		ok(res, { group: info, messages: messages || [] });
	} catch (e) {
		err(res, 500, 'internal-error', e.message);
	}
};
