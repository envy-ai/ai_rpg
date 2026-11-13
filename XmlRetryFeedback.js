'use strict';

const { extractXmlRootBlock } = require('./XmlResponse.js');
const { ResponseValidationError } = require('./ResponseValidation.js');

const DONE_INSTRUCTION = 'Close every open XML tag, including the root, then write DONE on its own line after the closing root tag.';
const LITERAL_XML_TAG_INSTRUCTION = "In XML responses, escape tag-like text that is not part of the answer's XML structure (for example, write &lt;quests&gt; for a literal quests tag or &lt;item&gt; for a literal item tag). The quests tag is only an example: escape each literal tag with its own original name and content; never rename other tags to quests. Keep the actual required answer elements as unescaped XML tags.";
const REPEATED_RESPONSE_INSTRUCTION = '"Insanity is doing the same thing over and over again and expecting different results."';

function expectedRootsFromErrorMessage(message) {
    const description = message.match(/\bExpected one complete (.+?) XML root block\./i)?.[1];
    if (!description) return null;
    const pairs = [...description.matchAll(/<([A-Za-z_][A-Za-z0-9_.:-]*)>\.\.\.<\/([A-Za-z_][A-Za-z0-9_.:-]*)>/g)];
    if (!pairs.length || pairs.some(([, opening, closing]) => opening.toLowerCase() !== closing.toLowerCase())
        || pairs.map(([full]) => full).join(' or ') !== description) return null;
    return pairs.map(([, opening]) => opening);
}

function isUnclosedXmlResponse({ error, response, expectedRootTags = null } = {}) {
    if (typeof response !== 'string' || !response.trim()) return false;

    const visited = new Set();
    let current = error;
    let hasUnclosedXmlError = false;
    let diagnosticExpectedRoots = null;
    while (current && !visited.has(current)) {
        visited.add(current);
        const message = typeof current.message === 'string' ? current.message : '';
        if (/\bunclosed xml tag\(s\):/i.test(message)) hasUnclosedXmlError = true;
        const roots = expectedRootsFromErrorMessage(message);
        if (roots) {
            hasUnclosedXmlError = true;
            diagnosticExpectedRoots = roots;
        }
        current = current.cause;
    }
    if (!hasUnclosedXmlError) return false;

    const options = {
        expectedRootTags: expectedRootTags ?? diagnosticExpectedRoots,
        selectFinal: true,
        ignoreInlineCode: true
    };
    const selected = extractXmlRootBlock(response, options);
    return Boolean(selected) && !extractXmlRootBlock(response, { ...options, requireComplete: true });
}

function withUnclosedXmlDoneInstruction(instruction, details) {
    if (typeof instruction !== 'string' || !instruction.trim()) {
        throw new TypeError('XML retry feedback requires a non-empty instruction.');
    }
    if (!isUnclosedXmlResponse(details) || instruction.includes(DONE_INSTRUCTION)) return instruction;
    return `${instruction}\n${DONE_INSTRUCTION}`;
}

function withResponseRetryFeedback(instruction, details = {}) {
    let feedback = withUnclosedXmlDoneInstruction(instruction, details);
    const visited = new Set();
    for (let error = details.error; error && !visited.has(error); error = error.cause) {
        visited.add(error);
        if (!(error instanceof ResponseValidationError)) continue;
        const problems = `Problems to correct:\n${error.message}`;
        if (feedback.includes(problems)) break;
        feedback = feedback.includes(error.message)
            ? feedback.replace(error.message, problems)
            : `${feedback}\n${problems}`;
        break;
    }
    if (!feedback.includes(LITERAL_XML_TAG_INSTRUCTION)) {
        feedback = `${feedback}\n${LITERAL_XML_TAG_INSTRUCTION}`;
    }
    if (typeof details.response !== 'string' || details.response !== details.previousFailedResponse
        || feedback.includes(REPEATED_RESPONSE_INSTRUCTION)) return feedback;
    return `${feedback}\n${REPEATED_RESPONSE_INSTRUCTION}`;
}

module.exports = { DONE_INSTRUCTION, LITERAL_XML_TAG_INSTRUCTION, REPEATED_RESPONSE_INSTRUCTION, isUnclosedXmlResponse, withUnclosedXmlDoneInstruction, withResponseRetryFeedback };
