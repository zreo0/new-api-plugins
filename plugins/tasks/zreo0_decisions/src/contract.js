/* Common Decisions request options that can be forwarded to a compatible API */
export const OPENAI_OPTIONS = ["safety_identifier", "prompt_cache_key", "prompt_cache_options"];

/**
 * Check whether a JSON value is an object with named properties
 * @param {unknown} value JSON value to check
 * @returns {boolean} Whether it is an object
 */
export function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate and prepare the public Decisions request
 * @param {unknown} body Decoded JSON request
 * @returns {object} Request with normalized questions
 */
export function parseRequest(body) {
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

/**
 * Validate a predicate, choice or score question
 * @param {unknown} question Public question
 * @param {number} index Zero-based question position
 * @returns {object} Question with the documented wire fields
 */
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
    const common = { type, instructions, ...(name != null && { name }) };
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

/**
 * Validate ordered score levels or typed choice options
 * @param {unknown} options Public list of levels or choices
 * @param {string} key Identity field used by each item
 * @param {number} limit Maximum list size
 * @param {string} field Question path for validation errors
 * @returns {object[]} Options in their original order
 */
function parseOptions(options, key, limit, field) {
    const list = key === "value" ? "choices" : "levels";
    if (!Array.isArray(options) || options.length < 2 || options.length > limit) {
        throw new Error(`${field}.${list} must contain between 2 and ${limit} items`);
    }
    return options.map((option) => {
        const value = option?.[key];
        const validValue = typeof value === "string" || (key === "value" && typeof value === "boolean");
        if (!isRecord(option) || !validValue || (option.description != null && typeof option.description !== "string")) {
            throw new Error(`${field}.${list} contains an invalid option`);
        }
        return { [key]: value, ...(option.description != null && { description: option.description }) };
    });
}

/**
 * Flatten OpenAI messages for APIs that take a shared state
 * @param {string | object[]} input OpenAI decision input
 * @returns {object[]} Ordered input parts
 */
export function inputParts(input) {
    if (typeof input === "string") {
        return [{ type: "input_text", text: input }];
    }
    const singleUserMessage = input.length === 1 && input[0]?.role === "user";
    return input.flatMap((message) => {
        if (!isRecord(message) || !["user", "assistant", "system", "developer"].includes(message.role)
            || (message.type != null && message.type !== "message")) {
            throw new Error("This upstream accepts message input items only");
        }
        const { content } = message;
        if (typeof content !== "string" && !Array.isArray(content)) {
            throw new Error("Input message content must be text or an array of parts");
        }
        const parts = typeof content === "string" ? [{ type: "input_text", text: content }] : content;
        // Keep role boundaries when the input contains a conversation
        return singleUserMessage ? parts : [{ type: "input_text", text: `[${message.role}]` }, ...parts];
    });
}

/**
 * Render a textual input part for a translated API
 * @param {object} part OpenAI input or output part
 * @returns {string} Text evidence
 */
export function partText(part) {
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

/**
 * Extract MIME type and bytes from an inline OpenAI image
 * @param {object} part OpenAI image input part
 * @returns {{ mimeType: string, data: string }} Base64 image for the upstream adapter
 */
export function inlineImage(part) {
    const parsed = typeof part.image_url === "string"
        && /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(part.image_url);
    if (!parsed) {
        throw new Error("This upstream requires input_image to use a Base64 data URL");
    }
    return { mimeType: parsed[1].toLowerCase(), data: parsed[2] };
}

/**
 * Normalize provider usage to the OpenAI Decisions token fields
 * @param {object} usage Provider usage with input_tokens already mapped
 * @returns {object} Validated token counts for the client and New API
 */
export function tokenUsage(usage) {
    const input = usage?.input_tokens;
    const output = usage?.output_tokens;
    if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0) {
        throw new Error("The upstream response is missing valid token usage");
    }
    return {
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
        ...(isRecord(usage.input_tokens_details) && { input_tokens_details: usage.input_tokens_details }),
        ...(isRecord(usage.output_tokens_details) && { output_tokens_details: usage.output_tokens_details }),
    };
}

/**
 * Validate an answer and give it the original public question name
 * @param {object} answer OpenAI-shaped answer from an upstream adapter
 * @param {object} question Corresponding public question
 * @returns {object} Answer in the public Decisions format
 */
export function decisionAnswer(answer, question) {
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
    const validResult = type === "choice"
        ? question.choices.some(({ value }) => value === choice)
        : Number.isFinite(score) && score >= 0 && score <= question.levels.length - 1;
    if (!validResult || !Array.isArray(probabilities)) {
        throw new Error("The upstream returned an invalid choice or score answer");
    }
    const seen = new Set();
    for (const entry of probabilities) {
        const validValue = type === "choice"
            ? question.choices.some(({ value }) => value === entry?.value)
            : Number.isInteger(entry?.value) && entry.value >= 0 && entry.value < question.levels.length;
        if (!validValue || seen.has(entry.value)) {
            throw new Error("The upstream returned invalid probability values");
        }
        seen.add(entry.value);
        checkProbability(entry.probability);
    }
    return {
        type,
        name,
        ...(type === "choice" ? { choice } : { score }),
        ...(confidence != null && { confidence: checkProbability(confidence) }),
        probabilities,
    };
}

/**
 * Enforce the numeric range of a provider probability
 * @param {unknown} probability Probability or confidence from the upstream
 * @returns {number} Validated probability
 */
function checkProbability(probability) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error("The upstream returned a probability outside [0, 1]");
    }
    return probability;
}
