/* ==========================================================================
   net.js - play across devices on the same Wi-Fi.

   Needs server.js running. If the page came from file:// or from static
   hosting there is nothing to talk to, so the feature hides itself entirely
   and the app behaves exactly as it always has.

   HOW IT WORKS
   Whoever's turn it is plays normally - no interception, no replaying. When
   their move settles, this layer sends a *snapshot* of the game and every
   other device restores it. Devices cannot drift apart, because none of them
   is recomputing anything: they either have the newest snapshot or they do
   not. It also means a game only needs two small methods to be playable
   across devices, and nothing here knows how any of them work.

   A game opts in by returning `snapshot()` and `restore(snap)` from start().
   The snapshot must be plain JSON and must carry a `turn` field naming the
   seat to move; that is what the server uses to decide who may change the
   board.
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el;

  var Net = {
    available: location.protocol === 'http:' || location.protocol === 'https:',
    active: false,        // in a room?
    playing: false,       // a game is running
    code: null,
    seat: -1,             // which seat this device controls
    seats: [],
    game: null,
    turn: -1,             // seat whose turn it is, as reported by the shell
    onStart: null,        // set by app.js
    onReset: null,
    onState: null,        // app.js hands the snapshot to the running game
    getSnapshot: null     // app.js asks the running game for one
  };

  /* ------------------------------------------------------------- transport */

  var sock = null;
  var sendQueue = [];
  var restoring = false;       // true while applying a snapshot from elsewhere
  var pendingPush = false;     // this device made a move that others need
  var pushTimer = null;

  function wsUrl() {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/';
  }

  function connect(onReady) {
    sock = new WebSocket(wsUrl());
    sock.onopen = function () {
      while (sendQueue.length) sock.send(sendQueue.shift());
      if (onReady) onReady();
    };
    sock.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      handle(msg);
    };
    sock.onclose = function () {
      sock = null;
      if (Net.active) {
        setStatus('Disconnected — reopen the page to rejoin', true);
        Net.active = false;
        Net.playing = false;
        updateBadge();
        renderLobby();
      }
    };
    sock.onerror = function () { setStatus('Could not reach the server', true); };
  }

  function send(msg) {
    var text = JSON.stringify(msg);
    if (sock && sock.readyState === 1) sock.send(text);
    else sendQueue.push(text);
  }

  function handle(msg) {
    if (msg.t === 'error') { G.toast(msg.message || 'Something went wrong'); return; }

    if (msg.t === 'joined') {
      Net.active = true;
      Net.code = msg.code;
      Net.seat = msg.seat;
      adopt(msg.room);
      renderLobby();
      return;
    }

    if (msg.t === 'room') { adopt(msg.room); renderLobby(); return; }

    if (msg.t === 'start') {
      adopt(msg.room);
      Net.playing = true;
      pendingPush = false;
      closeModal();
      if (Net.onStart) Net.onStart(msg.room);
      return;
    }

    if (msg.t === 'state') {
      if (!Net.playing || !Net.onState || !msg.snap) return;
      restoring = true;
      try { Net.onState(msg.snap); }
      catch (e) { console.error('[net] could not restore', e); }
      restoring = false;
      // A snapshot from elsewhere supersedes anything we were about to send.
      pendingPush = false;
      return;
    }

    if (msg.t === 'reset') {
      adopt(msg.room);
      Net.playing = false;
      pendingPush = false;
      if (Net.onReset) Net.onReset(msg.room);
      openLobby();
      return;
    }
  }

  function adopt(room) {
    if (!room) return;
    Net.code = room.code;
    Net.seats = room.seats || [];
    Net.game = room.game;
    updateBadge();
  }

  /* -------------------------------------------------------------- the sync */

  /**
   * Stop a device acting out of turn. Every device renders the same board, so
   * without this anyone could click the current player's controls.
   */
  function onClickCapture(e) {
    if (!Net.playing) return;
    var root = G.$('#game-root');
    var modal = G.$('#modal-layer');
    var inGame = root && root.contains(e.target);
    var inModal = modal && !modal.hidden && modal.contains(e.target);
    if (!inGame && !inModal) return;

    var target = e.target.closest ? e.target.closest('button, [data-play]') : null;
    if (!target || target.disabled) return;
    if (target.hasAttribute('data-local')) return;      // Restart and friends

    if (Net.turn >= 0 && Net.turn !== Net.seat) {
      e.preventDefault();
      e.stopPropagation();
      G.toast('Not your turn');
      return;
    }
    // Ours to make: let it through, then broadcast the result.
    pendingPush = true;
  }
  document.addEventListener('click', onClickCapture, true);

  /** Called by the shell whenever a game refreshes - our cue to publish. */
  Net.noteTurn = function (index) {
    Net.turn = typeof index === 'number' ? index : -1;
    if (!Net.playing) return;
    paintTurn();
    if (pendingPush && !restoring) schedulePush();
  };

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    // Let the move settle (a board may refresh several times mid-animation)
    // before sending; each snapshot supersedes the last anyway.
    pushTimer = setTimeout(pushNow, 90);
  }

  function pushNow() {
    pushTimer = null;
    if (!Net.playing || restoring || !Net.getSnapshot) return;
    var snap;
    try { snap = Net.getSnapshot(); } catch (e) { snap = null; }
    if (!snap) return;
    send({ t: 'state', snap: snap });
    // Once the move has passed to someone else, we are done publishing.
    if (typeof snap.turn === 'number' && snap.turn !== Net.seat) pendingPush = false;
  }

  function paintTurn() {
    var root = G.$('#game-root');
    if (!root) return;
    root.classList.toggle('net-waiting', Net.turn >= 0 && Net.turn !== Net.seat);
  }

  /* -------------------------------------------------------------- lobby UI */

  var statusNode = null;
  var lobbyBody = null;
  var closeModal = function () {};

  function setStatus(text, show) {
    if (!statusNode) return;
    statusNode.textContent = text || '';
    statusNode.hidden = !show;
  }

  function openLobby() {
    G.modal({
      title: 'Play across devices',
      body: buildLobby(),
      dismissable: true,
      actions: [{ label: 'Close', value: null, ghost: true }],
      onReady: function (close) { closeModal = close; }
    });
  }

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
            withSocket(function () { send({ t: 'create', name: nameInput.value }); });
          }
        })
      ));
      lobbyBody.appendChild(el('div.net-sep', 'or join one'));
      lobbyBody.appendChild(el('div.net-row', codeInput,
        el('button.btn', {
          type: 'button', text: 'Join',
          onclick: function () {
            G.Store.set('net.name', nameInput.value);
            withSocket(function () {
              send({ t: 'join', code: codeInput.value.toUpperCase(), name: nameInput.value });
            });
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

    lobbyBody.appendChild(el('p.muted', Net.seats.length < 2
      ? 'Waiting for someone to join…'
      : 'Pick a game from the menu to start it for everyone.'));

    statusNode = el('p.net-status', { hidden: true });
    lobbyBody.appendChild(statusNode);
  }

  function withSocket(fn) {
    if (sock && sock.readyState === 1) return fn();
    connect(fn);
  }

  /* ----------------------------------------------------- menu entry point */

  var badge = null;

  function updateBadge() {
    if (!badge) return;
    badge.classList.toggle('is-on', Net.active);
    badge.textContent = Net.active
      ? 'Room ' + Net.code + ' · ' + Net.seats.length + ' here'
      : 'Play across devices';
  }

  function mount() {
    if (!Net.available) return;                  // file:// - nothing to connect to
    var strip = G.$('#stats-strip');
    if (!strip || !strip.parentNode) return;

    // Static hosting serves the same files but has no server behind them, so
    // ask before offering the button rather than failing on the first click.
    fetch('/net/ping')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (info) {
        if (!info || !info.playbox) return;
        badge = el('button.net-badge', { type: 'button', onclick: openLobby });
        strip.parentNode.insertBefore(badge, strip);
        updateBadge();
      })
      .catch(function () { /* no server - stay hidden */ });
  }

  /* --------------------------------------------------------------- exports */

  Net.startGame = function (gameId, difficulty, options) {
    send({ t: 'start', gameId: gameId, difficulty: difficulty, options: options });
  };
  Net.reset = function () { if (Net.active) send({ t: 'reset' }); };
  /**
   * Publish unprompted - used once at the start so everyone shares the same
   * opening board (decks are shuffled locally, so they would otherwise differ
   * until the first move).
   */
  Net.publish = function () { pendingPush = true; schedulePush(); };
  Net.openLobby = openLobby;
  Net.mount = mount;
  /** True while a snapshot from another device is being applied. */
  Net.isRestoring = function () { return restoring; };

  G.Net = Net;
})();
