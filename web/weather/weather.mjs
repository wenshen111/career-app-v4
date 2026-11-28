// 天气背景 + 动效层（独立模块，无依赖）
//
//   import { getWeatherCode, resolveWeather, applyWeather, STATES } from './weather/weather.mjs';
//   const w = await resolveWeather();            // 定位 + Open-Meteo，失败自动降级
//   applyWeather(document.getElementById('sky'), w.state);
//
// 层级：容器里插入 .wx-root（position:absolute; inset:0; z-index:0）。
//   底图 img → CSS 动效层 → Canvas 粒子层。UI 放在容器里 z-index ≥ 1 即可盖在上面。
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

/* ───────────────────────── 动效层 ───────────────────────── */

const IMG_W = 852, IMG_H = 1846;
// 底图里太阳/月亮/气旋眼的位置（相对底图 0–1），用来对齐光晕
const ANCHORS = {
  sunny: [0.141, 0.046], night: [0.864, 0.098], heat: [0.8, 0.093], cyclone: [0.81, 0.14],
  thunderstorm: [0.86, 0.11],
};
const BG_BASE = new URL('./bg/', import.meta.url).href;

const CSS = `
.wx-root{position:absolute;inset:0;overflow:hidden;z-index:var(--wx-z,0);pointer-events:none;contain:strict;
  opacity:0;transition:opacity .7s ease;background:#7d9bbf}
.wx-root.on{opacity:1}
.wx-root *{pointer-events:none}
.wx-bg,.wx-bgc{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 50%;display:block}
.wx-fx,.wx-cv{position:absolute;inset:0;width:100%;height:100%}
.wx-l{position:absolute;will-change:transform,opacity}
.wx-kb{animation:wx-kb 48s ease-in-out infinite alternate;transform-origin:50% 30%}
@keyframes wx-kb{from{transform:scale(1.02) translate3d(0,0,0)}to{transform:scale(1.07) translate3d(-1.2%,0.6%,0)}}
.wx-pan{animation:wx-pan 22s ease-in-out infinite alternate;transform-origin:50% 50%}
@keyframes wx-pan{from{transform:scale(1.06) translate3d(1.6%,0,0)}to{transform:scale(1.06) translate3d(-1.6%,0,0)}}
.wx-drift{left:0;width:200%;background-repeat:repeat-x;background-size:50% 100%;animation:wx-drift linear infinite}
@keyframes wx-drift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,0,0)}}
.wx-drift.rev{animation-name:wx-drift-r}
@keyframes wx-drift-r{from{transform:translate3d(-50%,0,0)}to{transform:translate3d(0,0,0)}}
.wx-glow{border-radius:50%;transform:translate(-50%,-50%);animation:wx-breathe 6s ease-in-out infinite}
@keyframes wx-breathe{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.75}50%{transform:translate(-50%,-50%) scale(1.12);opacity:1}}
.wx-rays{border-radius:50%;transform:translate(-50%,-50%);animation:wx-spin 140s linear infinite}
@keyframes wx-spin{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}
.wx-rays.ccw{animation-direction:reverse}
.wx-rise{animation:wx-rise 18s ease-in-out infinite}
@keyframes wx-rise{0%{transform:translate3d(0,12%,0);opacity:0}35%,65%{opacity:1}100%{transform:translate3d(0,-14%,0);opacity:0}}
.wx-dim{inset:0;animation:wx-dim 14s ease-in-out infinite}
@keyframes wx-dim{0%,100%{opacity:0}50%{opacity:1}}
.wx-flash{inset:0;opacity:0;mix-blend-mode:screen}
.wx-heatwave{left:0;right:0;bottom:0;height:200%;animation:wx-heatup 7s linear infinite}
@keyframes wx-heatup{from{transform:translate3d(0,0,0)}to{transform:translate3d(0,-50%,0)}}
@media (prefers-reduced-motion: reduce){.wx-root[data-motion=auto] .wx-l,.wx-root[data-motion=auto] .wx-bg{animation:none!important}}
`;

let heatFilterId = null;
function ensureGlobals() {
  if (!document.getElementById('wx-style')) {
    const st = document.createElement('style'); st.id = 'wx-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  if (!heatFilterId) {
    heatFilterId = 'wx-heat';
    // 低频热浪扭曲：噪声频率在 0.006–0.012 间慢慢变，位移幅度很小
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true'); svg.style.position = 'absolute';
    svg.innerHTML = `<filter id="${heatFilterId}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.04" numOctaves="1" seed="3" result="n">
        <animate attributeName="baseFrequency" dur="9s" values="0.006 0.04;0.009 0.055;0.006 0.04" repeatCount="indefinite"/>
      </feTurbulence>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
    document.body.appendChild(svg);
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);
const el = (cls, style = {}) => { const d = document.createElement('div'); d.className = cls; Object.assign(d.style, style); return d; };

// 程序生成的软云/雾纹理（横向可无缝平铺），生成一次后缓存成 dataURL
const texCache = {};
function texture(kind) {
  if (texCache[kind]) return texCache[kind];
  const W = 768, H = kind === 'mist' ? 192 : 320;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const puff = (x, y, r, a) => {
    for (const dx of [-W, 0, W]) {
      const gr = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x + dx, y, r, 0, Math.PI * 2); g.fill();
    }
  };
  if (kind === 'mist') {
    g.save(); g.scale(1, 0.35);
    for (let i = 0; i < 46; i++) puff(rnd(0, W), rnd(H * 0.9, H * 1.95), rnd(50, 130), rnd(0.12, 0.28));
    g.restore();
  } else if (kind === 'streak') { // 被风拉长的云丝
    g.save(); g.scale(1, 0.22);
    for (let i = 0; i < 40; i++) puff(rnd(0, W), rnd(H * 0.6, H * 4), rnd(40, 110), rnd(0.15, 0.35));
    g.restore();
  } else { // 'cloud'：几簇团状云
    for (let k = 0; k < 5; k++) {
      const cx = rnd(0, W), cy = rnd(H * 0.3, H * 0.7), n = 9 + (Math.random() * 6 | 0);
      for (let i = 0; i < n; i++) puff(cx + rnd(-110, 110), cy + rnd(-35, 30), rnd(30, 75), rnd(0.18, 0.4));
    }
  }
  return (texCache[kind] = c.toDataURL('image/png'));
}

// 冻雨：玻璃上的冰花（静态，生成一次）
function frostCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
  const g = c.getContext('2d');
  const vg = g.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(235,245,255,0)'); vg.addColorStop(1, 'rgba(235,245,255,0.38)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  // 六角冰晶：越靠近四边越多越大，中间留白
  g.lineCap = 'round';
  const crystal = (x, y, r, rot) => {
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = rot + k * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
      g.moveTo(x, y); g.lineTo(x + ca * r, y + sa * r);
      for (const f of [0.45, 0.7]) { // 每条臂上两对小枝
        const bx = x + ca * r * f, by = y + sa * r * f, l = r * (1 - f) * 0.7;
        for (const s of [-1, 1]) { const b = a + s * Math.PI / 3; g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * l, by + Math.sin(b) * l); }
      }
    }
    g.stroke();
  };
  const m = Math.min(w, h), band = m * 0.3, n = Math.round((w + h) / 2.6);
  for (let i = 0; i < n; i++) {
    const d = Math.pow(Math.random(), 2.2) * band, t = Math.random(), side = (Math.random() * 4) | 0;
    const [x, y] = side === 0 ? [t * w, h - d] : side === 1 ? [d, t * h] : side === 2 ? [w - d, t * h] : [t * w, d];
    const k = 1 - d / band;
    g.strokeStyle = `rgba(245,250,255,${(0.12 + 0.26 * k).toFixed(3)})`; g.lineWidth = 0.5 + 0.4 * k;
    crystal(x, y, 1.5 + rnd(2, 8) * k * k, rnd(0, 1.05));
  }
  return c;
}

/* ── 粒子系统：每个都是 { reset(W,H), update(dt,t), draw(g) }，粒子出屏就地回收重用 ── */

function rainSys({ dens, max, speed, angle = 0, len, width, alpha, color = '200,220,245' }) {
  let P = [], W = 0, H = 0;
  const sin = Math.sin(angle * Math.PI / 180), cos = Math.cos(angle * Math.PI / 180);
  const spawn = (p, first) => {
    p.v = rnd(speed[0], speed[1]); p.l = rnd(len[0], len[1]);
    const span = H * Math.abs(sin / cos);
    p.x = sin > 0 ? rnd(-span, W) : sin < 0 ? rnd(0, W + span) : rnd(0, W);
    p.y = first ? rnd(-p.l, H) : rnd(-H * 0.25, -p.l);
  };
  return {
    reset(w, h, q) { W = w; H = h; const n = Math.min(max, Math.round(dens * w * h / 1e5 * q)); P = []; for (let i = 0; i < n; i++) { const p = {}; spawn(p, true); P.push(p); } },
    update(dt) { for (const p of P) { p.x += p.v * sin * dt; p.y += p.v * cos * dt; if (p.y - p.l > H || p.x < -60 || p.x > W + 60) spawn(p, false); } },
    draw(g) {
      g.strokeStyle = `rgba(${color},${alpha})`; g.lineWidth = width; g.lineCap = 'round';
      g.beginPath();
      for (const p of P) { g.moveTo(p.x, p.y); g.lineTo(p.x - sin * p.l, p.y - cos * p.l); }
      g.stroke();
    },
  };
}

function snowSys({ dens, max, r, vy, sway, wind = 0, alpha, gust = 0 }) {
  let P = [], W = 0, H = 0;
  const spawn = (p, first) => {
    p.r = rnd(r[0], r[1]); p.vy = rnd(vy[0], vy[1]) * (0.6 + p.r / r[1] * 0.4);
    p.ph = rnd(0, 6.28); p.f = rnd(0.6, 1.6); p.a = rnd(sway[0], sway[1]);
    p.y = first ? rnd(0, H) : rnd(-40, -5);
    p.x = wind > 0 && !first ? rnd(-W * 0.6, W) : rnd(0, W);
    if (wind > 0 && !first && Math.random() < 0.5) { p.x = rnd(-40, -5); p.y = rnd(0, H); }
  };
  return {
    reset(w, h, q) { W = w; H = h; const n = Math.min(max, Math.round(dens * w * h / 1e5 * q)); P = []; for (let i = 0; i < n; i++) { const p = {}; spawn(p, true); P.push(p); } },
    update(dt, t) {
      const gw = wind * (1 + gust * Math.sin(t * 0.7));
      for (const p of P) {
        p.y += p.vy * dt;
        p.x += (Math.sin(t * p.f + p.ph) * p.a + gw * (p.r / r[1])) * dt;
        if (p.y > H + 8 || p.x > W + 40 || p.x < -60) spawn(p, false);
      }
    },
    draw(g) {
      g.fillStyle = `rgba(255,255,255,${alpha})`; g.beginPath();
      for (const p of P) { g.moveTo(p.x + p.r, p.y); g.arc(p.x, p.y, p.r, 0, 6.2832); }
      g.fill();
    },
  };
}

function hailSys({ dens, max }) {
  let P = [], W = 0, H = 0;
  const spawn = (p, first) => {
    p.x = rnd(0, W); p.y = first ? rnd(-H, H * 0.7) : rnd(-80, -10);
    p.vy = rnd(520, 760); p.vx = rnd(-20, 20); p.r = rnd(1.4, 2.6);
    p.ground = rnd(H * 0.72, H * 0.99); p.b = 0; p.fade = 1;
  };
  return {
    reset(w, h, q) { W = w; H = h; const n = Math.min(max, Math.round(dens * w * h / 1e5 * q)); P = []; for (let i = 0; i < n; i++) { const p = {}; spawn(p, true); P.push(p); } },
    update(dt) {
      for (const p of P) {
        p.vy += 1400 * dt; p.y += p.vy * dt; p.x += p.vx * dt;
        if (p.y >= p.ground && p.vy > 0) {
          p.y = p.ground; p.b++;
          p.vy = -p.vy * (p.b === 1 ? 0.32 : 0.22); p.vx = rnd(-70, 70);
        }
        if (p.b >= 2) p.fade -= dt * 2.6;
        if (p.fade <= 0 || p.x < -20 || p.x > W + 20) spawn(p, false);
      }
    },
    draw(g) {
      g.strokeStyle = '#fff'; g.lineCap = 'round';
      for (const p of P) {
        g.globalAlpha = 0.85 * Math.max(0, p.fade); g.lineWidth = p.r * 2;
        const tail = Math.min(3, Math.abs(p.vy) * 0.004);
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.008, p.y - Math.sign(p.vy) * tail); g.stroke();
      }
      g.globalAlpha = 1;
    },
  };
}

function starSys({ count, top = 0.62 }) {
  let P = [];
  return {
    reset(w, h, q) {
      P = []; const n = Math.round(count * Math.min(1.4, w * h / (390 * 844)) * Math.max(q, 0.6));
      for (let i = 0; i < n; i++) {
        const big = Math.random() < 0.12;
        P.push({ x: rnd(0, w), y: Math.pow(Math.random(), 1.4) * h * top, r: big ? rnd(1.3, 1.9) : rnd(0.5, 1.1),
          base: rnd(0.25, 0.55), amp: rnd(0.25, 0.45), w: 6.2832 / rnd(1.6, 6.5), ph: rnd(0, 6.28), big });
      }
    },
    update() {},
    draw(g, t) {
      g.fillStyle = '#fffbea';
      for (const s of P) {
        const a = Math.max(0, Math.min(1, s.base + s.amp * Math.sin(t * s.w + s.ph)));
        g.globalAlpha = a; g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.2832); g.fill();
        if (s.big && a > 0.6) { // 亮的时候闪一下十字光芒
          g.globalAlpha = (a - 0.6) * 1.6; g.fillRect(s.x - s.r * 3.2, s.y - 0.35, s.r * 6.4, 0.7); g.fillRect(s.x - 0.35, s.y - s.r * 3.2, 0.7, s.r * 6.4);
        }
      }
      g.globalAlpha = 1;
    },
  };
}

function streakSys({ count, speed, len, alpha, color = '255,255,255', yRange = [0, 1], angle = 0 }) {
  let P = [], W = 0, H = 0;
  const spawn = (p, first) => {
    p.l = rnd(len[0], len[1]); p.v = rnd(speed[0], speed[1]); p.life = rnd(1.2, 2.6); p.age = first ? rnd(0, p.life) : 0;
    p.x = rnd(-p.l, W * 0.9); p.y = rnd(H * yRange[0], H * yRange[1]); p.c = rnd(-0.12, 0.12); p.w = rnd(0.6, 1.4);
  };
  const tan = Math.tan(angle * Math.PI / 180);
  return {
    reset(w, h, q) { W = w; H = h; P = []; const n = Math.round(count * Math.max(q, 0.5)); for (let i = 0; i < n; i++) { const p = {}; spawn(p, true); P.push(p); } },
    update(dt) { for (const p of P) { p.age += dt; p.x += p.v * dt; p.y += p.v * tan * dt; if (p.age > p.life || p.x > W + 20) spawn(p, false); } },
    draw(g) {
      g.strokeStyle = `rgb(${color})`; g.lineCap = 'round';
      for (const p of P) {
        g.globalAlpha = alpha * Math.sin(Math.PI * Math.min(1, p.age / p.life)); g.lineWidth = p.w;
        g.beginPath(); g.moveTo(p.x, p.y);
        g.quadraticCurveTo(p.x + p.l * 0.5, p.y + p.l * p.c, p.x + p.l, p.y + p.l * tan); g.stroke();
      }
      g.globalAlpha = 1;
    },
  };
}

function dustSys({ dens, max, colors, vx, vy, r, alpha }) {
  let P = [], W = 0, H = 0;
  const spawn = (p, first) => {
    p.r = rnd(r[0], r[1]); p.vx = rnd(vx[0], vx[1]) * (0.5 + p.r / r[1]); p.vy = rnd(vy[0], vy[1]);
    p.ph = rnd(0, 6.28); p.c = (Math.random() * colors.length) | 0;
    if (first) { p.x = rnd(0, W); p.y = rnd(0, H); }
    else if (Math.random() < H / (W + H)) { p.x = rnd(-30, -5); p.y = rnd(-H * 0.2, H); }
    else { p.x = rnd(-W * 0.3, W); p.y = rnd(-30, -5); }
  };
  return {
    reset(w, h, q) { W = w; H = h; const n = Math.min(max, Math.round(dens * w * h / 1e5 * q)); P = []; for (let i = 0; i < n; i++) { const p = {}; spawn(p, true); P.push(p); } },
    update(dt, t) {
      for (const p of P) {
        p.x += (p.vx + Math.sin(t * 1.3 + p.ph) * 14) * dt; p.y += (p.vy + Math.cos(t * 0.9 + p.ph) * 8) * dt;
        if (p.x > W + 20 || p.y > H + 20 || p.y < -60) spawn(p, false);
      }
    },
    draw(g) {
      for (let k = 0; k < colors.length; k++) {
        g.fillStyle = `rgba(${colors[k]},${alpha})`; g.beginPath();
        for (const p of P) if (p.c === k) { g.moveTo(p.x + p.r, p.y); g.arc(p.x, p.y, p.r, 0, 6.2832); }
        g.fill();
      }
    },
  };
}

// 气旋：粒子绕眼螺旋向内（北半球逆时针），越靠近眼越快
function spiralSys({ count, anchor, alpha }) {
  let P = [], W = 0, H = 0, cx = 0, cy = 0, R = 0;
  const spawn = (p, first) => {
    p.r = first ? rnd(R * 0.08, R) : rnd(R * 0.75, R); p.th = rnd(0, 6.2832);
    p.k = rnd(0.8, 1.25); p.in = rnd(10, 26); p.w = rnd(0.6, 1.6);
  };
  return {
    reset(w, h, q, env) {
      W = w; H = h; [cx, cy] = env.pt(...anchor); R = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) * 1.05;
      P = []; const n = Math.round(count * Math.max(q, 0.5)); for (let i = 0; i < n; i++) { const p = {}; spawn(p, true); P.push(p); }
    },
    update(dt) {
      for (const p of P) {
        const om = 0.9 * p.k * Math.pow(R * 0.12 / Math.max(p.r, R * 0.04), 0.7);
        p.om = om; p.th -= om * dt; p.r -= p.in * dt * (1 + 60 / p.r);
        if (p.r < R * 0.04) spawn(p, false);
      }
    },
    draw(g) {
      g.strokeStyle = `rgba(255,255,255,${alpha})`; g.lineCap = 'round';
      for (let b = 0; b < 2; b++) {
        g.lineWidth = b ? 1.6 : 0.8; g.beginPath();
        for (const p of P) {
          if ((p.w > 1.1) !== !!b) continue;
          const arc = Math.min(0.45, p.om * 0.22);
          g.moveTo(cx + Math.cos(p.th) * p.r, cy + Math.sin(p.th) * p.r);
          g.arc(cx, cy, p.r, p.th, p.th + arc);
        }
        g.stroke();
      }
    },
  };
}

// 雷暴：1–8 秒随机一次闪光；六成概率在画面上方画一道分叉闪电
function lightningSys(flashEl) {
  let W = 0, H = 0, next = rnd(1, 3), bolt = null, boltAge = 0;
  const makeBolt = () => {
    const segs = []; let x = rnd(W * 0.35, W * 0.95), y = 0; const end = rnd(H * 0.22, H * 0.42);
    const path = [[x, y]];
    while (y < end) { x += rnd(-18, 18); y += rnd(10, 24); path.push([x, y]); }
    segs.push(path);
    for (let i = 0; i < 3; i++) {
      const s = path[(rnd(0.2, 0.8) * path.length) | 0]; let [bx, by] = s; const dir = Math.random() < 0.5 ? -1 : 1;
      const br = [[bx, by]]; const n = 3 + (Math.random() * 4 | 0);
      for (let k = 0; k < n; k++) { bx += dir * rnd(4, 16); by += rnd(8, 18); br.push([bx, by]); }
      segs.push(br);
    }
    return segs;
  };
  const strike = () => {
    if (flashEl.animate) flashEl.animate(
      [{ opacity: 0 }, { opacity: 0.75, offset: 0.08 }, { opacity: 0.1, offset: 0.2 }, { opacity: 0.55, offset: 0.3 }, { opacity: 0 }],
      { duration: 650, easing: 'ease-out' });
    if (Math.random() < 0.6) { bolt = makeBolt(); boltAge = 0; }
  };
  return {
    reset(w, h) { W = w; H = h; bolt = null; },
    update(dt) { next -= dt; if (next <= 0) { strike(); next = rnd(1, 8); } if (bolt) { boltAge += dt; if (boltAge > 0.45) bolt = null; } },
    draw(g) {
      if (!bolt) return;
      const a = boltAge < 0.06 ? 1 : boltAge < 0.12 ? 0.3 : boltAge < 0.2 ? 0.9 : Math.max(0, 1 - (boltAge - 0.2) / 0.25);
      g.lineJoin = 'round'; g.lineCap = 'round';
      for (const [lw, col, al] of [[7, '200,170,255', 0.18], [2.2, '240,235,255', 0.95]]) {
        g.strokeStyle = `rgba(${col},${al * a})`;
        bolt.forEach((seg, i) => { g.lineWidth = i ? lw * 0.5 : lw; g.beginPath(); seg.forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke(); });
      }
    },
  };
}

/* ── 每种天气的配方 ── */
// css(layer helpers) 往 fx 层里放 DOM 动效；sys 返回粒子系统
function recipe(id, L) {
  const R = { kb: false, pan: false, sys: [] };
  const flash = () => { const f = L.add('wx-l wx-flash', { background: 'radial-gradient(120% 70% at 75% 8%, rgba(225,215,255,.95), rgba(170,160,230,.35) 60%, rgba(120,110,180,0) 100%)' }); return f; };
  switch (id) {
    case 'sunny':
      R.kb = true;
      L.anchored('sunny', 'wx-l wx-rays', 'min(150vmax,1400px)', { background: 'repeating-conic-gradient(from 0deg, rgba(255,246,214,.16) 0deg 3deg, rgba(255,246,214,0) 3deg 11deg)', WebkitMaskImage: 'radial-gradient(circle, #000 0%, rgba(0,0,0,.5) 25%, transparent 60%)', maskImage: 'radial-gradient(circle, #000 0%, rgba(0,0,0,.5) 25%, transparent 60%)' });
      L.anchored('sunny', 'wx-l wx-glow', 'min(70vmin,380px)', { background: 'radial-gradient(circle, rgba(255,250,225,.75), rgba(255,236,170,.25) 40%, rgba(255,236,170,0) 70%)' });
      L.add('wx-l wx-rise', { left: '-10%', right: '-10%', top: '45%', height: '65%', background: `url(${texture('mist')}) center/100% 100%`, opacity: 0.6 });
      R.sys.push(dustSys({ dens: 1.2, max: 30, colors: ['255,244,210'], vx: [-4, 6], vy: [-14, -6], r: [0.8, 2], alpha: 0.5 }));
      break;
    case 'night':
      L.anchored('night', 'wx-l wx-glow', 'min(56vmin,300px)', { background: 'radial-gradient(circle, rgba(255,246,210,.45), rgba(200,210,255,.14) 45%, rgba(200,210,255,0) 70%)', animationDuration: '7s' });
      R.sys.push(starSys({ count: 70 }));
      break;
    case 'partly_cloudy':
      R.kb = true;
      L.drift('cloud', { top: '-6%', height: '40%', opacity: 0.4 }, 110);
      L.drift('cloud', { top: '66%', height: '36%', opacity: 0.3 }, 150, true);
      break;
    case 'overcast':
      R.kb = true;
      L.add('wx-l wx-dim', { background: 'linear-gradient(rgba(38,48,64,.26), rgba(38,48,64,.12))' });
      L.drift('mist', { top: '20%', height: '50%', opacity: 0.35 }, 200);
      break;
    case 'fog':
      R.kb = true;
      L.bgClone({ filter: 'blur(5px)', animation: 'wx-dim 9s ease-in-out infinite' });
      L.drift('mist', { top: '8%', height: '34%', opacity: 0.7 }, 75);
      L.drift('mist', { top: '38%', height: '30%', opacity: 0.6 }, 100, true);
      L.drift('mist', { top: '64%', height: '40%', opacity: 0.75 }, 60);
      break;
    case 'drizzle':
      L.drift('mist', { top: '50%', height: '50%', opacity: 0.35 }, 90);
      R.sys.push(rainSys({ dens: 9, max: 90, speed: [380, 480], angle: 0, len: [9, 15], width: 0.8, alpha: 0.42 }));
      break;
    case 'downpour':
      L.add('wx-l wx-dim', { background: 'rgba(25,40,60,.18)', animationDuration: '10s' });
      L.drift('mist', { top: '45%', height: '60%', opacity: 0.4 }, 40);
      R.sys.push(rainSys({ dens: 28, max: 260, speed: [900, 1150], angle: 14, len: [24, 40], width: 0.8, alpha: 0.32 }));
      R.sys.push(rainSys({ dens: 12, max: 110, speed: [1250, 1500], angle: 15, len: [38, 60], width: 1.4, alpha: 0.42 }));
      break;
    case 'thunderstorm': {
      const f = flash();
      L.add('wx-l wx-dim', { background: 'rgba(30,24,50,.2)', animationDuration: '12s' });
      R.sys.push(rainSys({ dens: 24, max: 230, speed: [950, 1200], angle: 10, len: [24, 40], width: 0.8, alpha: 0.3, color: '210,210,245' }));
      R.sys.push(rainSys({ dens: 9, max: 90, speed: [1300, 1550], angle: 11, len: [36, 56], width: 1.3, alpha: 0.38, color: '210,210,245' }));
      R.sys.push(lightningSys(f));
      break;
    }
    case 'snow':
      R.sys.push(snowSys({ dens: 9, max: 90, r: [0.8, 1.6], vy: [22, 40], sway: [8, 18], alpha: 0.55 }));
      R.sys.push(snowSys({ dens: 5, max: 50, r: [1.8, 3.2], vy: [36, 60], sway: [14, 30], alpha: 0.85 }));
      break;
    case 'blizzard':
      L.drift('mist', { top: '0%', height: '60%', opacity: 0.55 }, 14);
      L.drift('mist', { top: '45%', height: '60%', opacity: 0.6 }, 10);
      R.sys.push(snowSys({ dens: 30, max: 300, r: [0.7, 1.6], vy: [90, 160], sway: [10, 25], wind: 340, gust: 0.35, alpha: 0.6 }));
      R.sys.push(snowSys({ dens: 9, max: 90, r: [1.8, 3], vy: [120, 200], sway: [10, 30], wind: 480, gust: 0.35, alpha: 0.85 }));
      R.sys.push(streakSys({ count: 22, speed: [700, 950], len: [60, 140], alpha: 0.35, angle: 12 }));
      break;
    case 'hail':
      R.sys.push(rainSys({ dens: 8, max: 80, speed: [900, 1100], angle: 6, len: [20, 32], width: 0.7, alpha: 0.25 }));
      R.sys.push(hailSys({ dens: 6, max: 60 }));
      break;
    case 'freezing_rain':
      L.frost();
      R.sys.push(rainSys({ dens: 14, max: 140, speed: [520, 640], angle: 4, len: [12, 20], width: 0.75, alpha: 0.42, color: '225,240,255' }));
      break;
    case 'wind':
      R.pan = true;
      L.drift('streak', { top: '0%', height: '45%', opacity: 0.55 }, 16);
      L.drift('streak', { top: '50%', height: '40%', opacity: 0.4 }, 22);
      R.sys.push(streakSys({ count: 26, speed: [380, 620], len: [80, 200], alpha: 0.5, angle: -4 }));
      break;
    case 'dust':
      R.pan = true;
      L.drift('mist', { top: '10%', height: '60%', opacity: 0.45, filter: 'sepia(1) saturate(2.2) hue-rotate(-12deg)' }, 26);
      L.add('wx-l wx-dim', { background: 'rgba(190,120,50,.16)', animationDuration: '9s' });
      R.sys.push(dustSys({ dens: 22, max: 220, colors: ['214,150,80', '236,190,120', '180,110,55'], vx: [120, 220], vy: [20, 60], r: [0.7, 2.2], alpha: 0.6 }));
      R.sys.push(dustSys({ dens: 2.5, max: 26, colors: ['230,170,100'], vx: [80, 140], vy: [10, 40], r: [5, 11], alpha: 0.12 }));
      break;
    case 'heat':
      L.anchored('heat', 'wx-l wx-glow', 'min(80vmin,420px)', { background: 'radial-gradient(circle, rgba(255,248,215,.7), rgba(255,210,140,.22) 40%, rgba(255,210,140,0) 70%)', animationDuration: '4.5s' });
      L.heatShimmer(0.4);
      L.heatwave();
      break;
    case 'cyclone':
      L.anchored('cyclone', 'wx-l wx-rays ccw', 'min(220vmax,2000px)', { background: `url(${texture('streak')}) center/50% 50%`, opacity: 0.35, animationDuration: '50s', WebkitMaskImage: 'radial-gradient(circle, #000 15%, transparent 65%)', maskImage: 'radial-gradient(circle, #000 15%, transparent 65%)' });
      L.drift('streak', { top: '55%', height: '45%', opacity: 0.45 }, 9, true);
      R.sys.push(spiralSys({ count: 170, anchor: ANCHORS.cyclone, alpha: 0.42 }));
      break;
  }
  return R;
}

/* ── 装配 ── */

export function applyWeather(container, stateId, { motion = 'auto', onQuality } = {}) {
  if (!container) throw new Error('applyWeather 需要一个容器');
  ensureGlobals();
  const st = BY_ID[stateId] || BY_ID.sunny;
  const prev = container.__wx;
  if (prev) prev.destroy(true);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  const reduce = motion === 'off' || (motion === 'auto' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = el('wx-root'); root.dataset.state = st.id; root.dataset.motion = motion;
  const bg = document.createElement('img'); bg.className = 'wx-bg'; bg.alt = ''; bg.decoding = 'async';
  bg.onerror = () => { if (!bg.dataset.fb) { bg.dataset.fb = '1'; bg.src = BG_BASE + st.file + '.png'; } };
  bg.src = BG_BASE + st.file + '.webp';
  const fx = el('wx-fx'); const cv = document.createElement('canvas'); cv.className = 'wx-cv';
  root.append(bg, fx, cv);

  // 底图按 cover 铺满：算出底图坐标 (u,v) 在屏幕上的位置
  let W = 0, H = 0;
  const pt = (u, v) => { const s = Math.max(W / IMG_W, H / IMG_H); return [(W - IMG_W * s) / 2 + u * IMG_W * s, (H - IMG_H * s) / 2 + v * IMG_H * s]; };
  const anchored = [];
  const frostEls = [];
  const L = {
    add(cls, style) { const d = el(cls, style); fx.appendChild(d); return d; },
    anchored(key, cls, size, style) { const d = L.add(cls, { width: size, height: size, ...style }); anchored.push([d, ANCHORS[key]]); return d; },
    drift(kind, style, seconds, rev) {
      const mask = 'linear-gradient(to bottom, transparent, #000 25%, #000 75%, transparent)';
      return L.add('wx-l wx-drift' + (rev ? ' rev' : ''), { backgroundImage: `url(${texture(kind)})`, animationDuration: seconds + 's', WebkitMaskImage: mask, maskImage: mask, ...style });
    },
    bgClone(style) {
      const c = document.createElement('img'); c.className = 'wx-bgc wx-l'; c.alt = ''; c.src = bg.src;
      bg.addEventListener('error', () => { c.src = BG_BASE + st.file + '.png'; }, { once: true });
      Object.assign(c.style, style); fx.appendChild(c); return c;
    },
    // 热浪扭曲只做底部一条：底图副本放进底部容器，对齐原图后加 SVG 位移滤镜
    heatShimmer(frac) {
      const wrap = L.add('wx-l', { left: '0', right: '0', bottom: '0', height: frac * 100 + '%', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to top, #000 45%, transparent)', maskImage: 'linear-gradient(to top, #000 45%, transparent)' });
      const c = document.createElement('img'); c.className = 'wx-bgc'; c.alt = ''; c.src = bg.src;
      bg.addEventListener('error', () => { c.src = BG_BASE + st.file + '.png'; }, { once: true });
      Object.assign(c.style, { top: 'auto', bottom: '0', height: 100 / frac + '%', filter: `url(#${heatFilterId})` });
      wrap.appendChild(c); return wrap;
    },
    frost() { const d = L.add('wx-l', { inset: '0' }); frostEls.push(d); return d; },
    heatwave() {
      const wrap = L.add('wx-l', { left: '0', right: '0', bottom: '0', height: '42%', overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to top, #000 20%, transparent)', maskImage: 'linear-gradient(to top, #000 20%, transparent)' });
      const w = el('wx-l wx-heatwave', { background: 'repeating-linear-gradient(to top, rgba(255,226,170,0) 0 18px, rgba(255,226,170,.2) 26px, rgba(255,226,170,0) 34px 52px)' });
      wrap.appendChild(w); return w;
    },
  };
  const R = recipe(st.id, L);
  if (R.kb) bg.classList.add('wx-kb', 'wx-l');
  if (R.pan) bg.classList.add('wx-pan', 'wx-l');
  if (reduce) fx.querySelectorAll('.wx-flash').forEach(n => n.remove());

  const g = cv.getContext('2d');
  let q = 1, dpr = 1, raf = 0, last = 0, t0 = performance.now(), running = false, destroyed = false;
  const env = { pt };
  const sys = reduce ? [] : R.sys;
  // 夜里星星不算「动得厉害」，减少动态时也保留静态星点
  const staticStars = reduce && st.id === 'night' ? [starSys({ count: 70 })] : [];

  function layout() {
    const r = container.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, q < 1 ? 1 : 1.75);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    for (const [d, [u, v]] of anchored) { const [x, y] = pt(u, v); d.style.left = x + 'px'; d.style.top = y + 'px'; }
    for (const d of frostEls) { d.replaceChildren(Object.assign(frostCanvas(W, H), { style: 'width:100%;height:100%;display:block' })); }
    for (const s of sys) s.reset(W, H, q, env);
    for (const s of staticStars) { s.reset(W, H, 1, env); }
    if (staticStars.length) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); staticStars.forEach(s => s.draw(g, 0)); }
  }

  // 前 2 秒量一下帧时间，太慢就粒子减半、canvas 降到 1x
  let probe = [], probed = false;
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
    const t = (now - t0) / 1000;
    if (!probed) {
      probe.push(dt);
      if (t > 2.2 && probe.length > 20) {
        probed = true; probe.sort((a, b) => a - b);
        if (probe[probe.length >> 1] > 0.024) { q = 0.5; layout(); onQuality && onQuality(q); }
      }
    }
    for (const s of sys) s.update(dt, t);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    for (const s of sys) s.draw(g, t);
  }
  function start() { if (running || destroyed || !sys.length) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  const onVis = () => (document.hidden ? stop() : start());

  if (prev && prev.root.isConnected) prev.root.after(root); else container.prepend(root);
  layout();
  const ro = new ResizeObserver(() => layout()); ro.observe(container);
  document.addEventListener('visibilitychange', onVis);
  start();
  const show = () => requestAnimationFrame(() => root.classList.add('on'));
  if (bg.complete && bg.naturalWidth) show(); else { bg.addEventListener('load', show, { once: true }); setTimeout(show, 1500); }

  // 旧层淡出后再移除，切换时不闪
  const handle = {
    state: st.id, root, get quality() { return q; }, reducedMotion: reduce,
    // replaced=true：新层在上面淡入，旧层原样垫着，淡入完再拿掉
    destroy(replaced = false) {
      if (destroyed) return; destroyed = true; stop(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      if (!replaced) root.classList.remove('on');
      setTimeout(() => root.remove(), 900);
      if (container.__wx === handle) container.__wx = null;
    },
  };
  container.__wx = handle;
  return handle;
}
