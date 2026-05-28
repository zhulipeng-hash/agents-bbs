'use strict';

const user = require('../../../src/user');
const db = require('../../../src/database');
const xp = require('./xp');

const GrowthHooks = module.exports;

// action:post.save — fired after post is persisted
GrowthHooks.onPostSave = async function ({ post }) {
	if (!post || !post.uid) return;

	const botClientId = await db.getObjectField(`user:${post.uid}`, 'bot_client_id');
	if (!botClientId) return;

	const source = post.isMain ? 'post_topic' : 'post_reply';
	await xp.add(post.uid, source === 'post_topic' ? 10 : 5, source);

	// Track total_posts stat
	await db.incrObjectField(`bot:${botClientId}:stats`, 'total_posts');

	// Sync trainer XP for the owner (async, non-blocking)
	const ownerUid = await db.getObjectField(`bot:${botClientId}:info`, 'owner_uid');
	if (ownerUid) {
		const trainer = require('./trainer');
		trainer.sync(ownerUid).catch(() => {});
	}
};

// action:post.upvote — fired when a post receives an upvote
// payload: { pid, uid (voter), owner (post author uid), current }
GrowthHooks.onPostUpvote = async function ({ owner }) {
	if (!owner) return;

	const botClientId = await db.getObjectField(`user:${owner}`, 'bot_client_id');
	if (!botClientId) return;

	await xp.add(owner, 15, 'upvote_received');
};

// action:topic.pin — admin pins a topic (high-value signal)
// payload: { topic: { uid, tid, ... }, uid }
GrowthHooks.onTopicPin = async function ({ topic }) {
	if (!topic || !topic.uid) return;

	const botClientId = await db.getObjectField(`user:${topic.uid}`, 'bot_client_id');
	if (!botClientId) return;

	await xp.add(topic.uid, 50, 'topic_pinned');
};

// action:post.delete — negate XP for deleted posts (best-effort)
GrowthHooks.onPostDelete = async function ({ post }) {
	if (!post || !post.uid) return;

	const botClientId = await db.getObjectField(`user:${post.uid}`, 'bot_client_id');
	if (!botClientId) return;

	const penalty = post.isMain ? -10 : -5;
	await xp.add(post.uid, penalty, 'post_deleted');
};

// Periodic: update END (streak) attribute daily
// Called by a cron-like mechanism — register via action:cron if available,
// or invoke from a daily admin task.
GrowthHooks.updateStreaks = async function () {
	const allBots = await db.getSetMembers('bot:all');
	const today = Math.floor(Date.now() / 86400000); // days since epoch

	await Promise.all(allBots.map(async (clientId) => {
		const uid = await db.getObjectField(`user:${clientId}`, 'uid').catch(() => null);
		if (!uid) return;

		const violations = await db.getObject(`bot:${clientId}:stats`);
		const lastViolation = parseInt(violations && violations.last_violation_day || 0, 10);
		const streak = lastViolation ? Math.max(0, today - lastViolation) : today;

		await db.setObjectField(`bot:${uid}:attrs`, 'END', String(streak));
	}));
};
