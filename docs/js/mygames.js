// Your games: import finished games from chess.com's free public API,
// auto-review them in the background, and keep the per-game summaries and
// the daily-trainer positions that Insights and Lessons use.
(() => {
'use strict';
const { $, esc } = BC;
const API = 'https://api.chess.com/pub/player/';
const MAX_GAMES = 200, MAX_SUMMARIES = 300, MAX_ITEMS = 400;
const DAY = 86400000, INTERVALS = [1, 2, 4, 8, 16, 32];
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA');

// =====================================================================
// Stored stats: game summaries and the daily trainer
// =====================================================================
const stats = BC.stats = {
  summaries() { return BC.local.get('bc.summaries', {}); },
  has(id) { return !!this.summaries()[id]; },
  add(summary, mistakes = []) {
    const all = this.summaries();
    all[summary.id] = summary;
    const ids = Object.keys(all).sort((a, b) => all[b].date - all[a].date);
    ids.slice(MAX_SUMMARIES).forEach(id => delete all[id]);
    BC.local.set('bc.summaries', all);
    this.addMistakes(mistakes);
    BC.emit('stats');
  },
  trainer() {
    const t = BC.local.get('bc.trainer', null) || {};
    return { items: t.items || {}, days: t.days || {} };
  },
  saveTrainer(t) {
    const ids = Object.keys(t.items);
    if (ids.length > MAX_ITEMS) {
      // Drop the best-learned, then the oldest, positions first.
      ids.sort((a, b) => (t.items[b].lv - t.items[a].lv) || (t.items[a].added - t.items[b].added))
        .slice(0, ids.length - MAX_ITEMS).forEach(id => delete t.items[id]);
    }
    BC.local.set('bc.trainer', t);
  },
  addMistakes(list) {
    if (!list.length) return;
    const t = this.trainer(), now = Date.now();
    for (const m of list) if (!t.items[m.id]) t.items[m.id] = { ...m, lv: 0, due: now, added: now, n: 0 };
    this.saveTrainer(t);
  },
  due(limit = 10) {
    const now = Date.now();
    return Object.values(this.trainer().items).filter(i => i.due <= now).sort((a, b) => a.due - b.due || b.added - a.added).slice(0, limit);
  },
  counts() {
    const items = Object.values(this.trainer().items), now = Date.now();
    return { total: items.length, due: items.filter(i => i.due <= now).length, learned: items.filter(i => i.lv >= 3).length };
  },
  // outcome: 'good' (first try), 'ok' (after a wrong try or a hint), 'fail' (shown the answer)
  record(id, outcome) {
    const t = this.trainer(), it = t.items[id];
    if (!it) return;
    it.lv = outcome === 'good' ? Math.min(5, it.lv + 1) : outcome === 'ok' ? Math.min(it.lv, 1) : 0;
    it.due = Date.now() + INTERVALS[it.lv] * DAY - 3600000;
    it.n = (it.n || 0) + 1;
    const k = dayKey();
    t.days[k] = (t.days[k] || 0) + 1;
    this.saveTrainer(t);
    if (BC.activity) BC.activity.bump('trainer');
    BC.emit('trainer');
  },
  streak() {
    const days = this.trainer().days;
    let n = 0, t = Date.now();
    if (!days[dayKey(t)]) t -= DAY; // today doesn't break the streak until it's over
    while (days[dayKey(t)]) { n++; t -= DAY; }
    return { days: n, today: days[dayKey()] || 0 };
  },
};

// =====================================================================
// chess.com import
// =====================================================================
const CC = { busy: false, error: '', showAll: false, auto: null };
const ccStore = () => BC.local.get('bc.ccgames', { user: '', games: [], archives: [], next: -1, fetchedAt: 0 });
const ccSave = d => { while (d.games.length && !BC.local.set('bc.ccgames', d)) d.games.pop(); };
const inClaudePage = () => !!(window.claude && typeof window.claude.use === 'function');

async function getJSON(url) {
  let res;
  try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch (e) {
    if (!navigator.onLine) throw new Error("You're offline. Connect to the internet to load games.");
    if (inClaudePage()) throw new Error("This version can't reach chess.com. Open your installed Blunder Check app (the GitHub one) to load games.");
    throw new Error("Couldn't reach chess.com. Check your connection and try again.");
  }
  if (res.status === 404) throw Object.assign(new Error('not found'), { code: 404 });
  if (res.status === 429) throw new Error('chess.com asked us to slow down. Try again in a minute.');
  if (!res.ok) throw new Error(`chess.com didn't answer (error ${res.status}). Try again later.`);
  return res.json();
}
const slim = (gm, user) => {
  const me = gm.white.username.toLowerCase() === user ? 'w' : 'b';
  return { url: gm.url, pgn: gm.pgn, end: (gm.end_time || 0) * 1000, tc: gm.time_class, rated: gm.rated, me,
    white: { u: gm.white.username, r: gm.white.rating, res: gm.white.result }, black: { u: gm.black.username, r: gm.black.rating, res: gm.black.result } };
};
// Only standard chess from the monthly archives: these contain finished games only.
const usable = gm => gm.rules === 'chess' && gm.pgn && !/\[SetUp "1"\]/.test(gm.pgn);

async function loadGames({ user, older = false, quick = false } = {}) {
  if (CC.busy) return;
  const d = ccStore();
  user = (user || d.user || '').trim().toLowerCase();
  if (!user) return;
  CC.busy = true; CC.error = ''; renderCC();
  try {
    if (user !== d.user || !older) {
      const { archives } = await getJSON(API + encodeURIComponent(user) + '/games/archives');
      if (user !== d.user) Object.assign(d, { user, games: [] });
      d.archives = archives || [];
      d.next = d.archives.length - 1;
      const seen = new Set(d.games.map(x => x.url));
      let added = 0;
      // Newest month first; keep going back until there are enough games.
      // Newest month first; a quick sync checks the last two months, a full load keeps going until there are enough games.
      const months = quick && d.games.length ? 2 : 3;
      while (d.next >= 0 && (quick || added < 25 || d.next >= d.archives.length - 1)) {
        const { games } = await getJSON(d.archives[d.next]);
        d.next--;
        for (const gm of (games || []).filter(usable)) if (!seen.has(gm.url)) { d.games.push(slim(gm, user)); seen.add(gm.url); added++; }
        if (d.archives.length - 1 - d.next >= months) break;
      }
      CC.lastAdded = added;
    } else if (d.next >= 0) {
      const { games } = await getJSON(d.archives[d.next]);
      d.next--;
      const seen = new Set(d.games.map(x => x.url));
      for (const gm of (games || []).filter(usable)) if (!seen.has(gm.url)) d.games.push(slim(gm, user));
    }
    d.games.sort((a, b) => b.end - a.end);
    d.games = d.games.slice(0, MAX_GAMES);
    d.fetchedAt = Date.now();
    BC.local.set('bc.username', user);
    if ($('username') && !$('username').value) $('username').value = user;
    ccSave(d);
    BC.emit('ccgames');
  } catch (e) {
    CC.error = e.code === 404 ? `No chess.com player called "${user}". Check the spelling.` : e.message;
  } finally {
    CC.busy = false; renderCC();
  }
}

// =====================================================================
// Auto-review
// =====================================================================
async function autoReview(n = 10, { quiet = false } = {}) {
  if (CC.auto) return;
  const d = ccStore();
  const todo = d.games.filter(x => !stats.has(x.url)).slice(0, n);
  if (!todo.length) { if (!quiet) { CC.error = ''; CC.autoDone = 'All your loaded games are already reviewed.'; renderCC(); } return; }
  CC.auto = { i: 0, n: todo.length, stop: false, pos: 0, of: 1 }; CC.autoDone = ''; renderCC();
  const cfg = BC.review.DEPTH.fast;
  let done = 0;
  try {
    for (const x of todo) {
      if (CC.auto.stop) break;
      CC.auto.i++; CC.auto.label = `vs ${x.me === 'w' ? x.black.u : x.white.u}`; renderCC();
      const game = BC.review.parseGame(x.pgn);
      if (!game) continue;
      game.me = x.me;
      const ok = await BC.review.analyseGame(game, cfg, {
        background: true, cancelled: () => CC.auto.stop,
        onStep: (i, N) => { CC.auto.pos = i; CC.auto.of = N; renderAutoProgress(); },
      });
      if (!ok) break;
      const { summary, mistakes } = BC.review.summarize(game, { url: x.url, date: x.end, tc: x.tc });
      stats.add(summary, mistakes);
      done++;
    }
    CC.autoDone = done ? `Reviewed ${done} game${done > 1 ? 's' : ''}. Your mistakes are in Daily training, and Progress is updated.` : '';
  } catch (e) {
    CC.error = 'Stockfish could not start in this browser, so the games could not be reviewed.';
  } finally {
    CC.auto = null; renderCC();
  }
}

// =====================================================================
// The "Your chess.com games" card on the Review tab
// =====================================================================
const RES = { win: ['W', 'Won'], loss: ['L', 'Lost'], draw: ['D', 'Drew'] };
const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const resultOf = x => { const r = (x.me === 'w' ? x.white : x.black).res; return r === 'win' ? 'win' : DRAWS.has(r) ? 'draw' : 'loss'; };
const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const TC = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', daily: 'Daily' };
BC.cc = { store: ccStore, resultOf, load: loadGames, autoReview, TC };

function renderAutoProgress() {
  const a = CC.auto, el = $('ccAuto');
  if (!a || !el) return;
  el.querySelector('i').style.width = `${((a.i - 1) + a.pos / a.of) / a.n * 100}%`;
  el.querySelector('p').textContent = `Reviewing game ${a.i} of ${a.n} (${a.label})${BC.fgBusy ? ', paused while your review runs' : ''}…`;
}
function renderCC() {
  const el = $('ccCard'); if (!el) return;
  const d = ccStore(), all = stats.summaries();
  const err = CC.error ? `<p class="err">${esc(CC.error)}</p>` : '';
  if (!d.user) {
    el.innerHTML = `<h2>Your chess.com games</h2>
      <p class="body">Enter your chess.com username to load your finished games. No more copying PGNs.</p>
      <form class="row ccform" id="ccForm"><label for="ccUser">chess.com username<input id="ccUser" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <button class="btn" ${CC.busy ? 'disabled' : ''}>${CC.busy ? 'Loading…' : 'Load my games'}</button></form>${err}
      <p class="opening">Uses chess.com's free public data. Only finished games are loaded.</p>`;
    $('ccForm').addEventListener('submit', async e => {
      e.preventDefault();
      await loadGames({ user: $('ccUser').value });
      const now = ccStore();
      if (now.user && !CC.error) { syncStats(now.user); if (syncOn()) autoReview(5, { quiet: true }); }
    });
    return;
  }
  const list = d.games.slice(0, CC.showAll ? 60 : 6);
  const unreviewed = d.games.filter(x => !all[x.url]).length;
  const rows = list.map(x => {
    const r = resultOf(x), opp = x.me === 'w' ? x.black : x.white, s = all[x.url];
    return `<li><button data-url="${esc(x.url)}"><span class="res ${r}" aria-label="${RES[r][1]}">${RES[r][0]}</span>
      <span class="who">vs ${esc(opp.u)} <span class="muted">(${opp.r})</span><span class="sub">${TC[x.tc] || esc(x.tc)} · ${fmtDate(x.end)} · you played ${x.me === 'w' ? 'White' : 'Black'}</span></span>
      ${s && s.acc != null ? `<span class="chip ok">${s.acc.toFixed(0)}%</span>` : '<span class="chip new">Review</span>'}</button></li>`;
  }).join('');
  const auto = CC.auto ? `<div class="progress" id="ccAuto"><div class="bar"><i></i></div><p></p></div>` : '';
  el.innerHTML = `<h2>Your chess.com games</h2>
    <p class="opening"><b>${esc(d.user)}</b> · ${d.games.length} finished games loaded${d.fetchedAt ? ` · updated ${ago(d.fetchedAt)}` : ''}</p>
    <p class="opening syncline">${syncOn() ? `<b>Auto-sync on.</b> New games load and get reviewed when you open the app.${CC.syncNote ? ` ${esc(CC.syncNote)}` : ''}` : 'Auto-sync is off.'}
      <button class="linkbtn" data-act="toggleSync">${syncOn() ? 'Turn off' : 'Turn on'}</button></p>
    ${d.games.length ? `<ul class="lines ccgames">${rows}</ul>` : `<p class="body">No finished games found yet.</p>`}
    <div class="acts">
      ${d.games.length > 6 ? `<button class="btn ghost" data-act="more">${CC.showAll ? 'Show fewer' : `Show more (${Math.min(60, d.games.length)})`}</button>` : ''}
      ${d.next >= 0 ? `<button class="btn ghost" data-act="older" ${CC.busy ? 'disabled' : ''}>Load older games</button>` : ''}
      <button class="btn ghost" data-act="refresh" ${CC.busy ? 'disabled' : ''}>${CC.busy ? 'Loading…' : 'Refresh'}</button>
      <button class="btn ghost" data-act="change">Change username</button>
    </div>
    <div class="autobox">
      ${CC.auto ? `${auto}<button class="btn ghost" data-act="stopAuto">Stop</button>`
        : `<p class="body">${unreviewed ? `<b>${unreviewed}</b> game${unreviewed > 1 ? 's' : ''} not reviewed yet.` : 'All loaded games are reviewed.'} Auto-review fills Insights and Daily training. Keep the app open while it runs.</p>
           ${unreviewed ? `<button class="btn" data-act="auto">Auto-review my last ${Math.min(10, unreviewed)} games</button>` : ''}`}
      ${CC.autoDone ? `<p class="body fb-ok">${esc(CC.autoDone)} <a href="#insights">See Progress</a></p>` : ''}
    </div>${err}
    <p class="opening">Only finished games are loaded. Fair play: never review a game that is still going.</p>`;
  renderAutoProgress();
  el.querySelectorAll('[data-url]').forEach(b => b.addEventListener('click', () => {
    const x = d.games.find(g => g.url === b.dataset.url); if (!x) return;
    BC.review.openOrReview(x.pgn, x.me);
  }));
  const acts = {
    more: () => { CC.showAll = !CC.showAll; renderCC(); },
    older: () => loadGames({ older: true }),
    refresh: () => loadGames(),
    change: () => { const s = ccStore(); s.user = ''; ccSave(s); CC.error = ''; renderCC(); },
    toggleSync: () => { BC.local.set('bc.autoSync', !syncOn()); CC.syncNote = ''; renderCC(); if (syncOn()) autoSync({ force: true }); },
    auto: () => autoReview(10),
    stopAuto: () => { if (CC.auto) CC.auto.stop = true; },
  };
  el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => acts[b.dataset.act]()));
}

// =====================================================================
// Auto-sync: new games and ratings, whenever the app is opened
// =====================================================================
const SYNC_EVERY = 10 * 60000;
const syncOn = () => BC.local.get('bc.autoSync', true) !== false;
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(t); };
function logRatings(st) {
  const log = BC.local.get('bc.ratingLog', []);
  for (const tc of ['rapid', 'blitz', 'bullet', 'daily']) {
    const r = st[tc] && st[tc].rating;
    if (!r) continue;
    const last = log.filter(e => e.tc === tc).pop();
    if (!last || last.r !== r || st.at - last.t > 86400000) log.push({ t: st.at, tc, r, src: 'chess.com' });
  }
  BC.local.set('bc.ratingLog', log.slice(-800));
}
async function syncStats(user) {
  try {
    const s = await getJSON(API + encodeURIComponent(user) + '/stats');
    const pick = k => (s[k] && s[k].last ? { rating: s[k].last.rating, best: s[k].best ? s[k].best.rating : null,
      bestAt: s[k].best ? s[k].best.date * 1000 : null, record: s[k].record || null } : null);
    const st = { at: Date.now(), rapid: pick('chess_rapid'), blitz: pick('chess_blitz'), bullet: pick('chess_bullet'), daily: pick('chess_daily') };
    BC.local.set('bc.ccstats', st);
    logRatings(st);
    BC.emit('ccstats');
  } catch (e) { /* ratings also come from the games themselves */ }
}
async function autoSync({ force = false } = {}) {
  const d = ccStore();
  if (!d.user || !syncOn() || CC.busy || CC.auto || inClaudePage() || !navigator.onLine) return;
  if (!force && Date.now() - (d.fetchedAt || 0) < SYNC_EVERY) return;
  CC.lastAdded = 0;
  await loadGames({ quick: true });
  if (CC.error) return;
  await syncStats(d.user);
  const n = CC.lastAdded || 0;
  CC.syncNote = n ? `Found ${n} new game${n > 1 ? 's' : ''}.` : '';
  renderCC();
  if (BC.local.get('bc.autoReviewNew', true) !== false) autoReview(5, { quiet: true });
}
BC.cc.sync = autoSync;
BC.cc.syncStats = syncStats;
BC.cc.syncOn = syncOn;
setTimeout(() => autoSync(), 1500);
document.addEventListener('visibilitychange', () => { if (!document.hidden) autoSync(); });
window.addEventListener('online', () => autoSync());

// Bring mistakes from games reviewed before this feature existed into the trainer.
async function migrate() {
  if (BC.local.get('bc.trainerMigrated', false) || !BC.review.myMistakes) return;
  try { stats.addMistakes(await BC.review.myMistakes()); BC.local.set('bc.trainerMigrated', true); } catch (e) { /* try again next time */ }
}

BC.on('stats', renderCC);
BC.on('autoReview', n => { location.hash = 'review'; autoReview(n || 10); });
renderCC();
migrate();
})();
