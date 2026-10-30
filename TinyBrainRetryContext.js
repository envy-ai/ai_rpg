const { isDeepStrictEqual } = require('node:util');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function retainedMessageMap(declarations) {
    const retained = new Map();
    for (const declaration of declarations) {
        if (!declaration || typeof declaration.key !== 'string' || !declaration.key.trim()
            || !declaration.message || !['user', 'assistant'].includes(declaration.message.role)
            || declaration.message.tool_calls !== undefined) {
            throw new Error('TinyBrain retained messages require a non-empty key and a user/assistant message without tool calls.');
        }
        retained.delete(declaration.key);
        retained.set(declaration.key, clone(declaration));
    }
    return retained;
}

function validateRetainedMessages(previousMessages, hookMessages, declarations = []) {
    const retained = [...retainedMessageMap(declarations).values()].map(declaration => declaration.message);
    const previousUsers = previousMessages.filter(message => message.role === 'user').map(clone);
    for (const message of hookMessages.filter(message => message.role === 'user')) {
        const index = previousUsers.findIndex(previous => isDeepStrictEqual(previous, message));
        if (index >= 0) {
            previousUsers.splice(index, 1);
        } else if (!retained.some(value => isDeepStrictEqual(value, message))) {
            throw new Error('TinyBrain afterParse added a user message without an explicit retainedMessages declaration.');
        }
    }
    return declarations.map(clone);
}

function validateTinyBrainRetainedMessages(...args) {
    try { return validateRetainedMessages(...args); }
    catch (error) {
        error.fatalTinyBrainExecution = true;
        throw error;
    }
}

function buildAcceptedTinyBrainSectionMessages({ originalMessages, attempts, retainedMessages = [], acceptedResponse, acceptedAttemptIndex }) {
    try {
        if (!Array.isArray(originalMessages) || !Array.isArray(attempts) || typeof acceptedResponse !== 'string'
            || !Number.isInteger(acceptedAttemptIndex) || acceptedAttemptIndex < 0 || acceptedAttemptIndex >= attempts.length) {
            throw new TypeError('TinyBrain accepted context requires original messages, owned attempt transcripts, accepted response and accepted completion index.');
        }
        const output = originalMessages.map(clone);
        const retainedCalls = [];
        const usedIds = new Set(originalMessages.flatMap(message => [
            ...(message.tool_calls || []).map(call => call.id),
            ...(message.tool_call_id ? [message.tool_call_id] : [])
        ]));
        const retained = [...retainedMessageMap(retainedMessages).values()];
        for (const declaration of retained) {
            if (!Number.isInteger(declaration.attemptIndex) || declaration.attemptIndex < 0 || declaration.attemptIndex >= attempts.length) {
                throw new Error('TinyBrain retained message is missing its section-owned attempt position.');
            }
        }
        for (const [attemptIndex, attempt] of attempts.entries()) {
            const { inputMessages, messages, toolInvocations } = attempt;
            if (!Array.isArray(inputMessages) || !Array.isArray(messages) || !Array.isArray(toolInvocations)
                || originalMessages.some((message, index) => !isDeepStrictEqual(message, messages[index]))
                || inputMessages.some((message, index) => !isDeepStrictEqual(message, messages[index]))) {
                throw new Error('TinyBrain section receipt transcript changed its owned input or original section instruction.');
            }
            const pendingInvocations = toolInvocations.map(clone);
            const suffix = messages.slice(inputMessages.length);
            const notes = retained.filter(declaration => declaration.attemptIndex === attemptIndex);
            const emittedNotes = new Set();
            for (let index = 0; index < suffix.length; index += 1) {
                const message = suffix[index];
                for (const declaration of notes) {
                    if (!emittedNotes.has(declaration.key) && isDeepStrictEqual(declaration.message, message)) {
                        output.push(clone(declaration.message));
                        emittedNotes.add(declaration.key);
                    }
                }
                if (message.role === 'tool') throw new Error(`TinyBrain tool result "${message.tool_call_id}" has no matching assistant call.`);
                if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
                const results = [];
                while (suffix[index + 1]?.role === 'tool') results.push(suffix[++index]);
                if (results.some(result => !message.tool_calls.some(call => call.id === result.tool_call_id))) {
                    throw new Error('TinyBrain tool result does not match its assistant call bundle.');
                }
                const calls = [];
                const keptResults = [];
                for (const call of message.tool_calls) {
                    if (typeof call.id !== 'string' || !call.id) throw new Error('TinyBrain tool receipts require a non-empty call id.');
                    const invocationIndex = pendingInvocations.findIndex(invocation => invocation.id === call.id && invocation.name === call.function?.name);
                    if (invocationIndex < 0) throw new Error(`TinyBrain tool receipt "${call.id}" has no invocation record.`);
                    const invocation = pendingInvocations.splice(invocationIndex, 1)[0];
                    // Failed arguments may be malformed JSON: execution provenance
                    // excludes them before any argument parsing occurs.
                    if (invocation.metadata?.error === true) continue;
                    let argumentsObject;
                    try { argumentsObject = JSON.parse(call.function.arguments); }
                    catch (cause) { throw new Error(`TinyBrain successful tool call "${call.id}" has malformed JSON arguments.`, { cause }); }
                    if (invocation.argumentsObject !== undefined && !isDeepStrictEqual(invocation.argumentsObject, argumentsObject)) {
                        throw new Error(`TinyBrain successful tool call "${call.id}" arguments disagree with its execution receipt.`);
                    }
                    const matching = results.filter(result => result.tool_call_id === call.id);
                    if (matching.length !== 1) throw new Error(`TinyBrain successful tool call "${call.id}" requires exactly one matching result.`);
                    if (matching[0].name && matching[0].name !== call.function.name) {
                        throw new Error(`TinyBrain successful tool call "${call.id}" result names a different function.`);
                    }
                    if (retainedCalls.some(previous => previous.id === call.id && previous.name === call.function.name
                        && isDeepStrictEqual(previous.argumentsObject, argumentsObject))) continue;
                    retainedCalls.push({ id: call.id, name: call.function.name, argumentsObject });
                    let contextId = call.id;
                    for (let sequence = 1; usedIds.has(contextId); sequence += 1) contextId = `${call.id}_tinybrain_${sequence}`;
                    usedIds.add(contextId);
                    calls.push({ ...clone(call), id: contextId });
                    keptResults.push({ ...clone(matching[0]), tool_call_id: contextId });
                }
                if (calls.length) output.push({ role: 'assistant', content: '', tool_calls: calls }, ...keptResults);
            }
            if (emittedNotes.size !== notes.length) throw new Error('TinyBrain retained message was not appended by its declared producer.');
            if (attemptIndex === acceptedAttemptIndex) output.push({ role: 'assistant', content: acceptedResponse });
        }
        return output;
    } catch (error) {
        error.fatalTinyBrainExecution = true;
        throw error;
    }
}

module.exports = { buildAcceptedTinyBrainSectionMessages, validateTinyBrainRetainedMessages };
