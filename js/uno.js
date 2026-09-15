/* ==========================================================================
   uno.js - Uno

   108 cards: per colour 0 x1, 1-9 x2, Skip/Reverse/Draw Two x2, plus
   4 Wild and 4 Wild Draw Four.

   Card = { id, color:'r'|'y'|'g'|'b'|null, kind, value }
   kind = 'num' | 'skip' | 'rev' | 'draw2' | 'wild' | 'wild4'
   ========================================================================== */
(function () {
  'use strict';

  var el = G.el;

  var COLORS = ['r', 'y', 'g', 'b'];
  var HEX = { r: '#f0483c', y: '#f5c518', g: '#22b36b', b: '#2f7df6' };
  var COLOR_NAME = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' };

  var GLYPH = { skip: '⊘', rev: '⇄', draw2: '+2', wild: 'W', wild4: '+4' };

  /* ----------------------------------------------------------------- deck */

  function buildDeck() {
    var deck = [], id = 0;
    COLORS.forEach(function (c) {
      deck.push({ id: id++, color: c, kind: 'num', value: 0 });
      for (var v = 1; v <= 9; v++) {
        deck.push({ id: id++, color: c, kind: 'num', value: v });
        deck.push({ id: id++, color: c, kind: 'num', value: v });
      }
      ['skip', 'rev', 'draw2'].forEach(function (k) {
        deck.push({ id: id++, color: c, kind: k, value: null });
        deck.push({ id: id++, color: c, kind: k, value: null });
      });
    });
    for (var w = 0; w < 4; w++) {
      deck.push({ id: id++, color: null, kind: 'wild', value: null });
      deck.push({ id: id++, color: null, kind: 'wild4', value: null });
    }
    return G.shuffle(deck);
  }

  function isWild(card) { return card.kind === 'wild' || card.kind === 'wild4'; }

  function cardPoints(card) {
    if (card.kind === 'num') return card.value;
    if (isWild(card)) return 50;
    return 20;
  }

  function cardLabel(card) {
    if (card.kind === 'num') return COLOR_NAME[card.color] + ' ' + card.value;
    if (card.kind === 'wild') return 'Wild';
    if (card.kind === 'wild4') return 'Wild Draw Four';
    var names = { skip: 'Skip', rev: 'Reverse', draw2: 'Draw Two' };
    return COLOR_NAME[card.color] + ' ' + names[card.kind];
  }

  /** Can `card` go on a pile showing `top` under `color`? (Wild legality aside.) */
  function matches(card, top, color) {
    if (isWild(card)) return true;
    if (card.color === color) return true;
    if (card.kind === 'num' && top.kind === 'num' && card.value === top.value) return true;
    if (card.kind !== 'num' && card.kind === top.kind) return true;
    return false;
  }

  /* ------------------------------------------------------------- card view */

  function cardNode(card, extraClass) {
    if (!card) {
      return el('div.uno-card.back' + (extraClass || ''), el('span.oval'), el('span.glyph', { text: 'UNO' }));
    }
    var wild = isWild(card);
    var cls = '.uno-card' + (wild ? '.wild' : '') + (extraClass || '');
    var node = el('div' + cls, {
      style: { '--uno-color': wild ? '#20243c' : HEX[card.color] },
      title: cardLabel(card)
    });
    node.appendChild(el('span.oval'));

    var text = card.kind === 'num' ? String(card.value) : GLYPH[card.kind];
    node.appendChild(el('span.glyph' + (card.kind === 'num' ? '' : '.sym'), { text: text }));
    node.appendChild(el('span.corner.tl', { text: text }));
    node.appendChild(el('span.corner.br', { text: text }));
    return node;
  }

  /* ------------------------------------------------------------------- AI */

  /** Which of `hand` may legally be played right now. */
  function playableIndices(hand, top, color, strictWild4) {
    var out = [];
    var hasColor = hand.some(function (c) { return c.color === color; });
    hand.forEach(function (card, i) {
      if (card.kind === 'wild4' && strictWild4 && hasColor) return;
      if (matches(card, top, color)) out.push(i);
    });
    return out;
  }

  /** The colour an AI should call after a wild. */
  function bestColor(hand) {
    var tally = { r: 0, y: 0, g: 0, b: 0 };
    hand.forEach(function (c) { if (c.color) tally[c.color] += c.kind === 'num' ? 1 : 1.4; });
    var best = COLORS[0];
    COLORS.forEach(function (c) { if (tally[c] > tally[best]) best = c; });
    if (tally[best] === 0) return G.pick(COLORS);
    return best;
  }

  /**
   * Pick a card index to play. `pressure` is the next player's hand size -
   * a small number means it is worth spending an action card on them.
   */
  function aiChoose(hand, options, top, color, pressure, difficulty) {
    if (!options.length) return -1;
    if (difficulty === 'easy' && G.random() < 0.45) return G.pick(options);

    var scored = options.map(function (i) {
      var card = hand[i];
      var score = 0;

      // Dump the biggest liability first, but keep wilds in reserve.
      if (card.kind === 'wild4') score += pressure <= 2 ? 90 : 8;
      else if (card.kind === 'wild') score += pressure <= 2 ? 55 : 12;
      else if (card.kind === 'draw2') score += pressure <= 2 ? 85 : 52;
      else if (card.kind === 'skip') score += pressure <= 2 ? 78 : 46;
      else if (card.kind === 'rev') score += pressure <= 2 ? 60 : 40;
      else score += 34 + card.value;                       // shed high numbers first

      // Staying in a colour you hold plenty of keeps options open next turn.
      if (card.color) {
        var same = hand.filter(function (c) { return c.color === card.color; }).length;
        score += same * 4;
      }
      if (difficulty !== 'hard') score += G.rand(22);
      return { i: i, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored[0].i;
  }

  /* ----------------------------------------------------------------- game */

  function start(root, config) {
    var seats = config.seats;
    var shell = G.Shell(root);
    var ticker = G.Ticker();

    var opts = config.options || {};
    var strictWild4 = opts.strictWild4 === true;     // off = bluffing allowed
    var toFiveHundred = opts.toFiveHundred === true;

    var humanSeats = seats.filter(function (s) { return !s.isAI; });
    var multiHuman = humanSeats.length > 1;

    var deck = [], discard = [], hands = [], scores = seats.map(function () { return 0; });
    var color = 'r', turn = 0, dir = 1, over = false, roundOver = false;
    var unoFlag = seats.map(function () { return false; });
    /**
     * Across devices each player has their own screen, so this device shows
     * its own seat's hand and nothing else - no passing, no peeking. On one
     * device it stays as it was: the current human, behind a hand-off screen.
     */
    var netSeat = (G.Net && G.Net.playing && G.Net.seat >= 0 && G.Net.seat < seats.length)
      ? G.Net.seat : -1;
    var networked = netSeat >= 0;

    var viewSeat = networked
      ? netSeat
      : seats.findIndex(function (s) { return !s.isAI; });   // whose hand is face-up
    var lastHumanSeen = -1;
    var pendingDrawnIndex = -1;                      // card just drawn, awaiting play/keep

    /* --- layout --- */
    var oppRow = el('div.uno-opponents');
    var deckPile = el('div.uno-pile');
    var discardPile = el('div.uno-pile.uno-discard');
    var arrowBox = el('div.uno-arrow');
    var middle = el('div.uno-middle', deckPile, arrowBox, discardPile);
    var handHead = el('div.uno-hand-head');
    var handRow = el('div.uno-hand');
    var table = el('div.uno-table', oppRow, middle, el('div.uno-hand-wrap', handHead, handRow));

    shell.stage.appendChild(table);
    shell.stage.classList.add('full');
    shell.buildSeats(seats, function (seat, i) { return seat.isAI ? 'CPU' : 'You'; });

    /* --------------------------------------------------------- round setup */

    function newRound() {
      deck = buildDeck();
      discard = [];
      hands = seats.map(function () { return deck.splice(0, 7); });
      unoFlag = seats.map(function () { return false; });
      dir = 1;
      roundOver = false;
      pendingDrawnIndex = -1;

      // Turn the first card. A Wild Draw Four goes back in and we try again.
      var first;
      do {
        first = deck.shift();
        if (first.kind === 'wild4') { deck.push(first); G.shuffle(deck); first = null; }
      } while (!first);
      discard.push(first);
      color = first.color || G.pick(COLORS);

      turn = 0;
      var opening = '';

      if (first.kind === 'wild') {
        color = G.pick(COLORS);
        opening = 'Opening wild - colour is ' + COLOR_NAME[color];
      } else if (first.kind === 'rev') {
        dir = -1;
        turn = seats.length === 2 ? 0 : seats.length - 1;
        opening = 'Opening reverse - play runs the other way';
      } else if (first.kind === 'skip') {
        turn = nextIndex(0, 1);
        opening = 'Opening skip - ' + seats[0].name + ' misses the first turn';
      } else if (first.kind === 'draw2') {
        hands[0] = hands[0].concat(drawFromDeck(2));
        turn = nextIndex(0, 1);
        opening = 'Opening Draw Two - ' + seats[0].name + ' picks up 2 and is skipped';
      }

      render();
      if (opening) G.toast(opening, 2600);
      beginTurn();
    }

    function drawFromDeck(n) {
      var out = [];
      for (var i = 0; i < n; i++) {
        if (!deck.length) {
          if (discard.length <= 1) break;             // nothing left to recycle
          var top = discard.pop();
          deck = G.shuffle(discard.map(function (c) {
            return isWild(c) ? { id: c.id, color: null, kind: c.kind, value: null } : c;
          }));
          discard = [top];
          G.toast('Deck reshuffled');
        }
        out.push(deck.shift());
      }
      return out;
    }

    function nextIndex(from, steps) {
      var n = seats.length;
      return ((from + dir * steps) % n + n) % n;
    }

    function topCard() { return discard[discard.length - 1]; }

    /* ------------------------------------------------------------ rendering */

    function render() {
      // Opponents (everyone whose hand is not face-up).
      G.clear(oppRow);
      seats.forEach(function (seat, i) {
        if (i === viewSeat) return;
        var backs = el('div.uno-backs');
        var shown = Math.min(hands[i].length, 7);
        for (var k = 0; k < shown; k++) backs.appendChild(el('div.mini'));
        var node = el('div.uno-opp' + (i === turn && !roundOver ? '.is-turn' : '') +
          (hands[i].length === 1 && unoFlag[i] ? '.uno-called' : ''), {
          style: { '--seat-color': seat.color }
        },
          el('div.who', el('span.seat-dot', { style: { background: seat.color } }), seat.name),
          backs,
          el('div.cardcount', {
            text: hands[i].length === 1
              ? (unoFlag[i] ? 'UNO!' : '1 card')
              : hands[i].length + ' cards' + (toFiveHundred ? ' · ' + scores[i] + 'pt' : '')
          })
        );
        oppRow.appendChild(node);
      });

      // Draw pile.
      G.clear(deckPile);
      var canDraw = !roundOver && viewSeat === turn && !seats[turn].isAI && pendingDrawnIndex === -1;
      var back = cardNode(null, '.uno-deck' + (canDraw ? '' : '.dim'));
      if (canDraw) {
        back.setAttribute('data-play', 'draw');    // relayed across devices
        back.addEventListener('click', humanDraw);
      }
      deckPile.appendChild(back);
      deckPile.appendChild(el('div.label', { text: deck.length + ' left' }));

      // Discard pile with the colour currently in force.
      G.clear(discardPile);
      discardPile.appendChild(cardNode(topCard()));
      discardPile.appendChild(el('div.label',
        el('span.uno-colorchip', {
          style: { background: HEX[color], display: 'inline-block', verticalAlign: 'middle', marginRight: '5px' }
        }),
        COLOR_NAME[color]
      ));

      // Direction indicator.
      G.clear(arrowBox);
      arrowBox.className = 'uno-arrow' + (dir === -1 ? ' rev' : '');
      arrowBox.appendChild(G.svg('viewBox="0 0 24 24" width="34" height="34" fill="none">' +
        '<path d="M4 12a8 8 0 1 1 3 6.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M3 20.5V15h5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>'));
      arrowBox.appendChild(el('span', { text: dir === 1 ? 'Clockwise' : 'Anticlockwise' }));

      renderHand();
      shell.updateSeats(roundOver ? -1 : turn, function (i) {
        var n = hands[i] ? hands[i].length : 0;
        return n + ' card' + (n === 1 ? '' : 's') + (toFiveHundred ? ' · ' + scores[i] + 'p' : '');
      });
    }

    function renderHand() {
      G.clear(handHead);
      G.clear(handRow);

      if (viewSeat < 0) {
        handHead.appendChild(el('span', {
          text: humanSeats.length
            ? 'Hand hidden - waiting for the next player.'
            : 'All seats are computers - sit back and watch.'
        }));
        return;
      }

      var seat = seats[viewSeat];
      var myTurn = viewSeat === turn && !roundOver;
      var hand = hands[viewSeat];

      handHead.appendChild(el('span',
        el('b', { text: seat.name }), ' · ' + hand.length + ' card' + (hand.length === 1 ? '' : 's') +
        (toFiveHundred ? ' · ' + scores[viewSeat] + ' pts' : '')
      ));

      var playable = myTurn ? playableIndices(hand, topCard(), color, strictWild4) : [];
      var playableSet = {};
      playable.forEach(function (i) { playableSet[i] = true; });

      hand.forEach(function (card, i) {
        var ok = !!playableSet[i] && pendingDrawnIndex === -1;
        var node = cardNode(card, ok ? '.playable' : (myTurn ? '.blocked' : ''));
        node.setAttribute('data-play', 'card');    // relayed across devices
        if (i === pendingDrawnIndex) node.classList.add('just-drawn');
        if (ok) {
          node.addEventListener('click', function () { humanPlay(i); });
        } else if (myTurn && pendingDrawnIndex === -1) {
          node.addEventListener('click', function () {
            G.toast(card.kind === 'wild4' && strictWild4
              ? 'You still hold a ' + COLOR_NAME[color] + ' card'
              : 'That card does not match');
          });
        }
        handRow.appendChild(el('div.slot', node));
      });

      if (myTurn && pendingDrawnIndex === -1 && !playable.length) {
        handHead.appendChild(el('span.muted', { text: '· nothing playable, take a card' }));
      }

      fanHand(hand.length);
    }

    /**
     * Space the hand to fit: a small gap while it fits, overlapping only
     * once there are too many cards for the row.
     */
    function fanHand(count) {
      var cardW = Math.min(78, Math.max(56, window.innerWidth * 0.12));
      var available = (handRow.clientWidth || table.clientWidth || 600) - 10;
      var gap = 6;
      var shift = gap;
      if (count > 1) {
        var needed = count * cardW + (count - 1) * gap;
        if (needed > available) {
          var crowding = (count * cardW - available) / (count - 1);
          shift = -Math.min(cardW * 0.62, Math.max(0, crowding));
        }
      }
      handRow.style.setProperty('--slot-shift', shift.toFixed(1) + 'px');
    }

    /* ---------------------------------------------------------- turn flow */

    function beginTurn() {
      if (over || roundOver) return;
      pendingDrawnIndex = -1;
      var seat = seats[turn];

      if (seat.isAI) {
        viewSeatFallback();
        render();
        shell.say(shell.thinking(seat.name));
        shell.setActions(catchButtonIfAny());
        ticker.wait(700 + G.rand(420)).then(function () { if (!ticker.dead) aiTurn(); });
        return;
      }

      handoffTo(turn).then(function () {
        if (ticker.dead || roundOver) return;
        humanPrompt();
      });
    }

    /**
     * Pass-and-play: with more than one person sharing the device, hide the
     * hand behind a confirmation until the right player is looking.
     * Resolves once `seatIndex`'s hand is safe to show.
     */
    function handoffTo(seatIndex) {
      var seat = seats[seatIndex];
      if (seat.isAI) return Promise.resolve();

      // Own screen each: nothing to hand over, and the view never moves.
      if (networked) {
        viewSeat = netSeat;
        render();
        return Promise.resolve();
      }

      if (!multiHuman || lastHumanSeen === -1 || lastHumanSeen === seatIndex) {
        lastHumanSeen = seatIndex;
        viewSeat = seatIndex;
        render();
        return Promise.resolve();
      }

      viewSeat = -1;
      render();
      shell.say('Pass the device');
      shell.setActions();
      return G.modal({
        icon: '🙈',
        title: 'Pass to ' + seat.name,
        body: 'Hand the device over, then reveal your cards.',
        dismissable: false,
        actions: [{ label: "I'm " + seat.name, value: true, primary: true }]
      }).then(function () {
        if (ticker.dead) return;
        lastHumanSeen = seatIndex;
        viewSeat = seatIndex;
        render();
      });
    }

    function viewSeatFallback() {
      if (networked) { viewSeat = netSeat; return; }
      if (viewSeat === -1 && humanSeats.length) {
        viewSeat = lastHumanSeen !== -1 ? lastHumanSeen : seats.findIndex(function (s) { return !s.isAI; });
      }
    }

    function humanPrompt() {
      var hand = hands[turn];
      var playable = playableIndices(hand, topCard(), color, strictWild4);
      shell.say(playable.length
        ? '<b>' + G.escapeHtml(seats[turn].name) + '</b> - play a card'
        : '<b>' + G.escapeHtml(seats[turn].name) + '</b> - no match, draw a card');
      shell.setActions(catchButtonIfAny());
    }

    function humanPlay(index) {
      if (roundOver || seats[turn].isAI || viewSeat !== turn) return;
      var card = hands[turn][index];
      if (isWild(card)) {
        askColor(seats[turn].name).then(function (chosen) {
          if (ticker.dead) return;
          doPlay(turn, index, chosen);
        });
      } else {
        doPlay(turn, index, null);
      }
    }

    function humanDraw() {
      if (roundOver || seats[turn].isAI || pendingDrawnIndex !== -1) return;
      var got = drawFromDeck(1);
      if (!got.length) { G.toast('No cards left to draw'); return advance(); }
      hands[turn].push(got[0]);
      var idx = hands[turn].length - 1;

      if (matches(got[0], topCard(), color) &&
        !(got[0].kind === 'wild4' && strictWild4 && hands[turn].some(function (c, i) { return i !== idx && c.color === color; }))) {
        pendingDrawnIndex = idx;
        render();
        shell.say('You drew <b>' + G.escapeHtml(cardLabel(got[0])) + '</b> - play it?');
        shell.setActions(
          el('button.btn.btn-primary.btn-sm', {
            type: 'button', text: 'Play it',
            onclick: function () {
              pendingDrawnIndex = -1;
              var card = hands[turn][idx];
              if (isWild(card)) {
                askColor(seats[turn].name).then(function (chosen) {
                  if (!ticker.dead) doPlay(turn, idx, chosen);
                });
              } else { doPlay(turn, idx, null); }
            }
          }),
          el('button.btn.btn-sm', {
            type: 'button', text: 'Keep it',
            onclick: function () { pendingDrawnIndex = -1; render(); advance(); }
          })
        );
        return;
      }

      render();
      shell.say('You drew a card that does not match');
      ticker.wait(900).then(function () { if (!ticker.dead) advance(); });
    }

    function askColor(who) {
      var body = el('div.uno-picker');
      var close = null;
      COLORS.forEach(function (c) {
        body.appendChild(el('button.uno-swatch', {
          type: 'button',
          style: { background: HEX[c] },
          'aria-label': COLOR_NAME[c],
          onclick: function () { if (close) close(c); }
        }));
      });
      return G.modal({
        title: who + ', pick a colour',
        body: body,
        dismissable: false,
        relay: true,
        actions: [],
        onReady: function (fn) { close = fn; }
      }).then(function (chosen) { return chosen || G.pick(COLORS); });
    }

    /** Commit a card to the pile and work out what it does. */
    function doPlay(seatIndex, cardIndex, chosenColor) {
      var card = hands[seatIndex].splice(cardIndex, 1)[0];
      var previousColor = color;
      var heldMatching = hands[seatIndex].some(function (c) { return c.color === previousColor; });

      discard.push(card);
      color = isWild(card) ? chosenColor : card.color;
      unoFlag[seatIndex] = false;

      var seat = seats[seatIndex];
      var effect = null;

      if (card.kind === 'rev') {
        dir *= -1;
        if (seats.length === 2) effect = { skip: true };
        shell.say('<b>' + G.escapeHtml(seat.name) + '</b> reverses play');
      } else if (card.kind === 'skip') {
        effect = { skip: true };
      } else if (card.kind === 'draw2') {
        effect = { skip: true, draw: 2 };
      } else if (card.kind === 'wild4') {
        effect = {
          wild4: true,
          heldMatching: heldMatching,
          playedBy: seatIndex,
          previousColor: previousColor
        };
      }

      if (card.kind !== 'rev') {
        shell.say('<b>' + G.escapeHtml(seat.name) + '</b> plays ' + G.escapeHtml(cardLabel(card)) +
          (isWild(card) ? ' → ' + COLOR_NAME[color] : ''));
      }

      render();

      if (hands[seatIndex].length === 0) {
        return ticker.wait(500).then(function () { if (!ticker.dead) endRound(seatIndex); });
      }

      var chain = ticker.wait(480);
      if (hands[seatIndex].length === 1) {
        chain = chain.then(function () { return unoWindow(seatIndex); });
      }
      return chain.then(function () { if (!ticker.dead) advance(effect); });
    }

    /* ------------------------------------------------------------ UNO calls */

    function unoWindow(seatIndex) {
      var seat = seats[seatIndex];

      if (!seat.isAI) {
        return new Promise(function (resolve) {
          var settled = false;
          var btn = el('button.btn.uno-btn-uno', {
            type: 'button', text: 'UNO!',
            onclick: function () {
              if (settled) return;
              settled = true;
              unoFlag[seatIndex] = true;
              G.toast(seat.name + ' called UNO!');
              render();
              resolve();
            }
          });
          shell.setActions(btn);
          shell.say('One card left - call it!');
          ticker.wait(3200).then(function () {
            if (settled || ticker.dead) return;
            settled = true;
            hands[seatIndex] = hands[seatIndex].concat(drawFromDeck(2));
            G.toast('Caught without calling UNO - draw 2', 2400);
            render();
            resolve();
          });
        });
      }

      // The computer usually remembers, but not always.
      var forget = config.difficulty === 'hard' ? 0.08 : (config.difficulty === 'easy' ? 0.35 : 0.22);
      if (G.random() > forget) {
        unoFlag[seatIndex] = true;
        G.toast(seat.name + ': UNO!');
        render();
        return ticker.wait(500);
      }

      // Forgot - give a human the chance to catch them.
      if (!humanSeats.length) return ticker.wait(200);

      return new Promise(function (resolve) {
        var settled = false;
        var btn = el('button.btn.uno-btn-uno', {
          type: 'button', text: 'Catch ' + seat.name + '!',
          onclick: function () {
            if (settled) return;
            settled = true;
            hands[seatIndex] = hands[seatIndex].concat(drawFromDeck(2));
            G.toast(seat.name + ' forgot to call UNO - draw 2', 2400);
            render();
            resolve();
          }
        });
        shell.setActions(btn);
        shell.say('<b>' + G.escapeHtml(seat.name) + '</b> is down to one card...');
        ticker.wait(3000).then(function () {
          if (settled || ticker.dead) return;
          settled = true;
          unoFlag[seatIndex] = true;
          render();
          resolve();
        });
      });
    }

    /** A standing "catch" button while an AI sits on one uncalled card. */
    function catchButtonIfAny() {
      for (var i = 0; i < seats.length; i++) {
        if (seats[i].isAI && hands[i] && hands[i].length === 1 && !unoFlag[i] && humanSeats.length) {
          return makeCatchButton(i);
        }
      }
      return null;
    }

    function makeCatchButton(i) {
      return el('button.btn.btn-sm', {
        type: 'button', text: 'Catch ' + seats[i].name + '!',
        onclick: function () {
          if (hands[i].length !== 1 || unoFlag[i]) { G.toast('Too late'); return; }
          hands[i] = hands[i].concat(drawFromDeck(2));
          unoFlag[i] = true;
          G.toast(seats[i].name + ' forgot to call UNO - draw 2', 2400);
          render();
        }
      });
    }

    /* ------------------------------------------------------------- advance */

    function advance(effect) {
      if (ticker.dead || roundOver) return;
      effect = effect || {};

      if (effect.wild4) return resolveWild4(effect);

      var target = nextIndex(turn, 1);

      if (effect.draw) {
        hands[target] = hands[target].concat(drawFromDeck(effect.draw));
        unoFlag[target] = false;
        shell.say('<b>' + G.escapeHtml(seats[target].name) + '</b> picks up ' + effect.draw + ' and is skipped');
        render();
        turn = nextIndex(turn, 2);
        return ticker.wait(1000).then(function () { if (!ticker.dead) beginTurn(); });
      }

      turn = nextIndex(turn, effect.skip ? 2 : 1);
      if (effect.skip) {
        shell.say('<b>' + G.escapeHtml(seats[nextIndex(turn, -1)].name) + '</b> is skipped');
        return ticker.wait(800).then(function () { if (!ticker.dead) beginTurn(); });
      }
      return ticker.wait(160).then(function () { if (!ticker.dead) beginTurn(); });
    }

    /** Wild Draw Four: the next player may challenge before picking up. */
    function resolveWild4(effect) {
      var victim = nextIndex(turn, 1);
      var victimSeat = seats[victim];
      var playerSeat = seats[effect.playedBy];

      function settle(challenged) {
        var caughtBluffing = challenged && effect.heldMatching;

        if (!challenged) {
          hands[victim] = hands[victim].concat(drawFromDeck(4));
          unoFlag[victim] = false;
          shell.say('<b>' + G.escapeHtml(victimSeat.name) + '</b> picks up 4 and is skipped');
          turn = nextIndex(turn, 2);
        } else if (caughtBluffing) {
          hands[effect.playedBy] = hands[effect.playedBy].concat(drawFromDeck(4));
          unoFlag[effect.playedBy] = false;
          shell.say('Challenge upheld - <b>' + G.escapeHtml(playerSeat.name) + '</b> was bluffing and draws 4');
          turn = victim;                                   // victim plays normally
        } else {
          hands[victim] = hands[victim].concat(drawFromDeck(6));
          unoFlag[victim] = false;
          shell.say('Challenge failed - <b>' + G.escapeHtml(victimSeat.name) + '</b> draws 6 and is skipped');
          turn = nextIndex(turn, 2);
        }
        render();
        ticker.wait(1500).then(function () { if (!ticker.dead) beginTurn(); });
      }

      if (strictWild4) return settle(false);               // bluffing was disallowed

      if (victimSeat.isAI) {
        // Challenge more readily when the pickup really hurts.
        var base = config.difficulty === 'hard' ? 0.3 : 0.18;
        if (hands[victim].length <= 3) base += 0.2;
        var challenged = G.random() < base;
        shell.say(challenged
          ? '<b>' + G.escapeHtml(victimSeat.name) + '</b> challenges!'
          : '<b>' + G.escapeHtml(victimSeat.name) + '</b> accepts the Draw Four');
        return ticker.wait(900).then(function () { if (!ticker.dead) settle(challenged); });
      }

      // The victim decides, so make sure they are the one holding the device.
      handoffTo(victim).then(function () {
        if (ticker.dead) return;
        return G.modal({
          icon: '🃏',
          relay: true,
          title: playerSeat.name + ' played a Wild Draw Four',
          body: 'Challenge it? If they were still holding a ' + COLOR_NAME[effect.previousColor] +
            ' card they could have played, they draw 4 instead. Get it wrong and you draw 6.',
          dismissable: false,
          actions: [
            { label: 'Take the 4', value: false, ghost: true },
            { label: 'Challenge', value: true, primary: true }
          ]
        }).then(function (challenged) {
          if (ticker.dead) return;
          settle(!!challenged);
        });
      });
    }

    /* ------------------------------------------------------------------ AI */

    function aiTurn() {
      if (ticker.dead || roundOver) return;
      var hand = hands[turn];
      var options = playableIndices(hand, topCard(), color, strictWild4);
      var pressure = hands[nextIndex(turn, 1)].length;

      if (!options.length) {
        var got = drawFromDeck(1);
        if (!got.length) return advance();
        hand.push(got[0]);
        render();
        shell.say('<b>' + G.escapeHtml(seats[turn].name) + '</b> draws a card');

        return ticker.wait(800).then(function () {
          if (ticker.dead) return;
          var idx = hand.length - 1;
          var drawn = hand[idx];
          var canPlay = matches(drawn, topCard(), color) &&
            !(drawn.kind === 'wild4' && strictWild4 && hand.some(function (c, k) { return k !== idx && c.color === color; }));
          if (canPlay) return doPlay(turn, idx, isWild(drawn) ? bestColor(hand) : null);
          return advance();
        });
      }

      var choice = aiChoose(hand, options, topCard(), color, pressure, config.difficulty);
      var card = hand[choice];
      return doPlay(turn, choice, isWild(card) ? bestColor(hand.filter(function (_, k) { return k !== choice; })) : null);
    }

    /* --------------------------------------------------------- end of round */

    function endRound(winnerIndex) {
      roundOver = true;
      var seat = seats[winnerIndex];
      var gained = 0;
      hands.forEach(function (hand, i) {
        if (i === winnerIndex) return;
        hand.forEach(function (c) { gained += cardPoints(c); });
      });
      scores[winnerIndex] += gained;
      render();

      var reachedTarget = toFiveHundred && scores[winnerIndex] >= 500;
      var finished = !toFiveHundred || reachedTarget;

      if (finished) {
        over = true;
        config.finish(!seat.isAI);
      }

      shell.setActions();
      shell.say('🎉 <b>' + G.escapeHtml(seat.name) + '</b> goes out' +
        (toFiveHundred ? ' and scores ' + gained : ''));

      ticker.wait(900).then(function () {
        if (ticker.dead) return;
        if (!finished) {
          var board = seats.map(function (s, i) {
            return '<div>' + G.escapeHtml(s.name) + ' — <b>' + scores[i] + '</b></div>';
          }).join('');
          return G.modal({
            icon: '🃏',
            relay: true,
            title: seat.name + ' wins the round',
            bodyHtml: '+' + gained + ' points<div style="margin-top:10px">' + board + '</div>',
            dismissable: false,
            actions: [
              { label: 'Menu', value: 'menu', ghost: true },
              { label: 'Next round', value: 'next', primary: true }
            ]
          }).then(function (choice) {
            if (ticker.dead) return;
            if (choice === 'next') { lastHumanSeen = -1; newRound(); }
            else config.exit();
          });
        }

        return G.modal({
          icon: !seat.isAI ? '🏆' : '🤖',
          title: seat.name + ' wins!',
          body: toFiveHundred
            ? 'Final score ' + scores[winnerIndex] + ' points.'
            : 'Last card played - hand empty.',
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

    function onResize() { if (!roundOver || !over) renderHand(); }
    window.addEventListener('resize', onResize);

    shell.setActions();
    newRound();

    return {
      destroy: function () {
        ticker.kill();
        window.removeEventListener('resize', onResize);
        shell.stage.classList.remove('full');
      }
    };
  }

  /* -------------------------------------------------------------- register */

  G.Games.register({
    id: 'uno',
    name: 'Uno',
    tagline: 'Match, skip, and shout it',
    accent: '#e5484d',
    icon: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none">' +
      '<rect x="3" y="5" width="11" height="15" rx="2.2" transform="rotate(-11 3 5)" fill="#2f7df6"/>' +
      '<rect x="8.5" y="4" width="11" height="15" rx="2.2" fill="#f0483c" stroke="#fff" stroke-width="1.1"/>' +
      '<ellipse cx="14" cy="11.5" rx="3.6" ry="5" fill="#fff" transform="rotate(-26 14 11.5)"/>' +
      '<text x="14" y="14.4" font-size="7" font-weight="900" text-anchor="middle" fill="#f0483c">4</text></svg>',
    minPlayers: 2,
    maxPlayers: 4,
    // Not yet networked: snapshots would have to be filtered per seat so a
    // device only ever receives its own hand. See README.
    networked: false,
    defaultPlayers: 3,
    difficulty: true,
    seatColors: ['#e5484d', '#2f7df6', '#22b36b', '#f5c518'],
    aiNames: ['Ava', 'Blaze', 'Cody', 'Dot'],
    options: [
      { key: 'toFiveHundred', label: 'Play to 500 points', hint: 'Score the cards left in other hands each round', default: false },
      { key: 'strictWild4', label: 'No bluffing on Wild Draw Four', hint: 'Blocks the card unless you truly have no match - turns off challenges', default: false }
    ],
    rules:
      '<h4>Goal</h4><ul><li>Be the first to <b>play every card</b> in your hand.</li></ul>' +
      '<h4>Play</h4><ul>' +
      '<li>Play a card that matches the pile by <b>colour</b>, <b>number</b>, or <b>symbol</b>.</li>' +
      '<li>No match? Take one from the deck. If it can be played, you may play it straight away.</li></ul>' +
      '<h4>Action cards</h4><ul>' +
      '<li><b>Skip ⊘</b> - the next player misses a turn.</li>' +
      '<li><b>Reverse ⇄</b> - play changes direction. With two players it acts as a skip.</li>' +
      '<li><b>Draw Two +2</b> - next player picks up two and is skipped.</li>' +
      '<li><b>Wild</b> - play any time and name the new colour.</li>' +
      '<li><b>Wild Draw Four +4</b> - name a colour, next player picks up four and is skipped.</li></ul>' +
      '<h4>Challenging a Draw Four</h4><ul>' +
      '<li>Officially you may only play it with <b>no card of the current colour</b> - but you are allowed to bluff.</li>' +
      '<li>The player hit by it may <b>challenge</b>. If the bluff is exposed, the bluffer draws 4 instead.</li>' +
      '<li>A wrong challenge costs the challenger <b>6 cards</b>.</li></ul>' +
      '<h4>Calling UNO</h4><ul>' +
      '<li>Down to one card, hit <b>UNO!</b> within a few seconds or pick up two.</li>' +
      '<li>Computers forget sometimes - catch them and they draw two.</li></ul>',
    start: start
  });
})();
