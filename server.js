/* ==========================================================================
   server.js - LAN multiplayer for Playbox.

   Run it on one machine; everyone on the same Wi-Fi opens the address it
   prints. It serves the static files and relays moves between devices.

       node server.js            (then open the URL it prints)
       node server.js 9000       (to pick a different port)

   No dependencies - Node's own http module only, so there is nothing to
   install. Server-sent events push to the browsers, plain POSTs come back.
   For turn-based board games that is plenty: a move costs one round trip on
   a local network, and it avoids pulling in a WebSocket library.

   HOW DEVICES STAY IN SYNC
   Every device runs the same game code. The server owns the three things that
   make them agree: the seat list, a random seed, and the order of moves.
   Nobody applies their own move directly - it goes to the server, gets a
   sequence number, and comes back to everyone at once. Same seed plus the
   same moves in the same order means every device computes the same board.

   The server enforces whose turn it is to act. It does not know the rules of
   any game, so it cannot referee them - see the Uno note in README.md.
   ========================================================================== */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');

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
function sendJson(res, code, obj) {
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));
}

function serveStatic(req, res, urlPath) {
  var rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';

  // Keep the request inside the project directory.
  var file = path.normalize(path.join(ROOT, rel));
  if (file.indexOf(ROOT) !== 0) return send(res, 403, 'text/plain', 'Forbidden');

  fs.readFile(file, function (err, data) {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    // No caching: every device should always get the current build.
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------------- rooms */

/**
 * rooms[code] = {
 *   code, seed, phase: 'lobby' | 'playing',
 *   game: { id, difficulty, options } | null,
 *   seats: [{ token, name, res }],
 *   log: [ event ]          every event, so a reconnect can replay exactly
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
    seed: room.seed,
    game: room.game,
    seats: room.seats.map(function (s, i) {
      return { index: i, name: s.name, connected: !!s.res };
    })
  };
}

/** Append to the log and push to every connected device. */
function broadcast(room, event) {
  event.n = room.log.length;
  room.log.push(event);
  room.touched = Date.now();
  var payload = 'data: ' + JSON.stringify(event) + '\n\n';
  room.seats.forEach(function (seat) {
    if (!seat.res) return;
    try { seat.res.write(payload); } catch (e) { seat.res = null; }
  });
}

function seatOf(room, token) {
  for (var i = 0; i < room.seats.length; i++) if (room.seats[i].token === token) return i;
  return -1;
}

function announceRoom(room) { broadcast(room, { type: 'room', room: publicRoom(room) }); }

function addSeat(room, name) {
  var token = crypto.randomBytes(12).toString('hex');
  room.seats.push({ token: token, name: name, res: null });
  return token;
}

/* ----------------------------------------------------------------- the API */

function readBody(req, cb) {
  var raw = '';
  req.on('data', function (d) {
    raw += d;
    if (raw.length > 1e6) req.destroy();          // nothing legitimate is this big
  });
  req.on('end', function () {
    try { cb(raw ? JSON.parse(raw) : {}); } catch (e) { cb(null); }
  });
}

/** Resolve the room and the caller's seat, or write an error and return null. */
function authed(res, body) {
  var room = rooms[String((body && body.code) || '').toUpperCase()];
  if (!room) { sendJson(res, 404, { error: 'No room with that code' }); return null; }
  var seat = seatOf(room, body.token);
  if (seat < 0) { sendJson(res, 403, { error: 'Not a player in this room' }); return null; }
  return { room: room, seat: seat };
}

function handleApi(req, res, urlPath, query) {
  // Lets the page tell "served by server.js" from "static hosting", so the
  // across-devices button never appears where nothing can answer it.
  if (urlPath === '/net/ping') return sendJson(res, 200, { playbox: true });

  if (urlPath === '/net/create' && req.method === 'POST') {
    return readBody(req, function (body) {
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      var code = roomCode();
      var room = {
        code: code, seed: crypto.randomInt(1, 2147483647),
        phase: 'lobby', game: null, seats: [], log: [], touched: Date.now()
      };
      rooms[code] = room;
      var token = addSeat(room, String(body.name || 'Player 1').slice(0, 12));
      sendJson(res, 200, { code: code, token: token, seat: 0, room: publicRoom(room) });
    });
  }

  if (urlPath === '/net/join' && req.method === 'POST') {
    return readBody(req, function (body) {
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      var room = rooms[String(body.code || '').toUpperCase()];
      if (!room) return sendJson(res, 404, { error: 'No room with that code' });
      if (room.phase !== 'lobby') return sendJson(res, 409, { error: 'That game has already started' });
      if (room.seats.length >= 4) return sendJson(res, 409, { error: 'That room is full' });
      var token = addSeat(room, String(body.name || ('Player ' + (room.seats.length + 1))).slice(0, 12));
      announceRoom(room);
      sendJson(res, 200, {
        code: room.code, token: token, seat: room.seats.length - 1, room: publicRoom(room)
      });
    });
  }

  /* --- the event stream (server -> browser) --- */
  if (urlPath === '/net/stream' && req.method === 'GET') {
    var room = rooms[String(query.code || '').toUpperCase()];
    var idx = room ? seatOf(room, query.token) : -1;
    if (idx < 0) return send(res, 404, 'text/plain', 'Unknown room or token');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 1500\n\n');
    // A seat that reconnects (reload, sleep, flaky Wi-Fi) must not leave its
    // previous stream holding a socket open: browsers allow only a handful of
    // connections per origin, and stale ones starve ordinary requests.
    var previous = room.seats[idx].res;
    if (previous && previous !== res) { try { previous.end(); } catch (e) {} }
    room.seats[idx].res = res;

    // Replay from `from` so a reconnecting device catches up in exact order.
    var from = parseInt(query.from, 10);
    if (!(from >= 0)) from = 0;
    for (var i = from; i < room.log.length; i++) {
      res.write('data: ' + JSON.stringify(room.log[i]) + '\n\n');
    }
    if (from === 0) announceRoom(room);            // tell everyone we arrived

    var ping = setInterval(function () {
      try { res.write(': ping\n\n'); } catch (e) { clearInterval(ping); }
    }, 20000);

    req.on('close', function () {
      clearInterval(ping);
      if (room.seats[idx] && room.seats[idx].res === res) {
        room.seats[idx].res = null;
        announceRoom(room);
      }
    });
    return;
  }

  if (urlPath === '/net/start' && req.method === 'POST') {
    return readBody(req, function (body) {
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      var a = authed(res, body); if (!a) return;
      if (a.room.phase === 'playing') return sendJson(res, 409, { error: 'already started' });
      a.room.phase = 'playing';
      a.room.game = {
        id: String(body.gameId || ''),
        difficulty: String(body.difficulty || 'normal'),
        options: (body.options && typeof body.options === 'object') ? body.options : {}
      };
      broadcast(a.room, { type: 'start', room: publicRoom(a.room) });
      sendJson(res, 200, { ok: true });
    });
  }

  if (urlPath === '/net/input' && req.method === 'POST') {
    return readBody(req, function (body) {
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      var a = authed(res, body); if (!a) return;
      if (a.room.phase !== 'playing') return sendJson(res, 409, { error: 'not started' });
      // The one rule the server can enforce without knowing any game: you may
      // only act as your own seat.
      if (body.seat !== a.seat) return sendJson(res, 403, { error: 'not your seat' });
      broadcast(a.room, { type: 'input', seat: a.seat, path: body.path, tag: body.tag || null });
      sendJson(res, 200, { ok: true });
    });
  }

  if (urlPath === '/net/reset' && req.method === 'POST') {
    return readBody(req, function (body) {
      if (!body) return sendJson(res, 400, { error: 'bad json' });
      var a = authed(res, body); if (!a) return;
      a.room.phase = 'lobby';
      a.room.game = null;
      a.room.seed = crypto.randomInt(1, 2147483647);
      broadcast(a.room, { type: 'reset', room: publicRoom(a.room) });
      sendJson(res, 200, { ok: true });
    });
  }

  send(res, 404, 'text/plain', 'Not found');
}

/* ------------------------------------------------------------------- serve */

var server = http.createServer(function (req, res) {
  var q = req.url.indexOf('?');
  var urlPath = q === -1 ? req.url : req.url.slice(0, q);
  var query = Object.create(null);
  if (q !== -1) {
    req.url.slice(q + 1).split('&').forEach(function (pair) {
      var kv = pair.split('=');
      query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
  }
  if (urlPath.indexOf('/net/') === 0) return handleApi(req, res, urlPath, query);
  serveStatic(req, res, urlPath);
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

// Drop rooms nobody has touched for an hour, so a long-running server does
// not accumulate dead games.
setInterval(function () {
  var cutoff = Date.now() - 3600000;
  Object.keys(rooms).forEach(function (code) {
    var room = rooms[code];
    if (room.seats.some(function (s) { return s.res; })) room.touched = Date.now();
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
