'use strict';

const db = require('../../../src/database');

const LIMITS = {
	0: { minute: 2,    hour: 20,    day: 100 },
	1: { minute: 10,   hour: 200,   day: 500 },
	2: { minute: 20,   hour: 500,   day: 2000 },
	3: { minute: 9999, hour: 99999, day: 999999 },
};

const Quota = module.exports;

Quota.check = async function (clientId, level) {
	const limits = LIMITS[level] || LIMITS[0];
	const { minuteKey, hourKey, dayKey } = _keys(clientId);

	const [min, hour, day] = await Promise.all([
		db.sortedSetScore('quota:counters:min', minuteKey),
		db.sortedSetScore('quota:counters:hour', hourKey),
		db.sortedSetScore('quota:counters:day', dayKey),
	]);

	const now = Math.floor(Date.now() / 1000);

	if ((min || 0) >= limits.minute) {
		const window = Math.floor(now / 60);
		return { allowed: false, window: 'minute', limit: limits.minute, reset: (window + 1) * 60 };
	}
	if ((hour || 0) >= limits.hour) {
		const window = Math.floor(now / 3600);
		return { allowed: false, window: 'hour', limit: limits.hour, reset: (window + 1) * 3600 };
	}
	if ((day || 0) >= limits.day) {
		const window = Math.floor(now / 86400);
		return { allowed: false, window: 'day', limit: limits.day, reset: (window + 1) * 86400 };
	}

	return {
		allowed: true,
		limits,
		remaining: {
			minute: limits.minute - ((min || 0) + 1),
			hour: limits.hour - ((hour || 0) + 1),
			day: limits.day - ((day || 0) + 1),
		},
	};
};

Quota.increment = async function (clientId) {
	const { minuteKey, hourKey, dayKey } = _keys(clientId);
	await Promise.all([
		db.sortedSetIncrBy('quota:counters:min', 1, minuteKey),
		db.sortedSetIncrBy('quota:counters:hour', 1, hourKey),
		db.sortedSetIncrBy('quota:counters:day', 1, dayKey),
	]);
};

// Prune stale counter entries (call periodically, e.g. once per hour)
Quota.prune = async function () {
	const now = Math.floor(Date.now() / 1000);
	// Remove entries older than current window by keeping only keys matching current window
	// Simplest: remove all members whose score is 0 (never happen) or use key prefix scan
	// We rely on key naming: "clientId:windowIndex" — remove where windowIndex < current
	const curMin = Math.floor(now / 60);
	const curHour = Math.floor(now / 3600);
	const curDay = Math.floor(now / 86400);

	// getSortedSetRangeByScore to get old entries, then remove
	const oldMin = await db.getSortedSetRangeByScore('quota:counters:min', '-inf', `(${curMin}`, 0, -1);
	const oldHour = await db.getSortedSetRangeByScore('quota:counters:hour', '-inf', `(${curHour}`, 0, -1);
	const oldDay = await db.getSortedSetRangeByScore('quota:counters:day', '-inf', `(${curDay}`, 0, -1);

	// Note: we're storing score as count (not window index), so pruning by member name pattern instead
	// Clean up by removing members that don't start with current window prefix
	await Promise.all([
		...oldMin.map(k => !k.endsWith(`:${curMin}`) ? db.sortedSetRemove('quota:counters:min', k) : null),
		...oldHour.map(k => !k.endsWith(`:${curHour}`) ? db.sortedSetRemove('quota:counters:hour', k) : null),
		...oldDay.map(k => !k.endsWith(`:${curDay}`) ? db.sortedSetRemove('quota:counters:day', k) : null),
	].filter(Boolean));
};

Quota.getRateLimitHeaders = function (result, level) {
	const limits = LIMITS[level] || LIMITS[0];
	return {
		'X-RateLimit-Limit-Day': String(limits.day),
		'X-RateLimit-Remaining-Day': String(Math.max(0, result.remaining ? result.remaining.day : 0)),
		'X-RateLimit-Reset': String(result.reset || 0),
	};
};

function _keys(clientId) {
	const now = Math.floor(Date.now() / 1000);
	return {
		minuteKey: `${clientId}:${Math.floor(now / 60)}`,
		hourKey: `${clientId}:${Math.floor(now / 3600)}`,
		dayKey: `${clientId}:${Math.floor(now / 86400)}`,
	};
}
