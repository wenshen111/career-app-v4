// 每种天气的「签名动效」：叠在 GPT v3 图层之间，让一眼就认得出是哪种天气。
// 全部在 1440×3120 设计坐标里画（和图层同一套坐标，跟着场景一起 cover），不加任何依赖：
//   Canvas 2D：分形闪电、涟漪、溅水、积雪、流星、冰雹弹跳、冰晶闪、风痕、环形雨、镜头光斑、热气
//   DOM + transform/opacity：云影、能见度/明暗脉动、沙墙、快云（只走合成层，便宜）
//   SVG 滤镜：酷热底部折射
// 由 weather.mjs 调用；这个文件 import 时不碰 DOM。

const CW = 1440, CH = 3120, TAU = Math.PI * 2;
const R = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };

// 不定期的「一阵」：每隔 every 秒（随机）来一次，持续 dur 秒，返回 0–1 的平滑包络
function pulses(every, dur, first = R(every[0] * 0.3, every[0])) {
  let start = first;
  return t => {
    if (t < start - every[1] * 2) start = t + R(1, every[0]);      // 时间被拨回（seek）时重排
    while (t > start + dur) start += dur + R(every[0], every[1]);
    const x = (t - start) / dur;
    return x < 0 || x > 1 ? 0 : Math.pow(Math.sin(Math.PI * x), 2);
  };
}

function div(style) { const d = document.createElement('div'); d.className = 'wx-ly'; Object.assign(d.style, style); return d; }

// 从一张图层（太阳/月亮）算出亮的地方在哪：缩小画一遍，按 alpha² 求重心
function centroid(img, fallback) {
  try {
    const w = 180, h = 390, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data; let sx = 0, sy = 0, sw = 0;
    for (let i = 3; i < d.length; i += 4) { const a = d[i] / 255, wgt = a * a * a; if (wgt > 0.02) { const p = (i - 3) / 4; sx += (p % w) * wgt; sy += ((p / w) | 0) * wgt; sw += wgt; } }
    return sw > 0.5 ? [sx / sw * CW / w, sy / sw * CH / h] : fallback;
  } catch { return fallback; }
}

/**
 * @param id     天气 id
 * @param ctx    { imgAt(z) → 已加载的该层 <img>, texture(name) → Promise<img> }
 */
export function createFx(id, ctx) {
  const els = [];               // [{ z, el }]
  const canvases = [];          // 需要随布局改尺寸的 canvas
  const sprites = [];           // 需要释放的 img
  let view = { x0: 0, y0: 0, x1: CW, y1: CH }, k = 1;
  const fx = { elements: els, frames: [], rests: [], pending: [] };
  const tex = name => { const p = ctx.texture(name); fx.pending.push(p.catch(() => {})); return p; };

  const layer = (z, el) => { els.push({ z, el }); return el; };
  const canvas = z => {
    const cv = document.createElement('canvas'); cv.className = 'wx-ly'; const g = cv.getContext('2d');
    canvases.push(cv); layer(z, cv);
    const c = { cv, g, begin() { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(k, 0, 0, k, 0, 0); } };
    fx.rests.push(() => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); });
    return c;
  };
  const ground = () => view.y1;                       // 屏幕上能看到的最底边（设计坐标）
  const sunAt = (z, fb) => { const im = ctx.imgAt(z); return im ? centroid(im, fb) : fb; };

  fx.layout = ({ s, dpr, view: v }) => {
    k = s * dpr; view = v;
    for (const cv of canvases) { cv.width = Math.round(CW * k); cv.height = Math.round(CH * k); }
    if (fx.onLayout) fx.onLayout();
  };
  fx.frame = (t, dt) => { for (const f of fx.frames) f(t, dt); };
  fx.rest = () => { for (const r of fx.rests) r(); };
  fx.destroy = () => { for (const cv of canvases) cv.width = cv.height = 0; for (const im of sprites) im.src = ''; };

  /* ── 可复用的小部件 ── */

  // 云影：几块很大的柔边暗斑在下半屏慢慢横移，像云从太阳前面经过
  function cloudShadows(z, n, alpha, speed) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const w = R(1300, 2000), h = w * R(0.45, 0.6);
      const el = layer(z, div({ width: w + 'px', height: h + 'px', left: '0', top: '0', willChange: 'transform',
        background: `radial-gradient(closest-side, rgba(18,36,64,${alpha}), rgba(18,36,64,${alpha * 0.55}) 45%, rgba(18,36,64,0))` }));
      list.push({ el, w, h, y: R(900, 2900) - h / 2, v: R(speed[0], speed[1]), x0: R(0, 1) });
    }
    fx.frames.push(t => {
      for (const c of list) {
        const span = CW + c.w * 2, x = ((c.x0 * span + t * c.v) % span) - c.w;
        c.el.style.transform = `translate3d(${x.toFixed(1)}px,${(c.y + Math.sin(t / 37 + c.x0 * 9) * 60).toFixed(1)}px,0)`;
      }
    });
    fx.rests.push(() => list.forEach(c => (c.el.style.transform = 'translate3d(-3000px,0,0)')));
    return list;
  }

  // 整体明暗/能见度脉动层
  function veil(z, color, fn) {
    const el = layer(z, div({ inset: '0', background: color, opacity: 0 }));
    fx.frames.push((t, dt) => { el.style.opacity = fn(t, dt).toFixed(3); });
    fx.rests.push(() => (el.style.opacity = 0));
    return el;
  }

  // 地平线热气：从底部升起、左右扭动的淡色气流
  function heatWisps(c, n, height, alpha) {
    const ws = Array.from({ length: n }, () => ({ x: R(0, CW), ph: R(0, 10), sp: R(0.08, 0.16), w: R(30, 64) }));
    return t => {
      const g = c.g, gy = ground();
      g.lineCap = 'round';
      for (const w of ws) {
        const life = (t * w.sp + w.ph) % 1, a = Math.sin(Math.PI * life) * alpha;
        if (a < 0.003) continue;
        const base = gy - life * height * 0.6;
        g.strokeStyle = `rgba(255,248,230,${a.toFixed(3)})`; g.lineWidth = w.w;
        g.beginPath();
        for (let i = 0; i <= 12; i++) {
          const yy = base - i / 12 * height * 0.5;
          const xx = w.x + Math.sin(yy * 0.012 + t * 1.7 + w.ph) * 26 * (i / 12);
          i ? g.lineTo(xx, yy) : g.moveTo(xx, yy);
        }
        g.stroke();
      }
    };
  }

  // 用原生纹理做的快速掠过的云（完整纹理，从一侧进、另一侧出，不会露边）
  function sweepingClouds(z, texName, n, speed, alpha, yr) {
    const list = [];
    tex(texName).then(src => {
      for (let i = 0; i < n; i++) {
        const im = src.cloneNode(); sprites.push(im);
        const w = R(1500, 2300), h = w * 2 / 3;
        Object.assign(im.style, { position: 'absolute', left: '0', top: '0', width: w + 'px', height: h + 'px', opacity: alpha, willChange: 'transform' });
        const holder = layer(z, div({ inset: '0', overflow: 'visible' })); holder.appendChild(im);
        list.push({ im, w, h, y: R(yr[0], yr[1]) - h / 2, v: R(speed[0], speed[1]), x0: i / n + R(0, 0.2), flip: Math.random() < 0.5 });
      }
    }).catch(() => {});
    fx.frames.push(t => {
      for (const c of list) {
        const span = CW + c.w * 1.2, x = ((c.x0 * span + t * c.v) % span) - c.w * 0.9;
        c.im.style.transform = `translate3d(${x.toFixed(1)}px,${c.y.toFixed(1)}px,0)${c.flip ? ' scaleX(-1)' : ''}`;
      }
    });
    fx.rests.push(() => list.forEach(c => (c.im.style.transform = 'translate3d(-4000px,0,0)')));
  }

  /* ── 每种天气 ── */

  switch (id) {
    case 'sunny':
    case 'partly_cloudy': {
      const sunny = id === 'sunny';
      const sun = sunAt(11, [190, 150]);
      cloudShadows(46, sunny ? 3 : 4, sunny ? 0.13 : 0.12, sunny ? [16, 26] : [22, 34]);
      if (!sunny) veil(86, 'rgba(255,250,235,1)', t => 0.035 * (0.5 + 0.5 * Math.sin(t / 19 * TAU)));  // 太阳从云缝里时明时暗
      const c = canvas(84);
      const wisps = heatWisps(c, sunny ? 9 : 5, 520, sunny ? 0.05 : 0.03);
      // 镜头光斑：沿太阳→画面中心的轴排开几枚光圈，轴极慢地摆动，六边形光圈自己转
      const ghosts = [[0.3, 60, '255,240,200', 0.26, 0], [0.5, 170, '255,226,170', 0.13, 6], [0.74, 40, '200,235,255', 0.3, 0],
        [1.05, 260, '180,220,255', 0.1, 6], [1.32, 95, '255,215,180', 0.18, 0], [1.62, 52, '210,240,255', 0.24, 6]];
      fx.frames.push(t => {
        c.begin(); const g = c.g;
        // 慢转的日芒
        g.save(); g.translate(sun[0], sun[1]); g.rotate(t * 0.018);
        for (let i = 0; i < 14; i++) {
          const a = i / 14 * TAU, L = 420 + (i % 3) * 260;
          const gr = g.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L);
          gr.addColorStop(0, `rgba(255,248,220,${sunny ? 0.24 : 0.15})`); gr.addColorStop(1, 'rgba(255,248,220,0)');
          g.strokeStyle = gr; g.lineWidth = i % 2 ? 14 : 28;
          g.beginPath(); g.moveTo(Math.cos(a) * 60, Math.sin(a) * 60); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.stroke();
        }
        g.restore();
        const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
        const ang = Math.atan2(cy - sun[1], cx - sun[0]) + Math.sin(t / 41 * TAU) * 0.06, dist = Math.hypot(cx - sun[0], cy - sun[1]);
        const breathe = 0.8 + 0.2 * Math.sin(t / 9 * TAU);
        g.globalCompositeOperation = 'lighter';
        for (const [f, r, col, a, sides] of ghosts) {
          const x = sun[0] + Math.cos(ang) * dist * f, y = sun[1] + Math.sin(ang) * dist * f;
          const gr = g.createRadialGradient(x, y, 0, x, y, r);
          gr.addColorStop(0, `rgba(${col},${a * breathe})`); gr.addColorStop(0.7, `rgba(${col},${a * 0.6 * breathe})`); gr.addColorStop(1, `rgba(${col},0)`);
          g.fillStyle = gr; g.beginPath();
          if (sides) { for (let i = 0; i < 6; i++) { const q = t * 0.05 + i / 6 * TAU; i ? g.lineTo(x + Math.cos(q) * r, y + Math.sin(q) * r) : g.moveTo(x + Math.cos(q) * r, y + Math.sin(q) * r); } g.closePath(); }
          else g.arc(x, y, r, 0, TAU);
          g.fill();
        }
        g.globalCompositeOperation = 'source-over';
        wisps(t);
      });
      break;
    }

    case 'night': {
      fx.motion = z => (z === 10 ? { type: 'breathe', periodSeconds: 7, minOpacity: 0.55 } : null);   // 月晕呼吸
      const moon = sunAt(11, [1150, 320]);
      const halo = layer(11, div({ left: moon[0] - 420 + 'px', top: moon[1] - 420 + 'px', width: '840px', height: '840px', borderRadius: '50%',
        background: 'radial-gradient(closest-side, rgba(235,240,255,.22), rgba(200,215,255,.08) 55%, rgba(200,215,255,0))' }));
      fx.frames.push(t => { const b = 0.5 + 0.5 * Math.sin(t / 7 * TAU); halo.style.opacity = (0.55 + 0.45 * b).toFixed(3); halo.style.transform = `scale(${(0.94 + 0.1 * b).toFixed(3)})`; });
      // 流星：二三十秒一颗，斜着划过上半屏，带渐隐的尾巴
      const c = canvas(13); let next = R(4, 9), m = null;
      fx.frames.push(t => {
        if (t < next - 60) next = t + R(4, 9);
        if (!m && t >= next) {
          const x = R(view.x0 + 200, view.x1 + 300), y = R(view.y0 + 80, view.y0 + 900), a = R(2.35, 2.7);
          m = { x, y, dx: Math.cos(a), dy: Math.sin(a), L: R(1100, 1700), t0: t, dur: R(0.8, 1.2), tail: R(500, 800) };
          next = t + R(18, 38);
        }
        c.begin();
        if (m) {
          const p = (t - m.t0) / m.dur; if (p > 1 || p < 0) { m = null; return; }
          const head = m.L * smooth(p), fade = Math.sin(Math.PI * p), g = c.g;
          const hx = m.x + m.dx * head, hy = m.y + m.dy * head, tx = hx - m.dx * m.tail, ty = hy - m.dy * m.tail;
          const gr = g.createLinearGradient(hx, hy, tx, ty);
          gr.addColorStop(0, `rgba(255,255,245,${0.95 * fade})`); gr.addColorStop(1, 'rgba(200,220,255,0)');
          g.strokeStyle = gr; g.lineWidth = 10; g.lineCap = 'round'; g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke();
          g.fillStyle = `rgba(255,255,255,${0.9 * fade})`; g.beginPath(); g.arc(hx, hy, 12, 0, TAU); g.fill();
        }
      });
      break;
    }

    case 'overcast':
      // 云层极慢旋转 + 压抑的整体明暗（像气压在往下压）
      fx.nodeMod = (n, t) => ({ rot: Math.sin(t / 70 * TAU + n.i) * 0.9 });
      veil(85, 'rgb(28,36,50)', t => 0.07 + 0.07 * Math.sin(t / 17 * TAU) + 0.025 * Math.sin(t / 5.3 * TAU));
      cloudShadows(46, 3, 0.1, [10, 16]);
      break;

    case 'fog': {
      // 远近雾墙视差：远的慢、近的快、各自呼吸；再加一层能见度脉动的白幕
      fx.nodeMod = (n, t) => ({ opMul: n.z >= 43 ? 0.75 + 0.35 * Math.sin(t / (11 + n.i * 3) * TAU + n.i) : 1, dxMul: n.z >= 43 ? 2.2 + n.i * 0.6 : 1 });
      veil(49, 'rgb(236,241,246)', t => 0.12 + 0.12 * Math.sin(t / 14 * TAU) + 0.04 * Math.sin(t / 4.7 * TAU));
      veil(88, 'rgb(236,241,246)', t => 0.04 + 0.05 * Math.sin(t / 14 * TAU + 0.6));
      break;
    }

    case 'drizzle': {
      // 底部水面涟漪 + 偶尔稍密的一阵
      const burst = pulses([14, 26], 5);
      fx.particle = (i, t) => { const b = burst(t); return { mult: 1 + 0.25 * b, dup: i > 0 ? b * 0.9 : 0 }; };
      const c = canvas(72); const rips = []; let acc = 0;
      fx.frames.push((t, dt) => {
        acc += dt * (5 + 9 * burst(t));
        while (acc > 1) { acc--; rips.push({ x: R(view.x0, view.x1), y: ground() - R(10, 300), t0: t, s: R(0.7, 1.2) }); }
        c.begin(); const g = c.g;
        for (let i = rips.length - 1; i >= 0; i--) {
          const r = rips[i], p = (t - r.t0) / 1.1;
          if (p > 1 || p < 0) { rips.splice(i, 1); continue; }
          const depth = 0.5 + 0.5 * (r.y - (ground() - 300)) / 300;   // 越靠下越大（近）
          const rad = (30 + 160 * smooth(p)) * r.s * (0.6 + 0.6 * depth);
          for (const [f, a] of [[1, 0.55], [0.6, 0.35]]) {
            g.strokeStyle = `rgba(230,242,255,${(a * (1 - p)).toFixed(3)})`; g.lineWidth = 7;
            g.beginPath(); g.ellipse(r.x, r.y, rad * f, rad * f * 0.28, 0, 0, TAU); g.stroke();
          }
        }
      });
      break;
    }

    case 'downpour': {
      // 阵风：每十几秒风大一下，雨更斜更快；底部不停溅起水花
      const gust = pulses([9, 15], 3.2);
      fx.particle = (i, t) => { const g = gust(t); return { mult: 1 + 0.55 * g, skew: -0.32 * g, dup: i === 2 ? 0.5 * g : 0 }; };
      veil(76, 'rgb(200,215,230)', t => 0.05 + 0.1 * gust(t));
      const c = canvas(74); const drops = []; let acc = 0;
      fx.frames.push((t, dt) => {
        const g0 = gust(t);
        acc += dt * (28 + 30 * g0);
        while (acc > 1) {
          acc--; const x = R(view.x0, view.x1), y = ground() - R(0, 260), n = 3 + (Math.random() * 3 | 0);
          drops.push({ x, y, t0: t, ring: true, s: R(0.7, 1.3) });
          for (let j = 0; j < n; j++) drops.push({ x, y, t0: t, vx: R(-400, 400) - 300 * g0, vy: R(-1000, -550), s: R(6, 11) });
        }
        c.begin(); const g = c.g;
        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i], a = t - d.t0;
          if (d.ring) {
            const p = a / 0.35; if (p > 1 || p < 0) { drops.splice(i, 1); continue; }
            g.strokeStyle = `rgba(225,238,250,${(0.6 * (1 - p)).toFixed(3)})`; g.lineWidth = 6;
            g.beginPath(); g.ellipse(d.x, d.y, (25 + 100 * p) * d.s, (10 + 25 * p) * d.s, 0, Math.PI, TAU); g.stroke();
          } else {
            if (a > 0.42 || a < 0) { drops.splice(i, 1); continue; }
            const x = d.x + d.vx * a, y = d.y + d.vy * a + 0.5 * 5200 * a * a;
            g.fillStyle = `rgba(230,240,252,${(0.7 * (1 - a / 0.42)).toFixed(3)})`;
            g.beginPath(); g.arc(x, y, d.s, 0, TAU); g.fill();
          }
        }
      });
      break;
    }

    case 'thunderstorm': {
      // 闪电自己排期：不规律间隔，先有 0.3 秒云内背光预兆，再劈下一道分形闪电，之后余光淡出；三成概率紧跟一记回闪
      const bolt = canvas(53);
      let ev = null, next = R(2, 4);
      const fractal = (x1, y1, x2, y2, disp, depth, out) => {
        if (depth === 0 || disp < 3) { out.push([x2, y2]); return; }
        const mx = (x1 + x2) / 2 + R(-disp, disp), my = (y1 + y2) / 2 + R(-disp, disp) * 0.3;
        fractal(x1, y1, mx, my, disp / 2, depth - 1, out); fractal(mx, my, x2, y2, disp / 2, depth - 1, out);
      };
      const makeBolt = () => {
        const x = R(view.x0 + 200, view.x1 - 200), y0 = R(380, 620), y1 = R(1500, 2300);
        const main = [[x, y0]]; fractal(x, y0, x + R(-260, 260), y1, 260, 7, main);
        const branches = [];
        for (let i = 0; i < 5; i++) {
          const s = main[(R(0.15, 0.75) * main.length) | 0], dir = Math.random() < 0.5 ? -1 : 1;
          const b = [s.slice()]; fractal(s[0], s[1], s[0] + dir * R(160, 420), s[1] + R(200, 560), 120, 5, b); branches.push(b);
        }
        return { main, branches, x, y0 };
      };
      const strike = t => {
        const b = Math.random() < 0.35 ? null : makeBolt();          // 约三分之一用 GPT 画的那道电光
        ev = { t0: t, b, gptBolt: !b, restrike: Math.random() < 0.3, x: b ? b.x : 980, y: b ? b.y0 : 520 };
      };
      // 每个时刻的亮度：pre 预兆 0–0.3s，主闪 0.3s 起
      const level = t => {
        if (!ev) return { pre: 0, flash: 0, glow: 0 };
        const d = t - ev.t0;
        const pre = d < 0.3 ? smooth(d / 0.3) * 0.45 : 0;
        let f = 0; const s = d - 0.3;
        if (s >= 0) f = s < 0.06 ? 1 : s < 0.14 ? 0.25 : s < 0.2 ? 0.85 : Math.max(0, 0.85 * (1 - (s - 0.2) / 0.55));
        if (ev.restrike && s > 0.55) { const r = s - 0.55; f = Math.max(f, r < 0.05 ? 0.9 : Math.max(0, 0.9 * (1 - (r - 0.05) / 0.4))); }
        const glow = Math.max(pre, s >= 0 ? Math.max(f, s < 1.6 ? 0.5 * (1 - s / 1.6) : 0) : 0);
        return { pre, flash: f, glow };
      };
      fx.lightning = (role, t) => {
        const L = level(t);
        return role === 'glow' ? Math.min(1, L.glow * 0.95) : ev && ev.gptBolt ? L.flash : 0;
      };
      fx.frames.push(t => {
        if (t < next - 30) next = t + R(2, 4);
        if (t >= next) { strike(t); next = t + R(3.5, 11) * (Math.random() < 0.2 ? 0.35 : 1); }
        if (ev && t - ev.t0 > 2.4) ev = null;
        bolt.begin(); if (!ev) return;
        const g = bolt.g, L = level(t);
        if (L.glow > 0.01) { // 云里被点亮的那一团
          const gr = g.createRadialGradient(ev.x, ev.y, 0, ev.x, ev.y, 700);
          gr.addColorStop(0, `rgba(215,200,255,${(0.42 * L.glow).toFixed(3)})`); gr.addColorStop(1, 'rgba(215,200,255,0)');
          g.fillStyle = gr; g.fillRect(ev.x - 700, ev.y - 700, 1400, 1400);
        }
        if (ev.b && L.flash > 0.01) {
          g.lineJoin = 'round'; g.lineCap = 'round';
          const draw = (pts, w) => { g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
          for (const [lw, col, al] of [[80, '190,170,255', 0.12], [30, '225,215,255', 0.35], [10, '255,255,255', 1]]) {
            g.strokeStyle = `rgba(${col},${(al * L.flash).toFixed(3)})`;
            draw(ev.b.main, lw); ev.b.branches.forEach(b => draw(b, lw * 0.55));
          }
        }
      });
      fx.rests.push(() => { ev = null; });
      break;
    }

    case 'snow': {
      // 雪层左右慢慢摇摆；底部积雪从无到有慢慢长出来（约 90 秒长满）
      fx.particle = (i, t) => ({ dx: Math.sin(t * (0.35 + i * 0.12) + i * 2) * (40 + i * 35), mult: 1 });
      const c = canvas(72);
      const prof = Array.from({ length: 5 }, () => [R(0.002, 0.008), R(0, TAU), R(0.2, 1)]);
      const sparks = Array.from({ length: 26 }, () => ({ x: R(0, CW), ph: R(0, TAU), f: R(0.8, 2) }));
      fx.frames.push(t => {
        c.begin(); const g = c.g, gy = ground() + 4, grow = 0.3 + 0.7 * smooth(t / 75), H = 40 + 170 * grow;
        const yAt = x => gy - H * (0.55 + prof.reduce((s, [f, p, a]) => s + Math.sin(x * f + p) * a, 0) / 6);
        const gr = g.createLinearGradient(0, gy - H * 1.2, 0, gy);
        gr.addColorStop(0, `rgba(255,255,255,${0.85 * grow + 0.1})`); gr.addColorStop(0.5, `rgba(240,246,253,${0.9 * grow + 0.1})`); gr.addColorStop(1, `rgba(214,226,242,${0.9 * grow + 0.1})`);
        g.fillStyle = gr; g.beginPath(); g.moveTo(view.x0, gy + 10);
        for (let x = view.x0; x <= view.x1 + 20; x += 20) g.lineTo(x, yAt(x));
        g.lineTo(view.x1 + 20, gy + 10); g.closePath(); g.fill();
        g.strokeStyle = `rgba(150,175,214,${0.45 * grow + 0.1})`; g.lineWidth = 9; g.beginPath();
        for (let x = view.x0; x <= view.x1 + 20; x += 20) x === view.x0 ? g.moveTo(x, yAt(x) + 6) : g.lineTo(x, yAt(x) + 6);
        g.stroke();
        for (const s of sparks) { const a = Math.max(0, Math.sin(t * s.f + s.ph)) ** 8 * grow; if (a > 0.02) { g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(s.x, yAt(s.x) + 20, 10, 0, TAU); g.fill(); } }
      });
      break;
    }

    case 'blizzard': {
      // 横风一阵阵加剧：雪更斜更快，能见度跟着变差；额外一层横飞的雪粒
      const gust = pulses([5, 9], 3.5);
      fx.particle = (i, t) => { const g = gust(t); return { mult: 1 + 0.9 * g, skew: -0.4 * g, dx: Math.sin(t * 0.5 + i) * 30 }; };
      veil(74, 'rgb(240,245,250)', t => 0.08 + 0.3 * gust(t) + 0.04 * Math.sin(t / 6 * TAU));
      const c = canvas(73);
      const flakes = Array.from({ length: 110 }, () => ({ x: R(0, CW), y: R(0, CH), v: R(1400, 2600), l: R(80, 260), w: R(5, 12), a: R(0.35, 0.8) }));
      fx.frames.push((t, dt) => {
        c.begin(); const g = c.g, gm = 1 + 1.4 * gust(t); g.lineCap = 'round';
        for (const f of flakes) {
          f.x += f.v * gm * dt; f.y += f.v * 0.12 * dt;
          if (f.x > view.x1 + 120) { f.x = view.x0 - R(20, 300); f.y = R(view.y0, view.y1); }
          if (f.y > view.y1) f.y = view.y0;
          g.strokeStyle = `rgba(255,255,255,${f.a})`; g.lineWidth = f.w;
          g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(f.x - f.l * gm, f.y - f.l * gm * 0.12); g.stroke();
        }
      });
      break;
    }

    case 'hail': {
      // 短粗冰粒高速砸下，碰到底部弹一下、崩出碎屑后消失
      const c = canvas(72);
      const stones = Array.from({ length: 22 }, () => ({ dead: true }));
      const shards = [];
      const spawn = s => Object.assign(s, { dead: false, x: R(view.x0, view.x1), y: view.y0 - R(0, 1600), vx: R(-60, 40), vy: R(2300, 2900), r: R(16, 28), floor: ground() - R(0, 260), b: 0, fade: 1 });
      fx.frames.push((t, dt) => {
        c.begin(); const g = c.g;
        for (const s of stones) {
          if (s.dead) spawn(s);
          s.vy += 3800 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
          if (s.y >= s.floor && s.vy > 0) {
            s.y = s.floor; s.b++;
            if (s.b === 1) { s.vy = -s.vy * 0.28; s.vx = R(-260, 260); for (let j = 0; j < 4; j++) shards.push({ x: s.x, y: s.y, vx: R(-300, 300), vy: R(-500, -200), t0: t }); }
            else s.vy = -s.vy * 0.15;
          }
          if (s.b >= 1) s.fade -= dt * 2.2;
          if (s.fade <= 0) { s.dead = true; continue; }
          const a = clamp(s.fade);
          g.fillStyle = `rgba(235,244,255,${0.92 * a})`; g.beginPath();
          g.ellipse(s.x, s.y, s.r, s.r * (s.b ? 1 : 1.35), 0, 0, TAU); g.fill();
          g.fillStyle = `rgba(255,255,255,${a})`; g.beginPath(); g.arc(s.x - s.r * 0.3, s.y - s.r * 0.35, s.r * 0.32, 0, TAU); g.fill();
        }
        for (let i = shards.length - 1; i >= 0; i--) {
          const d = shards[i], a = t - d.t0; if (a > 0.3 || a < 0) { shards.splice(i, 1); continue; }
          g.fillStyle = `rgba(240,248,255,${0.8 * (1 - a / 0.3)})`; g.beginPath();
          g.arc(d.x + d.vx * a * 2, d.y + d.vy * a * 2 + 4000 * a * a, 8, 0, TAU); g.fill();
        }
      });
      break;
    }

    case 'freezing_rain': {
      // 偶尔一颗冰晶闪一下（六角星）；底部 10% 一层静态冰纹
      const ice = canvas(71); let iceDrawn = false;
      const drawIce = () => {
        const g = ice.g; ice.begin(); const gy = ground(), top = gy - (gy - view.y0) * 0.1;
        const gr = g.createLinearGradient(0, top, 0, gy);
        gr.addColorStop(0, 'rgba(225,240,255,0)'); gr.addColorStop(0.35, 'rgba(225,240,255,.22)'); gr.addColorStop(1, 'rgba(235,246,255,.42)');
        g.fillStyle = gr; g.fillRect(view.x0, top, view.x1 - view.x0, gy - top);
        g.lineCap = 'round';
        const crack = (x, y, a, len, d) => {
          if (d <= 0 || len < 8) return;
          const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len * 0.45;
          g.strokeStyle = `rgba(250,253,255,${0.25 + 0.1 * d})`; g.lineWidth = 2 + d * 1.2;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
          crack(x2, y2, a + R(-0.6, 0.6), len * R(0.6, 0.85), d - 1);
          if (Math.random() < 0.55) crack(x2, y2, a + R(0.8, 1.6) * (Math.random() < 0.5 ? -1 : 1), len * R(0.4, 0.6), d - 2);
        };
        for (let i = 0; i < 22; i++) crack(R(view.x0, view.x1), R(top + (gy - top) * 0.35, gy), R(0, TAU), R(90, 220), 5);
        iceDrawn = true;
      };
      fx.onLayout = () => { iceDrawn = false; };
      fx.rests.push(() => { iceDrawn = false; });
      const c = canvas(73); const glints = []; let acc = 0;
      fx.frames.push((t, dt) => {
        if (!iceDrawn) drawIce();
        acc += dt * 2.6;
        while (acc > 1) { acc--; glints.push({ x: R(view.x0, view.x1), y: R(view.y0 + 200, view.y1 - 60), t0: t, r: R(34, 80), rot: R(0, 1) }); }
        c.begin(); const g = c.g;
        for (let i = glints.length - 1; i >= 0; i--) {
          const s = glints[i], p = (t - s.t0) / 0.45; if (p > 1 || p < 0) { glints.splice(i, 1); continue; }
          const a = Math.sin(Math.PI * p), r = s.r * (0.6 + 0.6 * a);
          g.strokeStyle = `rgba(245,252,255,${0.9 * a})`; g.lineWidth = 5; g.beginPath();
          for (let j = 0; j < 6; j++) { const q = s.rot + j / 6 * TAU; g.moveTo(s.x, s.y); g.lineTo(s.x + Math.cos(q) * r, s.y + Math.sin(q) * r); }
          g.stroke();
          const gr = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 0.7);
          gr.addColorStop(0, `rgba(255,255,255,${0.8 * a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.beginPath(); g.arc(s.x, s.y, r * 0.7, 0, TAU); g.fill();
        }
      });
      break;
    }

    case 'wind': {
      // 风痕从左往右扫过屏幕；原生卷云纹理快速掠过（比别的天气快很多）；原有云层漂移加大
      fx.nodeMod = () => ({ dxMul: 3, speedMul: 3 });
      sweepingClouds(25, 'cloud_cirrus_far.png', 4, [260, 420], 0.42, [150, 2600]);
      const c = canvas(62);
      const S = Array.from({ length: 34 }, () => ({ dead: true }));
      const spawn = (s, first) => Object.assign(s, { dead: false, x: first ? R(view.x0 - 800, view.x1) : view.x0 - R(100, 1400), y: R(view.y0 + 100, view.y1 - 100), v: R(1600, 2600), l: R(400, 1000), c: R(-0.14, 0.1), w: R(5, 11), a: R(0.25, 0.55) });
      let first = true;
      fx.frames.push((t, dt) => {
        c.begin(); const g = c.g; g.lineCap = 'round';
        for (const s of S) {
          if (s.dead) spawn(s, first);
          s.x += s.v * dt;
          if (s.x - s.l > view.x1) { s.dead = true; continue; }
          const gr = g.createLinearGradient(s.x - s.l, s.y, s.x, s.y);
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, `rgba(255,255,255,${s.a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.strokeStyle = gr; g.lineWidth = s.w;
          g.beginPath(); g.moveTo(s.x - s.l, s.y); g.quadraticCurveTo(s.x - s.l / 2, s.y + s.l * s.c, s.x, s.y + s.l * s.c * 0.3); g.stroke();
        }
        first = false;
      });
      break;
    }

    case 'dust': {
      // 远处地平线一堵黄沙墙：缓慢推进再退、体积起伏；再加一层随风斜飘的琥珀色颗粒
      tex('dust_volume_mid.png').then(src => {
        const walls = [];
        for (let i = 0; i < 2; i++) {
          const im = src.cloneNode(); sprites.push(im);
          Object.assign(im.style, { position: 'absolute', left: (-900 + i * 700) + 'px', top: (1700 + i * 260) + 'px', width: '3200px', height: '2133px', opacity: 0.6, willChange: 'transform,opacity', transform: i ? 'scaleX(-1)' : '' });
          const holder = layer(47, div({ inset: '0' })); holder.appendChild(im); walls.push({ im, i });
        }
        fx.frames.push(t => {
          for (const w of walls) {
            const p = Math.sin(t / (34 + w.i * 9) * TAU + w.i * 2);
            w.im.style.transform = `translate3d(${(Math.sin(t / 47 * TAU + w.i) * 120).toFixed(1)}px,${(-140 * (0.5 + 0.5 * p)).toFixed(1)}px,0) scale(${(1 + 0.06 * (0.5 + 0.5 * p)).toFixed(3)})${w.i ? ' scaleX(-1)' : ''}`;
            w.im.style.opacity = (0.45 + 0.3 * (0.5 + 0.5 * Math.sin(t / 13 * TAU + w.i * 1.7))).toFixed(3);
          }
        });
      }).catch(() => {});
      const c = canvas(68);
      const P = Array.from({ length: 150 }, () => ({ x: R(0, CW), y: R(0, CH), r: R(5, 14), v: R(300, 600), ph: R(0, TAU), c: (Math.random() * 3) | 0 }));
      const cols = ['214,150,80', '236,192,122', '176,108,52'];
      fx.frames.push((t, dt) => {
        c.begin(); const g = c.g;
        for (let kk = 0; kk < 3; kk++) {
          g.fillStyle = `rgba(${cols[kk]},0.55)`; g.beginPath();
          for (const p of P) {
            if (p.c !== kk) continue;
            p.x += (p.v + Math.sin(t * 1.3 + p.ph) * 60) * dt; p.y += (p.v * 0.32 + Math.cos(t + p.ph) * 30) * dt;
            if (p.x > view.x1 + 20 || p.y > view.y1 + 20) { if (Math.random() < 0.5) { p.x = view.x0 - 20; p.y = R(view.y0, view.y1); } else { p.x = R(view.x0, view.x1); p.y = view.y0 - 20; } }
            g.moveTo(p.x + p.r, p.y); g.arc(p.x, p.y, p.r, 0, TAU);
          }
          g.fill();
        }
      });
      break;
    }

    case 'heat': {
      // 底部约三分之一真的在折射：把下面各层在这一带重画一遍，再按行左右错开（越往下越强、波纹往上走），
      // 等于一个只作用于底部的位移滤镜，但比全屏 SVG 滤镜便宜得多。太阳光晕呼吸；地面热气上升。
      fx.ownHeat = true;
      fx.motion = z => (z === 10 ? { type: 'breathe', periodSeconds: 5.5, minOpacity: 0.6 } : null);
      const band = canvas(79), off = document.createElement('canvas'), og = off.getContext('2d');
      const c = canvas(80);
      const wisps = heatWisps(c, 14, 900, 0.06);
      fx.frames.push(t => {
        const vh = view.y1 - view.y0, top = view.y1 - vh * 0.36, bh = view.y1 - top;
        const w = Math.ceil(CW * k), h = Math.ceil(bh * k);
        if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
        og.setTransform(k, 0, 0, k, 0, -top * k); og.clearRect(0, -1e5, CW, 2e5);
        for (const d of ctx.layersBelow(79)) {
          if (d.node) {
            const pl = d.node.el ? d.pl : null; if (!pl) continue;
            og.save(); og.globalAlpha = +d.node.el.style.opacity || d.node.op;
            og.translate(d.node.tx + pl.x + pl.width / 2, d.node.ty + pl.y + pl.height / 2);
            og.rotate((pl.rotationDegrees || 0) * Math.PI / 180); if (pl.mirror) og.scale(-1, 1);
            og.drawImage(d.img, -pl.width / 2, -pl.height / 2, pl.width, pl.height); og.restore();
          } else {
            const o = d.el.style.opacity; og.globalAlpha = o === '' ? 1 : +o;
            og.drawImage(d.img, 0, 0, CW, CH); og.globalAlpha = 1;
          }
        }
        // 贴地的蜃气亮纹：画进待折射的那张里，一起被扭动，才看得出空气在晃
        og.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 9; i++) {
          const life = (t * 0.07 + i / 9) % 1, y = view.y1 - life * bh * 0.9, a = Math.sin(Math.PI * life) * 0.11;
          const gr = og.createLinearGradient(0, y - 22, 0, y + 22);
          gr.addColorStop(0, 'rgba(255,240,210,0)'); gr.addColorStop(0.5, `rgba(255,240,210,${a.toFixed(3)})`); gr.addColorStop(1, 'rgba(255,240,210,0)');
          og.fillStyle = gr; og.fillRect(view.x0, y - 22, view.x1 - view.x0, 44);
        }
        og.globalCompositeOperation = 'source-over';
        const g = band.g; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, band.cv.width, band.cv.height);
        const step = 3, y0 = Math.round(top * k);
        for (let y = 0; y < h; y += step) {
          const yd = top + y / k, depth = smooth((yd - top) / bh * 1.4);
          const A = 22 * depth;
          const dx = A * (0.6 * Math.sin(yd * 0.045 + t * 4.2) + 0.4 * Math.sin(yd * 0.011 + t * 1.6));
          g.drawImage(off, 0, y, w, step, dx * k, y0 + y, w, step);
        }
        c.begin(); wisps(t);
      });
      break;
    }

    case 'cyclone': {
      // 环形雨幕绕风眼转（越近越快），风眼中央安静：雨层在眼周围挖空
      const eye = [910, 430];
      fx.eye = eye;
      fx.particleAfter = g => {
        g.save(); g.globalCompositeOperation = 'destination-out';
        const gr = g.createRadialGradient(eye[0], eye[1], 0, eye[0], eye[1], 330);
        gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.6, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(eye[0] - 330, eye[1] - 330, 660, 660); g.restore();
      };
      const c = canvas(68);
      const P = Array.from({ length: 260 }, () => ({ r: R(260, 2600), th: R(0, TAU), k: R(0.8, 1.2), w: R(1.5, 3.5), a: R(0.25, 0.6) }));
      fx.frames.push((t, dt) => {
        c.begin(); const g = c.g; g.lineCap = 'round';
        for (let b = 0; b < 2; b++) {
          g.strokeStyle = `rgba(235,242,252,${b ? 0.42 : 0.26})`; g.lineWidth = b ? 6 : 3.5; g.beginPath();
          for (const p of P) {
            if ((p.w > 2.5) !== !!b) continue;
            const om = 0.55 * p.k * Math.pow(600 / p.r, 0.6); p.th -= om * dt; p.r -= 18 * dt; if (p.r < 260) p.r = R(2000, 2600); p.om = om;
            const arc = Math.min(0.6, (160 + 260 * (p.k - 0.8)) / p.r);
            g.moveTo(eye[0] + Math.cos(p.th) * p.r, eye[1] + Math.sin(p.th) * p.r);
            g.arc(eye[0], eye[1], p.r, p.th, p.th + arc);
          }
          g.stroke();
        }
        const gr = g.createRadialGradient(eye[0], eye[1], 0, eye[0], eye[1], 240);   // 风眼里一点透亮
        gr.addColorStop(0, `rgba(240,248,255,${0.16 + 0.06 * Math.sin(t / 6 * TAU)})`); gr.addColorStop(1, 'rgba(240,248,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(eye[0], eye[1], 240, 0, TAU); g.fill();
      });
      fx.nodeMod = (n, t) => (n.m.type === 'drift' ? { dxMul: 2.5, speedMul: 2 } : null);
      break;
    }
  }
  return fx;
}
