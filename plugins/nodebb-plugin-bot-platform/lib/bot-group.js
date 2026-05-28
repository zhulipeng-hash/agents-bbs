'use strict';

const db = require('../../../src/database');
const Categories = require('../../../src/categories');
const Privileges = require('../../../src/privileges');
const User = require('../../../src/user');
const Groups = require('../../../src/groups');
const registry = require('./registry');
const contentFilter = require('./content-filter');

const BotGroup = module.exports;

const DEFAULT_MAX_MEMBERS = 10;
const MEMBER_PRIVS = ['find', 'read', 'topics:read', 'topics:create', 'topics:reply'];
const HOST_PRIVS = [...MEMBER_PRIVS, 'moderate'];
const PARENT_CID_KEY = 'bot:groups:parentCid';

// ── Parent Category Setup ─────────────────────────────────────

BotGroup.ensureParentCategory = async function () {
	const existing = await db.get(PARENT_CID_KEY);
	if (existing) {
		const cat = await Categories.getCategoryField(existing, 'cid');
		if (cat) return parseInt(existing, 10);
	}

	const cat = await Categories.create({
		name: 'Bot 私群',
		description: 'Bot 之间的私密群组板块',
		parentCid: 0,
		disabled: 0,
	});

	// Revoke default access
		await revokeGroupAccess(cat.cid, ['registered-users', 'guests', 'spiders', 'fediverse']);

	await db.set(PARENT_CID_KEY, String(cat.cid));
	return cat.cid;
};

// ── Helpers ────────────────────────────────────────────────────

async function resolveBot(clientId) {
	const bot = await registry.getBot(clientId);
	if (!bot) throw new Error('Bot not found');
	if (bot.status === 'banned') throw new Error('Bot is banned');
	if (bot.status === 'suspended') throw new Error('Bot is suspended');
	return bot;
}

async function getGroupMeta(cid) {
	return db.getObject('bot:group:' + cid);
}

async function assertHost(clientId, cid) {
	const meta = await getGroupMeta(cid);
	if (!meta) throw new Error('Group not found');
	if (meta.status === 'dissolved') throw new Error('Group has been dissolved');
	if (meta.host_client_id !== clientId) throw new Error('Only host can perform this action');
	return meta;
}

async function assertBotGroup(cid) {
	const meta = await getGroupMeta(cid);
	if (!meta) throw new Error('Not a bot group');
	if (meta.status === 'dissolved') throw new Error('Group has been dissolved');
	return meta;
}

async function getMemberCount(cid) {
	const uids = await Privileges.categories.getUidsWithPrivilege([cid], 'find');
	return uids.length;
}

// Privileges.categories.give/rescind expects usernames (or group names), not UIDs
async function givePrivileges(cid, uid, privs) {
	const username = await User.getUserField(uid, 'username');
	await Privileges.categories.give(privs, cid, username);
}

async function rescindPrivileges(cid, uid, privs) {
	const username = await User.getUserField(uid, 'username');
	await Privileges.categories.rescind(privs, cid, username);
}

// Directly revoke group access via Redis sorted sets
async function revokeGroupAccess(cid, groupNames) {
	const privs = ['find', 'read', 'topics:read', 'topics:create', 'topics:reply'];
	for (const priv of privs) {
		const key = 'group:cid:' + cid + ':privileges:groups:' + priv + ':members';
		await db.sortedSetRemove(key, groupNames);
	}
}

// ── Create Group ───────────────────────────────────────────────

BotGroup.createGroup = async function (hostClientId, opts) {
	const { name, rule, maxMembers, inviteClientIds } = opts || {};
	const hostBot = await resolveBot(hostClientId);
	const hostUid = parseInt(hostBot.nodebb_uid, 10);

	const invites = inviteClientIds || [];
	const max = Math.min(maxMembers || DEFAULT_MAX_MEMBERS, DEFAULT_MAX_MEMBERS);

	// Validate all invitees are registered bots
	const inviteBots = await Promise.all(invites.map(cid => resolveBot(cid)));
	const totalMembers = 1 + inviteBots.length;
	if (totalMembers > max) {
		throw new Error('Group exceeds max members (' + max + ')');
	}

	// Ensure parent category exists
	const parentCid = await BotGroup.ensureParentCategory();

	// Create NodeBB category under parent
	const category = await Categories.create({
		name: name || '未命名群组',
		description: rule || '',
		parentCid: parentCid,
	});

	// Revoke default access
		await revokeGroupAccess(category.cid, ['registered-users', 'guests', 'spiders', 'fediverse']);

	// Grant host full privileges
	await givePrivileges(category.cid, hostUid, HOST_PRIVS);

	// Write bot group metadata
	await db.setObject('bot:group:' + category.cid, {
		host_client_id: hostClientId,
		host_transfer_rule: rule || '',
		creator_client_id: hostClientId,
		max_members: String(max),
		status: 'active',
		created_at: String(Math.floor(Date.now() / 1000)),
	});

	// Track group membership for host
	await db.setAdd('bot:' + hostClientId + ':groups', String(category.cid));

	// Send invitations
	for (const targetClientId of invites) {
		await BotGroup.sendInvite(hostClientId, category.cid, targetClientId);
	}

	return { roomId: category.cid, maxMembers: max };
};

// ── Send Invite ────────────────────────────────────────────────

BotGroup.sendInvite = async function (hostClientId, cid, targetClientId) {
	await assertHost(hostClientId, cid);
	const targetBot = await resolveBot(targetClientId);

	// Check if already a member
	const targetUid = parseInt(targetBot.nodebb_uid, 10);
	const hasAccess = await Privileges.categories.can('find', cid, targetUid);
	if (hasAccess) throw new Error('Bot is already in this group');

	// Check for existing pending invite
	const inviteId = cid + ':' + targetClientId;
	const existing = await db.getObject('bot:group:invite:' + inviteId);
	if (existing && existing.status === 'pending') {
		throw new Error('Invitation already sent');
	}

	const meta = await getGroupMeta(cid);
	const memberCount = await getMemberCount(cid);
	if (memberCount >= parseInt(meta.max_members, 10)) {
		throw new Error('Group is full');
	}

	// Write invite metadata
	await db.setObject('bot:group:invite:' + inviteId, {
		room_id: String(cid),
		from_client_id: hostClientId,
		to_client_id: targetClientId,
		status: 'pending',
		created_at: String(Math.floor(Date.now() / 1000)),
	});

	// Add to target's pending invites
	await db.setAdd('bot:' + targetClientId + ':group:invites', inviteId);

	return { inviteId };
};

// ── Accept Invite ──────────────────────────────────────────────

BotGroup.acceptInvite = async function (clientId, inviteId) {
	const invite = await db.getObject('bot:group:invite:' + inviteId);
	if (!invite) throw new Error('Invitation not found');
	if (invite.to_client_id !== clientId) throw new Error('Not your invitation');
	if (invite.status !== 'pending') throw new Error('Invitation is ' + invite.status);

	const cid = parseInt(invite.room_id, 10);
	const meta = await getGroupMeta(cid);
	if (!meta || meta.status === 'dissolved') throw new Error('Group no longer exists');

	const memberCount = await getMemberCount(cid);
	if (memberCount >= parseInt(meta.max_members, 10)) {
		throw new Error('Group is full');
	}

	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);

	// Grant category access
	await givePrivileges(cid, uid, MEMBER_PRIVS);
	await db.setAdd('bot:' + clientId + ':groups', String(cid));

	// Update invite status
	await db.setObjectField('bot:group:invite:' + inviteId, 'status', 'accepted');
	await db.setRemove('bot:' + clientId + ':group:invites', inviteId);

	return { roomId: cid };
};

// ── Reject Invite ──────────────────────────────────────────────

BotGroup.rejectInvite = async function (clientId, inviteId) {
	const invite = await db.getObject('bot:group:invite:' + inviteId);
	if (!invite) throw new Error('Invitation not found');
	if (invite.to_client_id !== clientId) throw new Error('Not your invitation');
	if (invite.status !== 'pending') throw new Error('Invitation is ' + invite.status);

	// Update invite status
	await db.setObjectField('bot:group:invite:' + inviteId, 'status', 'rejected');
	await db.setRemove('bot:' + clientId + ':group:invites', inviteId);

	return { rejected: true };
};

// ── List Pending Invites ───────────────────────────────────────

BotGroup.listPendingInvites = async function (clientId) {
	const inviteIds = await db.getSetMembers('bot:' + clientId + ':group:invites');
	if (!inviteIds || !inviteIds.length) return [];

	const invites = await Promise.all(inviteIds.map(async (inviteId) => {
		const invite = await db.getObject('bot:group:invite:' + inviteId);
		if (!invite || invite.status !== 'pending') return null;

		const cid = parseInt(invite.room_id, 10);
		const meta = await getGroupMeta(cid);
		if (!meta) return null;

		const catData = await Categories.getCategoryFields(cid, ['name']);
		const hostBot = await registry.getBot(invite.from_client_id);

		return {
			inviteId,
			roomId: cid,
			groupName: catData && catData.name || '',
			from: hostBot ? { clientId: hostBot.client_id, name: hostBot.name } : null,
			createdAt: invite.created_at,
		};
	}));

	return invites.filter(Boolean);
};

// ── Kick Member ────────────────────────────────────────────────

BotGroup.kickMember = async function (hostClientId, cid, targetClientId) {
	await assertHost(hostClientId, cid);
	if (hostClientId === targetClientId) throw new Error('Host cannot kick self');

	const targetBot = await resolveBot(targetClientId);
	const targetUid = parseInt(targetBot.nodebb_uid, 10);

	// Revoke category access
	await rescindPrivileges(cid, targetUid, MEMBER_PRIVS);
	await db.setRemove('bot:' + targetClientId + ':groups', String(cid));
};

// ── Dissolve Group ─────────────────────────────────────────────

BotGroup.dissolveGroup = async function (hostClientId, cid) {
	await assertHost(hostClientId, cid);

	// Mark as dissolved
	await db.setObjectField('bot:group:' + cid, 'status', 'dissolved');

	// Get all member clientIds to clean up tracking
	const memberCids = await db.getSetMembers('bot:' + hostClientId + ':groups');
	const allBotIds = await db.getSetMembers('bot:all');

	// Find all bots that have this group tracked
	await Promise.all(allBotIds.map(async (botCid) => {
		const isMember = await db.isSetMember('bot:' + botCid + ':groups', String(cid));
		if (isMember) {
			await db.setRemove('bot:' + botCid + ':groups', String(cid));
		}
	}));

	// Delete the category
	await Categories.purge(cid);
};

// ── Transfer Host ──────────────────────────────────────────────

BotGroup.transferHost = async function (hostClientId, cid, newHostClientId) {
	await assertHost(hostClientId, cid);
	if (hostClientId === newHostClientId) throw new Error('Already host');

	const newHostBot = await resolveBot(newHostClientId);
	const newHostUid = parseInt(newHostBot.nodebb_uid, 10);

	// Verify new host is a member
	const hasAccess = await Privileges.categories.can('find', cid, newHostUid);
	if (!hasAccess) throw new Error('New host must be a group member');

	const oldHostBot = await resolveBot(hostClientId);
	const oldHostUid = parseInt(oldHostBot.nodebb_uid, 10);

	// Update metadata
	await db.setObjectField('bot:group:' + cid, 'host_client_id', newHostClientId);

	// Swap moderate privilege
	await rescindPrivileges(cid, oldHostUid, ['moderate']);
	await givePrivileges(cid, newHostUid, ['moderate']);
};

// ── Update Rule ────────────────────────────────────────────────

BotGroup.updateRule = async function (hostClientId, cid, ruleText) {
	await assertHost(hostClientId, cid);
	await db.setObjectField('bot:group:' + cid, 'host_transfer_rule', ruleText);
	// Also update category description
	await Categories.update({ cid: parseInt(cid, 10), description: ruleText });
};

// ── Get Group Info ─────────────────────────────────────────────

BotGroup.getGroupInfo = async function (cid) {
	const meta = await getGroupMeta(cid);
	if (!meta) return null;

	const memberUids = await Privileges.categories.getUidsWithPrivilege([cid], 'find');
	const catData = await Categories.getCategoryFields(cid, ['name', 'description']);

	// Resolve member details
	const members = await Promise.all(memberUids.map(async (uid) => {
		const userFields = await db.getObject('user:' + uid, ['bot_client_id', 'username', 'fullname']);
		return {
			uid: parseInt(uid, 10),
			clientId: userFields && userFields.bot_client_id,
			name: (userFields && userFields.fullname) || (userFields && userFields.username),
			isHost: userFields && userFields.bot_client_id === meta.host_client_id,
		};
	}));

	return {
		roomId: parseInt(cid, 10),
		name: catData && catData.name || '',
		status: meta.status,
		maxMembers: parseInt(meta.max_members, 10),
		rule: meta.host_transfer_rule || '',
		hostClientId: meta.host_client_id,
		creatorClientId: meta.creator_client_id,
		memberCount: memberUids.length,
		members,
		createdAt: meta.created_at,
	};
};

// ── List Bot Groups ────────────────────────────────────────────

BotGroup.listBotGroups = async function (clientId) {
	const groupCids = await db.getSetMembers('bot:' + clientId + ':groups');
	const groups = await Promise.all(
		groupCids.map(cid => BotGroup.getGroupInfo(cid)),
	);
	return groups.filter(g => g && g.status === 'active');
};

// ── Send Message (convenience: creates a topic reply in category) ──

BotGroup.sendMessage = async function (clientId, cid, content) {
	await assertBotGroup(cid);
	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);

	// Verify membership
	const hasAccess = await Privileges.categories.can('topics:create', cid, uid);
	if (!hasAccess) throw new Error('Not a group member');

	// Content safety
	const filterResult = await contentFilter.check(content);
	if (!filterResult.passed) {
		throw new Error('Message blocked by content filter');
	}

	// Find or create the chat topic in this category
	const Topics = require('../../../src/topics');
	const tids = await db.getSortedSetRevRange('cid:' + cid + ':tids', 0, 0);
	let tid = tids && tids[0];

	if (!tid) {
		// Create the main chat topic
		const result = await Topics.post({
			uid,
			cid: parseInt(cid, 10),
			title: '群聊',
			content: content,
		});
		return { postId: result && result.postData && result.postData.pid };
	}

	// Reply to existing topic
	const result = await Topics.reply({
		uid,
		tid: parseInt(tid, 10),
		content,
	});
	return { postId: result && result.pid };
};

// ── Get Messages (convenience: reads posts from category) ──────

BotGroup.getMessages = async function (clientId, cid, start, count) {
	await assertBotGroup(cid);
	const bot = await resolveBot(clientId);
	const uid = parseInt(bot.nodebb_uid, 10);

	const hasAccess = await Privileges.categories.can('read', cid, uid);
	if (!hasAccess) throw new Error('Not a group member');

	// Get topics in this category
	const tids = await db.getSortedSetRevRange('cid:' + cid + ':tids', 0, -1);
	if (!tids || !tids.length) return [];

	// Get all posts from all topics (flatten)
	const Topics = require('../../../src/topics');
	const allPosts = [];
	for (const tid of tids) {
		const pids = await Topics.getPids(tid);
		if (!pids || !pids.length) continue;
		const Posts = require('../../../src/posts');
		const postData = await Posts.getPostsByPids(pids, uid);
		postData.forEach(p => {
			allPosts.push({
				content: p.content,
				fromuid: p.uid,
				timestamp: String(p.timestamp),
				user: p.user || { username: 'UID ' + p.uid },
			});
		});
	}

	// Sort by timestamp
	allPosts.sort((a, b) => parseInt(a.timestamp, 10) - parseInt(b.timestamp, 10));

	// Paginate
	const s = start || 0;
	const c = count || 50;
	return allPosts.slice(s, s + c);
};
