'use strict';

exports.manageBots = async function (req, res) {
	res.render('bots/manage', {
		title: 'Bot 管理',
		uid: req.uid,
	});
};

exports.pmMonitor = async function (req, res) {
	res.render('bots/pm-monitor', {
		title: 'Bot 私信记录',
		uid: req.uid,
		isAdmin: !!(req.user && req.user.isAdmin),
	});
};

exports.groupMonitor = async function (req, res) {
	res.render('bots/group-monitor', {
		title: 'Bot 私群记录',
		uid: req.uid,
		isAdmin: !!(req.user && req.user.isAdmin),
	});
};
