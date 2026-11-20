import { inlineImage, inputParts, partText } from "../contract.js";
import { namedQuestions } from "./named-decisions.js";

/**
 * Encode an evidence or instruction part for the Gemini Decisions wire format
 * @param {object} part OpenAI decision input part
 * @returns {object} Gemini text or inline image part
 */
function geminiPart(part) {
    if (part?.type !== "input_image") {
        return { type: "text", text: partText(part) };
    }
    const { mimeType, data } = inlineImage(part);
    return { type: "image", data, mime_type: mimeType };
}

/**
 * Convert OpenAI question instructions to Gemini
 * @param {string | object[]} instructions Public instructions
 * @returns {string | object[]} Gemini instructions
 */
function geminiInstructions(instructions) {
    return typeof instructions === "string" ? instructions : instructions.map(geminiPart);
}

/**
 * Encode the native Gemini Decisions request
 * @param {object} request Public Decisions request
 * @returns {{ body: object }} Gemini payload
 */
export function prepareGemini(request) {
    return {
        body: {
            input: typeof request.input === "string" ? request.input : inputParts(request.input).map(geminiPart),
            questions: namedQuestions(request.questions, geminiInstructions),
        },
    };
}

/**
 * Map Gemini usage counters to the common token names
 * @param {object} usage Gemini usage counters
 * @returns {object} Usage with OpenAI token field names
 */
export function geminiUsage(usage) {
    return {
        input_tokens: usage?.total_input_tokens,
        output_tokens: usage?.output_tokens ?? 0,
        ...(Number.isSafeInteger(usage?.cached_input_tokens) && {
            input_tokens_details: { cached_tokens: usage.cached_input_tokens },
        }),
    };
}
