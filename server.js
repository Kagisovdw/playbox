/* ==========================================================================
   server.js - LAN multiplayer for Playbox.

   Run it on one machine; everyone on the same Wi-Fi opens the address it
   prints. It serves the static files and relays game state between devices.

       node server.js            (then open the URL it prints)
       node server.js 9000       (to pick a different port)

   No dependencies - Node's http module plus lib/ws.js, a small WebSocket
   implementation in this repo. One socket per device, carrying both
   directions, so nothing accumulates against the browser's connection limit.

   HOW DEVICES STAY IN SYNC
   The device whose turn it is plays normally, then sends a *snapshot* of the
   whole game. Everyone else restores that snapshot and re-renders. No device
   replays another's moves, so there is nothing to drift: a device either has
   the latest snapshot or it does not.

   The server keeps the newest snapshot, so a device that reconnects or joins
   late gets the current board. It enforces the one rule it can check without
   knowing any game: a snapshot is only accepted from the seat that the
   previous snapshot said was to move.
   ========================================================================== */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var ws = require('./lib/ws');

var ROOT = __dirname;
var PORT = parseInt(process.argv[2], 10) || 8080;

/* ------------------------------------------------------------ static files */

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  var rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';

  // Keep the request inside the project directory.
  var file = path.normalize(path.join(ROOT, rel));
  if (file.indexOf(ROOT) !== 0) return send(res, 403, 'text/plain', 'Forbidden');

  fs.readFile(file, function (err, data) {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'                 // always serve the current build
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------------- rooms */

/**
 * rooms[code] = {
 *   code, phase: 'lobby' | 'playing',
 *   game: { id, difficulty, options } | null,
 *   snap: newest game snapshot, or null,
 *   seats: [{ name, sock }]
 * }
 */
var rooms = Object.create(null);

function roomCode() {
  var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1
  var out = '';
  for (var i = 0; i < 4; i++) out += letters[crypto.randomInt(letters.length)];
  return rooms[out] ? roomCode() : out;
}

function publicRoom(room) {
  return {
    code: room.code,
    phase: room.phase,
    game: room.game,
    seats: room.seats.map(function (s, i) {
      return { index: i, name: s.name, connected: !!s.sock };
    })
  };
}

function sendTo(sock, msg) { if (sock) sock.send(JSON.stringify(msg)); }

function broadcast(room, msg, exceptSeat) {
  var text = JSON.stringify(msg);
  room.seats.forEach(function (seat, i) {
    if (i === exceptSeat || !seat.sock) return;
    seat.sock.send(text);
  });
}

function announce(room) { broadcast(room, { t: 'room', room: publicRoom(room) }); }

/* ------------------------------------------------------------- the protocol */

function handle(state, msg) {
  var sock = state.sock;

  if (msg.t === 'create') {
    if (state.room) return sendTo(sock, { t: 'error', message: 'Already in a room' });
    var code = roomCode();
    var room = { code: code, phase: 'lobby', game: null, snap: null, seats: [], touched: Date.now() };
    rooms[code] = room;
    room.seats.push({ name: String(msg.name || 'Player 1').slice(0, 12), sock: sock });
    state.room = room;
    state.seat = 0;
    sendTo(sock, { t: 'joined', code: code, seat: 0, room: publicRoom(room) });
    return;
  }

  if (msg.t === 'join') {
    if (state.room) return sendTo(sock, { t: 'error', message: 'Already in a room' });
    var target = rooms[String(msg.code || '').toUpperCase()];
    if (!target) return sendTo(sock, { t: 'error', message: 'No room with that code' });
    if (target.seats.length >= 4) return sendTo(sock, { t: 'error', message: 'That room is full' });
    if (target.phase === 'playing') {
      return sendTo(sock, { t: 'error', message: 'That game has already started' });
    }
    target.seats.push({
      name: String(msg.name || ('Player ' + (target.seats.length + 1))).slice(0, 12),
      sock: sock
    });
    state.room = target;
    state.seat = target.seats.length - 1;
    sendTo(sock, { t: 'joined', code: target.code, seat: state.seat, room: publicRoom(target) });
    announce(target);
    return;
  }

  if (!state.room) return sendTo(sock, { t: 'error', message: 'Not in a room' });
  var room = state.room;
  room.touched = Date.now();

  if (msg.t === 'start') {
    if (room.phase === 'playing') return;
    room.phase = 'playing';
    room.snap = null;
    room.game = {
      id: String(msg.gameId || ''),
      difficulty: String(msg.difficulty || 'normal'),
      options: (msg.options && typeof msg.options === 'object') ? msg.options : {}
    };
    broadcast(room, { t: 'start', room: publicRoom(room) });
    sendTo(sock, { t: 'start', room: publicRoom(room) });
    return;
  }

  if (msg.t === 'state') {
    if (room.phase !== 'playing') return;

    // Only the seat the board says is to move may change the board. A device
    // whose snapshot is refused is sent the current one instead, so a stale
    // client corrects itself rather than corrupting anyone else's game.
    var owner = (room.snap && typeof room.snap.turn === 'number') ? room.snap.turn : -1;
    if (owner >= 0 && owner !== state.seat) {
      sendTo(sock, { t: 'state', snap: room.snap });
      return;
    }
    room.snap = msg.snap;
    broadcast(room, { t: 'state', snap: msg.snap }, state.seat);
    return;
  }

  if (msg.t === 'reset') {
    room.phase = 'lobby';
    room.game = null;
    room.snap = null;
    broadcast(room, { t: 'reset', room: publicRoom(room) });
    sendTo(sock, { t: 'reset', room: publicRoom(room) });
    return;
  }
}

/* ------------------------------------------------------------------- serve */

var server = http.createServer(function (req, res) {
  var q = req.url.indexOf('?');
  var urlPath = q === -1 ? req.url : req.url.slice(0, q);
  // Lets the page tell "served by server.js" from "static hosting", so the
  // across-devices button never appears where nothing can answer it.
  if (urlPath === '/net/ping') {
    return send(res, 200, 'application/json; charset=utf-8', '{"playbox":true}');
  }
  serveStatic(req, res, urlPath);
});

ws.attach(server, function (sock) {
  var state = { sock: sock, room: null, seat: -1 };

  sock.on('message', function (text) {
    var msg;
    try { msg = JSON.parse(text); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { handle(state, msg); }
    catch (e) { sendTo(sock, { t: 'error', message: 'Server error' }); }
  });

  sock.on('close', function () {
    var room = state.room;
    if (!room) return;
    if (room.seats[state.seat]) room.seats[state.seat].sock = null;
    announce(room);
  });
});

/** Every IPv4 address another device could reach this machine on. */
function addresses() {
  var out = [];
  var nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (net) {
      if (net.family === 'IPv4' && !net.internal) out.push({ name: name, address: net.address });
    });
  });
  return out;
}

// Drop rooms nobody has touched for an hour.
setInterval(function () {
  var cutoff = Date.now() - 3600000;
  Object.keys(rooms).forEach(function (code) {
    var room = rooms[code];
    if (room.seats.some(function (s) { return s.sock; })) room.touched = Date.now();
    else if ((room.touched || 0) < cutoff) delete rooms[code];
  });
}, 300000).unref();

server.listen(PORT, '0.0.0.0', function () {
  var list = addresses();
  console.log('');
  console.log('  Playbox is serving on port ' + PORT);
  console.log('');
  console.log('  On this machine:  http://localhost:' + PORT);
  if (list.length) {
    console.log('  On your Wi-Fi:');
    list.forEach(function (n) {
      console.log('    http://' + n.address + ':' + PORT + '   (' + n.name + ')');
    });
    console.log('');
    console.log('  Open one of the Wi-Fi addresses on the other devices.');
  } else {
    console.log('  No network address found - this machine may be offline.');
  }
  console.log('  Stop with Ctrl+C.');
  console.log('');
});
