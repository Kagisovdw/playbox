/* ==========================================================================
   core.js - shared helpers, game registry, UI shell
   Loaded first. Everything hangs off the global `G`.
   ========================================================================== */
(function (window) {
  'use strict';

  /* ---------- tiny DOM helpers ---------- */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /**
   * el('div.cls#id', {attrs}?, child, child...) -> HTMLElement
   * The attrs object is optional: anything that is not a plain object
   * (node, string, number, array) counts as the first child instead.
   */
  function el(tag) {
    var parts = tag.split(/(?=[.#])/);
    var node = document.createElement(parts[0] || 'div');
    for (var p = 1; p < parts.length; p++) {
      if (parts[p][0] === '.') node.classList.add(parts[p].slice(1));
      else node.id = parts[p].slice(1);
    }

    var first = 1;
    var maybeAttrs = arguments[1];
    if (maybeAttrs && typeof maybeAttrs === 'object' &&
      !maybeAttrs.nodeType && !Array.isArray(maybeAttrs)) {
      applyAttrs(node, maybeAttrs);
      first = 2;
    }

    for (var i = first; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function applyAttrs(node, attrs) {
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') { node.className += (node.className ? ' ' : '') + v; }
      else if (k === 'html') { node.innerHTML = v; }
      else if (k === 'text') { node.textContent = v; }
      else if (k === 'style' && typeof v === 'object') {
        // Object.assign skips custom properties, so set those explicitly.
        for (var s in v) {
          if (s.indexOf('--') === 0) node.style.setProperty(s, v[s]);
          else node.style[s] = v[s];
        }
      }
      else if (k === 'dataset') { Object.assign(node.dataset, v); }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k in node && k !== 'list' && typeof v !== 'object') {
        try { node[k] = v; } catch (e) { node.setAttribute(k, v); }
      } else {
        node.setAttribute(k, v);
      }
    }
  }

  function append(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(parent, c); }); return; }
    parent.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  function svg(markup) {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" ' + markup + '</svg>';
    return wrap.firstChild;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  /* ---------- async / random ---------- */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rand(arr.length)]; }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = rand(i + 1);
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function roll() { return 1 + rand(6); }

  /* ---------- storage (safe on file:// and private windows) ---------- */

  // The `gamenight.` prefix predates the rename to Playbox. Leave it alone:
  // changing it orphans every saved record and setup already in the browser.
  var Store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem('gamenight.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('gamenight.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  /* ---------- stats ---------- */

  function recordResult(gameId, didHumanWin) {
    var stats = Store.get('stats', {});
    var s = stats[gameId] || { played: 0, won: 0 };
    s.played++;
    if (didHumanWin) s.won++;
    stats[gameId] = s;
    Store.set('stats', stats);
    return s;
  }
  function getStats() { return Store.get('stats', {}); }

  /* ---------- toast ---------- */

  function toast(message, ms) {
    var layer = $('#toast-layer');
    if (!layer) return;
    var node = el('div.toast', { text: message });
    layer.appendChild(node);
    setTimeout(function () {
      node.classList.add('out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 280);
    }, ms || 1900);
  }

  /* ---------- modal ---------- */

  var modalLayer = null;

  /**
   * modal({icon, title, body (string|Node), actions:[{label,value,primary,ghost}], dismissable})
   * Resolves with the chosen action's `value` (or null if dismissed).
   */
  function modal(opts) {
    modalLayer = modalLayer || $('#modal-layer');
    return new Promise(function (resolve) {
      var box = el('div.modal', { role: 'dialog', 'aria-modal': 'true' });

      if (opts.icon) box.appendChild(el('div.modal-crown', { text: opts.icon }));
      if (opts.title) box.appendChild(el('h2', { text: opts.title }));

      var body = el('div.modal-body');
      if (opts.body && opts.body.nodeType) body.appendChild(opts.body);
      else if (opts.bodyHtml) body.innerHTML = opts.bodyHtml;
      else if (opts.body) body.textContent = opts.body;
      if (body.firstChild) box.appendChild(body);

      var actions = el('div.modal-actions');
      (opts.actions || [{ label: 'OK', value: true, primary: true }]).forEach(function (a) {
        actions.appendChild(el('button.btn' + (a.primary ? '.btn-primary' : '') + (a.ghost ? '.btn-ghost' : ''), {
          text: a.label,
          onclick: function () { close(a.value); }
        }));
      });
      box.appendChild(actions);

      function close(value) {
        document.removeEventListener('keydown', onKey);
        clear(modalLayer);
        modalLayer.hidden = true;
        resolve(value);
      }
      function onKey(e) {
        if (e.key === 'Escape' && opts.dismissable !== false) close(null);
      }

      clear(modalLayer);
      modalLayer.appendChild(box);
      modalLayer.hidden = false;
      document.addEventListener('keydown', onKey);
      if (opts.dismissable !== false) {
        modalLayer.onclick = function (e) { if (e.target === modalLayer) close(null); };
      } else {
        modalLayer.onclick = null;
      }
      // Lets a custom body (e.g. a colour picker) close the modal itself.
      if (opts.onReady) opts.onReady(close);

      var firstBtn = box.querySelector('.btn-primary') || box.querySelector('.btn');
      if (firstBtn) setTimeout(function () { firstBtn.focus(); }, 40);
    });
  }

  /* ---------- dice face ---------- */

  var DICE_PIPS = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };

  /** Paint pips for `value` (1-6) into a .dice element. */
  function paintDice(node, value) {
    clear(node);
    var on = DICE_PIPS[value] || [];
    for (var i = 0; i < 9; i++) {
      node.appendChild(el('span' + (on.indexOf(i) === -1 ? '.off' : '')));
    }
  }

  /** A dice <button> with roll animation. onRoll receives the value. */
  function makeDice(onRoll) {
    var node = el('button.dice', { type: 'button', 'aria-label': 'Roll the dice' });
    paintDice(node, 6);
    var busy = false;

    node.addEventListener('click', function () {
      if (busy || node.disabled) return;
      node.rollNow();
    });

    /** Roll programmatically (used by AI seats too). Returns a promise of the value. */
    node.rollNow = function (forced) {
      if (busy) return Promise.resolve(null);
      busy = true;
      node.disabled = true;
      node.classList.remove('rolling');
      void node.offsetWidth;            // restart the animation
      node.classList.add('rolling');

      var flicker = setInterval(function () { paintDice(node, roll()); }, 70);
      return sleep(520).then(function () {
        clearInterval(flicker);
        var value = forced || roll();
        paintDice(node, value);
        node.classList.remove('rolling');
        busy = false;
        if (onRoll) return onRoll(value);
        return value;
      });
    };

    node.setEnabled = function (enabled) { node.disabled = !enabled; };
    return node;
  }

  /* ---------- game registry ---------- */

  var registry = [];
  var Games = {
    register: function (def) { registry.push(def); },
    all: function () { return registry.slice(); },
    get: function (id) {
      for (var i = 0; i < registry.length; i++) if (registry[i].id === id) return registry[i];
      return null;
    }
  };

  /* ---------- game shell ---------- */

  /**
   * Standard chrome for a game: HUD of seats, a banner line, the board stage,
   * and an action bar. Games render their board into `shell.stage`.
   */
  function Shell(root, opts) {
    opts = opts || {};
    var wrap = el('div.game-shell');
    var hud = el('div.hud');
    var banner = el('div.banner');
    var stage = el('div.board-stage');
    var actions = el('div.action-bar');

    if (opts.hud !== false) wrap.appendChild(hud);
    wrap.appendChild(banner);
    wrap.appendChild(stage);
    wrap.appendChild(actions);
    clear(root).appendChild(wrap);

    var seatNodes = [];

    var api = {
      wrap: wrap, hud: hud, banner: banner, stage: stage, actions: actions,

      /** Build the HUD once from the seat list. */
      buildSeats: function (seats, subtitleFor) {
        clear(hud);
        seatNodes = seats.map(function (seat, i) {
          var dot = el('span.seat-dot', { style: { background: seat.color } });
          var who = el('span.who', { text: seat.name });
          var text = subtitleFor ? subtitleFor(seat, i) : (seat.isAI ? 'CPU' : 'You');
          var sub = el('span.sub', { text: dedupe(text, seat.name) });
          var node = el('div.hud-seat', { style: { '--seat-color': seat.color } }, dot, who, sub);
          hud.appendChild(node);
          return { node: node, sub: sub, name: seat.name };
        });
        if (opts.hudExtra) { hud.appendChild(el('div.hud-spacer')); hud.appendChild(opts.hudExtra); }
        return seatNodes;
      },

      /** Highlight whose turn it is and refresh each seat's subtitle. */
      updateSeats: function (activeIndex, subtitleFor) {
        seatNodes.forEach(function (s, i) {
          s.node.classList.toggle('is-turn', i === activeIndex);
          if (subtitleFor) s.sub.textContent = dedupe(subtitleFor(i), s.name);
        });
      },

      /** Set the status line. Accepts HTML. */
      say: function (html) { banner.innerHTML = html; },

      /** Replace the action bar with the given nodes. */
      setActions: function () {
        clear(actions);
        for (var i = 0; i < arguments.length; i++) append(actions, arguments[i]);
        return actions;
      },

      /** A "CPU is thinking" animation for the banner. */
      thinking: function (name) {
        return '<b>' + escapeHtml(name) + '</b> is thinking<span class="thinking"><i></i><i></i><i></i></span>';
      }
    };
    return api;
  }

  /** Avoid a seat reading "You You" when the label repeats the name. */
  function dedupe(text, name) {
    return String(text || '').toLowerCase() === String(name || '').toLowerCase() ? '' : text;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ---------- turn-order helper ---------- */

  /** Cancellable delay so an in-flight AI turn can be aborted on unmount. */
  function Ticker() {
    var timers = [];
    var dead = false;
    return {
      wait: function (ms) {
        return new Promise(function (resolve, reject) {
          if (dead) return;                       // never settles - chain stops
          var id = setTimeout(function () { if (!dead) resolve(); }, ms);
          timers.push(id);
        });
      },
      get dead() { return dead; },
      kill: function () {
        dead = true;
        timers.forEach(clearTimeout);
        timers.length = 0;
      }
    };
  }

  /* ---------- exports ---------- */

  window.G = {
    $: $, $$: $$, el: el, svg: svg, clear: clear, append: append,
    sleep: sleep, rand: rand, pick: pick, shuffle: shuffle, roll: roll,
    Store: Store, recordResult: recordResult, getStats: getStats,
    toast: toast, modal: modal,
    paintDice: paintDice, makeDice: makeDice,
    Games: Games, Shell: Shell, Ticker: Ticker, escapeHtml: escapeHtml
  };
})(window);
