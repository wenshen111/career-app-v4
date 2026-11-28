// 天气 demo 测试：映射规则 + 16 种都能挂上 + 定位/接口失败时的降级。
// 运行：node tests/weather.mjs   （需要先装 playwright）
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web');
const { mapWeather, STATES } = await import(path.join(root, 'weather', 'weather.mjs'));

// 1. 映射
const M = (code, extra = {}) => mapWeather({ code, isDay: true, temp: 20, wind: 10, ...extra });
assert.equal(M(0), 'sunny');
assert.equal(M(0, { isDay: false }), 'night');
assert.equal(M(2), 'partly_cloudy');
assert.equal(M(2, { isDay: false }), 'night');
assert.equal(M(3), 'overcast');
assert.equal(M(45), 'fog');
assert.equal(M(53), 'drizzle');
assert.equal(M(65), 'downpour');
assert.equal(M(95), 'thunderstorm');
assert.equal(M(99), 'hail');
assert.equal(M(71), 'snow');
assert.equal(M(71, { wind: 45 }), 'blizzard');
assert.equal(M(75), 'blizzard');
assert.equal(M(67), 'freezing_rain');
assert.equal(M(1, { wind: 60 }), 'wind');
assert.equal(M(0, { dust: 300 }), 'dust');
assert.equal(M(0, { temp: 33 }), 'heat');
assert.equal(M(61, { temp: 33 }), 'drizzle', '下雨时不算酷热');
assert.equal(M(61, { wind: 90 }), 'cyclone');
assert.equal(M(12345), 'sunny', '不认识的代码当晴');
assert.equal(STATES.length, 16);
// v3 素材：每种都有 layer_config.json，里面引用的 PNG / 纹理都在
for (const s of STATES) {
  const dir = path.join(root, 'weather', 'v3', s.file);
  const cfg = JSON.parse(await fs.readFile(path.join(dir, 'layer_config.json'), 'utf8'));
  assert.equal(cfg.id, s.id);
  for (const l of cfg.layers) {
    if (l.pngFile) await fs.access(path.join(dir, l.pngFile));
    if (l.texture) await fs.access(path.join(root, 'weather', 'v3', 'textures', l.texture.split('/').pop()));
  }
}

// 2. 浏览器
const TYPES = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(await fs.readFile(p)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/weather-demo.html`;
const browser = await chromium.launch();
const errors = [];
let failed = false;
try {
  // 2a. 下拉 16 种都能挂上：底图加载、名字对、只留一层
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/open-meteo\.com/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  for (const s of STATES) {
    await page.selectOption('#pick', s.id);
    await page.waitForFunction(id => !!document.querySelector(`.wx-root.on[data-state="${id}"]`), s.id, { timeout: 60000 });
    // 所有图都真的解码了，且没有加载默认关闭的可读罩
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.wx-root img')].every(i => i.complete && i.naturalWidth > 0)));
    assert.ok(await page.evaluate(() => ![...document.querySelectorAll('.wx-root img')].some(i => /L90_/.test(i.src))));
    assert.equal((await page.textContent('#st')).trim(), s.name);
  }
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.wx-root').count(), 1, '旧场景应该被移除');
  // 粒子层真的在动：两个时刻的雨层像素不同
  await page.selectOption('#pick', 'downpour');
  await page.waitForFunction(() => !!document.querySelector('.wx-root.on[data-state="downpour"]'), null, { timeout: 60000 });
  const snap = t => page.evaluate(t => { const h = document.getElementById('sky').__wx; h.seek(t); return document.querySelector('.wx-root[data-state="downpour"] canvas').toDataURL(); }, t);
  assert.notEqual(await snap(0.5), await snap(1.5));
  await ctx.close();

  // 2b. 定位成功 + 接口返回暴雨 → 显示暴雨、温度、风速，并写缓存
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 44.49, longitude: 11.34 }, permissions: ['geolocation'] });
  let fail = false;
  await ctx2.route(/api\.open-meteo\.com/, r => fail ? r.abort() : r.fulfill({ json: { current: { time: '2026-11-28T10:00', weather_code: 65, is_day: 1, temperature_2m: 9.4, wind_speed_10m: 22 } } }));
  await ctx2.route(/air-quality-api\.open-meteo\.com/, r => r.fulfill({ json: { current: { dust: 3 } } }));
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errors.push(String(e)));
  await p2.goto(url);
  await p2.click('#loc');
  await p2.waitForFunction(() => document.getElementById('st').textContent === '暴雨' && /实时/.test(document.getElementById('src').textContent), null, { timeout: 60000 });
  assert.match(await p2.textContent('#meta'), /9 °C · 风 22 km\/h/);
  assert.match(await p2.textContent('#src'), /实时/);
  const cache = JSON.parse(await p2.evaluate(() => localStorage.getItem('wsr4-weather')));
  assert.equal(cache.state, 'downpour');
  // 接口挂了 → 用上次结果
  fail = true;
  await p2.click('#refresh');
  await p2.waitForFunction(() => /上次结果/.test(document.getElementById('src').textContent), null, { timeout: 60000 });
  assert.equal((await p2.textContent('#st')).trim(), '暴雨');
  await ctx2.close();

  // 2c. 不给定位 → 默认（晴日/晴夜），写「用默认天气」
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => errors.push(String(e)));
  await p3.addInitScript(() => { navigator.geolocation.getCurrentPosition = (ok, err) => setTimeout(() => err({ code: 1, message: 'denied' }), 10); });
  await p3.goto(url);
  await p3.click('#loc');
  await p3.waitForFunction(() => /用默认天气 · 定位被拒绝/.test(document.getElementById('src').textContent), null, { timeout: 60000 });
  assert.match((await p3.textContent('#st')).trim(), /^晴(日|夜)$/);
  await ctx3.close();

  assert.deepEqual(errors, []);
  console.log('weather ok');
} catch (e) { failed = true; console.error(e); console.error('page errors:', errors); }
finally { await browser.close(); server.close(); }
if (failed) process.exit(1);
