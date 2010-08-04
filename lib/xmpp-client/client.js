var sys = require('sys'),
	xmpp = require('xmpp'),
	events = require('events');

var Jid = function(plain) {
	var tmp = plain.split('/');
	this.resource = (tmp.length == 1) ? 'node' : tmp[1];
	tmp = tmp[0].split('@');
	this.node = tmp[0];
	this.domain = tmp[1];
};

exports.Jid = Jid;

Jid.prototype.toString = function() {
	return this.node + '@' + this.domain + '/' + this.resource;
};

var Client = function(_jid, password, host) {
	events.EventEmitter.call(this);
	this.debug = true;
	var jabber = this;
	this.jid = new Jid(_jid);
	this.host = (host == null) ? this.jid.domain : host;
	this.rooms = {};
	this._iq = 0;
	this._iqCallback = {};
	this.xmpp = new xmpp.Client({
		host: this.host,
		jid: '' + this.jid,
		password: password });
	this.xmpp.addListener('rawStanza', function(stanza) {
		sys.debug("RAW: " + stanza);
	});
	this.xmpp.addListener('authFail', function() {
		sys.error("[Error] Jabber : Authentication failure");
		process.exit(1);
	});
	this.xmpp.addListener('error', function(e) {
		sys.error(e);
		process.exit(1);
	});
	this.xmpp.addListener('stanza', function(stanza) {
		sys.debug('STANZA: ' + stanza);
		if(stanza.name == 'iq') {
			if(stanza.attrs.type == 'result') {
				this._debug('IQ result: ' + stanza);
				jabber.emit('iqResult', stanza.attrs.id, stanza);
			} else {
				this._debug('IQ: ' + stanza);
				jabber.emit('iq', stanza);
			}
		}
		if(stanza.name == 'presence') {
			var fromm = stanza.attrs.from.split('/')[0].split('@');
			if(fromm[1] == 'conference.ohmforce.net') {
				jabber.rooms[fromm[0]].emit('presence', stanza);
			} else {
				jabber.emit('presence', stanza);
			}
		}
		if(stanza.name == 'message') {
			var from = stanza.attrs.from;
			if(stanza.attrs.type == 'groupchat') {
				jabber.emit('groupchat', from, stanza);
			} else {
				this._debug('MESSAGE: ' + stanza);
				jabber.emit('message', from, stanza);
			}
		}
	});
	this.xmpp.addListener('online', function() {
		jabber._debug("[Info] xmpp connection");
		jabber.presence();
		jabber.iq(new xmpp.Element('query', {xmlns: 'jabber:iq:roster'}), function(iq) {
			this._debug("MY ROSTER" + iq);
		});
		jabber.emit('online');
	});
	this.addListener('groupchat', function(from, stanza) {
		fromName = from.split('@')[0];
		jabber.rooms[fromName].emit('message', stanza);
	});
	this.addListener('iqResult', function(id, stanza){
		jabber._iqCallback[id].call(jabber, stanza);
	});
};

sys.inherits(Client, events.EventEmitter);
exports.Client = Client;

Client.prototype._debug = function(txt) {
	if(this.debug) {
		sys.debug(txt);
	}
};

Client.prototype.message = function(to, message) {
	this.xmpp.send(new xmpp.Element('message', {
		to: to,
		type: 'chat'}).
		c('body').
		t(message));
};

Client.prototype.iq = function(iq, callback) {
	var n = this._iq++;
	this._iqCallback[n] = callback;
	this.xmpp.send(new xmpp.Element('iq', {type:"get", id: n}).cnode(iq).tree());
};

Client.prototype.presence = function() {
	this.xmpp.send(new xmpp.Element('presence', {type: 'available'}).tree());
};

Client.prototype.disconnect = function() {
	this.xmpp.send(new xmpp.Element('presence', {type: 'unavailable'})
		.c('status')
		.t('Logged out')
		.tree());
	var jabber = this;
/*	Object.keys(this.rooms).forEach(function(room) {
		jabber.rooms[room].leave();
	});*/
	this.xmpp.end();
	sys.debug("disconnect from XMPP");
};
