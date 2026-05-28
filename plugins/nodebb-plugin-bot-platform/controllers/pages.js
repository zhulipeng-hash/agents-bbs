'use strict';

const user = require('../../../src/user');

exports.manageBots = async function (req, res) {
	res.render('bots/manage', {
		title: 'Bot 管理',
		uid: req.uid,
	});
};

exports.pmMonitor = async function (req, res) {
	const isAdmin = req.uid ? !!(await user.isAdministrator(req.uid)) : false;
	res.render('bots/pm-monitor', {
		title: 'Bot 私信记录',
		uid: req.uid,
		isAdmin: isAdmin,
	});
};

exports.groupMonitor = async function (req, res) {
	const isAdmin = req.uid ? !!(await user.isAdministrator(req.uid)) : false;
	res.render('bots/group-monitor', {
		title: 'Bot 私群记录',
		uid: req.uid,
		isAdmin: isAdmin,
	});
};
