/* ==========================================================================
   xo.js - X's & O's (noughts and crosses)

   Two games in one module, switched by the "Ultimate" house rule:

   Classic  a single 3x3 grid. Solved, so Hard plays perfect minimax and
            cannot be beaten - only held to a draw.
   Ultimate nine small boards in a 3x3 meta-grid. The cell you play dictates
            which board your opponent must answer in, which makes it deep
            enough to need a real search.

   Seat 1 is X, seat 2 is O.
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el, esc = G.escapeHtml;

  var LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],      // rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8],      // columns
    [0, 4, 8], [2, 4, 6]                  // diagonals
  ];

  var EMPTY = 0, DRAWN = 3;               // DRAWN marks a full, unwon small board

  /** Winner of a 9-cell grid (1 or 2), or 0. */
  function winnerOf(cells) {
    for (var i = 0; i < LINES.length; i++) {
      var a = LINES[i][0], b = LINES[i][1], c = LINES[i][2];
      if (cells[a] !== EMPTY && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
    }
    return 0;
  }

  function winningLine(cells) {
    for (var i = 0; i < LINES.length; i++) {
      var a = LINES[i][0], b = LINES[i][1], c = LINES[i][2];
      if (cells[a] !== EMPTY && cells[a] === cells[b] && cells[a] === cells[c]) return LINES[i];
    }
    return null;
  }

  function isFull(cells) {
    for (var i = 0; i < 9; i++) if (cells[i] === EMPTY) return false;
    return true;
  }

  function other(p) { return p === 1 ? 2 : 1; }
  function emptyGrid() { return [0, 0, 0, 0, 0, 0, 0, 0, 0]; }

  /* --------------------------------------------------------------- marks */

  /** An X or an O as inline SVG, so it scales and takes the seat colour. */
  function markSvg(player, color) {
    if (player === 1) {
      return '<svg viewBox="0 0 24 24" class="xo-svg" aria-hidden="true">' +
        '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="' + color +
        '" stroke-width="3.1" stroke-linecap="round"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" class="xo-svg" aria-hidden="true">' +
      '<circle cx="12" cy="12" r="6.4" fill="none" stroke="' + color +
      '" stroke-width="3.1"/></svg>';
  }

  function markName(player) { return player === 1 ? 'X' : 'O'; }

  /* ================================================================ CLASSIC
     3x3 is small enough to solve exhaustively, so Hard is simply perfect.
     Easy and Normal are deliberately flawed in specific, human ways.
     ===================================================================== */

  /** Index that completes a line for `player`, or -1. */
  function immediate(cells, player) {
    for (var i = 0; i < LINES.length; i++) {
      var L = LINES[i], n = 0, gap = -1;
      for (var k = 0; k < 3; k++) {
        if (cells[L[k]] === player) n++;
        else if (cells[L[k]] === EMPTY) gap = L[k];
        else { n = -9; break; }
      }
      if (n === 2 && gap >= 0) return gap;
    }
    return -1;
  }

  function emptiesOf(cells) {
    var out = [];
    for (var i = 0; i < 9; i++) if (cells[i] === EMPTY) out.push(i);
    return out;
  }

  /** Exhaustive negamax. Sooner wins score higher, so it finishes cleanly. */
  function solve(cells, player, depth) {
    var w = winnerOf(cells);
    if (w) return w === player ? 10 - depth : depth - 10;
    if (isFull(cells)) return 0;

    var best = -99;
    for (var i = 0; i < 9; i++) {
      if (cells[i] !== EMPTY) continue;
      cells[i] = player;
      var score = -solve(cells, other(player), depth + 1);
      cells[i] = EMPTY;
      if (score > best) best = score;
    }
    return best;
  }

  function perfectMove(cells, player) {
    var best = -99, choices = [];
    for (var i = 0; i < 9; i++) {
      if (cells[i] !== EMPTY) continue;
      cells[i] = player;
      var score = -solve(cells, other(player), 0);
      cells[i] = EMPTY;
      if (score > best) { best = score; choices = [i]; }
      else if (score === best) choices.push(i);
    }
    return choices.length ? G.pick(choices) : -1;
  }

  var CLASSIC_PREF = [4, 0, 2, 6, 8, 1, 3, 5, 7];   // centre, corners, edges

  function classicMove(cells, player, difficulty) {
    var empties = emptiesOf(cells);
    if (!empties.length) return -1;

    if (difficulty === 'easy') {
      // Mostly wanders, but will spot a win in front of it often enough
      // that it never feels broken.
      var win = immediate(cells, player);
      if (win >= 0 && G.random() < 0.55) return win;
      return G.pick(empties);
    }

    if (difficulty === 'normal') {
      // Takes a win, blocks a loss, then plays by position. Blind to forks,
      // which is exactly the gap a person learns to exploit.
      var w = immediate(cells, player);
      if (w >= 0) return w;
      var block = immediate(cells, other(player));
      if (block >= 0) return block;
      for (var i = 0; i < CLASSIC_PREF.length; i++) {
        if (cells[CLASSIC_PREF[i]] === EMPTY) return CLASSIC_PREF[i];
      }
      return G.pick(empties);
    }

    return perfectMove(cells, player);
  }

  /* =============================================================== ULTIMATE
     81 cells is far too wide to solve, so this is alpha-beta over a
     positional evaluation, with a node budget so a turn can never hang.
     ===================================================================== */

  // The centre board (and centre cells) sit on the most lines, so they matter most.
  var WEIGHT = [3, 2, 3, 2, 4, 2, 3, 2, 3];
  var NODE_CAP = 120000;
  var WIN_SCORE = 1000000;

  function newState() {
    var small = [];
    for (var i = 0; i < 9; i++) small.push(emptyGrid());
    return { small: small, meta: emptyGrid(), active: -1 };
  }

  /** Meta-grid with draws blanked, for win detection. */
  function metaCells(st) {
    var out = [];
    for (var i = 0; i < 9; i++) out.push(st.meta[i] === DRAWN ? EMPTY : st.meta[i]);
    return out;
  }
  function metaWinner(st) { return winnerOf(metaCells(st)); }

  function legalMoves(st) {
    var out = [], b;
    if (st.active >= 0 && st.meta[st.active] === EMPTY) {
      for (var c = 0; c < 9; c++) if (st.small[st.active][c] === EMPTY) out.push(st.active * 9 + c);
      return out;
    }
    for (b = 0; b < 9; b++) {
      if (st.meta[b] !== EMPTY) continue;
      for (var k = 0; k < 9; k++) if (st.small[b][k] === EMPTY) out.push(b * 9 + k);
    }
    return out;
  }

  function doMove(st, move, player) {
    var b = Math.floor(move / 9), c = move % 9;
    var undo = { b: b, c: c, prevMeta: st.meta[b], prevActive: st.active };
    st.small[b][c] = player;

    if (st.meta[b] === EMPTY) {
      var w = winnerOf(st.small[b]);
      if (w) st.meta[b] = w;
      else if (isFull(st.small[b])) st.meta[b] = DRAWN;
    }
    // Sent to the board matching the cell just played - unless it is settled.
    st.active = st.meta[c] === EMPTY ? c : -1;
    return undo;
  }

  function undoMove(st, undo) {
    st.small[undo.b][undo.c] = EMPTY;
    st.meta[undo.b] = undo.prevMeta;
    st.active = undo.prevActive;
  }

  /** Two-in-a-row-with-a-gap counting, from `me`'s point of view. */
  function lineScore(cells, me) {
    var opp = other(me), score = 0;
    for (var i = 0; i < LINES.length; i++) {
      var L = LINES[i], mine = 0, theirs = 0;
      for (var k = 0; k < 3; k++) {
        if (cells[L[k]] === me) mine++;
        else if (cells[L[k]] === opp) theirs++;
      }
      if (mine && theirs) continue;            // line is dead for both
      if (mine) score += mine * mine;
      else if (theirs) score -= theirs * theirs;
    }
    return score;
  }

  function evaluate(st, me) {
    var opp = other(me), score = 0;
    for (var b = 0; b < 9; b++) {
      if (st.meta[b] === me) score += 160 * WEIGHT[b];
      else if (st.meta[b] === opp) score -= 160 * WEIGHT[b];
      else if (st.meta[b] === EMPTY) score += lineScore(st.small[b], me) * WEIGHT[b];
    }
    score += lineScore(metaCells(st), me) * 45;
    return score;
  }

  var nodes = 0;

  function negamax(st, player, depth, alpha, beta) {
    nodes++;
    var mw = metaWinner(st);
    if (mw) return mw === player ? WIN_SCORE - depth : depth - WIN_SCORE;

    var moves = legalMoves(st);
    if (!moves.length) return 0;
    if (depth <= 0 || nodes > NODE_CAP) return evaluate(st, player);

    // Centre-first ordering makes alpha-beta cut far more.
    moves.sort(function (m, n) {
      return (WEIGHT[n % 9] + WEIGHT[Math.floor(n / 9)]) -
             (WEIGHT[m % 9] + WEIGHT[Math.floor(m / 9)]);
    });

    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var undo = doMove(st, moves[i], player);
      var score = -negamax(st, other(player), depth - 1, -beta, -alpha);
      undoMove(st, undo);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function ultimateMove(st, player, difficulty) {
    var moves = legalMoves(st);
    if (!moves.length) return -1;

    if (difficulty === 'easy') {
      // Grabs an obvious small-board win now and then, otherwise wanders.
      if (G.random() < 0.5) {
        for (var i = 0; i < moves.length; i++) {
          var b = Math.floor(moves[i] / 9), c = moves[i] % 9;
          if (st.meta[b] !== EMPTY) continue;
          st.small[b][c] = player;
          var won = winnerOf(st.small[b]) === player;
          st.small[b][c] = EMPTY;
          if (won) return moves[i];
        }
      }
      return G.pick(moves);
    }

    nodes = 0;
    var depth = difficulty === 'hard' ? 4 : 2;
    var best = -Infinity, choices = [];
    for (var m = 0; m < moves.length; m++) {
      var undo = doMove(st, moves[m], player);
      var score = -negamax(st, other(player), depth - 1, -Infinity, Infinity);
      undoMove(st, undo);
      if (score > best) { best = score; choices = [moves[m]]; }
      else if (score === best) choices.push(moves[m]);
    }
    return choices.length ? G.pick(choices) : moves[0];
  }

  /* ==================================================================== UI */

  function start(root, config) {
    var seats = config.seats;
    var shell = G.Shell(root);
    var ticker = G.Ticker();

    var opts = config.options || {};
    var ultimate = !!opts.ultimate;
    var difficulty = config.difficulty || 'normal';

    var turn = 0;                 // seat index; seat 0 is X
    var over = false;
    var busy = false;             // true while the computer is thinking

    var state = ultimate ? newState() : { cells: emptyGrid() };
    var cellNodes = [];           // flat: classic 9, ultimate 81
    var miniNodes = [];           // ultimate only

    function colorOf(player) { return seats[player - 1].color; }

    /* --- board --- */

    var boardEl;
    if (ultimate) {
      boardEl = el('div.xo-ultimate');
      for (var b = 0; b < 9; b++) {
        (function (b) {
          var mini = el('div.xo-mini');
          for (var c = 0; c < 9; c++) {
            (function (c) {
              var cell = el('button.xo-cell', {
                type: 'button',
                onclick: function () { onPlay(b * 9 + c); }
              });
              cellNodes[b * 9 + c] = cell;
              mini.appendChild(cell);
            })(c);
          }
          mini.appendChild(el('span.xo-mini-claim'));
          miniNodes[b] = mini;
          boardEl.appendChild(mini);
        })(b);
      }
    } else {
      boardEl = el('div.xo-board');
      for (var i = 0; i < 9; i++) {
        (function (i) {
          var cell = el('button.xo-cell', {
            type: 'button',
            onclick: function () { onPlay(i); }
          });
          cellNodes[i] = cell;
          boardEl.appendChild(cell);
        })(i);
      }
    }

    var legend = el('div.sl-legend',
      el('div', ultimate ? 'Win three small boards in a row' : 'Three in a row wins'),
      el('div', { html: ultimate ? 'Your cell sends them to that <b>board</b>' : '' })
    );

    shell.stage.appendChild(el('div.xo-wrap', boardEl, legend));
    shell.buildSeats(seats, function (seat, i) { return markName(i + 1); });
    shell.setActions(el('button.btn.btn-sm', {
      type: 'button', text: 'Restart', 'data-local': '1', onclick: function () { config.restart(); }
    }));

    /* --- rendering --- */

    function cellValue(idx) {
      return ultimate ? state.small[Math.floor(idx / 9)][idx % 9] : state.cells[idx];
    }

    function playableSet() {
      if (over || busy || seats[turn].isAI) return null;
      if (!ultimate) {
        var out = {};
        for (var i = 0; i < 9; i++) if (state.cells[i] === EMPTY) out[i] = true;
        return out;
      }
      var set = {}, moves = legalMoves(state);
      for (var m = 0; m < moves.length; m++) set[moves[m]] = true;
      return set;
    }

    function render() {
      var playable = playableSet();
      var total = ultimate ? 81 : 9;

      for (var i = 0; i < total; i++) {
        var node = cellNodes[i];
        var v = cellValue(i);
        var filled = v !== EMPTY;

        if (node._v !== v) {                   // only repaint when it changes
          node.innerHTML = filled ? markSvg(v, colorOf(v)) : '';
          node._v = v;
        }
        node.disabled = !playable || !playable[i];
        node.classList.toggle('is-open', !!(playable && playable[i]));
        node.setAttribute('aria-label', (ultimate
          ? 'Board ' + (Math.floor(i / 9) + 1) + ', cell ' + (i % 9 + 1)
          : 'Cell ' + (i + 1)) + (filled ? ', ' + markName(v) : ', empty'));
      }

      if (ultimate) {
        var free = state.active < 0 || state.meta[state.active] !== EMPTY;
        for (var b = 0; b < 9; b++) {
          var mini = miniNodes[b];
          var owner = state.meta[b];
          mini.classList.toggle('is-active', !over && !busy && (free || state.active === b) && owner === EMPTY);
          mini.classList.toggle('is-won', owner === 1 || owner === 2);
          mini.classList.toggle('is-drawn', owner === DRAWN);
          var claim = mini.lastChild;
          if (mini._owner !== owner) {
            claim.innerHTML = (owner === 1 || owner === 2) ? markSvg(owner, colorOf(owner)) : '';
            mini._owner = owner;
          }
        }
      }

      shell.updateSeats(over ? -1 : turn, function (i) { return markName(i + 1); });
    }

    function highlight(indices) {
      for (var i = 0; i < indices.length; i++) cellNodes[indices[i]].classList.add('is-win');
    }

    /* --- turn flow --- */

    function say() {
      if (over) return;
      var seat = seats[turn];
      if (seat.isAI) { shell.say(shell.thinking(seat.name)); return; }
      var who = '<b>' + esc(seat.name) + '</b> (' + markName(turn + 1) + ')';
      if (!ultimate) { shell.say(who + ' &mdash; pick a square'); return; }
      var free = state.active < 0 || state.meta[state.active] !== EMPTY;
      shell.say(who + (free ? ' &mdash; play anywhere' : ' &mdash; play in the highlighted board'));
    }

    function onPlay(idx) {
      if (over || busy || seats[turn].isAI) return;
      var playable = playableSet();
      if (!playable || !playable[idx]) return;
      commit(idx);
    }

    function commit(idx) {
      var player = turn + 1;
      if (ultimate) doMove(state, idx, player);
      else state.cells[idx] = player;

      var result = check();
      render();
      if (result) return settle(result);

      turn = (turn + 1) % seats.length;
      say();
      render();
      if (seats[turn].isAI) aiTurn();
    }

    /** null if the game continues, else {winner, line} with winner 0 for a draw. */
    function check() {
      if (ultimate) {
        var mw = metaWinner(state);
        if (mw) return { winner: mw, line: winningLine(metaCells(state)) };
        if (!legalMoves(state).length) return { winner: 0, line: null };
        return null;
      }
      var w = winnerOf(state.cells);
      if (w) return { winner: w, line: winningLine(state.cells) };
      if (isFull(state.cells)) return { winner: 0, line: null };
      return null;
    }

    function aiTurn() {
      busy = true;
      render();
      // A beat so the move reads as a decision rather than a twitch.
      ticker.wait(340 + G.rand(260)).then(function () {
        if (ticker.dead || over) return;
        var player = turn + 1;
        var idx = ultimate
          ? ultimateMove(state, player, difficulty)
          : classicMove(state.cells, player, difficulty);
        busy = false;
        if (idx < 0) return;
        commit(idx);
      });
    }

    function settle(result) {
      over = true;
      busy = false;

      if (result.line) {
        if (ultimate) {
          // Light up every cell of the three boards that won it.
          for (var k = 0; k < result.line.length; k++) {
            var b = result.line[k];
            miniNodes[b].classList.add('is-win');
            for (var c = 0; c < 9; c++) cellNodes[b * 9 + c].classList.add('is-win');
          }
        } else {
          highlight(result.line);
        }
      }
      render();

      var draw = result.winner === 0;
      var seat = draw ? null : seats[result.winner - 1];
      var humanWon = !!(seat && !seat.isAI);
      config.finish(humanWon);

      shell.say(draw
        ? 'A draw &mdash; nobody gets three'
        : '<b>' + esc(seat.name) + '</b> (' + markName(result.winner) + ') wins!');

      var body = draw
        ? (difficulty === 'hard' && !ultimate
            ? 'A draw is the best anyone can do against a perfect game.'
            : 'Neither side could get three in a row.')
        : (ultimate ? 'Three small boards in a row.' : 'Three in a row.');

      ticker.wait(760).then(function () {
        if (ticker.dead) return;
        G.modal({
          icon: draw ? '🤝' : (humanWon ? '🏆' : '🤖'),
          title: draw ? "It's a draw" : seat.name + ' wins!',
          body: body,
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

    say();
    render();
    if (seats[turn].isAI) aiTurn();

    return { destroy: function () { ticker.kill(); } };
  }

  /* -------------------------------------------------------------- register */

  G.Games.register({
    id: 'xo',
    name: "X's & O's",
    tagline: 'Three in a row',
    accent: '#43d9ad',
    icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none">' +
      '<path d="M8.6 2.5v19M15.4 2.5v19M2.5 8.6h19M2.5 15.4h19" stroke="currentColor" ' +
      'stroke-width="1.5" opacity=".45" stroke-linecap="round"/>' +
      '<path d="M4.1 4.1l3.4 3.4M7.5 4.1L4.1 7.5" stroke="#43d9ad" stroke-width="1.9" stroke-linecap="round"/>' +
      '<circle cx="12" cy="12" r="2.1" stroke="#f5a524" stroke-width="1.9"/>' +
      '<path d="M16.5 16.5l3.4 3.4M19.9 16.5l-3.4 3.4" stroke="#43d9ad" stroke-width="1.9" stroke-linecap="round"/>' +
      '</svg>',
    minPlayers: 2,
    maxPlayers: 2,
    defaultPlayers: 2,
    difficulty: true,
    seatColors: ['#43d9ad', '#f5a524'],
    aiNames: ['Ava', 'Blaze'],
    options: [
      {
        key: 'ultimate',
        label: 'Ultimate',
        hint: 'Nine boards - your cell picks their board',
        default: false
      }
    ],
    rules:
      '<h4>Goal</h4><ul><li>Get <b>three of your marks in a row</b> &mdash; across, down or diagonally.</li></ul>' +
      '<h4>Play</h4><ul>' +
      '<li>X goes first. Take turns claiming an empty square.</li>' +
      '<li>Fill the grid with no line of three and it is a draw.</li></ul>' +
      '<h4>Ultimate</h4><ul>' +
      '<li>Nine small boards arranged in a 3&times;3 grid. Win a small board to claim it.</li>' +
      '<li><b>Claim three small boards in a row</b> to win the game.</li>' +
      '<li>The cell you play sends your opponent to the matching board &mdash; play the ' +
      'top-right cell and they must answer in the top-right board.</li>' +
      '<li>If that board is already claimed or full, they may play anywhere.</li>' +
      '<li>The board you must play in is outlined; a claimed board shows a large mark.</li></ul>' +
      '<h4>Computer skill</h4><ul>' +
      '<li><b>Easy</b> wanders, and only sometimes spots a win in front of it.</li>' +
      '<li><b>Normal</b> takes wins and blocks losses, but is blind to forks.</li>' +
      '<li><b>Hard</b> on the classic board plays a <b>perfect</b> game &mdash; it cannot be ' +
      'beaten, only drawn. On Ultimate it searches four moves deep.</li></ul>',
    start: start
  });
})();
