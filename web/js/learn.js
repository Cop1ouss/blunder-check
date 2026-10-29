// Openings and Lessons tabs: a repertoire trainer with spaced repetition,
// principle lessons, tactics puzzles, checkmate drills against Stockfish,
// and puzzles made from your own reviewed mistakes.
(() => {
'use strict';
const { $, esc, VAL, PNAME, sqName, sqIdx, cName, parseFen, attacksFrom, attackers, pieceList,
  uciMove, sanOf, moveUci, forC, winOfScore, engine, sync } = BC;
const C = window.BC_CONTENT;
const LEG = window.BC_LEGENDS || { courses: [], legends: [] };
const COURSES = C.courses.concat(LEG.courses);
const legendName = id => (LEG.legends.find(l => l.id === id) || {}).name || id;
const DAY = 86400000, INTERVAL = [0, 1, 3, 7, 14, 30];
const now = () => Date.now();
const fensOf = line => { const ch = new Chess(), out = [ch.fen()]; for (const m of line.moves) { uciMove(ch, m.uci); out.push(ch.fen()); } return out; };
const sideName = s => (s === 'w' ? 'White' : 'Black');
const turnOf = fen => fen.split(' ')[1];
const bind = (el, acts) => el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => acts[b.dataset.act](b.dataset)));

// =====================================================================
// Openings
// =====================================================================
const ov = new BC.BoardView(document.querySelector('#view-openings .boardbox'), tapOpening);
const O = { course: null, line: null, mode: 'learn', idx: 0, fens: [], sel: {}, wrong: 0, mistakes: 0, note: null, fb: null, hint: false, done: false, queue: [], timer: null };
const lineRec = id => sync.progress.openings[id] || { lv: 0, due: 0, n: 0 };
const isDue = id => { const r = lineRec(id); return r.lv > 0 && r.due <= now(); };
function courseStats(c) {
  let learned = 0, due = 0, mastered = 0;
  for (const l of c.lines) { const r = lineRec(l.id); if (r.lv > 0) learned++; if (isDue(l.id)) due++; if (r.lv >= 4) mastered++; }
  return { learned, due, mastered, total: c.lines.length };
}
function chip(id) {
  const r = lineRec(id);
  if (!r.lv) return '<span class="chip new">New</span>';
  if (isDue(id)) return '<span class="chip due">Due</span>';
  const days = Math.max(1, Math.round((r.due - now()) / DAY));
  return `<span class="chip ok">${r.lv >= 4 ? 'Mastered' : 'Learning'} · in ${days}d</span>`;
}

function renderOpenings() {
  clearTimeout(O.timer);
  $('view-openings').classList.toggle('noboard', !O.line);
  if (!O.line) return renderOpeningsHome();
  const course = O.course, line = O.line, fen = O.fens[O.idx];
  const myTurn = !O.done && turnOf(fen) === course.side && O.idx < line.moves.length;
  const expected = myTurn ? line.moves[O.idx] : null;
  const marks = [];
  if (O.idx > 0) { const m = line.moves[O.idx - 1]; marks.push({ sq: m.uci.slice(0, 2), color: 'var(--accent)', pct: 30 }, { sq: m.uci.slice(2, 4), color: 'var(--accent)', pct: 45 }); }
  if (O.fb && !O.fb.ok) marks.push({ sq: O.fb.from, color: 'var(--c-miss)', pct: 45 }, { sq: O.fb.to, color: 'var(--c-miss)', pct: 45 });
  const arrows = expected && (O.mode === 'learn' || O.hint) ? [{ uci: expected.uci, color: 'var(--c-best)' }] : [];
  ov.render({ fen, flipped: course.side === 'b', marks, arrows, selected: O.sel.selected, targets: O.sel.targets, interactive: myTurn });
  $('oCaption').textContent = `You play ${sideName(course.side)} · ${course.title}`;

  const mineTotal = line.moves.filter((_, i) => (i % 2 === 0) === (course.side === 'w')).length;
  const mineDone = line.moves.slice(0, O.idx).filter((_, i) => (i % 2 === 0) === (course.side === 'w')).length;
  let moveList = '';
  line.moves.slice(0, O.idx).forEach((m, i) => { moveList += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + esc(m.san) + ' '; });
  const note = O.note ? `<div class="note"><span class="who">${O.note.mine ? 'You' : sideName(O.note.color)} · ${esc(O.note.san)}</span>${O.note.text ? `<p>${esc(O.note.text)}</p>` : ''}</div>` : '';
  let prompt = '';
  if (O.done) {
    const r = lineRec(line.id);
    prompt = `<p class="body fb-ok">Line complete${O.mode === 'practice' ? (O.mistakes ? ` with ${O.mistakes} slip${O.mistakes > 1 ? 's' : ''}` : ' with no mistakes') : ''}! Next review in ${INTERVAL[r.lv] || 1} day${(INTERVAL[r.lv] || 1) > 1 ? 's' : ''}.</p>`;
  } else if (myTurn) {
    prompt = O.mode === 'learn' || O.hint
      ? `<p class="body"><b>Your move:</b> play ${esc(expected.san)} (follow the arrow).</p>`
      : `<p class="body"><b>Your move.</b> What comes next in this line?</p>`;
  } else prompt = `<p class="body muted">${sideName(turnOf(fen))} is thinking…</p>`;
  const fb = O.fb ? `<p class="body ${O.fb.ok ? 'fb-ok' : 'fb-no'}">${esc(O.fb.msg)}</p>` : '';
  const next = nextLine(O.course, O.line);
  $('oPanel').innerHTML = `<h2>${esc(course.title)} · ${O.mode === 'learn' ? 'Learn' : 'Practice'}</h2>
    <h3 class="title">${esc(line.name)}</h3>
    <div class="meter" aria-label="Your moves played"><i style="width:${mineTotal ? mineDone / mineTotal * 100 : 0}%"></i></div>
    <p class="opening">Your moves: ${mineDone} of ${mineTotal}</p>
    ${note}${prompt}${fb}
    ${moveList ? `<p class="line">${moveList.trim()}</p>` : ''}
    <div class="acts">
      ${O.done ? (next ? `<button class="btn" data-act="next">${next.label}</button>` : '') + '<button class="btn ghost" data-act="again">Practice it again</button>'
        : (O.mode === 'practice' && myTurn && !O.hint ? '<button class="btn ghost" data-act="hint">Hint</button>' : '') + '<button class="btn ghost" data-act="restart">Restart line</button>'}
      <button class="btn ghost" data-act="home">All openings</button>
    </div>`;
  bind($('oPanel'), {
    hint: () => { O.hint = true; renderOpenings(); },
    restart: () => startLine(O.course, O.line, O.mode, O.queue),
    again: () => startLine(O.course, O.line, 'practice', O.queue),
    next: () => { const n = nextLine(O.course, O.line); if (n) startLine(n.course, n.line, n.mode, O.queue.filter(x => x !== n.line.id)); },
    home: () => { O.line = null; renderOpenings(); },
  });
  if (!O.done && !myTurn) O.timer = setTimeout(playOpponent, O.idx === 0 ? 350 : 650);
}
function nextLine(course, current) {
  for (const id of O.queue) {
    for (const c of COURSES) { const l = c.lines.find(x => x.id === id); if (l && l !== current) return { course: c, line: l, mode: 'practice', label: 'Next due line' }; }
  }
  const due = course.lines.find(l => l !== current && isDue(l.id));
  if (due) return { course, line: due, mode: 'practice', label: 'Practice next due line' };
  const fresh = course.lines.find(l => l !== current && !lineRec(l.id).lv);
  if (fresh) return { course, line: fresh, mode: 'learn', label: 'Learn the next line' };
  return null;
}
function renderOpeningsHome() {
  ov.render({ fen: BC.START, flipped: false });
  $('oCaption').textContent = 'Pick an opening to learn';
  const totalDue = COURSES.reduce((s, c) => s + courseStats(c).due, 0);
  $('oPanel').innerHTML = `<h2>Openings</h2>
    <p class="body">Learn a small repertoire by playing it. The trainer plays the other side; you play yours. Each line comes back for practice after 1, 3, 7, 14 and 30 days.</p>
    <p class="body muted">Suggested starter set: <b>Italian Game</b> as White, <b>1...e5</b> against 1.e4 and <b>1...d5</b> against 1.d4.</p>
    ${totalDue ? `<div class="acts"><button class="btn" data-act="allDue">Practice all due lines (${totalDue})</button></div>` : ''}
    ${[['Starter repertoire', C.courses], ["Legends' repertoires", LEG.courses]].map(([head, list]) => `<div class="lessongroup"><h3>${head}</h3></div>
    <div class="courses">${list.map(c => {
      const s = courseStats(c);
      const fresh = c.lines.find(l => !lineRec(l.id).lv);
      return `<article class="course">
        <div class="chead"><h3>${esc(c.title)}</h3><span class="chip side ${c.side}">You play ${sideName(c.side)}</span></div>
        ${c.legends ? `<p class="opening">Played by ${c.legends.map(legendName).map(esc).join(' and ')}</p>` : ''}
        <p class="blurb">${esc(c.blurb)}</p>
        <div class="meter"><i style="width:${s.learned / s.total * 100}%"></i></div>
        <p class="opening">${s.learned} of ${s.total} lines learned${s.due ? ` · <b>${s.due} due</b>` : ''}</p>
        <div class="acts">${fresh ? `<button class="btn" data-act="learn" data-c="${c.id}" data-l="${fresh.id}">Learn: ${esc(fresh.name)}</button>` : ''}
          ${s.due ? `<button class="btn ghost" data-act="due" data-c="${c.id}">Practice due (${s.due})</button>` : ''}</div>
        <details><summary>All ${s.total} lines</summary><ul class="lines">${c.lines.map(l =>
          `<li><button data-act="${lineRec(l.id).lv ? 'practice' : 'learn'}" data-c="${c.id}" data-l="${l.id}"><span>${esc(l.name)}</span>${chip(l.id)}</button></li>`).join('')}</ul></details>
      </article>`;
    }).join('')}</div>`).join('')}`;
  const find = d => { const c = COURSES.find(x => x.id === d.c); return { c, l: c && c.lines.find(x => x.id === d.l) }; };
  bind($('oPanel'), {
    learn: d => { const { c, l } = find(d); startLine(c, l, 'learn', []); },
    practice: d => { const { c, l } = find(d); startLine(c, l, 'practice', []); },
    due: d => { const c = COURSES.find(x => x.id === d.c); const ids = c.lines.filter(l => isDue(l.id)).map(l => l.id); startLine(c, c.lines.find(l => l.id === ids[0]), 'practice', ids.slice(1)); },
    allDue: () => {
      const ids = []; COURSES.forEach(c => c.lines.forEach(l => { if (isDue(l.id)) ids.push(l.id); }));
      const c = COURSES.find(x => x.lines.some(l => l.id === ids[0]));
      startLine(c, c.lines.find(l => l.id === ids[0]), 'practice', ids.slice(1));
    },
  });
}
function startLine(course, line, mode, queue) {
  Object.assign(O, { course, line, mode, queue: queue || [], idx: 0, fens: fensOf(line), sel: {}, wrong: 0, mistakes: 0, note: null, fb: null, hint: false, done: false });
  renderOpenings();
  document.querySelector('#view-openings .boardcol').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function playOpponent() {
  if (!O.line || O.done) return;
  const m = O.line.moves[O.idx];
  O.note = { mine: false, color: turnOf(O.fens[O.idx]), san: m.san, text: m.note };
  O.idx++; O.fb = null;
  if (O.idx >= O.line.moves.length) return finishLine();
  renderOpenings();
}
function tapOpening(nm) {
  if (!O.line || O.done) return;
  const fen = O.fens[O.idx];
  if (turnOf(fen) !== O.course.side) return;
  const m = BC.tapMove(O.sel, fen, nm);
  if (!m) return renderOpenings();
  const want = O.line.moves[O.idx];
  if (moveUci(m) === want.uci || (m.from + m.to) === want.uci.slice(0, 4)) {
    O.note = { mine: true, color: O.course.side, san: want.san, text: want.note };
    O.idx++; O.wrong = 0; O.hint = false;
    O.fb = { ok: true, msg: 'Correct!' };
    if (O.idx >= O.line.moves.length) return finishLine();
  } else {
    O.wrong++;
    if (O.mode === 'practice') { O.mistakes++; if (O.wrong >= 2) O.hint = true; }
    O.fb = { ok: false, from: m.from, to: m.to, msg: `${m.san} isn't the move in this line.${O.mode === 'practice' && O.wrong >= 2 ? ' The arrow shows it.' : ' Try again.'}` };
  }
  renderOpenings();
}
function finishLine() {
  const r = { ...lineRec(O.line.id) };
  if (O.mode === 'learn') { r.lv = Math.max(r.lv, 1); }
  else if (O.mistakes === 0) r.lv = Math.min(5, Math.max(1, r.lv + 1));
  else r.lv = Math.max(1, r.lv - 1);
  r.due = now() + INTERVAL[r.lv] * DAY - 3600000; r.n = (r.n || 0) + 1;
  sync.progress.openings[O.line.id] = r;
  sync.saveProgress();
  O.done = true;
  renderOpenings();
}

// =====================================================================
// Lessons
// =====================================================================
const lv = new BC.BoardView(document.querySelector('#view-lessons .boardbox'), tapLesson);
const MINE = { id: 'mine', cat: 'Your games', title: 'Your own mistakes',
  body: ['Positions from games you reviewed, where you made a mistake or blunder. Find the move you missed. This is the fastest way to stop repeating the same errors.'] };
const L = { lesson: null, puzzles: [], pi: 0, sel: {}, stage: 'solve', fen: null, tries: 0, fb: null, reveal: false, hint: false, solvedNow: false, drill: null, checking: false, mine: null };
const PROMPT = {
  free: 'One of their pieces is unprotected. Win it.',
  fork: 'Find a move that attacks two things at once.',
  save: 'One of your pieces is in danger. Save it.',
  mate1: 'Checkmate in one move.',
  backrank: 'Checkmate on the back rank.',
  mate2: 'Checkmate in two moves.',
};
const lessonRec = id => sync.progress.lessons[id] || { solved: {}, done: false };
function lessonStatus(l) {
  const r = lessonRec(l.id);
  if (l.drill) return r.done ? '<span class="chip ok">Done</span>' : '<span class="chip new">Drill</span>';
  const n = (l.puzzles || []).length, s = (l.puzzles || []).filter(p => r.solved[p.id]).length;
  return s >= n && n ? '<span class="chip ok">Done</span>' : `<span class="chip ${s ? 'due' : 'new'}">${s}/${n}</span>`;
}
async function loadMine() { try { L.mine = await BC.review.myMistakes(); } catch (e) { L.mine = []; } if (!L.lesson) renderLessons(); }

function renderLessons() {
  $('view-lessons').classList.toggle('noboard', !L.lesson);
  if (!L.lesson) return renderLessonsHome();
  const l = L.lesson;
  const body = l.body.map(t => t.startsWith('- ') ? null : `<p class="body">${esc(t)}</p>`);
  let html = '', inList = false;
  l.body.forEach((t, i) => {
    if (t.startsWith('- ')) { if (!inList) { html += '<ul class="rules">'; inList = true; } html += `<li>${esc(t.slice(2))}</li>`; }
    else { if (inList) { html += '</ul>'; inList = false; } html += body[i]; }
  });
  if (inList) html += '</ul>';
  const task = l.drill ? drillHTML() : puzzleHTML();
  $('lPanel').innerHTML = `<h2>${esc(l.cat)}</h2><h3 class="title">${esc(l.title)}</h3>
    <details class="lessonbody" ${L.pi === 0 && !L.drill?.started ? 'open' : ''}><summary>Lesson</summary>${html}</details>
    ${task}`;
  bind($('lPanel'), LACT);
  renderLessonBoard();
}
function renderLessonsHome() {
  lv.render({ fen: BC.START, flipped: false });
  $('lCaption').textContent = 'Pick a lesson';
  const cats = [];
  C.lessons.forEach(l => { if (!cats.includes(l.cat)) cats.push(l.cat); });
  const mineCount = L.mine ? L.mine.length : null;
  const mineRec = lessonRec('mine');
  const mineSolved = L.mine ? L.mine.filter(p => mineRec.solved[p.id]).length : 0;
  $('lPanel').innerHTML = `<h2>Lessons</h2>
    <p class="body">Short lessons on the ideas that matter most below 400, each with positions to solve. Work through them in order, a little every day.</p>
    <div class="lessongroup"><h3>Your games</h3><ul class="lines">
      <li><button data-act="open" data-id="mine" ${mineCount ? '' : 'disabled'}><span>Your own mistakes</span>${mineCount == null ? '<span class="chip new">…</span>'
        : mineCount ? `<span class="chip ${mineSolved >= mineCount ? 'ok' : 'due'}">${mineSolved}/${mineCount}</span>` : '<span class="chip new">Review a game first</span>'}</button></li></ul></div>
    ${cats.map(cat => `<div class="lessongroup"><h3>${esc(cat)}</h3><ul class="lines">${C.lessons.filter(l => l.cat === cat).map(l =>
      `<li><button data-act="open" data-id="${l.id}"><span>${esc(l.title)}</span>${lessonStatus(l)}</button></li>`).join('')}</ul></div>`).join('')}`;
  bind($('lPanel'), { open: d => openLesson(d.id) });
}
function openLesson(id) {
  let l = C.lessons.find(x => x.id === id), puzzles;
  if (id === 'mine') {
    l = MINE;
    const rec = lessonRec('mine');
    puzzles = (L.mine || []).slice().sort((a, b) => (rec.solved[a.id] ? 1 : 0) - (rec.solved[b.id] ? 1 : 0)).slice(0, 20).map(p => ({ ...p, theme: 'mine' }));
  } else if (!l) return;
  else puzzles = l.puzzles || [];
  const rec = lessonRec(l.id);
  const first = Math.max(0, puzzles.findIndex(p => !rec.solved[p.id]));
  Object.assign(L, { lesson: l, puzzles, pi: first, drill: l.drill ? newDrill(l.drill) : null });
  resetPuzzle();
  renderLessons();
}
function resetPuzzle() {
  const p = L.puzzles[L.pi];
  Object.assign(L, { sel: {}, stage: 'solve', fen: p ? p.fen : null, tries: 0, fb: null, reveal: false, hint: false, solvedNow: false, played: [] });
}
function current() { return L.puzzles[L.pi]; }

function puzzleHTML() {
  const p = current();
  if (!p) return '<p class="body">No positions here yet.</p><div class="acts"><button class="btn ghost" data-act="home">All lessons</button></div>';
  const side = cName(turnOf(p.fen));
  const prompt = p.theme === 'principle' ? p.prompt : p.theme === 'mine' ? `In your game (${p.label}) you played ${p.playedSan}. Find a better move.` : PROMPT[p.theme];
  let fb = L.fb ? `<p class="body ${L.fb.ok ? 'fb-ok' : 'fb-no'}">${esc(L.fb.msg)}</p>` : '';
  if (L.checking) fb = '<p class="body muted">Checking your move…</p>';
  const done = L.solvedNow || L.reveal;
  const explain = done ? `<p class="body">${esc(explanation(p))}</p>` : '';
  const last = L.pi >= L.puzzles.length - 1;
  return `<div class="puzhead"><span class="chip side ${turnOf(p.fen)}">${side} to move</span><span class="opening">Position ${L.pi + 1} of ${L.puzzles.length}</span></div>
    <p class="body"><b>${esc(prompt)}</b></p>${fb}${explain}
    <div class="acts">
      ${done ? `<button class="btn" data-act="${last ? 'home' : 'nextP'}">${last ? 'Finish lesson' : 'Next position'}</button>`
        : `${L.hint ? '' : '<button class="btn ghost" data-act="hint">Hint</button>'}<button class="btn ghost" data-act="reveal">Show answer</button>`}
      ${!done && L.played.length ? '<button class="btn ghost" data-act="retryP">Start over</button>' : ''}
      <button class="btn ghost" data-act="home">All lessons</button>
    </div>`;
}
function explanation(p) {
  const fen = p.fen, san = sanOf(fen, p.best);
  if (p.theme === 'principle') return p.explain;
  if (p.theme === 'mine') return `${p.explain} The best move was ${san}.`;
  const a = parseFen(fen), from = sqIdx(p.best.slice(0, 2)), to = sqIdx(p.best.slice(2, 4));
  if (p.theme === 'free') {
    const v = a[to], att = a[from], defended = attackers(a, to, v.c).length > 0;
    return `${san} wins the ${PNAME[v.t]} on ${sqName(to)}. ${defended ? `It's worth more than your ${PNAME[att.t]}, so the trade is good for you.` : 'Nothing was defending it.'}`;
  }
  if (p.theme === 'fork') {
    const ch = new Chess(fen); uciMove(ch, p.best);
    const b = parseFen(ch.fen()), mover = b[to];
    const hits = attacksFrom(b, to).filter(s => b[s] && b[s].c !== mover.c && b[s].t !== 'p' && (b[s].t === 'k' || VAL[b[s].t] > VAL[mover.t] || !attackers(b, s, b[s].c).length));
    return `${san} attacks the ${pieceList(b, hits)} at the same time. They can only save one.`;
  }
  if (p.theme === 'save') return `${san} saves your ${PNAME[a[from].t]}, which was under attack on ${sqName(from)}.`;
  if (p.theme === 'mate1') return `${san} is checkmate.`;
  if (p.theme === 'backrank') return `${san} is checkmate. The king is trapped behind its own pawns.`;
  if (p.theme === 'mate2') return `Checkmate in two, starting with ${san}. Forcing moves (checks) first: they leave the opponent no time.`;
  return san;
}

function renderLessonBoard() {
  if (L.drill) {
    const d = L.drill;
    const marks = d.last ? [{ sq: d.last.slice(0, 2), color: 'var(--accent)', pct: 30 }, { sq: d.last.slice(2, 4), color: 'var(--accent)', pct: 45 }] : [];
    lv.render({ fen: d.ch.fen(), flipped: false, marks, selected: L.sel.selected, targets: L.sel.targets, interactive: d.status === 'play' && !d.thinking });
    $('lCaption').textContent = 'You play White · checkmate the black king';
    return;
  }
  const p = current();
  if (!p) { lv.render({ fen: BC.START }); return; }
  const marks = [];
  const lastMove = L.played.length ? L.played[L.played.length - 1] : p.last;
  if (lastMove) marks.push({ sq: lastMove.slice(0, 2), color: 'var(--accent)', pct: 30 }, { sq: lastMove.slice(2, 4), color: 'var(--accent)', pct: 45 });
  if (L.fb && !L.fb.ok && L.fb.from) marks.push({ sq: L.fb.from, color: 'var(--c-miss)', pct: 45 }, { sq: L.fb.to, color: 'var(--c-miss)', pct: 45 });
  if (L.hint && !L.reveal && L.stage === 'solve') marks.push({ sq: p.best.slice(0, 2), color: 'var(--c-great)', pct: 60 });
  const arrows = L.reveal ? [{ uci: p.best, color: 'var(--c-best)' }] : [];
  const fen = L.reveal ? p.fen : L.fen;
  lv.render({ fen, flipped: turnOf(p.fen) === 'b', marks, arrows, selected: L.sel.selected, targets: L.sel.targets, interactive: !L.solvedNow && !L.reveal && L.stage !== 'reply' && !L.checking });
  $('lCaption').textContent = `${cName(turnOf(p.fen))} to move`;
}

function markSolved(id) {
  const rec = { solved: { ...lessonRec(L.lesson.id).solved }, done: lessonRec(L.lesson.id).done };
  rec.solved[id] = 1;
  if (L.lesson.id !== 'mine' && L.puzzles.every(p => rec.solved[p.id])) rec.done = true;
  sync.progress.lessons[L.lesson.id] = rec;
  sync.saveProgress();
}
async function tapLesson(nm) {
  if (!L.lesson) return;
  if (L.drill) return tapDrill(nm);
  const p = current();
  if (!p || L.solvedNow || L.reveal || L.stage === 'reply' || L.checking) return;
  const m = BC.tapMove(L.sel, L.fen, nm);
  if (!m) return renderLessonBoard();
  const uci = moveUci(m);
  const ch = new Chess(L.fen); uciMove(ch, uci);
  let ok;
  if (p.theme === 'mate2' && L.stage === 'solve2') ok = ch.in_checkmate();
  else if (p.theme === 'mine') ok = await checkMine(p, uci);
  else ok = p.accept.includes(uci) || (p.theme.startsWith('mate') || p.theme === 'backrank' ? ch.in_checkmate() : false);
  if (!ok) {
    L.tries++;
    if (L.tries >= 2) L.hint = true;
    L.fb = { ok: false, from: m.from, to: m.to, msg: `${m.san} isn't it.${p.theme === 'mate2' && L.stage === 'solve2' ? ' That is not checkmate.' : ''} Try again.${L.tries >= 2 ? ' The highlighted piece is the one to move.' : ''}` };
    return renderLessons();
  }
  L.played.push(uci); L.fen = ch.fen();
  if (p.theme === 'mate2' && L.stage === 'solve') {
    L.stage = 'reply'; L.fb = { ok: true, msg: `${m.san}! Now finish it.` };
    renderLessons();
    setTimeout(() => {
      const reply = p.replies[uci];
      const c2 = new Chess(L.fen); if (reply) uciMove(c2, reply);
      L.played.push(reply); L.fen = c2.fen(); L.stage = 'solve2'; L.tries = 0; L.hint = false;
      renderLessons();
    }, 600);
    return;
  }
  L.solvedNow = true;
  L.fb = { ok: true, msg: p.theme === 'mine' && uci !== p.best ? `Good find! ${m.san} works too.` : `Correct! ${m.san}${ch.in_checkmate() ? ' is checkmate' : ''}.` };
  markSolved(p.id);
  renderLessons();
}
async function checkMine(p, uci) {
  if (uci === p.best) return true;
  if (uci === p.played) return false;
  L.checking = true; renderLessons();
  try {
    await engine.start();
    const lines = await engine.analyse(p.fen, { depth: 13, movetime: 1500, searchmoves: uci });
    const c = turnOf(p.fen);
    return lines[0] ? p.winBest - forC(winOfScore(lines[0]), c) < 5 : false;
  } catch (e) { return false; } finally { L.checking = false; }
}

// ---------- checkmate drills against Stockfish ----------
function newDrill(spec) { return { spec, ch: new Chess(spec.fen), count: 0, status: 'play', msg: '', thinking: false, last: null, started: false }; }
function drillHTML() {
  const d = L.drill;
  const status = d.status === 'won' ? `<p class="body fb-ok">${esc(d.msg)}</p>` : d.status === 'lost' ? `<p class="body fb-no">${esc(d.msg)}</p>`
    : d.thinking ? '<p class="body muted">Black is thinking…</p>' : `<p class="body"><b>Your move.</b> Checkmate the king within ${d.spec.limit} moves. Stockfish defends.</p>`;
  return `<div class="puzhead"><span class="chip side w">White to move</span><span class="opening">Move ${d.count} of ${d.spec.limit}</span></div>
    ${d.msg && d.status === 'play' ? `<p class="body fb-no">${esc(d.msg)}</p>` : ''}${status}
    <div class="acts"><button class="btn${d.status === 'play' ? ' ghost' : ''}" data-act="restartDrill">${d.status === 'play' ? 'Restart' : 'Try again'}</button><button class="btn ghost" data-act="home">All lessons</button></div>`;
}
async function tapDrill(nm) {
  const d = L.drill;
  if (d.status !== 'play' || d.thinking) return;
  const m = BC.tapMove(L.sel, d.ch.fen(), nm);
  if (!m) return renderLessonBoard();
  d.ch.move({ from: m.from, to: m.to, promotion: 'q' }); d.count++; d.last = m.from + m.to; d.started = true; d.msg = '';
  if (endDrill(d, true)) return renderLessons();
  d.thinking = true; renderLessons();
  try {
    await engine.start();
    const lines = await engine.analyse(d.ch.fen(), { depth: 10, movetime: 300 });
    if (L.drill !== d) return;
    const r = lines[0] && BC.uciMove(d.ch, lines[0].uci);
    if (r) d.last = r.from + r.to;
  } catch (e) { d.status = 'lost'; d.msg = 'Stockfish could not start in this browser, so it cannot defend.'; }
  d.thinking = false;
  endDrill(d, false);
  renderLessons();
}
function endDrill(d, afterMine) {
  const ch = d.ch;
  if (ch.in_checkmate()) { d.status = 'won'; d.msg = `Checkmate in ${d.count} moves! Well done.`; markDrill(); return true; }
  if (ch.in_stalemate()) { d.status = 'lost'; d.msg = 'Stalemate: the king has no moves but is not in check, so it is a draw. Always leave the king one square until you can give mate.'; return true; }
  if (ch.insufficient_material()) { d.status = 'lost'; d.msg = 'The king took your piece. Keep your pieces protected or far away from the king.'; return true; }
  if (ch.in_draw()) { d.status = 'lost'; d.msg = 'That is a draw (repetition or the 50-move rule). Try a more direct plan.'; return true; }
  if (afterMine && d.count >= d.spec.limit) { d.status = 'lost'; d.msg = `Out of moves. You need to mate within ${d.spec.limit}. Re-read the plan above and try again.`; return true; }
  return false;
}
function markDrill() { const rec = lessonRec(L.lesson.id); sync.progress.lessons[L.lesson.id] = { solved: rec.solved, done: true }; sync.saveProgress(); }

const LACT = {
  home: () => { L.lesson = null; L.drill = null; renderLessons(); },
  nextP: () => { L.pi = Math.min(L.puzzles.length - 1, L.pi + 1); resetPuzzle(); renderLessons(); },
  retryP: () => { resetPuzzle(); renderLessons(); },
  hint: () => { L.hint = true; renderLessons(); },
  reveal: () => { L.reveal = true; L.sel = {}; renderLessons(); },
  restartDrill: () => { L.drill = newDrill(L.lesson.drill); L.drill.started = true; L.sel = {}; renderLessons(); },
};

// ---------- wiring ----------
BC.on('openCourse', id => {
  const c = COURSES.find(x => x.id === id); if (!c) return;
  const l = c.lines.find(x => !lineRec(x.id).lv) || c.lines[0];
  startLine(c, l, lineRec(l.id).lv ? 'practice' : 'learn', []);
});
BC.on('openLesson', id => { if (id === 'mine' && !L.mine) loadMine(); openLesson(id); });
BC.on('view', name => {
  if (name === 'openings') renderOpenings();
  if (name === 'lessons') { if (!L.mine) loadMine(); renderLessons(); }
});
BC.on('sync', () => { L.mine = null; if (!$('view-openings').hidden) renderOpenings(); if (!$('view-lessons').hidden) { loadMine(); renderLessons(); } });
BC.learn = { get openings() { return O; }, get lessons() { return L; } };
})();
