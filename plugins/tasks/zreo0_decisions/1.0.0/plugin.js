// models.json
var models_default = {
  vercel: [
    "baseten/elephant-1",
    "baseten/joey-1",
    "baseten/mammoth-1",
    "convaiinnovations/laya",
    "google/gemini-decision-1",
    "heygen/heygen-decision-1",
    "heygen/heygen-decision-1-turbo",
    "liquid/d1",
    "liquid/d1-ultra",
    "liquid/d1.2",
    "liquid/d1.2-ultra",
    "microsoft/decision-1.1",
    "microsoft/microsoft-decision-1",
    "nace-ai/drex-max-finance",
    "nace-ai/drex-max-v1.1",
    "nace-ai/drex-v2.0",
    "openai/gpt-6-luna-decisions",
    "parallel/parallel-decisions-fast",
    "perplexity/pplx-decider-flash-v1.2",
    "perplexity/pplx-decider-flash-v1.3",
    "perplexity/pplx-decider-v1.2",
    "perplexity/pplx-decider-v1.3",
    "scaledown/scaledown-classify-1",
    "typesafe-ai/jev",
    "typesafe-ai/jev-1.13.0",
    "typesafe-ai/jev-1.14.0"
  ],
  gemini: [
    "gemini-decision-1"
  ],
  openai: [
    "gpt-6-luna"
  ],
  typesafe: [
    "jev-1.13.0",
    "jev-1.14.0",
    "jev-latest",
    "jev-preview"
  ],
  foundry: [
    "microsoft-decision-1",
    "microsoft-decision-1.1"
  ]
};
// package.json
var version = "1.0.0";

// src/contract.js
var OPENAI_OPTIONS = ["safety_identifier", "prompt_cache_key", "prompt_cache_options"];
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseRequest(body) {
  if (!isRecord(body) || typeof body.model !== "string" || !body.model.trim()) {
    throw new Error("A non-empty model is required");
  }
  if (typeof body.input !== "string" && !Array.isArray(body.input)) {
    throw new Error("input must be a string or an array of OpenAI input items");
  }
  if (!Array.isArray(body.questions) || body.questions.length < 1 || body.questions.length > 400) {
    throw new Error("questions must contain between 1 and 400 items");
  }
  const options = {};
  for (const key of Object.keys(body)) {
    if (OPENAI_OPTIONS.includes(key)) {
      options[key] = body[key];
    } else if (!["model", "input", "questions"].includes(key)) {
      throw new Error(`Unsupported Decisions request field: ${key}`);
    }
  }
  const questions = body.questions.map(parseQuestion);
  const names = questions.map(({ name }) => name).filter((name) => name !== undefined);
  if (new Set(names).size !== names.length) {
    throw new Error("Question names must be unique");
  }
  return { model: body.model.trim(), input: body.input, questions, ...options };
}
function parseQuestion(question, index) {
  const field = `questions[${index}]`;
  if (!isRecord(question) || !["predicate", "choice", "score"].includes(question.type)) {
    throw new Error(`${field}.type must be predicate, choice or score`);
  }
  const { type, name } = question;
  const instructions = question.instructions ?? "";
  if (name != null && typeof name !== "string") {
    throw new Error(`${field}.name must be a string`);
  }
  if (typeof instructions !== "string" && !(Array.isArray(instructions) && instructions.length)) {
    throw new Error(`${field}.instructions must be text or an array of input parts`);
  }
  const common = { type, instructions, ...name != null && { name } };
  if (type === "predicate") {
    return common;
  }
  if (type === "choice") {
    const choices = parseOptions(question.choices, "value", 255, field);
    if (new Set(choices.map(({ value }) => value)).size !== choices.length) {
      throw new Error(`${field}.choices must have unique values`);
    }
    return { ...common, choices };
  }
  return { ...common, levels: parseOptions(question.levels, "label", 10, field) };
}
function parseOptions(options, key, limit, field) {
  const list = key === "value" ? "choices" : "levels";
  if (!Array.isArray(options) || options.length < 2 || options.length > limit) {
    throw new Error(`${field}.${list} must contain between 2 and ${limit} items`);
  }
  return options.map((option) => {
    const value = option?.[key];
    const validValue = typeof value === "string" || key === "value" && typeof value === "boolean";
    if (!isRecord(option) || !validValue || option.description != null && typeof option.description !== "string") {
      throw new Error(`${field}.${list} contains an invalid option`);
    }
    return { [key]: value, ...option.description != null && { description: option.description } };
  });
}
function inputParts(input) {
  if (typeof input === "string") {
    return [{ type: "input_text", text: input }];
  }
  const singleUserMessage = input.length === 1 && input[0]?.role === "user";
  return input.flatMap((message) => {
    if (!isRecord(message) || !["user", "assistant", "system", "developer"].includes(message.role) || message.type != null && message.type !== "message") {
      throw new Error("This upstream accepts message input items only");
    }
    const { content } = message;
    if (typeof content !== "string" && !Array.isArray(content)) {
      throw new Error("Input message content must be text or an array of parts");
    }
    const parts = typeof content === "string" ? [{ type: "input_text", text: content }] : content;
    return singleUserMessage ? parts : [{ type: "input_text", text: `[${message.role}]` }, ...parts];
  });
}
function partText(part) {
  if (["input_text", "output_text"].includes(part?.type) && typeof part.text === "string") {
    return part.text;
  }
  if (part?.type === "input_json" && (isRecord(part.data) || Array.isArray(part.data))) {
    return JSON.stringify(part.data);
  }
  if (part?.type === "refusal" && typeof part.refusal === "string") {
    return part.refusal;
  }
  throw new Error("This upstream supports text, JSON and inline image input parts");
}
function inlineImage(part) {
  const parsed = typeof part.image_url === "string" && /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(part.image_url);
  if (!parsed) {
    throw new Error("This upstream requires input_image to use a Base64 data URL");
  }
  return { mimeType: parsed[1].toLowerCase(), data: parsed[2] };
}
function tokenUsage(usage) {
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) {
    throw new Error("The upstream response is missing valid token usage");
  }
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    ...isRecord(usage.input_tokens_details) && { input_tokens_details: usage.input_tokens_details },
    ...isRecord(usage.output_tokens_details) && { output_tokens_details: usage.output_tokens_details }
  };
}
function decisionAnswer(answer, question) {
  const name = question.name ?? null;
  if (answer?.type === "refusal") {
    return { type: "refusal", name };
  }
  if (answer?.type !== question.type) {
    throw new Error("The upstream did not return a matching answer for every question");
  }
  const { type, probability, choice, score, confidence, probabilities = [] } = answer;
  if (type === "predicate") {
    return { type, name, probability: checkProbability(probability) };
  }
  const validResult = type === "choice" ? question.choices.some(({ value }) => value === choice) : Number.isFinite(score) && score >= 0 && score <= question.levels.length - 1;
  if (!validResult || !Array.isArray(probabilities)) {
    throw new Error("The upstream returned an invalid choice or score answer");
  }
  const seen = new Set;
  for (const entry of probabilities) {
    const validValue = type === "choice" ? question.choices.some(({ value }) => value === entry?.value) : Number.isInteger(entry?.value) && entry.value >= 0 && entry.value < question.levels.length;
    if (!validValue || seen.has(entry.value)) {
      throw new Error("The upstream returned invalid probability values");
    }
    seen.add(entry.value);
    checkProbability(entry.probability);
  }
  return {
    type,
    name,
    ...type === "choice" ? { choice } : { score },
    ...confidence != null && { confidence: checkProbability(confidence) },
    probabilities
  };
}
function checkProbability(probability) {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error("The upstream returned a probability outside [0, 1]");
  }
  return probability;
}

// src/providers/named-decisions.js
function namedQuestions(questions, renderInstructions) {
  return Object.fromEntries(questions.map((question, index) => {
    const type = question.type === "predicate" ? "noul" : question.type;
    const instructions = renderInstructions(question.instructions);
    const native = { type, instructions };
    if (type === "choice") {
      const entries = question.choices.map(({ value, description }) => [
        String(value),
        description ?? String(value)
      ]);
      native.criteria = Object.fromEntries(entries);
      if (Object.keys(native.criteria).length !== entries.length) {
        throw new Error("This upstream requires choice values to have distinct text representations");
      }
    } else if (type === "score") {
      native.criteria = question.levels.map(({ label, description }) => description ? `${label}: ${description}` : label);
    }
    return [`q${index}`, native];
  }));
}
function readNamedAnswers(answers, questions) {
  if (!isRecord(answers)) {
    throw new Error("The upstream response must contain named answers");
  }
  return questions.map((question, index) => {
    const answer = answers[`q${index}`];
    const { type, confidence } = answer ?? {};
    if (type === "noul") {
      return decisionAnswer({ type: "predicate", probability: answer.noul }, question);
    }
    if (type === "refusal") {
      return decisionAnswer(answer, question);
    }
    if (!["choice", "score"].includes(type) || type !== question.type || !isRecord(answer.probabilities)) {
      throw new Error("The upstream did not return a matching answer for every question");
    }
    const probabilities = Object.entries(answer.probabilities);
    if (type === "choice") {
      const choices = new Map(question.choices.map(({ value }) => [String(value), value]));
      return decisionAnswer({
        type,
        confidence,
        choice: choices.get(answer.choice),
        probabilities: probabilities.map(([key, probability]) => ({ value: choices.get(key), probability }))
      }, question);
    }
    return decisionAnswer({
      type,
      confidence,
      score: answer.score,
      probabilities: probabilities.map(([key, probability]) => ({
        value: Number(key),
        label: question.levels[Number(key)]?.label,
        probability
      }))
    }, question);
  });
}

// src/providers/gemini.js
function geminiPart(part) {
  if (part?.type !== "input_image") {
    return { type: "text", text: partText(part) };
  }
  const { mimeType, data } = inlineImage(part);
  return { type: "image", data, mime_type: mimeType };
}
function geminiInstructions(instructions) {
  return typeof instructions === "string" ? instructions : instructions.map(geminiPart);
}
function prepareGemini(request) {
  return {
    body: {
      input: typeof request.input === "string" ? request.input : inputParts(request.input).map(geminiPart),
      questions: namedQuestions(request.questions, geminiInstructions)
    }
  };
}
function geminiUsage(usage) {
  return {
    input_tokens: usage?.total_input_tokens,
    output_tokens: usage?.output_tokens ?? 0,
    ...Number.isSafeInteger(usage?.cached_input_tokens) && {
      input_tokens_details: { cached_tokens: usage.cached_input_tokens }
    }
  };
}

// src/providers/openai.js
function prepareOpenAI(request, ctx) {
  if (ctx.config.provider === "vercel") {
    if (request.prompt_cache_key != null || request.prompt_cache_options != null) {
      throw new Error("OpenAI prompt cache options are only supported on an OpenAI channel");
    }
    for (const question of request.questions) {
      const values = question.choices?.map(({ value }) => String(value));
      if (values && new Set(values).size !== values.length) {
        throw new Error("Vercel requires choice values to have distinct text representations");
      }
    }
  }
  return { body: request };
}
function readOpenAIAnswers(body, questions) {
  if (!Array.isArray(body.answers) || body.answers.length !== questions.length) {
    throw new Error("The upstream response must contain one answer per question");
  }
  return body.answers.map((answer, index) => {
    const question = questions[index];
    if (!isRecord(answer) || (answer.name ?? null) !== (question.name ?? null)) {
      throw new Error("The upstream returned an answer with a mismatched question name");
    }
    return decisionAnswer(answer, question);
  });
}

// src/providers/system-one.js
function prepareSystemOne(request, ctx) {
  const foundry = ctx.config.provider === "foundry";
  const assets = {};
  let imageCount = 0;
  function renderPart(part) {
    if (part?.type !== "input_image") {
      return partText(part);
    }
    const { mimeType, data } = inlineImage(part);
    const format = mimeType.slice("image/".length);
    const name = `${ctx.publicTaskId}-${++imageCount}.${format}`;
    const key = foundry ? name : `[[${name}]]`;
    assets[key] = { type: "image", format, data_base64: data };
    return foundry ? `image:${name}` : key;
  }
  function renderInstructions(instructions) {
    return typeof instructions === "string" ? instructions : instructions.map(renderPart).join(`
`);
  }
  const parts = inputParts(request.input);
  const state = parts.length === 1 && parts[0]?.type === "input_json" ? parts[0].data : parts.map(renderPart).join(`
`);
  const questions = namedQuestions(request.questions, renderInstructions);
  return {
    body: { state, questions, ...imageCount > 0 && { assets } },
    headers: imageCount > 0 && !foundry ? { "TypeSafe-Danger-Zone-Images": "true" } : {}
  };
}

// src/providers/index.js
var openAICompatible = {
  path: "/v1/decisions",
  keyHeader: "Authorization",
  prepare: prepareOpenAI,
  readAnswers: readOpenAIAnswers
};
var providers = {
  vercel: { ...openAICompatible, title: "Vercel AI Gateway" },
  openai: { ...openAICompatible, title: "OpenAI" },
  gemini: {
    title: "Gemini",
    path: "/v1beta/decisions",
    keyHeader: "x-goog-api-key",
    prepare: prepareGemini,
    readAnswers: readNativeAnswers,
    readUsage: geminiUsage
  },
  typesafe: {
    title: "TypeSafe",
    path: "/v1/systemone",
    keyHeader: "Authorization",
    prepare: prepareSystemOne,
    readAnswers: readNativeAnswers
  },
  foundry: {
    title: "Microsoft Foundry",
    path: "/providers/microsoft/v1/systemone",
    keyHeader: "api-key",
    prepare: prepareSystemOne,
    readAnswers: readNativeAnswers
  }
};
function readNativeAnswers(body, questions) {
  return readNamedAnswers(body.answers, questions);
}
function channelProvider(ctx) {
  const key = ctx.config?.provider;
  if (!Object.prototype.hasOwnProperty.call(providers, key)) {
    throw new Error("Select an upstream provider in this channel's plugin settings");
  }
  return providers[key];
}
function providerRequest(ctx, request) {
  const provider = channelProvider(ctx);
  if (provider.prepare !== prepareOpenAI && OPENAI_OPTIONS.some((key) => request[key] != null)) {
    throw new Error("This upstream does not support OpenAI request options");
  }
  const { body, headers = {} } = provider.prepare(request, ctx);
  if (typeof ctx.apiKey !== "string" || !ctx.apiKey.trim()) {
    throw new Error("Configure the upstream API key on this channel");
  }
  return {
    method: "POST",
    url: upstreamURL(ctx.baseUrl, provider.path),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [provider.keyHeader]: provider.keyHeader === "Authorization" ? `Bearer ${ctx.apiKey}` : ctx.apiKey,
      ...headers
    },
    body: { ...body, model: ctx.upstreamModel || ctx.model }
  };
}
function upstreamURL(baseURL, path) {
  if (typeof baseURL !== "string" || !/^https?:\/\/[^/?#]+/i.test(baseURL) || /[?#]/.test(baseURL)) {
    throw new Error("Configure a valid upstream Base URL on this channel");
  }
  const base = baseURL.replace(/\/+$/, "");
  const prefix = path.slice(0, path.lastIndexOf("/"));
  if (base.endsWith(path)) {
    return base;
  }
  return base.endsWith(prefix) ? base + path.slice(prefix.length) : base + path;
}
function providerResponse(ctx, body, questions) {
  if (!isRecord(body)) {
    throw new Error("The upstream did not return a JSON decision");
  }
  const provider = channelProvider(ctx);
  return {
    answers: provider.readAnswers(body, questions),
    usage: provider.readUsage ? provider.readUsage(body.usage) : body.usage
  };
}

// src/plugin.js
var DEFAULT_RESERVATION = 65536;
var meta = {
  apiVersion: 1,
  key: "zreo0_decisions",
  name: { en: "Decisions", zh: "决策模型" },
  version,
  author: { name: "zreo0", url: "https://github.com/zreo0" },
  description: {
    en: "Typed decisions from multiple upstreams through one OpenAI-compatible endpoint",
    zh: "通过 OpenAI 兼容接口调用多个上游的决策模型"
  },
  models: [...new Set(Object.values(models_default).flat())],
  fetchMode: "per_task",
  auth: "api_key",
  requiredCapabilities: ["json-order@1"],
  channelConfig: {
    type: "object",
    required: ["provider"],
    properties: {
      provider: {
        type: "string",
        title: { en: "Upstream provider", zh: "上游服务" },
        enum: Object.keys(providers),
        enumTitles: Object.values(providers).map(({ title }) => ({ en: title }))
      },
      reserveInputTokens: {
        type: "integer",
        title: { en: "Input token reservation", zh: "预扣输入 Token" },
        description: {
          en: "Input tokens reserved before sending the request. Settlement uses actual reported usage",
          zh: "请求发出前用于预扣的输入 Token，最终按上游返回的实际用量结算"
        },
        minimum: 0,
        default: DEFAULT_RESERVATION
      }
    }
  },
  routes: [{
    method: "POST",
    path: "/v1/decisions",
    type: "submit",
    decode: "decodeDecision",
    render: "renderDecision",
    retainResult: false
  }],
  usageSchema: {
    input_tokens: {
      type: "number",
      unit: "token",
      description: { en: "Reported input tokens", zh: "上游报告的输入 Token" }
    },
    output_tokens: {
      type: "number",
      unit: "token",
      description: { en: "Reported output tokens", zh: "上游报告的输出 Token" }
    }
  },
  usageExamples: [{
    label: "Decision request",
    facts: { input_tokens: 1000, output_tokens: 12 }
  }]
};
function buildSubmitRequest(ctx) {
  return providerRequest(ctx, parseRequest(ctx.requestBody));
}
function parseSubmitResponse(ctx, response) {
  const { questions } = parseRequest(ctx.requestBody);
  const { answers, usage } = providerResponse(ctx, response.body, questions);
  return {
    taskId: ctx.publicTaskId,
    immediate: { status: "SUCCESS", progress: "100%" },
    taskData: { model: ctx.model, answers, usage: tokenUsage(usage) }
  };
}
function extractUsage(ctx) {
  if (ctx.usagePurpose === "billing_ratios") {
    return null;
  }
  return {
    input_tokens: ctx.config?.reserveInputTokens ?? DEFAULT_RESERVATION,
    output_tokens: 0
  };
}
function extractUsageOnComplete(_ctx, _result, taskData) {
  const { input_tokens, output_tokens } = tokenUsage(taskData?.usage);
  return { input_tokens, output_tokens };
}
function buildQueryRequest() {
  throw new Error("Decisions complete synchronously and have no query endpoint");
}
function parseTaskResult() {
  return { status: "UNKNOWN", reason: "Decisions complete synchronously" };
}
var native = {
  decodeDecision(ctx) {
    if (ctx.body?.kind !== "json") {
      throw new Error("Decisions require an application/json body");
    }
    const request = parseRequest(ctx.body.value);
    return { kind: "submit", model: request.model, action: "decisions", requestBody: request };
  },
  renderDecision(_ctx, task) {
    return task.data;
  },
  error(_ctx, error) {
    return {
      error: {
        message: error.message,
        type: "api_error",
        param: null,
        code: error.code ?? null
      }
    };
  }
};
export {
  buildQueryRequest,
  buildSubmitRequest,
  extractUsage,
  extractUsageOnComplete,
  meta,
  native,
  parseSubmitResponse,
  parseTaskResult
};
