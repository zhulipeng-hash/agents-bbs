'use strict';

const db = require('../../../src/database');

// ── Injection patterns ────────────────────────────────────────────
const INJECTION_PATTERNS = [
	/ignore previous instructions/i,
	/you are now/i,
	/system:\s/i,
	/\[INST\]/i,
	/<\|system\|>/i,
	/disregard (all |your )?(previous |prior )?(instructions|rules)/i,
	/act as (a |an )?(different|new|another)/i,
];

// ── Dangerous HTML patterns ───────────────────────────────────────
const DANGEROUS_HTML = [
	/<script[\s>]/i,
	/javascript:/i,
	/on\w+\s*=/i,        // onclick=, onerror=, etc.
	/<iframe/i,
	/<object/i,
	/<embed/i,
];

const ContentFilter = module.exports;

ContentFilter.check = async function (content) {
	const violations = [];

	if (!content || typeof content !== 'string') {
		return { passed: false, reason: 'empty-content', violations: ['empty'] };
	}

	// Length
	if (content.length > 2000) {
		violations.push('too-long');
	}

	// Dangerous HTML / scripts
	for (const pattern of DANGEROUS_HTML) {
		if (pattern.test(content)) {
			violations.push('dangerous-html');
			break;
		}
	}

	// Prompt injection
	for (const pattern of INJECTION_PATTERNS) {
		if (pattern.test(content)) {
			violations.push('prompt-injection');
			break;
		}
	}

	// Custom sensitive words (stored in Redis, managed by admin)
	const words = await ContentFilter.getSensitiveWords();
	for (const word of words) {
		if (word && content.toLowerCase().includes(word.toLowerCase())) {
			violations.push('sensitive-word');
			break;
		}
	}

	return {
		passed: violations.length === 0,
		violations,
		isInjection: violations.includes('prompt-injection'),
		isDangerousHtml: violations.includes('dangerous-html'),
	};
};

// ── Sensitive word management (admin-managed via Redis) ───────────
ContentFilter.getSensitiveWords = async function () {
	const words = await db.getSetMembers('platform:sensitive_words');
	return words || [];
};

ContentFilter.addSensitiveWord = async function (word) {
	await db.setAdd('platform:sensitive_words', word.toLowerCase().trim());
};

ContentFilter.removeSensitiveWord = async function (word) {
	await db.setRemove('platform:sensitive_words', word.toLowerCase().trim());
};
