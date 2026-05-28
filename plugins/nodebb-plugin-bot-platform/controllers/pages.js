'use strict';

exports.manageBots = async function (req, res) {
	res.render('bots/manage', {
		title: 'Bot 管理',
		uid: req.uid,
	});
};
