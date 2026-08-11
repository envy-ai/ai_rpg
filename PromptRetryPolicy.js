function resolveConfiguredPromptMaxAttempts(aiConfig, { fallbackMaxAttempts = 3 } = {}) {
    if (!Number.isInteger(fallbackMaxAttempts) || fallbackMaxAttempts <= 0) {
        throw new TypeError('Prompt retry fallbackMaxAttempts must be a positive integer.');
    }

    const configuredRetryAttempts = aiConfig?.retryAttempts;
    if (configuredRetryAttempts === undefined || configuredRetryAttempts === null) {
        return fallbackMaxAttempts;
    }

    const retryAttempts = Number(configuredRetryAttempts);
    if (!Number.isInteger(retryAttempts) || retryAttempts < 0) {
        throw new TypeError('ai.retryAttempts must be a non-negative integer.');
    }

    return retryAttempts + 1;
}

function clonePromptMessages(messages) {
    if (!Array.isArray(messages)) {
        throw new TypeError('Prompt parse retry messages must be an array.');
    }
    return messages.map(message => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            throw new TypeError('Prompt parse retry messages must contain message objects.');
        }
        return { ...message };
    });
}

async function runPromptWithParseRetries({
    messages,
    maxAttempts,
    complete,
    parse,
    buildRetryInstruction,
    retainRejectedResponse = true,
    onAttempt = null
} = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
        throw new TypeError('Prompt parse retry maxAttempts must be a positive integer.');
    }
    if (typeof complete !== 'function') {
        throw new TypeError('Prompt parse retry requires a completion callback.');
    }
    if (typeof parse !== 'function') {
        throw new TypeError('Prompt parse retry requires a parser callback.');
    }
    if (typeof buildRetryInstruction !== 'function') {
        throw new TypeError('Prompt parse retry requires a retry-instruction callback.');
    }
    if (typeof retainRejectedResponse !== 'boolean') {
        throw new TypeError('Prompt parse retry retainRejectedResponse must be a boolean.');
    }
    if (onAttempt !== null && typeof onAttempt !== 'function') {
        throw new TypeError('Prompt parse retry onAttempt must be a function when provided.');
    }

    let workingMessages = clonePromptMessages(messages);
    let lastParseError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await complete({
            attempt,
            maxAttempts,
            messages: clonePromptMessages(workingMessages)
        });
        if (typeof response !== 'string') {
            throw new TypeError('Prompt parse retry completion callback must return a string.');
        }

        let value = null;
        try {
            value = await parse(response, { attempt, maxAttempts });
        } catch (error) {
            lastParseError = error;
            if (onAttempt) {
                await onAttempt({
                    attempt,
                    maxAttempts,
                    response,
                    error,
                    accepted: false
                });
            }
            if (attempt >= maxAttempts) {
                break;
            }

            const retryInstruction = buildRetryInstruction(error, {
                attempt,
                maxAttempts,
                response
            });
            if (typeof retryInstruction !== 'string' || !retryInstruction.trim()) {
                throw new TypeError('Prompt parse retry instruction must be a non-empty string.');
            }
            if (retainRejectedResponse) {
                workingMessages.push(
                    { role: 'assistant', content: response },
                    { role: 'user', content: retryInstruction.trim() }
                );
            } else {
                workingMessages = clonePromptMessages(messages);
                workingMessages.push({ role: 'user', content: retryInstruction.trim() });
            }
            continue;
        }

        if (onAttempt) {
            await onAttempt({
                attempt,
                maxAttempts,
                response,
                error: null,
                accepted: true
            });
        }
        return {
            value,
            response,
            attempts: attempt,
            messages: clonePromptMessages(workingMessages)
        };
    }

    throw new Error(
        `Prompt response failed to parse after ${maxAttempts} attempt${maxAttempts === 1 ? '' : 's'}: `
        + `${lastParseError?.message || lastParseError}`,
        { cause: lastParseError }
    );
}

module.exports = {
    resolveConfiguredPromptMaxAttempts,
    runPromptWithParseRetries
};
