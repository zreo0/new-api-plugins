---
translations:
  zh-CN: README.zh-CN.md
---
# Decisions

Serve OpenAI-compatible decisions from Vercel AI Gateway, Gemini, OpenAI, TypeSafe, and Microsoft Foundry through one New API endpoint.

## Channel setup

Install Decisions from the marketplace or upload the version's `plugin.js` in the New API Plugins page. The plugin key is `zreo0_decisions`. It was tested on New API `v1.0.0-rc.51`. For each upstream, create a Plugin channel, bind Decisions, choose the upstream provider in Plugin Settings, and enter that channel's Base URL and API key.

| Provider | Base URL | Example upstream ID |
| --- | --- | --- |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh` | `liquid/d1.2-ultra` |
| Gemini | `https://generativelanguage.googleapis.com` | `gemini-decision-1` |
| OpenAI | `https://api.openai.com` | `gpt-6-luna` |
| TypeSafe | `https://api.typesafe.ai` | `jev-1.14.0` |
| Microsoft Foundry | Your Foundry resource endpoint | Actual deployment name |

Use upstream IDs in the channel model list. Add any custom Foundry deployment names and any additional Vercel IDs to `models.json` before building and uploading the plugin. To publish a different client model name, add it to the channel's model list and configure New API's Model Mapping.

## Billing

Configure a task usage expression for each enabled model in New API. The plugin reports `input_tokens` and `output_tokens` from upstream usage. The channel's Input token reservation controls the upfront hold, which New API reconciles with actual usage on success.

## Example

```bash
curl https://gateway.example.com/v1/decisions \
    -H "Authorization: Bearer $NEW_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"gemini-decision-1","input":"Checkout is down.","questions":[{"type":"predicate","name":"urgent","instructions":"Does this need immediate escalation?"}]}'
```

## Supported requests

The public contract covers `predicate`, `choice`, and `score` with text and structured JSON evidence. Supported vision models can accept inline images. Provider-specific questions, Gateway routing options, and non-image media are outside this interface. The [Chinese guide](README.zh-CN.md) includes AI SDK configuration and build instructions.
