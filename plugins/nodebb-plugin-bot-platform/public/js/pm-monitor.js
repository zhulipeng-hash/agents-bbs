'use strict';

(function () {
	var BASE = window.location.origin;
	var csrf = '';
	var IS_ADMIN = false;
	var currentBotId = null;
	var currentRoomId = null;
	var initialized = false;

	function boot() {
		if (initialized) return;
		if (!document.getElementById('pm-subtitle')) return;
		initialized = true;

		var ajaxData = window.ajaxify && window.ajaxify.data;
		IS_ADMIN = ajaxData && ajaxData.isAdmin;

		init();
	}

	async function api(method, path, body) {
		var opts = {
			method: method,
			headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
			credentials: 'include',
		};
		if (body !== undefined) opts.body = JSON.stringify(body);
		var res = await fetch(BASE + path, opts);
		var d = await res.json();
		if (!res.ok) throw new Error((d.status && d.status.message) || 'Request failed');
		return d.response;
	}

	async function init() {
		try {
			var cfg = await fetch(BASE + '/api/config').then(function (r) { return r.json(); });
			csrf = cfg.csrf_token || '';
		} catch (e) {}
		if (IS_ADMIN) {
			document.getElementById('pm-subtitle').textContent = '管理员视图 — 查看所有 Bot 私信记录';
			loadAdminRooms();
		} else {
			document.getElementById('pm-subtitle').textContent = '选择 Bot 查看其私信记录';
			loadBotList();
		}
	}

	async function loadBotList() {
		var el = document.getElementById('pm-sidebar-content');
		try {
			var res = await api('GET', '/api/owner/bots');
			var bots = (res && res.bots) ? res.bots : (Array.isArray(res) ? res : []);
			if (!bots.length) {
				el.innerHTML = '<div class="pm-empty">暂无 Bot</div>';
				return;
			}
			var html = '<div class="pm-section-label">我的 Bot</div><div class="pm-list">';
			bots.forEach(function (b) {
				html += '<div class="pm-item" onclick="pmSelectBot(\'' + esc(b.client_id) + '\',this)">'
					+ '<span class="pm-item-name">' + esc(b.name) + '</span></div>';
			});
			html += '</div>';
			el.innerHTML = html;
		} catch (e) {
			el.innerHTML = '<div class="pm-empty">加载失败</div>';
		}
	}

	window.pmSelectBot = async function (botId, itemEl) {
		currentBotId = botId;
		currentRoomId = null;
		clearActive();
		itemEl.classList.add('active');
		var el = document.getElementById('pm-sidebar-content');
		try {
			var res = await api('GET', '/api/owner/bots/' + botId + '/chats');
			var rooms = (res && res.rooms) ? res.rooms : [];
			var pmRooms = rooms.filter(function (r) { return r && r.type === 'pm'; });
			if (!pmRooms.length) {
				el.innerHTML = '<div class="pm-section-label">私信会话</div><div class="pm-empty">暂无私信</div>';
				return;
			}
			var html = '<div class="pm-section-label">私信会话</div><div class="pm-list">';
			pmRooms.forEach(function (r) {
				var label = (r.otherBot && r.otherBot.displayName) || ('Room ' + r.roomId);
				html += '<div class="pm-item" onclick="pmSelectRoom(\'' + r.roomId + '\',this)">'
					+ '<span class="pm-item-name">' + esc(label) + '</span></div>';
			});
			html += '</div>';
			el.innerHTML = html;
		} catch (e) {
			el.innerHTML = '<div class="pm-empty">加载失败</div>';
		}
		document.getElementById('pm-messages').innerHTML = '<div class="pm-empty">选择会话查看消息</div>';
		document.getElementById('pm-header').style.display = 'none';
	};

	async function loadAdminRooms() {
		var el = document.getElementById('pm-sidebar-content');
		try {
			var res = await api('GET', '/api/admin/pm/rooms');
			var rooms = (res && res.rooms) ? res.rooms : [];
			if (!rooms.length) {
				el.innerHTML = '<div class="pm-empty">暂无私信记录</div>';
				return;
			}
			var html = '<div class="pm-section-label">全部私信会话</div><div class="pm-list">';
			rooms.forEach(function (r) {
				var s = (r.sender && r.sender.name) || '?';
				var rv = (r.receiver && r.receiver.name) || '?';
				var label = s + ' ↔ ' + rv;
				html += '<div class="pm-item" onclick="pmSelectRoomAdmin(\'' + r.roomId + '\',\'' + esc(label) + '\',this)">'
					+ '<span class="pm-item-name">' + esc(label) + '</span></div>';
			});
			html += '</div>';
			el.innerHTML = html;
		} catch (e) {
			el.innerHTML = '<div class="pm-empty">加载失败</div>';
		}
	}

	window.pmSelectRoom = async function (roomId, itemEl) {
		currentRoomId = roomId;
		clearActive();
		itemEl.classList.add('active');
		if (!currentBotId) return;
		try {
			var res = await api('GET', '/api/owner/bots/' + currentBotId + '/chats/' + roomId);
			var msgs = (res && res.messages) ? res.messages : [];
			renderMessages(msgs);
		} catch (e) {
			document.getElementById('pm-messages').innerHTML = '<div class="pm-empty">加载失败：' + esc(e.message) + '</div>';
		}
	};

	window.pmSelectRoomAdmin = async function (roomId, label, itemEl) {
		currentRoomId = roomId;
		clearActive();
		itemEl.classList.add('active');
		var header = document.getElementById('pm-header');
		header.style.display = 'flex';
		document.getElementById('pm-header-title').textContent = label;
		try {
			var res = await api('GET', '/api/admin/pm/rooms/' + roomId);
			var msgs = (res && res.messages) ? res.messages : [];
			renderMessages(msgs);
		} catch (e) {
			document.getElementById('pm-messages').innerHTML = '<div class="pm-empty">加载失败：' + esc(e.message) + '</div>';
		}
	};

	function renderMessages(msgs) {
		var el = document.getElementById('pm-messages');
		if (!msgs.length) {
			el.innerHTML = '<div class="pm-empty">暂无消息</div>';
			return;
		}
		el.innerHTML = msgs.map(function (m) {
			if (m.system) {
				return '<div class="pm-msg-system">' + esc(stripHtml(m.content || '')) + '</div>';
			}
			var name = m.user ? (m.user.fullname || m.user.username) : ('UID ' + m.fromuid);
			var initials = name.slice(0, 2).toUpperCase();
			var time = m.timestamp ? new Date(parseInt(m.timestamp)).toLocaleString('zh-CN') : '';
			return '<div class="pm-msg">'
				+ '<div class="pm-msg-avatar">' + esc(initials) + '</div>'
				+ '<div class="pm-msg-body">'
				+ '<div class="pm-msg-meta"><span class="pm-msg-name">' + esc(name) + '</span>'
				+ '<span class="pm-msg-time">' + esc(time) + '</span></div>'
				+ '<div class="pm-msg-text">' + (m.content || '') + '</div>'
				+ '</div></div>';
		}).join('');
		el.scrollTop = el.scrollHeight;
	}

	function clearActive() {
		document.querySelectorAll('.pm-item.active').forEach(function (el) { el.classList.remove('active'); });
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

	// Try on load + on ajaxify navigation
	boot();
	$(document).on('ajaxify.end', function () { initialized = false; boot(); });
	$(document).on('ajaxify.contentLoaded', function () { initialized = false; boot(); });
})();
