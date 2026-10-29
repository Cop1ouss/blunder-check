// Review tab: classify every move of a pasted game with Stockfish, explain it,
// and let the player retry their own mistakes.
(() => {
'use strict';
const { $, esc, clamp, VAL, PNAME, sqName, sqIdx, opp, cName, parseFen, attacksFrom, attackers,
  isFreeCapture, inDanger, pieceList, posKey, START, uciMove, sanOf, pvSan, forC, winOfScore, engine } = BC;
const D = window.BC_DATA;
const BOOK = new Set(D.openings.book.split(','));

// ---------- classifications ----------
const CLASSES = [
  ['brilliant', 'Brilliant', '!!', 'is brilliant'], ['great', 'Great', '!', 'is a great move'],
  ['best', 'Best', '★', 'is the best move'], ['excellent', 'Excellent', '✓', 'is excellent'],
  ['good', 'Good', '✓', 'is good'], ['book', 'Book', '≡', 'is a book move'], ['forced', 'Forced', '→', 'was forced'],
  ['inaccuracy', 'Inaccuracy', '?!', 'is an inaccuracy'], ['mistake', 'Mistake', '?', 'is a mistake'],
  ['miss', 'Miss', '✕', 'is a miss'], ['blunder', 'Blunder', '??', 'is a blunder'],
];
const CL = Object.fromEntries(CLASSES.map(([id, label, sym, verb]) => [id, { id, label, sym, verb }]));
const BAD = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
const SEVERE = new Set(['mistake', 'miss', 'blunder']);
const SEV = { brilliant: 0, great: 0, best: 0, book: 0, forced: 0, excellent: 1, good: 2, inaccuracy: 3, mistake: 4, miss: 4, blunder: 5 };
const colorOf = cls => `var(--c-${cls})`;
const iconHTML = (cls, sm) => `<span class="icon${sm ? ' sm' : ''}" style="background:${colorOf(cls)}" title="${CL[cls].label}">${CL[cls].sym}</span>`;
const moveLabel = (g, k) => { const m = g.moves[k]; return `${m.num}${m.color === 'w' ? '.' : '…'} ${m.san}`; };

function parseGame(text) {
  let t = text.replace(/\r\n?/g, '\n').trim();
  const blocks = t.split(/\n\s*\n(?=\[Event )/);
  if (blocks.length > 1) t = blocks[0];
  const chess = new Chess();
  if (!t || !chess.load_pgn(t, { sloppy: true })) return null;
  const headers = chess.header();
  const startFen = headers.FEN && headers.SetUp === '1' ? headers.FEN : START;
  const hist = chess.history({ verbose: true });
  if (!hist.length) return null;
  const replay = new Chess(startFen);
  const fens = [replay.fen()], moves = [];
  for (const h of hist) {
    const num = +replay.fen().split(' ')[5];
    const m = replay.move({ from: h.from, to: h.to, promotion: h.promotion });
    moves.push({ san: m.san, from: m.from, to: m.to, color: m.color, piece: m.piece, captured: m.captured, promotion: m.promotion,
      uci: m.from + m.to + (m.promotion || ''), num });
    fens.push(replay.fen());
  }
  const info = fens.map(f => {
    const c = new Chess(f);
    return { turn: f.split(' ')[1], over: c.game_over(), mate: c.in_checkmate(), legal: c.moves().length };
  });
  const book = [];
  const std = startFen === START;
  moves.forEach((m, k) => { book[k] = std && (k === 0 || book[k - 1]) && BOOK.has(posKey(fens[k + 1])); });
  let opening = null;
  if (std) for (let i = 1; i < Math.min(fens.length, 40); i++) { const n = D.openings.names[posKey(fens[i])]; if (n) opening = n; }
  return { headers, moves, fens, info, book, opening, std, an: new Array(fens.length).fill(null), res: [], me: 'w', pgn: t };
}

// ---------- evaluation maths ----------
function winW(g, i) {
  const inf = g.info[i];
  if (inf.over) return inf.mate ? (inf.turn === 'w' ? 0 : 100) : 50;
  const a = g.an[i]; if (!a) return null;
  return a.lines.length ? winOfScore(a.lines[0]) : 50;
}
function cpFor(g, i, c) {
  const inf = g.info[i]; let v;
  if (inf.over) v = inf.mate ? (inf.turn === 'w' ? -1500 : 1500) : 0;
  else { const l = g.an[i].lines[0]; v = l.mate != null ? (l.mate > 0 ? 1500 : -1500) : clamp(l.cp, -1500, 1500); }
  return c === 'w' ? v : -v;
}
// >0: c mates in n. <0: c is getting mated in n. null: no forced mate.
function mateFor(g, i, c) {
  const inf = g.info[i];
  if (inf.over) return inf.mate ? (inf.turn === c ? -0.5 : 0.5) : null;
  const l = g.an[i] && g.an[i].lines[0];
  if (!l || l.mate == null) return null;
  return c === 'w' ? l.mate : -l.mate;
}
function evalText(g, i) {
  const inf = g.info[i];
  if (inf.over) return inf.mate ? (inf.turn === 'w' ? '0-1' : '1-0') : '½-½';
  const a = g.an[i]; if (!a || !a.lines.length) return '';
  const l = a.lines[0];
  if (l.mate != null) return (l.mate > 0 ? '#' : '#-') + Math.abs(l.mate);
  const v = l.cp / 100; return (v > 0 ? '+' : '') + v.toFixed(1);
}
function isSacrifice(g, k) {
  const mv = g.moves[k], t = mv.promotion || mv.piece;
  if (VAL[t] < 3) return false;
  const a = parseFen(g.fens[k + 1]), to = sqIdx(mv.to);
  const att = attackers(a, to, opp(mv.color)); if (!att.length) return false;
  const def = attackers(a, to, mv.color);
  const minAtt = Math.min(...att.map(i => (a[i].t === 'k' ? 100 : VAL[a[i].t])));
  if ((mv.captured ? VAL[mv.captured] : 0) >= VAL[t]) return false;
  return (def.length === 0 && minAtt < 100) || minAtt < VAL[t];
}
function classify(g, k) {
  const mv = g.moves[k], c = mv.color, a = g.an[k];
  if ((!a && !g.info[k].over) || winW(g, k + 1) == null) return null;
  const wb = forC(winW(g, k), c), wa = forC(winW(g, k + 1), c);
  const r = { k, wb, wa, loss: Math.max(0, wb - wa), cls: 'good' };
  if (g.info[k].legal === 1) { r.cls = 'forced'; return r; }
  if (g.book[k]) { r.cls = 'book'; return r; }
  const best = a.lines[0], second = a.lines[1];
  const givesMate = g.info[k + 1].mate;
  const isBest = givesMate || (best && best.uci === mv.uci);
  let cls = isBest ? 'best' : r.loss < 2 ? 'excellent' : r.loss < 5 ? 'good' : r.loss < 10 ? 'inaccuracy' : r.loss < 20 ? 'mistake' : 'blunder';
  // Beginner tuning: giving away material is always flagged, even in lost or won positions.
  const cpDrop = cpFor(g, k, c) - cpFor(g, k + 1, c);
  if (!isBest && cpDrop >= 250 && SEV[cls] < SEV.mistake) cls = 'mistake';
  const mb = mateFor(g, k, c), ma = mateFor(g, k + 1, c);
  const allowedMate = ma != null && ma < 0 && !(mb != null && mb < 0);
  const missedMate = !isBest && mb != null && mb > 0 && !(ma != null && ma > 0);
  if (allowedMate) cls = 'blunder';
  else if (missedMate) cls = 'miss';
  else if ((cls === 'mistake' || cls === 'blunder') && k > 0 && g.res[k - 1] && SEVERE.has(g.res[k - 1].cls)
           && winW(g, k - 1) != null && wa >= forC(winW(g, k - 1), c) - 5) cls = 'miss';
  if (cls === 'best' && !givesMate && second) {
    const recapture = mv.captured && k > 0 && g.moves[k - 1].to === mv.to;
    if (!recapture && wb - forC(winOfScore(second), c) >= 15) cls = 'great';
  }
  if ((cls === 'best' || cls === 'great' || cls === 'excellent') && r.wa >= 50 && r.wb < 95 && isSacrifice(g, k)) cls = 'brilliant';
  r.cls = cls;
  return r;
}
function moveAcc(before, after) { return clamp(103.1668 * Math.exp(-0.04354 * Math.max(0, before - after)) - 3.1669 + 1, 0, 100); }
function accuracy(g) {
  const N = g.moves.length, wins = [];
  for (let i = 0; i <= N; i++) { const w = winW(g, i); if (w == null) return null; wins.push(w); }
  const ws = clamp(Math.floor(N / 10), 2, 8), windows = [];
  for (let i = 0; i < ws - 2 && windows.length < N; i++) windows.push(wins.slice(0, ws));
  for (let i = 0; i + ws <= wins.length; i++) windows.push(wins.slice(i, i + ws));
  const sd = xs => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length); };
  const weights = windows.map(w => clamp(sd(w), 0.5, 12));
  const out = {};
  for (const c of ['w', 'b']) {
    let sw = 0, swa = 0, inv = 0, n = 0;
    g.moves.forEach((m, k) => {
      if (m.color !== c) return;
      const acc = moveAcc(forC(wins[k], c), forC(wins[k + 1], c)), w = weights[k] || 1;
      sw += w; swa += w * acc; inv += 1 / Math.max(acc, 1); n++;
    });
    out[c] = n ? (swa / sw + n / inv) / 2 : null;
  }
  return out;
}
function derive(g) {
  g.res = [];
  for (let k = 0; k < g.moves.length; k++) g.res[k] = classify(g, k);
  g.acc = accuracy(g);
}

// ---------- coach: bad moves ----------
function explainBad(g, k) {
  const mv = g.moves[k], c = mv.color, mine = c === g.me;
  const a = g.an[k], b = g.an[k + 1];
  const best = a.lines[0], bestSan = sanOf(g.fens[k], best.uci);
  const mb = mateFor(g, k, c), ma = mateFor(g, k + 1, c);
  const reply = b && b.lines[0], replySan = reply ? sanOf(g.fens[k + 1], reply.uci) : null;
  if (mb != null && mb > 0 && !(ma != null && ma > 0)) {
    const n = Math.round(mb);
    return { tag: 'missed_mate', text: mine
      ? `You had checkmate${n > 1 ? ` in ${n}` : ''}, starting with ${bestSan}. Look at every check before anything else.`
      : `Your opponent had checkmate${n > 1 ? ` in ${n}` : ''} with ${bestSan}, and missed it.` };
  }
  if (ma != null && ma < 0) {
    const n = Math.round(-ma);
    return { tag: 'allowed_mate', text: mine
      ? `This lets your opponent force checkmate${n > 0 ? ` in ${n}` : ''}${replySan ? `, starting with ${replySan}` : ''}. Before every move, ask: what checks can they give me?`
      : `This gave you a forced checkmate${n > 0 ? ` in ${n}` : ''}${replySan ? `, starting with ${replySan}` : ''}.` };
  }
  if (reply) {
    const rf = reply.uci.slice(0, 2), rt = reply.uci.slice(2, 4);
    const after = parseFen(g.fens[k + 1]);
    const victim = after[sqIdx(rt)];
    const ch = new Chess(g.fens[k + 1]); uciMove(ch, reply.uci);
    const a2 = parseFen(ch.fen()), at = sqIdx(rt), fp = a2[at];
    // Our pieces the replying piece hits from its new square: bigger ones, the king, or unprotected ones.
    const hits = fp ? attacksFrom(a2, at).filter(s => {
      const p = a2[s];
      return p && p.c === c && (p.t === 'k' || VAL[p.t] > VAL[fp.t] || attackers(a2, s, c).length === 0);
    }) : [];
    if (victim && victim.c === c && isFreeCapture(g.fens[k + 1], rf, rt)) {
      const moved = rt === mv.to;
      const big = hits.filter(s => a2[s].t !== 'p');
      const then = big.length ? (mine ? ` Then it also attacks your ${pieceList(a2, big)}.` : ` Then it also attacks their ${pieceList(a2, big)}.`) : '';
      return { tag: 'hung_piece', text: mine
        ? `You hung your ${PNAME[victim.t]} on ${rt}. ${moved ? 'You moved it to a square they attack' : 'Your move left it unprotected'}, and they can take it with ${replySan}.${then} Blunder check: is my piece safe where it lands? Did my move leave anything unprotected?`
        : `Your opponent hung their ${PNAME[victim.t]} on ${rt}. You can take it with ${replySan}.${then}` };
    }
    if (fp && hits.length >= 2) {
      const list = pieceList(a2, hits);
      return { tag: 'fork', text: mine
        ? `This allowed ${replySan}, a fork: it attacks your ${list} at the same time, and you can't save both. Look for squares where one enemy piece could hit two of yours.`
        : `This allowed you a fork with ${replySan}, hitting their ${list} at once.` };
    }
  }
  const bf = best.uci.slice(0, 2), bt = best.uci.slice(2, 4);
  const before = parseFen(g.fens[k]);
  if (before[sqIdx(bt)] && isFreeCapture(g.fens[k], bf, bt)) {
    const v = before[sqIdx(bt)];
    return { tag: 'missed_capture', text: mine
      ? `You could have won their ${PNAME[v.t]} on ${bt} with ${bestSan}. Every move, check what your opponent just left unprotected.`
      : `Your opponent could have won your ${PNAME[v.t]} on ${bt} with ${bestSan}. It was unprotected.` };
  }
  const much = SEV[g.res[k].cls] >= SEV.mistake ? 'much ' : '';
  if (bestSan.includes('+')) {
    return { tag: 'missed_check', text: mine
      ? `${bestSan} was ${much}stronger. Look at checks, captures and threats first.`
      : `${bestSan} was ${much}stronger for your opponent.` };
  }
  return { tag: 'other', text: mine
    ? `${bestSan} was stronger.${replySan ? ` After your move, their best reply is ${replySan}. Step through the line below to see why.` : ''}`
    : `${bestSan} was stronger.${replySan ? ` Your best reply here was ${replySan}.` : ''}` };
}
const TAG_LABEL = { missed_mate: 'missed checkmates', allowed_mate: 'walked into checkmate', hung_piece: 'hung pieces',
  fork: 'allowed forks', missed_capture: 'missed free pieces', missed_check: 'missed strong checks', other: 'other mistakes' };
const TAG_LESSON = { hung_piece: 'blunder-check', fork: 'forks', missed_capture: 'free-pieces', missed_mate: 'mate-1', allowed_mate: 'blunder-check' };

// ---------- coach: what a move does ----------
function describeMove(g, k) {
  const mv = g.moves[k], c = mv.color, mine = c === g.me;
  const your = mine ? 'your' : 'their', their = mine ? 'their' : 'your';
  if (g.info[k + 1].mate) return ['Checkmate!'];
  const out = [];
  const before = parseFen(g.fens[k]), after = parseFen(g.fens[k + 1]);
  const to = sqIdx(mv.to), from = sqIdx(mv.from), moved = after[to];
  if (mv.san.startsWith('O-O')) out.push(`Castling tucks ${your} king away and brings a rook toward the center.`);
  if (mv.captured) {
    const prev = k > 0 ? g.moves[k - 1] : null;
    if (prev && prev.to === mv.to && prev.captured) out.push(`Takes back on ${mv.to}, so material stays even.`);
    else if (isFreeCapture(g.fens[k], mv.from, mv.to)) out.push(`Wins ${their} ${PNAME[mv.captured]} on ${mv.to}.`);
    else if (VAL[mv.captured] === VAL[mv.piece]) out.push(`Trades ${PNAME[mv.piece]} for ${PNAME[mv.captured]}.`);
  }
  if (moved && moved.t !== 'k') {
    const hits = attacksFrom(after, to).filter(s => {
      const p = after[s];
      return p && p.c !== c && p.t !== 'p' && (p.t === 'k' || VAL[p.t] > VAL[moved.t] || attackers(after, s, p.c).length === 0);
    });
    if (hits.length >= 2) out.push(`A fork: it attacks ${their} ${pieceList(after, hits)} at once.`);
    else if (hits.length === 1 && after[hits[0]].t !== 'k') out.push(`Attacks ${their} ${PNAME[after[hits[0]].t]} on ${sqName(hits[0])}.`);
  }
  if (mv.san.includes('+') && !out.some(s => s.startsWith('A fork'))) out.push('Gives check.');
  if (!mv.captured && mv.piece !== 'k' && mv.piece !== 'p' && inDanger(before, from) && !inDanger(after, to)) out.push(`Moves ${your} ${PNAME[mv.piece]} out of danger.`);
  if (mv.num <= 12 && out.length < 2) {
    const home = c === 'w' ? '1' : '8';
    if ((mv.piece === 'n' || mv.piece === 'b') && mv.from[1] === home) out.push(`Develops ${your} ${PNAME[mv.piece]}.`);
    if (mv.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(mv.to) && !mv.captured) out.push('Claims space in the center.');
  }
  return out.slice(0, 2);
}

// ---------- opening checklist ----------
function openingChecklist(g) {
  if (!g.std) return null;
  const c = g.me, idx = [];
  g.moves.forEach((m, k) => { if (m.color === c) idx.push(k); });
  if (idx.length < 6) return null;
  const mine = idx.map(k => g.moves[k]);
  const items = [];
  const center = mine.slice(0, 3).some(m => m.piece === 'p' && 'de'.includes(m.from[0]) && ['4', '5'].includes(m.to[1]));
  items.push(center ? { ok: true, text: 'Took the center with a pawn early.' }
    : { ok: false, text: 'No center pawn in your first 3 moves. Start with e4 or d4 (as Black, e5 or d5).' });
  const q = mine.find(m => m.piece === 'q');
  items.push(q && q.num <= 5 ? { ok: false, text: `Queen came out on move ${q.num}. Develop knights and bishops first; an early queen gets chased.` }
    : { ok: true, text: 'Kept the queen at home early on.' });
  const home = c === 'w' ? '1' : '8';
  const minors = new Set(mine.filter(m => m.num <= 10 && (m.piece === 'n' || m.piece === 'b') && m.from[1] === home).map(m => m.from));
  const dev = Math.min(4, minors.size);
  items.push({ ok: dev >= 3, text: dev >= 3 ? `${dev} of 4 knights and bishops developed by move 10.` : `Only ${dev} of 4 knights and bishops developed by move 10. Get them out before attacking.` });
  const cm = mine.find(m => m.san.startsWith('O-O'));
  if (cm) items.push(cm.num <= 12 ? { ok: true, text: `Castled on move ${cm.num}.` } : { ok: false, text: `Castled late, on move ${cm.num}. Aim for move 10 or earlier.` });
  else {
    const km = mine.find(m => m.piece === 'k');
    items.push({ ok: false, text: km && km.num <= 15 ? `Your king moved on move ${km.num} instead of castling, so you can't castle any more.` : 'Never castled. Your king stayed in the center.' });
  }
  // Same piece twice before everything is out (escaping an attack or capturing doesn't count).
  const movedFrom = new Set(); let twice = null;
  for (const k of idx) {
    const m = g.moves[k]; if (m.num > 8) break;
    if (m.piece !== 'p' && m.piece !== 'k') {
      if (movedFrom.has(m.from) && !m.captured && !inDanger(parseFen(g.fens[k]), sqIdx(m.from)) && !twice) twice = m;
      movedFrom.delete(m.from); movedFrom.add(m.to);
    }
  }
  if (twice) items.push({ ok: false, text: `Moved your ${PNAME[twice.piece]} twice (move ${twice.num}, ${twice.san}) before developing everything.` });
  const castledAt = cm ? cm.num : 99;
  const fpawn = mine.find(m => m.piece === 'p' && m.from[0] === 'f' && m.num <= 10 && m.num < castledAt);
  if (fpawn) items.push({ ok: false, text: `Pushed the f-pawn on move ${fpawn.num} (${fpawn.san}) before castling. It opens a path to your king.` });
  return items;
}

// ---------- state ----------
let g = null, ply = 0, flipped = false, showBest = true, practice = null, runId = 0, isSample = false;
const view = new BC.BoardView(document.querySelector('#view-review .boardbox'), onBoardTap);

function setGame(game, { sample = false, me = null } = {}) {
  g = game; isSample = sample; practice = null; ply = 0;
  const u = ($('username').value || '').trim().toLowerCase();
  g.me = me || (u && (g.headers.Black || '').toLowerCase() === u ? 'b' : 'w');
  flipped = g.me === 'b';
  derive(g); render();
}
function render() { renderBoard(); renderPlayers(); renderGraph(); renderCoach(); renderSummary(); renderChecklist(); renderLegendMatch(); renderMoves(); renderControls(); }

function renderBoard() {
  const fen = practice ? g.fens[practice.k] : g.fens[ply];
  const last = !practice && ply > 0 ? g.moves[ply - 1] : null;
  const res = last ? g.res[ply - 1] : null;
  const marks = [];
  if (last) {
    const col = res ? colorOf(res.cls) : 'var(--accent)';
    marks.push({ sq: last.from, color: col, pct: 35 }, { sq: last.to, color: col, pct: 55 });
  }
  const pr = practice || {};
  if (pr.result) { const col = pr.result.ok ? 'var(--c-best)' : 'var(--c-miss)'; marks.push({ sq: pr.result.from, color: col, pct: 50 }, { sq: pr.result.to, color: col, pct: 50 }); }
  const arrows = [];
  if (practice && practice.reveal) arrows.push({ uci: g.an[practice.k].lines[0].uci, color: 'var(--c-best)' });
  else if (!practice && ply > 0 && showBest) {
    const k = ply - 1, rr = g.res[k];
    if (rr && SEV[rr.cls] >= 1 && g.an[k] && g.an[k].lines[0]) arrows.push({ uci: g.an[k].lines[0].uci, color: 'var(--c-best)' });
  }
  view.render({ fen, flipped, marks, selected: pr.selected, targets: pr.targets, arrows, interactive: !!practice,
    badge: last && res ? { sq: last.to, color: colorOf(res.cls), sym: CL[res.cls].sym } : null });
  const i = practice ? practice.k : ply, w = winW(g, i);
  const fill = $('evalfill'), txt = $('evaltxt'), bar = $('evalbar');
  bar.classList.toggle('flip', flipped);
  fill.style.height = (w == null ? 50 : w) + '%';
  txt.textContent = evalText(g, i).replace(/^\+/, '');
  const whiteAhead = (w == null ? 50 : w) >= 50, atBottom = whiteAhead !== flipped;
  txt.style.top = atBottom ? 'auto' : '4px'; txt.style.bottom = atBottom ? '4px' : 'auto';
  txt.style.color = whiteAhead ? '#1b1f25' : '#e8edf2';
}
function renderPlayers() {
  const side = c => {
    const h = g.headers, name = c === 'w' ? (h.White || 'White') : (h.Black || 'Black'), elo = c === 'w' ? h.WhiteElo : h.BlackElo;
    const acc = g.acc && g.acc[c] != null ? `<span class="acc">${g.acc[c].toFixed(1)}</span>` : '';
    return `<span class="dot ${c}"></span><span class="name">${esc(name)}${c === g.me ? ' (you)' : ''}</span>${elo && elo !== '?' ? `<span class="elo">${esc(elo)}</span>` : ''}${acc}`;
  };
  $('pTop').innerHTML = side(flipped ? 'w' : 'b');
  $('pBottom').innerHTML = side(flipped ? 'b' : 'w');
}
function renderGraph() {
  const N = g.moves.length, el = $('graph'), pts = [];
  for (let i = 0; i <= N; i++) { const w = winW(g, i); if (w == null) break; pts.push([i / N * 1000, 100 - w]); }
  let svg = `<svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">`;
  if (pts.length > 1) {
    const d = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(2)}`).join(' L');
    svg += `<path d="M0,100 L${d} L${pts[pts.length - 1][0].toFixed(1)},100 Z" fill="var(--graph-hi)"/>`;
  }
  svg += `<line x1="0" y1="50" x2="1000" y2="50" stroke="var(--graph-mid)" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`;
  const cx = (practice ? practice.k : ply) / N * 1000;
  svg += `<line x1="${cx}" y1="0" x2="${cx}" y2="100" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
  let marks = '';
  g.res.forEach((r, k) => {
    if (!r || !(SEVERE.has(r.cls) || r.cls === 'brilliant' || r.cls === 'great')) return;
    marks += `<span class="mk" style="left:${(k + 1) / N * 100}%;top:${clamp(100 - winW(g, k + 1), 4, 96)}%;background:${colorOf(r.cls)}"></span>`;
  });
  el.innerHTML = svg + marks;
}

function renderCoach() {
  const el = $('coach');
  const sampleNote = isSample ? `<p class="sample">This is a <b>sample game</b> so you can see how a review looks. Paste your own game above to review it.</p>` : '';
  if (practice) { el.innerHTML = sampleNote + practiceHTML(); bindActs(el); return; }
  if (ply === 0) {
    const mine = g.res.filter(r => r && g.moves[r.k].color === g.me && BAD.has(r.cls));
    const tags = {};
    mine.filter(r => SEVERE.has(r.cls) && g.an[r.k] && g.an[r.k + 1]).forEach(r => { const t = explainBad(g, r.k).tag; tags[t] = (tags[t] || 0) + 1; });
    const named = Object.entries(tags).filter(([t]) => t !== 'other').sort((a, b) => b[1] - a[1]);
    const done = g.res.length && g.res.every(Boolean);
    let body, lessonBtn = '';
    if (!done) body = `<p class="body">Stockfish is reviewing this game. You can already step through the moves it has finished.</p>`;
    else if (!mine.length) body = `<p class="body">No mistakes from you in this game. Step through it to see your best moves.</p>`;
    else {
      const leak = named.length ? `<p class="body">Your biggest leak this game: <b>${TAG_LABEL[named[0][0]]}</b> (${named[0][1]}×). Fix that one first.</p>` : '';
      body = `<p class="body">You made <b>${mine.length}</b> move${mine.length > 1 ? 's' : ''} worth looking at. Go through each one, then press Retry and find the better move yourself.</p>${leak}`;
      const lesson = named.length && TAG_LESSON[named[0][0]];
      if (lesson) lessonBtn = `<a class="btn ghost" href="#lessons" data-lesson="${lesson}">Practice this in Lessons</a>`;
    }
    el.innerHTML = sampleNote + `<div class="head"><span class="icon" style="background:var(--accent);color:var(--accent-ink)">♞</span><h3 class="title">Game review</h3></div>${body}
      <div class="acts">${mine.length ? '<button class="btn" data-act="nextMistake">Go to my first mistake</button>' : ''}<button class="btn ghost" data-act="next">Start from move 1</button>${lessonBtn}</div>`;
    bindActs(el);
    const lb = el.querySelector('[data-lesson]'); if (lb) lb.addEventListener('click', () => BC.emit('openLesson', lb.dataset.lesson));
    return;
  }
  const k = ply - 1, r = g.res[k], mv = g.moves[k];
  if (!r) { el.innerHTML = sampleNote + `<div class="head"><h3 class="title">${esc(moveLabel(g, k))}</h3></div><p class="body">Analyzing this move…</p>`; return; }
  const a = g.an[k];
  const bestSan = a && a.lines[0] ? sanOf(g.fens[k], a.lines[0].uci) : '';
  const what = describeMove(g, k);
  const whatHTML = what.length && r.cls !== 'forced' ? `<ul class="what">${what.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
  let body = '', line = '';
  switch (r.cls) {
    case 'book': body = `Opening theory.${g.opening ? ` This game is a <b>${esc(g.opening)}</b>.` : ''}`; break;
    case 'forced': body = 'The only legal move.'; break;
    case 'brilliant': body = `A real sacrifice: the ${PNAME[mv.promotion || mv.piece]} on ${mv.to} can be taken, and it still works. Stockfish agrees.`; break;
    case 'great': body = `The only good move here. The next best, ${esc(sanOf(g.fens[k], a.lines[1].uci))}, is much worse.`; break;
    case 'best': body = g.info[k + 1].mate ? 'Game over.' : 'Stockfish would play the same move.'; break;
    case 'excellent': body = `Nearly as good as Stockfish's choice, ${esc(bestSan)}.`; break;
    case 'good': body = `A fine move, but ${esc(bestSan)} was a bit stronger.`; break;
    default: body = esc(explainBad(g, k).text); line = `<p class="line"><b>Best</b>${esc(pvSan(g.fens[k], a.lines[0].pv))}</p>`;
  }
  const good = !BAD.has(r.cls);
  const canRetry = BAD.has(r.cls) && mv.color === g.me;
  el.innerHTML = sampleNote + `<div class="head">${iconHTML(r.cls)}<h3 class="title">${esc(moveLabel(g, k))} ${CL[r.cls].verb}</h3><span class="ev">${esc(evalText(g, k + 1))}</span></div>
    ${good ? whatHTML : ''}<p class="body">${body}</p>${line}
    <div class="acts">${canRetry ? '<button class="btn" data-act="retry">Retry this move</button>' : ''}
    ${SEV[r.cls] >= 1 && r.cls !== 'book' ? `<button class="btn ghost" data-act="toggleBest">${showBest ? 'Hide' : 'Show'} best move</button>` : ''}
    ${nextMistake(ply) != null ? '<button class="btn ghost" data-act="nextMistake">Next mistake →</button>' : ''}</div>`;
  bindActs(el);
}
function practiceHTML() {
  const k = practice.k, c = g.moves[k].color, a = g.an[k];
  let fb = '';
  if (practice.result) fb = `<p class="body ${practice.result.ok ? 'fb-ok' : 'fb-no'}">${esc(practice.result.msg)}</p>`;
  if (practice.checking) fb = `<p class="body">Checking your move…</p>`;
  if (practice.reveal) fb += `<p class="line"><b>Answer</b>${esc(pvSan(g.fens[k], a.lines[0].pv))}</p><p class="body">${esc(explainBad(g, k).text)}</p>`;
  return `<div class="head"><span class="icon" style="background:var(--accent);color:var(--accent-ink)">↺</span><h3 class="title">Retry: find a better move for ${cName(c)}</h3></div>
    <p class="body">In the game you played <b>${esc(g.moves[k].san)}</b>. Tap a piece, then where it should go.</p>${fb}
    <div class="acts">${practice.reveal ? '' : '<button class="btn ghost" data-act="reveal">Show answer</button>'}<button class="btn ghost" data-act="exitPractice">Back to review</button>
    ${nextMistake(k + 1) != null ? '<button class="btn ghost" data-act="retryNext">Next mistake →</button>' : ''}</div>`;
}
function bindActs(el) { el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => ACT[b.dataset.act]())); }
function nextMistake(from) {
  for (let k = Math.max(0, from); k < g.moves.length; k++) { const r = g.res[k]; if (r && BAD.has(r.cls) && g.moves[k].color === g.me) return k; }
  return null;
}
const ACT = {
  next: () => go(1),
  nextMistake: () => { const k = nextMistake(ply); if (k != null) go(k + 1); },
  toggleBest: () => { showBest = !showBest; render(); },
  retry: () => startPractice(ply - 1),
  retryNext: () => { const k = nextMistake(practice.k + 1); if (k != null) startPractice(k); },
  reveal: () => { practice.reveal = true; practice.selected = null; practice.targets = null; render(); },
  exitPractice: () => { const k = practice.k; practice = null; ply = k + 1; render(); },
};
function startPractice(k) { practice = { k }; flipped = g.moves[k].color === 'b'; render(); }

function onBoardTap(nm) {
  if (!practice || practice.checking || practice.reveal) return;
  const m = BC.tapMove(practice, g.fens[practice.k], nm);
  if (m) { practice.result = null; tryMove(m); } else render();
}
async function tryMove(m) {
  const k = practice.k, c = g.moves[k].color, a = g.an[k], fen = g.fens[k];
  const uci = BC.moveUci(m);
  const ch = new Chess(fen); uciMove(ch, uci);
  const wb = forC(winOfScore(a.lines[0]), c);
  let ok, w;
  if (uci === a.lines[0].uci || ch.in_checkmate()) ok = true;
  else if (uci === g.moves[k].uci) ok = false;
  else {
    const known = a.lines.find(l => l.uci === uci);
    if (known) w = forC(winOfScore(known), c);
    else {
      practice.checking = true; render();
      try { await engine.start(); const lines = await engine.analyse(fen, { depth: 13, movetime: 1500, searchmoves: uci }); w = lines[0] ? forC(winOfScore(lines[0]), c) : 0; }
      catch (e) { practice.checking = false; practice.result = { ok: false, from: m.from, to: m.to, msg: 'The engine could not start, so this move could not be checked.' }; render(); return; }
      practice.checking = false;
    }
    ok = wb - w < 5;
  }
  if (!practice || practice.k !== k) return;
  practice.result = { ok, from: m.from, to: m.to, msg: ok
    ? (uci === a.lines[0].uci ? `Correct! ${m.san} is the best move.` : `Good find! ${m.san} works too. Stockfish's top pick was ${sanOf(fen, a.lines[0].uci)}.`)
    : (uci === g.moves[k].uci ? `That's the move from the game. Try something else.` : `${m.san} isn't it. Try again.`) };
  render();
}

function renderSummary() {
  const h = g.headers, el = $('summary');
  const accBox = c => {
    const name = c === 'w' ? (h.White || 'White') : (h.Black || 'Black');
    const v = g.acc && g.acc[c] != null ? g.acc[c].toFixed(1) : '…';
    return `<div class="accbox${c === g.me ? ' me' : ''}"><div class="who">${esc(name)}${c === g.me ? ' (you)' : ''}</div><div class="num">${v}</div><div class="lbl">Accuracy</div></div>`;
  };
  const counts = { w: {}, b: {} };
  g.res.forEach(r => { if (r) { const c = g.moves[r.k].color; counts[c][r.cls] = (counts[c][r.cls] || 0) + 1; } });
  const rows = CLASSES.filter(([id]) => id !== 'forced').map(([id, label]) => {
    const w = counts.w[id] || 0, b = counts.b[id] || 0;
    return `<tr><td class="n${w ? '' : ' zero'}">${w}</td><td><span class="lab">${iconHTML(id, true)}${label}</span></td><td class="n${b ? '' : ' zero'}">${b}</td></tr>`;
  }).join('');
  const result = h.Result && h.Result !== '*' ? h.Result : '';
  el.innerHTML = `<h2>Summary${result ? ` · ${esc(result)}` : ''}</h2><div class="accrow">${accBox('w')}${accBox('b')}</div>
    <table class="tally"><tbody>${rows}</tbody></table>
    ${g.opening ? `<p class="opening">Opening: ${esc(g.opening)}</p>` : ''}
    ${h.Termination ? `<p class="opening">${esc(h.Termination)}</p>` : ''}
    <div class="persp">I played <span class="seg" role="group" aria-label="Which side you played">
      <button data-me="w" aria-pressed="${g.me === 'w'}">White</button><button data-me="b" aria-pressed="${g.me === 'b'}">Black</button></span></div>`;
  el.querySelectorAll('[data-me]').forEach(b => b.addEventListener('click', () => { g.me = b.dataset.me; flipped = g.me === 'b'; practice = null; render(); saveCurrent(); }));
}
function renderChecklist() {
  const el = $('checklist'), items = openingChecklist(g);
  el.hidden = !items;
  if (!items) return;
  const bad = items.filter(i => !i.ok).length;
  el.innerHTML = `<h2>Opening checklist · ${items.length - bad} of ${items.length}</h2><ul class="check">${items.map(i =>
    `<li class="${i.ok ? 'ok' : 'no'}"><span class="mark" aria-label="${i.ok ? 'Good' : 'Needs work'}">${i.ok ? '✓' : '✕'}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>
    ${bad ? '<p class="opening"><a href="#lessons" data-lesson="principles">Review the opening principles</a> · <a href="#openings">Learn a repertoire</a></p>' : ''}`;
  const a = el.querySelector('[data-lesson]'); if (a) a.addEventListener('click', () => BC.emit('openLesson', 'principles'));
}
function renderMoves() {
  const el = $('moves'); let html = '';
  for (let k = 0; k < g.moves.length; k++) {
    const m = g.moves[k];
    if (m.color === 'w' || k === 0) html += `<div class="mrow"><span class="num">${m.num}.</span>` + (m.color === 'b' ? '<span></span>' : '');
    const r = g.res[k];
    html += `<button class="mv${ply === k + 1 ? ' cur' : ''}" data-ply="${k + 1}">${r ? iconHTML(r.cls, true) : ''}${esc(m.san)}</button>`;
    if (m.color === 'b' || k === g.moves.length - 1) html += '</div>';
  }
  el.innerHTML = html;
  el.querySelectorAll('.mv').forEach(b => b.addEventListener('click', () => go(+b.dataset.ply)));
  const cur = el.querySelector('.cur');
  if (cur) { const top = cur.offsetTop - el.offsetTop; if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 30) el.scrollTop = top - el.clientHeight / 2; }
}
function renderControls() {
  const N = g.moves.length, lock = !!practice;
  $('bStart').disabled = lock || ply === 0; $('bPrev').disabled = lock || ply === 0;
  $('bNext').disabled = lock || ply === N; $('bEnd').disabled = lock || ply === N;
}
function go(p) { if (practice) return; ply = clamp(p, 0, g.moves.length); render(); }
$('bStart').onclick = () => go(0); $('bPrev').onclick = () => go(ply - 1);
$('bNext').onclick = () => go(ply + 1); $('bEnd').onclick = () => go(g.moves.length);
$('bFlip').onclick = () => { flipped = !flipped; render(); };
$('graph').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); go(Math.round((e.clientX - r.left) / r.width * g.moves.length)); });
document.addEventListener('keydown', e => {
  if ($('view-review').hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const map = { ArrowLeft: ply - 1, ArrowRight: ply + 1, Home: 0, End: g.moves.length };
  if (e.key in map) { e.preventDefault(); go(map[e.key]); }
});

// ---------- review flow ----------
const DEPTH = { fast: { depth: 12, movetime: 600 }, std: { depth: 16, movetime: 2000 }, deep: { depth: 20, movetime: 5000 } };
function showErr(msg) { const e = $('err'); e.textContent = msg; e.hidden = !msg; }
// Analyse every position of a game. Background runs wait while a review you started is running.
async function analyseGame(game, cfg, { onStep, cancelled, background } = {}) {
  await engine.start();
  const N = game.fens.length;
  for (let i = 0; i < N; i++) {
    while (background && BC.fgBusy) await new Promise(r => setTimeout(r, 400));
    if (cancelled && cancelled()) return false;
    if (!game.an[i]) game.an[i] = game.info[i].over ? { lines: [], end: true } : { lines: await engine.analyse(game.fens[i], cfg), depth: cfg.depth };
    if (onStep) onStep(i + 1, N);
  }
  derive(game);
  return true;
}
async function review(opts) {
  const me = opts && opts.me;
  showErr('');
  const game = parseGame($('pgn').value);
  if (!game) { showErr("Couldn't read that game. Paste the full PGN: on chess.com open the game, then Share → PGN → Copy."); return; }
  BC.local.set('bc.username', $('username').value.trim());
  const cfg = DEPTH[$('depth').value] || DEPTH.std;
  const my = ++runId;
  setGame(game, { me });
  const prog = $('progress'); prog.hidden = false; $('pbar').style.width = '0%';
  $('ptxt').textContent = 'Starting Stockfish… (the first time takes a few seconds)';
  $('reviewBtn').disabled = true;
  BC.fgBusy = true;
  try {
    const done = await analyseGame(game, cfg, {
      cancelled: () => my !== runId || g !== game,
      onStep: (i, N) => {
        $('pbar').style.width = (i / N * 100).toFixed(1) + '%';
        $('ptxt').textContent = `Analyzing position ${i} of ${N}`;
        derive(game); render();
      },
    });
    if (!done) return;
    $('ptxt').textContent = 'Review complete.';
    await saveCurrent();
  } catch (e) {
    showErr('Stockfish could not start in this browser. Try another browser such as Chrome, Edge, Firefox or Safari.');
    prog.hidden = true;
  } finally {
    BC.fgBusy = false;
    if (my === runId) $('reviewBtn').disabled = false;
  }
}
$('reviewBtn').addEventListener('click', review);

async function saveCurrent() {
  if (!g || isSample || !g.an.every(Boolean)) return;
  const h = g.headers;
  await BC.sync.saveReview({ pgn: g.pgn, an: g.an, me: g.me, white: h.White || 'White', black: h.Black || 'Black',
    result: h.Result || '', date: h.Date || '', savedAt: Date.now() });
  if (BC.stats) { const { summary, mistakes } = summarize(g); BC.stats.add(summary, mistakes); }
  renderHistory();
}

// ---------- game summaries (for Insights and the daily trainer) ----------
function timeClass(h) {
  const tc = h.TimeControl || '';
  if (tc.includes('/')) return 'daily';
  const [b, inc] = tc.split('+').map(Number);
  if (!isFinite(b) || !b) return 'unknown';
  const est = b + 40 * (inc || 0);
  return est < 180 ? 'bullet' : est < 600 ? 'blitz' : 'rapid';
}
function howEnded(h) {
  const t = (h.Termination || '').toLowerCase();
  for (const [re, how] of [[/checkmate/, 'checkmate'], [/resign/, 'resignation'], [/abandon/, 'abandoned'], [/stalemate/, 'stalemate'],
    [/repetition/, 'repetition'], [/agreement/, 'agreement'], [/insufficient/, 'insufficient'], [/50/, 'fifty'], [/time/, 'time']]) if (re.test(t)) return how;
  return 'other';
}
function clocks(pgn) { const out = [], re = /\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]/g; let m; while ((m = re.exec(pgn))) out.push(+m[1] * 3600 + +m[2] * 60 + +m[3]); return out; }
function gameTime(h) {
  const d = (h.UTCDate || h.Date || '').replace(/\./g, '-'), t = (h.UTCTime || h.EndTime || '12:00:00').slice(0, 8);
  const ms = Date.parse(`${d}T${t}Z`);
  return isFinite(ms) ? ms : Date.now();
}
const isEndgame = fen => parseFen(fen).filter(p => p && p.t !== 'p' && p.t !== 'k').length <= 6;
const family = name => (name || '').replace(/^[A-E]\d\d\s+/, '').split(':')[0].trim() || null;
function summarize(game, meta = {}) {
  const h = game.headers, c = game.me, R = h.Result;
  const result = R === '1/2-1/2' ? 'draw' : R === '1-0' || R === '0-1' ? ((R === '1-0') === (c === 'w') ? 'win' : 'loss') : 'unknown';
  const elo = k => { const v = parseInt(h[k], 10); return isFinite(v) ? v : null; };
  const clk = clocks(game.pgn), haveClk = clk.length === game.moves.length;
  const tcRaw = h.TimeControl || '', base = !tcRaw.includes('/') && parseInt(tcRaw, 10) > 0 ? parseInt(tcRaw, 10) : null;
  const counts = {}, tags = {}, phase = { opening: 0, middle: 0, end: 0 }, mistakes = [];
  let lowTime = 0, severe = 0, clockedSevere = 0;
  const id = meta.url || h.Link || 'g' + BC.fnv(game.pgn);
  game.res.forEach(r => {
    if (!r) return;
    const m = game.moves[r.k];
    if (m.color !== c) return;
    counts[r.cls] = (counts[r.cls] || 0) + 1;
    if (!SEVERE.has(r.cls)) return;
    severe++;
    const ex = explainBad(game, r.k);
    tags[ex.tag] = (tags[ex.tag] || 0) + 1;
    if (haveClk && base) { clockedSevere++; const before = r.k >= 2 ? clk[r.k - 2] : base; if (before < Math.max(30, base * 0.1)) lowTime++; }
    phase[m.num <= 12 ? 'opening' : isEndgame(game.fens[r.k]) ? 'end' : 'middle']++;
    const best = game.an[r.k].lines[0];
    if (best) mistakes.push({ id: 'm' + BC.fnv(game.fens[r.k]), fen: game.fens[r.k], best: best.uci, played: m.uci, playedSan: m.san, cls: r.cls,
      label: `vs ${c === 'w' ? (h.Black || 'Black') : (h.White || 'White')}, move ${m.num}`, explain: ex.text, last: r.k > 0 ? game.moves[r.k - 1].uci : null,
      winBest: forC(winOfScore(best), c), gameId: id });
  });
  const summary = {
    id, url: meta.url || h.Link || null, date: meta.date || gameTime(h), tc: meta.tc || timeClass(h), color: c, result, how: howEnded(h),
    opp: c === 'w' ? (h.Black || 'Black') : (h.White || 'White'), myRating: elo(c === 'w' ? 'WhiteElo' : 'BlackElo'), oppRating: elo(c === 'w' ? 'BlackElo' : 'WhiteElo'),
    opening: family(game.opening), acc: game.acc && game.acc[c] != null ? Math.round(game.acc[c] * 10) / 10 : null,
    moves: Math.ceil(game.moves.length / 2), counts, tags, severe, lowTime, clockedSevere, phase,
  };
  return { summary, mistakes };
}
async function renderHistory() {
  const list = await BC.sync.listReviews();
  $('historyCard').hidden = !list.length;
  $('historyWhere').textContent = BC.sync.account ? 'saved to your account' : 'saved in this browser';
  $('history').innerHTML = list.slice(0, 12).map((x, i) => `<li><button data-i="${i}">${esc(x.white)} vs ${esc(x.black)} <span>${esc(x.result)} · ${esc((x.date || '').replace(/\./g, '-'))}</span></button></li>`).join('');
  $('history').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    const x = list[+b.dataset.i]; if (!x) return;
    const game = parseGame(x.pgn); if (!game) return;
    runId++; $('progress').hidden = true; $('reviewBtn').disabled = false;
    game.an = x.an; game.me = x.me; g = game; isSample = false; practice = null; ply = 0; flipped = g.me === 'b';
    derive(g); render(); $('pgn').value = x.pgn; window.scrollTo({ top: 0, behavior: 'smooth' });
  }));
}

// ---------- legend match (just for fun) ----------
const LEG = window.BC_LEGENDS || { legends: [], courses: [] };
const DIMS = [['attack', 'Attack', 'lots of captures, checks and pieces aimed at the king'], ['trade', 'Trades', 'trading pieces to keep things simple'],
  ['tempo', 'Development', 'quick development'], ['safety', 'King safety', 'keeping the king safe']];
function styleOf(g) {
  const c = g.me, mine = [];
  g.moves.forEach((m, k) => { if (m.color === c) mine.push(m); });
  if (mine.length < 8) return null;
  const n = mine.length, caps = mine.filter(m => m.captured).length, checks = mine.filter(m => m.san.includes('+')).length;
  const trades = mine.filter(m => m.captured && m.piece !== 'p' && VAL[m.captured] === VAL[m.piece]).length;
  const home = c === 'w' ? '1' : '8';
  const dev = Math.min(4, new Set(mine.filter(m => m.num <= 10 && (m.piece === 'n' || m.piece === 'b') && m.from[1] === home).map(m => m.from)).size);
  const castle = mine.find(m => m.san.startsWith('O-O'));
  const pushes = mine.filter(m => m.piece === 'p' && 'fgh'.includes(m.from[0]) && m.num <= 15 && !m.captured).length;
  return {
    attack: clamp(((caps + checks) / n - 0.12) / 0.3, 0, 1),
    trade: clamp(trades / Math.max(1, caps) * 1.5, 0, 1),
    tempo: clamp(0.7 * dev / 4 + (castle && castle.num <= 10 ? 0.3 : 0), 0, 1),
    safety: clamp((castle ? (castle.num <= 12 ? 0.9 : 0.6) : 0.2) - 0.1 * Math.min(pushes, 3), 0, 1),
  };
}
function legendsForOpening(g) {
  const c = g.me, ucis = g.moves.map(m => m.uci);
  return LEG.legends.filter(l => (c === 'w' ? l.white : l.black).some(line => {
    let k = 0; while (k < line.length && k < ucis.length && line[k] === ucis[k]) k++;
    return k >= Math.min(6, line.length, ucis.length) && k >= 3;
  }));
}
function renderLegendMatch() {
  const el = $('legendMatch'), you = g.std ? styleOf(g) : null;
  el.hidden = !you || !LEG.legends.length;
  if (el.hidden) return;
  const ranked = LEG.legends.map(l => ({ l, d: Math.hypot(...DIMS.map(([k]) => you[k] - l.vec[k])) })).sort((a, b) => a.d - b.d);
  const best = ranked[0].l;
  const top = DIMS.slice().sort((a, b) => you[b[0]] - you[a[0]])[0];
  const fans = legendsForOpening(g);
  const bar = v => `<span class="sbar"><i style="width:${Math.round(v * 100)}%"></i></span>`;
  el.innerHTML = `<h2>Legend match · just for fun</h2>
    <p class="body">Your play this game was closest to <b>${esc(best.name)}</b>: ${esc(top[2])}.</p>
    <table class="tally styles"><thead><tr><td></td><td class="n">You</td><td class="n">${esc(best.name.split(' ').pop())}</td></tr></thead><tbody>
    ${DIMS.map(([k, lab]) => `<tr><td>${lab}</td><td>${bar(you[k])}</td><td>${bar(best.vec[k])}</td></tr>`).join('')}</tbody></table>
    <p class="opening">${fans.length ? `Your opening is in the repertoire of ${fans.map(l => esc(l.name)).join(', ')}.` : 'None of the legends here played your opening.'}</p>
    <div class="acts"><a class="btn ghost" href="#legends" data-legend="${best.id}">Play the ${esc(best.name.split(' ').pop())} bot</a></div>
    <p class="opening">Based on simple counts of your captures, checks, trades, development and castling. It's not a rating.</p>`;
  el.querySelector('[data-legend]').addEventListener('click', e => BC.emit('playLegend', e.currentTarget.dataset.legend));
}

// Your mistakes from saved reviews, for the Lessons tab.
BC.review = {
  parseGame, derive, analyseGame, summarize, family, DEPTH, TAG_LABEL, TAG_LESSON,
  reviewPgn(pgn, me) { $('pgn').value = pgn; window.scrollTo({ top: 0, behavior: 'smooth' }); return review({ me }); },
  // Open a game that was already reviewed (instant), or review it now.
  async openOrReview(pgn, me) {
    const parsed = parseGame(pgn);
    if (!parsed) return this.reviewPgn(pgn, me);
    const x = (await BC.sync.listReviews()).find(r => r.pgn === parsed.pgn && r.an && r.an.length === parsed.fens.length);
    if (!x) return this.reviewPgn(pgn, me);
    runId++; $('progress').hidden = true; $('reviewBtn').disabled = false; showErr('');
    parsed.an = x.an; parsed.me = me || x.me; g = parsed; isSample = false; practice = null; ply = 0; flipped = g.me === 'b';
    derive(g); render(); $('pgn').value = parsed.pgn; window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  async myMistakes() {
    const out = [];
    for (const x of await BC.sync.listReviews()) {
      const game = parseGame(x.pgn); if (!game || !x.an || x.an.length !== game.fens.length) continue;
      game.an = x.an; game.me = x.me; derive(game);
      game.res.forEach(r => {
        if (!r || !SEVERE.has(r.cls) || game.moves[r.k].color !== game.me) return;
        const best = game.an[r.k].lines[0]; if (!best) return;
        out.push({ id: 'm' + BC.fnv(game.fens[r.k]), fen: game.fens[r.k], best: best.uci, played: game.moves[r.k].uci,
          playedSan: game.moves[r.k].san, cls: r.cls, label: `${x.white} vs ${x.black}, move ${game.moves[r.k].num}`,
          explain: explainBad(game, r.k).text, last: r.k > 0 ? game.moves[r.k - 1].uci : null, winBest: forC(winOfScore(best), game.me) });
      });
    }
    return out;
  },
};

BC.on('engine', name => { $('engineName').textContent = `Engine: ${name}, running in your browser. Nothing is uploaded.`; });
BC.on('sync', () => { renderHistory(); });

// ---------- boot ----------
$('username').value = BC.local.get('bc.username', '');
const sample = parseGame(D.sample.pgn);
sample.an = D.sample.analysis;
setGame(sample, { sample: true });
renderHistory();
window.BCdebug = { get game() { return g; } };
})();
