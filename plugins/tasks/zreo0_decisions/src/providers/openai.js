import { decisionAnswer, isRecord } from "../contract.js";

/**
 * Prepare a request for OpenAI or Vercel's compatible endpoint
 * @param {object} request Public Decisions request
 * @param {object} ctx Selected channel context
 * @returns {{ body: object }} Upstream request fields
 */
export function prepareOpenAI(request, ctx) {
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

/**
 * Validate compatible upstream answers before returning them to the client
 * @param {object} body Upstream JSON response
 * @param {object[]} questions Original public questions
 * @returns {object[]} Answers in their original order
 */
export function readOpenAIAnswers(body, questions) {
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
