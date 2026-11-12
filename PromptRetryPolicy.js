const PromptAuditLog = require('./PromptAuditLog.js');
const PromptFailureReporter = require('./PromptFailureReporter.js');
const { withResponseRetryFeedback } = require('./XmlRetryFeedback.js');

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

async function runPromptWithParseRetries(options = {}) {
    const { metadataLabel, stage = 'response', parser = null, logPath = null } = options;
    const run = () => PromptAuditLog.runPrompt({ metadataLabel, kind: 'parse_retry' }, () =>
        PromptAuditLog.runStage({ stage, parser }, () => {
            if (logPath) PromptAuditLog.addLogReference(logPath);
            return runPromptWithParseRetriesInternal(options);
        }));
    // Generic/unlabelled use has no real prompt identity to notify. Production
    // callers supply the completion label so inner attempts join this owner.
    return typeof metadataLabel === 'string' && metadataLabel.trim()
        ? await PromptFailureReporter.run({ metadataLabel, kind: 'parse_retry', signal: options.signal }, run)
        : await run();
}

async function runPromptWithParseRetriesInternal({
    metadataLabel,
    messages,
    maxAttempts,
    complete,
    parse,
    buildRetryInstruction,
    getCorrectableCompletionResponse = null,
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
    if (getCorrectableCompletionResponse !== null && typeof getCorrectableCompletionResponse !== 'function') {
        throw new TypeError('Prompt parse retry getCorrectableCompletionResponse must be a function when provided.');
    }

    let workingMessages = clonePromptMessages(messages);
    let lastParseError = null;
    let previousFailedResponse;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        PromptAuditLog.setAttempt(attempt);
        let response;
        let completionError = null;
        try {
            response = await complete({
                attempt,
                maxAttempts,
                messages: clonePromptMessages(workingMessages)
            });
        } catch (error) {
            if (PromptFailureReporter.isCancellation(error) || !getCorrectableCompletionResponse) throw error;
            response = getCorrectableCompletionResponse(error);
            if (response === null) throw error;
            if (typeof response !== 'string') {
                throw new TypeError('Correctable completion response must be a string or null.', { cause: error });
            }
            completionError = error;
        }
        if (typeof response !== 'string') {
            throw new TypeError('Prompt parse retry completion callback must return a string.');
        }

        let value = null;
        try {
            if (completionError) throw completionError;
            value = await parse(response, { attempt, maxAttempts });
        } catch (error) {
            if (PromptFailureReporter.isCancellation(error)) throw error;
            const phase = completionError ? 'completion' : 'validation';
            PromptAuditLog.recordFailure(error, { phase, attempt, source: completionError ? 'completion_guard_retry' : 'parse_retry' });
            lastParseError = error;
            if (onAttempt) {
                const logPath = await onAttempt({
                    attempt,
                    maxAttempts,
                    response,
                    error,
                    phase,
                    messages: clonePromptMessages(workingMessages),
                    accepted: false
                });
                if (typeof logPath === 'string') PromptAuditLog.addLogReference(logPath);
            }
            if (attempt >= maxAttempts) {
                break;
            }

            const rawRetryInstruction = buildRetryInstruction(error, {
                attempt,
                maxAttempts,
                response
            });
            if (typeof rawRetryInstruction !== 'string' || !rawRetryInstruction.trim()) {
                throw new TypeError('Prompt parse retry instruction must be a non-empty string.');
            }
            const retryInstruction = withResponseRetryFeedback(rawRetryInstruction, { error, response, previousFailedResponse });
            previousFailedResponse = response;
            if (metadataLabel) PromptFailureReporter.validationRetry(metadataLabel);
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
            const logPath = await onAttempt({
                attempt,
                maxAttempts,
                response,
                error: null,
                phase: 'validation',
                messages: clonePromptMessages(workingMessages),
                accepted: true
            });
            if (typeof logPath === 'string') PromptAuditLog.addLogReference(logPath);
        }
        PromptAuditLog.acceptStage();
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
