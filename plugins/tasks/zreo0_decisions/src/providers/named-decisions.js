import { decisionAnswer, isRecord } from "../contract.js";

/**
 * Convert public questions to the named form shared by System One and Gemini
 * @param {object[]} questions Public questions in request order
 * @param {Function} renderInstructions Vendor instruction encoder
 * @returns {object} Native questions keyed by request position
 */
export function namedQuestions(questions, renderInstructions) {
    return Object.fromEntries(questions.map((question, index) => {
        const type = question.type === "predicate" ? "noul" : question.type;
        const instructions = renderInstructions(question.instructions);
        const native = { type, instructions };
        if (type === "choice") {
            const entries = question.choices.map(({ value, description }) => [
                String(value), description ?? String(value),
            ]);
            native.criteria = Object.fromEntries(entries);
            if (Object.keys(native.criteria).length !== entries.length) {
                throw new Error("This upstream requires choice values to have distinct text representations");
            }
        } else if (type === "score") {
            native.criteria = question.levels.map(({ label, description }) => (
                description ? `${label}: ${description}` : label
            ));
        }
        // Position keys work even when public question names are absent or contain vendor-specific characters
        return [`q${index}`, native];
    }));
}

/**
 * Convert named vendor answers back to the public array
 * @param {object} answers Named vendor answers
 * @param {object[]} questions Original public questions
 * @returns {object[]} OpenAI-compatible answers in question order
 */
export function readNamedAnswers(answers, questions) {
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
                probabilities: probabilities.map(([key, probability]) => ({ value: choices.get(key), probability })),
            }, question);
        }
        return decisionAnswer({
            type,
            confidence,
            score: answer.score,
            probabilities: probabilities.map(([key, probability]) => ({
                value: Number(key),
                label: question.levels[Number(key)]?.label,
                probability,
            })),
        }, question);
    });
}
