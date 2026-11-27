{
/* ============ basics ============ */
const D = window.DATA;
const $ = s => document.querySelector(s);
const V = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => (typeof u === 'string' && u.startsWith('https://')) ? u : null;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = ymd(new Date());
const WD = '日一二三四五六';
const days = dl => Math.ceil((new Date(dl + 'T23:59:00') - new Date()) / 864e5);
const clone = o => JSON.parse(JSON.stringify(o));
const eur = n => (n < 0 ? '−' : '') + '€' + Math.round(Math.abs(n)).toLocaleString('en-US');
const R = Object.fromEntries(D.routes.map(r => [r.id, r]));
const I = Object.fromEntries(D.items.map(i => [i.id, i]));
const COL = id => D.colors[id] || '#ff7a59';
const LVL = 20;

/* ============ state ============ */
const LS = {
  get(k, d) { try { const v = localStorage.getItem('wsr4-' + k) ?? localStorage.getItem('wsr3-' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('wsr4-' + k, JSON.stringify(v)); } catch (e) {} }
};
let S = LS.get('state', {}), H = LS.get('hist', {}), L = LS.get('ledger', {entries: []}), M = LS.get('model', {adj: {}}), FEED = LS.get('feed', []);
function norm() {
  S.checks = S.checks || {}; S.todos = S.todos || []; S.days = S.days || {}; S.cnt = S.cnt || {};
  if (S.grids) { for (const [id, g] of Object.entries(S.grids)) if (S.cnt[id] == null) S.cnt[id] = (g || []).filter(Boolean).length; delete S.grids; }
  L.entries = L.entries || []; M.adj = M.adj || {};
}
norm();
const ui = Object.assign({tab: 'today', mapSeg: 'map', metric: 'p', mview: 'world', intel: 'new', kind: 'all', dig: 'all'}, LS.get('ui', {}));
const saveUi = () => LS.set('ui', ui);

/* ============ model ============ */
const cnt = id => +S.cnt[id] || 0;
function frac(it) {
  if (it.type === 'once') return S.checks[it.id] ? 1 : 0;
  return Math.min(1, cnt(it.id) / (it.type === 'end' ? it.sq : it.tgt));
}
const adj = r => +(M.adj && M.adj[r.id]) || 0;
const prob = r => Math.max(0, Math.min(r.cap, Math.round(r.base + adj(r) + D.items.reduce((a, it) => a + (it.b[r.id] || 0) * frac(it), 0))));
const maxp = r => Math.min(r.cap, r.base + adj(r) + D.items.reduce((a, it) => a + (it.b[r.id] || 0), 0));
const wprob = w => Math.round(Math.max(0, ...Object.entries(w || {}).map(([k, x]) => prob(R[k]) * x)));
const ev = () => Math.max(...D.routes.map(r => prob(r) * r.sal / 100));
const lit = () => Math.round(D.regions.reduce((a, g) => a + wprob(g.r), 0) / D.regions.length);
const gain = it => Object.entries(it.b).reduce((a, [k, v]) => a + v * (1 - frac(it)) * R[k].sal / 50000, 0);
function xp() {
  let x = 0;
  for (const it of D.items) x += it.type === 'once' ? (S.checks[it.id] ? 20 : 0) : cnt(it.id);
  return x + S.todos.filter(t => t.done).length * 2 + FEED.filter(f => f.status === 'done').length * 5 + Math.min(200, L.entries.length);
}
const level = () => { const x = xp(), lv = Math.floor(Math.sqrt(x / 12)) + 1, a = 12 * (lv - 1) ** 2, b = 12 * lv ** 2; return {x, lv, a, b}; };
const TITLES = ['见习发掘员', '探方能手', '地层侦探', '遗址主管', '发掘领队', '考古探险家', '遗产守护者', '传说级考古学家'];
function streak() { let n = 0; const d = new Date(); if (!S.days[TODAY]) d.setDate(d.getDate() - 1); while (S.days[ymd(d)]) { n++; d.setDate(d.getDate() - 1); } return n; }
const touch = () => { S.days[TODAY] = 1; };

/* ============ history ============ */
function put(k, v) {
  const a = H[k] || (H[k] = []), last = a[a.length - 1];
  if (last && last[0] === TODAY) { if (last[1] === v) return false; last[1] = v; return true; }
  if (last && last[1] === v && k[0] !== '_') return false;
  a.push([TODAY, v]); if (a.length > 400) a.shift(); return true;
}
function logHist() {
  let ch = false;
  for (const it of D.items) if (it.type !== 'once') { const v = Math.round(frac(it) * 1000) / 10; if ((H[it.id] && H[it.id].length) || v > 0) ch = put(it.id, v) || ch; }
  ch = put('_ev', Math.round(ev())) || ch; ch = put('_lit', lit()) || ch;
  if (ch) save('hist');
}

/* ============ cloud: db + Claude ============ */
let db = null, ask = null;
const timers = {}, pending = {}, busy = {};
const DOCS = {state: 'me/state', hist: 'me/hist', ledger: 'me/ledger'};
const val = k => k === 'state' ? S : k === 'hist' ? H : L;
function save(k) {
  LS.set(k, val(k));
  if (!db) return;
  pending[k] = true; clearTimeout(timers[k]);
  timers[k] = setTimeout(() => push(k), 700);
}
async function push(k) {
  if (busy[k]) { busy[k] = 2; return; }
  busy[k] = 1;
  try { await db.doc(DOCS[k]).set(clone(val(k))); setSync(true); } catch (e) { setSync(false); }
  finally { const again = busy[k] === 2; busy[k] = 0; if (again) push(k); else pending[k] = false; }
}
function setSync(on) { const s = $('#sync'); s.classList.toggle('on', on); s.title = on ? '已同步：手机和电脑是同一份' : '本机模式'; }
(async () => {
  const c = window.claude; if (!c || !c.use) return;
  c.use('sample').then(f => { ask = f; }).catch(() => {});
  try { db = await c.use('db'); } catch (e) { db = null; }
  if (!db) return;
  const isEmpty = d => !d || (!Object.keys(d.checks || {}).length && !Object.keys(d.cnt || {}).length && !Object.keys(d.grids || {}).length && !(d.todos || []).length);
  const apply = {state: d => { S = clone(d); }, hist: d => { H = clone(d); }, ledger: d => { L = clone(d); }};
  for (const k of Object.keys(DOCS)) {
    db.doc(DOCS[k]).onSnapshot(snap => {
      if (!snap.metadata.fromCache) setSync(true);
      if (pending[k] || busy[k]) return;
      if (snap.exists && k === 'state' && isEmpty(snap.data()) && !isEmpty(S)) { save(k); return; }
      if (snap.exists) { apply[k](snap.data()); norm(); LS.set(k, val(k)); render(); }
      else if (!snap.metadata.fromCache) save(k);
    }, () => setSync(false));
  }
  db.doc('me/model').onSnapshot(s => { if (s.exists) { M = clone(s.data()); norm(); LS.set('model', M); render(); } }, () => {});
  db.collection('feed').onSnapshot(q => { FEED = q.docs.map(d => Object.assign({}, clone(d.data()), {id: d.id})); LS.set('feed', FEED); render(); }, () => {});
})();

/* ============ little joys ============ */
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 1700); }
function confetti(x, y) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cs = ['#ff7a59', '#ffc94d', '#21b892', '#4da8ff', '#9b87f5', '#ff7a8a'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i'); p.className = 'cf';
    const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 110;
    p.style.cssText = `left:${x}px;top:${y}px;background:${cs[i % cs.length]};--dx:${Math.cos(a) * r}px;--dy:${Math.sin(a) * r - 40}px;--r:${Math.random() * 540 - 270}deg`;
    document.body.appendChild(p); setTimeout(() => p.remove(), 1200);
  }
}
const cheer = () => { const m = document.querySelector('.hero .mascot svg'); if (m) { m.classList.remove('hop'); void m.offsetWidth; m.classList.add('hop'); } };

/* ============ charts ============ */
function smooth(P) {
  if (P.length < 2) return '';
  let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  for (let i = 1; i < P.length; i++) { const [x0, y0] = P[i - 1], [x1, y1] = P[i], cx = (x0 + x1) / 2; d += `C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`; }
  return d;
}
function chart(el, pts, o = {}) {
  if (!el) return;
  const W = el.clientWidth || 320, Hh = el.clientHeight || 160, col = o.color || 'var(--coral)';
  if (!pts || !pts.length) { el.innerHTML = `<p class="empty">${esc(o.empty || '从今天开始画线')}</p>`; return; }
  const t = pts.map(p => Date.parse(p[0])), vs = pts.map(p => p[1]);
  const lo = o.min ?? 0, hi = o.max ?? Math.max(1, ...vs) * 1.2;
  const m = o.bare ? {l: 4, r: 8, t: 8, b: 6} : {l: 40, r: 12, t: 10, b: 22}, iw = W - m.l - m.r, ih = Hh - m.t - m.b;
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const X = x => m.l + (t1 === t0 ? iw : (x - t0) / (t1 - t0) * iw), Y = v => m.t + ih - (v - lo) / (hi - lo) * ih;
  const P = pts.map((p, i) => [X(t[i]), Y(p[1])]);
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  const fmt = o.fmt || (v => v + '%');
  let s = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`;
  if (!o.bare) s += [0, .5, 1].map(f => { const v = lo + (hi - lo) * f; return `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${esc(fmt(Math.round(v)))}</text>`; }).join('');
  if (P.length === 1) s += `<circle cx="${P[0][0]}" cy="${P[0][1]}" r="5" fill="${col}"/>`;
  else { const d = smooth(P); s += `<path d="${d}L${P[P.length - 1][0]} ${Y(lo)}L${P[0][0]} ${Y(lo)}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round"/><circle cx="${P[P.length - 1][0]}" cy="${P[P.length - 1][1]}" r="5" fill="${col}" stroke="${o.bare ? '#fff' : 'var(--card)'}" stroke-width="2"/>`; }
  if (!o.bare) { const dl = x => x.slice(5).replace('-', '/'); s += `<text x="${m.l}" y="${Hh - 4}">${dl(pts[0][0])}</text>` + (pts.length > 1 ? `<text x="${W - m.r}" y="${Hh - 4}" text-anchor="end">${dl(pts[pts.length - 1][0])}</text>` : ''); }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(o.label || '曲线')}">${s}</svg>`;
}
const ring = (pct, txt, col = 'var(--coral)', size = 48) => { const r = size / 2 - 5, c = 2 * Math.PI * r; return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--soft)" stroke-width="6"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * Math.min(100, pct) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="${size / 2}" y="${size / 2 + 4.5}" text-anchor="middle" font-size="13" font-weight="900" font-family="Nunito,sans-serif" fill="var(--ink)">${esc(txt)}</text></svg>`; };
const segBtns = (key, opts, cur) => `<div class="seg" role="group">${opts.map(([v, t]) => `<button data-set="${key}" data-v="${esc(v)}" aria-pressed="${cur === v}">${t}</button>`).join('')}</div>`;
const chipBtns = (key, opts, cur) => `<div class="chips" role="group">${opts.map(([v, t]) => `<button data-set="${key}" data-v="${esc(v)}" aria-pressed="${cur === v}">${t}</button>`).join('')}</div>`;
const dueTag = n => n === null || n === undefined ? '' : `<span class="due ${n <= 3 ? 'hot' : n <= 14 ? 'warm' : ''}">${n < 0 ? '已截止' : n === 0 ? '今天' : n + '天'}</span>`;
const mascotEmpty = t => `<div class="empty"><svg aria-hidden="true"><use href="#pot"/></svg>${esc(t)}</div>`;

/* ============ squares (skills) ============ */
function squares(it) {
  const c = cnt(it.id), n = it.type === 'grow' ? LVL : it.sq, base = it.type === 'grow' ? Math.floor(c / LVL) * LVL : 0, f = c - base;
  let h = ''; for (let i = 0; i < n; i++) h += `<i class="${i < f ? 'f' : ''}" data-sq="${it.id}" data-i="${i}"></i>`;
  return `<div class="sqs" style="--c:${COL(it.id)}" role="group" aria-label="${esc(it.n)}进度格">${h}</div>`;
}
function status(it) {
  if (it.type === 'once') return S.checks[it.id] ? '完成' : '还没做';
  const c = cnt(it.id);
  if (it.type === 'grow') return `Lv.${Math.floor(c / LVL) + 1} · ${c % LVL}/${LVL}`;
  return c >= it.sq ? '完成！' : `${c}/${it.sq}`;
}
function skCard(it) {
  const col = COL(it.id), dl = it.dl && frac(it) < 1 ? days(it.dl) : null;
  const top = Object.entries(it.b).sort((a, b) => b[1] - a[1])[0];
  return `<div class="sk" id="sk-${it.id}"><button class="sk-h" data-open="item" data-id="${it.id}"><span class="dot" style="background:${col}"></span><span class="t">${esc(it.n)}<small>${top ? esc(R[top[0]].n) + ' +' + top[1] + '%' : ''}</small></span>${dueTag(dl)}<span class="lv" style="background:color-mix(in srgb,${col} 18%,transparent);color:${col}">${esc(status(it))}</span></button>
  ${it.type === 'once' ? `<button class="chk ${S.checks[it.id] ? 'on' : ''}" data-chk="${it.id}"><span class="qbox ${S.checks[it.id] ? 'on' : ''}" style="border-color:${S.checks[it.id] ? '#fff' : ''}"><svg><use href="#i-check"/></svg></span>${S.checks[it.id] ? '已完成' : '完成了就点这里'}</button>` : squares(it)}</div>`;
}
function setCnt(id, v, ev) {
  const it = I[id], before = cnt(id), cap = it.type === 'end' ? it.sq : 9999;
  v = Math.max(0, Math.min(cap, v)); if (v === before) return;
  S.cnt[id] = v; touch();
  const el = document.getElementById('sk-' + id); if (el) el.outerHTML = skCard(it);
  const sh = document.getElementById('sheet-sq'); if (sh && sh.dataset.id === id) sh.innerHTML = squares(it);
  const lvUp = it.type === 'grow' && Math.floor(v / LVL) > Math.floor(before / LVL), doneNow = it.type === 'end' && v >= it.sq && before < it.sq;
  if (lvUp || doneNow) { const r = ev && ev.target.getBoundingClientRect ? ev.target.getBoundingClientRect() : {left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0}; confetti(r.left + r.width / 2, r.top + r.height / 2); toast(lvUp ? `「${it.n}」升到 Lv.${Math.floor(v / LVL) + 1}！` : `「${it.n}」完成！`); }
  else if (v > before) toast(`+${v - before} 经验`);
  afterChange(false);
}
let lastTap = {k: '', t: 0};
function tapSquare(el, e) {
  const id = el.dataset.sq, i = +el.dataset.i, it = I[id], c = cnt(id);
  const base = it.type === 'grow' ? Math.floor(c / LVL) * LVL : 0, k = id + ':' + i, now = Date.now();
  el.classList.add('pop');
  if (lastTap.k === k && now - lastTap.t < 380) { const b0 = lastTap.base; lastTap = {k: '', t: 0}; setCnt(id, b0 + i, e); return; }
  lastTap = {k, t: now, base};
  setCnt(id, base + i + 1, e);
}

/* ============ views ============ */
function quests() {
  const q = [];
  for (const it of D.items) if (it.dl && frac(it) < 1) { const n = days(it.dl); if (n >= 0 && n <= 30) q.push({k: 'item', id: it.id, t: it.n, sub: '截止', n, check: it.type === 'once'}); }
  for (const f of FEED) if (f.deadline && (f.status || 'new') === 'new') { const n = days(f.deadline); if (n >= 0 && n <= 14) q.push({k: 'feed', id: f.id, t: f.title, sub: f.org || f.kind, n, check: true}); }
  for (const r of D.reminders) { const n = days(r.d); if (n >= 0 && n <= 21) q.push({k: 'rem', t: r.t, sub: '日程', n}); }
  q.sort((a, b) => a.n - b.n);
  for (const t of S.todos) if (!t.done || t.d === TODAY) q.push({k: 'todo', id: t.id, t: t.t, sub: t.due ? '待办' : '', n: t.due ? days(t.due) : null, done: t.done, check: true});
  const touched = new Set(Object.keys(S.todayTap || {}).filter(k => S.todayTap[k] === TODAY));
  D.items.filter(it => it.type !== 'once' && it.s === 'now' && frac(it) < 1 && !touched.has(it.id)).sort((a, b) => gain(b) - gain(a)).slice(0, 2)
    .forEach(it => q.push({k: 'grow', id: it.id, t: `给「${it.n}」涂一格`, sub: '推荐：最能提高成功率', check: true}));
  return q;
}
function vToday() {
  const q = quests(), nf = FEED.filter(f => (f.status || 'new') === 'new').sort((a, b) => (b.imp || 0) - (a.imp || 0));
  const urgent = q.find(x => x.n !== null && x.n !== undefined && x.n <= 3 && x.k !== 'grow');
  const h = new Date().getHours(), hi = h < 11 ? '早上好' : h < 18 ? '下午好' : '晚上好';
  const tip = urgent ? `${hi}！「${urgent.t}」还剩 ${urgent.n} 天，先把它做了吧。` : nf.length ? `${hi}！有 ${nf.length} 条新情报，最重要的那条值得看看。` : `${hi}！今天涂一格，身价曲线就往上走一点。`;
  const hs = H._ev || [], wk = hs.find(p => p[0] >= ymd(new Date(Date.now() - 7 * 864e5))), delta = wk ? Math.round(ev() - wk[1]) : 0;
  return `<div class="card hero"><div class="mascot"><svg aria-hidden="true"><use href="#pot"/></svg><div class="bubble">${esc(tip)}</div></div>
  <div class="money"><div><span>期望年薪（粗估）</span><div class="n">${eur(ev())}</div>${delta ? `<span class="delta">本周 ${delta > 0 ? '+' : ''}${eur(delta)}</span>` : ''}</div><div style="text-align:right"><span>版图点亮</span><div class="n" style="font-size:26px">${lit()}%</div></div></div>
  <div class="spark" id="heroSpark"></div>
  <button class="ask" data-open="capture"><span>做完什么、花了什么、要做什么，说一句…</span><b><svg><use href="#i-spark"/></svg></b></button></div>
  <div class="card"><div class="card-h"><h2>今日任务</h2><small>${WD[new Date().getDay()] ? '周' + WD[new Date().getDay()] : ''} · ${TODAY.slice(5).replace('-', '/')}</small></div>
  ${q.length ? q.map(x => `<div class="quest ${x.done ? 'done' : ''}">${x.check ? `<button class="qbox ${x.done ? 'on' : ''}" data-q="${x.k}" data-id="${esc(x.id)}" aria-label="完成"><svg><use href="#i-check"/></svg></button>` : '<span class="qbox" style="border-style:dashed"></span>'}<span class="t" ${x.k === 'item' || x.k === 'grow' ? `data-open="item" data-id="${x.id}" style="cursor:pointer"` : x.k === 'feed' ? `data-open="feed" data-id="${esc(x.id)}" style="cursor:pointer"` : ''}>${esc(x.t)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${dueTag(x.n)}</div>`).join('') : mascotEmpty('今天没有任务，去修炼场涂几格吧')}
  <button class="link" data-open="todo">+ 加一个待办</button></div>
  <div class="card"><div class="card-h"><h2>新情报</h2><button class="link" data-tab="intel">全部 ${nf.length}</button></div>${nf.length ? nf.slice(0, 3).map(feedRow).join('') : mascotEmpty('每天早上会有新机会送到这里')}</div>
  <div class="card"><div class="card-h"><h2>身价曲线</h2><small>每天记一个点</small></div><div class="fig" id="evFig"></div></div>`;
}
function feedRow(f) {
  const imp = Math.max(0, Math.min(5, Math.round(+f.imp || 0))), n = f.deadline ? days(f.deadline) : null;
  const fresh = (f.status || 'new') === 'new' && f.found && Date.now() - Date.parse(f.found + 'T00:00:00') < 2 * 864e5;
  return `<button class="row" data-open="feed" data-id="${esc(f.id)}"><span class="badge imp${imp}">${imp}</span><span class="t">${esc(f.title)}<small>${fresh ? '<span class="tag new">新</span>' : ''}<span class="tag">${esc(f.kind || '机会')}</span>${esc(f.org || '')}</small></span>${dueTag(n)}</button>`;
}
function vIntel() {
  let body;
  if (ui.intel === 'gigs') {
    body = `<div class="card">${[...D.gigs].sort((a, b) => b.p + b.c - a.p - a.c).map((g, i) => `<button class="row" data-open="gig" data-id="${i}"><span class="badge imp${Math.min(5, g.p + 1)}">${g.p}</span><span class="t">${esc(g.n)}<small>${esc(g.pay)} · 约${g.w}周见钱</small></span></button>`).join('')}</div>`;
  } else {
    const done = ui.intel === 'done';
    const kinds = [...new Set(FEED.map(f => f.kind).filter(Boolean))];
    const list = FEED.filter(f => done ? ['done', 'dismissed'].includes(f.status) : (f.status || 'new') === 'new').filter(f => ui.kind === 'all' || f.kind === ui.kind)
      .sort((a, b) => (b.imp || 0) - (a.imp || 0) || (a.deadline ? days(a.deadline) : 999) - (b.deadline ? days(b.deadline) : 999));
    body = (kinds.length ? chipBtns('kind', [['all', '全部'], ...kinds.map(k => [k, esc(k)])], ui.kind) : '') + `<div class="card">${list.length ? list.map(feedRow).join('') : mascotEmpty(done ? '还没有处理过的情报' : '新情报每天早上 7:47 送到，按重要程度排好')}</div>`;
  }
  return `<h1>情报站</h1>${segBtns('intel', [['new', '新机会'], ['gigs', '常驻兼职'], ['done', '已处理']], ui.intel)}${body}`;
}
let MAP = null, mapLoading = false;
function loadMap() { if (MAP || mapLoading) return; mapLoading = true; fetch('map.json').then(r => r.json()).then(j => { MAP = j; if (ui.tab === 'map') render(); }).catch(() => { mapLoading = false; }); }
const regOf = {}; D.regions.forEach(g => g.ids.forEach(i => regOf[i] = g));
const mval = g => ui.metric === 'p' ? wprob(g.r) : ui.metric === 's' ? g.sal * 20 : g.val * 20;
function vMap() {
  if (ui.mapSeg === 'routes') {
    const rs = [...D.routes].sort((a, b) => prob(b) - prob(a));
    return `<h1>版图</h1>${segBtns('mapSeg', [['map', '地图'], ['routes', '路线']], 'routes')}` + rs.map(r => {
      const top = D.items.filter(it => it.b[r.id] && frac(it) < 1).sort((a, b) => b.b[r.id] * (1 - frac(b)) - a.b[r.id] * (1 - frac(a))).slice(0, 2);
      return `<div class="sk"><button class="sk-h" data-open="route" data-id="${r.id}">${ring(prob(r), prob(r) + '%')}<span class="t">${esc(r.n)}<small>见效 ${esc(r.ttl)} · 最高 ${maxp(r)}%</small></span></button><div class="mini">${top.map(it => `<button data-open="item" data-id="${it.id}">${esc(it.n)} <b>+${Math.round(it.b[r.id] * (1 - frac(it)))}%</b></button>`).join('')}</div></div>`;
    }).join('');
  }
  loadMap();
  let svg = mascotEmpty('地图加载中…');
  if (MAP) {
    const vb = MAP.view[ui.mview === 'eu' ? 'eu' : 'world'];
    const paths = MAP.countries.map(c => { const g = regOf[c.id]; if (!g) return `<path d="${c.d}" style="fill:var(--land)"/>`; const v = mval(g); const pct = ui.metric === 'p' ? Math.min(100, 10 + Math.round(v * 1.6)) : Math.max(8, v); return `<path class="rg" data-open="region" data-id="${g.id}" d="${c.d}" style="fill:color-mix(in oklab,var(--coral) ${pct}%,var(--land))"><title>${esc(g.n)}</title></path>`; }).join('');
    const r = ui.mview === 'eu' ? 2.4 : 4.5;
    const pins = D.pins.map(p => { const xy = MAP.cities[p.c]; return `<circle cx="${xy[0]}" cy="${xy[1]}" r="${r}" fill="${p.r ? 'var(--sky)' : 'var(--ink)'}" stroke="#fff" stroke-width="1.5" vector-effect="non-scaling-stroke"><title>${esc(p.n)}${p.r ? ' · ' + wprob(p.r) + '%' : ''}</title></circle>`; }).join('');
    svg = `<svg id="map" viewBox="${vb.join(' ')}" role="img" aria-label="考古职业版图">${paths}${pins}</svg>`;
  }
  const ranked = [...D.regions].sort((a, b) => mval(b) - mval(a));
  const ML = {p: '成功率', s: '工资', v: '发展价值'};
  return `<h1>版图</h1>${segBtns('mapSeg', [['map', '地图'], ['routes', '路线']], 'map')}
  <div class="card">${chipBtns('metric', [['p', '成功率'], ['s', '工资'], ['v', '发展价值']], ui.metric)}<div class="mapwrap">${svg}</div>
  <div class="legend"><span>低</span><span class="ramp"></span><span>高</span><span style="flex:1"></span>${chipBtns('mview', [['world', '世界'], ['eu', '欧洲中东']], ui.mview).replace('class="chips"', 'class="chips" style="padding:0"')}</div></div>
  <div class="card"><div class="card-h"><h2>地区排行</h2><small>按${ML[ui.metric]}</small></div>${ranked.map((g, i) => `<button class="row" data-open="region" data-id="${g.id}"><span class="badge ${i < 3 ? 'imp4' : 'imp1'}">${i + 1}</span><span class="t">${esc(g.n)}<small>${esc(g.salT)}</small></span><span class="n" style="font-size:18px">${ui.metric === 'p' ? wprob(g.r) + '%' : '★'.repeat(ui.metric === 's' ? g.sal : g.val)}</span></button>`).join('')}</div>
  <div class="card"><div class="card-h"><h2>版图点亮曲线</h2><small>${lit()}%</small></div><div class="fig" id="litFig"></div></div>`;
}
function vDig() {
  const {x, lv, a, b} = level(), total = D.items.reduce((s, it) => s + (it.type === 'once' ? 0 : cnt(it.id)), 0);
  const f = ui.dig;
  const list = D.items.filter(it => !it.pin && (f === 'all' ? it.s !== 'route' : f === 'now' ? it.s === 'now' : f === 'later' ? it.s !== 'now' : true))
    .sort((p, q) => (q.dl && frac(q) < 1 ? 1 : 0) - (p.dl && frac(p) < 1 ? 1 : 0) || q.v - p.v || frac(q) - frac(p));
  return `<h1>修炼场</h1><div class="card"><div class="card-h"><h2>Lv.${lv} ${TITLES[Math.min(lv - 1, TITLES.length - 1)]}</h2><small>${x - a}/${b - a} 经验</small></div><div class="meter"><i style="width:${Math.round((x - a) / (b - a) * 100)}%;background:var(--mint)"></i></div>
  <p class="hint">点一格＝涂到这里，双击一格＝擦掉它。已经涂了 ${total} 格。也可以直接点「说一句」告诉我你做了什么。</p></div>
  ${chipBtns('dig', [['all', '主线'], ['now', '现在能做'], ['later', '以后'], ['every', '全部']], f)}
  ${D.items.filter(it => it.pin).map(skCard).join('')}${list.map(skCard).join('')}`;
}
function sumRange(from) { let i = 0, o = 0; for (const e of L.entries) if (e.d >= from && e.d <= TODAY) { if (e.t === 'in') i += +e.a; else o += +e.a; } return [i, o]; }
function vWallet() {
  const now = new Date(), mon = new Date(now); mon.setDate(now.getDate() - (now.getDay() + 6) % 7);
  const R3 = [['本周', ymd(mon)], ['本月', TODAY.slice(0, 8) + '01'], ['今年', TODAY.slice(0, 5) + '01-01']];
  const [mi, mo] = sumRange(R3[1][1]), rate = mi > 0 ? Math.max(0, Math.min(100, Math.round((mi - mo) / mi * 100))) : 0;
  const months = []; for (let k = 5; k >= 0; k--) months.push(ymd(new Date(now.getFullYear(), now.getMonth() - k, 1)).slice(0, 7));
  const mt = months.map(m => { let i = 0, o = 0; for (const e of L.entries) if (e.d.slice(0, 7) === m) { if (e.t === 'in') i += +e.a; else o += +e.a; } return [m, i, o]; });
  const mx = Math.max(1, ...mt.flatMap(x => [x[1], x[2]]));
  const list = [...L.entries].sort((a, b) => b.d.localeCompare(a.d) || String(b.id).localeCompare(String(a.id))).slice(0, 50);
  const ICON = {'吃饭': ['饭', '#ff9b54'], '房租': ['房', '#9b87f5'], '交通': ['行', '#4da8ff'], '学习': ['学', '#21b892'], '田野': ['野', '#e0a23b'], '娱乐': ['玩', '#ff7a8a']};
  return `<h1>钱包</h1><div class="stats">${R3.map(([t, from]) => { const [i, o] = sumRange(from); return `<div class="stat"><span>${t}结余</span><div class="n ${i - o < 0 ? 'neg' : ''}">${eur(i - o)}</div><span style="font-weight:500">+${eur(i)} / −${eur(o).replace('€', '€')}</span></div>`; }).join('')}</div>
  <div class="card" style="margin-top:14px"><div class="card-h"><h2>本月存钱罐</h2><button class="btn pri" data-open="ledger">记一笔</button></div>
  <div style="display:flex;gap:16px;align-items:center"><svg width="92" height="104" viewBox="0 0 92 104" aria-hidden="true"><defs><clipPath id="jarC"><path d="M27 10h38v10c13 8 19 20 19 34 0 25-17 42-38 42S8 79 8 54c0-14 6-26 19-34z"/></clipPath></defs><rect x="0" y="${104 - rate * .96}" width="92" height="104" fill="var(--butter)" clip-path="url(#jarC)"/><path d="M27 10h38v10c13 8 19 20 19 34 0 25-17 42-38 42S8 79 8 54c0-14 6-26 19-34z" fill="none" stroke="var(--ink)" stroke-width="3.5"/><rect x="24" y="5" width="44" height="8" rx="4" fill="var(--ink)"/></svg>
  <div><div class="n" style="font-size:40px;color:var(--coral)">${rate}%</div><div style="color:var(--quiet);font-size:14px">本月收入里存下来的比例<br>直接说「午饭12欧」也能记</div></div></div>
  <div class="bars">${mt.map(([m, i, o]) => `<div class="b"><span>${m.slice(5)}月</span><div><i style="width:${i / mx * 100}%;background:var(--mint)"></i><i style="width:${o / mx * 100}%;background:var(--coral)"></i></div></div>`).join('')}</div><div class="legend"><span style="color:var(--mint)">● 收入</span><span style="color:var(--coral)">● 支出</span></div></div>
  <div class="card"><div class="card-h"><h2>最近记录</h2></div>${list.length ? list.map(e => { const ic = e.t === 'in' ? ['收', '#21b892'] : ICON[e.c] || ['支', '#8a7f8e']; return `<div class="ent"><span class="ic" style="background:color-mix(in srgb,${ic[1]} 18%,transparent);color:${ic[1]}">${ic[0]}</span><span class="t">${esc(e.c)}${e.n ? ' · ' + esc(e.n) : ''}<small>${esc(e.d.slice(5).replace('-', '/'))}</small></span><span class="n ${e.t === 'in' ? 'pos' : ''}">${e.t === 'in' ? '+' : '−'}${eur(e.a)}</span><button class="x" data-delled="${esc(e.id)}" aria-label="删除">×</button></div>`; }).join('') : mascotEmpty('记下第一笔，存钱罐就开始装东西了')}</div>`;
}

/* ============ render ============ */
function header() {
  const {lv} = level(); $('#lvl').querySelector('b').textContent = 'Lv.' + lv;
  $('#streak').querySelector('b').textContent = streak(); $('#streak').title = '连续记录天数';
  const n = FEED.filter(f => (f.status || 'new') === 'new').length, c = $('#cnt'); c.hidden = !n; c.textContent = n;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === ui.tab));
}
function render() {
  header();
  V.innerHTML = ({today: vToday, intel: vIntel, map: vMap, dig: vDig, wallet: vWallet})[ui.tab]() + '<p class="foot">成功率和期望年薪都是按你现在的背景做的粗估。期望年薪＝最有把握那条路线的成功率 × 典型年薪。</p>';
  if (ui.tab === 'today') { chart($('#heroSpark'), H._ev, {bare: true, color: '#fff', empty: ''}); chart($('#evFig'), H._ev, {fmt: v => '€' + Math.round(v / 1000) + 'k', label: '期望年薪'}); }
  if (ui.tab === 'map' && ui.mapSeg !== 'routes') chart($('#litFig'), H._lit, {max: 100, label: '版图点亮'});
}
function afterChange(full = true) { touch(); logHist(); save('state'); if (full) render(); else header(); }

/* ============ sheets ============ */
let sheetKind = null;
function openSheet(html, after) { $('#sheetBody').innerHTML = html; $('#sheet').classList.add('on'); $('#scrim').classList.add('on'); $('#sheet').scrollTop = 0; if (after) requestAnimationFrame(after); }
function closeSheet() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); sheetKind = null; render(); }
const linkBtns = l => (l || []).map((x, i) => safeUrl(x[1]) ? `<a class="btn ${i ? '' : 'pri'}" href="${esc(x[1])}" target="_blank" rel="noopener">${esc(x[0])}</a>` : '').join('');
function itemSheet(id) {
  const it = I[id]; if (!it) return; sheetKind = 'item';
  const SN = {now: '现在能做', exp: '需要经验', route: '选定路线后', later: '之后完成'};
  openSheet(`<h3><span class="dot" style="display:inline-block;background:${COL(id)};margin-right:8px"></span>${esc(it.n)}</h3><div class="sub">${SN[it.s]} · ${esc(status(it))}</div>
  ${it.type === 'once' ? `<button class="chk ${S.checks[id] ? 'on' : ''}" data-chk="${id}">${S.checks[id] ? '已完成，点一下撤销' : '完成了就点这里'}</button>` : `<div id="sheet-sq" data-id="${id}">${squares(it)}</div><p class="hint">点一格＝涂到这里，双击一格＝擦掉它。${it.type === 'grow' ? `每涂满 ${LVL} 格升一级，累计 ${it.tgt} 格时加成拉满。` : `共 ${it.sq} 格，涂满＝完成。`}</p><div class="fig" id="itemFig"></div>`}
  <div class="mini" style="margin-top:12px">${Object.entries(it.b).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<button data-open="route" data-id="${k}">${esc(R[k].n)} <b>+${v}%</b></button>`).join('')}</div>
  <dl class="kv"><dt>费用</dt><dd>${esc(it.cost)}</dd><dt>时间</dt><dd>${esc(it.time)}</dd><dt>条件</dt><dd>${esc(it.req)}</dd>${it.dl ? `<dt>截止</dt><dd>${it.dl}（${days(it.dl)}天）</dd>` : ''}</dl><p>${esc(it.desc)}</p><div class="btns">${linkBtns(it.l)}</div>`,
  () => { if (it.type !== 'once') chart($('#itemFig'), H[id], {max: 100, label: it.n, color: COL(id), empty: '涂第一格后开始画线'}); });
}
function routeSheet(id) {
  const r = R[id]; if (!r) return; sheetKind = 'route';
  const need = D.items.filter(it => it.b[id]).sort((a, b) => b.b[id] * (1 - frac(b)) - a.b[id] * (1 - frac(a)));
  openSheet(`<div style="display:flex;gap:14px;align-items:center">${ring(prob(r), prob(r) + '%', 'var(--coral)', 64)}<div><h3>${esc(r.n)}</h3><div class="sub" style="margin:0">见效 ${esc(r.ttl)} · 全部做完最高 ${maxp(r)}%</div></div></div>
  <p>${esc(r.incT)}</p><div class="card" style="padding:12px 14px">${need.map(it => `<button class="row" data-open="item" data-id="${it.id}"><span class="dot" style="background:${COL(it.id)}"></span><span class="t">${esc(it.n)}<small>${esc(status(it))}</small></span><span class="n" style="color:var(--coral)">+${Math.round(it.b[id] * frac(it))}/${it.b[id]}</span></button>`).join('')}</div>
  <ul style="padding-left:20px">${r.info.map(x => `<li>${esc(x)}</li>`).join('')}</ul><div class="btns">${linkBtns(r.links)}</div>`);
}
function regionSheet(id) {
  const g = D.regions.find(x => x.id === id); if (!g) return; sheetKind = 'region';
  const rs = Object.entries(g.r).map(([k, w]) => [R[k], Math.round(prob(R[k]) * w)]).sort((a, b) => b[1] - a[1]);
  openSheet(`<div style="display:flex;gap:14px;align-items:center">${ring(wprob(g.r), wprob(g.r) + '%', 'var(--coral)', 64)}<div><h3>${esc(g.n)}</h3><div class="sub" style="margin:0">现在找到不错工作的成功率</div></div></div>
  <dl class="kv"><dt>工资</dt><dd>${esc(g.salT)}</dd><dt>评分</dt><dd>工资 ${'★'.repeat(g.sal)} · 发展 ${'★'.repeat(g.val)}</dd></dl><p>${esc(g.note)}</p>
  <div class="card" style="padding:12px 14px">${rs.map(([r, p]) => `<button class="row" data-open="route" data-id="${r.id}"><span class="t">${esc(r.n)}</span><span class="n" style="color:var(--coral)">${p}%</span></button>`).join('')}</div>`);
}
function feedSheet(id) {
  const f = FEED.find(x => x.id === id); if (!f) return; sheetKind = 'feed';
  const st = f.status || 'new', imp = Math.max(0, Math.min(5, Math.round(+f.imp || 0)));
  openSheet(`<div style="display:flex;gap:12px;align-items:center"><span class="badge imp${imp}">${imp}</span><div><h3>${esc(f.title)}</h3><div class="sub" style="margin:0">${esc(f.org || '')}</div></div></div>
  <dl class="kv"><dt>类型</dt><dd>${esc(f.kind || '机会')}</dd>${f.pay ? `<dt>报酬</dt><dd>${esc(f.pay)}</dd>` : ''}${f.loc ? `<dt>地点</dt><dd>${esc(f.loc)}</dd>` : ''}${f.deadline ? `<dt>截止</dt><dd>${esc(f.deadline)}（${days(f.deadline)}天）</dd>` : ''}${f.found ? `<dt>发现</dt><dd>${esc(f.found)}</dd>` : ''}</dl><p>${esc(f.why || '')}</p>
  <div class="btns">${safeUrl(f.link) ? `<a class="btn pri" href="${esc(f.link)}" target="_blank" rel="noopener">打开链接</a>` : ''}${st === 'new' ? `<button class="btn ok" data-fs="done" data-id="${esc(f.id)}">处理完了</button><button class="btn" data-fs="dismissed" data-id="${esc(f.id)}">不感兴趣</button>` : `<button class="btn" data-fs="new" data-id="${esc(f.id)}">放回新机会</button>`}</div>`);
}
function gigSheet(i) {
  const g = [...D.gigs].sort((a, b) => b.p + b.c - a.p - a.c)[i]; if (!g) return; sheetKind = 'gig';
  const dots = v => '●'.repeat(v) + '○'.repeat(5 - v);
  openSheet(`<h3>${esc(g.n)}</h3><div class="sub">${esc(g.pay)}</div><dl class="kv"><dt>收入</dt><dd>${dots(g.p)}</dd><dt>机会</dt><dd>${dots(g.c)}</dd><dt>职业</dt><dd>${dots(g.k)}</dd><dt>见钱</dt><dd>约 ${g.w} 周</dd><dt>怎么做</dt><dd>${esc(g.how)}</dd><dt>注意</dt><dd>${esc(g.warn)}</dd></dl><div class="btns">${linkBtns(g.l)}</div>`);
}
function ledgerSheet() {
  sheetKind = 'ledger'; const t = ui.ltype || 'out';
  openSheet(`<h3>记一笔</h3><div class="sub">也可以在「说一句」里直接说：午饭12欧、兼职收入300</div>${segBtns('ltype', [['out', '支出'], ['in', '收入']], t)}
  <form id="ledF"><input id="lAmt" type="number" inputmode="decimal" min="0" step="0.01" placeholder="金额 €" aria-label="金额" style="font-size:28px;font-weight:900;font-family:Nunito,sans-serif">
  <div class="chips" style="margin-top:10px">${D.cats[t].map((c, i) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${i === 0}">${esc(c)}</button>`).join('')}</div>
  <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px"><input id="lDate" type="date" value="${TODAY}" aria-label="日期"><input id="lNote" maxlength="60" placeholder="备注" aria-label="备注"></div>
  <div class="btns"><button class="btn pri" style="flex:1;justify-content:center">记上</button></div></form>`, () => $('#lAmt').focus());
}
function todoSheet() {
  sheetKind = 'todo';
  openSheet(`<h3>加一个待办</h3><form id="todoF"><input id="todoIn" maxlength="80" placeholder="比如：给AFALULA项目负责人写邮件" aria-label="待办"><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:8px"><input id="todoDue" type="date" aria-label="截止日期（可不填）"><button class="btn pri">添加</button></div></form>`, () => $('#todoIn').focus());
}

/* ============ 说一句: understand, then confirm ============ */
const EXAMPLES = ['A1/A3考过了', '学了两小时德语', '午饭12欧', '周五前给教授发邮件', 'Mercor那个申请了'];
let capture = null;
function captureSheet(pre = '') {
  sheetKind = 'capture'; capture = {text: pre, actions: [], reply: ''};
  openSheet(`<h3>说一句</h3><div class="sub">做完了什么、花了什么钱、要做什么。我来找对应的项目，你确认就记上。</div>
  <form id="capF"><textarea id="capIn" maxlength="300" placeholder="比如：今天学了一小时德语，午饭花了12欧" aria-label="说一句">${esc(pre)}</textarea>
  <div class="ex">${EXAMPLES.map(e => `<button type="button" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
  <div class="btns"><button class="btn pri" style="flex:1;justify-content:center"><svg width="18" height="18"><use href="#i-spark"/></svg>识别</button></div></form><div id="capOut"></div>`, () => $('#capIn').focus());
}
function bigrams(s) { s = String(s).toLowerCase(); const out = new Set(); for (const w of s.match(/[a-z0-9]+(?:[/-][a-z0-9]+)*/g) || []) out.add(w); const cj = s.replace(/[^一-鿿]/g, ' '); for (const seg of cj.split(/\s+/)) { for (let i = 0; i < seg.length - 1; i++) out.add(seg.slice(i, i + 2)); if (seg.length === 1) out.add(seg); } return out; }
function matchItems(text) {
  const tb = bigrams(text), low = text.toLowerCase();
  return D.items.map(it => {
    let s = 0; for (const a of [it.n, ...(D.alias[it.id] || [])]) { const al = a.toLowerCase(); if (low.includes(al)) s = Math.max(s, 2 + al.length / 10); const ab = bigrams(a); let hit = 0; ab.forEach(x => { if (tb.has(x)) hit++; }); if (ab.size) s = Math.max(s, hit / ab.size); }
    return [it.id, s];
  }).filter(x => x[1] > .34).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}
const CN = {'一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '半': .5};
function dueFrom(t) {
  const d = new Date(); if (/后天/.test(t)) { d.setDate(d.getDate() + 2); return ymd(d); } if (/明天/.test(t)) { d.setDate(d.getDate() + 1); return ymd(d); }
  const m = t.match(/(下)?(周|星期|礼拜)([一二三四五六日天])/); if (m) { const w = '日一二三四五六'.indexOf(m[3] === '天' ? '日' : m[3]); let k = (w - d.getDay() + 7) % 7 || 7; if (m[1]) k += 7; d.setDate(d.getDate() + k); return ymd(d); }
  const m2 = t.match(/(\d{1,2})[月/.](\d{1,2})/); if (m2) { const y = new Date(d.getFullYear(), +m2[1] - 1, +m2[2]); if (y < d) y.setFullYear(y.getFullYear() + 1); return ymd(y); }
  return null;
}
function localParse(text) {
  const acts = [], parts = text.split(/[，,。；;！!\n]|然后|还有|并且/).map(s => s.trim()).filter(Boolean);
  for (const p of parts) {
    const mm = p.match(/(?:€\s*(\d+(?:[.,]\d+)?))|(\d+(?:[.,]\d+)?)\s*(?:€|欧元?|eur(?:o|os)?|块)/i);
    if (mm) {
      const amount = parseFloat((mm[1] || mm[2]).replace(',', '.')), dir = /(收入|赚|工资|进账|收到|奖学金|报酬|稿费|发了|打来|给我)/.test(p) ? 'in' : 'out';
      const C = dir === 'in' ? [['兼职收入', /(兼职|工资|报酬|稿费|赚)/], ['奖学金', /(奖学金|资助|补贴)/], ['家里支持', /(爸|妈|家里)/]] : [['房租', /(房租|租金)/], ['吃饭', /(饭|餐|咖啡|吃|超市|买菜|外卖|零食|奶茶)/], ['交通', /(车|火车|地铁|公交|机票|油|打车)/], ['学习', /(书|课|考试|报名|学费|教材)/], ['田野', /(发掘|田野|工地|装备)/], ['娱乐', /(电影|玩|旅游|酒|演出|门票)/]];
      const cat = (C.find(c => c[1].test(p)) || [dir === 'in' ? '其他收入' : '其他'])[0];
      acts.push({kind: 'money', dir, amount, cat, note: p.replace(mm[0], '').replace(/(花了|花|用了|收入|收到)/g, '').trim().slice(0, 30), date: /昨天/.test(p) ? ymd(new Date(Date.now() - 864e5)) : TODAY});
      continue;
    }
    const fm = FEED.filter(f => (f.status || 'new') === 'new').map(f => { const fb = bigrams(f.title + ' ' + (f.org || '')), pb = bigrams(p); let h = 0; pb.forEach(x => { if (fb.has(x)) h++; }); return [f.id, h]; }).filter(x => x[1] >= 1).sort((a, b) => b[1] - a[1]);
    if (fm.length && /(申请|投了|报了|不感兴趣|不要了|处理|搞定)/.test(p)) { acts.push({kind: 'feed', feed: fm[0][0], status: /不感兴趣|不要/.test(p) ? 'dismissed' : 'done', alts: fm.slice(1, 3).map(x => x[0])}); continue; }
    const ot = S.todos.filter(t => !t.done).map(t => { const tb = bigrams(t.t), pb = bigrams(p); let h = 0; pb.forEach(x => { if (tb.has(x)) h++; }); return [t.id, h / Math.max(1, tb.size)]; }).filter(x => x[1] > .4).sort((a, b) => b[1] - a[1]);
    if (ot.length && /(完成|做完|发了|搞定|弄好)/.test(p)) { acts.push({kind: 'todo_done', todo: ot[0][0]}); continue; }
    const its = matchItems(p);
    if (its.length && !/(提醒|记得|要去|得去|待办)/.test(p)) {
      if (/(考过|通过|拿到|完成|搞定|结束|提交|申请了|交了|毕业)/.test(p)) acts.push({kind: 'complete', item: its[0], alts: its.slice(1, 3)});
      else { const h = p.match(/(\d+(?:\.\d+)?|[一两二三四五六七八九十半])\s*(?:个)?(?:小时|h|钟头)/i); let add = 1; if (h) add = Math.max(1, Math.round(isNaN(+h[1]) ? CN[h[1]] : +h[1])); acts.push({kind: 'progress', item: its[0], add: Math.min(10, add), alts: its.slice(1, 3)}); }
      continue;
    }
    if (p.length >= 2) acts.push({kind: 'todo', text: p.replace(/^(提醒我|记得|我要|要)/, '').trim(), due: dueFrom(p)});
  }
  return {reply: acts.length ? '找到这些，帮你对一下：' : '', actions: acts};
}
function cleanActs(r) {
  const out = [];
  for (const a of (r && Array.isArray(r.actions) ? r.actions : [])) {
    if (!a || typeof a !== 'object') continue;
    const alts = (Array.isArray(a.alts) ? a.alts : []).map(String).filter(x => I[x] && x !== a.item).slice(0, 2);
    if ((a.kind === 'progress' || a.kind === 'complete') && I[a.item]) out.push({kind: a.kind, item: String(a.item), add: Math.max(1, Math.min(10, Math.round(+a.add || 1))), alts});
    else if (a.kind === 'money' && +a.amount > 0) { const dir = a.dir === 'in' ? 'in' : 'out'; out.push({kind: 'money', dir, amount: Math.round(+a.amount * 100) / 100, cat: D.cats[dir].includes(a.cat) ? a.cat : D.cats[dir][D.cats[dir].length - 1], note: String(a.note || '').slice(0, 40), date: /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : TODAY}); }
    else if (a.kind === 'todo' && a.text) out.push({kind: 'todo', text: String(a.text).slice(0, 80), due: /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : null});
    else if (a.kind === 'todo_done' && S.todos.find(t => t.id === a.todo)) out.push({kind: 'todo_done', todo: String(a.todo)});
    else if (a.kind === 'feed' && FEED.find(f => f.id === a.feed)) out.push({kind: 'feed', feed: String(a.feed), status: a.status === 'dismissed' ? 'dismissed' : 'done', alts: []});
    else if (a.kind === 'note' && a.text) out.push({kind: 'note', text: String(a.text).slice(0, 120)});
  }
  return out;
}
async function understand(text) {
  const out = $('#capOut'); out.innerHTML = `<div class="thinking"><i></i><i></i><i></i>${ask ? 'Claude 正在理解…' : '正在识别…'}</div>`;
  let r = null, via = 'local';
  if (ask) {
    const cat = D.items.map(it => `${it.id}｜${it.n}｜${it.type === 'once' ? '一次性' : it.type === 'end' ? '共' + it.sq + '格' : '无终点，每20格升一级'}｜${(D.alias[it.id] || []).join('/')}`).join('\n');
    const todos = S.todos.filter(t => !t.done).map(t => `${t.id}｜${t.t}`).join('\n') || '（无）';
    const feeds = FEED.filter(f => (f.status || 'new') === 'new').slice(0, 40).map(f => `${f.id}｜${f.title}｜${f.org || ''}`).join('\n') || '（无）';
    const prompt = `你是一个个人职业追踪App的输入解析器。用户用一句话记录她做了什么、花了什么钱、要做什么。今天是${TODAY}（星期${WD[new Date().getDay()]}）。\n\n用户输入：「${text}」\n\n【长期项目目录】id｜名称｜类型｜别名\n${cat}\n\n【未完成待办】id｜内容\n${todos}\n\n【情报】id｜标题｜机构\n${feeds}\n\n【记账类别】支出：${D.cats.out.join('、')}；收入：${D.cats.in.join('、')}\n\n只回复一个JSON对象：{"reply":"不超过30字的中文回应，亲切自然","actions":[...]}。actions每项是以下之一：\n{"kind":"progress","item":"目录id","add":格数整数(默认1；说了小时就每小时1格，最多10),"alts":["其他可能的id"]} 练习、学习、推进了某个长期项目\n{"kind":"complete","item":"目录id","alts":[...]} 考过、拿到、提交、完成了某项\n{"kind":"money","dir":"out"或"in","amount":数字,"cat":"类别之一","note":"简短备注","date":"YYYY-MM-DD"}\n{"kind":"todo","text":"待办内容","due":"YYYY-MM-DD或null"}\n{"kind":"todo_done","todo":"待办id"}\n{"kind":"feed","feed":"情报id","status":"done"或"dismissed"} 申请了、处理了或不感兴趣某条情报\n{"kind":"note","text":"目录里没有对应项目的成就，简述"}\n规则：只用上面给出的id；拿不准时把最可能的放在item，另外最多2个放进alts；金额只用用户说的数字；一句话里有几件事就给几个action；没有可记的就给空数组。`;
    try { r = await ask.json(prompt, {modelTier: 'quick', cache: false}); via = 'claude'; }
    catch (e) { if (e && e.code === 'not_granted') ask = null; r = null; }
  }
  if (!r) r = localParse(text);
  capture.actions = cleanActs(r).map(a => Object.assign(a, {done: false}));
  capture.reply = String((r && r.reply) || '').slice(0, 60);
  drawActs(via);
}
function actHtml(a, i) {
  let ic = ['记', 'var(--coral)'], title = '', q = '', alts = '';
  if (a.kind === 'progress' || a.kind === 'complete') {
    const it = I[a.item]; ic = [a.kind === 'complete' ? '✓' : '+' + a.add, COL(a.item)];
    title = a.kind === 'complete' ? `完成「${it.n}」` : `给「${it.n}」涂 ${a.add} 格`;
    q = '是这一项吗？'; alts = `<div class="alts">${[a.item, ...a.alts].map(id => `<button data-pick="${i}" data-v="${id}" aria-pressed="${id === a.item}">${esc(I[id].n)}</button>`).join('')}<button data-pick="${i}" data-v="__more" aria-pressed="false">都不是…</button></div>`;
  } else if (a.kind === 'money') {
    ic = [a.dir === 'in' ? '收' : '支', a.dir === 'in' ? 'var(--mint)' : 'var(--coral)'];
    title = `${a.dir === 'in' ? '收入' : '支出'} ${eur(a.amount)}${a.note ? ' · ' + a.note : ''}`; q = `类别（${a.date.slice(5).replace('-', '/')}）`;
    alts = `<div class="alts">${D.cats[a.dir].map(c => `<button data-cat2="${i}" data-v="${esc(c)}" aria-pressed="${c === a.cat}">${esc(c)}</button>`).join('')}</div>`;
  } else if (a.kind === 'todo') { ic = ['待', 'var(--sky)']; title = `新待办：${a.text}`; q = a.due ? `截止 ${a.due.slice(5).replace('-', '/')}` : '没有截止日期'; }
  else if (a.kind === 'todo_done') { ic = ['✓', 'var(--mint)']; title = `完成待办：${(S.todos.find(t => t.id === a.todo) || {}).t || ''}`; }
  else if (a.kind === 'feed') { const f = FEED.find(x => x.id === a.feed) || {}; ic = ['情', 'var(--butter)']; title = `「${f.title || ''}」标为${a.status === 'done' ? '处理完了' : '不感兴趣'}`; }
  else if (a.kind === 'note') { ic = ['?', 'var(--quiet)']; title = a.text; q = '这件事目录里还没有对应项目。告诉 Claude 一声，就能加进来并调整成功率。'; }
  return `<div class="act ${a.done ? 'done' : ''}"><div class="h"><span class="ic" style="background:${ic[1]}">${esc(ic[0])}</span><span style="flex:1">${esc(title)}</span></div>${q ? `<div class="q">${esc(q)}</div>` : ''}${a.done ? '' : alts}
  ${a.done ? '<div class="q">已记上</div>' : a.kind === 'note' ? '' : `<div class="btns"><button class="btn ok" data-apply="${i}">记上</button><button class="btn" data-skip="${i}">不用</button></div>`}</div>`;
}
function drawActs(via) {
  const out = $('#capOut'); if (!out) return;
  const live = capture.actions.filter(a => !a.done && a.kind !== 'note').length;
  out.innerHTML = capture.actions.length
    ? `<div class="mascot" style="display:flex;gap:10px;align-items:center;margin-top:14px"><svg width="44" height="44" aria-hidden="true"><use href="#pot"/></svg><div class="bubble" style="background:var(--card);box-shadow:var(--sh)">${esc(capture.reply || '找到这些，帮你对一下：')}</div></div>${capture.actions.map(actHtml).join('')}${live > 1 ? `<div class="btns"><button class="btn pri" data-applyall="1" style="flex:1;justify-content:center">全部记上（${live}）</button></div>` : ''}<p class="hint">${via === 'claude' ? '由 Claude 识别' : '本机识别'}，不对就点别的选项或「不用」。</p>`
    : mascotEmpty('没找到可以记的内容。换个说法试试，比如「学了一小时德语」或「午饭12欧」。');
}
function applyAct(i, silent) {
  const a = capture.actions[i]; if (!a || a.done) return;
  if (a.kind === 'progress') setCnt(a.item, (I[a.item].type === 'grow' ? cnt(a.item) : Math.min(I[a.item].sq, cnt(a.item))) + a.add);
  else if (a.kind === 'complete') { const it = I[a.item]; if (it.type === 'once') S.checks[a.item] = true; else if (it.type === 'end') setCnt(a.item, it.sq); else setCnt(a.item, (Math.floor(cnt(a.item) / LVL) + 1) * LVL); }
  else if (a.kind === 'money') { L.entries.push({id: 'e' + Date.now().toString(36) + i, d: a.date, t: a.dir, a: a.amount, c: a.cat, n: a.note}); save('ledger'); }
  else if (a.kind === 'todo') S.todos.push({id: 't' + Date.now().toString(36) + i, t: a.text, done: false, d: TODAY, due: a.due});
  else if (a.kind === 'todo_done') { const t = S.todos.find(x => x.id === a.todo); if (t) { t.done = true; t.d = TODAY; } }
  else if (a.kind === 'feed') setFeed(a.feed, a.status, true);
  a.done = true; afterChange(false);
  if (!silent) { drawActs(); if (a.kind === 'complete') confetti(innerWidth / 2, innerHeight * .4); toast('记上了！'); }
}
async function setFeed(id, status, quiet) {
  const f = FEED.find(x => x.id === id); if (!f) return;
  f.status = status; LS.set('feed', FEED); touch(); save('state');
  if (!quiet) { toast(status === 'done' ? '+5 经验' : status === 'new' ? '放回去了' : '好的，不再显示'); }
  if (db) { try { await db.doc('feed/' + id).update({status}); } catch (e) { toast('没能存到云端'); } }
}

/* ============ events ============ */
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-t]'); if (!b) return; ui.tab = b.dataset.t; saveUi(); render(); scrollTo({top: 0}); });
$('#fab').addEventListener('click', () => captureSheet());
$('#scrim').addEventListener('click', closeSheet);
addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheet').classList.contains('on')) closeSheet(); });
function onClick(e) {
  const t = e.target;
  const sq = t.closest('[data-sq]'); if (sq) { tapSquare(sq, e); if (sheetKind === 'item') chart($('#itemFig'), H[sq.dataset.sq], {max: 100, color: COL(sq.dataset.sq)}); return; }
  const set = t.closest('[data-set]'); if (set) {
    const k = set.dataset.set, v = set.dataset.v; ui[k] = v; saveUi();
    if (k === 'ltype') { ledgerSheet(); return; }
    render(); return;
  }
  const op = t.closest('[data-open]'); if (op) {
    const k = op.dataset.open, id = op.dataset.id;
    ({item: () => itemSheet(id), route: () => routeSheet(id), region: () => regionSheet(id), feed: () => feedSheet(id), gig: () => gigSheet(+id), capture: () => captureSheet(), ledger: ledgerSheet, todo: todoSheet})[k]?.();
    return;
  }
  const tb = t.closest('[data-tab]'); if (tb) { ui.tab = tb.dataset.tab; saveUi(); render(); scrollTo({top: 0}); return; }
  const ck = t.closest('[data-chk]'); if (ck) { const id = ck.dataset.chk; S.checks[id] = !S.checks[id]; if (S.checks[id]) { const r = ck.getBoundingClientRect(); confetti(r.left + r.width / 2, r.top); toast('+20 经验！'); } afterChange(true); if (sheetKind === 'item') itemSheet(id); return; }
  const qb = t.closest('[data-q]'); if (qb) {
    const k = qb.dataset.q, id = qb.dataset.id;
    if (k === 'todo') { const x = S.todos.find(y => y.id === id); if (x) { x.done = !x.done; x.d = TODAY; if (x.done) toast('+2 经验'); } afterChange(true); }
    else if (k === 'item') { S.checks[id] = true; confetti(innerWidth / 2, innerHeight / 3); toast('完成！'); afterChange(true); }
    else if (k === 'feed') { setFeed(id, 'done'); render(); }
    else if (k === 'grow') { S.todayTap = S.todayTap || {}; S.todayTap[id] = TODAY; setCnt(id, cnt(id) + 1); render(); }
    return;
  }
  const fs = t.closest('[data-fs]'); if (fs) { setFeed(fs.dataset.id, fs.dataset.fs); closeSheet(); return; }
  const dl = t.closest('[data-delled]'); if (dl) { if (dl.dataset.armed) { L.entries = L.entries.filter(x => x.id !== dl.dataset.delled); save('ledger'); render(); } else { dl.dataset.armed = 1; dl.textContent = '删?'; setTimeout(() => { if (dl.isConnected) { delete dl.dataset.armed; dl.textContent = '×'; } }, 2500); } return; }
  const ex = t.closest('[data-ex]'); if (ex) { $('#capIn').value = ex.dataset.ex; $('#capIn').focus(); return; }
  const pk = t.closest('[data-pick]'); if (pk) { const a = capture.actions[+pk.dataset.pick]; if (pk.dataset.v === '__more') { const cands = matchItems($('#capIn').value || '').filter(x => x !== a.item && !a.alts.includes(x)).slice(0, 4); const pool = cands.length ? cands : D.items.filter(x => x.s === 'now' && x.id !== a.item && !a.alts.includes(x.id)).sort((p, q) => q.v - p.v).slice(0, 4).map(x => x.id); a.alts = [...a.alts, ...pool].slice(0, 6); } else a.item = pk.dataset.v; drawActs(); return; }
  const c2 = t.closest('[data-cat2]'); if (c2) { capture.actions[+c2.dataset.cat2].cat = c2.dataset.v; drawActs(); return; }
  const ap = t.closest('[data-apply]'); if (ap) { applyAct(+ap.dataset.apply); return; }
  const sk = t.closest('[data-skip]'); if (sk) { capture.actions.splice(+sk.dataset.skip, 1); drawActs(); return; }
  const aa = t.closest('[data-applyall]'); if (aa) { capture.actions.forEach((a, i) => { if (!a.done && a.kind !== 'note') applyAct(i, true); }); drawActs(); confetti(innerWidth / 2, innerHeight * .4); cheer(); toast('全部记上了！'); return; }
  const cat = t.closest('[data-cat]'); if (cat) { cat.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b === cat)); return; }
}
V.addEventListener('click', onClick);
$('#sheet').addEventListener('click', onClick);
$('#sheet').addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'capF') { const v = $('#capIn').value.trim(); if (v) understand(v); }
  if (e.target.id === 'ledF') {
    const a = parseFloat($('#lAmt').value); if (!(a > 0)) { toast('先填金额'); return; }
    const c = ($('#ledF .chips [aria-pressed=true]') || {}).dataset?.cat || D.cats[ui.ltype || 'out'][0];
    L.entries.push({id: 'e' + Date.now().toString(36), d: $('#lDate').value || TODAY, t: ui.ltype || 'out', a: Math.round(a * 100) / 100, c, n: $('#lNote').value.trim().slice(0, 60)});
    save('ledger'); touch(); save('state'); toast(ui.ltype === 'in' ? '进账！' : '记好了'); closeSheet();
  }
  if (e.target.id === 'todoF') { const v = $('#todoIn').value.trim(); if (!v) return; S.todos.push({id: 't' + Date.now().toString(36), t: v, done: false, d: TODAY, due: $('#todoDue').value || dueFrom(v)}); afterChange(false); toast('加好了'); closeSheet(); }
});
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!$('#sheet').classList.contains('on')) render(); }, 200); });
render(); logHist();
}
