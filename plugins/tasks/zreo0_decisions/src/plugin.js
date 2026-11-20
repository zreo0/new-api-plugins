import catalog from "../models.json";
import { version } from "../package.json";
import { parseRequest, tokenUsage } from "./contract.js";
import { providerRequest, providerResponse, providers } from "./providers/index.js";

/* Default number of input tokens reserved before a request reaches the upstream */
const DEFAULT_RESERVATION = 65536;

/* New API loads this manifest from the bundled plugin.js */
export const meta = {
    apiVersion: 1,
    key: "zreo0_decisions",
    name: { en: "Decisions", zh: "决策模型" },
    version,
    author: { name: "zreo0", url: "https://github.com/zreo0" },
    description: {
        en: "Typed decisions from multiple upstreams through one OpenAI-compatible endpoint",
        zh: "通过 OpenAI 兼容接口调用多个上游的决策模型",
    },
    models: [...new Set(Object.values(catalog).flat())],
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
                enumTitles: Object.values(providers).map(({ title }) => ({ en: title })),
            },
            reserveInputTokens: {
                type: "integer",
                title: { en: "Input token reservation", zh: "预扣输入 Token" },
                description: {
                    en: "Input tokens reserved before sending the request. Settlement uses actual reported usage",
                    zh: "请求发出前用于预扣的输入 Token，最终按上游返回的实际用量结算",
                },
                minimum: 0,
                default: DEFAULT_RESERVATION,
            },
        },
    },
    routes: [{
        method: "POST",
        path: "/v1/decisions",
        type: "submit",
        decode: "decodeDecision",
        render: "renderDecision",
        retainResult: false,
    }],
    usageSchema: {
        input_tokens: {
            type: "number",
            unit: "token",
            description: { en: "Reported input tokens", zh: "上游报告的输入 Token" },
        },
        output_tokens: {
            type: "number",
            unit: "token",
            description: { en: "Reported output tokens", zh: "上游报告的输出 Token" },
        },
    },
    usageExamples: [{
        label: "Decision request",
        facts: { input_tokens: 1000, output_tokens: 12 },
    }],
};

/**
 * Hand the selected channel's authenticated request to New API
 * @param {object} ctx New API submission context
 * @returns {object} Upstream HTTP descriptor
 */
export function buildSubmitRequest(ctx) {
    return providerRequest(ctx, parseRequest(ctx.requestBody));
}

/**
 * Complete a successful vendor request within the current HTTP call
 * @param {object} ctx New API submission context
 * @param {{ statusCode: number, body: object }} response Upstream response accepted by the host
 * @returns {object} Terminal task and normalized Decisions response
 */
export function parseSubmitResponse(ctx, response) {
    const { questions } = parseRequest(ctx.requestBody);
    const { answers, usage } = providerResponse(ctx, response.body, questions);
    return {
        taskId: ctx.publicTaskId,
        immediate: { status: "SUCCESS", progress: "100%" },
        taskData: { model: ctx.model, answers, usage: tokenUsage(usage) },
    };
}

/**
 * Supply an upfront usage reservation for a task billing expression
 * @param {object} ctx New API submission context
 * @returns {object | null} Reservation facts or no legacy ratio overrides
 */
export function extractUsage(ctx) {
    if (ctx.usagePurpose === "billing_ratios") {
        return null;
    }
    return {
        input_tokens: ctx.config?.reserveInputTokens ?? DEFAULT_RESERVATION,
        output_tokens: 0,
    };
}

/**
 * Replace the reservation with the successful upstream's token counts
 * @param {object} _ctx New API completion context
 * @param {object} _result Terminal task result
 * @param {object} taskData Public decision response
 * @returns {object} Usage facts for settlement
 */
export function extractUsageOnComplete(_ctx, _result, taskData) {
    const { input_tokens, output_tokens } = tokenUsage(taskData?.usage);
    return { input_tokens, output_tokens };
}

/**
 * Reject polling for a synchronous-only Decisions endpoint
 * @returns {never} No query descriptor is produced
 */
export function buildQueryRequest() {
    throw new Error("Decisions complete synchronously and have no query endpoint");
}

/**
 * Implement the task host's required polling hook for a synchronous endpoint
 * @returns {{ status: string, reason: string }} Non-terminal status for unexpected polling
 */
export function parseTaskResult() {
    return { status: "UNKNOWN", reason: "Decisions complete synchronously" };
}

/* Native route hooks let New API expose the Decisions URL and return its public envelope */
export const native = {
    /**
     * Decode the public request and hand off its model for normal channel selection
     * @param {object} ctx New API native route context
     * @returns {object} Validated submit intent
     */
    decodeDecision(ctx) {
        if (ctx.body?.kind !== "json") {
            throw new Error("Decisions require an application/json body");
        }
        const request = parseRequest(ctx.body.value);
        return { kind: "submit", model: request.model, action: "decisions", requestBody: request };
    },

    /**
     * Return the complete decision to the caller
     * @param {object} _ctx New API presenter context
     * @param {object} task Completed task view
     * @returns {object} OpenAI-compatible decision
     */
    renderDecision(_ctx, task) {
        return task.data;
    },

    /**
     * Wrap host errors in an OpenAI-compatible body
     * @param {object} _ctx New API presenter context
     * @param {object} error Sanitized host error
     * @returns {object} Error envelope with the host's HTTP status
     */
    error(_ctx, error) {
        return {
            error: {
                message: error.message,
                type: "api_error",
                param: null,
                code: error.code ?? null,
            },
        };
    },
};
