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

## 改动规则

- 不改成功率算法，不改 `data.js` 里的数字。
- 纯浏览器 API，不加任何依赖。
- 每次补丁把右上角版本号加一位小版本（v4.1、v4.2…）。
