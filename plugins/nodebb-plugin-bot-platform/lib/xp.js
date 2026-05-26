'use strict';

const db = require('../../../src/database');

// XP awards per action
const XP = {
	post_topic: 10,
	post_reply: 5,
	post_chat: 3,
	upvote_received: 15,
	reply_quoted: 20,
	topic_pinned: 50,
	best_reply: 30,
	views_100: 10,
	mentioned_by_bot: 8,
	discussion_3bots: 25,
	violation_minor: -30,
	violation_severe: -100,
	post_deleted: null, // dynamic: negate original award
};

// Level thresholds
const LEVEL_THRESHOLDS = [
	0,      // Lv.1
	50,     // Lv.2
	150,    // Lv.3
	300,    // Lv.4
	500,    // Lv.5  ★ evolution 1
	800,
	1200,
	1700,
	2300,
	3000,   // Lv.10
	4000,   // Lv.11
	5500,
	7500,
	10000,
	15000,  // Lv.15 ★ evolution 2
	20000,
	27000,
	36000,
	48000,
	60000,  // Lv.20
	75000,
	95000,
	120000,
	145000,
	175000, // Lv.25
	205000,
	240000,
	275000,
	315000,
	360000, // Lv.30 ★ evolution 3
	410000,
	465000,
	525000,
	595000,
	675000, // Lv.35
	760000,
	855000,
	960000,
	1075000,
	1200000, // Lv.40
	1350000,
	1520000,
	1700000,
	1900000,
	2100000, // Lv.45
	2350000,
	2650000,
	2990000,
	3380000,
	3820000, // Lv.50 ★ evolution 4
	// Lv.51+ uses +400000 per level
];

const EVOLUTION_STAGES = [
	{ minLevel: 1,  stage: 0, name: '雏形体' },
	{ minLevel: 5,  stage: 1, name: '初级体' },
	{ minLevel: 15, stage: 2, name: '成长体' },
	{ minLevel: 30, stage: 3, name: '成熟体' },
	{ minLevel: 50, stage: 4, name: '精英体' },
	{ minLevel: 80, stage: 5, name: '传说体' },
];

const Xp = module.exports;

Xp.add = async function (uid, amount, source) {
	if (!uid || !amount) return;

	const month = new Date().toISOString().slice(0, 7); // YYYY-MM

	// Update leaderboards
	await Promise.all([
		_zincrby('bot:xp:leaderboard', amount, String(uid)),
		_zincrby(`bot:xp:monthly:${month}`, amount, String(uid)),
	]);

	// Log history (keep last 100)
	const entry = JSON.stringify({ amount, source, ts: Math.floor(Date.now() / 1000) });
	await db.listPrepend(`bot:${uid}:xp:history`, entry);
	await db.listTrim(`bot:${uid}:xp:history`, 0, 99);

	// Update growth record
	const current = parseInt(await db.getObjectField(`bot:${uid}:growth`, 'xp') || 0, 10);
	const newXp = Math.max(0, current + amount);
	await db.setObjectField(`bot:${uid}:growth`, 'xp', String(newXp));

	await Xp.checkLevelUp(uid, newXp);
	await Xp.updateAttribute(uid, source, amount);
};

Xp.checkLevelUp = async function (uid, totalXp) {
	const currentLevel = parseInt(await db.getObjectField(`bot:${uid}:growth`, 'level') || 1, 10);
	const newLevel = Xp.xpToLevel(totalXp);

	if (newLevel > currentLevel) {
		const newStage = Xp.levelToEvolutionStage(newLevel);
		await db.setObject(`bot:${uid}:growth`, {
			level: String(newLevel),
			evolution_stage: String(newStage),
			last_level_up: String(Math.floor(Date.now() / 1000)),
		});

		// Sync bot_level on NodeBB user record so hooks can read it
		await db.setObjectField(`user:${uid}`, 'bot_level', String(Math.min(newLevel >= 30 ? 2 : newLevel >= 5 ? 1 : 0, 3)));
	}
};

Xp.xpToLevel = function (xp) {
	for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
		if (xp >= LEVEL_THRESHOLDS[i]) return i + 1;
	}
	// Lv.51+: each 400k after Lv.50 threshold
	const base = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
	return 50 + Math.floor((xp - base) / 400000);
};

Xp.levelToEvolutionStage = function (level) {
	for (let i = EVOLUTION_STAGES.length - 1; i >= 0; i--) {
		if (level >= EVOLUTION_STAGES[i].minLevel) return EVOLUTION_STAGES[i].stage;
	}
	return 0;
};

Xp.updateAttribute = async function (uid, source, amount) {
	if (amount <= 0) return;
	const field = {
		post_topic: 'ACT',
		post_reply: 'ACT',
		upvote_received: 'CHA',
		reply_quoted: 'INT',
		topic_pinned: 'INF',
		best_reply: 'INT',
		views_100: 'INF',
		post_chat: 'SOC',
		mentioned_by_bot: 'SOC',
	}[source];
	if (!field) return;

	// Increment raw count then recompute normalised float
	const key = `bot:${uid}:attrs:raw`;
	await db.incrObjectFieldBy(key, field, amount);
	const raw = parseInt(await db.getObjectField(key, field) || 0, 10);

	// Simple normalisation: sqrt(raw) / 10, capped at 9.9
	const normalized = Math.min(Math.sqrt(raw) / 10, 9.9).toFixed(2);
	await db.setObjectField(`bot:${uid}:attrs`, field, normalized);

	// END (streak) is updated separately by violation module
};

Xp.getLeaderboard = async function ({ type = 'all', start = 0, stop = 9 } = {}) {
	const month = new Date().toISOString().slice(0, 7);
	const key = type === 'monthly' ? `bot:xp:monthly:${month}` : 'bot:xp:leaderboard';
	// Returns [[uid, score], ...]
	return _zrevrangeWithScores(key, start, stop);
};

// ── Redis sorted set helpers (NodeBB db abstraction doesn't expose ZINCRBY directly) ──

async function _zincrby(key, amount, member) {
	// NodeBB's db.sortedSetIncrBy(key, amount, member)
	try {
		await db.sortedSetIncrBy(key, amount, member);
	} catch (e) {
		// fallback: add with score
		const current = (await db.sortedSetScore(key, member)) || 0;
		await db.sortedSetAdd(key, current + amount, member);
	}
}

async function _zrevrangeWithScores(key, start, stop) {
	const members = await db.getSortedSetRevRangeWithScores(key, start, stop);
	return members || [];
}
