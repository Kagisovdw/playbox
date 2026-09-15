/* ==========================================================================
   net.js - play across devices on the same Wi-Fi.

   Needs server.js running (see README). Loads harmlessly otherwise: if the
   page came from file:// there is no server to talk to, so the whole feature
   hides itself and the app behaves exactly as it always has.

   THE TRICK
   Every device runs the same game module. The server hands out one seed and
   one ordering of moves, so all devices compute the same board independently.
   A click is not applied where it happens - it is sent to the server, and
   every device (the clicker included) applies it when it comes back. That
   single rule is what keeps them from drifting apart.

   Because moves travel as "the element at this position in the board", this
   layer needs no knowledge of any individual game, and adding a new game
   costs nothing here.
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el, esc = G.escapeHtml;

  var Net = {
    active: false,        // in a room?
    playing: false,       // a game is running
    code: null,
    token: null,
    seat: -1,             // which seat this device controls
    seats: [],
    seed: 0,
    game: null,
    turn: -1,             // seat whose turn it is, reported by the shell
    onStart: null,        // set by app.js
    onReset: null,
    onRoom: null
  };

  // file:// has no server behind it, and neither does GitHub Pages.
  Net.available = location.protocol === 'http:' || location.protocol === 'https:';

  /* ------------------------------------------------------------- transport */

  function api(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.error ? data.error : ('HTTP ' + r.status));
        return data;
      });
    });
  }

  var stream = null;
  var lastEvent = -1;

  function connect() {
    if (stream) stream.close();
    stream = new EventSource('/net/stream?code=' + encodeURIComponent(Net.code) +
      '&token=' + encodeURIComponent(Net.token) + '&from=' + (lastEvent + 1));
    stream.onmessage = function (e) {
      var ev;
      try { ev = JSON.parse(e.data); } catch (err) { return; }
      if (typeof ev.n === 'number') {
        if (ev.n <= lastEvent) return;          // already applied (reconnect replay)
        lastEvent = ev.n;
      }
      handle(ev);
    };
    stream.onerror = function () {
      // EventSource reconnects on its own; `from` resumes exactly where we left off.
      if (Net.active) setStatus('Reconnecting…', true);
    };
  }

  function handle(ev) {
    if (ev.type === 'room') { adopt(ev.room); renderLobby(); return; }
    if (ev.type === 'start') {
      adopt(ev.room);
      Net.playing = true;
      closeModal();
      if (Net.onStart) Net.onStart(ev.room);
      return;
    }
    if (ev.type === 'reset') {
      adopt(ev.room);
      Net.playing = false;
      if (Net.onReset) Net.onReset(ev.room);
      openLobby();
      return;
    }
    if (ev.type === 'input') { applyRemote(ev); return; }
  }

  function adopt(room) {
    if (!room) return;
    Net.code = room.code;
    Net.seats = room.seats || [];
    Net.seed = room.seed;
    Net.game = room.game;
    setStatus('', false);
    updateBadge();
  }

  /* ---------------------------------------------------------- input relay */

  /** Position of a node inside the given root, as a list of child indices. */
  function pathOf(node, root) {
    var out = [];
    while (node && node !== root) {
      var parent = node.parentNode;
      if (!parent) return null;
      out.unshift(Array.prototype.indexOf.call(parent.childNodes, node));
      node = parent;
    }
    return node === root ? out : null;
  }

  function nodeAt(path, root) {
    var node = root;
    for (var i = 0; i < path.length; i++) {
      if (!node || !node.childNodes) return null;
      node = node.childNodes[path[i]];
    }
    return node || null;
  }

  var replaying = false;        // true while applying a move from the server

  /**
   * Swallow clicks on the board and route them through the server instead.
   * Capture phase, so the game's own handler never sees the original event.
   */
  function rootFor(node) {
    var modal = G.$('#modal-layer');
    if (modal && !modal.hidden && modal.contains(node)) {
      // Only dialogs the game marked as a shared decision.
      return modal.classList.contains('is-relayed') ? { node: modal, tag: 'modal' } : null;
    }
    var board = G.$('#game-root');
    if (board && board.contains(node)) return { node: board, tag: null };
    return null;
  }

  function onBoardClick(e) {
    if (!Net.playing || replaying) return;

    // Buttons, plus anything a game marks with data-play (Uno's cards and
    // draw pile are divs, not buttons). Keeping it to an attribute contract
    // means this layer still knows nothing about any particular game.
    var target = e.target.closest ? e.target.closest('button, [data-play]') : null;
    if (!target || target.disabled) return;

    // Buttons marked data-local act on this device only - Restart, Leave.
    if (target.hasAttribute('data-local')) return;

    var found = rootFor(target);
    if (!found) return;
    var root = found.node;

    e.preventDefault();
    e.stopPropagation();

    if (Net.turn >= 0 && Net.turn !== Net.seat) {
      G.toast('Not your turn');
      return;
    }
    var path = pathOf(target, root);
    if (!path) return;
    api('/net/input', {
      code: Net.code, token: Net.token, seat: Net.seat, path: path, tag: found.tag
    }).catch(function (err) { G.toast(err.message); });
  }

  /**
   * Apply a move that came back from the server. Boards animate, so the target
   * may not be ready the instant the message lands - wait for it rather than
   * dropping the move and desyncing.
   */
  function applyRemote(ev) {
    var tries = 0;

    (function attempt() {
      // A relayed dialog may not have opened here yet, so resolve the root
      // each time round rather than once up front.
      var root = ev.tag === 'modal' ? G.$('#modal-layer') : G.$('#game-root');
      var ready = root && (ev.tag !== 'modal' || !root.hidden);
      var node = ready ? nodeAt(ev.path, root) : null;
      var clickable = node && (node.tagName === 'BUTTON' || node.hasAttribute('data-play'));
      if (clickable && !node.disabled) {
        replaying = true;
        try { node.click(); } finally { replaying = false; }
        return;
      }
      if (++tries > 120) {            // ~6s; the boards settle far sooner
        console.warn('[net] could not apply move', ev);
        G.toast('A move could not be applied - devices may be out of step');
        return;
      }
      setTimeout(attempt, 50);
    })();
  }

  document.addEventListener('click', onBoardClick, true);

  // Release the stream promptly on reload or close, for the same reason.
  window.addEventListener('pagehide', function () {
    if (stream) { stream.close(); stream = null; }
  });

  /** The shell reports whose turn it is; that is how we police seat ownership. */
  Net.noteTurn = function (index) {
    Net.turn = typeof index === 'number' ? index : -1;
    if (Net.playing) paintTurn();
  };

  function paintTurn() {
    var root = G.$('#game-root');
    if (!root) return;
    var mine = Net.turn === Net.seat;
    root.classList.toggle('net-waiting', Net.turn >= 0 && !mine);
  }

  /* ------------------------------------------------------------- lobby UI */

  var statusNode = null;

  function setStatus(text, show) {
    if (!statusNode) return;
    statusNode.textContent = text || '';
    statusNode.hidden = !show;
  }

  var closeModal = function () {};

  function openLobby() {
    G.modal({
      title: 'Play across devices',
      body: buildLobby(),
      dismissable: true,
      actions: [{ label: 'Close', value: null, ghost: true }],
      onReady: function (close) { closeModal = close; }
    });
  }

  var lobbyBody = null;

  function buildLobby() {
    lobbyBody = el('div.net-lobby');
    renderLobby();
    return lobbyBody;
  }

  function renderLobby() {
    if (!lobbyBody) return;
    G.clear(lobbyBody);

    if (!Net.active) {
      var nameInput = el('input.seat-name', {
        type: 'text', maxLength: 12, spellcheck: false,
        value: G.Store.get('net.name', 'Player'), 'aria-label': 'Your name'
      });
      var codeInput = el('input.seat-name.net-code-input', {
        type: 'text', maxLength: 4, spellcheck: false,
        placeholder: 'CODE', 'aria-label': 'Room code'
      });

      lobbyBody.appendChild(el('p.muted',
        'Everyone must be on the same Wi-Fi and open this same address.'));
      lobbyBody.appendChild(el('div.net-row', el('span.net-label', 'Your name'), nameInput));
      lobbyBody.appendChild(el('div.net-actions',
        el('button.btn.btn-primary', {
          type: 'button', text: 'Create a room',
          onclick: function () {
            G.Store.set('net.name', nameInput.value);
            api('/net/create', { name: nameInput.value })
              .then(enter).catch(function (e) { G.toast(e.message); });
          }
        })
      ));
      lobbyBody.appendChild(el('div.net-sep', 'or join one'));
      lobbyBody.appendChild(el('div.net-row', codeInput,
        el('button.btn', {
          type: 'button', text: 'Join',
          onclick: function () {
            G.Store.set('net.name', nameInput.value);
            api('/net/join', { code: codeInput.value.toUpperCase(), name: nameInput.value })
              .then(enter).catch(function (e) { G.toast(e.message); });
          }
        })
      ));
      statusNode = el('p.net-status', { hidden: true });
      lobbyBody.appendChild(statusNode);
      return;
    }

    lobbyBody.appendChild(el('p.muted', 'Share this code with the other players'));
    lobbyBody.appendChild(el('div.net-code', { text: Net.code }));

    var list = el('div.ludo-yards');
    Net.seats.forEach(function (s, i) {
      list.appendChild(el('div.ludo-yardrow',
        el('span.seat-dot', { style: { background: s.connected ? 'var(--accent-2)' : 'var(--muted)' } }),
        el('span.fill', { text: s.name + (i === Net.seat ? ' (you)' : '') }),
        el('b', { text: s.connected ? 'ready' : 'away' })
      ));
    });
    lobbyBody.appendChild(list);

    if (Net.seats.length < 2) {
      lobbyBody.appendChild(el('p.muted', 'Waiting for someone to join…'));
    } else {
      lobbyBody.appendChild(el('p.muted',
        'Pick a game from the menu to start it for everyone.'));
    }

    lobbyBody.appendChild(el('div.net-actions',
      el('button.btn.btn-ghost', {
        type: 'button', text: 'Leave room',
        onclick: function () { leave(); renderLobby(); }
      })
    ));

    statusNode = el('p.net-status', { hidden: true });
    lobbyBody.appendChild(statusNode);
  }

  function enter(data) {
    Net.active = true;
    Net.code = data.code;
    Net.token = data.token;
    Net.seat = data.seat;
    lastEvent = -1;
    adopt(data.room);
    connect();
    renderLobby();
    updateBadge();
  }

  function leave() {
    if (stream) { stream.close(); stream = null; }
    Net.active = false;
    Net.playing = false;
    Net.code = Net.token = null;
    Net.seat = -1;
    Net.seats = [];
    updateBadge();
  }

  /* -------------------------------------------------------- menu entry point */

  var badge = null;

  function updateBadge() {
    if (!badge) return;
    badge.classList.toggle('is-on', Net.active);
    badge.textContent = Net.active
      ? 'Room ' + Net.code + ' · ' + Net.seats.length + ' here'
      : 'Play across devices';
  }

  function mount() {
    if (!Net.available) return;           // file:// - nothing to connect to
    var strip = G.$('#stats-strip');
    if (!strip || !strip.parentNode) return;

    // GitHub Pages serves the same files but has no /net endpoints, so ask
    // before offering the button - otherwise it would fail on every click.
    fetch('/net/ping', { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info || !info.playbox) return;
        badge = el('button.net-badge', { type: 'button', onclick: openLobby });
        strip.parentNode.insertBefore(badge, strip);
        updateBadge();
      })
      .catch(function () { /* static hosting - stay hidden */ });
  }

  /* ------------------------------------------------------------- exports */

  Net.startGame = function (gameId, difficulty, options) {
    return api('/net/start', {
      code: Net.code, token: Net.token,
      gameId: gameId, difficulty: difficulty, options: options
    });
  };
  Net.reset = function () {
    if (!Net.active) return Promise.resolve();
    return api('/net/reset', { code: Net.code, token: Net.token }).catch(function () {});
  };
  Net.openLobby = openLobby;
  Net.mount = mount;

  G.Net = Net;
})();
