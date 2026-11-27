// 冒烟测试：起一个静态服务器，用 Playwright 打开 web/，检查 v4.1 的备份和「完成了」对话。
// 运行：node tests/smoke.mjs   （需要先装 playwright）
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(await fs.readFile(p)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const errors = [];
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  // 种一点数据，模拟用了一段时间的 App
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('wsr4-state', JSON.stringify({ checks: {}, cnt: { german: 3 }, days: {}, todos: [{ id: 't1', t: '给教授发邮件', done: false, d: '2026-11-20', due: null }] }));
    localStorage.setItem('wsr4-ledger', JSON.stringify({ entries: [{ id: 'e1', d: '2026-11-20', t: 'out', a: 12, c: '吃饭', n: '午饭' }] }));
  });
  await page.goto(url);

  // 1. 版本号和备份按钮
  assert.match((await page.textContent('#ver')).trim(), /^v4\.\d+$/);
  await page.click('#bk');
  await page.waitForSelector('#bkExport', { state: 'visible' });

  // 2. 点导出会下载 wsr4-backup-YYYYMMDD.json，里面有四份数据、没有多余的东西
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bkExport')]);
  assert.match(dl.suggestedFilename(), /^wsr4-backup-\d{8}\.json$/);
  const file = await dl.path();
  const backup = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(backup.app, 'wsr4');
  for (const k of ['wsr4-state', 'wsr4-hist', 'wsr4-ledger', 'wsr4-model']) assert.ok(k in backup.data, k + ' 应该在备份里');
  assert.equal(backup.data['wsr4-state'].todos[0].t, '给教授发邮件');
  assert.doesNotMatch(JSON.stringify(backup), /token|apikey|api_key|secret|photo|data:image/i);

  // 3. 导入：先预览，第一次点不写入，第二次点才覆盖
  backup.data['wsr4-ledger'].entries.push({ id: 'e2', d: '2026-11-21', t: 'in', a: 300, c: '兼职收入', n: '' });
  const edited = path.join(path.dirname(file), 'edited.json');
  await fs.writeFile(edited, JSON.stringify(backup));
  await page.setInputFiles('#bkFile', edited);
  await page.waitForSelector('#bkGo');
  assert.match(await page.textContent('#bkOut'), /1 笔[\s\S]*→ 2 笔/);
  await page.click('#bkGo');
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('wsr4-ledger'))).entries.length, 1, '第一次点不应该写入');
  await Promise.all([page.waitForEvent('load'), page.click('#bkGo')]);
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('wsr4-ledger'))).entries.length, 2, '第二次点后应该写入');

  // 4. 说「完成了」→ 选哪一个 → 完成度 → 等结果
  await page.click('#fab');
  await page.fill('#capIn', '完成了');
  await page.click('#capF button.pri');
  await page.click('[data-chat=pick][data-v="todo:t1"]');
  await page.click('[data-chat=deg][data-v=wait]');
  await page.click('[data-chat=act][data-v=wait]');
  const st = JSON.parse(await page.evaluate(() => localStorage.getItem('wsr4-state')));
  assert.equal(st.todos.find(t => t.id === 't1').st, 'wait');
  await page.click('[data-chat=bye]');
  await page.waitForSelector('text=等结果 · 回头再说');

  // 5. 「德语那个做了一部分」→ 直接对上德语 → 涂 2 格
  await page.click('#fab');
  await page.fill('#capIn', '德语那个完成了');
  await page.click('#capF button.pri');
  await page.click('[data-chat=pick][data-v="item:german"]');
  await page.click('[data-chat=deg][data-v=part]');
  await page.click('[data-chat=sq][data-v="2"]');
  assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('wsr4-state'))).cnt.german, 5);

  assert.deepEqual(errors, [], '页面不应该有报错');
  console.log('smoke ok');
} catch (e) {
  failed = true; console.error(e); if (errors.length) console.error('page errors:', errors);
} finally {
  await browser.close(); server.close();
}
process.exit(failed ? 1 : 0);
