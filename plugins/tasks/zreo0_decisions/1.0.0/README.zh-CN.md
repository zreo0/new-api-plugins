---
locale: zh-CN
---
# Decisions

一个插件对外提供 `POST /v1/decisions`。多个渠道可以绑定同一个插件，各自连接 Vercel AI Gateway、Gemini、OpenAI、TypeSafe 或 Microsoft Foundry。

## 在 New API 安装

1. 用 Root 账号打开插件功能，从市场安装 Decisions，也可以手动上传发布版本里的 `plugin.js`。插件 key 为 `zreo0_decisions`。已在 New API `v1.0.0-rc.51` 验证。
2. 每接入一种上游，就新建一条渠道，选择 Decisions，再在「插件设置」里选择「上游服务」。配置对应 Base URL、上游 API Key、模型和分组。
3. 给渠道模型配置费用用量表达式，并创建有对应分组和模型访问权限的 New API 令牌。业务客户端使用这个令牌。

| 上游服务 | 渠道 Base URL | 渠道模型示例 | 渠道凭证 |
| --- | --- | --- | --- |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh` | `liquid/d1.2-ultra` 等 | AI Gateway API Key |
| Gemini | `https://generativelanguage.googleapis.com` | `gemini-decision-1` | Gemini API Key |
| OpenAI | `https://api.openai.com` | `gpt-6-luna` | OpenAI API Key |
| TypeSafe | `https://api.typesafe.ai` | `jev-1.14.0`、`jev-latest` 等 | TypeSafe API Key |
| Microsoft Foundry | Foundry 资源地址，例如 `https://your-resource.services.ai.azure.com` | Foundry 的**实际部署名** | Foundry API Key |

渠道模型默认直接使用上游 ID，`model_mapping` 留空。需要别名时，把别名放进渠道模型列表，再配置 New API 的「模型映射」。插件用宿主传入的 `ctx.upstreamModel` 构造上游请求。支持的真实 ID 列在源码目录的 `models.json`。

## 用量与计费

在 New API 的模型计费配置中选择任务用量表达式。`input_tokens` 和 `output_tokens` 使用实际收到的上游计数。以下是一个仅按输入计费的示例，`0.05` 代表你配置的每百万输入 Token 售价。

```text
tier("base", u("input_tokens") * 0.05 / 1000000)
```

渠道「预扣输入 Token」默认是 65,536。New API 按此数量预扣，成功后按实际用量补扣或退回差额。按业务输入规模调整预扣值，通过使用日志核对结算。

## 调用示例

先用一条真实渠道和 New API 令牌验证端点。

```bash
curl https://gateway.example.com/v1/decisions \
    -H "Authorization: Bearer $NEW_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"gemini-decision-1","input":"Checkout is down.","questions":[{"type":"predicate","name":"urgent","instructions":"Does this need immediate escalation?"}]}'
```

AI SDK 示例使用 `ai@7.0.177` 和 `@ai-sdk/openai@4.0.121`。设置 `NEW_API_BASE_URL` 为包含 `/v1` 的地址，设置 `NEW_API_KEY` 为 New API 令牌。

```ts
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_decide } from "ai";

const newApi = createOpenAI({
    baseURL: process.env.NEW_API_BASE_URL,
    apiKey: process.env.NEW_API_KEY,
});

const { answers } = await experimental_decide({
    model: newApi.decisionModel("gemini-decision-1"),
    state: "Checkout is down.",
    questions: {
        urgent: { type: "boolean", instructions: "Does this need immediate escalation?" },
    },
});

console.log(answers.urgent.probability);
```

HTTP 和 AI SDK 都支持布尔判断、单选和评分。兼容入口支持文本、结构化 JSON 和模型可用时的内联图片。转换成 Gemini 或 System One 格式时，图片使用 Base64 data URL。Vercel 的模型回退等 `providerOptions`、音视频和厂商专有题型不属于这个入口的契约。OpenAI 的提示缓存参数用于 OpenAI 直连渠道。

## 扩展与构建

- Vercel 清单来自其公开模型目录中标为 `decision` 或 `evaluation` 的条目。上游新增 ID 时，更新 `models.json`，再上传新版本。
- Foundry 部署名由管理员指定。如果名称不在清单中，将真实部署名加到 `foundry` 数组。New API 会校验插件声明的模型，渠道列表和渠道映射再决定客户端可用的名称。
- 新增上游时，在 `src/providers/` 中实现或复用协议转换，再加入该目录 `index.js` 的提供商清单。渠道表单会从同一清单生成选项。
- 发布修改时更新 `package.json` 和 `CHANGELOG.md` 的版本，再到仓库根目录运行 `bun run release zreo0_decisions`。脚本会生成新版产物并更新市场索引。

在插件目录运行以下命令。构建用 Bun，测试由 Node.js 执行。

```bash
bun run build
bun run test
new-api plugin lint dist/plugin.js
```

[Task Plugin 说明](https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.51/docs/plugin-api/v1.md) · [Vercel Decisions API](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-decisions) · [AI SDK Decisions](https://ai-sdk.dev/providers/ai-sdk-providers/openai#decision-models)
