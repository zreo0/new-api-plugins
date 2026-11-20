import { inlineImage, inputParts, partText } from "../contract.js";
import { namedQuestions } from "./named-decisions.js";

/**
 * Encode a native System One request for TypeSafe or Microsoft Foundry
 * @param {object} request Public Decisions request
 * @param {object} ctx Selected channel and public task ID
 * @returns {{ body: object, headers: object }} System One payload and any image header
 */
export function prepareSystemOne(request, ctx) {
    const foundry = ctx.config.provider === "foundry";
    const assets = {};
    let imageCount = 0;

    /**
     * Put an inline image in assets and insert the vendor's image reference in text
     * @param {object} part OpenAI decision input part
     * @returns {string} Text or an image reference
     */
    function renderPart(part) {
        if (part?.type !== "input_image") {
            return partText(part);
        }
        const { mimeType, data } = inlineImage(part);
        const format = mimeType.slice("image/".length);
        const name = `${ctx.publicTaskId}-${++imageCount}.${format}`;
        // TypeSafe replaces the exact asset key, while Foundry looks for its image prefix
        const key = foundry ? name : `[[${name}]]`;
        assets[key] = { type: "image", format, data_base64: data };
        return foundry ? `image:${name}` : key;
    }

    /**
     * Convert question instructions to System One text
     * @param {string | object[]} instructions OpenAI question instructions
     * @returns {string} Vendor instructions with image references when present
     */
    function renderInstructions(instructions) {
        return typeof instructions === "string" ? instructions : instructions.map(renderPart).join("\n");
    }

    const parts = inputParts(request.input);
    const state = parts.length === 1 && parts[0]?.type === "input_json"
        ? parts[0].data
        : parts.map(renderPart).join("\n");
    const questions = namedQuestions(request.questions, renderInstructions);
    return {
        body: { state, questions, ...(imageCount > 0 && { assets }) },
        headers: imageCount > 0 && !foundry ? { "TypeSafe-Danger-Zone-Images": "true" } : {},
    };
}
