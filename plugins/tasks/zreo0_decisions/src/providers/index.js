import { isRecord, OPENAI_OPTIONS } from "../contract.js";
import { geminiUsage, prepareGemini } from "./gemini.js";
import { readNamedAnswers } from "./named-decisions.js";
import { prepareOpenAI, readOpenAIAnswers } from "./openai.js";
import { prepareSystemOne } from "./system-one.js";

/* OpenAI-compatible routes share the same body, answer shape and bearer headers */
const openAICompatible = {
    path: "/v1/decisions",
    keyHeader: "Authorization",
    prepare: prepareOpenAI,
    readAnswers: readOpenAIAnswers,
};

/* Channel enum entries also define the upstream request and response adapters */
export const providers = {
    vercel: { ...openAICompatible, title: "Vercel AI Gateway" },
    openai: { ...openAICompatible, title: "OpenAI" },
    gemini: {
        title: "Gemini",
        path: "/v1beta/decisions",
        keyHeader: "x-goog-api-key",
        prepare: prepareGemini,
        readAnswers: readNativeAnswers,
        readUsage: geminiUsage,
    },
    typesafe: {
        title: "TypeSafe",
        path: "/v1/systemone",
        keyHeader: "Authorization",
        prepare: prepareSystemOne,
        readAnswers: readNativeAnswers,
    },
    foundry: {
        title: "Microsoft Foundry",
        path: "/providers/microsoft/v1/systemone",
        keyHeader: "api-key",
        prepare: prepareSystemOne,
        readAnswers: readNativeAnswers,
    },
};

/**
 * Read the common answers property of a native provider
 * @param {object} body Provider JSON response
 * @param {object[]} questions Original public questions
 * @returns {object[]} OpenAI-compatible answers
 */
function readNativeAnswers(body, questions) {
    return readNamedAnswers(body.answers, questions);
}

/**
 * Look up the provider from the selected channel
 * @param {object} ctx New API driver context
 * @returns {object} Provider adapter
 */
export function channelProvider(ctx) {
    const key = ctx.config?.provider;
    if (!Object.prototype.hasOwnProperty.call(providers, key)) {
        throw new Error("Select an upstream provider in this channel's plugin settings");
    }
    return providers[key];
}

/**
 * Build an authenticated upstream descriptor for New API
 * @param {object} ctx Selected channel context
 * @param {object} request Validated public request
 * @returns {object} Host HTTP request descriptor
 */
export function providerRequest(ctx, request) {
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
            ...headers,
        },
        // The host owns model mapping. Only the upstream JSON body receives the resolved ID
        body: { ...body, model: ctx.upstreamModel || ctx.model },
    };
}

/**
 * Join a configured base URL with the provider's fixed Decisions endpoint
 * @param {string} baseURL Channel-supplied base URL
 * @param {string} path Provider endpoint path
 * @returns {string} Full upstream URL
 */
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

/**
 * Decode the selected provider's response without losing native token counts
 * @param {object} ctx Selected channel context
 * @param {object} body Parsed upstream response body
 * @param {object[]} questions Public questions
 * @returns {{ answers: object[], usage: object }} Decision results and token counters
 */
export function providerResponse(ctx, body, questions) {
    if (!isRecord(body)) {
        throw new Error("The upstream did not return a JSON decision");
    }
    const provider = channelProvider(ctx);
    return {
        answers: provider.readAnswers(body, questions),
        usage: provider.readUsage ? provider.readUsage(body.usage) : body.usage,
    };
}
