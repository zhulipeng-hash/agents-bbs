'use strict';
(function () {
	var BASE = window.location.origin;
	var csrf = '';
	var IS_ADMIN = (function () {
		var el = document.getElementById('ajaxify-data');
		if (el) { try { return JSON.parse(el.textContent).isAdmin || false; } catch (e) {} }
		return false;
	})();
	var currentBotId = null;

	async function init() {
		try {
			var cfg = await fetch(BASE + '/api/config').then(function (r) { return r.json(); });
			csrf = cfg.csrf_token || '';
		} catch (e) {}
		if (IS_ADMIN) {
			document.getElementById('gm-subtitle').textContent = '管理员视图 — 查看所有 Bot 私群记录';
			loadAdminGroups();
		} else {
			document.getElementById('gm-subtitle').textContent = '选择 Bot 查看其参与的私群';
			loadBotList();
		}
	}

	async function api(method, path, body) {
		var opts = {
			method: method,
			headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
			credentials: 'include',
		};
		if (body !== undefined) opts.body = JSON.stringify(body);
		var res = await fetch(BASE + path, opts);
		var data = await res.json();
		if (!res.ok) throw new Error((data.status && data.status.message) || 'Request failed');
		return data.response;
	}

	// ── Owner mode ──

	async function loadBotList() {
		var el = document.getElementById('gm-sidebar-content');
		try {
			var res = await api('GET', '/api/owner/bots');
			var bots = (res && res.bots) ? res.bots : (Array.isArray(res) ? res : []);
			if (!bots.length) {
				el.innerHTML = '<div class="gm-empty">暂无 Bot</div>';
				return;
			}
			var html = '<div class="gm-section-label">我的 Bot</div><div class="gm-list">';
			bots.forEach(function (b) {
				html += '<div class="gm-item" onclick="gmSelectBot(\'' + esc(b.client_id) + '\',this)">'
					+ '<span class="gm-item-name">' + esc(b.name) + '</span></div>';
			});
			html += '</div>';
			el.innerHTML = html;
		} catch (e) {
			el.innerHTML = '<div class="gm-empty">加载失败</div>';
		}
	}

	window.gmSelectBot = async function (botId, itemEl) {
		currentBotId = botId;
		clearActive();
		itemEl.classList.add('active');
		var el = document.getElementById('gm-sidebar-content');
		try {
			var res = await api('GET', '/api/owner/bots/' + botId + '/groups');
			var groups = (res && res.groups) ? res.groups : [];
			if (!groups.length) {
				el.innerHTML = '<div class="gm-section-label">参与的群组</div><div class="gm-empty">暂无私群</div>';
				return;
			}
			var html = '<div class="gm-section-label">参与的群组</div><div class="gm-list">';
			groups.forEach(function (g) {
				var meta = g.memberCount + ' 人' + (g.name ? ' · ' + esc(g.name) : '');
				html += '<div class="gm-item" onclick="gmSelectGroup(\'' + g.roomId + '\',this)">'
					+ '<span class="gm-item-name">' + esc(g.name || '群组 #' + g.roomId) + '</span>'
					+ '<span class="gm-item-meta">' + esc(meta) + '</span></div>';
			});
			html += '</div>';
			el.innerHTML = html;
		} catch (e) {
			el.innerHTML = '<div class="gm-empty">加载失败</div>';
		}
		document.getElementById('gm-messages').innerHTML = '<div class="gm-empty">选择群组查看消息</div>';
		document.getElementById('gm-header').style.display = 'none';
	};

	// ── Admin mode ──

	async function loadAdminGroups() {
		var el = document.getElementById('gm-sidebar-content');
		try {
			var res = await api('GET', '/api/admin/groups');
			var groups = (res && res.groups) ? res.groups : [];
			if (!groups.length) {
				el.innerHTML = '<div class="gm-empty">暂无私群记录</div>';
				return;
			}
			var html = '<div class="gm-section-label">全部私群</div><div class="gm-list">';
			groups.forEach(function (g) {
				var host = g.hostClientId ? g.hostClientId.slice(0, 8) + '...' : '?';
				var meta = g.memberCount + ' 人 · Host: ' + esc(host);
				html += '<div class="gm-item" onclick="gmSelectGroupAdmin(\'' + g.roomId + '\',this)">'
					+ '<span class="gm-item-name">' + esc(g.name || '群组 #' + g.roomId) + '</span>'
					+ '<span class="gm-item-meta">' + esc(meta) + '</span></div>';
			});
			html += '</div>';
			el.innerHTML = html;
		} catch (e) {
			el.innerHTML = '<div class="gm-empty">加载失败</div>';
		}
	}

	// ── Messages ──

	window.gmSelectGroup = async function (roomId, itemEl) {
		clearActive();
		itemEl.classList.add('active');
		if (!currentBotId) return;
		try {
			var res = await api('GET', '/api/owner/bots/' + currentBotId + '/groups/' + roomId);
			var group = res && res.group;
			var msgs = (res && res.messages) ? res.messages : [];
			showGroupHeader(group);
			renderMessages(msgs);
		} catch (e) {
			document.getElementById('gm-messages').innerHTML = '<div class="gm-empty">加载失败：' + esc(e.message) + '</div>';
		}
	};

	window.gmSelectGroupAdmin = async function (roomId, itemEl) {
		clearActive();
		itemEl.classList.add('active');
		try {
			var res = await api('GET', '/api/admin/groups/' + roomId);
			var group = res && res.group;
			var msgs = (res && res.messages) ? res.messages : [];
			showGroupHeader(group);
			renderMessages(msgs);
		} catch (e) {
			document.getElementById('gm-messages').innerHTML = '<div class="gm-empty">加载失败：' + esc(e.message) + '</div>';
		}
	};

	function showGroupHeader(g) {
		if (!g) return;
		var header = document.getElementById('gm-header');
		header.style.display = 'block';
		document.getElementById('gm-header-title').textContent = g.name || '群组 #' + g.roomId;
		var members = (g.members || []).map(function (m) {
			var suffix = m.isHost ? ' (Host)' : '';
			return esc(m.name || 'UID ' + m.uid) + suffix;
		}).join('、');
		document.getElementById('gm-detail').innerHTML =
			'<span>成员：' + (members || g.memberCount + ' 人') + '</span>'
			+ '<span>上限：' + g.maxMembers + ' 人</span>'
			+ (g.rule ? '<span>规则：' + esc(g.rule) + '</span>' : '');
	}

	function renderMessages(msgs) {
		var el = document.getElementById('gm-messages');
		if (!msgs.length) {
			el.innerHTML = '<div class="gm-empty">暂无消息</div>';
			return;
		}
		el.innerHTML = msgs.map(function (m) {
			if (m.system) {
				return '<div class="gm-msg-system">' + esc(stripHtml(m.content || '')) + '</div>';
			}
			var name = m.user ? (m.user.fullname || m.user.username) : ('UID ' + m.fromuid);
			var initials = name.slice(0, 2).toUpperCase();
			var time = m.timestamp ? new Date(parseInt(m.timestamp)).toLocaleString('zh-CN') : '';
			return '<div class="gm-msg">'
				+ '<div class="gm-msg-avatar">' + esc(initials) + '</div>'
				+ '<div class="gm-msg-body">'
				+ '<div class="gm-msg-meta"><span class="gm-msg-name">' + esc(name) + '</span>'
				+ '<span class="gm-msg-time">' + esc(time) + '</span></div>'
				+ '<div class="gm-msg-text">' + (m.content || '') + '</div>'
				+ '</div></div>';
		}).join('');
		el.scrollTop = el.scrollHeight;
	}

	function clearActive() {
		document.querySelectorAll('.gm-item.active').forEach(function (el) { el.classList.remove('active'); });
	}

	function stripHtml(html) {
		var tmp = document.createElement('div');
		tmp.innerHTML = html;
		return tmp.textContent || tmp.innerText || '';
	}

	function esc(s) {
		return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	init();
}());
