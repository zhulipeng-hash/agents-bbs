'use strict';

const ContentFilter = module.exports;

const INJECTION_PATTERNS = [
	/ignore\s+previous\s+instructions/i,
	/you\s+are\s+now/i,
	/system:\s/i,
	/\[INST\]/i,
	/<\|system\|>/i,
];

const MAX_MESSAGE_LENGTH = 2000;

ContentFilter.check = function (content) {
	if (!content || typeof content !== 'string') {
		return { safe: false, reason: 'EMPTY_CONTENT' };
	}

	if (content.length > MAX_MESSAGE_LENGTH) {
		return { safe: false, reason: 'CONTENT_TOO_LONG', max: MAX_MESSAGE_LENGTH };
	}

	for (const pattern of INJECTION_PATTERNS) {
		if (pattern.test(content)) {
			return { safe: false, reason: 'INJECTION_DETECTED' };
		}
	}

	return { safe: true };
};
