/* ==========================================================================
   snakes.js - Snakes & Ladders
   Squares 1-100 laid out boustrophedon (1-10 left to right along the bottom,
   11-20 right to left, and so on). Square 0 means "not on the board yet".
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el;

  // The classic Milton Bradley layout.
  var LADDERS = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 36: 44, 51: 67, 71: 91, 80: 100 };
  var SNAKES = { 16: 6, 47: 26, 49: 11, 56: 53, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 78 };

  /** Square number -> {row, col} in display space (row 0 = top of the board). */
  function squareToCell(n) {
    var fromBottom = Math.floor((n - 1) / 10);
    var offset = (n - 1) % 10;
    return {
      row: 9 - fromBottom,
      col: fromBottom % 2 === 0 ? offset : 9 - offset
    };
  }

  function centreOf(n) {
    var cell = squareToCell(n);
    return { x: cell.col + 0.5, y: cell.row + 0.5 };
  }

  /* ------------------------------------------------------- board painting */

  function drawOverlay() {
    var parts = [];

    // Ladders: two rails plus rungs, drawn in board units (1 unit = 1 cell).
    Object.keys(LADDERS).forEach(function (from) {
      var a = centreOf(+from), b = centreOf(LADDERS[from]);
      var dx = b.x - a.x, dy = b.y - a.y;
      var len = Math.hypot(dx, dy) || 1;
      var px = (-dy / len) * 0.15, py = (dx / len) * 0.15;   // perpendicular

      parts.push('<line x1="' + (a.x + px) + '" y1="' + (a.y + py) + '" x2="' + (b.x + px) + '" y2="' + (b.y + py) + '" class="rail"/>');
      parts.push('<line x1="' + (a.x - px) + '" y1="' + (a.y - py) + '" x2="' + (b.x - px) + '" y2="' + (b.y - py) + '" class="rail"/>');

      var rungs = Math.max(2, Math.round(len / 0.42));
      for (var i = 1; i < rungs; i++) {
        var t = i / rungs;
        var cx = a.x + dx * t, cy = a.y + dy * t;
        parts.push('<line x1="' + (cx + px) + '" y1="' + (cy + py) + '" x2="' + (cx - px) + '" y2="' + (cy - py) + '" class="rung"/>');
      }
    });

    // Snakes: a wiggling body from head (high square) down to tail.
    Object.keys(SNAKES).forEach(function (from, idx) {
      var head = centreOf(+from), tail = centreOf(SNAKES[from]);
      var dx = tail.x - head.x, dy = tail.y - head.y;
      var len = Math.hypot(dx, dy) || 1;
      var px = (-dy / len), py = (dx / len);
      var swing = Math.min(1.5, len * 0.42) * (idx % 2 ? -1 : 1);

      var c1x = head.x + dx * 0.3 + px * swing, c1y = head.y + dy * 0.3 + py * swing;
      var c2x = head.x + dx * 0.7 - px * swing, c2y = head.y + dy * 0.7 - py * swing;

      parts.push('<path d="M' + head.x + ' ' + head.y + ' C' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y +
        ' ' + tail.x + ' ' + tail.y + '" class="snake-body"/>');
      parts.push('<path d="M' + head.x + ' ' + head.y + ' C' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y +
        ' ' + tail.x + ' ' + tail.y + '" class="snake-skin"/>');
      parts.push('<circle cx="' + head.x + '" cy="' + head.y + '" r="0.3" class="snake-head"/>');
      parts.push('<circle cx="' + (head.x - 0.1) + '" cy="' + (head.y - 0.08) + '" r="0.055" class="snake-eye"/>');
      parts.push('<circle cx="' + (head.x + 0.1) + '" cy="' + (head.y - 0.08) + '" r="0.055" class="snake-eye"/>');
    });

    var style =
      '<style>' +
      '.rail{stroke:#8a5a2b;stroke-width:.09;stroke-linecap:round}' +
      '.rung{stroke:#b07c3f;stroke-width:.07;stroke-linecap:round}' +
      '.snake-body{stroke:#2f6b3d;stroke-width:.3;fill:none;stroke-linecap:round}' +
      '.snake-skin{stroke:#5ba86a;stroke-width:.17;fill:none;stroke-linecap:round;stroke-dasharray:.22 .16}' +
      '.snake-head{fill:#2f6b3d}' +
      '.snake-eye{fill:#fff}' +
      '</style>';

    var node = G.svg('class="sl-svg" viewBox="0 0 10 10" preserveAspectRatio="none">' + style + parts.join('') + '</svg>');
    return node;
  }

  /* ----------------------------------------------------------------- game */

  function start(root, config) {
    var seats = config.seats;
    var shell = G.Shell(root);
    var ticker = G.Ticker();

    var opts = config.options || {};
    var sixAgain = opts.sixAgain !== false;
    var exactFinish = opts.exactFinish !== false;

    var pos = seats.map(function () { return 0; });
    var turn = 0;
    var over = false;
    var rollsThisTurn = 0;
    var lastRoll = 0;

    /* --- board --- */
    var boardEl = el('div.sl-board');
    for (var row = 0; row < 10; row++) {
      for (var col = 0; col < 10; col++) {
        var fromBottom = 9 - row;
        var n = fromBottom % 2 === 0
          ? fromBottom * 10 + col + 1
          : fromBottom * 10 + (10 - col);
        var cls = '.sl-cell' + (n % 2 ? '.odd' : '.even');
        if (LADDERS[n]) cls += '.is-ladder';
        else if (SNAKES[n]) cls += '.is-snake';
        if (n === 100) cls += '.is-goal';
        var cell = el('div' + cls, { text: String(n) });
        if (LADDERS[n]) cell.appendChild(el('span.mark', { text: '🪜' }));
        else if (SNAKES[n]) cell.appendChild(el('span.mark', { text: '🐍' }));
        else if (n === 100) cell.appendChild(el('span.mark', { text: '🏁' }));
        boardEl.appendChild(cell);
      }
    }
    boardEl.appendChild(drawOverlay());

    var tokens = seats.map(function (seat) {
      var t = el('div.sl-token', { style: { '--seat-color': seat.color }, hidden: true });
      boardEl.appendChild(t);
      return t;
    });

    /* --- side panel --- */
    var dice = G.makeDice(onRoll);
    var statusRows = seats.map(function (seat) {
      var val = el('b', { text: 'Start' });
      var row = el('div.ludo-yardrow',
        el('span.seat-dot', { style: { background: seat.color } }),
        el('span.fill', { text: seat.name }),
        val
      );
      return { row: row, val: val };
    });

    var side = el('div.sl-side',
      dice,
      el('div.ludo-yards', statusRows.map(function (s) { return s.row; })),
      el('div.sl-legend',
        el('div', '🪜 ', el('b', 'Ladders'), ' climb you up'),
        el('div', '🐍 ', el('b', 'Snakes'), ' drop you down'),
        el('div', exactFinish ? 'Land on 100 exactly' : 'Reach 100 to win')
      )
    );

    shell.stage.appendChild(el('div.sl-wrap', boardEl, side));
    shell.buildSeats(seats, function (seat) { return seat.isAI ? 'CPU' : 'You'; });
    shell.setActions(el('button.btn.btn-sm', {
      type: 'button', text: 'Restart', onclick: function () { config.restart(); }
    }));

    /* --- token placement --- */

    function placeToken(i, animate) {
      var t = tokens[i];
      var n = pos[i];
      if (n < 1) { t.hidden = true; return; }
      t.hidden = false;

      // Spread tokens that share a square so none is hidden.
      var sharing = [];
      for (var k = 0; k < seats.length; k++) if (pos[k] === n) sharing.push(k);
      var slot = sharing.indexOf(i);
      var spread = sharing.length > 1 ? (slot - (sharing.length - 1) / 2) * 0.17 : 0;

      var cell = squareToCell(n);
      t.style.left = 'calc(var(--cell) * ' + (cell.col + 0.5 - 0.23 + spread).toFixed(3) + ')';
      t.style.top = 'calc(var(--cell) * ' + (cell.row + 0.5 - 0.23 + (sharing.length > 1 ? spread * 0.5 : 0)).toFixed(3) + ')';
      if (animate) {
        t.classList.add('hop');
        setTimeout(function () { t.classList.remove('hop'); }, 170);
      }
    }

    function placeAll() { seats.forEach(function (_, i) { placeToken(i, false); }); }

    function refreshStatus() {
      statusRows.forEach(function (s, i) {
        s.val.textContent = pos[i] === 0 ? 'Start' : (pos[i] === 100 ? 'Home 🏁' : String(pos[i]));
        s.row.classList.toggle('is-turn', i === turn && !over);
        s.row.style.setProperty('--seat-color', seats[i].color);
      });
      shell.updateSeats(over ? -1 : turn);
    }

    /* --- turn flow --- */

    function beginTurn() {
      if (over) return;
      rollsThisTurn = 0;
      refreshStatus();
      var seat = seats[turn];
      if (seat.isAI) {
        shell.say(shell.thinking(seat.name));
        dice.setEnabled(false);
        ticker.wait(600).then(function () { if (!ticker.dead && !over) dice.rollNow(); });
      } else {
        shell.say('<b>' + G.escapeHtml(seat.name) + '</b> - roll the dice');
        dice.setEnabled(true);
      }
    }

    function onRoll(value) {
      if (over) return;
      dice.setEnabled(false);
      rollsThisTurn++;
      lastRoll = value;
      var seat = seats[turn];
      shell.say('<b>' + G.escapeHtml(seat.name) + '</b> rolled a ' + value);
      return advance(value);
    }

    /** Walk the token square by square, then resolve a snake or ladder. */
    function advance(steps) {
      var i = turn;
      var target = pos[i] + steps;

      if (target > 100) {
        if (exactFinish) {
          var bounce = 100 - (target - 100);
          return walkTo(i, 100, 120)
            .then(function () {
              shell.say('Overshot - bouncing back to ' + bounce);
              return walkTo(i, bounce, 120);
            })
            .then(afterMove);
        }
        target = 100;
      }

      return walkTo(i, target, 130).then(afterMove);
    }

    function walkTo(i, target, speed) {
      var chain = Promise.resolve();
      var step = target > pos[i] ? 1 : -1;
      var count = Math.abs(target - pos[i]);
      for (var s = 0; s < count; s++) {
        chain = chain.then(function () {
          if (ticker.dead) return;
          pos[i] += step;
          placeToken(i, true);
          refreshStatus();
          return ticker.wait(speed);
        });
      }
      return chain;
    }

    function afterMove() {
      if (ticker.dead || over) return;
      var i = turn;
      var seat = seats[i];
      var landed = pos[i];

      if (landed === 100) return win(i);

      if (LADDERS[landed]) {
        shell.say('🪜 <b>' + G.escapeHtml(seat.name) + '</b> climbs ' + landed + ' → ' + LADDERS[landed]);
        return ticker.wait(420).then(function () {
          if (ticker.dead) return;
          pos[i] = LADDERS[landed];
          placeToken(i, true);
          refreshStatus();
          return ticker.wait(480).then(function () {
            if (pos[i] === 100) return win(i);
            endTurn();
          });
        });
      }

      if (SNAKES[landed]) {
        shell.say('🐍 <b>' + G.escapeHtml(seat.name) + '</b> slides ' + landed + ' → ' + SNAKES[landed]);
        return ticker.wait(420).then(function () {
          if (ticker.dead) return;
          pos[i] = SNAKES[landed];
          placeToken(i, true);
          refreshStatus();
          return ticker.wait(480).then(endTurn);
        });
      }

      return ticker.wait(300).then(endTurn);
    }

    function endTurn() {
      if (ticker.dead || over) return;
      if (sixAgain && lastRoll === 6 && rollsThisTurn < 3) {
        shell.say('A six - <b>' + G.escapeHtml(seats[turn].name) + '</b> rolls again');
        if (seats[turn].isAI) {
          dice.setEnabled(false);
          return ticker.wait(650).then(function () { if (!ticker.dead && !over) dice.rollNow(); });
        }
        dice.setEnabled(true);
        return;
      }
      turn = (turn + 1) % seats.length;
      beginTurn();
    }

    function win(i) {
      over = true;
      dice.setEnabled(false);
      refreshStatus();
      var seat = seats[i];
      var humanWon = !seat.isAI;
      config.finish(humanWon);
      shell.say('🏁 <b>' + G.escapeHtml(seat.name) + '</b> reaches 100!');

      ticker.wait(800).then(function () {
        if (ticker.dead) return;
        G.modal({
          icon: humanWon ? '🏆' : '🐍',
          title: seat.name + ' wins!',
          body: 'First one home on square 100.',
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

    placeAll();
    beginTurn();
    window.addEventListener('resize', placeAll);

    return {
      destroy: function () {
        ticker.kill();
        window.removeEventListener('resize', placeAll);
      }
    };
  }

  /* -------------------------------------------------------------- register */

  G.Games.register({
    id: 'snakes',
    name: 'Snakes & Ladders',
    tagline: 'Climb, slide, and hope',
    accent: '#22b36b',
    icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none">' +
      '<path d="M6 21V6" stroke="#b07c3f" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M10.5 21V6" stroke="#b07c3f" stroke-width="1.7" stroke-linecap="round"/>' +
      '<path d="M6 17.5h4.5M6 13.5h4.5M6 9.5h4.5" stroke="#b07c3f" stroke-width="1.3" stroke-linecap="round"/>' +
      '<path d="M18 4c-3 1.6-1 5.2-3.4 7.2-2 1.7-.6 4.6 1.4 5.4 1.8.7 3.6-.3 3.6-2.1" stroke="#22b36b" stroke-width="2.1" fill="none" stroke-linecap="round"/>' +
      '<circle cx="18" cy="4" r="1.5" fill="#22b36b"/></svg>',
    minPlayers: 2,
    maxPlayers: 4,
    defaultPlayers: 2,
    difficulty: false,
    seatColors: ['#f0483c', '#22b36b', '#f5c518', '#2f7df6'],
    aiNames: ['Ava', 'Blaze', 'Cody', 'Dot'],
    options: [
      { key: 'sixAgain', label: 'Roll again on a six', hint: 'Up to three rolls in one turn', default: true },
      { key: 'exactFinish', label: 'Exact roll to finish', hint: 'Overshooting 100 bounces you back', default: true }
    ],
    rules:
      '<h4>Goal</h4><ul><li>Be the first token to land on <b>square 100</b>.</li></ul>' +
      '<h4>Play</h4><ul>' +
      '<li>Roll the dice and move that many squares along the winding track.</li>' +
      '<li>Land at the foot of a <b>ladder 🪜</b> and climb to its top.</li>' +
      '<li>Land on a <b>snake 🐍</b> head and slide down to its tail.</li>' +
      '<li>Snakes and ladders only trigger where you <i>land</i>, never where you pass.</li></ul>' +
      '<h4>House rules</h4><ul>' +
      '<li><b>Roll again on a six</b> - an extra roll, up to three in a turn.</li>' +
      '<li><b>Exact roll to finish</b> - overshoot 100 and you bounce back by the extra.</li></ul>',
    start: start
  });
})();
