'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../../../src/database');

const TOKEN_TTL = 3600; // seconds

const Auth = module.exports;

// ── Key generation ──────────────────────────────────────────────

Auth.generateApiKey = function () {
	return {
		clientId: crypto.randomBytes(12).toString('hex'),
		clientSecret: crypto.randomBytes(32).toString('hex'),
	};
};

Auth.hashSecret = async function (secret) {
	return bcrypt.hash(secret, 10);
};

Auth.verifySecret = async function (secret, hash) {
	return bcrypt.compare(secret, hash);
};

// ── HMAC signature verification ──────────────────────────────────

Auth.verifySignature = function (clientId, timestamp, signature, secret) {
	const now = Math.floor(Date.now() / 1000);
	if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
		return false; // replay attack window: ±5 min
	}
	const expected = crypto
		.createHmac('sha256', secret)
		.update(clientId + timestamp)
		.digest('hex');
	return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

// ── Token management (Redis) ──────────────────────────────────────

Auth.issueToken = async function (clientId, scope = 'rules_only') {
	const token = crypto.randomBytes(32).toString('hex');
	await db.psetex(`bot:token:${token}:client`, TOKEN_TTL * 1000, clientId);
	await db.psetex(`bot:token:${token}:scope`, TOKEN_TTL * 1000, scope);
	return { token, expiresIn: TOKEN_TTL };
};

Auth.upgradeTokenScope = async function (token, scope) {
	const ttl = await db.pttl(`bot:token:${token}:scope`);
	if (ttl <= 0) throw new Error('[[error:token-expired]]');
	await db.psetex(`bot:token:${token}:scope`, ttl, scope);
};

Auth.revokeToken = async function (token) {
	await db.delete(`bot:token:${token}:client`);
	await db.delete(`bot:token:${token}:scope`);
};

Auth.getTokenData = async function (token) {
	const [clientId, scope] = await Promise.all([
		db.getObjectField(`bot:token:${token}`, 'client') || db.get(`bot:token:${token}:client`),
		db.get(`bot:token:${token}:scope`),
	]);
	return { clientId, scope };
};

// ── Express middleware ────────────────────────────────────────────

Auth.authenticate = async function (req, res, next) {
	const header = req.headers.authorization || '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : null;
	if (!token) {
		return res.status(401).json({ status: { code: 'not-authorised', message: 'Missing token' } });
	}
	const [clientId, scope] = await Promise.all([
		db.get(`bot:token:${token}:client`),
		db.get(`bot:token:${token}:scope`),
	]);
	if (!clientId) {
		return res.status(401).json({ status: { code: 'not-authorised', message: 'Invalid or expired token' } });
	}
	req.botToken = token;
	req.botClientId = clientId;
	req.botScope = scope;
	next();
};
