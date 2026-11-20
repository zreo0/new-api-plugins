import assert from "node:assert/strict";
import test from "node:test";
import {
    buildSubmitRequest,
    extractUsage,
    extractUsageOnComplete,
    meta,
    native,
    parseSubmitResponse,
} from "../dist/plugin.js";

/* One mixed request exercises all three public question types through each adapter */
const questions = [
    { type: "predicate", name: "urgent", instructions: "Is checkout unavailable?" },
    {
        type: "choice",
        name: "queue",
        choices: [{ value: "billing" }, { value: "engineering", description: "Service failures" }],
    },
    { type: "score", name: "severity", levels: [{ label: "Low" }, { label: "High" }] },
];

/* Independently shaped provider responses with the same expected decisions */
const namedAnswers = {
    q1: { type: "choice", choice: "engineering", confidence: 0.8, probabilities: { billing: 0.2, engineering: 0.8 } },
    q2: { type: "score", score: 0.7, confidence: 0.7, probabilities: { 0: 0.3, 1: 0.7 } },
    q0: { type: "noul", noul: 0.9 },
};

const publicAnswers = [
    { type: "predicate", name: "urgent", probability: 0.9 },
    {
        type: "choice",
        name: "queue",
        choice: "engineering",
        confidence: 0.8,
        probabilities: [{ value: "billing", probability: 0.2 }, { value: "engineering", probability: 0.8 }],
    },
    {
        type: "score",
        name: "severity",
        score: 0.7,
        confidence: 0.7,
        probabilities: [{ value: 0, label: "Low", probability: 0.3 }, { value: 1, label: "High", probability: 0.7 }],
    },
];

/* Each matrix entry pins the vendor model, endpoint, header and response shape */
const channels = [
    ["vercel", "https://ai-gateway.vercel.sh", "liquid/d1.2-ultra", "/v1/decisions", "Authorization", publicAnswers],
    ["openai", "https://api.openai.com/v1", "gpt-6-luna", "/decisions", "Authorization", publicAnswers],
    ["gemini", "https://generativelanguage.googleapis.com", "gemini-decision-1", "/v1beta/decisions", "x-goog-api-key", namedAnswers],
    ["typesafe", "https://api.typesafe.ai", "jev-1.14.0", "/v1/systemone", "Authorization", namedAnswers],
    ["foundry", "https://example.services.ai.azure.com", "microsoft-decision-1.1", "/providers/microsoft/v1/systemone", "api-key", namedAnswers],
];

for (const [provider, baseUrl, model, path, header, answers] of channels) {
    test(`${provider} builds an authenticated request and settles the reported usage`, () => {
        const input = [{ role: "user", content: [{ type: "input_text", text: "Checkout is down" }] }];
        const intent = native.decodeDecision({ body: { kind: "json", value: { model, input, questions } } });
        const ctx = {
            model: intent.model,
            upstreamModel: model,
            config: { provider },
            baseUrl,
            apiKey: "upstream-test-key",
            publicTaskId: "task_sample",
            requestBody: intent.requestBody,
        };
        const outbound = buildSubmitRequest(ctx);
        assert.ok(meta.models.includes(model));
        assert.equal(outbound.url, baseUrl + path);
        assert.equal(outbound.method, "POST");
        assert.equal(outbound.headers[header], header === "Authorization" ? "Bearer upstream-test-key" : "upstream-test-key");
        assert.equal(outbound.body.model, model);
        assert.equal(outbound.model, undefined);
        if (provider === "gemini") {
            assert.deepEqual(outbound.body.input, [{ type: "text", text: "Checkout is down" }]);
        } else if (Array.isArray(answers)) {
            assert.deepEqual(outbound.body.input, input);
            assert.deepEqual(outbound.body.questions, questions.map((question) => ({ instructions: "", ...question })));
        } else {
            assert.equal(outbound.body.state, "Checkout is down");
        }
        if (!Array.isArray(answers)) {
            assert.equal(outbound.body.questions.q0.type, "noul");
            assert.deepEqual(outbound.body.questions.q1.criteria, { billing: "billing", engineering: "Service failures" });
            assert.deepEqual(outbound.body.questions.q2.criteria, ["Low", "High"]);
        }

        const usage = provider === "gemini"
            ? { total_input_tokens: 42, output_tokens: 0 }
            : { input_tokens: 42, output_tokens: 5 };
        const call = parseSubmitResponse(ctx, { statusCode: 200, body: { model, answers, usage } });
        assert.equal(call.taskId, ctx.publicTaskId);
        assert.equal(call.immediate.status, "SUCCESS");
        assert.deepEqual(native.renderDecision({}, { data: call.taskData }), {
            model,
            answers: publicAnswers,
            usage: { input_tokens: 42, output_tokens: usage.output_tokens, total_tokens: 42 + usage.output_tokens },
        });
        assert.deepEqual(extractUsageOnComplete(ctx, call.immediate, call.taskData), {
            input_tokens: 42,
            output_tokens: usage.output_tokens,
        });
    });
}

test("uses the host's mapped deployment name and echoes the client's alias", () => {
    const model = "support-routing";
    const ctx = {
        model,
        upstreamModel: "production-deployment",
        config: { provider: "foundry", reserveInputTokens: 5000 },
        baseUrl: "https://example.services.ai.azure.com/providers/microsoft/v1/",
        apiKey: "foundry-test-key",
        publicTaskId: "task_foundry",
        requestBody: { model, input: "Checkout is down", questions: [questions[0]] },
    };
    const outbound = buildSubmitRequest(ctx);
    assert.equal(outbound.url, "https://example.services.ai.azure.com/providers/microsoft/v1/systemone");
    assert.equal(outbound.body.model, ctx.upstreamModel);
    assert.equal(outbound.model, undefined);
    assert.deepEqual(extractUsage(ctx), { input_tokens: 5000, output_tokens: 0 });
    const result = parseSubmitResponse(ctx, {
        body: { answers: { q0: namedAnswers.q0 }, usage: { input_tokens: 0, output_tokens: 0 } },
    });
    assert.equal(result.taskData.model, model);
    assert.deepEqual(extractUsageOnComplete(ctx, result.immediate, result.taskData), { input_tokens: 0, output_tokens: 0 });
});

test("keeps inline evidence, preserves an unnamed response and refuses unsupported remote images", () => {
    const image = { type: "input_image", image_url: "data:image/png;base64,AA==" };
    const ctx = {
        model: "jev-latest",
        config: { provider: "typesafe" },
        baseUrl: "https://api.typesafe.ai",
        apiKey: "typesafe-test-key",
        publicTaskId: "task_image",
        requestBody: {
            model: "jev-latest",
            input: [{ role: "user", content: [{ type: "input_text", text: "Inspect this image" }, image] }],
            questions: [{ type: "predicate", instructions: [{ type: "input_text", text: "Is the second image similar?" }, image] }],
        },
    };
    const outbound = buildSubmitRequest(ctx);
    assert.equal(outbound.headers["TypeSafe-Danger-Zone-Images"], "true");
    assert.match(outbound.body.state, /\[\[task_image-1\.png\]\]/);
    assert.match(outbound.body.questions.q0.instructions, /\[\[task_image-2\.png\]\]/);
    assert.deepEqual(outbound.body.assets["[[task_image-1.png]]"], { type: "image", format: "png", data_base64: "AA==" });
    const response = parseSubmitResponse(ctx, { body: {
        answers: { q0: { type: "refusal" } },
        usage: { input_tokens: 1, output_tokens: 0 },
    } });
    assert.deepEqual(response.taskData.answers, [{ type: "refusal", name: null }]);
    const remote = { type: "input_image", image_url: "https://example.com/photo.png" };
    const requestBody = { ...ctx.requestBody, input: [{ role: "user", content: [remote] }] };
    assert.throws(() => buildSubmitRequest({ ...ctx, requestBody }), /Base64 data URL/);
});

test("rejects client routing overrides and fails on missing upstream usage", () => {
    const requestBody = { model: "gpt-6-luna", input: "Checkout is down", questions: [questions[0]] };
    assert.throws(() => native.decodeDecision({
        body: { kind: "json", value: { ...requestBody, providerOptions: { gateway: { models: ["other-model"] } } } },
    }), /Unsupported Decisions request field: providerOptions/);
    const ctx = { model: requestBody.model, config: { provider: "openai" }, requestBody, publicTaskId: "task_missing_usage" };
    assert.throws(() => parseSubmitResponse(ctx, { body: { answers: [publicAnswers[0]] } }), /missing valid token usage/);
    assert.throws(() => parseSubmitResponse(ctx, {
        body: { answers: [publicAnswers[0]], usage: { input_tokens: 42 } },
    }), /missing valid token usage/);
});
