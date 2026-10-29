// Progress: rating milestones, achievements, a daily plan built from your own
// games, focus puzzles for your biggest leak, and a weekly report.
(() => {
'use strict';
const { $, esc, clamp } = BC;
const DAY = 86400000;
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA');
const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const TC = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', daily: 'Daily' };
const MILESTONES = [150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 450, 500, 550, 600, 700, 800, 900, 1000, 1200, 1400, 1600];

// ---------- activity log (what you trained, per day) ----------
const activity = BC.activity = {
  all() { return BC.local.get('bc.activity', {}); },
  bump(kind, n = 1) {
    const a = this.all(), k = dayKey();
    a[k] = a[k] || {};
    a[k][kind] = (a[k][kind] || 0) + n;
    for (const d of Object.keys(a)) if (Date.now() - Date.parse(d) > 400 * DAY) delete a[d];
    BC.local.set('bc.activity', a);
    BC.emit('activity');
  },
  today(kind) { return (this.all()[dayKey()] || {})[kind] || 0; },
  // Consecutive days with any training; today doesn't break it until it's over.
  streak() {
    const a = this.all(), t = BC.stats ? BC.stats.trainer().days : {};
    const active = d => !!(t[d] || (a[d] && Object.values(a[d]).some(v => v > 0)));
    let n = 0, at = Date.now();
    if (!active(dayKey(at))) at -= DAY;
    while (active(dayKey(at))) { n++; at -= DAY; }
    return { days: n, today: active(dayKey()) };
  },
};

// ---------- ratings ----------
const mainTc = () => BC.local.get('bc.mainTc', 'rapid');
function rows() { return BC.insights ? BC.insights.dataset() : []; }
// Your rating over time for one time control: games, chess.com stats and ratings you typed in.
function ratingSeries(tc, data = rows()) {
  const pts = data.filter(r => r.tc === tc && r.myRating).map(r => ({ t: r.date, r: r.myRating, src: 'game' }));
  for (const e of BC.local.get('bc.ratingLog', [])) if (e.tc === tc) pts.push({ t: e.t, r: e.r, src: e.src });
  pts.sort((a, b) => a.t - b.t);
  return pts.filter((p, i) => !i || p.t !== pts[i - 1].t || p.r !== pts[i - 1].r);
}
function current(tc, series = ratingSeries(tc)) { return series.length ? series[series.length - 1].r : null; }
function ladder(tc, series = ratingSeries(tc)) {
  if (!series.length) return null;
  const start = series[0].r, now = current(tc, series), goal = BC.local.get('bc.goal', 400);
  const rungs = MILESTONES.filter(m => m > start - 1);
  const reached = {};
  for (const m of rungs) { const p = series.find(x => x.r >= m); if (p) reached[m] = p.t; }
  const next = rungs.find(m => !reached[m] && m > now) || null;
  const prevM = [...rungs].reverse().find(m => m <= now) || start;
  const upto = Math.max(goal, ...Object.keys(reached).map(Number), next || 0);
  const shown = rungs.filter(m => m <= upto).concat(rungs.filter(m => m > upto).slice(0, 2));
  const peak = Math.max(...series.map(p => p.r));
  return { start, now, goal, next, prev: prevM, reached, shown, peak };
}

// ---------- achievements ----------
const lessonDone = id => !!((BC.sync.progress.lessons || {})[id] || {}).done;
const firstIndex = (arr, fn) => { for (let i = 0; i < arr.length; i++) if (fn(arr[i], i)) return arr[i]; return null; };
function winStreakAt(list, n) {
  let run = 0;
  for (const g of list) { run = g.result === 'win' ? run + 1 : 0; if (run >= n) return g.date; }
  return null;
}
const ACH = [
  // Rating (your main time control)
  ...[150, 200, 250, 300, 350, 400, 500].map(m => ({ id: `r${m}`, group: 'Rating', title: m === 400 ? 'Goal: 400' : `Reach ${m}`,
    desc: `Reach a ${m} rating in your main time control.`, check: c => (c.ladder && c.ladder.reached[m]) || null })),
  // Games
  { id: 'firstReview', group: 'Games', title: 'First review', desc: 'Review one of your games.', check: c => (c.sums[0] || {}).date || null },
  { id: 'reviews10', group: 'Games', title: '10 reviews', desc: 'Review 10 of your games.', check: c => (c.sums[9] || {}).date || null },
  { id: 'reviews50', group: 'Games', title: '50 reviews', desc: 'Review 50 of your games.', check: c => (c.sums[49] || {}).date || null },
  { id: 'noBlunder', group: 'Games', title: 'Blunder-free', desc: 'Play a game of 15+ moves with no blunders.',
    check: c => (firstIndex(c.sums, s => s.moves >= 15 && !(s.counts.blunder)) || {}).date || null },
  { id: 'nothingHung', group: 'Games', title: 'Nothing hung', desc: 'Play a game of 20+ moves without hanging a piece.',
    check: c => (firstIndex(c.sums, s => s.moves >= 20 && !(s.tags || {}).hung_piece) || {}).date || null },
  { id: 'acc80', group: 'Games', title: 'Sharp', desc: 'Score 80+ accuracy in a game of 15+ moves.', check: c => (firstIndex(c.sums, s => s.moves >= 15 && s.acc >= 80) || {}).date || null },
  { id: 'acc90', group: 'Games', title: 'Laser', desc: 'Score 90+ accuracy in a game of 15+ moves.', check: c => (firstIndex(c.sums, s => s.moves >= 15 && s.acc >= 90) || {}).date || null },
  { id: 'mateWin', group: 'Games', title: 'Checkmate!', desc: 'Win a game by checkmate.', check: c => (firstIndex(c.games, g => g.result === 'win' && g.how === 'checkmate') || {}).date || null },
  { id: 'streak3w', group: 'Games', title: 'Hat trick', desc: 'Win 3 games in a row.', check: c => winStreakAt(c.games, 3) },
  { id: 'giant', group: 'Games', title: 'Giant killer', desc: 'Beat a player rated 100+ points above you.',
    check: c => (firstIndex(c.games, g => g.result === 'win' && g.oppRating && g.myRating && g.oppRating - g.myRating >= 100) || {}).date || null },
  // Training
  { id: 'days3', group: 'Training', title: '3-day streak', desc: 'Train 3 days in a row.', check: c => (c.streak >= 3 ? Date.now() : null) },
  { id: 'days7', group: 'Training', title: '7-day streak', desc: 'Train 7 days in a row.', check: c => (c.streak >= 7 ? Date.now() : null) },
  { id: 'days30', group: 'Training', title: '30-day streak', desc: 'Train 30 days in a row.', check: c => (c.streak >= 30 ? Date.now() : null) },
  { id: 'trained50', group: 'Training', title: 'Own mistakes: 50', desc: 'Train 50 positions from your own games.', check: c => (c.trainedTotal >= 50 ? Date.now() : null) },
  { id: 'puzzle1000', group: 'Training', title: 'Puzzles 1000', desc: 'Reach a 1000 puzzle rating.', check: c => (c.pz.rating >= 1000 ? Date.now() : null) },
  { id: 'puzzle1200', group: 'Training', title: 'Puzzles 1200', desc: 'Reach a 1200 puzzle rating.', check: c => (c.pz.rating >= 1200 ? Date.now() : null) },
  { id: 'rush10', group: 'Training', title: 'Rush 10', desc: 'Score 10 in Puzzle Rush.', check: c => ((c.pz.rushBest || 0) >= 10 ? Date.now() : null) },
  { id: 'rush20', group: 'Training', title: 'Rush 20', desc: 'Score 20 in Puzzle Rush.', check: c => ((c.pz.rushBest || 0) >= 20 ? Date.now() : null) },
  { id: 'line1', group: 'Openings', title: 'First line', desc: 'Learn your first opening line.', check: c => (c.lines >= 1 ? Date.now() : null) },
  { id: 'lines10', group: 'Openings', title: 'Repertoire builder', desc: 'Learn 10 opening lines.', check: c => (c.lines >= 10 ? Date.now() : null) },
  { id: 'mastered', group: 'Openings', title: 'Line mastered', desc: 'Get an opening line to the mastered level.', check: c => (c.mastered >= 1 ? Date.now() : null) },
  { id: 'tactician', group: 'Lessons', title: 'Tactician', desc: 'Finish the Free pieces and Forks lessons.', check: () => (lessonDone('free-pieces') && lessonDone('forks') ? Date.now() : null) },
  { id: 'mates', group: 'Lessons', title: 'Mate master', desc: 'Finish the three checkmate lessons.', check: () => (['mate-1', 'back-rank', 'mate-2'].every(lessonDone) ? Date.now() : null) },
  { id: 'finisher', group: 'Lessons', title: 'Finisher', desc: 'Pass all three endgame checkmate drills.', check: () => (['ladder', 'kq-k', 'kr-k'].every(lessonDone) ? Date.now() : null) },
  { id: 'legend', group: 'Legends', title: 'Legend slayer', desc: 'Beat any legend bot.', check: c => (Object.values(c.leg.results || {}).some(r => r.w > 0) ? Date.now() : null) },
  { id: 'guess70', group: 'Legends', title: 'Think like a master', desc: 'Score 70%+ in a Guess the Move game.', check: c => (Object.values(c.leg.guess || {}).some(v => v >= 70) ? Date.now() : null) },
];
function context() {
  const data = rows(), tc = mainTc(), series = ratingSeries(tc, data);
  const sums = Object.values(BC.stats ? BC.stats.summaries() : {}).sort((a, b) => a.date - b.date);
  const tr = BC.stats ? BC.stats.trainer() : { items: {}, days: {} };
  const ops = Object.values(BC.sync.progress.openings || {});
  return { data, games: data.filter(r => r.result !== 'unknown'), sums, ladder: ladder(tc, series), series,
    streak: activity.streak().days, trainedTotal: Object.values(tr.days).reduce((s, v) => s + v, 0),
    pz: BC.sync.progress.puzzles || { rating: 800 }, leg: BC.sync.progress.legends || {},
    lines: ops.filter(o => o.lv > 0).length, mastered: ops.filter(o => o.lv >= 4).length };
}
const earned = () => BC.local.get('bc.achievements', {});
function evaluate() {
  const got = earned(), c = context(), fresh = [];
  for (const a of ACH) {
    if (got[a.id]) continue;
    let at = null;
    try { at = a.check(c); } catch (e) { at = null; }
    if (at) { got[a.id] = { at }; fresh.push(a); }
  }
  if (!fresh.length) return;
  BC.local.set('bc.achievements', got);
  toast(fresh);
  BC.emit('achievements');
}
let evalTimer = null;
const scheduleEval = () => { clearTimeout(evalTimer); evalTimer = setTimeout(evaluate, 600); };

// ---------- toast ----------
function toast(list) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  const one = list.length === 1;
  el.innerHTML = `<span class="trophy" aria-hidden="true">★</span><span><b>${one ? 'Achievement unlocked' : `${list.length} achievements unlocked`}</b>
    <span class="sub">${esc(one ? `${list[0].title}: ${list[0].desc}` : list.slice(0, 3).map(a => a.title).join(', ') + (list.length > 3 ? '…' : ''))}</span></span>
    <a href="#insights">See all</a>`;
  el.hidden = false;
  el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.classList.remove('in'); el.classList.add('out'); setTimeout(() => { el.hidden = true; }, 400); }, 6500);
}

// ---------- your plan ----------
const FOCUS = {
  hung_piece: { theme: 'save', lesson: 'blunder-check', label: 'hanging pieces', title: 'Stop hanging pieces',
    tip: 'Before every move: is the piece I am moving safe on its new square? Did my move leave anything else unprotected?' },
  missed_capture: { theme: 'free', lesson: 'free-pieces', label: 'missing free pieces', title: 'Take the free pieces',
    tip: 'After every move your opponent makes, look at each of their pieces and ask: is it protected?' },
  fork: { theme: 'fork', lesson: 'forks', label: 'walking into forks', title: 'Watch for forks',
    tip: 'Look for enemy knights and queens that could jump to a square attacking two of your pieces at once.' },
  allowed_mate: { theme: 'mate1', lesson: 'blunder-check', label: 'walking into checkmate', title: 'Keep your king safe',
    tip: 'Before every move, ask: what checks can my opponent give me after this?' },
  missed_mate: { theme: 'mate1', lesson: 'mate-1', label: 'missing checkmates', title: 'Find the checkmates',
    tip: 'Look at every check you can give, every move. Some of them are mate.' },
  missed_check: { theme: 'mate2', lesson: 'mate-2', label: 'missing strong checks', title: 'Checks first',
    tip: 'Checks, captures, threats: look at them in that order before anything else.' },
};
function focus() {
  const recent = Object.values(BC.stats ? BC.stats.summaries() : {}).sort((a, b) => b.date - a.date).slice(0, 10);
  const tags = {};
  recent.forEach(s => Object.entries(s.tags || {}).forEach(([t, v]) => { if (FOCUS[t]) tags[t] = (tags[t] || 0) + v; }));
  const top = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];
  const key = top ? top[0] : 'hung_piece';
  return { key, ...FOCUS[key], perGame: top && recent.length ? top[1] / recent.length : null, games: recent.length, personal: !!top };
}
function suggestedCourse(data) {
  const courses = (window.BC_CONTENT ? BC_CONTENT.courses : []).concat(window.BC_LEGENDS ? BC_LEGENDS.courses : []);
  const learned = id => { const c = courses.find(x => x.id === id); return c ? c.lines.filter(l => ((BC.sync.progress.openings || {})[l.id] || {}).lv > 0).length / c.lines.length : 1; };
  const score = l => (l.length ? (l.filter(r => r.result === 'win').length + l.filter(r => r.result === 'draw').length / 2) / l.length : 0.5);
  const w = data.filter(r => r.color === 'w'), b = data.filter(r => r.color === 'b');
  const weak = w.length >= 3 && b.length >= 3 && score(b) < score(w) ? 'b' : 'w';
  const pref = weak === 'w' ? ['italian', 'london'] : ['e5black', 'd5black'];
  const id = pref.find(x => learned(x) < 1) || pref[0];
  const c = courses.find(x => x.id === id);
  return c ? { id, title: c.title, color: weak } : null;
}
function plan() {
  const data = rows(), today = dayKey();
  const todays = data.filter(r => dayKey(r.date) === today);
  const reviewedToday = todays.filter(r => r.sum).length;
  const tc = BC.stats ? BC.stats.counts() : { total: 0, due: 0 };
  const trainedToday = BC.stats ? (BC.stats.trainer().days[today] || 0) : 0;
  const f = focus(), course = suggestedCourse(data);
  const losses = data.filter(r => r.result === 'loss'), timeLoss = losses.filter(r => r.how === 'time').length;
  const slow = losses.length >= 4 && timeLoss / losses.length >= 0.25;
  const items = [
    { id: 'play', done: todays.length > 0, text: slow ? 'Play a 15|10 rapid game (you lose a lot on time, so give yourself more)' : 'Play a rapid game (10 minutes or longer)',
      sub: todays.length ? `${todays.length} game${todays.length > 1 ? 's' : ''} today` : 'Use the blunder check on every move' },
    { id: 'review', done: todays.length > 0 && reviewedToday === todays.length, text: 'Review today\'s games',
      sub: !BC.cc.store().user ? 'Add your chess.com username on the Review tab to do this automatically' : todays.length ? `${reviewedToday} of ${todays.length} reviewed (automatic)` : 'Happens automatically after you play' },
    tc.total ? { id: 'daily', done: trainedToday >= Math.min(5, tc.total) || (tc.due === 0 && trainedToday > 0), text: 'Daily training: your own mistakes',
      sub: tc.due ? `${Math.min(10, tc.due)} positions due` : 'All caught up', act: 'daily' }
      : { id: 'daily', done: false, text: 'Daily training', sub: 'Starts after your first reviewed game' },
    { id: 'focus', done: activity.today('focus') >= 10, text: `10 focus puzzles: ${f.label}`, sub: `${Math.min(10, activity.today('focus'))} of 10 today`, act: 'focus' },
    { id: 'opening', done: activity.today('openings') >= 1, text: course ? `Practice an opening line: ${course.title}` : 'Practice an opening line',
      sub: course && course.color === 'b' ? 'You score less as Black, so build that first' : 'One line a day is enough', act: 'opening', arg: course && course.id },
  ];
  return { items, focus: f, course };
}

// ---------- weekly report ----------
function week(data) {
  const now = Date.now(), a = data.filter(r => r.date > now - 7 * DAY), b = data.filter(r => r.date <= now - 7 * DAY && r.date > now - 14 * DAY);
  const stat = list => {
    const rev = list.filter(r => r.sum && r.sum.acc != null);
    const per = k => (rev.length ? rev.reduce((s, r) => s + ((k === 'hung' ? (r.sum.tags || {}).hung_piece : r.sum.counts[k]) || 0), 0) / rev.length : null);
    return { n: list.length, w: list.filter(r => r.result === 'win').length, l: list.filter(r => r.result === 'loss').length, d: list.filter(r => r.result === 'draw').length,
      acc: rev.length ? rev.reduce((s, r) => s + r.sum.acc, 0) / rev.length : null, blunders: per('blunder'), hung: per('hung') };
  };
  const tc = mainTc(), series = ratingSeries(tc);
  const before = t => { const p = series.filter(x => x.t <= t).pop(); return p ? p.r : null; };
  const rNow = current(tc, series), rWeek = before(now - 7 * DAY);
  return { a: stat(a), b: stat(b), tc, ratingChange: rNow != null && rWeek != null ? rNow - rWeek : null, rNow };
}

// ---------- cards for the Progress tab ----------
function planHTML() {
  const p = plan(), done = p.items.filter(i => i.done).length, st = activity.streak();
  return `<section class="card plan">
    <div class="planhead"><div><h2>Today's plan</h2><p class="opening">${done} of ${p.items.length} done${st.days ? ` · <b>${st.days}-day streak</b>` : ''}</p></div>
      <div class="meter plan" aria-label="Plan progress"><i style="width:${done / p.items.length * 100}%"></i></div></div>
    <ul class="checklist">${p.items.map(i => `<li class="${i.done ? 'ok' : ''}"><span class="box" aria-label="${i.done ? 'Done' : 'Not done yet'}">${i.done ? '✓' : ''}</span>
      <span class="ctext"><span>${esc(i.text)}</span><span class="sub">${esc(i.sub || '')}</span></span>
      ${i.act && !i.done ? `<button class="btn ghost" data-plan="${i.act}" data-arg="${esc(i.arg || '')}">${i.act === 'opening' ? 'Open' : 'Start'}</button>` : ''}</li>`).join('')}</ul>
    <div class="focusbox"><h3 class="sub">Your focus: ${esc(p.focus.title)}</h3>
      <p class="body">${p.focus.personal ? `In your last ${p.focus.games} reviewed games, your most common mistake was <b>${esc(p.focus.label)}</b>${p.focus.perGame ? ` (${p.focus.perGame.toFixed(1)} per game)` : ''}.` : 'Hanging pieces decide most games under 400. Review a few games and this focus will be based on your own mistakes.'}</p>
      <p class="body focustip">${esc(p.focus.tip)}</p></div>
  </section>`;
}
function ladderHTML() {
  const tc = mainTc(), L = ladder(tc);
  const tcSelect = `<label class="tcpick" for="mainTc">Track<select id="mainTc">${Object.entries(TC).map(([k, v]) => `<option value="${k}"${k === tc ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`;
  const manual = `<form class="manual" id="manualRating"><label for="manualIn">${L ? 'Add your current rating' : `Your current ${TC[tc].toLowerCase()} rating`}</label>
    <input id="manualIn" type="number" inputmode="numeric" min="100" max="3500" placeholder="e.g. 124"><button class="btn ghost">Save</button></form>`;
  if (!L) {
    return `<section class="card"><div class="planhead"><h2>Milestones</h2>${tcSelect}</div>
      <p class="body">Load your chess.com games on the Review tab and your rating is tracked automatically. Or type it in to start your milestone ladder.</p>${manual}</section>`;
  }
  const toNext = L.next ? L.next - L.now : 0, span = L.next ? L.next - L.prev : 1;
  return `<section class="card"><div class="planhead"><h2>Milestones · ${TC[tc]}</h2>${tcSelect}</div>
    <div class="ladderhead"><p class="heronum">${L.now}</p><p class="body">${L.next ? `<b>${toNext}</b> points to <b>${L.next}</b>. Peak so far: ${L.peak}.` : 'You passed every milestone here!'}</p></div>
    ${L.next ? `<div class="meter goal" role="meter" aria-valuemin="${L.prev}" aria-valuemax="${L.next}" aria-valuenow="${L.now}" aria-label="Progress to the next milestone"><i style="width:${clamp((L.now - L.prev) / span, 0, 1) * 100}%"></i></div>` : ''}
    <ol class="ladder">${L.shown.map(m => {
      const r = L.reached[m], isNext = m === L.next;
      return `<li class="${r ? 'got' : isNext ? 'next' : ''}${m === L.goal ? ' goal' : ''}"><b>${m}</b><span>${r ? fmtDate(r) : isNext ? 'next' : m === L.goal ? 'goal' : ''}</span></li>`;
    }).join('')}</ol>
    <details class="tableview"><summary>Add a rating by hand</summary>${manual}</details></section>`;
}
function weekHTML(data) {
  const w = week(data);
  if (!w.a.n && !w.b.n) return '';
  const row = (label, a, b, fmt, better) => {
    if (a == null) return '';
    let cmp = '';
    if (better && b != null && Math.abs(a - b) >= 0.05) cmp = (better === 'up' ? a > b : a < b) ? '<span class="better">better</span>' : '<span class="worse">worse</span>';
    return `<tr><td>${label}</td><td class="n">${fmt(a)}</td><td class="n muted">${b != null ? fmt(b) : '–'}</td><td>${cmp}</td></tr>`;
  };
  const one = v => v.toFixed(1);
  return `<section class="card"><h2>This week</h2>
    <p class="body">${w.a.n} game${w.a.n === 1 ? '' : 's'}: ${w.a.w} won, ${w.a.d} drawn, ${w.a.l} lost.${w.ratingChange != null ? ` ${TC[w.tc]} rating ${w.ratingChange >= 0 ? 'up' : 'down'} <b>${Math.abs(w.ratingChange)}</b> to ${w.rNow}.` : ''}</p>
    <div class="tablewrap"><table class="tally week"><thead><tr><td></td><td class="n">This week</td><td class="n">Last week</td><td></td></tr></thead><tbody>
      ${row('Games', w.a.n, w.b.n, v => String(v))}
      ${row('Accuracy', w.a.acc, w.b.acc, one, 'up')}
      ${row('Blunders per game', w.a.blunders, w.b.blunders, one, 'down')}
      ${row('Hung pieces per game', w.a.hung, w.b.hung, one, 'down')}
    </tbody></table></div>
    <p class="opening">Accuracy and mistakes count reviewed games only.</p></section>`;
}
function achievementsHTML() {
  const got = earned(), list = ACH.map(a => ({ ...a, at: got[a.id] && got[a.id].at })), n = list.filter(a => a.at).length;
  const groups = [...new Set(ACH.map(a => a.group))];
  const recent = list.filter(a => a.at).sort((a, b) => b.at - a.at).slice(0, 4);
  const badge = a => `<li class="${a.at ? 'got' : ''}" title="${esc(a.desc)}"><span class="medal" aria-hidden="true">${a.at ? '★' : '☆'}</span>
    <span class="atext"><b>${esc(a.title)}</b><span class="sub">${a.at ? fmtDate(a.at) : esc(a.desc)}</span></span></li>`;
  return `<section class="card"><h2>Achievements · ${n} of ${ACH.length}</h2>
    ${recent.length ? `<ul class="badges">${recent.map(badge).join('')}</ul>` : '<p class="body">Your first achievements come from reviewing a game, solving puzzles and learning an opening line.</p>'}
    <details class="tableview"><summary>Show all ${ACH.length}</summary>${groups.map(g => `<h3 class="sub">${g}</h3><ul class="badges">${list.filter(a => a.group === g).map(badge).join('')}</ul>`).join('')}</details></section>`;
}
function bind(el) {
  el.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => {
    const act = b.dataset.plan;
    if (act === 'opening') { location.hash = 'openings'; if (b.dataset.arg) BC.emit('openCourse', b.dataset.arg); return; }
    location.hash = 'lessons'; BC.emit('openLesson', act === 'focus' ? 'focus' : 'daily');
  }));
  const sel = $('mainTc');
  if (sel) sel.addEventListener('change', () => { BC.local.set('bc.mainTc', sel.value); BC.emit('stats'); });
  const mf = $('manualRating');
  if (mf) mf.addEventListener('submit', e => {
    e.preventDefault();
    const v = parseInt($('manualIn').value, 10);
    if (!(v >= 100 && v <= 3500)) return;
    const log = BC.local.get('bc.ratingLog', []);
    log.push({ t: Date.now(), tc: mainTc(), r: v, src: 'you' });
    BC.local.set('bc.ratingLog', log);
    BC.emit('stats');
  });
}

BC.progress = { planHTML, ladderHTML, weekHTML, achievementsHTML, bind, focus, ratingSeries, evaluate, ACH, plan };
['stats', 'ccgames', 'ccstats', 'trainer', 'activity', 'progress'].forEach(ev => BC.on(ev, scheduleEval));
setTimeout(evaluate, 1200);
})();
