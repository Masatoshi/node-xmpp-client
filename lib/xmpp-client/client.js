var sys = require('sys'),
	xmpp = require('xmpp'),
	colors = require('colors'),
	events = require('events');

var Client = function(params, callback) {
	events.EventEmitter.call(this);
	this.color = (params.color != null) ? params.color : 'blue';
	this.debug = true;
	var jabber = this;
	this.jid = new xmpp.JID(params.jid);
	this.host = (params.host == null) ? this.jid.domain : params.host;
	this.rooms = {};
	this._iq = 0;
	this._iqHandler = {};
	this._iqCallback = {};
	this.presences = {};
	this.roster = {};
	this.xmpp = new xmpp.Client(params);
	this.xmpp.addListener('rawStanza', function(stanza) {
		//sys.debug("RAW: "[jabber.color] + stanza.toString().white);
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
		sys.debug('STANZA: '[jabber.color] + ('<' + stanza.name + '> ').bold[jabber.color] + stanza);
		if(stanza.name == 'iq') {
			if(stanza.attrs.type == 'result') {
				jabber._debug('IQ result: ' + stanza);
				jabber.emit('iqResult', stanza.attrs.id, stanza);
			} else {
				jabber._debug(('IQ: ' + stanza)[jabber.color]);
				jabber.emit('iq', stanza);
				var q = stanza.getChild('query');
				if(q.attrs.xmlns != null && jabber._iqHandler[q.attrs.xmlns] != null) {
					jabber._iqHandler[q.attrs.xmlns].call(jabber, stanza);
				} else {
					jabber.emit('iq:unknow', stanza);
				}
			}
		}
		if(stanza.name == 'presence') {
			var jfrom = new xmpp.JID(stanza.attrs.from);
			var roomName = jfrom.user + '@' + jfrom.domain;
			if(stanza.attrs.type == 'error') {
				sys.error(stanza.toString().inverse);
				if(jabber.rooms[roomName] != null) {
					jabber.rooms[roomName].emit('presence:error', stanza.getChild('error'), stanza);
				} else {
					jabber.emit('presence:error', stanza.getChild('error'), stanza);
				}
			} else {
				if(jabber.rooms[roomName] != null) {
					jabber.rooms[roomName].emit('presence', stanza.attrs.from, stanza);
				} else {
					jabber.emit('presence', stanza.attrs.from, stanza);
				}
			}
		}
		if(stanza.name == 'message') {
			var from = stanza.attrs.from;
			if(stanza.attrs.type == 'groupchat') {
				jabber.emit('groupchat', from, stanza);
			} else {
				jabber._debug('MESSAGE: ' + stanza);
				jabber.emit('message', from, stanza.getChild('body').getText(), stanza);
			}
		}
	});
	this.xmpp.addListener('online', function() {
		jabber._debug("[Info] xmpp connection");
		jabber.presence();
		jabber.emit('online');
		jabber.askForRoster(function(roster) {
			jabber._debug("ROSTER : "[jabber.color] + JSON.stringify(roster));
			if(callback != null) {
				callback.call(jabber);
			}
		});
	});
	this.addListener('groupchat', function(from, stanza) {
		fromName = from.split('@')[0];
		jabber.rooms[fromName].emit('message', stanza);
	});
	this.addListener('iqResult', function(id, stanza){
		jabber._iqCallback[id].call(jabber, stanza);
	});
	this.addListener('presence', function(from, stanza) {
		if(stanza.attrs.type == 'error') {
			var jfrom = new JID(stanza.attrs.from);
			var roomName = jfrom.user + '@' + jfrom.domain;
			if(this.rooms[roomName] != null) {
				
			}
		} else {
			jabber.presences[from] = stanza.attrs.type;
		}
	});
	this.registerIqHandler('http://jabber.org/protocol/disco#info', function(stanza) {
		sys.debug((stanza.attrs.from + " wont to disco!")[jabber.color]);
		jabber.resultIq(stanza, new xmpp.Element('query', {xmlns: 'http://jabber.org/protocol/disco#info'})
		.c('feature', {'var': 'http://jabber.org/protocol/disco#info'}).up()
		.c('feature', {'var': 'http://jabber.org/protocol/disco#items'}).up()
		.c('feature', {'var': 'http://jabber.org/protocol/muc'}).up()
		.c('identity', {
			category: 'conference',
			type: 'text',
			name: 'Play-Specific Chatrooms'
		}).up()
		.tree()
		);
	});
	this.registerIqHandler('jabber:iq:last', function(stanza) {
		sys.debug((stanza.attrs.from + ' wonts last')[jabber.color]);
		//[FIXME] giving a good last time
		jabber.resultIq(stanza, new xmpp.Element('query', {
			xmlns: 'jabber:iq:last', seconds:'1'})
			.tree()
		);
	});
	this.registerIqHandler('jabber:iq:version', function(stanza) {
		jabber.resultIq(stanza, new xmpp.Element('query', {xmlns:'jabber:iq:version'})
			.c('name').t('node-xmpp-client').up()
			.c('version').t('0.0.1').up()
			.c('os').t(process.platform).up()
			.tree()
		);
	});
	this.addListener('iq', function(stanza) {
		sys.debug(stanza.getChild('query').toString().yellow);
	});
};

sys.inherits(Client, events.EventEmitter);
exports.Client = Client;

Client.prototype._debug = function(txt) {
	if(this.debug) {
		sys.debug(txt);
	}
};

Client.prototype.registerIqHandler = function(xmlns, action) {
	this._iqHandler[xmlns] = action;
};

Client.prototype.message = function(to, message) {
	this.xmpp.send(new xmpp.Element('message', {
		to: to,
		type: 'chat'}).
		c('body').
		t(message));
};

Client.prototype.askForRoster = function(callback) {
	var jabber = this;
	this.iq(new xmpp.Element('query', {xmlns: 'jabber:iq:roster'}), function(iq) {
		iq.getChild('query', 'jabber:iq:roster').children.forEach(function(child) {
			jabber.roster[child.attrs.jid] = {
				name: child.attrs.name,
				subscription: child.attrs.subscription};
		});
		if(callback != null) {
			callback.call(jabber, jabber.roster);
		}
		jabber.emit('roster', jabber.roster);
	});
};

Client.prototype.iq = function(iq, callback) {
	var n = this._iq++;
	this._iqCallback[n] = callback;
	this.xmpp.send(new xmpp.Element('iq', {type:"get", id: n}).cnode(iq).tree());
};

Client.prototype.resultIq = function(iqGet, result) {
	this.xmpp.send(new xmpp.Element('iq', {
		type: 'result',
		from: iqGet.attrs.to,
		to: iqGet.attrs.from,
		id: iqGet.attrs.id
	}).cnode(result).tree());
};

Client.prototype.presence = function(type) {
	this.xmpp.send(new xmpp.Element('presence', (type != null) ? {type: type} : {}).tree());
};

Client.prototype.canonicalRoomName = function(room) {
	if(room.indexOf('@') > 0) {
		return room;
	} else {
		return room + '@conference.' + this.client.jid.domain;
	}
};

Client.prototype.room = function(name, callback) {
	var room = this.canonicalRoomName(name);
	if(this.rooms[room] == null) {
		this.rooms[room] = new Room(this, room, callback);
	}
	return this.rooms[room];
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

var Room = function(client, name, callback) {
	events.EventEmitter.call(this);
	this.client = client;
	this.room = name;
	var room = this;
	this.addListener('presence', function(from, stanza) {
		var jfrom = new xmpp.JID(from);
		if(name == jfrom.user + '@' + jfrom.domain) {
			var x = stanza.getChild('x', 'http://jabber.org/protocol/muc#user');
			if(x != null) {
				var item = x.getChild('item');
				if(item != null) {
					room.affiliation = item.attrs.affiliation;
					room.role = item.attrs.role;
				}
				var status = x.getChild('status');
				callback.call(room, (status != null) ? status.attrs.code : '200');
			}
		}
	});
	this.presence();
};

sys.inherits(Room, events.EventEmitter);

exports.Room = Room;

Room.prototype.presence = function() {
	this.client.xmpp.send(new xmpp.Element('presence', {
			to: this.room + '/' + this.client.jid.user
		})
		.c('priority').t("5").up()
		.c('x', {xmlns:"http://jabber.org/protocol/muc"})
		.tree()
	);
};

Room.prototype.message = function(msg) {
	
};