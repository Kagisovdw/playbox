/* ==========================================================================
   connect4.js - Connect Four with an alpha-beta minimax opponent
   Board is a flat array of 42: index = row * 7 + col, row 0 = top.
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el;
  var COLS = 7, ROWS = 6, SIZE = COLS * ROWS;
  var EMPTY = 0;

  /* ------------------------------------------------------------ game rules */

  function newBoard() {
    var b = new Int8Array(SIZE);
    return b;
  }

  /** Lowest empty row in a column, or -1 if the column is full. */
  function landingRow(board, col) {
    for (var r = ROWS - 1; r >= 0; r--) {
      if (board[r * COLS + col] === EMPTY) return r;
    }
    return -1;
  }

  function validMoves(board) {
    var out = [];
    for (var c = 0; c < COLS; c++) if (board[c] === EMPTY) out.push(c);
    return out;
  }

  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  /** If `player` has four through (r,c), return the four cell indices. */
  function winningLine(board, r, c, player) {
    for (var d = 0; d < DIRS.length; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      var cells = [r * COLS + c];
      var k, rr, cc;
      for (k = 1; k < 4; k++) {
        rr = r + dr * k; cc = c + dc * k;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr * COLS + cc] !== player) break;
        cells.push(rr * COLS + cc);
      }
      for (k = 1; k < 4; k++) {
        rr = r - dr * k; cc = c - dc * k;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || board[rr * COLS + cc] !== player) break;
        cells.unshift(rr * COLS + cc);
      }
      if (cells.length >= 4) return cells.slice(0, 4);
    }
    return null;
  }

  function isFull(board) {
    for (var c = 0; c < COLS; c++) if (board[c] === EMPTY) return false;
    return true;
  }

  /* ------------------------------------------------------------------- AI */

  // Every 4-cell window on the board, precomputed once.
  var WINDOWS = (function () {
    var out = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        for (var d = 0; d < DIRS.length; d++) {
          var dr = DIRS[d][0], dc = DIRS[d][1];
          var endR = r + dr * 3, endC = c + dc * 3;
          if (endR < 0 || endR >= ROWS || endC < 0 || endC >= COLS) continue;
          out.push([
            r * COLS + c,
            (r + dr) * COLS + (c + dc),
            (r + dr * 2) * COLS + (c + dc * 2),
            endR * COLS + endC
          ]);
        }
      }
    }
    return out;
  })();

  // Centre columns are worth more; used as a tie-breaker in the heuristic.
  var CENTRE_BONUS = [0, 1, 2, 4, 2, 1, 0];

  /** Static evaluation from `me`'s point of view. */
  function evaluate(board, me) {
    var them = me === 1 ? 2 : 1;
    var score = 0, w, i, mine, theirs, cell;

    for (w = 0; w < WINDOWS.length; w++) {
      mine = 0; theirs = 0;
      for (i = 0; i < 4; i++) {
        cell = board[WINDOWS[w][i]];
        if (cell === me) mine++;
        else if (cell === them) theirs++;
      }
      if (mine && theirs) continue;              // blocked window, worthless
      if (mine === 3) score += 60;
      else if (mine === 2) score += 9;
      else if (mine === 1) score += 1;
      else if (theirs === 3) score -= 75;        // fear losing slightly more
      else if (theirs === 2) score -= 10;
      else if (theirs === 1) score -= 1;
    }

    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        cell = board[r * COLS + c];
        if (cell === me) score += CENTRE_BONUS[c];
        else if (cell === them) score -= CENTRE_BONUS[c];
      }
    }
    return score;
  }

  var ORDER = [3, 2, 4, 1, 5, 0, 6];            // search the middle first
  var WIN_SCORE = 1000000;

  /**
   * Negamax with alpha-beta. Returns a score for `me` to move.
   * `lastWin` short-circuits: the move that created it already ended the game.
   */
  function negamax(board, depth, alpha, beta, me, them) {
    var moves = [], c, i;
    for (i = 0; i < ORDER.length; i++) {
      c = ORDER[i];
      if (board[c] === EMPTY) moves.push(c);
    }
    if (!moves.length) return 0;                 // draw

    // A win available right now is taken immediately, scaled by depth so the
    // engine prefers winning sooner and losing later.
    for (i = 0; i < moves.length; i++) {
      c = moves[i];
      var r = landingRow(board, c);
      board[r * COLS + c] = me;
      var win = winningLine(board, r, c, me);
      board[r * COLS + c] = EMPTY;
      if (win) return WIN_SCORE + depth;
    }

    if (depth === 0) return evaluate(board, me);

    var best = -Infinity;
    for (i = 0; i < moves.length; i++) {
      c = moves[i];
      var row = landingRow(board, c);
      board[row * COLS + c] = me;
      var value = -negamax(board, depth - 1, -beta, -alpha, them, me);
      board[row * COLS + c] = EMPTY;
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;                  // prune
    }
    return best;
  }

  var DEPTH = { easy: 1, normal: 4, hard: 6 };

  /** Choose a column for `me`. */
  function chooseMove(board, me, difficulty) {
    var them = me === 1 ? 2 : 1;
    var moves = validMoves(board);
    if (!moves.length) return -1;

    // Easy still blocks the obvious, but wanders a third of the time.
    if (difficulty === 'easy' && Math.random() < 0.34) return G.pick(moves);

    var depth = DEPTH[difficulty] || 4;
    var best = -Infinity, bestMoves = [];

    for (var i = 0; i < ORDER.length; i++) {
      var c = ORDER[i];
      if (board[c] !== EMPTY) continue;
      var r = landingRow(board, c);
      board[r * COLS + c] = me;
      var value;
      if (winningLine(board, r, c, me)) value = WIN_SCORE + depth;
      else value = -negamax(board, depth - 1, -Infinity, Infinity, them, me);
      board[r * COLS + c] = EMPTY;

      if (value > best + 0.5) { best = value; bestMoves = [c]; }
      else if (Math.abs(value - best) <= 0.5) { bestMoves.push(c); }
    }
    return G.pick(bestMoves);
  }

  /* ----------------------------------------------------------------- view */

  function start(root, config) {
    var seats = config.seats;                   // exactly 2
    var shell = G.Shell(root);
    var ticker = G.Ticker();

    var board = newBoard();
    var turn = 0;                                // seat index
    var moveCount = 0;
    var over = false;
    var cellNodes = [];
    var colButtons = [];

    /* --- build the board --- */
    var grid = el('div.c4-grid');
    for (var i = 0; i < SIZE; i++) {
      var cell = el('div.c4-cell');
      grid.appendChild(cell);
      cellNodes.push(cell);
    }

    var cols = el('div.c4-cols');
    for (var c = 0; c < COLS; c++) {
      (function (c) {
        var ghost = el('span.c4-ghost');
        var btn = el('button.c4-col', {
          type: 'button',
          'aria-label': 'Drop in column ' + (c + 1),
          onclick: function () { humanDrop(c); }
        }, ghost);
        cols.appendChild(btn);
        colButtons.push({ btn: btn, ghost: ghost });
      })(c);
    }

    var boardEl = el('div.c4-board', grid, cols);
    shell.stage.appendChild(boardEl);

    shell.buildSeats(seats, function (seat) { return seat.isAI ? 'CPU' : 'You'; });
    shell.setActions(el('button.btn.btn-sm', {
      type: 'button', text: 'Restart', onclick: function () { config.restart(); }
    }));

    /* --- keyboard: 1-7 drops, or arrow keys --- */
    var focusCol = 3;
    function onKey(e) {
      if (over) return;
      if (e.key >= '1' && e.key <= '7') { humanDrop(parseInt(e.key, 10) - 1); return; }
      if (e.key === 'ArrowLeft') { focusCol = Math.max(0, focusCol - 1); colButtons[focusCol].btn.focus(); }
      if (e.key === 'ArrowRight') { focusCol = Math.min(COLS - 1, focusCol + 1); colButtons[focusCol].btn.focus(); }
      if (e.key === 'Enter' || e.key === ' ') { /* the focused button handles it */ }
    }
    document.addEventListener('keydown', onKey);

    /* --- turn flow --- */

    function refresh() {
      var seat = seats[turn];
      var canClick = !over && !seat.isAI;
      colButtons.forEach(function (cb, c) {
        cb.btn.disabled = !canClick || board[c] !== EMPTY;
        cb.ghost.style.setProperty('--disc', seat.color);
      });
      shell.updateSeats(turn);
      if (over) return;
      if (seat.isAI) shell.say(shell.thinking(seat.name));
      else shell.say('<b>' + G.escapeHtml(seat.name) + '</b>, pick a column');
    }

    function humanDrop(col) {
      if (over || seats[turn].isAI) return;
      if (col < 0 || col >= COLS || board[col] !== EMPTY) return;
      place(col);
    }

    function place(col) {
      var row = landingRow(board, col);
      if (row < 0) return;
      var player = turn + 1;
      board[row * COLS + col] = player;
      moveCount++;

      var disc = el('span.c4-disc', {
        style: {
          '--disc': seats[turn].color,
          '--from': 'calc(var(--cell) * ' + (-(row + 1.4)).toFixed(2) + ')'
        }
      });
      cellNodes[row * COLS + col].appendChild(disc);

      var line = winningLine(board, row, col, player);
      if (line) { finish(line); return; }
      if (isFull(board)) { finish(null); return; }

      turn = (turn + 1) % seats.length;
      refresh();
      if (seats[turn].isAI) aiTurn();
    }

    function aiTurn() {
      var seat = seats[turn];
      // A short pause so the move reads as a decision, plus time for the drop.
      ticker.wait(420 + G.rand(280)).then(function () {
        if (ticker.dead || over) return;
        var col = chooseMove(board, turn + 1, config.difficulty);
        if (col >= 0) place(col);
      });
    }

    function finish(line) {
      over = true;
      colButtons.forEach(function (cb) { cb.btn.disabled = true; });

      if (line) {
        line.forEach(function (idx) {
          var disc = cellNodes[idx].firstChild;
          if (disc) disc.classList.add('win');
        });
      }
      shell.updateSeats(-1);

      var winner = line ? seats[turn] : null;
      var humanWon = !!(winner && !winner.isAI);
      config.finish(humanWon);

      shell.say(winner
        ? '<b>' + G.escapeHtml(winner.name) + '</b> connected four'
        : 'A draw - the board is full');

      ticker.wait(line ? 1100 : 600).then(function () {
        if (ticker.dead) return;
        G.modal({
          icon: winner ? (humanWon ? '🏆' : '🤖') : '🤝',
          title: winner ? winner.name + ' wins!' : 'Dead heat',
          body: winner
            ? 'Four in a row after ' + moveCount + ' discs.'
            : 'All 42 discs played with no line of four.',
          dismissable: false,
          actions: [
            { label: 'Menu', value: 'menu', ghost: true },
            { label: 'Play again', value: 'again', primary: true }
          ]
        }).then(function (choice) {
          if (ticker.dead) return;
          if (choice === 'again') config.restart();
          else config.exit();
        });
      });
    }

    refresh();
    if (seats[turn].isAI) aiTurn();

    return {
      destroy: function () {
        ticker.kill();
        document.removeEventListener('keydown', onKey);
      }
    };
  }

  /* -------------------------------------------------------------- register */

  G.Games.register({
    id: 'connect4',
    name: 'Connect Four',
    tagline: 'Line up four before they do',
    accent: '#f5a524',
    icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none">' +
      '<rect x="2.5" y="3.5" width="19" height="17" rx="3" stroke="currentColor" stroke-width="1.6"/>' +
      '<circle cx="7.5" cy="8.5" r="2" fill="#f5a524"/><circle cx="12" cy="8.5" r="2" fill="currentColor" opacity=".28"/>' +
      '<circle cx="16.5" cy="8.5" r="2" fill="currentColor" opacity=".28"/>' +
      '<circle cx="7.5" cy="15" r="2" fill="#e5484d"/><circle cx="12" cy="15" r="2" fill="#f5a524"/>' +
      '<circle cx="16.5" cy="15" r="2" fill="currentColor" opacity=".28"/></svg>',
    minPlayers: 2,
    maxPlayers: 2,
    defaultPlayers: 2,
    difficulty: true,
    seatColors: ['#e5484d', '#f5c518'],
    aiNames: ['Ava', 'Blaze'],
    rules:
      '<h4>Goal</h4><ul><li>Get <b>four of your discs in a row</b> - across, up, or diagonally.</li></ul>' +
      '<h4>Play</h4><ul>' +
      '<li>Take turns dropping one disc into any column that is not full.</li>' +
      '<li>Discs stack from the bottom up - you choose the column, gravity chooses the row.</li>' +
      '<li>If all 42 slots fill with no line of four, the game is a draw.</li></ul>' +
      '<h4>Controls</h4><ul><li>Click a column, or press <b>1-7</b>.</li></ul>' +
      '<h4>Computer skill</h4><ul>' +
      '<li><b>Easy</b> looks one move ahead and often wanders.</li>' +
      '<li><b>Normal</b> searches four moves deep.</li>' +
      '<li><b>Hard</b> searches six moves deep - it will punish a loose move.</li></ul>',
    start: start
  });
})();
