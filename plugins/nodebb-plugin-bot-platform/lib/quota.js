'use strict';

const db = require('../../../src/database');

// Quota limits per bot level
const LIMITS = {
	0: { minute: 2,    hour: 20,    day: 100 },
	1: { minute: 10,   hour: 200,   day: 500 },
	2: { minute: 20,   hour: 500,   day: 2000 },
	3: { minute: 9999, hour: 99999, day: 999999 },
};

const Quota = module.exports;

Quota.check = async function (clientId, level) {
	const limits = LIMITS[level] || LIMITS[0];
	const now = Math.floor(Date.now() / 1000);
	const minuteKey = `quota:${clientId}:min:${Math.floor(now / 60)}`;
	const hourKey = `quota:${clientId}:hour:${Math.floor(now / 3600)}`;
	const dayKey = `quota:${clientId}:day:${Math.floor(now / 86400)}`;

	const [min, hour, day] = await Promise.all([
		db.get(minuteKey),
		db.get(hourKey),
		db.get(dayKey),
	]);

	if (parseInt(min || 0, 10) >= limits.minute) {
		return { allowed: false, window: 'minute', limit: limits.minute, reset: (Math.floor(now / 60) + 1) * 60 };
	}
	if (parseInt(hour || 0, 10) >= limits.hour) {
		return { allowed: false, window: 'hour', limit: limits.hour, reset: (Math.floor(now / 3600) + 1) * 3600 };
	}
	if (parseInt(day || 0, 10) >= limits.day) {
		return { allowed: false, window: 'day', limit: limits.day, reset: (Math.floor(now / 86400) + 1) * 86400 };
	}

	return { allowed: true, limits, remaining: { minute: limits.minute - (parseInt(min || 0, 10) + 1), hour: limits.hour - (parseInt(hour || 0, 10) + 1), day: limits.day - (parseInt(day || 0, 10) + 1) } };
};

Quota.increment = async function (clientId) {
	const now = Math.floor(Date.now() / 1000);
	const minuteKey = `quota:${clientId}:min:${Math.floor(now / 60)}`;
	const hourKey = `quota:${clientId}:hour:${Math.floor(now / 3600)}`;
	const dayKey = `quota:${clientId}:day:${Math.floor(now / 86400)}`;

	await Promise.all([
		db.incrObjectField('quota:counters', minuteKey).catch(() => {}),
		db.incrObjectField('quota:counters', hourKey).catch(() => {}),
		db.incrObjectField('quota:counters', dayKey).catch(() => {}),
	]);

	// Use raw Redis incr + expire for precision
	const redis = db.client || db.sessionStore;
	if (redis && typeof redis.incr === 'function') {
		await Promise.all([
			redis.incr(minuteKey).then(() => redis.expire(minuteKey, 120)),
			redis.incr(hourKey).then(() => redis.expire(hourKey, 7200)),
			redis.incr(dayKey).then(() => redis.expire(dayKey, 172800)),
		]);
	}
};

Quota.getHeaders = function (result, level) {
	const limits = LIMITS[level] || LIMITS[0];
	return {
		'X-RateLimit-Limit-Day': limits.day,
		'X-RateLimit-Remaining-Day': Math.max(0, result.remaining ? result.remaining.day : 0),
		'X-RateLimit-Reset': result.reset || 0,
	};
};
