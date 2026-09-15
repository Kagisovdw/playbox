/* ==========================================================================
   memory.js - Memory (match the pairs)
   Cards sit face down in a grid. A turn is two flips: a matching pair is
   claimed and scored, anything else goes back face down. The computer's
   difficulty is how much of what it has seen it actually remembers.
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el, esc = G.escapeHtml;

  // 18 symbols - exactly enough pairs to fill the 6x6 board.
  var SYMBOLS = [
    '🍒', '🍋', '🍉', '🍇', '🥝', '🍓',
    '⭐', '🌙', '⚡', '🔥', '🌸', '🍀',
    '🐙', '🦋', '🐳', '🦊', '🎈', '💎'
  ];

  var LAYOUTS = {
    small: { cols: 5, rows: 4 },
    big: { cols: 6, rows: 6 }
  };

  /**
   * `retention` is the chance a revealed card sticks; `capacity` is how many
   * cards the computer holds at once (oldest drops out first). Together they
   * make Easy genuinely forgetful and Hard flawless.
   *
   * Tuned by measuring flips to clear the 20-card board (perfect play = 20):
   * Easy ~50, Normal ~39, Hard ~31. Normal sits mid-way between the two on
   * purpose - raise its retention and it plays almost identically to Hard.
   */
  var AI_SKILL = {
    easy: { retention: 0.40, capacity: 4, pause: 640 },
    normal: { retention: 0.62, capacity: 6, pause: 520 },
    hard: { retention: 1, capacity: Infinity, pause: 420 }
  };

  function buildDeck(pairs) {
    var chosen = G.shuffle(SYMBOLS.slice()).slice(0, pairs);
    return G.shuffle(chosen.concat(chosen));
  }

  /* ----------------------------------------------------------------- game */

  function start(root, config) {
    var seats = config.seats;
    var shell = G.Shell(root);
    var ticker = G.Ticker();

    var opts = config.options || {};
    var layout = opts.bigBoard ? LAYOUTS.big : LAYOUTS.small;
    var matchAgain = opts.matchAgain !== false;
    var skill = AI_SKILL[config.difficulty] || AI_SKILL.normal;

    var pairCount = (layout.cols * layout.rows) / 2;
    var deck = buildDeck(pairCount);

    var matchedBy = deck.map(function () { return -1; });   // seat index, or -1
    var faceUp = [];                                        // 0-2 indices mid-turn
    var scores = seats.map(function () { return 0; });
    var turn = 0;
    var found = 0;
    var over = false;
    var locked = true;      // true while the board is animating or a CPU plays
    var peeking = false;

    // One memory per computer seat. `order` is oldest-first for eviction.
    var brains = seats.map(function (s) { return s.isAI ? { known: {}, order: [] } : null; });

    /* --- what the computers notice --- */

    function observe(index) {
      brains.forEach(function (b) {
        if (!b || Math.random() > skill.retention) return;
        var at = b.order.indexOf(index);
        if (at !== -1) b.order.splice(at, 1);
        b.order.push(index);
        b.known[index] = deck[index];
        while (b.order.length > skill.capacity) delete b.known[b.order.shift()];
      });
    }

    /** A claimed pair leaves the board, so drop it from every memory. */
    function forget(index) {
      brains.forEach(function (b) {
        if (!b) return;
        delete b.known[index];
        var at = b.order.indexOf(index);
        if (at !== -1) b.order.splice(at, 1);
      });
    }

    function hiddenIndices() {
      var out = [];
      for (var i = 0; i < deck.length; i++) if (matchedBy[i] === -1) out.push(i);
      return out;
    }

    /* --- computer choices --- */

    /** Two remembered cards that share a symbol, or null. */
    function knownPair(brain) {
      var seen = {};
      for (var k = 0; k < brain.order.length; k++) {
        var idx = brain.order[k];
        if (matchedBy[idx] !== -1) continue;
        var sym = brain.known[idx];
        if (seen[sym] !== undefined) return [seen[sym], idx];
        seen[sym] = idx;
      }
      return null;
    }

    /** A remembered partner for a card just turned over, or null. */
    function matchFor(brain, index) {
      for (var k = 0; k < brain.order.length; k++) {
        var idx = brain.order[k];
        if (idx === index || matchedBy[idx] !== -1) continue;
        if (brain.known[idx] === deck[index]) return idx;
      }
      return null;
    }

    /**
     * Prefer a card the computer has never seen - flipping one it already
     * knows to be wrong learns nothing. Falls back to anything still in play.
     */
    function pickUnknown(brain, exclude) {
      var hidden = hiddenIndices();
      var fresh = hidden.filter(function (i) {
        return i !== exclude && brain.known[i] === undefined;
      });
      var pool = fresh.length ? fresh : hidden.filter(function (i) { return i !== exclude; });
      return pool.length ? G.pick(pool) : null;
    }

    /* --- board --- */

    var gridEl = el('div.mem-grid' + (opts.bigBoard ? '.is-big' : ''), {
      style: { '--cols': String(layout.cols) },
      role: 'group',
      'aria-label': 'Memory board'
    });

    var cards = deck.map(function (symbol, i) {
      var back = el('span.mem-face.mem-back', { text: symbol });
      var card = el('button.mem-card', {
        type: 'button',
        onclick: function () { onCardClick(i); }
      }, el('span.mem-inner', el('span.mem-face.mem-front'), back));
      gridEl.appendChild(card);
      return card;
    });

    /* --- side panel --- */

    var scoreRows = seats.map(function (seat) {
      var val = el('b', { text: '0' });
      var row = el('div.ludo-yardrow',
        el('span.seat-dot', { style: { background: seat.color } }),
        el('span.fill', { text: seat.name }),
        val
      );
      return { row: row, val: val };
    });

    var leftEl = el('b', { text: String(pairCount) });
    var side = el('div.mem-side',
      el('div.ludo-yards', scoreRows.map(function (s) { return s.row; })),
      el('div.sl-legend',
        el('div', 'Pairs left: ', leftEl),
        el('div', matchAgain ? 'A match earns another go' : 'One turn each, match or not')
      )
    );

    shell.stage.appendChild(el('div.mem-wrap', gridEl, side));
    shell.buildSeats(seats, function (_, i) { return pairsLabel(scores[i]); });
    shell.setActions(el('button.btn.btn-sm', {
      type: 'button', text: 'Restart', onclick: function () { config.restart(); }
    }));

    function pairsLabel(n) { return n + (n === 1 ? ' pair' : ' pairs'); }

    /* --- rendering --- */

    function updateCards() {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var owner = matchedBy[i];
        var up = peeking || owner !== -1 || faceUp.indexOf(i) !== -1;

        card.classList.toggle('is-up', up);
        card.classList.toggle('is-matched', owner !== -1);
        if (owner !== -1) card.style.setProperty('--owner', seats[owner].color);

        // Only a human on turn can act, and only on a face-down card.
        card.disabled = locked || over || owner !== -1 || faceUp.indexOf(i) !== -1;
        card.setAttribute('aria-label', up
          ? 'Card ' + (i + 1) + ', ' + deck[i] + (owner !== -1 ? ', claimed by ' + seats[owner].name : '')
          : 'Card ' + (i + 1) + ', face down');
      }
    }

    function refresh() {
      scoreRows.forEach(function (s, i) {
        s.val.textContent = String(scores[i]);
        s.row.classList.toggle('is-turn', i === turn && !over);
        s.row.style.setProperty('--seat-color', seats[i].color);
      });
      leftEl.textContent = String(pairCount - found);
      shell.updateSeats(over ? -1 : turn, function (i) { return pairsLabel(scores[i]); });
    }

    /* --- turn flow --- */

    function flip(index) {
      faceUp.push(index);
      observe(index);
      updateCards();
    }

    function beginTurn() {
      if (ticker.dead || over) return;
      faceUp = [];
      refresh();
      var seat = seats[turn];
      if (seat.isAI) {
        locked = true;
        updateCards();
        shell.say(shell.thinking(seat.name));
        ticker.wait(skill.pause + 220).then(aiTurn);
      } else {
        locked = false;
        updateCards();
        shell.say('<b>' + esc(seat.name) + '</b> &mdash; flip two cards');
      }
    }

    function aiTurn() {
      if (ticker.dead || over) return;
      var brain = brains[turn];
      var pair = knownPair(brain);
      var first = pair ? pair[0] : pickUnknown(brain, -1);
      if (first === null) return;

      flip(first);
      ticker.wait(skill.pause).then(function () {
        if (ticker.dead || over) return;
        var second = pair ? pair[1] : matchFor(brain, first);
        if (second === null || second === undefined) second = pickUnknown(brain, first);
        if (second === null) return;
        flip(second);
        return ticker.wait(skill.pause + 140).then(resolve);
      });
    }

    function onCardClick(i) {
      if (locked || over || matchedBy[i] !== -1) return;
      if (seats[turn].isAI || faceUp.indexOf(i) !== -1) return;

      flip(i);
      if (faceUp.length < 2) return;
      locked = true;
      updateCards();
      ticker.wait(520).then(resolve);
    }

    function resolve() {
      if (ticker.dead || over) return;
      var a = faceUp[0], b = faceUp[1];
      var seat = seats[turn];

      if (deck[a] !== deck[b]) {
        shell.say('No match &mdash; ' + deck[a] + ' and ' + deck[b]);
        return ticker.wait(980).then(function () {
          if (ticker.dead || over) return;
          nextTurn();
        });
      }

      matchedBy[a] = turn;
      matchedBy[b] = turn;
      scores[turn]++;
      found++;
      forget(a);
      forget(b);
      faceUp = [];
      updateCards();
      refresh();
      shell.say(deck[a] + ' <b>' + esc(seat.name) + '</b> found a pair!');

      if (found === pairCount) return ticker.wait(760).then(finishGame);

      return ticker.wait(660).then(function () {
        if (ticker.dead || over) return;
        if (!matchAgain) return nextTurn();

        // Same player again - re-enter the turn without advancing the seat.
        if (seat.isAI) {
          shell.say(shell.thinking(seat.name));
          return ticker.wait(skill.pause).then(aiTurn);
        }
        locked = false;
        updateCards();
        shell.say('<b>' + esc(seat.name) + '</b> goes again');
      });
    }

    function nextTurn() {
      turn = (turn + 1) % seats.length;
      beginTurn();
    }

    function finishGame() {
      if (ticker.dead) return;
      over = true;
      locked = true;
      updateCards();
      refresh();

      var best = Math.max.apply(null, scores);
      var winners = [];
      scores.forEach(function (s, i) { if (s === best) winners.push(i); });
      var tied = winners.length > 1;

      // A shared top score is not a win, the same way Connect Four scores a draw.
      var humanWon = !tied && !seats[winners[0]].isAI;
      config.finish(humanWon);

      var names = winners.map(function (i) { return seats[i].name; });
      var headline = tied
        ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] + ' tie!'
        : names[0] + ' wins!';

      shell.say((tied ? '🤝 ' : '🏆 ') + '<b>' + esc(headline) + '</b>');

      var tally = seats.map(function (seat, i) {
        return esc(seat.name) + ' &mdash; ' + pairsLabel(scores[i]);
      }).join('<br>');

      ticker.wait(700).then(function () {
        if (ticker.dead) return;
        G.modal({
          icon: tied ? '🤝' : (humanWon ? '🏆' : '🧠'),
          title: headline,
          bodyHtml: tally,
          dismissable: false,
          actions: [
            { label: 'Menu', value: 'menu', ghost: true },
            { label: 'Play again', value: 'again', primary: true }
          ]
        }).then(function (choice) {
          if (ticker.dead) return;
          if (choice === 'again') config.restart(); else config.exit();
        });
      });
    }

    /* --- boot --- */

    refresh();

    if (opts.peek) {
      peeking = true;
      updateCards();
      shell.say('Take a good look&hellip;');
      // Everyone sees the peek, computers included - that is the trade-off.
      deck.forEach(function (_, i) { observe(i); });
      ticker.wait(1900).then(function () {
        if (ticker.dead) return;
        peeking = false;
        updateCards();
        return ticker.wait(420).then(beginTurn);
      });
    } else {
      updateCards();
      beginTurn();
    }

    return {
      destroy: function () { ticker.kill(); }
    };
  }

  /* -------------------------------------------------------------- register */

  G.Games.register({
    id: 'memory',
    name: 'Memory',
    tagline: 'Flip, match, remember',
    accent: '#7c5cff',
    icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none">' +
      '<rect x="2.6" y="6.4" width="10" height="13.4" rx="2" transform="rotate(-11 7.6 13.1)" ' +
      'fill="#372a94" stroke="#7c5cff" stroke-width="1.5"/>' +
      '<rect x="11.6" y="4.6" width="10" height="13.4" rx="2" fill="#1f2440" stroke="#7c5cff" stroke-width="1.5"/>' +
      '<path d="M16.6 8.2l1.1 2.3 2.5.36-1.8 1.76.43 2.5-2.24-1.18-2.24 1.18.43-2.5-1.8-1.76 2.5-.36z" fill="#7c5cff"/>' +
      '</svg>',
    minPlayers: 2,
    maxPlayers: 4,
    defaultPlayers: 2,
    difficulty: true,
    seatColors: ['#f0483c', '#22b36b', '#f5c518', '#2f7df6'],
    aiNames: ['Ava', 'Blaze', 'Cody', 'Dot'],
    options: [
      { key: 'matchAgain', label: 'Play again on a match', hint: 'A found pair earns another turn', default: true },
      { key: 'bigBoard', label: 'Big board', hint: '36 cards instead of 20', default: false },
      { key: 'peek', label: 'Opening peek', hint: 'Every card is shown for a moment first', default: false }
    ],
    rules:
      '<h4>Goal</h4><ul><li>Claim the <b>most pairs</b> before the board runs out.</li></ul>' +
      '<h4>Play</h4><ul>' +
      '<li>On your turn, flip <b>two cards</b>.</li>' +
      '<li>Matching symbols? You claim the pair &mdash; it stays face up in your colour.</li>' +
      '<li>No match? Both cards turn back over and play passes on.</li>' +
      '<li>The game ends when every pair is claimed. Most pairs wins; equal scores tie.</li></ul>' +
      '<h4>Computer skill</h4><ul>' +
      '<li><b>Easy</b> forgets most of what it sees and holds only a few cards at a time.</li>' +
      '<li><b>Normal</b> holds the last handful of cards and lets the rest fade.</li>' +
      '<li><b>Hard</b> never forgets a card &mdash; anything you turn over, it has.</li></ul>' +
      '<h4>House rules</h4><ul>' +
      '<li><b>Play again on a match</b> &mdash; keep flipping while you keep finding pairs.</li>' +
      '<li><b>Big board</b> &mdash; 18 pairs instead of 10.</li>' +
      '<li><b>Opening peek</b> &mdash; the whole board is revealed briefly before play. ' +
      'The computers get the same look you do.</li></ul>',
    start: start
  });
})();
