// Shared pieces for every tab: helpers, a tiny board model for tactics checks,
// the Stockfish worker, the board view, tap-to-move input, and saved progress.
(() => {
'use strict';
const BC = window.BC = {};
const D = window.BC_DATA;

BC.$ = id => document.getElementById(id);
BC.esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
BC.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
BC.local = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};

// ---------- tiny board model ----------
const VAL = BC.VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
BC.PNAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const sqName = BC.sqName = i => 'abcdefgh'[i & 7] + ((i >> 3) + 1);
const sqIdx = BC.sqIdx = s => (s.charCodeAt(1) - 49) * 8 + (s.charCodeAt(0) - 97);
const opp = BC.opp = c => (c === 'w' ? 'b' : 'w');
BC.cName = c => (c === 'w' ? 'White' : 'Black');
BC.parseFen = fen => {
  const a = new Array(64).fill(null);
  fen.split(' ')[0].split('/').forEach((row, ri) => {
    let f = 0; const r = 7 - ri;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') f += +ch;
      else { a[r * 8 + f] = { t: ch.toLowerCase(), c: ch === ch.toUpperCase() ? 'w' : 'b' }; f++; }
    }
  });
  return a;
};
const attacksFrom = BC.attacksFrom = (a, i) => {
  const p = a[i]; if (!p) return [];
  const f = i & 7, r = i >> 3, out = [];
  const add = (df, dr) => { const nf = f + df, nr = r + dr; if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) out.push(nr * 8 + nf); };
  const ray = (df, dr) => { let nf = f + df, nr = r + dr; while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) { const j = nr * 8 + nf; out.push(j); if (a[j]) break; nf += df; nr += dr; } };
  const D8 = [[1, 1], [1, -1], [-1, 1], [-1, -1]], O4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  switch (p.t) {
    case 'p': { const d = p.c === 'w' ? 1 : -1; add(-1, d); add(1, d); break; }
    case 'n': [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(([x, y]) => add(x, y)); break;
    case 'k': for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) if (x || y) add(x, y); break;
    case 'b': D8.forEach(([x, y]) => ray(x, y)); break;
    case 'r': O4.forEach(([x, y]) => ray(x, y)); break;
    case 'q': D8.concat(O4).forEach(([x, y]) => ray(x, y)); break;
  }
  return out;
};
const attackers = BC.attackers = (a, sq, color) => {
  const out = [];
  for (let i = 0; i < 64; i++) { const p = a[i]; if (p && p.c === color && i !== sq && attacksFrom(a, i).includes(sq)) out.push(i); }
  return out;
};
// Does capturing on `to` from `from` win material outright?
BC.isFreeCapture = (fen, from, to) => {
  const a = BC.parseFen(fen), victim = a[sqIdx(to)], attacker = a[sqIdx(from)];
  if (!victim || !attacker) return false;
  return attackers(a, sqIdx(to), victim.c).length === 0 || VAL[victim.t] > VAL[attacker.t];
};
// Is the piece on `sq` attacked and either unprotected or attacked by something cheaper?
BC.inDanger = (a, sq) => {
  const p = a[sq]; if (!p) return false;
  const en = attackers(a, sq, opp(p.c)); if (!en.length) return false;
  if (!attackers(a, sq, p.c).length) return true;
  return Math.min(...en.map(i => (a[i].t === 'k' ? 100 : VAL[a[i].t]))) < VAL[p.t];
};
BC.pieceList = (a, sqs) => sqs.map(s => `${BC.PNAME[a[s].t]} on ${sqName(s)}`).join(' and ');

// ---------- chess helpers ----------
BC.fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
BC.posKey = fen => BC.fnv(fen.split(' ').slice(0, 3).join(' '));
BC.START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
BC.uciMove = (chess, u) => chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
BC.sanOf = (fen, u) => { const m = BC.uciMove(new Chess(fen), u); return m ? m.san : u; };
BC.moveUci = m => m.from + m.to + (m.promotion || '');
BC.pvSan = (fen, pv, max = 6) => {
  const ch = new Chess(fen); const parts = fen.split(' ');
  let num = +parts[5] || 1, turn = parts[1]; const out = [];
  const ms = pv.split(' ').slice(0, max);
  for (let i = 0; i < ms.length; i++) {
    const m = BC.uciMove(ch, ms[i]); if (!m) break;
    if (turn === 'w') out.push(num + '. ' + m.san);
    else { out.push((i === 0 ? num + '… ' : '') + m.san); num++; }
    turn = opp(turn);
  }
  return out.join(' ');
};
BC.forC = (w, c) => (c === 'w' ? w : 100 - w);
BC.winOfScore = s => (s.mate != null ? (s.mate > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * BC.clamp(s.cp, -1000, 1000))) - 1));

// ---------- engine ----------
class Engine {
  constructor() { this.w = null; this.name = ''; this.queue = Promise.resolve(); this.listeners = new Set(); this.ready = null; }
  start() { if (!this.ready) this.ready = this._start().catch(e => { this.ready = null; throw e; }); return this.ready; }
  async _start() {
    const tries = [['engine/stockfish-17.1-lite-single-03e3232.js', 'Stockfish 17.1 (lite)'], ['engine/stockfish-10-asm.js', 'Stockfish 10 (compatibility mode, slower)']];
    if (window.BC_FORCE_ASM) tries.shift();
    for (const [url, name] of tries) {
      try { await this._boot(url); this.name = name; BC.emit('engine', name); return name; }
      catch (e) { console.warn('engine failed to start', url, e); if (this.w) this.w.terminate(); this.w = null; this.listeners.clear(); }
    }
    throw new Error('No engine could start in this browser.');
  }
  _boot(url) {
    return new Promise((resolve, reject) => {
      const w = new Worker(url); this.w = w;
      const timer = setTimeout(() => reject(new Error('timeout')), 45000);
      w.onerror = e => { clearTimeout(timer); if (e.preventDefault) e.preventDefault(); reject(new Error(e.message || 'worker error')); };
      w.onmessage = e => {
        const line = String(e.data);
        this.listeners.forEach(fn => fn(line));
        if (line === 'uciok') {
          clearTimeout(timer);
          this.send('setoption name Hash value 32'); this.send('setoption name MultiPV value 2');
          this._wait('readyok').then(() => resolve());
          this.send('isready');
        }
      };
      w.postMessage('uci');
    });
  }
  send(cmd) { this.w.postMessage(cmd); }
  _wait(tok) { return new Promise(res => { const fn = l => { if (l.startsWith(tok)) { this.listeners.delete(fn); res(l); } }; this.listeners.add(fn); }); }
  // Lines come back from White's point of view: [{uci, pv, cp|mate}], best first.
  analyse(fen, { depth, movetime, searchmoves, multipv }) {
    const run = () => new Promise(resolve => {
      const got = {};
      const fn = l => {
        if (l.startsWith('info ') && l.includes(' pv ') && !/bound/.test(l)) {
          const m = /\bmultipv (\d+)\b.*?\bscore (cp|mate) (-?\d+)\b.*?\bpv (.+)$/.exec(l);
          if (m) got[m[1]] = { kind: m[2], v: +m[3], pv: m[4].trim().split(/\s+/) };
          else { const s = /\bscore (cp|mate) (-?\d+)\b.*?\bpv (.+)$/.exec(l); if (s) got[1] = { kind: s[1], v: +s[2], pv: s[3].trim().split(/\s+/) }; }
        } else if (l.startsWith('bestmove')) {
          this.listeners.delete(fn);
          if (multipv && multipv !== 2) this.send('setoption name MultiPV value 2');
          const sign = fen.split(' ')[1] === 'w' ? 1 : -1;
          const lines = Object.keys(got).sort().map(k => {
            const x = got[k], o = { uci: x.pv[0], pv: x.pv.slice(0, 10).join(' ') };
            o[x.kind] = sign * x.v; return o;
          });
          if (!lines.length) { const bm = l.split(' ')[1]; if (bm && bm !== '(none)') lines.push({ uci: bm, pv: bm, cp: 0 }); }
          resolve(lines);
        }
      };
      this.listeners.add(fn);
      if (multipv && multipv !== 2) this.send('setoption name MultiPV value ' + multipv);
      this.send('position fen ' + fen);
      this.send(`go depth ${depth} movetime ${movetime}` + (searchmoves ? ' searchmoves ' + searchmoves : ''));
    });
    const p = this.queue.then(run); this.queue = p.catch(() => {}); return p;
  }
}
BC.engine = new Engine();

// ---------- tiny event bus ----------
const subs = {};
BC.on = (name, fn) => { (subs[name] = subs[name] || []).push(fn); };
BC.emit = (name, data) => (subs[name] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

// ---------- board view ----------
const PIECES = D.pieces;
BC.arrowSVG = (u, color, flipped) => {
  const pt = s => { const i = sqIdx(s), f = i & 7, r = i >> 3; return [(flipped ? 7 - f : f) + 0.5, (flipped ? r : 7 - r) + 0.5]; };
  const [x1, y1] = pt(u.slice(0, 2)), [x2, y2] = pt(u.slice(2, 4));
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const hx = x2 - ux * 0.38, hy = y2 - uy * 0.38, px = -uy * 0.24, py = ux * 0.24;
  return `<g opacity=".85"><line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="${color}" stroke-width=".17" stroke-linecap="round"/>` +
    `<polygon points="${x2 - ux * 0.08},${y2 - uy * 0.08} ${hx + px},${hy + py} ${hx - px},${hy - py}" fill="${color}"/></g>`;
};
class BoardView {
  // `box` is a .boardbox holding a .board grid and an svg.arrows overlay.
  constructor(box, onTap) {
    this.board = box.querySelector('.board'); this.svg = box.querySelector('.arrows');
    this.board.addEventListener('click', e => { const sq = e.target.closest('.sq'); if (sq && onTap) onTap(sq.dataset.sq); });
  }
  // marks: [{sq, color, pct}], badge: {sq, color, sym}, arrows: [{uci, color}]
  render({ fen, flipped = false, marks = [], selected = null, targets = null, badge = null, arrows = [], interactive = false }) {
    const a = BC.parseFen(fen);
    let html = '';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const r = flipped ? row : 7 - row, f = flipped ? 7 - col : col, i = r * 8 + f, nm = sqName(i);
      let inner = '';
      for (const m of marks) if (m.sq === nm) inner += `<div class="hl" style="background:color-mix(in srgb, ${m.color} ${m.pct || 45}%, transparent)"></div>`;
      if (selected === nm) inner += `<div class="hl" style="background:color-mix(in srgb, var(--accent) 45%, transparent)"></div>`;
      const p = a[i];
      if (p) inner += `<img alt="${BC.cName(p.c)} ${BC.PNAME[p.t]}" src="${PIECES[p.c + p.t.toUpperCase()]}">`;
      if (targets && targets.includes(nm)) inner += p ? '<div class="ring"></div>' : '<div class="dotm"></div>';
      if (col === 0) inner += `<span class="coord r">${r + 1}</span>`;
      if (row === 7) inner += `<span class="coord f">${'abcdefgh'[f]}</span>`;
      if (badge && badge.sq === nm) inner += `<span class="badge" style="background:${badge.color}">${badge.sym}</span>`;
      html += `<div class="sq ${(r + f) % 2 ? 'l' : 'd'}" data-sq="${nm}">${inner}</div>`;
    }
    this.board.innerHTML = html;
    this.board.classList.toggle('practice', interactive);
    this.svg.innerHTML = arrows.map(x => BC.arrowSVG(x.uci, x.color, flipped)).join('');
  }
}
BC.BoardView = BoardView;

// Tap a piece, then a square. Returns the chess.js move once one is made.
BC.tapMove = (st, fen, nm) => {
  const ch = new Chess(fen);
  if (st.selected && st.targets && st.targets.includes(nm)) {
    const m = ch.move({ from: st.selected, to: nm, promotion: 'q' });
    st.selected = null; st.targets = null;
    return m;
  }
  const p = ch.get(nm);
  if (p && p.color === ch.turn()) { st.selected = nm; st.targets = ch.moves({ square: nm, verbose: true }).map(m => m.to); }
  else { st.selected = null; st.targets = null; }
  return null;
};

// ---------- saved progress and reviews ----------
// Signed in on claude.ai: a private per-person store that follows you across
// devices. Anywhere else (a local copy): this browser's storage.
const MAX_REVIEWS = 30;
const Sync = BC.sync = {
  db: null, uid: null,
  progress: { openings: {}, lessons: {}, legends: { results: {}, guess: {} } },
  chain: Promise.resolve(), timer: null,
  get account() { return !!this.db; },
  async init() {
    const p = BC.local.get('bc.progress', null);
    if (p) this.progress = { openings: p.openings || {}, lessons: p.lessons || {}, legends: { results: {}, guess: {}, ...(p.legends || {}) } };
    if (!window.claude || typeof window.claude.use !== 'function') return;
    try {
      const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      this.db = db; this.uid = uid;
      const snap = await this.progRef().get();
      const remote = snap.exists ? snap.data() : null;
      if (remote) this.progress = merge(remote, this.progress);
      if (!remote || JSON.stringify(this.progress) !== JSON.stringify(remote)) this.queueSave(0);
      await this.uploadLocalReviews();
    } catch (e) { console.warn('account storage unavailable', e); this.db = null; }
    BC.emit('sync');
  },
  progRef() { return this.db.doc(`data/users/${this.uid}/progress`); },
  reviewsCol() { return this.db.doc(`data/users/${this.uid}/profile`).collection('reviews'); },
  saveProgress() { BC.local.set('bc.progress', this.progress); if (this.db) this.queueSave(800); },
  queueSave(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const body = JSON.parse(JSON.stringify(this.progress));
      this.chain = this.chain.then(() => this.progRef().set(body)).catch(e => console.warn('progress save failed', e));
    }, delay);
  },
  async listReviews() {
    if (this.db) {
      try {
        const snap = await this.reviewsCol().orderBy('savedAt', 'desc').limit(MAX_REVIEWS).get();
        return snap.docs.map(d => d.data());
      } catch (e) { console.warn('could not load reviews', e); }
    }
    return BC.local.get('bc.history', []);
  },
  async saveReview(r) {
    const list = BC.local.get('bc.history', []).filter(x => x.pgn !== r.pgn);
    list.unshift(r);
    while (list.length > 12) list.pop();
    while (list.length && !BC.local.set('bc.history', list)) list.pop();
    if (!this.db) return;
    try {
      const body = JSON.parse(JSON.stringify(r));
      if (JSON.stringify(body).length > 250000) return;
      await this.reviewsCol().doc('r' + BC.fnv(r.pgn)).set(body);
      const all = await this.reviewsCol().orderBy('savedAt', 'desc').get();
      for (const d of all.docs.slice(MAX_REVIEWS)) await this.reviewsCol().doc(d.id).delete();
    } catch (e) { console.warn('review save failed', e); }
  },
  async uploadLocalReviews() {
    const local = BC.local.get('bc.history', []);
    if (!local.length || BC.local.get('bc.uploaded', false)) return;
    for (const r of local.slice().reverse()) {
      try { await this.reviewsCol().doc('r' + BC.fnv(r.pgn)).set(JSON.parse(JSON.stringify({ ...r, savedAt: r.savedAt || Date.now() }))); }
      catch (e) { console.warn('upload failed', e); return; }
    }
    BC.local.set('bc.uploaded', true);
  },
};
function merge(remote, local) {
  const rl = remote.legends || {}, ll = local.legends || {};
  const out = { openings: { ...(remote.openings || {}) }, lessons: { ...(remote.lessons || {}) },
    legends: { results: { ...(ll.results || {}), ...(rl.results || {}) }, guess: { ...(rl.guess || {}) } } };
  for (const [id, v] of Object.entries(ll.guess || {})) out.legends.guess[id] = Math.max(v, out.legends.guess[id] || 0);
  for (const [id, v] of Object.entries(local.openings || {})) {
    const r = out.openings[id];
    if (!r || (v.n || 0) > (r.n || 0)) out.openings[id] = v;
  }
  for (const [id, v] of Object.entries(local.lessons || {})) {
    const r = out.lessons[id] || { solved: {} };
    out.lessons[id] = { solved: { ...(r.solved || {}), ...(v.solved || {}) }, done: !!(r.done || v.done) };
  }
  return out;
}

// ---------- views ----------
const VIEWS = ['review', 'openings', 'lessons', 'legends'];
BC.showView = name => {
  if (!VIEWS.includes(name)) name = 'review';
  VIEWS.forEach(v => { BC.$('view-' + v).hidden = v !== name; });
  document.querySelectorAll('.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.view === name ? 'page' : 'false'));
  BC.emit('view', name);
};
window.addEventListener('hashchange', () => BC.showView(location.hash.slice(1)));
BC.currentView = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'review');
})();
