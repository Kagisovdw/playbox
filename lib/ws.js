/* ==========================================================================
   lib/ws.js - a small WebSocket server, built on Node's http module only.

   Enough of RFC 6455 to carry JSON between the browser and server.js:
   the upgrade handshake, masked client frames, fragmentation, ping/pong and
   a clean close. Deliberately not a general-purpose library - no extensions,
   no compression, no binary payloads.

   Why not server-sent events: SSE needs a second HTTP request for every
   message going back, and both count against the browser's six-connections-
   per-origin limit. A WebSocket is one connection that does not count at all,
   which removes a whole class of "the page stopped responding" bugs.

       var ws = require('./lib/ws');
       ws.attach(httpServer, function (sock) {
         sock.on('message', function (text) { sock.send('echo: ' + text); });
         sock.on('close', function () {});
       });
   ========================================================================== */
'use strict';

var crypto = require('crypto');
var EventEmitter = require('events');

var GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

var OP_CONT = 0x0, OP_TEXT = 0x1, OP_BIN = 0x2;
var OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xa;

var MAX_MESSAGE = 4 * 1024 * 1024;      // a snapshot is kilobytes; this is slack

/** One connected browser. Emits 'message' (string) and 'close'. */
function Socket(raw) {
  EventEmitter.call(this);
  this.raw = raw;
  this.open = true;

  var self = this;
  var buf = Buffer.alloc(0);
  var fragments = [];                    // parts of a fragmented message
  var fragmentOp = 0;

  raw.on('data', function (chunk) {
    buf = Buffer.concat([buf, chunk]);
    // Pull out as many complete frames as the buffer holds.
    for (;;) {
      var frame = readFrame(buf);
      if (!frame) break;                 // need more bytes
      buf = buf.slice(frame.size);
      handleFrame(frame);
    }
  });

  function handleFrame(frame) {
    if (frame.opcode === OP_CLOSE) { self.close(); return; }
    if (frame.opcode === OP_PING) { self.frame(OP_PONG, frame.payload); return; }
    if (frame.opcode === OP_PONG) return;

    if (frame.opcode === OP_CONT) {
      if (!fragments.length) return;     // continuation with nothing to continue
      fragments.push(frame.payload);
    } else if (frame.opcode === OP_TEXT || frame.opcode === OP_BIN) {
      fragments = [frame.payload];
      fragmentOp = frame.opcode;
    } else {
      return;                            // reserved opcode
    }

    if (!frame.fin) return;
    var whole = Buffer.concat(fragments);
    fragments = [];
    if (fragmentOp === OP_TEXT) self.emit('message', whole.toString('utf8'));
  }

  raw.on('error', function () { self.close(); });
  raw.on('close', function () {
    if (!self.open) return;
    self.open = false;
    self.emit('close');
  });
}
Socket.prototype = Object.create(EventEmitter.prototype);
Socket.prototype.constructor = Socket;

Socket.prototype.frame = function (opcode, payload) {
  if (!this.open) return false;
  payload = payload || Buffer.alloc(0);
  var len = payload.length;
  var header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    // Payloads never approach 2^32 here, so the high word stays zero.
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode;             // FIN, no reserved bits

  try {
    this.raw.write(Buffer.concat([header, payload]));
    return true;
  } catch (e) {
    this.close();
    return false;
  }
};

Socket.prototype.send = function (text) {
  return this.frame(OP_TEXT, Buffer.from(String(text), 'utf8'));
};

Socket.prototype.ping = function () { return this.frame(OP_PING, Buffer.alloc(0)); };

Socket.prototype.close = function () {
  if (!this.open) return;
  this.open = false;
  try { this.frame(OP_CLOSE, Buffer.alloc(0)); } catch (e) { /* already gone */ }
  try { this.raw.end(); } catch (e) { /* already gone */ }
  this.emit('close');
};

/** Decode one frame, or null when the buffer does not hold a whole one yet. */
function readFrame(buf) {
  if (buf.length < 2) return null;

  var b0 = buf[0], b1 = buf[1];
  var fin = (b0 & 0x80) !== 0;
  var opcode = b0 & 0x0f;
  var masked = (b1 & 0x80) !== 0;
  var len = b1 & 0x7f;
  var offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    var high = buf.readUInt32BE(offset);
    len = buf.readUInt32BE(offset + 4);
    if (high !== 0 || len > MAX_MESSAGE) return { oversize: true, size: buf.length };
    offset += 8;
  }
  if (len > MAX_MESSAGE) return { oversize: true, size: buf.length };

  var mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;

  var payload = Buffer.from(buf.slice(offset, offset + len));
  // Browsers always mask; unmask in place.
  if (mask) for (var i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];

  return { fin: fin, opcode: opcode, payload: payload, size: offset + len };
}

/**
 * Take over `server`'s upgrade requests. `onConnection(socket, req)` is called
 * once the handshake completes.
 */
function attach(server, onConnection) {
  server.on('upgrade', function (req, raw) {
    var key = req.headers['sec-websocket-key'];
    var version = req.headers['sec-websocket-version'];

    if (!key || String(version) !== '13' ||
        String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      raw.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      raw.destroy();
      return;
    }

    var accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    raw.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );

    raw.setNoDelay(true);                // turn-based moves want latency, not throughput
    onConnection(new Socket(raw), req);
  });
}

module.exports = { attach: attach, Socket: Socket };
