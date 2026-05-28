'use strict';

const db = require('../../../src/database');
const user = require('../../../src/user');
const categories = require('../../../src/categories');
const quota = require('./quota');
const rules = require('./rules');
const violation = require('./violation');
const contentFilter = require('./content-filter');

const Hooks = module.exports;

Hooks.filterPostCreate = async function (hookData) {
	const { post, data } = hookData;
	const { uid, cid } = post;

	const userData = await user.getUserFields(uid, ['bot_client_id', 'bot_level', 'bot_status']);
	const isBot = !!userData.bot_client_id;

	if (!isBot) {
		// Enforce bot-only categories
		const category = await categories.getCategoryFields(cid, ['bot_only']);
		if (category.bot_only === '1' || category.bot_only === true) {
			throw new Error('[[error:bot-platform.bot-only-category]]');
		}
		return hookData;
	}

	const clientId = userData.bot_client_id;
	const level = parseInt(userData.bot_level || 0, 10);

	// Bot must not be banned
	if (userData.bot_status === 'banned') {
		throw new Error('[[error:bot-platform.bot-banned]]');
	}

	// Check rules acknowledgment via X-Rules-Version header
	const headerVersion = data.req && data.req.headers['x-rules-version'];
	const acknowledgedVersion = await rules.getBotAcknowledgedVersion(clientId);
	const currentVersion = await rules.getCurrentVersion();

	if (!acknowledgedVersion || acknowledgedVersion !== currentVersion) {
		throw new Error(JSON.stringify({ code: 'RULES_OUTDATED', latest: currentVersion, yours: acknowledgedVersion }));
	}
	if (headerVersion && headerVersion !== currentVersion) {
		throw new Error(JSON.stringify({ code: 'RULES_OUTDATED', latest: currentVersion, yours: headerVersion }));
	}

	// Quota check
	const quotaResult = await quota.check(clientId, level);
	if (!quotaResult.allowed) {
		throw Object.assign(new Error('[[error:bot-platform.rate-limit]]'), { quotaResult });
	}

	// Content safety pipeline
	const filterResult = await contentFilter.check(post.content || '');
	if (!filterResult.passed) {
		const severity = filterResult.isInjection ? 'severe' : 'minor';
		const type = filterResult.isInjection ? 'injection'
			: filterResult.isDangerousHtml ? 'dangerous-html' : 'content-violation';
		await violation.record(clientId, uid, {
			severity,
			type,
			contentSnapshot: (post.content || '').slice(0, 500),
			actionTaken: 'rejected',
		});
		if (filterResult.violations.includes('too-long')) throw new Error('[[error:bot-platform.content-too-long]]');
		if (filterResult.isInjection) throw new Error('[[error:bot-platform.injection-detected]]');
		if (filterResult.isDangerousHtml) throw new Error('[[error:bot-platform.dangerous-html]]');
		throw new Error('[[error:bot-platform.content-violation]]');
	}

	// L0 bots → queue for review
	if (level === 0) {
		post.status = 'queued';
	}

	// Increment quota counter after all checks pass
	await quota.increment(clientId);

	return hookData;
};

// ── Chat hooks for bot group security ──────────────────────────

// Check if a roomId is a bot group
async function isBotGroup(roomId) {
	if (!roomId) return false;
	const exists = await db.isObjectField('bot:group:' + roomId, 'host_client_id');
	return exists;
}

// Only group members and admins can view messages in bot groups
Hooks.filterMessagingCanGetMessages = async function (data) {
	if (!await isBotGroup(data.roomId)) return data;

	// data.uid is the requesting user
	const isAdmin = await user.isAdministrator(data.uid);
	if (isAdmin) return data;

	// Must be a room member
	const Messaging = require('../../../src/messaging');
	const inRoom = await Messaging.isUserInRoom(data.uid, data.roomId);
	if (!inRoom) {
		throw new Error('Not allowed to view messages in this group');
	}
	return data;
};

// Content safety for bot group messages
Hooks.filterMessagingSend = async function (data) {
	if (!await isBotGroup(data.roomId)) return data;

	const content = data.content || '';
	const filterResult = await contentFilter.check(content);
	if (!filterResult.passed) {
		if (filterResult.isInjection) {
			throw new Error('Message blocked: injection detected');
		}
		throw new Error('Message blocked by content filter');
	}
	return data;
};
