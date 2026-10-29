// Legends tab: play bots styled after famous players (their real openings,
// their tendencies, a strength you choose) and Guess the Move through the
// most famous games in chess history.
(() => {
'use strict';
const { $, esc, VAL, cName, uciMove, moveUci, engine, sync } = BC;
const LG = window.BC_LEGENDS;
const D = window.BC_DATA;
const byId = Object.fromEntries(LG.legends.map(l => [l.id, l]));
// Strength levels are rough estimates, tuned by how often the bot strays from the engine's choice.
const LEVELS = [
  { id: 'l1', label: 'Beginner (around 400)', depth: 5, multipv: 8, temp: 110, blunder: 0.10 },
  { id: 'l2', label: 'Casual (around 800)', depth: 7, multipv: 6, temp: 60, blunder: 0.04 },
  { id: 'l3', label: 'Club (around 1200)', depth: 9, multipv: 5, temp: 30, blunder: 0.01 },
  { id: 'l4', label: 'Strong (around 1800)', depth: 12, multipv: 4, temp: 10, blunder: 0 },
  { id: 'l5', label: 'Full strength', depth: 18, multipv: 3, temp: 0, blunder: 0 },
];
const bind = (el, acts) => el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => acts[b.dataset.act](b.dataset)));
const initials = n => { const w = n.split(/\s+/); return (w[0][0] + w[w.length - 1][0]).toUpperCase(); };
const openingName = fen => D.openings.names[BC.posKey(fen)] || null;
const view = new BC.BoardView(document.querySelector('#view-legends .boardbox'), onTap);
const S = { mode: 'home', legend: null, level: BC.local.get('bc.botLevel', 'l1'), color: 'w', play: null, guess: null, sel: {} };
const rec = () => sync.progress.legends || (sync.progress.legends = { results: {}, guess: {} });

// ---------- rendering ----------
function render() {
  $('view-legends').classList.toggle('noboard', S.mode !== 'play' && S.mode !== 'guess');
  if (S.mode === 'play') return renderPlay();
  if (S.mode === 'guess') return renderGuess();
  view.render({ fen: BC.START });
  $('gCaption').textContent = S.mode === 'setup' ? `Play ${S.legend.name} (bot)` : 'Pick a legend';
  if (S.mode === 'setup') return renderSetup();
  if (S.mode === 'games') return renderGames();
  renderHome();
}
function card(l, full) {
  const games = LG.games.filter(g => g.legend === l.id);
  const courses = LG.courses.filter(c => (c.legends || []).includes(l.id));
  const r = rec().results[l.id];
  return `<article class="course legend">
    <div class="chead"><span class="mono" aria-hidden="true">${esc(initials(l.name))}</span><div class="lname"><h3>${esc(l.name)}</h3><p class="opening">${esc(l.tag)} · ${esc(l.years)} · ${esc(l.from)}</p></div></div>
    <p class="blurb">${esc(l.style)}</p>
    ${r ? `<p class="opening">Your score against the bot: ${r.w} won, ${r.d} drawn, ${r.l} lost</p>` : ''}
    ${full ? '' : `<div class="acts"><button class="btn" data-act="setup" data-id="${l.id}">Play the bot</button>
      ${games.length ? `<button class="btn ghost" data-act="games" data-id="${l.id}">Guess the move (${games.length})</button>` : ''}
      ${courses.map(c => `<a class="btn ghost" href="#openings" data-act="course" data-c="${c.id}">Learn: ${esc(c.title)}</a>`).join('')}</div>`}
  </article>`;
}
function renderHome() {
  $('gPanel').innerHTML = `<h2>Legends</h2>
    <p class="body">Play bots styled after famous players: they open with the openings those players really used and lean toward their style. Choose a strength you can beat. Or step through their most famous games and guess each move.</p>
    <p class="body muted">The bots imitate openings and tendencies. They are not the players themselves.</p>
    <div class="courses">${LG.legends.map(l => card(l)).join('')}</div>`;
  bind($('gPanel'), ACT);
}
function renderSetup() {
  const l = S.legend;
  $('gPanel').innerHTML = `<h2>Play a legend bot</h2>${card(l, true)}
    <div class="setup">
      <label for="botLevel">Strength<select id="botLevel">${LEVELS.map(v => `<option value="${v.id}"${v.id === S.level ? ' selected' : ''}>${v.label}</option>`).join('')}</select></label>
      <div class="persp">You play <span class="seg" role="group" aria-label="Your color">
        ${[['w', 'White'], ['r', 'Random'], ['b', 'Black']].map(([v, t]) => `<button data-act="color" data-v="${v}" aria-pressed="${S.color === v}">${t}</button>`).join('')}</span></div>
    </div>
    <p class="opening">Strength levels are rough. Start with Beginner and move up when you win.</p>
    <div class="acts"><button class="btn" data-act="start">Start game</button><button class="btn ghost" data-act="home">All legends</button></div>`;
  bind($('gPanel'), ACT);
  $('botLevel').addEventListener('change', e => { S.level = e.target.value; BC.local.set('bc.botLevel', S.level); });
}
function renderGames() {
  const list = LG.games.filter(g => !S.legend || g.legend === S.legend.id);
  $('gPanel').innerHTML = `<h2>Guess the move</h2>
    <p class="body">Replay a famous game from the winner's side. At each of their moves, guess what they played: 10 points for the master's move, 5 for another move Stockfish rates as just as good.</p>
    <ul class="lines">${list.map(g => {
      const best = rec().guess[g.id];
      return `<li><button data-act="guess" data-id="${g.id}"><span>${esc(g.title)}<span class="sub">${esc(g.white)} vs ${esc(g.black)}, ${esc(g.event)} ${g.year}</span></span>${best != null ? `<span class="chip ok">Best ${best}%</span>` : '<span class="chip new">New</span>'}</button></li>`;
    }).join('')}</ul>
    <div class="acts">${S.legend ? '<button class="btn ghost" data-act="allGames">All famous games</button>' : ''}<button class="btn ghost" data-act="home">All legends</button></div>`;
  bind($('gPanel'), ACT);
}

// ---------- playing a bot ----------
function startGame() {
  const level = LEVELS.find(v => v.id === S.level) || LEVELS[0];
  const me = S.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : S.color;
  S.play = { ch: new Chess(), me, level, legend: S.legend, status: 'play', msg: '', thinking: false, lastBot: null, recorded: false };
  S.mode = 'play'; S.sel = {};
  render();
  document.querySelector('#view-legends .boardcol').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (me === 'b') botMove();
}
function renderPlay() {
  const P = S.play, ch = P.ch, hist = ch.history({ verbose: true });
  const last = hist[hist.length - 1];
  const marks = last ? [{ sq: last.from, color: 'var(--accent)', pct: 30 }, { sq: last.to, color: 'var(--accent)', pct: 45 }] : [];
  if (ch.in_check()) { const k = findKing(ch, ch.turn()); if (k) marks.push({ sq: k, color: 'var(--c-blunder)', pct: 55 }); }
  const myTurn = P.status === 'play' && ch.turn() === P.me && !P.thinking;
  view.render({ fen: ch.fen(), flipped: P.me === 'b', marks, selected: S.sel.selected, targets: S.sel.targets, interactive: myTurn });
  $('gCaption').textContent = `You (${cName(P.me)}) vs ${P.legend.name} bot · ${P.level.label}`;
  const opening = (() => { let n = null; const c = new Chess(); for (const m of hist.slice(0, 30)) { c.move(m.san); const o = openingName(c.fen()); if (o) n = o; } return n; })();
  let status;
  if (P.status !== 'play') status = `<p class="body ${P.status === 'won' ? 'fb-ok' : P.status === 'lost' ? 'fb-no' : ''}"><b>${esc(P.msg)}</b></p>`;
  else if (P.thinking) status = `<p class="body muted">${esc(P.legend.name)} bot is thinking…</p>`;
  else status = `<p class="body"><b>Your move.</b>${ch.in_check() ? ' You are in check.' : ''}</p>`;
  const botNote = P.lastBot ? `<div class="note"><span class="who">${esc(P.legend.name)} bot · ${esc(P.lastBot.san)}</span>${P.lastBot.book ? `<p>From ${esc(P.legend.name)}'s real repertoire.</p>` : P.lastBot.why ? `<p>${esc(P.lastBot.why)}</p>` : ''}</div>` : '';
  let moves = '';
  hist.forEach((m, i) => { moves += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + esc(m.san) + ' '; });
  $('gPanel').innerHTML = `<h2>${esc(P.legend.name)} bot · ${esc(P.level.label)}</h2>
    ${status}${botNote}
    ${opening ? `<p class="opening">Opening: ${esc(opening)}</p>` : ''}
    ${moves ? `<p class="line">${moves.trim()}</p>` : ''}
    <div class="acts">
      ${P.status === 'play' ? `${hist.length >= 2 && !P.thinking ? '<button class="btn ghost" data-act="takeback">Take back</button>' : ''}<button class="btn ghost" data-act="resign">Resign</button>`
        : `<button class="btn" data-act="reviewGame">Review this game</button><button class="btn ghost" data-act="rematch">Play again</button>`}
      <button class="btn ghost" data-act="home">All legends</button>
    </div>`;
  bind($('gPanel'), ACT);
}
function findKing(ch, color) { for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) { const p = ch.get(f + r); if (p && p.type === 'k' && p.color === color) return f + r; } return null; }
function onTap(nm) {
  if (S.mode === 'guess') return tapGuess(nm);
  if (S.mode !== 'play') return;
  const P = S.play;
  if (P.status !== 'play' || P.thinking || P.ch.turn() !== P.me) return;
  const m = BC.tapMove(S.sel, P.ch.fen(), nm);
  if (!m) return renderPlay();
  P.ch.move({ from: m.from, to: m.to, promotion: 'q' });
  if (checkEnd()) return renderPlay();
  botMove();
}
function checkEnd() {
  const P = S.play, ch = P.ch;
  let result = null;
  if (ch.in_checkmate()) { result = ch.turn() === P.me ? 'lost' : 'won'; P.msg = result === 'won' ? 'Checkmate. You win!' : `Checkmate. The ${P.legend.name} bot wins.`; }
  else if (ch.in_stalemate()) { result = 'draw'; P.msg = 'Stalemate: a draw.'; }
  else if (ch.insufficient_material()) { result = 'draw'; P.msg = 'Draw: not enough material to checkmate.'; }
  else if (ch.in_threefold_repetition()) { result = 'draw'; P.msg = 'Draw by repetition.'; }
  else if (ch.in_draw()) { result = 'draw'; P.msg = 'Draw (50-move rule).'; }
  if (!result) return false;
  finish(result);
  return true;
}
function finish(result) {
  const P = S.play;
  P.status = result;
  if (P.recorded) return;
  P.recorded = true;
  const r = rec().results[P.legend.id] || { w: 0, d: 0, l: 0 };
  rec().results[P.legend.id] = { ...r, [result === 'won' ? 'w' : result === 'lost' ? 'l' : 'd']: r[result === 'won' ? 'w' : result === 'lost' ? 'l' : 'd'] + 1 };
  sync.saveProgress();
}
async function botMove() {
  const P = S.play, ch = P.ch;
  P.thinking = true; renderPlay();
  const started = Date.now();
  let pick = null;
  try { pick = await chooseMove(P); } catch (e) { P.thinking = false; P.status = 'draw'; P.msg = 'Stockfish could not start in this browser, so the bot cannot play.'; return renderPlay(); }
  if (S.play !== P) return;
  const wait = Math.max(0, 450 - (Date.now() - started));
  setTimeout(() => {
    if (S.play !== P) return;
    const m = uciMove(ch, pick.uci);
    P.lastBot = { san: m.san, book: pick.book, why: pick.why };
    P.thinking = false;
    checkEnd();
    renderPlay();
  }, wait);
}
async function chooseMove(P) {
  const ch = P.ch, fen = ch.fen(), side = ch.turn();
  const played = ch.history({ verbose: true }).map(BC.moveUci);
  // 1. The legend's own openings, while the game follows one of them.
  const book = (side === 'w' ? P.legend.white : P.legend.black).filter(line => line.length > played.length && played.every((u, i) => line[i] === u));
  if (book.length) return { uci: book[Math.floor(Math.random() * book.length)][played.length], book: true };
  // 2. Weaker levels sometimes play a random move, like a human slip.
  const legal = ch.moves({ verbose: true });
  if (Math.random() < P.level.blunder) return { uci: BC.moveUci(legal[Math.floor(Math.random() * legal.length)]), why: '' };
  // 3. Engine candidates, nudged toward the legend's style.
  await engine.start();
  const { depth, multipv, temp } = P.level;
  const lines = await engine.analyse(fen, { depth, movetime: depth >= 12 ? 2500 : 900, multipv: Math.min(multipv, legal.length) });
  const sign = side === 'w' ? 1 : -1;
  const cands = lines.map(l => {
    const v = l.mate != null ? sign * (l.mate > 0 ? 10000 - l.mate * 10 : -10000 - l.mate * 10) : sign * l.cp;
    const m = new Chess(fen).move({ from: l.uci.slice(0, 2), to: l.uci.slice(2, 4), promotion: l.uci[4] || 'q' });
    const { bonus, why } = styleBonus(fen, m, P.legend.vec);
    return { uci: l.uci, u: v + bonus, why };
  });
  if (!cands.length) return { uci: BC.moveUci(legal[0]), why: '' };
  if (!temp) { cands.sort((a, b) => b.u - a.u); return cands[0]; }
  const top = Math.max(...cands.map(c => c.u));
  const w = cands.map(c => Math.exp((c.u - top) / temp));
  let r = Math.random() * w.reduce((s, x) => s + x, 0);
  for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) return cands[i]; }
  return cands[0];
}
// A small bonus (in centipawns) for moves that fit the legend's style.
function styleBonus(fen, m, vec) {
  if (!m) return { bonus: 0, why: '' };
  const a = BC.parseFen(fen), me = m.color, num = +fen.split(' ')[5];
  let bonus = 0; const why = [];
  if (m.captured) {
    bonus += 25 * vec.attack;
    if (m.piece !== 'p' && VAL[m.captured] === VAL[m.piece]) { bonus += 40 * (vec.trade - 0.5); if (vec.trade > 0.6) why.push('A trade, in the style of a positional player.'); }
  }
  if (m.san.includes('+')) { bonus += 35 * vec.attack; if (vec.attack > 0.7) why.push('Check: keeping up the pressure.'); }
  let ek = -1; for (let i = 0; i < 64; i++) if (a[i] && a[i].t === 'k' && a[i].c !== me) ek = i;
  const dist = s => { const i = BC.sqIdx(s); return Math.max(Math.abs((i & 7) - (ek & 7)), Math.abs((i >> 3) - (ek >> 3))); };
  if (ek >= 0 && m.piece !== 'k' && m.piece !== 'p') { const d = dist(m.from) - dist(m.to); if (d > 0) { bonus += 10 * vec.attack * Math.min(d, 2); if (vec.attack > 0.7 && d >= 2) why.push('Bringing another piece toward the king.'); } }
  if (num <= 12) {
    const home = me === 'w' ? '1' : '8';
    if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === home) { bonus += 25 * vec.tempo; why.push('Developing a piece.'); }
    if (m.flags.includes('k') || m.flags.includes('q')) { bonus += 30 * vec.safety; why.push('Castling to keep the king safe.'); }
    if (m.piece === 'q' && num <= 6) bonus -= 30 * vec.tempo;
  }
  if (m.piece === 'p' && 'fgh'.includes(m.from[0]) && !m.captured) {
    let mk = -1; for (let i = 0; i < 64; i++) if (a[i] && a[i].t === 'k' && a[i].c === me) mk = i;
    if (mk >= 0 && (mk & 7) >= 5) bonus -= 15 * vec.safety;
  }
  return { bonus, why: why[0] || '' };
}
function takeback() {
  const P = S.play;
  if (P.thinking) return;
  P.ch.undo();
  if (P.ch.turn() !== P.me) P.ch.undo();
  P.lastBot = null; S.sel = {};
  renderPlay();
}
function gamePgn() {
  const P = S.play, ch = P.ch;
  const bot = `${P.legend.name} bot (${P.level.label})`;
  const result = P.status === 'won' ? (P.me === 'w' ? '1-0' : '0-1') : P.status === 'lost' ? (P.me === 'w' ? '0-1' : '1-0') : '1/2-1/2';
  const d = new Date();
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const headers = { Event: 'Blunder Check legends', Date: date, White: P.me === 'w' ? 'You' : bot, Black: P.me === 'b' ? 'You' : bot, Result: result };
  const moves = ch.history();
  let text = Object.entries(headers).map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n';
  moves.forEach((m, i) => { text += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + m + ' '; });
  return text + result;
}

// ---------- guess the move ----------
function startGuess(id) {
  const g = LG.games.find(x => x.id === id); if (!g) return;
  const ch = new Chess(), fens = [ch.fen()];
  for (const p of g.plies) { uciMove(ch, p.uci); fens.push(ch.fen()); }
  S.guess = { g, fens, i: 0, score: 0, max: 0, matched: 0, asked: 0, fb: null, revealed: false, notes: [] };
  S.mode = 'guess'; S.sel = {};
  advanceOpponent();
  render();
  document.querySelector('#view-legends .boardcol').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
const isLegendPly = (G, i) => (i % 2 === 0) === (G.g.side === 'w');
const noteKey = i => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? 'w' : 'b'}`;
function advanceOpponent() {
  const G = S.guess;
  while (G.i < G.g.plies.length && !isLegendPly(G, G.i)) {
    const p = G.g.plies[G.i];
    G.notes.push({ who: G.g.side === 'w' ? G.g.black : G.g.white, label: label(G.i), text: G.g.notes[noteKey(G.i)] || '' });
    G.i++;
  }
}
const label = i => `${Math.floor(i / 2) + 1}${i % 2 === 0 ? '.' : '…'} ${S.guess.g.plies[i].san}`;
function renderGuess() {
  const G = S.guess, g = G.g, done = G.i >= g.plies.length;
  const fen = G.fens[G.i];
  const prev = G.i > 0 ? g.plies[G.i - 1].uci : null;
  const marks = prev ? [{ sq: prev.slice(0, 2), color: 'var(--accent)', pct: 30 }, { sq: prev.slice(2, 4), color: 'var(--accent)', pct: 45 }] : [];
  if (G.fb && G.fb.mine && G.fb.mine !== g.plies[G.i].uci) marks.push({ sq: G.fb.mine.slice(0, 2), color: 'var(--c-miss)', pct: 45 }, { sq: G.fb.mine.slice(2, 4), color: 'var(--c-miss)', pct: 45 });
  const arrows = G.revealed && !done ? [{ uci: g.plies[G.i].uci, color: 'var(--c-best)' }] : [];
  view.render({ fen, flipped: g.side === 'b', marks, arrows, selected: S.sel.selected, targets: S.sel.targets, interactive: !done && !G.revealed });
  const legend = byId[g.legend];
  $('gCaption').textContent = `${g.white} vs ${g.black} · ${g.event} ${g.year}`;
  const lastNote = G.notes.length ? G.notes[G.notes.length - 1] : null;
  let body;
  if (done) {
    const pct = G.max ? Math.round(G.score / G.max * 100) : 0;
    body = `<p class="body fb-ok"><b>Game over (${esc(g.result)}).</b> You matched ${esc(legend.name)} on ${G.matched} of ${G.asked} moves. Score: ${G.score} of ${G.max} (${pct}%).</p>`;
  } else if (G.revealed) {
    const p = g.plies[G.i], note = g.notes[noteKey(G.i)];
    body = `<p class="body ${G.fb && G.fb.pts ? 'fb-ok' : 'fb-no'}">${esc(G.fb ? G.fb.msg : '')}</p>
      <div class="note"><span class="who">${esc(legend.name)} played ${esc(label(G.i))}</span>${note ? `<p>${esc(note)}</p>` : ''}</div>`;
  } else {
    body = `<p class="body"><b>Move ${Math.floor(G.i / 2) + 1}: what did ${esc(legend.name)} play?</b> Tap a piece, then a square.</p>
      ${lastNote && lastNote.text ? `<div class="note"><span class="who">${esc(lastNote.label)}</span><p>${esc(lastNote.text)}</p></div>` : ''}`;
  }
  $('gPanel').innerHTML = `<h2>Guess the move · ${esc(legend.name)}</h2><h3 class="title">${esc(g.title)}</h3>
    ${G.i === 0 || (G.i <= 1 && !G.asked) ? `<p class="body muted">${esc(g.intro)}</p>` : ''}
    <p class="opening">Score ${G.score} of ${G.max}</p>
    ${body}
    <div class="acts">${done ? '<button class="btn" data-act="guessAgain">Play it again</button>'
      : G.revealed ? '<button class="btn" data-act="guessNext">Next move</button>' : '<button class="btn ghost" data-act="guessShow">Show me</button>'}
      <button class="btn ghost" data-act="allGames">All famous games</button></div>`;
  bind($('gPanel'), ACT);
}
function tapGuess(nm) {
  const G = S.guess;
  if (!G || G.revealed || G.i >= G.g.plies.length) return;
  const m = BC.tapMove(S.sel, G.fens[G.i], nm);
  if (!m) return renderGuess();
  const p = G.g.plies[G.i], legend = byId[G.g.legend], uci = moveUci(m);
  const exact = uci === p.uci || (m.from + m.to) === p.uci.slice(0, 4);
  const alt = !exact && (p.alts || []).includes(uci);
  const pts = exact ? 10 : alt ? 5 : 0;
  G.score += pts; G.max += 10; G.asked++; if (exact) G.matched++;
  G.fb = { mine: uci, pts, msg: exact ? `${m.san}: that's ${legend.name}'s move! +10` : alt ? `${m.san} is just as good according to Stockfish. +5` : `Not this time: ${m.san}.` };
  G.revealed = true;
  renderGuess();
}
function nextGuess() {
  const G = S.guess;
  G.notes.push({ who: '', label: label(G.i), text: G.g.notes[noteKey(G.i)] || '' });
  G.i++; G.revealed = false; G.fb = null; S.sel = {};
  advanceOpponent();
  if (G.i >= G.g.plies.length) {
    const pct = G.max ? Math.round(G.score / G.max * 100) : 0;
    rec().guess[G.g.id] = Math.max(rec().guess[G.g.id] || 0, pct);
    sync.saveProgress();
  }
  renderGuess();
}

const ACT = {
  home: () => { S.mode = 'home'; S.legend = null; S.play = null; S.guess = null; render(); },
  setup: d => { S.legend = byId[d.id]; S.mode = 'setup'; render(); },
  color: d => { S.color = d.v; renderSetup(); },
  start: () => startGame(),
  games: d => { S.legend = byId[d.id]; S.mode = 'games'; render(); },
  allGames: () => { S.legend = null; S.mode = 'games'; S.guess = null; render(); },
  guess: d => startGuess(d.id),
  guessShow: () => { const G = S.guess; G.max += 10; G.asked++; G.fb = { pts: 0, msg: 'Here is the move.' }; G.revealed = true; renderGuess(); },
  guessNext: () => nextGuess(),
  guessAgain: () => startGuess(S.guess.g.id),
  course: d => BC.emit('openCourse', d.c),
  takeback: () => takeback(),
  resign: () => { S.play.msg = 'You resigned.'; finish('lost'); renderPlay(); },
  rematch: () => startGame(),
  reviewGame: () => { const pgn = gamePgn(); location.hash = 'review'; BC.review.reviewPgn(pgn, S.play.me); },
};

BC.on('view', name => { if (name === 'legends') render(); });
BC.on('playLegend', id => { if (byId[id]) { S.legend = byId[id]; S.mode = 'setup'; render(); } });
BC.legends = { get state() { return S; }, styleBonus, LEVELS };
})();
