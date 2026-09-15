/* ==========================================================================
   ludo.js - Ludo on the classic 15x15 board

   Geometry
     TRACK       52 shared squares, clockwise, index 0 = red's start
     START[slot] where each colour joins the track (0, 13, 26, 39)
     rel         a token's distance from its own start:
                   -1      still in the yard
                   0..50   on the shared track
                   51..55  its private home column
                   56      home
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el;

  /* ------------------------------------------------------------- geometry */

  // Clockwise from red's start square at row 6, col 1.
  var TRACK = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
    [5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
    [0, 7],
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
    [6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
    [7, 14],
    [8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
    [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
    [14, 7],
    [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
    [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
    [7, 0],
    [6, 0]
  ];

  var START = [0, 13, 26, 39];
  var SAFE = [0, 8, 13, 21, 26, 34, 39, 47];   // starts + the starred squares

  var HOME_COL = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]]
  ];

  // Yard blocks: [topRow, leftCol] of each 6x6 corner.
  var YARD = [[0, 0], [0, 9], [9, 9], [9, 0]];
  // Token resting spots inside a yard, in cell units from the yard corner.
  var YARD_SLOTS = [[1.6, 1.6], [1.6, 4.4], [4.4, 1.6], [4.4, 4.4]];
  // Where a finished token sits inside the centre triangle.
  var HOME_NUDGE = [[0, -0.58], [-0.58, 0], [0, 0.58], [0.58, 0]];  // [dRow, dCol]

  var LAST_TRACK = 50;   // final shared square, in rel terms
  var HOME_REL = 56;     // rel value meaning "home"

  function trackCell(slot, rel) { return TRACK[(START[slot] + rel) % 52]; }
  function absIndex(slot, rel) { return (START[slot] + rel) % 52; }

  /** Board position (fractional row/col, in cell units) for a token. */
  function cellFor(slot, rel, tokenIndex) {
    if (rel < 0) {
      var y = YARD[slot], s = YARD_SLOTS[tokenIndex];
      return { r: y[0] + s[0], c: y[1] + s[1] };
    }
    if (rel <= LAST_TRACK) {
      var t = trackCell(slot, rel);
      return { r: t[0] + 0.5, c: t[1] + 0.5 };
    }
    if (rel < HOME_REL) {
      var h = HOME_COL[slot][rel - 51];
      return { r: h[0] + 0.5, c: h[1] + 0.5 };
    }
    var n = HOME_NUDGE[slot];
    return { r: 7.5 + n[0], c: 7.5 + n[1] };
  }

  /* ---------------------------------------------------------------- rules */

  /**
   * Every legal move for `slot` with `die`, as
   * {token, from, to, capture:[{slot,token}], entersHome, leavesYard}.
   */
  function legalMoves(state, slot, die) {
    var moves = [];
    var mine = state.tokens[slot];

    for (var i = 0; i < 4; i++) {
      var rel = mine[i];
      if (rel === HOME_REL) continue;

      var to;
      if (rel < 0) {
        if (die !== 6) continue;                       // only a six frees a token
        to = 0;
      } else {
        to = rel + die;
        if (to > HOME_REL) continue;                   // needs an exact roll
      }

      // Walk the shared track portion of the move, checking for blocks.
      var blocked = false;
      var fromStep = rel < 0 ? 0 : rel + 1;
      var toStep = Math.min(to, LAST_TRACK);
      for (var step = fromStep; step <= toStep && !blocked; step++) {
        if (isBlockedFor(state, slot, absIndex(slot, step))) blocked = true;
      }
      if (blocked) continue;

      var capture = [];
      if (to <= LAST_TRACK) {
        var target = absIndex(slot, to);
        if (SAFE.indexOf(target) === -1) {
          capture = occupantsAt(state, target).filter(function (o) { return o.slot !== slot; });
        }
      }

      moves.push({
        token: i,
        from: rel,
        to: to,
        capture: capture,
        entersHome: to === HOME_REL,
        leavesYard: rel < 0
      });
    }
    return moves;
  }

  /** Tokens of any colour standing on an absolute track square. */
  function occupantsAt(state, absSquare) {
    var out = [];
    for (var s = 0; s < 4; s++) {
      if (!state.active[s]) continue;
      for (var i = 0; i < 4; i++) {
        var rel = state.tokens[s][i];
        if (rel >= 0 && rel <= LAST_TRACK && absIndex(s, rel) === absSquare) {
          out.push({ slot: s, token: i });
        }
      }
    }
    return out;
  }

  /** Two or more tokens of one other colour form a wall you cannot pass. */
  function isBlockedFor(state, slot, absSquare) {
    if (state.blocks === false) return false;
    var counts = {};
    var here = occupantsAt(state, absSquare);
    for (var i = 0; i < here.length; i++) {
      if (here[i].slot === slot) continue;
      counts[here[i].slot] = (counts[here[i].slot] || 0) + 1;
      if (counts[here[i].slot] >= 2) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------- AI */

  /** How exposed a square is: enemies 1-6 steps behind it on the track. */
  function threatAt(state, slot, absSquare) {
    if (SAFE.indexOf(absSquare) !== -1) return 0;
    var threats = 0;
    for (var s = 0; s < 4; s++) {
      if (s === slot || !state.active[s]) continue;
      for (var i = 0; i < 4; i++) {
        var rel = state.tokens[s][i];
        if (rel < 0 || rel > LAST_TRACK) continue;
        var gap = (absSquare - absIndex(s, rel) + 52) % 52;
        if (gap >= 1 && gap <= 6) threats++;
      }
    }
    return threats;
  }

  function scoreMove(state, slot, move, die) {
    var score = 0;

    if (move.capture.length) {
      score += 1000;
      move.capture.forEach(function (c) { score += state.tokens[c.slot][c.token] * 3; });
    }
    if (move.entersHome) score += 900;
    else if (move.to > LAST_TRACK) score += 380 + move.to * 4;      // into the home column
    if (move.leavesYard) score += 470;

    // Getting out of trouble, and not walking into more.
    if (move.from >= 0 && move.from <= LAST_TRACK) {
      score += threatAt(state, slot, absIndex(slot, move.from)) * 180;
    }
    if (move.to <= LAST_TRACK) {
      score -= threatAt(state, slot, absIndex(slot, move.to)) * 150;
      if (SAFE.indexOf(absIndex(slot, move.to)) !== -1) score += 110;
    }

    score += move.to * 2;                                            // general progress
    return score;
  }

  function chooseMove(state, slot, moves, die, difficulty) {
    if (moves.length === 1) return moves[0];
    if (difficulty === 'easy' && G.random() < 0.6) return G.pick(moves);

    var scored = moves.map(function (m) {
      var s = scoreMove(state, slot, m, die);
      if (difficulty !== 'hard') s += G.rand(120);                   // a little noise
      return { move: m, score: s };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored[0].move;
  }

  /* ----------------------------------------------------------------- view */

  function start(root, config) {
    var seats = config.seats;
    var shell = G.Shell(root);
    var ticker = G.Ticker();

    var opts = config.options || {};
    var useBlocks = opts.blocks !== false;

    // seat index === slot index; unused slots sit idle.
    var state = {
      tokens: [[-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]],
      active: [false, false, false, false],
      blocks: useBlocks
    };
    seats.forEach(function (seat, i) { state.active[i] = true; });

    var slotColor = [0, 1, 2, 3].map(function (s) {
      return state.active[s] ? seats[s].color : '#c3c9db';
    });

    var turn = 0;
    var over = false;
    var sixStreak = 0;
    var awaitingPick = null;     // {moves, die} while a human chooses

    /* --- board --- */
    var boardEl = el('div.ludo-board');

    function placeGrid(node, r0, c0, rows, cols) {
      node.style.gridRow = (r0 + 1) + ' / ' + (r0 + 1 + rows);
      node.style.gridColumn = (c0 + 1) + ' / ' + (c0 + 1 + cols);
      return node;
    }

    // Four yards.
    for (var s = 0; s < 4; s++) {
      (function (s) {
        var y = YARD[s];
        var yard = el('div.lu-yard', { style: { background: slotColor[s] } });
        placeGrid(yard, y[0], y[1], 6, 6);
        boardEl.appendChild(yard);
        // Resting circles, positioned with the same maths as the tokens.
        YARD_SLOTS.forEach(function (sp) {
          var dot = el('div.lu-slot', {
            style: {
              position: 'absolute',
              left: 'calc(var(--cell) * ' + (y[1] + sp[1] - 0.39) + ')',
              top: 'calc(var(--cell) * ' + (y[0] + sp[0] - 0.39) + ')'
            }
          });
          boardEl.appendChild(dot);
        });
      })(s);
    }

    // Path cells: the plus-shaped cross, minus the centre.
    var pathCells = {};
    function addCell(r, c) {
      if (r >= 6 && r <= 8 && c >= 6 && c <= 8) return;              // centre
      var key = r + ',' + c;
      if (pathCells[key]) return;
      var cell = el('div.lu-cell');
      placeGrid(cell, r, c, 1, 1);
      boardEl.appendChild(cell);
      pathCells[key] = cell;
    }
    for (var r = 6; r <= 8; r++) for (var c = 0; c < 15; c++) addCell(r, c);
    for (var c2 = 6; c2 <= 8; c2++) for (var r2 = 0; r2 < 15; r2++) addCell(r2, c2);

    // Tint the start squares and the home columns; star the safe squares.
    for (var slot = 0; slot < 4; slot++) {
      var startCell = TRACK[START[slot]];
      var sc = pathCells[startCell[0] + ',' + startCell[1]];
      if (sc) { sc.style.background = slotColor[slot]; sc.classList.add('tinted'); }

      HOME_COL[slot].forEach(function (h) {
        var hc = pathCells[h[0] + ',' + h[1]];
        if (hc) { hc.style.background = slotColor[slot]; hc.classList.add('tinted'); }
      });
    }
    SAFE.forEach(function (absIdx) {
      var t = TRACK[absIdx];
      var cell = pathCells[t[0] + ',' + t[1]];
      if (cell) cell.classList.add('safe');
    });

    // Centre: four triangles meeting in the middle.
    var centre = G.svg('viewBox="0 0 3 3" style="width:100%;height:100%;display:block">' +
      '<polygon points="0,0 0,3 1.5,1.5" fill="' + slotColor[0] + '"/>' +
      '<polygon points="0,0 3,0 1.5,1.5" fill="' + slotColor[1] + '"/>' +
      '<polygon points="3,0 3,3 1.5,1.5" fill="' + slotColor[2] + '"/>' +
      '<polygon points="0,3 3,3 1.5,1.5" fill="' + slotColor[3] + '"/>' +
      '<g fill="none" stroke="rgba(16,20,42,.35)" stroke-width=".04">' +
      '<polygon points="0,0 3,0 3,3 0,3"/><line x1="0" y1="0" x2="3" y2="3"/><line x1="3" y1="0" x2="0" y2="3"/>' +
      '</g></svg>');
    var centreBox = el('div', { style: { position: 'relative' } }, centre);
    placeGrid(centreBox, 6, 6, 3, 3);
    boardEl.appendChild(centreBox);

    /* --- tokens --- */
    var tokenNodes = [];
    for (var ts = 0; ts < 4; ts++) {
      tokenNodes.push([]);
      for (var ti = 0; ti < 4; ti++) {
        (function (ts, ti) {
          var node = el('div.ludo-token', {
            style: { '--seat-color': slotColor[ts] },
            hidden: !state.active[ts],
            onclick: function () { onTokenClick(ts, ti); }
          });
          boardEl.appendChild(node);
          tokenNodes[ts].push(node);
        })(ts, ti);
      }
    }

    /* --- side panel --- */
    var dice = G.makeDice(onRoll);
    var yardRows = seats.map(function (seat, i) {
      var val = el('b', { text: '0/4' });
      var row = el('div.ludo-yardrow', { style: { '--seat-color': seat.color } },
        el('span.seat-dot', { style: { background: seat.color } }),
        el('span.fill', { text: seat.name }),
        val
      );
      return { row: row, val: val };
    });

    var side = el('div.ludo-side',
      dice,
      el('div.ludo-yards', yardRows.map(function (y) { return y.row; })),
      el('div.sl-legend',
        el('div', el('b', 'Six'), ' frees a token and rolls again'),
        el('div', '★ squares are safe from capture'),
        el('div', 'Exact roll to reach home')
      )
    );

    shell.stage.appendChild(el('div.ludo-wrap', boardEl, side));
    shell.buildSeats(seats, function (seat, i) { return homeCount(i) + '/4 home'; });
    shell.setActions(el('button.btn.btn-sm', {
      type: 'button', text: 'Restart', 'data-local': '1', onclick: function () { config.restart(); }
    }));

    /* --- rendering --- */

    function homeCount(slot) {
      return state.tokens[slot].filter(function (r) { return r === HOME_REL; }).length;
    }

    function render(movable) {
      // Group tokens by the square they occupy so stacks can be fanned out.
      var groups = {};
      for (var s = 0; s < 4; s++) {
        if (!state.active[s]) continue;
        for (var i = 0; i < 4; i++) {
          var rel = state.tokens[s][i];
          var key = rel < 0 ? 'yard' + s + '-' + i
            : rel <= LAST_TRACK ? 'trk' + absIndex(s, rel)
              : 'own' + s + '-' + rel;
          (groups[key] = groups[key] || []).push({ slot: s, token: i, rel: rel });
        }
      }

      Object.keys(groups).forEach(function (key) {
        var group = groups[key];
        group.forEach(function (item, idx) {
          var node = tokenNodes[item.slot][item.token];
          var cell = cellFor(item.slot, item.rel, item.token);
          var stacked = group.length > 1;
          var half = stacked ? 0.31 : 0.39;
          var spread = stacked ? (idx - (group.length - 1) / 2) * 0.26 : 0;

          node.hidden = false;
          node.classList.toggle('stack', stacked);
          node.style.left = 'calc(var(--cell) * ' + (cell.c - half + spread).toFixed(3) + ')';
          node.style.top = 'calc(var(--cell) * ' + (cell.r - half).toFixed(3) + ')';
          node.style.zIndex = String(6 + idx);
        });
      });

      // Highlight the tokens the current player may move.
      var movableSet = {};
      (movable || []).forEach(function (m) { movableSet[m.token] = true; });
      for (var s2 = 0; s2 < 4; s2++) {
        for (var i2 = 0; i2 < 4; i2++) {
          var isMovable = state.active[s2] && s2 === turn && !!movableSet[i2] && !over;
          tokenNodes[s2][i2].classList.toggle('movable', isMovable);
        }
      }

      yardRows.forEach(function (y, i) {
        var home = homeCount(i);
        var yard = state.tokens[i].filter(function (r) { return r < 0; }).length;
        y.val.textContent = home + '/4';
        y.row.querySelector('.fill').textContent = seats[i].name + (yard ? ' · ' + yard + ' in yard' : '');
        y.row.classList.toggle('is-turn', i === turn && !over);
      });
      shell.updateSeats(over ? -1 : turn, function (i) { return homeCount(i) + '/4 home'; });
    }

    /* --- turn flow --- */

    function beginTurn() {
      if (over) return;
      sixStreak = 0;
      awaitingPick = null;
      render([]);
      promptRoll();
    }

    function promptRoll() {
      var seat = seats[turn];
      if (seat.isAI) {
        shell.say(shell.thinking(seat.name));
        dice.setEnabled(false);
        ticker.wait(620).then(function () { if (!ticker.dead && !over) dice.rollNow(); });
      } else {
        shell.say('<b>' + G.escapeHtml(seat.name) + '</b> - roll the dice');
        dice.setEnabled(true);
      }
    }

    function onRoll(value) {
      if (over) return;
      dice.setEnabled(false);
      var seat = seats[turn];

      if (value === 6) {
        sixStreak++;
        if (sixStreak === 3) {
          shell.say('Three sixes in a row - <b>' + G.escapeHtml(seat.name) + '</b> loses the turn');
          return ticker.wait(1100).then(nextPlayer);
        }
      }

      var moves = legalMoves(state, turn, value);
      if (!moves.length) {
        shell.say('Rolled ' + value + ' - no legal move for <b>' + G.escapeHtml(seat.name) + '</b>');
        return ticker.wait(1000).then(function () {
          if (value === 6 && sixStreak < 3) { promptRoll(); } else { nextPlayer(); }
        });
      }

      if (moves.length === 1) {
        shell.say('<b>' + G.escapeHtml(seat.name) + '</b> rolled ' + value + ' - only one move');
        return ticker.wait(520).then(function () { if (!ticker.dead) applyMove(moves[0], value); });
      }

      if (seat.isAI) {
        shell.say(shell.thinking(seat.name));
        return ticker.wait(560).then(function () {
          if (ticker.dead || over) return;
          applyMove(chooseMove(state, turn, moves, value, config.difficulty), value);
        });
      }

      awaitingPick = { moves: moves, die: value };
      shell.say('Rolled ' + value + ' - <b>' + G.escapeHtml(seat.name) + '</b>, pick a token');
      render(moves);
    }

    function onTokenClick(slot, tokenIndex) {
      if (over || !awaitingPick || slot !== turn || seats[turn].isAI) return;
      var chosen = null;
      awaitingPick.moves.forEach(function (m) { if (m.token === tokenIndex) chosen = m; });
      if (!chosen) return;
      var die = awaitingPick.die;
      awaitingPick = null;
      applyMove(chosen, die);
    }

    function applyMove(move, die) {
      var seat = seats[turn];
      state.tokens[turn][move.token] = move.to;

      var captured = move.capture.slice();
      captured.forEach(function (c) { state.tokens[c.slot][c.token] = -1; });

      render([]);

      var extra = (die === 6) || captured.length > 0 || move.entersHome;
      if (captured.length) {
        shell.say('💥 <b>' + G.escapeHtml(seat.name) + '</b> knocks ' +
          G.escapeHtml(seats[captured[0].slot].name) + ' back to the yard');
      } else if (move.entersHome) {
        shell.say('🏠 <b>' + G.escapeHtml(seat.name) + '</b> gets a token home');
      } else if (move.leavesYard) {
        shell.say('<b>' + G.escapeHtml(seat.name) + '</b> brings a token out');
      } else {
        shell.say('<b>' + G.escapeHtml(seat.name) + '</b> moves ' + die);
      }

      if (homeCount(turn) === 4) return ticker.wait(600).then(function () { win(turn); });

      return ticker.wait(captured.length || move.entersHome ? 900 : 560).then(function () {
        if (ticker.dead || over) return;
        if (extra && sixStreak < 3) {
          G.toast(die === 6 ? 'Six — roll again' : 'Bonus roll');
          promptRoll();
        } else {
          nextPlayer();
        }
      });
    }

    function nextPlayer() {
      if (ticker.dead || over) return;
      turn = (turn + 1) % seats.length;
      beginTurn();
    }

    function win(slot) {
      over = true;
      dice.setEnabled(false);
      render([]);
      var seat = seats[slot];
      var humanWon = !seat.isAI;
      config.finish(humanWon);
      shell.say('🏆 <b>' + G.escapeHtml(seat.name) + '</b> gets all four tokens home!');

      ticker.wait(900).then(function () {
        if (ticker.dead) return;
        G.modal({
          icon: humanWon ? '🏆' : '🤖',
          title: seat.name + ' wins!',
          body: 'All four tokens are home.',
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

    render([]);
    beginTurn();

    return { destroy: function () { ticker.kill(); } };
  }

  /* -------------------------------------------------------------- register */

  G.Games.register({
    id: 'ludo',
    name: 'Ludo',
    tagline: 'Race four tokens home',
    accent: '#2f7df6',
    icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none">' +
      '<rect x="2.5" y="2.5" width="19" height="19" rx="3" stroke="currentColor" stroke-width="1.5"/>' +
      '<rect x="4.5" y="4.5" width="6" height="6" rx="1.4" fill="#f0483c"/>' +
      '<rect x="13.5" y="4.5" width="6" height="6" rx="1.4" fill="#22b36b"/>' +
      '<rect x="4.5" y="13.5" width="6" height="6" rx="1.4" fill="#2f7df6"/>' +
      '<rect x="13.5" y="13.5" width="6" height="6" rx="1.4" fill="#f5c518"/>' +
      '<circle cx="12" cy="12" r="1.9" fill="currentColor" opacity=".55"/></svg>',
    minPlayers: 2,
    maxPlayers: 4,
    defaultPlayers: 2,
    difficulty: true,
    seatColors: ['#f0483c', '#22b36b', '#f5c518', '#2f7df6'],
    aiNames: ['Ava', 'Blaze', 'Cody', 'Dot'],
    options: [
      { key: 'blocks', label: 'Blocking', hint: 'Two tokens on one square stop opponents passing', default: true }
    ],
    rules:
      '<h4>Goal</h4><ul><li>Walk all <b>four of your tokens</b> around the board and into the centre.</li></ul>' +
      '<h4>Getting out</h4><ul><li>Tokens start in the yard. You need a <b>six</b> to bring one onto your coloured start square.</li></ul>' +
      '<h4>Moving</h4><ul>' +
      '<li>Move one token by the number rolled, clockwise around the shared track.</li>' +
      '<li>Land on a single opponent token and it goes <b>back to its yard</b> - and you roll again.</li>' +
      '<li>The eight <b>★ squares</b> are safe: nobody can be captured there.</li>' +
      '<li><b>Blocking</b> - two of your tokens on one square form a wall opponents cannot land on or pass.</li></ul>' +
      '<h4>Coming home</h4><ul>' +
      '<li>After a full lap a token turns into its own coloured column.</li>' +
      '<li>You need the <b>exact roll</b> to land in the centre. Too big a number and that token cannot move.</li></ul>' +
      '<h4>Extra turns</h4><ul>' +
      '<li>Roll a six, capture a token, or send one home and you roll again.</li>' +
      '<li><b>Three sixes in a row</b> and you forfeit the turn.</li></ul>',
    start: start
  });
})();
