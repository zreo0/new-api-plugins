# New API Plugins

New API 第三方插件集合，可作为自定义市场源添加到网关。 [New API](https://github.com/QuantumNous/new-api)

## 插件

| 插件 | Key | 功能 | 使用文档 |
| --- | --- | --- | --- |
| Decisions | `zreo0_decisions` | 通过 OpenAI 兼容的 `POST /v1/decisions` 调用 Vercel AI Gateway、Gemini、OpenAI、TypeSafe 和 Microsoft Foundry | [渠道配置、计费和 AI SDK 示例](plugins/tasks/zreo0_decisions/README.zh-CN.md) |

## 安装

需要支持插件的 New API 实例，已在 `v1.0.0-rc.51` 验证。

1. 用 Root 账号打开「插件」并开启总开关。
2. 进入「插件市场 → 下载站点菜单 → 管理源 → 添加源」，填写市场名称和以下地址。

    ```text
    https://raw.githubusercontent.com/zreo0/new-api-plugins/main/index.json
    ```

3. 切换到新添加的市场源，选择插件和版本，点击「安装并启用」。

也可以下载版本目录中的 `plugin.js`，在「插件」页面手动上传。 [New API 安装文档](https://docs.newapi.pro/zh/docs/plugins/installation)

## 开发与发布

插件位于 `plugins/tasks/<key>/`，key 使用 `<github-login>_<name>`。每个插件提供 `build` 命令并将单文件 ES 模块输出到 `dist/plugin.js`，同时提供 `README.md` 和 `CHANGELOG.md`。更新时将 `package.json`、`meta.version` 和发布日志的版本保持一致。

在仓库根目录运行发布脚本和测试，发布其他插件时替换命令中的 key。

```bash
bun run release zreo0_decisions
bun run test
```

发布脚本将产物和文档写入 `plugins/tasks/<key>/<version>/`，生成包含 SHA-256 的市场索引。每次发布使用新版本目录，历史版本可用于回退。 [New API 发布规范](https://docs.newapi.pro/zh/docs/plugins/publishing)
