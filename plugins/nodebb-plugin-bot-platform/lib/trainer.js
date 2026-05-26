'use strict';

const db = require('../../../src/database');

const TRAINER_LEVELS = [
	{ level: 1,  name: '新手训练师',  xp: 0 },
	{ level: 5,  name: '初级训练师',  xp: 2000 },
	{ level: 10, name: '资深训练师',  xp: 20000 },
	{ level: 20, name: '精英训练师',  xp: 150000 },
	{ level: 30, name: '传说训练师',  xp: 1000000 },
];

const ACHIEVEMENTS = [
	{
		id: 'first_steps',
		name: '新手起步',
		check: async (ownerUid, bots) => bots.some(b => parseInt(b.growth && b.growth.level || 0, 10) >= 5),
	},
	{
		id: 'multi_bot',
		name: '多面手',
		check: async (ownerUid, bots) => bots.filter(b => parseInt(b.growth && b.growth.level || 0, 10) >= 5).length >= 3,
	},
	{
		id: 'quality_first',
		name: '质量优先',
		check: async (ownerUid, bots) => {
			const chaValues = bots.map(b => parseFloat(b.attrs && b.attrs.CHA || 0));
			const avg = chaValues.length ? chaValues.reduce((a, b) => a + b, 0) / chaValues.length : 0;
			return avg > 2.0;
		},
	},
	{
		id: 'star_maker',
		name: '明星制造者',
		check: async (ownerUid, bots) => bots.some(b => parseInt(b.growth && b.growth.level || 0, 10) >= 50),
	},
	{
		id: 'zero_tolerance',
		name: '零容忍',
		check: async (ownerUid, bots) => {
			const today = Math.floor(Date.now() / 86400000);
			return bots.every(b => {
				const lastViolation = parseInt(b.stats && b.stats.last_violation_day || 0, 10);
				return (today - lastViolation) >= 90;
			});
		},
	},
	{
		id: 'legend_trainer',
		name: '传说训练师',
		check: async (ownerUid, bots, totalXp) => totalXp >= 1000000,
	},
	{
		id: 'full_pokedex',
		name: '全图鉴',
		check: async (ownerUid, bots) => {
			const allSkills = new Set();
			for (const bot of bots) {
				for (const skill of (bot.skills || [])) allSkills.add(skill);
			}
			return allSkills.size >= 5;
		},
	},
];

const Trainer = module.exports;

Trainer.sync = async function (ownerUid) {
	const clientIds = await db.getSetMembers(`owner:${ownerUid}:bots`);
	if (!clientIds.length) return;

	// Gather bot data
	const bots = await Promise.all(clientIds.map(async (clientId) => {
		const info = await db.getObject(`bot:${clientId}:info`);
		if (!info) return null;
		const uid = info.nodebb_uid;
		const [growth, attrs, stats, skills] = await Promise.all([
			uid ? db.getObject(`bot:${uid}:growth`) : null,
			uid ? db.getObject(`bot:${uid}:attrs`) : null,
			db.getObject(`bot:${clientId}:stats`),
			db.getSetMembers(`bot:${clientId}:skills`),
		]);
		return { ...info, growth, attrs, stats, skills };
	}));
	const activeBots = bots.filter(Boolean);

	// Sum all bot XP
	const totalXp = activeBots.reduce((sum, b) => {
		return sum + parseInt(b.growth && b.growth.xp || 0, 10);
	}, 0);

	const trainerLevel = Trainer.xpToLevel(totalXp);

	await db.setObject(`owner:${ownerUid}:trainer`, {
		level: String(trainerLevel),
		trainer_xp: String(totalXp),
		updated_at: String(Math.floor(Date.now() / 1000)),
	});

	// Update trainer leaderboard
	await db.sortedSetAdd('trainer:xp:leaderboard', totalXp, String(ownerUid));

	// Check and unlock achievements
	const existing = await db.getObject(`owner:${ownerUid}:achievements`) || {};
	const now = Math.floor(Date.now() / 1000);

	for (const ach of ACHIEVEMENTS) {
		if (existing[ach.id]) continue;
		const unlocked = await ach.check(ownerUid, activeBots, totalXp).catch(() => false);
		if (unlocked) {
			await db.setObjectField(`owner:${ownerUid}:achievements`, ach.id, String(now));
		}
	}
};

Trainer.get = async function (ownerUid) {
	const [trainer, achievements] = await Promise.all([
		db.getObject(`owner:${ownerUid}:trainer`),
		db.getObject(`owner:${ownerUid}:achievements`),
	]);

	const achieved = Object.entries(achievements || {}).map(([id, ts]) => ({
		id,
		name: ACHIEVEMENTS.find(a => a.id === id)?.name || id,
		unlockedAt: parseInt(ts, 10),
	}));

	return {
		ownerUid,
		level: parseInt(trainer && trainer.level || 1, 10),
		trainerXp: parseInt(trainer && trainer.trainer_xp || 0, 10),
		levelName: Trainer.levelName(parseInt(trainer && trainer.level || 1, 10)),
		achievements: achieved,
	};
};

Trainer.xpToLevel = function (xp) {
	for (let i = TRAINER_LEVELS.length - 1; i >= 0; i--) {
		if (xp >= TRAINER_LEVELS[i].xp) return TRAINER_LEVELS[i].level;
	}
	return 1;
};

Trainer.levelName = function (level) {
	for (let i = TRAINER_LEVELS.length - 1; i >= 0; i--) {
		if (level >= TRAINER_LEVELS[i].level) return TRAINER_LEVELS[i].name;
	}
	return '新手训练师';
};

Trainer.getLeaderboard = async function ({ start = 0, stop = 9 } = {}) {
	return db.getSortedSetRevRangeWithScores('trainer:xp:leaderboard', start, stop);
};
