// Insights tab: what your games say about your chess. Built from your
// chess.com games and from every game you've reviewed.
(() => {
'use strict';
const { $, esc, clamp } = BC;
const D = window.BC_DATA;
const TCS = ['rapid', 'blitz', 'bullet', 'daily'];
const TC = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', daily: 'Daily', all: 'All' };
const HOW = { checkmate: 'checkmate', resignation: 'resignation', time: 'time', abandoned: 'abandonment', agreement: 'agreement',
  repetition: 'repetition', stalemate: 'stalemate', insufficient: 'insufficient material', fifty: '50-move rule', other: 'other' };
const CODE = { checkmated: 'checkmate', resigned: 'resignation', timeout: 'time', abandoned: 'abandoned', agreed: 'agreement',
  repetition: 'repetition', stalemate: 'stalemate', insufficient: 'insufficient', '50move': 'fifty', timevsinsufficient: 'insufficient' };
const LESSON_FOR = { hung_piece: 'blunder-check', fork: 'forks', missed_capture: 'free-pieces', missed_mate: 'mate-1', allowed_mate: 'blunder-check', missed_check: 'mate-1' };
const S = { tc: BC.local.get('bc.insTc', null), goal: BC.local.get('bc.goal', 400), charts: [] };
const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
const one = v => (Math.round(v * 10) / 10).toFixed(1);

// ---------- data ----------
let openingCache = BC.local.get('bc.ccOpenings', {});
function openingOf(x) {
  if (openingCache[x.url] !== undefined) return openingCache[x.url];
  const body = x.pgn.replace(/\{[^}]*\}/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\d+\.(\.\.)?/g, ' ');
  const sans = body.split(/\s+/).filter(t => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)).slice(0, 24);
  const ch = new Chess();
  let name = null;
  for (const s of sans) { if (!ch.move(s, { sloppy: true })) break; const n = D.openings.names[BC.posKey(ch.fen())]; if (n) name = n; }
  return (openingCache[x.url] = BC.review.family(name) || 'Other');
}
function howOf(x) {
  const me = x.me === 'w' ? x.white : x.black, op = x.me === 'w' ? x.black : x.white;
  return CODE[me.res === 'win' ? op.res : me.res] || 'other';
}
function dataset() {
  const d = BC.cc.store(), sums = BC.stats.summaries(), rows = [], seen = new Set();
  const before = Object.keys(openingCache).length;
  for (const x of d.games) {
    const s = sums[x.url], me = x.me === 'w' ? x.white : x.black, op = x.me === 'w' ? x.black : x.white;
    rows.push({ id: x.url, date: x.end, tc: x.tc, color: x.me, result: BC.cc.resultOf(x), how: howOf(x), myRating: me.r, oppRating: op.r,
      opp: op.u, opening: (s && s.opening) || openingOf(x), sum: s || null });
    seen.add(x.url);
  }
  if (Object.keys(openingCache).length !== before) BC.local.set('bc.ccOpenings', openingCache);
  for (const s of Object.values(sums)) {
    if (seen.has(s.id) || s.result === 'unknown') continue;
    rows.push({ id: s.id, date: s.date, tc: s.tc, color: s.color, result: s.result, how: s.how, myRating: s.myRating, oppRating: s.oppRating,
      opp: s.opp, opening: s.opening || 'Other', sum: s });
  }
  return rows.sort((a, b) => a.date - b.date);
}

// ---------- charts ----------
function niceStep(range) {
  const raw = range / 4, mag = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
}
// One-series line chart with a crosshair tooltip. points: [{x, y, label}]
function lineChart(el, points, { yMin, yMax, ref, fmt = v => String(Math.round(v)), name }) {
  const W = Math.max(280, el.clientWidth || 600), H = 190, m = { l: 40, r: 46, t: 14, b: 26 };
  const xs = points.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
  let lo = yMin != null ? yMin : Math.min(...points.map(p => p.y)), hi = yMax != null ? yMax : Math.max(...points.map(p => p.y));
  if (ref && yMax == null && ref.y <= hi + (hi - lo) * 0.6 + 40) hi = Math.max(hi, ref.y);
  if (hi - lo < 20) { lo -= 10; hi += 10; }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const X = v => m.l + (x1 === x0 ? (W - m.l - m.r) / 2 : (v - x0) / (x1 - x0) * (W - m.l - m.r));
  const Y = v => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}">`;
  for (let v = lo; v <= hi + 1e-9; v += step) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/>`;
    svg += `<text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end" class="tick">${fmt(v)}</text>`;
  }
  if (ref && ref.y >= lo && ref.y <= hi) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(ref.y)}" y2="${Y(ref.y)}" stroke="var(--ink)" stroke-opacity=".55" stroke-width="1"/>`;
    svg += `<text x="${m.l + 4}" y="${Y(ref.y) - 5}" class="reflabel">${esc(ref.label)}</text>`;
  }
  svg += `<text x="${m.l}" y="${H - 6}" class="tick">${fmtDate(x0)}</text><text x="${W - m.r}" y="${H - 6}" text-anchor="end" class="tick">${fmtDate(x1)}</text>`;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const base = Y(lo);
  svg += `<path d="${path} L${X(points[points.length - 1].x).toFixed(1)},${base} L${X(points[0].x).toFixed(1)},${base} Z" fill="var(--accent)" fill-opacity=".1"/>`;
  svg += `<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const last = points[points.length - 1];
  svg += `<circle cx="${X(last.x)}" cy="${Y(last.y)}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
  svg += `<text x="${X(last.x) + 9}" y="${Y(last.y) + 4}" class="endlabel">${fmt(last.y)}</text>`;
  svg += `<line class="xhair" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>`;
  svg += `<circle class="xdot" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`;
  svg += `<rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" class="hit" tabindex="0" aria-label="Move along the chart to read values"/></svg>`;
  el.innerHTML = svg + '<div class="tip" hidden></div>';
  const tip = el.querySelector('.tip'), hair = el.querySelector('.xhair'), dot = el.querySelector('.xdot'), hit = el.querySelector('.hit');
  let idx = points.length - 1;
  const show = i => {
    idx = clamp(i, 0, points.length - 1);
    const p = points[idx], px = X(p.x), py = Y(p.y);
    hair.setAttribute('x1', px); hair.setAttribute('x2', px); hair.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren();
    const b = document.createElement('b'); b.textContent = fmt(p.y);
    const s = document.createElement('span'); s.textContent = p.label;
    tip.append(b, s);
    tip.style.left = `${clamp(px - tip.offsetWidth / 2, 0, W - tip.offsetWidth)}px`;
    tip.style.top = `${Math.max(0, py - tip.offsetHeight - 12)}px`;
  };
  const hide = () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  const nearest = cx => { let b = 0; points.forEach((p, i) => { if (Math.abs(X(p.x) - cx) < Math.abs(X(points[b].x) - cx)) b = i; }); return b; };
  hit.addEventListener('pointermove', e => { const r = el.querySelector('svg').getBoundingClientRect(); show(nearest((e.clientX - r.left) * W / r.width)); });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(idx));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { show(idx - 1); e.preventDefault(); } if (e.key === 'ArrowRight') { show(idx + 1); e.preventDefault(); } });
}
// Diverging stacked bar: wins | draws | losses
function wdlBar(w, d, l, title) {
  const n = w + d + l || 1;
  const seg = (v, cls, lab) => (v ? `<i class="${cls}" style="flex:${v}" title="${esc(title)}: ${v} ${lab}"></i>` : '');
  return `<span class="wdl" role="img" aria-label="${esc(title)}: ${w} won, ${d} drawn, ${l} lost">${seg(w, 'w', 'won')}${seg(d, 'd', 'drawn')}${seg(l, 'l', 'lost')}</span>`;
}

// ---------- render ----------
function render() {
  const el = $('insPanel'); if (!el) return;
  const rows = dataset();
  if (!rows.length) {
    el.innerHTML = BC.progress.planHTML() + `<div class="inscols">${BC.progress.ladderHTML()}${BC.progress.achievementsHTML()}
      <section class="card ins-empty"><h2>Your games</h2>
      <p class="body">Progress shows what your games say about your chess: your rating toward your goal, your results with each color and opening, and the mistakes you make most.</p>
      <p class="body"><b>Add your chess.com username</b> on the Review tab. New games then load and get reviewed automatically every time you open the app.</p>
      <div class="acts"><a class="btn" href="#review">Add my chess.com username</a></div></section></div>`;
    BC.progress.bind(el);
    return;
  }
  const present = TCS.filter(t => rows.some(r => r.tc === t));
  const mostPlayed = present.slice().sort((a, b) => rows.filter(r => r.tc === b).length - rows.filter(r => r.tc === a).length)[0] || 'rapid';
  if (!S.tc || (S.tc !== 'all' && !present.includes(S.tc))) S.tc = mostPlayed;
  const sel = S.tc === 'all' ? rows : rows.filter(r => r.tc === S.tc);
  const ratingTc = S.tc === 'all' ? mostPlayed : S.tc;
  const rated = rows.filter(r => r.tc === ratingTc && r.myRating);
  const reviewed = sel.filter(r => r.sum && r.sum.acc != null);

  let html = `<div class="filters" role="group" aria-label="Time control">${['all', ...present].map(t =>
    `<button data-tc="${t}" aria-pressed="${S.tc === t}">${TC[t]} <span class="muted">${t === 'all' ? rows.length : rows.filter(r => r.tc === t).length}</span></button>`).join('')}</div>`;

  // Plan, milestones, achievements, this week
  html = BC.progress.planHTML() + `<div class="inscols">${BC.progress.ladderHTML()}${BC.progress.achievementsHTML()}${BC.progress.weekHTML(rows)}</div>` + html;

  // Rating over time
  const series = BC.progress.ratingSeries(ratingTc, rows);
  if (series.length >= 2) {
    const cur = series[series.length - 1].r, start = series[0].r;
    const monthAgo = series.filter(p => p.t <= Date.now() - 30 * 86400000).pop();
    const delta = monthAgo ? cur - monthAgo.r : cur - start;
    html += `<section class="card hero">
      <div class="herotop"><div><h2>${TC[ratingTc]} rating over time</h2>
        <p class="delta ${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta} ${monthAgo ? 'in the last 30 days' : `since ${fmtDate(series[0].t)}`}</p></div>
        <form class="goalform" id="goalForm"><label for="goalIn">Goal</label><input id="goalIn" type="number" inputmode="numeric" min="100" max="3000" step="25" value="${S.goal}"><button class="btn ghost">Set</button></form></div>
      <div class="chart" id="ratingChart"></div>
      <details class="tableview"><summary>Show as a table</summary><div class="tablewrap"><table class="tally"><thead><tr><td>Date</td><td>Result</td><td>Opponent</td><td class="n">Rating</td></tr></thead><tbody>
        ${rated.slice(-15).reverse().map(r => `<tr><td>${fmtDate(r.date)}</td><td>${r.result === 'win' ? 'Won' : r.result === 'loss' ? 'Lost' : 'Draw'}</td><td>${esc(r.opp)}</td><td class="n">${r.myRating}</td></tr>`).join('')}
      </tbody></table></div></details>
    </section>`;
  }

  // Results
  const wdl = list => ({ w: list.filter(r => r.result === 'win').length, d: list.filter(r => r.result === 'draw').length, l: list.filter(r => r.result === 'loss').length });
  const resRow = (label, list) => {
    const c = wdl(list), n = c.w + c.d + c.l;
    if (!n) return '';
    return `<div class="resrow"><div class="reslab"><span>${label}</span><span class="muted">${c.w} W · ${c.d} D · ${c.l} L · <b>${pct(c.w + c.d / 2, n)}%</b></span></div>${wdlBar(c.w, c.d, c.l, label)}</div>`;
  };
  html += `<div class="inscols"><section class="card"><h2>Results · ${sel.length} game${sel.length === 1 ? '' : 's'}</h2>
    <div class="legend"><span><i class="w"></i>Won</span><span><i class="d"></i>Drawn</span><span><i class="l"></i>Lost</span></div>
    ${resRow('All games', sel)}${resRow('As White', sel.filter(r => r.color === 'w'))}${resRow('As Black', sel.filter(r => r.color === 'b'))}
    ${S.tc === 'all' ? present.map(t => resRow(TC[t], rows.filter(r => r.tc === t))).join('') : ''}
    ${resultTip(sel)}</section>`;

  // Openings
  const groups = {};
  for (const r of sel) { const k = `${r.color}|${r.opening}`; (groups[k] = groups[k] || []).push(r); }
  const ops = Object.entries(groups).map(([k, list]) => ({ color: k[0], name: k.slice(2), list, ...wdl(list),
    acc: list.filter(r => r.sum && r.sum.acc != null).map(r => r.sum.acc) })).sort((a, b) => b.list.length - a.list.length).slice(0, 8);
  html += `<section class="card"><h2>Your openings</h2>
    <div class="tablewrap"><table class="tally openings"><thead><tr><td>Opening</td><td class="n">Games</td><td>Score</td><td class="n">Accuracy</td></tr></thead><tbody>
    ${ops.map(o => { const n = o.list.length; return `<tr><td><span class="chip side ${o.color}">${o.color === 'w' ? 'White' : 'Black'}</span> ${esc(o.name)}</td><td class="n">${n}</td>
      <td><span class="scorecell">${wdlBar(o.w, o.d, o.l, o.name)}<span>${pct(o.w + o.d / 2, n)}%</span></span></td>
      <td class="n">${o.acc.length ? one(o.acc.reduce((s, v) => s + v, 0) / o.acc.length) : '–'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <p class="opening">Score counts a win as 1 and a draw as ½. <a href="#openings">Practice openings</a></p></section>`;

  // From reviewed games
  if (reviewed.length) {
    const n = reviewed.length, sum = k => reviewed.reduce((s, r) => s + (r.sum.counts[k] || 0), 0);
    const avgAcc = reviewed.reduce((s, r) => s + r.sum.acc, 0) / n;
    const tags = {};
    reviewed.forEach(r => Object.entries(r.sum.tags || {}).forEach(([t, v]) => { tags[t] = (tags[t] || 0) + v; }));
    const leaks = Object.entries(tags).filter(([t]) => t !== 'other').sort((a, b) => b[1] - a[1]);
    const maxLeak = leaks.length ? leaks[0][1] / n : 1;
    const severe = reviewed.reduce((s, r) => s + r.sum.severe, 0);
    const clocked = reviewed.reduce((s, r) => s + (r.sum.clockedSevere || 0), 0), low = reviewed.reduce((s, r) => s + (r.sum.lowTime || 0), 0);
    const ph = { opening: 0, middle: 0, end: 0 };
    reviewed.forEach(r => Object.keys(ph).forEach(k => { ph[k] += (r.sum.phase || {})[k] || 0; }));
    html += `<section class="card"><h2>From ${n} reviewed game${n === 1 ? '' : 's'}</h2>
      <div class="tiles">
        <div class="tile"><span class="tl">Average accuracy</span><span class="tv">${one(avgAcc)}</span></div>
        <div class="tile"><span class="tl">Blunders per game</span><span class="tv">${one(sum('blunder') / n)}</span></div>
        <div class="tile"><span class="tl">Mistakes per game</span><span class="tv">${one((sum('mistake') + sum('miss')) / n)}</span></div>
      </div>
      ${n >= 2 ? `<h3 class="sub">Accuracy by game</h3><div class="chart" id="accChart"></div>` : ''}
      ${leaks.length ? `<h3 class="sub">Your biggest leaks</h3><ul class="leaks">${leaks.slice(0, 5).map(([t, v]) => `<li>
        <span class="leaklab">${esc(BC.review.TAG_LABEL[t] || t)}</span>
        <span class="leakbar"><i style="width:${(v / n) / maxLeak * 100}%"></i></span>
        <span class="leakval">${one(v / n)} per game</span>
        ${LESSON_FOR[t] ? `<a href="#lessons" data-lesson="${LESSON_FOR[t]}">Practice</a>` : '<span></span>'}</li>`).join('')}</ul>` : ''}
      ${severe ? `<h3 class="sub">When mistakes happen</h3><div class="tiles${clocked ? ' n4' : ''}">
        <div class="tile"><span class="tl">In the opening (moves 1–12)</span><span class="tv">${pct(ph.opening, severe)}%</span></div>
        <div class="tile"><span class="tl">In the middlegame</span><span class="tv">${pct(ph.middle, severe)}%</span></div>
        <div class="tile"><span class="tl">In the endgame</span><span class="tv">${pct(ph.end, severe)}%</span></div>
        ${clocked ? `<div class="tile"><span class="tl">With little time left</span><span class="tv">${pct(low, clocked)}%</span></div>` : ''}
      </div>
      ${clocked && low / clocked >= 0.3 ? '<p class="body">Many of your mistakes come when your clock is low. Play longer games (15|10 or slower), and don\'t spend too long on early moves.</p>' : ''}` : ''}
      <div class="acts"><a class="btn ghost" href="#lessons" data-daily="1">Practice your mistakes</a></div>
    </section>`;
  } else {
    html += `<section class="card"><h2>Accuracy and leaks</h2>
      <p class="body">Review some games to see your accuracy, blunders per game and your biggest leaks.</p>
      ${BC.cc.store().games.length ? '<div class="acts"><button class="btn" data-auto="1">Auto-review my last 10 games</button></div>' : ''}</section>`;
  }

  // How games end
  const ends = res => { const c = {}; sel.filter(r => r.result === res).forEach(r => { c[r.how] = (c[r.how] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const endRow = (label, res) => { const e = ends(res); return e.length ? `<tr><td>${label}</td><td>${e.map(([h, v]) => `${esc(HOW[h] || h)} <b>${v}</b>`).join(' · ')}</td></tr>` : ''; };
  html += `<section class="card"><h2>How your games end</h2><div class="tablewrap"><table class="tally ends"><tbody>
    ${endRow('Won by', 'win')}${endRow('Lost by', 'loss')}${endRow('Drawn by', 'draw')}</tbody></table></div>${endTip(sel)}</section></div>`;

  el.innerHTML = html;
  BC.progress.bind(el);
  el.querySelectorAll('[data-tc]').forEach(b => b.addEventListener('click', () => { S.tc = b.dataset.tc; BC.local.set('bc.insTc', S.tc); render(); }));
  const gf = $('goalForm');
  if (gf) gf.addEventListener('submit', e => { e.preventDefault(); const v = parseInt($('goalIn').value, 10); if (v > 0) { S.goal = v; BC.local.set('bc.goal', v); render(); } });
  el.querySelectorAll('[data-lesson]').forEach(a => a.addEventListener('click', () => BC.emit('openLesson', a.dataset.lesson)));
  el.querySelectorAll('[data-daily]').forEach(a => a.addEventListener('click', () => BC.emit('openLesson', 'daily')));
  el.querySelectorAll('[data-auto]').forEach(b => b.addEventListener('click', () => BC.emit('autoReview', 10)));
  S.draw = () => {
    const byT = Object.fromEntries(rated.map(r => [r.date, r]));
    if ($('ratingChart')) lineChart($('ratingChart'), series.map(p => { const r = byT[p.t]; return { x: p.t, y: p.r, label: r ? `${fmtDate(p.t)} · ${r.result === 'win' ? 'Won' : r.result === 'loss' ? 'Lost' : 'Draw'} vs ${r.opp}` : `${fmtDate(p.t)} · from ${p.src}` }; }),
      { ref: { y: S.goal, label: `Goal ${S.goal}` }, name: `${TC[ratingTc]} rating over time` });
    if ($('accChart')) lineChart($('accChart'), reviewed.map(r => ({ x: r.date, y: r.sum.acc, label: `${fmtDate(r.date)} vs ${r.opp}` })),
      { yMin: 0, yMax: 100, fmt: v => String(Math.round(v)), name: 'Accuracy by game' });
  };
  S.draw();
}
function resultTip(sel) {
  const w = sel.filter(r => r.color === 'w'), b = sel.filter(r => r.color === 'b');
  const sc = l => (l.length ? (l.filter(r => r.result === 'win').length + l.filter(r => r.result === 'draw').length / 2) / l.length : 0);
  if (w.length >= 5 && b.length >= 5 && Math.abs(sc(w) - sc(b)) >= 0.15) {
    const weak = sc(w) < sc(b) ? 'White' : 'Black';
    return `<p class="body">You score clearly less as <b>${weak}</b>. Learn one solid opening for that color in the Openings tab.</p>`;
  }
  return '';
}
function endTip(sel) {
  const losses = sel.filter(r => r.result === 'loss'), n = losses.length;
  if (n < 4) return '';
  const by = h => losses.filter(r => r.how === h).length;
  if (by('time') / n >= 0.25) return `<p class="body">You lose ${pct(by('time'), n)}% of your losses on time. Play longer time controls and move faster in the opening.</p>`;
  if (by('checkmate') / n >= 0.4) return `<p class="body">${pct(by('checkmate'), n)}% of your losses are checkmates. Before every move, ask: what checks can my opponent give?</p>`;
  if (by('abandoned') / n >= 0.2) return '<p class="body">Several losses are by abandonment. Only start a game when you have time to finish it.</p>';
  return '';
}

let resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!$('view-insights').hidden && S.draw) S.draw(); }, 150); });
BC.on('view', name => { if (name === 'insights') render(); });
['stats', 'ccgames', 'ccstats', 'achievements', 'activity', 'trainer'].forEach(ev => BC.on(ev, () => { if (!$('view-insights').hidden) render(); }));
BC.insights = { render, dataset };
})();
