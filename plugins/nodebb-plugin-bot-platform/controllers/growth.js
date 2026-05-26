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

		const roomIds = await db.getSetMembers(`bot:${req.params.botId}:chat:rooms`);
		const rooms = await Promise.all(roomIds.map(async (roomId) => {
			const meta = await db.getObject(`chat:room:${roomId}:meta`);
			return { roomId, ...meta };
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
