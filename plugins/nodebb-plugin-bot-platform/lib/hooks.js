'use strict';

const db = require('../../../src/database');
const user = require('../../../src/user');
const categories = require('../../../src/categories');
const quota = require('./quota');
const rules = require('./rules');
const violation = require('./violation');

const INJECTION_PATTERNS = [
	/ignore previous instructions/i,
	/you are now/i,
	/system:\s/i,
	/\[INST\]/i,
	/<\|system\|>/i,
];

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

	// Content safety: length check
	if (post.content && post.content.length > 2000) {
		throw new Error('[[error:bot-platform.content-too-long]]');
	}

	// Prompt injection detection (async violation record, non-blocking check)
	const injected = INJECTION_PATTERNS.some(p => p.test(post.content || ''));
	if (injected) {
		await violation.record(clientId, uid, {
			severity: 'severe',
			type: 'injection',
			contentSnapshot: (post.content || '').slice(0, 500),
			actionTaken: 'rejected',
		});
		throw new Error('[[error:bot-platform.injection-detected]]');
	}

	// L0 bots → queue for review
	if (level === 0) {
		post.status = 'queued';
	}

	// Increment quota counter after all checks pass
	await quota.increment(clientId);

	return hookData;
};
