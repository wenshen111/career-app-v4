# 挣钱路线图 · v4 网页版留档

这是闻神的职业养成 App 的 **v4 网页版**。它现在仍然能用；长期会由 GPT 主导开发的新 App 接替，这个仓库只做两件事：**备份**和**小补丁**。

## 打开

发布链接：**https://wenshen111.github.io/career-app-v4/**

手机上用 Chrome 打开 → 右上角 ⋮ → 「添加到主屏幕」，之后就像一个 App 一样从桌面点开。

## 数据存在哪

- 所有记录存在**这台设备的浏览器**里（开了自动同步时，另有一份在你的私有仓库）（localStorage：`wsr4-state`、`wsr4-hist`、`wsr4-ledger`、`wsr4-model`、`wsr4-feed`）。
- 仓库里**没有**任何个人数据，也没有任何密钥。
- 换设备、换浏览器、清浏览器数据之前，先在 App 顶部点「备份」→「导出备份」，得到 `wsr4-backup-YYYYMMDD.json`；到新设备上「导入备份」即可。

## 目录

| 路径 | 内容 |
| --- | --- |
| `web/` | App 本体：`index.html`、`app.js`、`data.js`（路线、项目、加成数字）、`map.json`（地图） |
| `.github/workflows/pages.yml` | 把 `web/` 发布到 GitHub Pages |
| `.github/workflows/pages-smoke.yml` + `tests/smoke.mjs` | 冒烟测试：起静态服务器，用 Playwright 点导出、导入、「完成了」对话 |

## v4.1 加了什么

- 顶部「备份」：导出 / 导入备份文件。导入前列出会被覆盖的每一项（现在 → 备份里），要连点两次才写入。
- 「说一句」里只说「完成了」也行：App 先问是哪一个，再问做到哪一步，最后给常用操作：划到完成、等结果、不考虑、回头再说。按钮和打字都能回答。这是本机规则，不是 Claude 或 GPT 在回答。
- 今日页多了「等结果 · 回头再说」一栏，情报站多了「等结果」分栏，随时能拉回。
- 修炼项目只能「等结果」或「回头再说」，不能「不考虑」：那会改成功率，而这个仓库不改算法。

本地跑测试：`npm i --no-save playwright && npx playwright install chromium && node tests/smoke.mjs && node tests/sync.mjs`

## v4.2 自动同步（换设备数据也在）

数据存进**你自己的私有仓库** `wenshen111/career-app-data` 里的 `wsr4.json`，每台设备设置一次：

1. 在 GitHub 新建仓库 `career-app-data`，选 **Private**。
2. 建一个只能碰这个仓库的令牌：GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token。Repository access 选 *Only select repositories* → `career-app-data`；Permissions → Repository permissions → **Contents: Read and write**；其他都不给。
3. App 顶部「备份」→「自动同步」，粘贴令牌，点「连接」。

- 令牌只存在那台设备的浏览器里（`wsr4-sync`），不进备份文件，不进同步文件，不进这个公开仓库。
- 打开 App、切回前台时先拉云端；本机改动 2–3 秒后自动传上去。
- 两台设备都改过时，后改的算数，另一份留在本机 `wsr4-sync-conflict`，不会凭空消失。
- 第一次连接时如果本机和云端都有数据，会让你选用哪一份。
- 填的仓库如果是公开的，App 会拒绝连接。
- 在 claude.ai 里打开时由 Claude 的云端同步，这里不用设置。

## 改动规则

- 不改成功率算法，不改 `data.js` 里的数字。
- 纯浏览器 API，不加任何依赖。
- 每次补丁把右上角版本号加一位小版本（v4.1、v4.2…）。

## 天气背景 demo（独立页，不影响 App）

打开：**https://wenshen111.github.io/career-app-v4/weather-demo.html**（`?s=snow` 这样可以直接看某一种）

- `web/weather/v3/`：GPT 的 v3 分层素材，原 PNG 不压不缩。每种天气一个目录（`01_sunny` … `16_cyclone`），里面是 L00–L90 各层 PNG 和 `layer_config.json`；`textures/` 是云、雾、沙尘、气旋的原生纹理；`weather_manifest.json` 是总清单。
- `web/weather/weather.mjs`：定位 + Open-Meteo（免费、不要 key）→ 16 种状态；`applyWeather(容器, 状态)` 只加载这一种天气的图层，按 `layer_config.json` 叠加并按各层 motion 参数动。UI 放在同一个容器里、`z-index ≥ 1` 就盖在天气上面。
- `web/weather/fx.mjs`：每种天气的签名动效（流星、分形闪电、涟漪、溅水、积雪、冰雹弹跳、冰晶闪、风痕、沙墙、底部热折射、环形雨等），叠在 v3 图层之间，同一套 1440×3120 坐标。
- 定位被拒/失败 → 按本地时间用晴日或晴夜；接口挂了 → 用上次结果（只存在本机 `wsr4-weather`，位置只留两位小数）。
- 测试：`node tests/weather.mjs`
