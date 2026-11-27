// 自动同步测试：假的 GitHub API + 两台「设备」（两个独立浏览器上下文），不连真网络、不用真令牌。
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
  try { res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(await fs.readFile(p)); } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// 假 GitHub：一个私有仓库 me/data，一个公开仓库 me/pub
const repo = { file: null, sha: null, n: 0, puts: 0 };
async function fakeGitHub(route) {
  const req = route.request(), u = new URL(req.url()), auth = req.headers()['authorization'];
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  if (auth !== 'Bearer github_pat_TEST_TOKEN_0123456789') return json(401, { message: 'Bad credentials' });
  if (u.pathname === '/repos/me/data') return json(200, { private: true });
  if (u.pathname === '/repos/me/pub') return json(200, { private: false });
  if (u.pathname === '/repos/me/data/contents/wsr4.json') {
    if (req.method() === 'GET') return repo.file ? json(200, { sha: repo.sha, content: repo.file }) : json(404, { message: 'Not Found' });
    if (req.method() === 'PUT') {
      const b = JSON.parse(req.postData());
      if ((b.sha || null) !== repo.sha) return json(409, { message: 'sha mismatch' });
      repo.file = b.content; repo.sha = 'sha' + (++repo.n); repo.puts++;
      return json(200, { content: { sha: repo.sha } });
    }
  }
  return json(404, { message: 'Not Found' });
}
const remote = () => JSON.parse(Buffer.from(repo.file, 'base64').toString('utf8'));

const browser = await chromium.launch();
let failed = false;
const errors = [];
async function device(seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('https://api.github.com/**', fakeGitHub);
  if (seed) await ctx.addInitScript(s => { if (!localStorage.getItem('wsr4-ledger')) localStorage.setItem('wsr4-ledger', s); }, JSON.stringify(seed));
  const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); return page;
}
async function connect(page, repoName) {
  await page.click('#bk'); await page.waitForSelector('#syF');
  await page.fill('#syRepo', repoName); await page.fill('#syTok', 'github_pat_TEST_TOKEN_0123456789');
  await page.click('#syF button');
}
const ls = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
try {
  // A：有一笔账。先试公开仓库，应该被拒绝
  const A = await device({ entries: [{ id: 'e1', d: '2026-11-20', t: 'out', a: 12, c: '吃饭', n: '午饭' }] });
  await connect(A, 'me/pub');
  await A.waitForSelector('#syOut >> text=公开仓库');
  assert.equal(repo.puts, 0);
  await A.fill('#syRepo', 'me/data'); await A.click('#syF button');
  await A.waitForSelector('#syGo');
  assert.equal(remote().data['wsr4-ledger'].entries.length, 1, 'A 的账应该传上去');

  // B：新设备，什么都没有 → 直接用云端
  const B = await device(null);
  await connect(B, 'me/data');
  await B.waitForSelector('#syGo');
  assert.equal((await ls(B, 'wsr4-ledger')).entries.length, 1, 'B 应该拿到 A 的账');

  // B 加一个待办 → 自动传上去 → A 回到前台时拿到
  await B.keyboard.press('Escape'); await B.click('[data-open=todo]'); await B.fill('#todoIn', '给教授发邮件'); await B.click('#todoF button');
  await B.waitForFunction(() => !JSON.parse(localStorage.getItem('wsr4-sync')).dirty, null, { timeout: 10000 });
  assert.equal(remote().data['wsr4-state'].todos[0].t, '给教授发邮件');
  await A.click('#syGo');
  await A.waitForFunction(() => ((JSON.parse(localStorage.getItem('wsr4-state') || '{}').todos || [])).length === 1, null, { timeout: 10000 });

  // 令牌不能出现在导出的备份里
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#bkExport')]);
  const txt = await fs.readFile(await dl.path(), 'utf8');
  assert.doesNotMatch(txt, /github_pat_|TEST_TOKEN/);
  assert.doesNotMatch(Buffer.from(repo.file, 'base64').toString('utf8'), /github_pat_|TEST_TOKEN/, '令牌也不能进同步文件');

  // 第三台设备自己也有数据 → 要她选用哪一份
  const C = await device({ entries: [{ id: 'c1', d: '2026-11-25', t: 'in', a: 300, c: '兼职收入', n: '' }] });
  await connect(C, 'me/data');
  await C.waitForSelector('#syUseRemote');
  await C.click('#syUseLocal');
  await C.waitForSelector('#syGo');
  assert.equal(remote().data['wsr4-ledger'].entries[0].id, 'c1', '选了本机的就应该把本机的传上去');
  assert.equal((await ls(C, 'wsr4-sync-conflict')).data['wsr4-ledger'].entries[0].id, 'e1', '没选的那份要留底');

  assert.deepEqual(errors, [], '页面不应该有报错');
  console.log('sync ok');
} catch (e) { failed = true; console.error(e); if (errors.length) console.error('page errors:', errors); }
finally { await browser.close(); server.close(); }
process.exit(failed ? 1 : 0);
