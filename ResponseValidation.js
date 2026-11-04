'use strict';

const MAX_VALIDATION_ISSUES = 10;

function validationIssues(error, seen = new Set()) {
    if (!error || seen.has(error)) return [];
    seen.add(error);
    if (error instanceof ResponseValidationError) return error.issues.flatMap(issue => validationIssues(issue, seen));
    // Existing validators sometimes add context with an ordinary Error cause.
    // Retain that context while counting its aggregate's actual leaf problems.
    const causes = new Set(seen);
    let nested = error.cause;
    while (nested && !causes.has(nested)) {
        if (nested instanceof ResponseValidationError) {
            return validationIssues(error.cause, seen).map(issue => {
                const message = error.message.includes(error.cause.message)
                    ? error.message.replace(error.cause.message, issue.message)
                    : `${error.message}: ${issue.message}`;
                return new Error(message, { cause: issue });
            });
        }
        causes.add(nested);
        nested = nested.cause;
    }
    return [error];
}

/** Retain actual rule errors; no partially validated value may cross this boundary. */
class ResponseValidationError extends Error {
    constructor(issues) {
        const messages = new Set();
        issues = issues.flatMap(issue => validationIssues(issue)).filter(issue => {
            if (messages.has(issue.message)) return false;
            messages.add(issue.message);
            return true;
        }).slice(0, MAX_VALIDATION_ISSUES);
        super(issues.length === 1 ? issues[0].message : issues.map((issue, index) => `${index + 1}. ${issue.message}`).join('\n'), { cause: issues[0] });
        this.name = 'ResponseValidationError';
        this.issues = Object.freeze([...issues]);
    }
}

class ValidationIssueCollector {
    #issues = [];
    #messages = new Set();

    get full() { return this.#issues.length >= MAX_VALIDATION_ISSUES; }
    get size() { return this.#issues.length; }

    add(error) {
        // These collectors are for synchronous, pure validation only. Preserve
        // explicit cancellation even when it has acquired a contextual wrapper.
        const visited = new Set();
        for (let cause = error; cause && !visited.has(cause); cause = cause.cause) {
            visited.add(cause);
            if (cause.code === 'PROMPT_CANCELLED' || cause.name === 'PromptCancellationError') throw error;
        }
        const originalIssues = validationIssues(error);
        // Cancellation may be nested in an aggregate, including past the issue cap.
        for (const issue of originalIssues) {
            const causes = new Set();
            for (let cause = issue; cause && !causes.has(cause); cause = cause.cause) {
                causes.add(cause);
                if (cause.code === 'PROMPT_CANCELLED' || cause.name === 'PromptCancellationError') throw error;
            }
        }
        for (const issue of originalIssues) {
            if (this.full) break;
            if (this.#messages.has(issue.message)) continue;
            this.#messages.add(issue.message);
            this.#issues.push(issue);
        }
    }

    capture(validate) {
        if (this.full) return undefined;
        try { return validate(); }
        catch (error) { this.add(error); return undefined; }
    }

    throwIfAny() {
        if (this.size === 1) throw this.#issues[0];
        if (this.size > 1) throw new ResponseValidationError(this.#issues);
    }
}

function withValidationContext(error, context) {
    const wrap = cause => new Error(`${context}: ${cause.message}`, { cause });
    return error instanceof ResponseValidationError
        ? new ResponseValidationError(validationIssues(error).map(wrap))
        : wrap(error);
}

module.exports = { MAX_VALIDATION_ISSUES, ResponseValidationError, ValidationIssueCollector, withValidationContext };
