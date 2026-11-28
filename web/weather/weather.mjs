// 天气背景 + 动效层（独立模块，无依赖）
//
//   import { getWeatherCode, resolveWeather, applyWeather, STATES } from './weather/weather.mjs';
//   const w = await resolveWeather();            // 定位 + Open-Meteo，失败自动降级
//   applyWeather(document.getElementById('sky'), w.state);
//
// 画面用 GPT 的 v3 分层素材（web/weather/v3/），按 layer_config.json 逐层叠加、按各层 motion 参数动。
// 容器里插入 .wx-root（position:absolute; inset:0; z-index:0）；UI 放在容器里 z-index ≥ 1 即可盖在上面。
// 这个文件在 import 时不碰 DOM，Node 里也能 import 来测映射。

export const STATES = [
  ['sunny', '晴日'], ['night', '晴夜'], ['partly_cloudy', '少云'], ['overcast', '阴天'],
  ['fog', '薄雾'], ['drizzle', '细雨'], ['downpour', '暴雨'], ['thunderstorm', '雷暴'],
  ['snow', '飘雪'], ['blizzard', '暴雪'], ['hail', '冰雹'], ['freezing_rain', '冻雨'],
  ['wind', '强风'], ['dust', '沙尘'], ['heat', '酷热'], ['cyclone', '热带气旋'],
].map(([id, name], i) => ({ id, name, file: String(i + 1).padStart(2, '0') + '_' + id }));
const BY_ID = Object.fromEntries(STATES.map(s => [s.id, s]));
export const stateName = id => (BY_ID[id] || BY_ID.sunny).name;

// 触发阈值（粗略判断，够用就好）
export const THRESHOLDS = {
  heatC: 32,          // temperature_2m ≥ 32°C 且没下雨 → 酷热
  cycloneKmh: 85,     // wind_speed_10m ≥ 85 km/h → 热带气旋
  windKmh: 50,        // 没下雨但风 ≥ 50 km/h → 强风
  blizzardWindKmh: 40,// 下雪且风 ≥ 40 km/h → 暴雪
  dustUg: 150,        // 空气质量接口的 dust ≥ 150 μg/m³ 且没下雨 → 沙尘
};

// WMO weather code → 基础状态。'clear' 之后按 is_day 分晴日/晴夜。
const CODE_MAP = {
  0: 'clear', 1: 'clear', 2: 'partly_cloudy', 3: 'overcast',
  45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle', 61: 'drizzle', 80: 'drizzle',
  63: 'downpour', 65: 'downpour', 81: 'downpour', 82: 'downpour',
  56: 'freezing_rain', 57: 'freezing_rain', 66: 'freezing_rain', 67: 'freezing_rain',
  71: 'snow', 73: 'snow', 77: 'snow', 85: 'snow',
  75: 'blizzard', 86: 'blizzard',
  95: 'thunderstorm', 96: 'hail', 99: 'hail',
};
const DRY = new Set(['clear', 'partly_cloudy', 'overcast', 'fog']);

export function mapWeather({ code, isDay = true, temp = null, wind = null, dust = null } = {}) {
  const T = THRESHOLDS;
  const day = isDay === true || isDay === 1 || isDay === '1';
  if (wind != null && wind >= T.cycloneKmh) return 'cyclone';
  let s = CODE_MAP[Number(code)] || 'clear';
  if (s === 'snow' && wind != null && wind >= T.blizzardWindKmh) s = 'blizzard';
  if (DRY.has(s)) {
    if (dust != null && dust >= T.dustUg) return 'dust';
    if (day && temp != null && temp >= T.heatC) return 'heat';
    if (wind != null && wind >= T.windKmh) return 'wind';
  }
  // 夜里没有「少云」底图（那张是白天的蓝天），夜里少云按晴夜显示
  if (s === 'partly_cloudy' && !day) return 'night';
  if (s === 'clear') return day ? 'sunny' : 'night';
  return s;
}

export function defaultState(date = new Date()) {
  const h = date.getHours();
  return h >= 6 && h < 18 ? 'sunny' : 'night';
}

async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(timer); }
}

// 取当前天气。返回 { code, isDay, temp, wind, dust, state, time }。
// 沙尘来自 Open-Meteo 的空气质量接口（同样免费无 key）；它失败不影响主结果。
export async function getWeatherCode(lat, lon, opts = {}) {
  const la = (+lat).toFixed(3), lo = (+lon).toFixed(3);
  const main = fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}` +
    '&current=weather_code,is_day,temperature_2m,wind_speed_10m&wind_speed_unit=kmh&timezone=auto', opts);
  const aq = fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${la}&longitude=${lo}&current=dust`,
    { ...opts, timeoutMs: Math.min(opts.timeoutMs || 8000, 5000) }).catch(() => null);
  const j = await main;
  const c = j && j.current;
  if (!c || c.weather_code == null) throw new Error('Open-Meteo 没有返回 current');
  const a = await aq;
  const out = {
    code: c.weather_code, isDay: c.is_day === 1, temp: c.temperature_2m ?? null,
    wind: c.wind_speed_10m ?? null, dust: a && a.current ? a.current.dust ?? null : null, time: c.time || null,
  };
  out.state = mapWeather(out);
  return out;
}

const CACHE_KEY = 'wsr4-weather';
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch { return null; } }
function writeCache(v) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(v)); } catch { /* 存不了就算了 */ } }
export function cachedWeather() { return readCache(); }

function getPosition(timeoutMs) {
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) { rej(Object.assign(new Error('unsupported'), { code: 0 })); return; }
    navigator.geolocation.getCurrentPosition(p => res(p.coords), rej,
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 30 * 60 * 1000 });
  });
}

// 定位 + 取天气，永不抛错。返回：
//   { state, source: 'live'|'cache'|'default', reason, data }
// 定位失败/拒绝 → 默认（按本地时间晴日/晴夜）；接口失败 → 上一次结果，没有就默认。
export async function resolveWeather({ fetchImpl, timeoutMs = 8000, geoTimeoutMs = 12000 } = {}) {
  let coords;
  try { coords = await getPosition(geoTimeoutMs); }
  catch (e) {
    const reason = e && e.code === 1 ? '定位被拒绝' : e && e.code === 3 ? '定位超时' : '定位不可用';
    return { state: defaultState(), source: 'default', reason, data: null };
  }
  try {
    const data = await getWeatherCode(coords.latitude, coords.longitude, { fetchImpl, timeoutMs });
    // 只存约 1 km 精度的位置，够刷新用
    writeCache({ ...data, at: Date.now(), lat: +coords.latitude.toFixed(2), lon: +coords.longitude.toFixed(2) });
    return { state: data.state, source: 'live', reason: '', data };
  } catch {
    const c = readCache();
    if (c && c.state) {
      // 白天黑夜可能变了：缓存里的晴日/晴夜按现在的时间重新判断
      const st = (c.state === 'sunny' || c.state === 'night') ? defaultState() : c.state;
      return { state: st, source: 'cache', reason: '天气接口连不上', data: c };
    }
    return { state: defaultState(), source: 'default', reason: '天气接口连不上', data: null };
  }
}

/* ───────────────────────── v3 分层场景 ─────────────────────────
 * 接入按 v3/ENGINEERING/CLAUDE_HANDOFF.md：
 *  - 只加载当前一种天气；切换时新场景加载完再淡入，旧场景随后释放（img 清空、canvas 归零）。
 *  - 1440×3120 设计坐标整体 cover 到容器，不裁任何一层。
 *  - static / breathe / twinkle / lightning 层用该层 PNG；
 *    drift / swayRotate 的云层用原纹理 + placement 重建：PNG 版在画布左右边缘是被截断的，
 *    直接平移会露出一条硬边，用纹理重建后云本来就越出画幅，往返漂移不会露边。
 *  - particles 层：PNG 本身是 1440×1560 周期图案，用 canvas pattern 按速度偏移取模，无缝循环。
 *  - 默认关闭的层（L90 可读罩）不加载。
 */

const V3 = new URL('./v3/', import.meta.url).href;
const CW = 1440, CH = 3120;
const TAU = Math.PI * 2;
const clamp01 = x => Math.max(0, Math.min(1, x));

const CSS = `
.wx-root{position:absolute;inset:0;overflow:hidden;z-index:var(--wx-z,0);pointer-events:none;contain:strict;opacity:0;transition:opacity .8s ease}
.wx-root.on{opacity:1}
.wx-root *{pointer-events:none}
.wx-scene{position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;transform-origin:0 0}
.wx-ly{position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;will-change:transform,opacity}
.wx-ly>img,img.wx-ly{position:absolute;display:block;max-width:none;user-select:none}
`;
function ensureStyle() {
  if (document.getElementById('wx-style')) return;
  const st = document.createElement('style'); st.id = 'wx-style'; st.textContent = CSS; document.head.appendChild(st);
}

const cfgCache = new Map();
function loadConfig(st) {
  if (!cfgCache.has(st.id)) {
    cfgCache.set(st.id, fetch(V3 + st.file + '/layer_config.json').then(r => {
      if (!r.ok) throw new Error('layer_config ' + r.status); return r.json();
    }).catch(e => { cfgCache.delete(st.id); throw e; }));
  }
  return cfgCache.get(st.id);
}
function loadImg(url) {
  const im = new Image(); im.decoding = 'async'; im.alt = ''; im.draggable = false; im.src = url;
  return (im.decode ? im.decode() : new Promise((ok, no) => { im.onload = ok; im.onerror = no; }))
    .then(() => im, () => { throw new Error('图层加载失败 ' + url.split('/').slice(-2).join('/')); });
}

// 闪电：默认 12 秒一轮，5.2 秒起两次短脉冲（同参考播放器），再加一点余光衰减；只亮闪电本层，不全屏白闪
function flash(d) {
  if (d < 0) return 0;
  if (d < 0.07) return 1;
  if (d < 0.16) return 1 - (d - 0.07) / 0.09 * 0.8;
  if (d < 0.22) return 0.6;
  if (d < 0.62) return 0.6 * (1 - (d - 0.22) / 0.4);
  return 0;
}

// 星星分三组各自眨：同一张星点 PNG 叠三份，每份用随机格子遮罩只露三分之一的星
const twinkleMasks = [];
function twinkleMask(k) {
  if (twinkleMasks.length) return twinkleMasks[k];
  const cell = 40, n = 11, size = cell * n;              // 440 设计像素一块，平铺
  const cs = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = c.height = size; return c; });
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const g = cs[(rand() * 3) | 0].getContext('2d'); g.fillStyle = '#000'; g.fillRect(x * cell, y * cell, cell, cell);
  }
  cs.forEach(c => twinkleMasks.push(c.toDataURL('image/png')));
  return twinkleMasks[k];
}

let filterSeq = 0;
function heatFilter() {
  const id = 'wx-heat-' + (++filterSeq);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  // 与 v3 的 heat__L75 定义一致：最大约 5 设计像素位移
  svg.innerHTML = `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".004 .025" numOctaves="2" seed="31" result="noise"/>
    <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  document.body.appendChild(svg);
  return { id, svg, turb: svg.querySelector('feTurbulence') };
}

import { createFx } from './fx.mjs';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 挂上一种天气。立即返回 handle，素材加载完才淡入；加载期间旧画面保持不动。
 *   handle.ready      Promise，加载完成（失败会 reject，旧画面保留）
 *   handle.setPaused(true)  停在静态底图（各层回到原位、闪电关）
 *   handle.destroy()
 * opts.motion: 'auto'（跟随系统「减少动态」）| 'on' | 'off'
 */
export function applyWeather(container, stateId, { motion = 'auto' } = {}) {
  if (!container) throw new Error('applyWeather 需要一个容器');
  ensureStyle();
  const st = BY_ID[stateId] || BY_ID.sunny;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  // 之前还在加载的那次作废；已经显示的那次等新的好了再撤
  if (container.__wxPending) container.__wxPending.destroy();

  const reduce = motion === 'off' || (motion === 'auto' && reducedMotion());
  const root = document.createElement('div'); root.className = 'wx-root'; root.dataset.state = st.id;
  const scene = document.createElement('div'); scene.className = 'wx-scene'; root.appendChild(scene);
  const nodes = [];      // { m, el, ... } 需要逐帧更新的层
  const parts = [];      // 粒子层
  const imgs = [];
  let fx = null, lastT = 0, heat = null, raf = 0, destroyed = false, paused = reduce, holdT = 0, t0 = performance.now(), W = 1, H = 1, s = 1, dpr = 1, ro = null, lastHeat = -1;

  const handle = {
    state: st.id, root, reducedMotion: reduce,
    get paused() { return paused; },
    // 停在第 t 秒的样子（测试和截图用）
    seek(t) { paused = true; stop(); holdT = t; render(t, false); },
    setPaused(p) { paused = !!p; if (!paused) { t0 = performance.now() - holdT * 1000; start(); } else { render(0, true); stop(); } },
    destroy,
  };
  container.__wxPending = handle;

  function layout() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    s = Math.max(W / CW, H / CH);
    scene.style.transform = `translate(${(W - CW * s) / 2}px,${(H - CH * s) / 2}px) scale(${s})`;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const p of parts) { p.cv.width = Math.round(CW * s * dpr); p.cv.height = Math.round(CH * s * dpr); }
    const ox = (W - CW * s) / 2, oy = (H - CH * s) / 2;
    if (fx) fx.layout({ s, dpr, view: { x0: Math.max(0, -ox / s), y0: Math.max(0, -oy / s), x1: Math.min(CW, (W - ox) / s), y1: Math.min(CH, (H - oy) / s) } });
    render(paused ? 0 : (performance.now() - t0) / 1000, paused);
  }

  function render(t, rest) {
    let dt = t - lastT; lastT = t;
    if (!(dt > 0) || dt > 0.1) dt = dt > 0.1 ? 0.1 : 0;
    for (const n of nodes) {
      const m = n.m;
      const mod = (!rest && fx && fx.nodeMod && fx.nodeMod(n, t)) || null;
      if (m.type === 'drift') {
        const sp = mod && mod.speedMul || 1, mul = mod && mod.dxMul || 1;
        const a = t * sp / m.periodSeconds * TAU + (m.phase || 0);
        if (rest) { n.tx = n.ty = 0; n.el.style.transform = 'none'; n.el.style.opacity = n.op; continue; }
        n.tx = Math.sin(a) * (m.dxPx || 0) * mul; n.ty = Math.cos(a) * (m.dyPx || 0);
        n.el.style.transform = `translate3d(${n.tx.toFixed(2)}px,${n.ty.toFixed(2)}px,0)` + (mod && mod.rot ? ` rotate(${mod.rot.toFixed(3)}deg)` : '');
        if (mod && mod.opMul != null) n.el.style.opacity = clamp01(n.op * mod.opMul).toFixed(3);
      } else if (m.type === 'swayRotate') {
        n.el.style.transform = rest ? 'none' : `rotate(${(Math.sin(t / m.periodSeconds * TAU) * m.degrees).toFixed(3)}deg)`;
      } else if (m.type === 'breathe') {
        const low = m.minOpacity ?? 0.65;
        n.el.style.opacity = rest ? 1 : low + (1 - low) * (0.5 + 0.5 * Math.sin(t / m.periodSeconds * TAU));
      } else if (m.type === 'twinkle') {
        const low = m.minOpacity ?? 0.65;
        n.el.style.opacity = rest ? 1 : low + (1 - low) * (0.5 + 0.5 * Math.sin(t / (m.periodSeconds * n.k) * TAU + n.ph));
      } else if (m.type === 'lightning') {
        let op;
        if (rest) op = 0;
        else if (fx && fx.lightning) op = fx.lightning(m.role, t);
        else { const d = (t % m.cycleSeconds) - m.pulseAtSeconds; op = m.role === 'glow' ? 0.5 * flash(d < 0.22 ? d : 0.22 + (d - 0.22) * 0.55) : flash(d); }
        n.el.style.opacity = op; n.el.style.visibility = op > 0.001 ? 'visible' : 'hidden';
      }
    }
    parts.forEach((p, i) => {
      const v = p.m.velocityPxPerSecond, ts = p.m.tileSize;
      const h = (!rest && fx && fx.particle && fx.particle(i, t)) || {};
      if (rest) { p.ox = p.oy = 0; }
      else { const mu = h.mult ?? 1; p.ox = (((p.ox || 0) + v[0] * mu * dt) % ts[0] + ts[0]) % ts[0]; p.oy = (((p.oy || 0) + v[1] * mu * dt) % ts[1] + ts[1]) % ts[1]; }
      const k = s * dpr, g = p.g, ox = p.ox + (h.dx || 0), oy = p.oy + (h.dy || 0), sk = h.skew || 0;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, p.cv.width, p.cv.height);
      p.pat.setTransform(new DOMMatrix([k, 0, k * sk, k, ox * k, oy * k]));
      g.fillStyle = p.pat; g.fillRect(0, 0, p.cv.width, p.cv.height);
      if (h.dup > 0.01) {            // 一阵更密的：同一图案错开半格再叠一遍
        g.globalAlpha = Math.min(1, h.dup);
        p.pat.setTransform(new DOMMatrix([k, 0, k * sk, k, (ox + ts[0] * 0.37) * k, (oy + ts[1] * 0.5) * k]));
        g.fillRect(0, 0, p.cv.width, p.cv.height); g.globalAlpha = 1;
      }
      if (fx && fx.particleAfter) { g.setTransform(k, 0, 0, k, 0, 0); fx.particleAfter(g); }
    });
    if (fx) { if (rest) fx.rest(); else fx.frame(t, dt); }
    if (heat) {
      // 噪声频率慢慢变；属性改动会让滤镜重算，所以限频更新
      const q = rest ? 0 : Math.floor(t * (heat.strong ? 12 : 10));
      if (q !== lastHeat) {
        lastHeat = q;
        heat.turb.setAttribute('baseFrequency', heat.strong
          ? `${(0.006 + Math.sin(t / 7 * TAU) * 0.0012).toFixed(5)} ${(0.03 + Math.sin(t / 3.1 * TAU) * 0.006).toFixed(5)}`
          : `${(0.004 + Math.sin(t / 18 * TAU) * 0.0007).toFixed(5)} .025`);
      }
    }
  }

  function frame(now) {
    if (destroyed || paused) return;
    raf = requestAnimationFrame(frame);
    holdT = (now - t0) / 1000;
    render(holdT, false);
  }
  function start() { if (destroyed || paused || raf || document.hidden) return; raf = requestAnimationFrame(frame); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  const onVis = () => { if (document.hidden) stop(); else { t0 = performance.now() - holdT * 1000; start(); } };

  function destroy(fade = true) {
    if (destroyed) return; destroyed = true; stop();
    if (ro) ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    if (container.__wxPending === handle) container.__wxPending = null;
    if (container.__wx === handle) container.__wx = null;
    const release = () => {
      root.remove();
      for (const im of imgs) im.src = '';
      for (const p of parts) { p.cv.width = p.cv.height = 0; }
      if (heat) heat.svg.remove();
      if (fx) fx.destroy();
    };
    if (fade && root.isConnected && root.classList.contains('on')) { root.classList.remove('on'); setTimeout(release, 850); }
    else release();
  }

  async function build() {
    const cfg = await loadConfig(st);
    if (destroyed) return;
    const layers = cfg.layers.filter(l => l.defaultVisible !== false).sort((a, b) => a.z - b.z);
    const dir = V3 + st.file + '/';
    const urlOf = l => (l.texture && (l.motion.type === 'drift' || l.motion.type === 'swayRotate'))
      ? V3 + 'textures/' + l.texture.split('/').pop() : l.pngFile ? dir + l.pngFile : null;
    const need = [...new Set(layers.map(urlOf).filter(Boolean))];
    const loaded = new Map(await Promise.all(need.map(async u => [u, await loadImg(u)])));
    if (destroyed) { loaded.forEach(im => (im.src = '')); return; }
    const byZ = new Map(layers.map(l => [l.z, l]));
    const texCache = new Map();
    if (!reduce) {
      fx = createFx(st.id, {
        // 酷热的折射带要把下面各层重画一遍：给出 z 以下每层的图和它此刻的位置
        layersBelow: z => drawList.filter(d => d.z < z),
        imgAt: z => { const l = byZ.get(z); const u = l && urlOf(l); return u ? loaded.get(u) : null; },
        texture: name => { if (!texCache.has(name)) texCache.set(name, loadImg(V3 + 'textures/' + name).then(im => { imgs.push(im); return im; })); return texCache.get(name); },
      });
      await Promise.allSettled(fx.pending); await new Promise(r => setTimeout(r, 0));
      if (destroyed) return;
    }
    const extra = fx ? fx.elements.slice().sort((a, b) => a.z - b.z) : [];
    const flushExtra = z => { while (extra.length && extra[0].z < z) scene.appendChild(extra.shift().el); };
    const used = new Set();
    const drawList = [];
    const take = u => { const im = loaded.get(u); if (!used.has(u)) { used.add(u); imgs.push(im); return im; } const c = im.cloneNode(); imgs.push(c); return c; };

    let driftIdx = 0;
    for (const l of layers) {
      flushExtra(l.z);
      const m = (fx && fx.motion && fx.motion(l.z)) || l.motion || { type: 'static' }, u = urlOf(l);
      if (m.type === 'heat') { if (!(fx && fx.ownHeat)) { heat = heatFilter(); scene.style.filter = `url(#${heat.id})`; } continue; }
      if (!u) continue;
      if (m.type === 'particles') {
        const cv = document.createElement('canvas'); cv.className = 'wx-ly';
        const g = cv.getContext('2d'); const im = loaded.get(u); used.add(u);
        parts.push({ m, cv, g, pat: g.createPattern(im, 'repeat') });
        scene.appendChild(cv); continue;
      }
      if (m.type === 'drift' || m.type === 'swayRotate') {
        const pl = l.placement, wrap = document.createElement('div'); wrap.className = 'wx-ly';
        wrap.style.opacity = pl.opacity ?? 1;
        if (m.type === 'swayRotate') wrap.style.transformOrigin = `${m.origin[0]}px ${m.origin[1]}px`;
        const im = take(u);
        Object.assign(im.style, { left: pl.x + 'px', top: pl.y + 'px', width: pl.width + 'px', height: pl.height + 'px',
          transform: `rotate(${pl.rotationDegrees || 0}deg)${pl.mirror ? ' scaleX(-1)' : ''}`, transformOrigin: '50% 50%' });
        const node = { m, el: wrap, z: l.z, i: driftIdx++, op: pl.opacity ?? 1, tx: 0, ty: 0 };
        wrap.appendChild(im); scene.appendChild(wrap); nodes.push(node);
        drawList.push({ z: l.z, img: loaded.get(u), pl, node }); continue;
      }
      if (m.type === 'twinkle') {
        // 三组不同节奏：周期 ×1 / ×0.63 / ×1.41，相位错开
        [[1, 0], [0.63, 2.1], [1.41, 4.2]].forEach(([k, ph], i) => {
          const im = take(u); im.className = 'wx-ly';
          const mask = `url(${twinkleMask(i)})`;
          Object.assign(im.style, { WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: '440px 440px', maskSize: '440px 440px' });
          scene.appendChild(im); nodes.push({ m, el: im, k, ph });
        });
        continue;
      }
      const im = take(u); im.className = 'wx-ly'; scene.appendChild(im);
      drawList.push({ z: l.z, img: loaded.get(u), el: im });
      if (m.type !== 'static') nodes.push({ m, el: im });
    }

    flushExtra(Infinity);

    // 上桌：放在旧场景上面淡入，淡入完撤掉旧的
    const prev = container.__wx;
    if (prev && prev.root.isConnected) prev.root.after(root); else container.prepend(root);
    container.__wx = handle; container.__wxPending = null;
    layout();
    ro = new ResizeObserver(layout); ro.observe(container);
    document.addEventListener('visibilitychange', onVis);
    start();
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('on')));
    if (prev) setTimeout(() => prev.destroy(false), 850);
  }

  handle.ready = build().then(() => handle, e => { if (!destroyed) destroy(false); throw e; });
  return handle;
}
