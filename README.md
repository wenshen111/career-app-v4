# 挣钱路线图 · v4 网页版留档

这是闻神的职业养成 App 的 **v4 网页版**。它现在仍然能用；长期会由 GPT 主导开发的新 App 接替，这个仓库只做两件事：**备份**和**小补丁**。

## 打开

发布链接：**https://wenshen111.github.io/career-app-v4/**

手机上用 Chrome 打开 → 右上角 ⋮ → 「添加到主屏幕」，之后就像一个 App 一样从桌面点开。

## 数据存在哪

- 所有记录只存在**这台设备的浏览器**里（localStorage：`wsr4-state`、`wsr4-hist`、`wsr4-ledger`、`wsr4-model`、`wsr4-feed`）。
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

本地跑测试：`npm i --no-save playwright && npx playwright install chromium && node tests/smoke.mjs`

## 改动规则

- 不改成功率算法，不改 `data.js` 里的数字。
- 纯浏览器 API，不加任何依赖。
- 每次补丁把右上角版本号加一位小版本（v4.1、v4.2…）。
