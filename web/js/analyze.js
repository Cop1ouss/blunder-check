// Analyze tab: a free analysis board (Stockfish lines, your own games as an
// opening explorer, play on from any position), endgame drills against
// Stockfish, and a board-vision trainer.
(() => {
'use strict';
const { $, esc, cName, uciMove, engine } = BC;
const DRAW = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
// Positions checked with Stockfish 16 at depth 26-30: wins are winning, holds are draws.
const DRILLS = [
  { id: 'kq', title: 'Queen checkmate', fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1', goal: 'mate', tip: 'Box the king in with your queen a knight\'s move away, bring your king up, then mate. Watch out for stalemate.' },
  { id: 'kr', title: 'Rook checkmate', fen: '8/8/8/4k3/8/8/8/R3K3 w - - 0 1', goal: 'mate', tip: 'Cut the king off with your rook, walk your king up to face theirs, then check on the edge.' },
  { id: 'kp', title: 'Promote the pawn', fen: '4k3/8/4K3/8/4P3/8/8/8 w - - 0 1', goal: 'queen', tip: 'Your king is in front of the pawn: keep it there and take the opposition when you need to.' },
  { id: 'kpd', title: 'Stop the pawn (draw)', fen: '8/8/4k3/8/8/4K3/4P3/8 b - - 0 1', goal: 'draw', tip: 'Stay in front of the pawn and take the opposition. Never step aside.' },
  { id: 'lucena', title: 'Lucena: build a bridge', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', goal: 'queen', tip: 'Check the king away, put your rook on the 4th rank, then walk your king out and block checks with the rook.' },
  { id: 'philidor', title: 'Philidor: hold the draw', fen: '4k3/8/r7/3KP3/8/8/8/1R6 b - - 0 1', goal: 'draw', tip: 'Keep your rook on the 6th rank until the pawn moves forward, then check from behind.' },
];
const view = new BC.BoardView(document.querySelector('#view-analyze .boardbox'), onTap);
const A = { mode: 'board', start: BC.START, moves: [], at: 0, flipped: false, sel: {}, engineOn: BC.local.get('bc.anEngine', true), lines: null, depth: 0, sfPlays: null, drill: null, msg: '', vision: null, token: 0 };

const chAt = (n = A.at) => { const c = new Chess(A.start); for (const m of A.moves.slice(0, n)) c.move(m); return c; };
const fmtEval = l => (l.mate != null ? (l.mate > 0 ? '#' : '#-') + Math.abs(l.mate) : (l.cp > 0 ? '+' : '') + (l.cp / 100).toFixed(1));
function pvSan(fen, pv) {
  const c = new Chess(fen), out = [];
  for (const u of pv.split(' ').slice(0, 6)) { const m = uciMove(c, u); if (!m) break; out.push(m.san); }
  return out.join(' ');
}

// ---------- your games as an opening explorer ----------
let tree = null, treeOf = '';
function explorer(fen) {
  const d = BC.cc && BC.cc.store ? BC.cc.store() : { games: [] };
  if (treeOf !== d.user + d.games.length) {
    tree = {}; treeOf = d.user + d.games.length;
    for (const g of d.games) {
      const side = g.me === 'w' ? g.white : g.black;
      const r = side.res === 'win' ? 'w' : DRAW.has(side.res) ? 'd' : 'l';
      const c = new Chess();
      if (!c.load_pgn(g.pgn, { sloppy: true })) continue;
      const r2 = new Chess();
      for (const m of c.history().slice(0, 30)) {
        const k = BC.posKey(r2.fen());
        const node = tree[k] || (tree[k] = {});
        const s = node[m] || (node[m] = { w: 0, d: 0, l: 0 });
        s[r]++;
        r2.move(m);
      }
    }
  }
  const node = tree[BC.posKey(fen)];
  return node ? Object.entries(node).map(([san, s]) => ({ san, ...s, n: s.w + s.d + s.l })).sort((a, b) => b.n - a.n) : [];
}

// ---------- rendering ----------
function render() {
  if (A.mode === 'vision') return renderVision();
  const ch = chAt(), fen = ch.fen(), last = A.at ? chAt().history({ verbose: true }).pop() : null;
  const marks = last ? [{ sq: last.from, color: 'var(--accent)', pct: 30 }, { sq: last.to, color: 'var(--accent)', pct: 45 }] : [];
  const arrows = A.engineOn && A.lines && A.lines[0] && !A.drill ? [{ uci: A.lines[0].uci, color: 'var(--c-best)' }] : [];
  view.render({ fen, flipped: A.flipped, marks, arrows, selected: A.sel.selected, targets: A.sel.targets, interactive: !ch.game_over() && ch.turn() !== A.sfPlays });
  $('aCaption').textContent = A.drill ? `Drill: ${A.drill.title}` : `Analysis board · ${cName(ch.turn())} to move`;
  return A.drill ? renderDrill(ch) : renderBoard(ch);
}
function moveList() {
  const c = new Chess(A.start), first = c.turn() === 'b' ? 1 : 0, num = +A.start.split(' ')[5] || 1;
  return A.moves.map((m, i) => {
    const j = i + first;
    return `${j % 2 === 0 ? `${num + j / 2}. ` : i === 0 ? `${num}… ` : ''}<button class="linkbtn mv${i + 1 === A.at ? ' cur' : ''}" data-act="go" data-n="${i + 1}">${esc(m)}</button>`;
  }).join(' ');
}
function navButtons() {
  return `<div class="acts nav">
    <button class="btn ghost" data-act="go" data-n="0" aria-label="Start">|◀</button>
    <button class="btn ghost" data-act="go" data-n="${Math.max(0, A.at - 1)}" aria-label="Back">◀</button>
    <button class="btn ghost" data-act="go" data-n="${Math.min(A.moves.length, A.at + 1)}" aria-label="Forward">▶</button>
    <button class="btn ghost" data-act="go" data-n="${A.moves.length}" aria-label="End">▶|</button>
    <button class="btn ghost" data-act="flip">Flip board</button></div>`;
}
function status(ch) {
  if (ch.in_checkmate()) return `Checkmate. ${cName(ch.turn() === 'w' ? 'b' : 'w')} wins.`;
  if (ch.in_stalemate()) return 'Stalemate: a draw.';
  if (ch.insufficient_material()) return 'Draw: not enough material.';
  if (ch.in_threefold_repetition()) return 'Draw by repetition.';
  return '';
}
function renderBoard(ch) {
  const fen = ch.fen(), st = status(ch), ex = explorer(fen);
  const eng = !A.engineOn ? '<p class="body muted">Engine is off.</p>'
    : st ? '' : !A.lines ? '<p class="body muted">Stockfish is thinking…</p>'
    : `<ol class="lines anlines">${A.lines.map(l => `<li><b class="evalv">${fmtEval(l)}</b> ${esc(pvSan(fen, l.pv))}</li>`).join('')}</ol><p class="opening">Depth ${A.depth}</p>`;
  const exHtml = ex.length ? `<table class="extab"><thead><tr><th scope="col">Move</th><th scope="col">Games</th><th scope="col">You won</th><th scope="col">Drew</th><th scope="col">Lost</th></tr></thead><tbody>
      ${ex.slice(0, 8).map(e => `<tr><td><button class="linkbtn" data-act="san" data-san="${esc(e.san)}">${esc(e.san)}</button></td><td>${e.n}</td><td>${Math.round(100 * e.w / e.n)}%</td><td>${Math.round(100 * e.d / e.n)}%</td><td>${Math.round(100 * e.l / e.n)}%</td></tr>`).join('')}</tbody></table>`
    : '<p class="body muted">None of your loaded chess.com games reached this position (first 15 moves).</p>';
  $('aPanel').innerHTML = `<h2>Analysis board</h2>
    ${st ? `<p class="body"><b>${esc(st)}</b></p>` : ''}
    ${A.msg ? `<p class="body">${esc(A.msg)}</p>` : ''}
    <div class="persp">Stockfish <span class="seg" role="group" aria-label="Engine">
      <button data-act="engine" aria-pressed="${A.engineOn}">${A.engineOn ? 'On' : 'Off'}</button></span>
      &nbsp;plays <span class="seg" role="group" aria-label="Stockfish plays">
      ${[[null, 'Nobody'], ['w', 'White'], ['b', 'Black']].map(([v, t]) => `<button data-act="sf" data-v="${v || ''}" aria-pressed="${A.sfPlays === v}">${t}</button>`).join('')}</span></div>
    ${eng}
    ${navButtons()}
    ${A.moves.length ? `<p class="line">${moveList()}</p>` : '<p class="body">Tap a piece, then a square, to make moves for both sides.</p>'}
    <h3>Your games from here</h3>${exHtml}
    <details class="tableview"><summary>Load a position or game</summary>
      <form id="anLoad"><label for="anText">FEN or PGN<textarea id="anText" rows="3" autocomplete="off" spellcheck="false"></textarea></label>
      <div class="acts"><button class="btn">Load</button><button class="btn ghost" type="button" data-act="reset">Starting position</button></div></form></details>
    <div class="acts"><button class="btn ghost" data-act="drills">Endgame drills</button><button class="btn ghost" data-act="vision">Vision trainer</button></div>`;
  bind();
  $('anLoad').addEventListener('submit', e => { e.preventDefault(); load($('anText').value.trim()); });
}
function renderDrill(ch) {
  const D = A.drill, st = status(ch), done = BC.local.get('bc.drills', {});
  let res = '';
  if (st || A.queened) {
    const won = D.goal === 'mate' ? ch.in_checkmate() && ch.turn() !== D.side : D.goal === 'queen' ? A.queened === D.side : !A.queened && (!ch.in_checkmate() || ch.turn() !== D.side);
    res = `<p class="body ${won ? 'fb-ok' : 'fb-no'}"><b>${won ? 'Drill passed!' : 'Not this time.'}</b> ${esc(A.queened ? (A.queened === D.side ? 'You made a new queen.' : 'Stockfish made a new queen.') : st)}</p>`;
    if (won && !done[D.id]) { done[D.id] = Date.now(); BC.local.set('bc.drills', done); BC.emit('progress'); }
  } else if (D.goal === 'draw' && A.moves.length >= 50) {
    res = '<p class="body fb-ok"><b>Drill passed!</b> You held for 25 moves.</p>';
    if (!done[D.id]) { done[D.id] = Date.now(); BC.local.set('bc.drills', done); BC.emit('progress'); }
  }
  const goal = { mate: 'Checkmate Stockfish.', queen: 'Promote your pawn to a queen.', draw: 'Hold the draw for 25 moves.' }[D.goal];
  $('aPanel').innerHTML = `<h2>${esc(D.title)}</h2>
    <p class="body"><b>You play ${cName(D.side)}.</b> ${goal} Stockfish defends at full strength.</p>
    <p class="body focustip">${esc(D.tip)}</p>
    ${res || (ch.turn() === A.sfPlays ? '<p class="body muted">Stockfish is thinking…</p>' : '<p class="body"><b>Your move.</b></p>')}
    ${A.moves.length ? `<p class="line">${moveList()}</p>` : ''}
    <div class="acts"><button class="btn" data-act="drill" data-id="${D.id}">Restart</button>
      ${A.moves.length >= 2 && !res ? '<button class="btn ghost" data-act="takeback">Take back</button>' : ''}
      <button class="btn ghost" data-act="drills">All drills</button><button class="btn ghost" data-act="reset">Analysis board</button></div>`;
  bind();
}
function renderDrills() {
  const done = BC.local.get('bc.drills', {});
  A.mode = 'drills';
  view.render({ fen: DRILLS[0].fen });
  $('aCaption').textContent = 'Endgame drills';
  $('aPanel').innerHTML = `<h2>Endgame drills</h2>
    <p class="body">Play out the endgames every player must know, against Stockfish at full strength. Pass each one, then do it again next week.</p>
    <ul class="lines">${DRILLS.map(d => `<li><button data-act="drill" data-id="${d.id}"><span>${esc(d.title)}<span class="sub">You play ${cName(d.fen.split(' ')[1])}</span></span>${done[d.id] ? '<span class="chip ok">Passed</span>' : '<span class="chip new">New</span>'}</button></li>`).join('')}</ul>
    <div class="acts"><button class="btn ghost" data-act="reset">Analysis board</button></div>`;
  bind();
}

// ---------- vision trainer: name a square, tap it ----------
const SQS = [...'abcdefgh'].flatMap(f => [1, 2, 3, 4, 5, 6, 7, 8].map(r => f + r));
function renderVision() {
  const V = A.vision, best = BC.local.get('bc.vision', { w: 0, b: 0 });
  const left = V.end ? Math.max(0, Math.ceil((V.end - Date.now()) / 1000)) : 30;
  view.render({ fen: '8/8/8/8/8/8/8/8 w - - 0 1', flipped: V.side === 'b', marks: V.flash ? [{ sq: V.flash.sq, color: V.flash.ok ? 'var(--c-best)' : 'var(--c-blunder)', pct: 60 }] : [], interactive: !!V.end && left > 0 });
  $('aCaption').textContent = `Vision trainer · ${cName(V.side)}'s side`;
  $('aPanel').innerHTML = `<h2>Vision trainer</h2>
    <p class="body">Tap the square named below, as many as you can in 30 seconds. Knowing squares instantly makes reading and calculating moves much easier.</p>
    ${V.end ? `<p class="visq" aria-live="assertive">${left > 0 ? esc(V.target) : 'Time!'}</p>
      <p class="body"><b>${V.score}</b> right · ${V.miss} wrong · ${left}s left</p>` : ''}
    ${V.end && left === 0 ? `<p class="body fb-ok">Score ${V.score}. Your best as ${cName(V.side)}: ${best[V.side]}.</p>` : ''}
    <div class="persp">Board from <span class="seg" role="group" aria-label="Side">
      ${[['w', 'White'], ['b', 'Black']].map(([v, t]) => `<button data-act="vside" data-v="${v}" aria-pressed="${V.side === v}">${t}</button>`).join('')}</span></div>
    <div class="acts"><button class="btn" data-act="vstart">${V.end ? 'Start again' : 'Start'}</button><button class="btn ghost" data-act="reset">Analysis board</button></div>
    <p class="opening">Best: ${best.w} as White, ${best.b} as Black.</p>`;
  bind();
}
function visionTap(sq) {
  const V = A.vision;
  if (!V.end || Date.now() > V.end) return;
  const ok = sq === V.target;
  if (ok) V.score++; else V.miss++;
  V.flash = { sq: ok ? sq : V.target, ok };
  V.target = SQS[Math.floor(Math.random() * 64)];
  renderVision();
}
function visionTick() {
  const V = A.vision;
  if (A.mode !== 'vision' || !V.end) return;
  if (Date.now() >= V.end) {
    const best = BC.local.get('bc.vision', { w: 0, b: 0 });
    if (V.score > best[V.side]) { best[V.side] = V.score; BC.local.set('bc.vision', best); }
    BC.activity && BC.activity.bump && BC.activity.bump('vision');
    return renderVision();
  }
  renderVision(); setTimeout(visionTick, 1000);
}

// ---------- moves, engine ----------
function onTap(nm) {
  if (A.mode === 'vision') return visionTap(nm);
  const ch = chAt();
  if (ch.game_over() || ch.turn() === A.sfPlays) return;
  const m = BC.tapMove(A.sel, ch.fen(), nm);
  if (!m) return render();
  play(m.san, m);
}
function play(san, m) {
  A.moves = A.moves.slice(0, A.at); A.moves.push(san); A.at++; A.msg = '';
  if (A.drill && m && m.promotion) A.queened = m.color;  // either side promoting ends a drill
  update();
}
function update() {
  A.lines = null; A.depth = 0;
  const token = ++A.token, ch = chAt();
  render();
  if (ch.game_over() || A.queened) return;
  if (A.sfPlays === ch.turn() && A.at === A.moves.length) return sfMove(token);
  if (A.engineOn && !A.drill) think(token, ch.fen());
}
async function think(token, fen) {
  try {
    await engine.start();
    for (const depth of [10, 16]) {
      const lines = await engine.analyse(fen, { depth, movetime: depth > 10 ? 3000 : 600, multipv: 3 });
      if (token !== A.token) return;
      A.lines = lines; A.depth = depth; render();
    }
  } catch (e) { if (token === A.token) { A.msg = 'Stockfish could not start in this browser.'; A.engineOn = false; render(); } }
}
async function sfMove(token) {
  try {
    await engine.start();
    const lines = await engine.analyse(chAt().fen(), { depth: 16, movetime: 1200, multipv: 1 });
    if (token !== A.token || !lines[0]) return;
    const ch = chAt(), m = uciMove(ch, lines[0].uci);
    if (m) play(m.san, m);
  } catch (e) { A.msg = 'Stockfish could not start in this browser.'; render(); }
}
function load(text) {
  if (!text) return;
  const c = new Chess();
  if (c.validate_fen(text).valid) { open(text); return; }
  if (c.load_pgn(text, { sloppy: true })) {
    const h = c.header(), start = h.SetUp === '1' && h.FEN ? h.FEN : BC.START;
    open(start, { moves: c.history() });
    return;
  }
  A.msg = 'That is not a FEN or PGN this board can read.'; render();
}
// Open a position (and optional moves) on the analysis board; used by the Review tab too.
function open(fen, { moves = [], flipped = fen.split(' ')[1] === 'b' } = {}) {
  Object.assign(A, { mode: 'board', start: fen, moves, at: moves.length, flipped, sel: {}, drill: null, sfPlays: null, queened: false, msg: '' });
  if (location.hash !== '#analyze') location.hash = '#analyze';
  update();
}
BC.analyze = { open };

const ACT = {
  go: d => { A.at = +d.n; A.sel = {}; update(); },
  flip: () => { A.flipped = !A.flipped; render(); },
  engine: () => { A.engineOn = !A.engineOn; BC.local.set('bc.anEngine', A.engineOn); update(); },
  sf: d => { A.sfPlays = d.v || null; update(); },
  san: d => { const m = chAt().move(d.san); if (m) play(m.san); },
  takeback: () => { A.at = Math.max(0, A.at - 2); A.moves = A.moves.slice(0, A.at); A.queened = false; update(); },
  reset: () => { A.mode = 'board'; open(BC.START, { flipped: false }); },
  drills: () => { A.token++; renderDrills(); },
  drill: d => {
    const D = DRILLS.find(x => x.id === d.id), side = D.fen.split(' ')[1];
    Object.assign(A, { mode: 'board', drill: { ...D, side }, start: D.fen, moves: [], at: 0, flipped: side === 'b', sel: {}, sfPlays: side === 'w' ? 'b' : 'w', queened: false, msg: '' });
    update();
  },
  vision: () => { A.token++; A.mode = 'vision'; A.vision = { side: (A.vision && A.vision.side) || 'w', end: 0, score: 0, miss: 0 }; renderVision(); },
  vside: d => { A.vision = { side: d.v, end: 0, score: 0, miss: 0 }; renderVision(); },
  vstart: () => { Object.assign(A.vision, { end: Date.now() + 30000, score: 0, miss: 0, flash: null, target: SQS[Math.floor(Math.random() * 64)] }); visionTick(); },
};
function bind() { $('aPanel').querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => ACT[b.dataset.act](b.dataset))); }

let started = false;
BC.on('view', v => { if (v === 'analyze' && !started) { started = true; if (A.mode === 'board' && !A.moves.length) update(); } });
if (BC.currentView() === 'analyze') { started = true; update(); }
})();
