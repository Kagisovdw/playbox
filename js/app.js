/* ==========================================================================
   app.js - hub: menu, per-game setup, routing
   Loaded last, after every game module has registered itself.
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el, $ = G.$;

  var screens = {
    menu: $('#screen-menu'),
    setup: $('#screen-setup'),
    game: $('#screen-game')
  };
  var btnBack = $('#btn-back');
  var btnRules = $('#btn-rules');
  var topTitle = $('#topbar-title');
  var topSub = $('#topbar-sub');

  var current = null;          // { def, instance } while a game is running
  var setup = null;            // setup screen state

  /* ---------------------------------------------------------------- routing */

  function show(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('is-active', k === name);
    });
    btnBack.hidden = (name === 'menu');
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  function goMenu() {
    destroyGame();
    btnRules.hidden = true;
    topTitle.textContent = 'Playbox';
    topSub.textContent = 'Open it up';
    document.documentElement.style.removeProperty('--card-accent');
    renderStats();
    show('menu');
  }

  function destroyGame() {
    if (current && current.instance && typeof current.instance.destroy === 'function') {
      try { current.instance.destroy(); } catch (e) { console.error(e); }
    }
    current = null;
    G.clear($('#game-root'));
  }

  btnBack.addEventListener('click', function () {
    if (screens.game.classList.contains('is-active') && current) {
      G.modal({
        title: 'Leave the game?',
        body: 'This game will be abandoned. No score is recorded.',
        actions: [
          { label: 'Keep playing', value: false, ghost: true },
          { label: 'Leave', value: true, primary: true }
        ]
      }).then(function (leave) { if (leave) goMenu(); });
    } else {
      goMenu();
    }
  });

  btnRules.addEventListener('click', function () {
    var def = (current && current.def) || (setup && setup.def);
    if (!def) return;
    G.modal({
      title: def.name + ' rules',
      body: el('div.rules-body', { html: def.rules || '<p>No rules sheet yet.</p>' }),
      actions: [{ label: 'Got it', value: true, primary: true }]
    });
  });

  /* ------------------------------------------------------------------ menu */

  function renderMenu() {
    var grid = G.clear($('#game-grid'));
    G.Games.all().forEach(function (def) {
      var card = el('button.game-card', {
        type: 'button',
        style: { '--card-accent': def.accent },
        onclick: function () { openSetup(def); }
      },
        el('span.gc-icon', { html: def.icon }),
        el('span.gc-title', { text: def.name }),
        el('span.gc-tag', { text: def.tagline }),
        el('span.gc-meta',
          el('span.pill', { text: def.minPlayers === def.maxPlayers ? def.minPlayers + ' players' : def.minPlayers + '-' + def.maxPlayers + ' players' }),
          el('span.pill', { text: def.difficulty ? 'vs CPU' : 'CPU rolls' })
        )
      );
      grid.appendChild(card);
    });
  }

  function renderStats() {
    var strip = G.clear($('#stats-strip'));
    var stats = G.getStats();
    var any = false;
    G.Games.all().forEach(function (def) {
      var s = stats[def.id];
      if (!s || !s.played) return;
      any = true;
      strip.appendChild(el('span.stat-chip',
        el('span.seat-dot', { style: { background: def.accent, width: '9px', height: '9px', boxShadow: 'none' } }),
        def.name + ' ',
        el('b', { text: s.won + '/' + s.played }),
        ' won'
      ));
    });
    if (any) {
      strip.appendChild(el('button.stat-chip', {
        style: { cursor: 'pointer' },
        onclick: function () {
          G.modal({
            title: 'Clear your record?',
            body: 'Wins and games played will be reset to zero.',
            actions: [
              { label: 'Cancel', value: false, ghost: true },
              { label: 'Clear', value: true, primary: true }
            ]
          }).then(function (yes) {
            if (yes) { G.Store.set('stats', {}); renderStats(); G.toast('Record cleared'); }
          });
        }
      }, 'Reset record'));
    }
  }

  /* ----------------------------------------------------------------- setup */

  function openSetup(def) {
    var saved = G.Store.get('setup.' + def.id, null);

    setup = {
      def: def,
      count: clamp(saved && saved.count || def.defaultPlayers || def.minPlayers, def.minPlayers, def.maxPlayers),
      difficulty: (saved && saved.difficulty) || 'normal',
      options: Object.assign({}, defaultOptions(def), (saved && saved.options) || {}),
      seats: []
    };

    // Seat names/types: restore what was saved, otherwise seat 1 human + CPUs.
    for (var i = 0; i < def.maxPlayers; i++) {
      var prev = saved && saved.seats && saved.seats[i];
      setup.seats.push({
        name: (prev && prev.name) || defaultName(def, i),
        isAI: prev ? !!prev.isAI : i !== 0
      });
    }

    document.documentElement.style.setProperty('--card-accent', def.accent);
    topTitle.textContent = def.name;
    topSub.textContent = def.tagline;
    btnRules.hidden = false;

    $('#setup-icon').innerHTML = def.icon;
    $('#setup-title').textContent = def.name;
    $('#setup-tagline').textContent = def.tagline;

    renderCounts();
    renderSeats();
    renderDifficulty();
    renderOptions();
    show('setup');
  }

  function defaultOptions(def) {
    var o = {};
    (def.options || []).forEach(function (opt) { o[opt.key] = !!opt.default; });
    return o;
  }
  function defaultName(def, i) {
    if (i === 0) return 'You';
    var names = def.aiNames || ['Ava', 'Blaze', 'Cody', 'Dot'];
    return names[i % names.length];
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function renderCounts() {
    var def = setup.def;
    var block = $('#block-count');
    if (def.minPlayers === def.maxPlayers) { block.hidden = true; return; }
    block.hidden = false;
    var row = G.clear($('#count-options'));
    for (var n = def.minPlayers; n <= def.maxPlayers; n++) {
      (function (n) {
        row.appendChild(el('button.chip' + (setup.count === n ? '.is-on' : ''), {
          type: 'button',
          text: n + ' players',
          onclick: function () { setup.count = n; renderCounts(); renderSeats(); }
        }));
      })(n);
    }
  }

  function renderSeats() {
    var def = setup.def;
    var list = G.clear($('#seat-list'));
    for (var i = 0; i < setup.count; i++) {
      (function (i) {
        var seat = setup.seats[i];
        var toggle = el('div.toggle');
        ['Human', 'Computer'].forEach(function (label, idx) {
          var isAI = idx === 1;
          toggle.appendChild(el('button' + (seat.isAI === isAI ? '.is-on' : ''), {
            type: 'button',
            text: label,
            onclick: function () {
              // Keep at least one seat playable by a person? No - AI vs AI is allowed on purpose.
              seat.isAI = isAI;
              if (seat.name === 'You' && isAI) seat.name = defaultName(def, i || 1);
              if (!isAI && !hasHumanNamed(i)) seat.name = 'You';
              renderSeats();
            }
          }));
        });

        list.appendChild(el('div.seat-row',
          el('span.seat-dot', { style: { background: def.seatColors[i] } }),
          el('input.seat-name', {
            type: 'text', value: seat.name, maxLength: 12, spellcheck: false,
            'aria-label': 'Player ' + (i + 1) + ' name',
            oninput: function (e) { seat.name = e.target.value; }
          }),
          toggle
        ));
      })(i);
    }
  }

  function hasHumanNamed(skipIndex) {
    for (var i = 0; i < setup.count; i++) {
      if (i !== skipIndex && !setup.seats[i].isAI && setup.seats[i].name === 'You') return true;
    }
    return false;
  }

  function renderDifficulty() {
    var def = setup.def;
    var block = $('#block-difficulty');
    var anyAI = setup.seats.slice(0, setup.count).some(function (s) { return s.isAI; });
    if (!def.difficulty || !anyAI) { block.hidden = true; return; }
    block.hidden = false;
    var row = G.clear($('#difficulty-options'));
    [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']].forEach(function (d) {
      row.appendChild(el('button.chip' + (setup.difficulty === d[0] ? '.is-on' : ''), {
        type: 'button',
        text: d[1],
        onclick: function () { setup.difficulty = d[0]; renderDifficulty(); }
      }));
    });
  }

  function renderOptions() {
    var def = setup.def;
    var block = $('#block-options');
    if (!def.options || !def.options.length) { block.hidden = true; return; }
    block.hidden = false;
    var list = G.clear($('#option-list'));
    def.options.forEach(function (opt) {
      var sw = el('span.switch' + (setup.options[opt.key] ? '.is-on' : ''));
      list.appendChild(el('div.option-row', {
        onclick: function () {
          setup.options[opt.key] = !setup.options[opt.key];
          sw.classList.toggle('is-on', setup.options[opt.key]);
        }
      },
        el('span.opt-text', el('b', { text: opt.label }), el('span', { text: opt.hint || '' })),
        sw
      ));
    });
  }

  $('#btn-start').addEventListener('click', function () { startGame(); });

  function startGame() {
    var def = setup.def;

    // In a room, Start does not start anything locally - it asks the server,
    // which starts it on every device at the same moment with the same seed.
    if (G.Net && G.Net.active && !G.Net.playing) {
      // Across devices a game must be able to hand over its whole state.
      if (def.networked !== true) {
        G.toast(def.name + ' is one-device only for now');
        return;
      }
      var here = G.Net.seats.length;
      if (here < def.minPlayers) {
        G.toast(def.name + ' needs at least ' + def.minPlayers + ' players');
        return;
      }
      G.Net.startGame(def.id, setup.difficulty, setup.options)
        .catch(function (e) { G.toast(e.message); });
      return;
    }

    var seats = setup.seats.slice(0, setup.count).map(function (s, i) {
      return {
        index: i,
        name: (s.name || '').trim() || defaultName(def, i),
        isAI: s.isAI,
        color: def.seatColors[i],
        label: def.seatLabels ? def.seatLabels[i] : null
      };
    });

    G.Store.set('setup.' + def.id, {
      count: setup.count,
      difficulty: setup.difficulty,
      options: setup.options,
      seats: setup.seats.map(function (s) { return { name: s.name, isAI: s.isAI }; })
    });

    destroyGame();
    show('game');

    var config = {
      seats: seats,
      difficulty: setup.difficulty,
      options: Object.assign({}, setup.options),
      // Games call these instead of reaching into the hub.
      exit: goMenu,
      restart: function () { startGame(); },
      finish: function (humanWon) { G.recordResult(def.id, humanWon); }
    };

    current = { def: def, instance: def.start($('#game-root'), config) };
  }

  /* -------------------------------------------------------- networked play */

  /** Build the same game, with the same seed, on every device in the room. */
  function startNetworkGame(room) {
    var def = room && room.game ? G.Games.get(room.game.id) : null;
    if (!def) { G.toast('That game is not available here'); return; }

    var seats = room.seats.slice(0, def.maxPlayers).map(function (s, i) {
      return { index: i, name: s.name, isAI: false, color: def.seatColors[i], label: null };
    });
    if (G.Net.seat >= seats.length) {
      G.toast(def.name + ' seats only ' + def.maxPlayers + ' - you are watching');
    }

    document.documentElement.style.setProperty('--card-accent', def.accent);
    topTitle.textContent = def.name;
    topSub.textContent = 'Room ' + room.code;
    btnRules.hidden = false;

    destroyGame();
    show('game');

    var backToLobby = function () {
      G.Net.reset();
      goMenu();
      G.Net.openLobby();
    };

    var config = {
      seats: seats,
      difficulty: room.game.difficulty,
      options: Object.assign({}, room.game.options),
      // Both routes return everyone to the lobby, so devices never diverge.
      exit: backToLobby,
      restart: backToLobby,
      finish: function (humanWon) { G.recordResult(def.id, humanWon); }
    };
    current = { def: def, instance: def.start($('#game-root'), config) };

    // Decks are shuffled on each device, so seat 1 publishes the opening
    // board and everyone else adopts it before the first move.
    if (G.Net.seat === 0 && current.instance && current.instance.snapshot) {
      G.Net.publish();
    }
  }

  if (G.Net) {
    G.Net.onStart = startNetworkGame;
    G.Net.onReset = function () { G.setSeed(0); };
    G.Net.getSnapshot = function () {
      return (current && current.instance && current.instance.snapshot)
        ? current.instance.snapshot() : null;
    };
    G.Net.onState = function (snap) {
      if (current && current.instance && current.instance.restore) {
        current.instance.restore(snap);
      }
    };
  }

  /* ------------------------------------------------------------------ boot */

  renderMenu();
  renderStats();
  if (G.Net) G.Net.mount();
  show('menu');
})();
