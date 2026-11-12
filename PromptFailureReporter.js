const IdGenerator = require('./IdGenerator.js');
const { AsyncLocalStorage } = require('async_hooks');
const Globals = require('./Globals.js');
const PromptAuditLog = require('./PromptAuditLog.js');

// Ownership follows a logical prompt, rather than each transport/parser attempt.
const context = new AsyncLocalStorage();
const metadataAliasContext = new AsyncLocalStorage();

class PromptFailureReporter {
    static current(metadataLabel) {
        const owner = context.getStore();
        const label = metadataLabel || 'unknown';
        const aliases = metadataAliasContext.getStore();
        return owner && (owner.metadataLabel === label
            || (aliases?.owner === owner && aliases.labels.has(label))) ? owner : null;
    }

    static async withMetadataAlias(metadataLabel, callback) {
        if (typeof metadataLabel !== 'string' || !metadataLabel.trim()) {
            throw new TypeError('Prompt failure metadata alias must be a non-empty string.');
        }
        if (typeof callback !== 'function') throw new TypeError('Prompt failure metadata alias requires an async callback.');
        const owner = context.getStore();
        if (!owner) throw new Error('Prompt failure metadata alias requires an active prompt owner.');
        const inherited = metadataAliasContext.getStore();
        const labels = new Set(inherited?.owner === owner ? inherited.labels : []);
        labels.add(metadataLabel.trim());
        return await metadataAliasContext.run({ owner, labels }, callback);
    }

    static isCancellation(error) {
        // Transport aborts also represent stream-start timeouts. Only the
        // application's explicit cancellation identity proves user intent.
        const seen = new Set();
        for (let cause = error; cause && typeof cause === 'object' && !seen.has(cause); cause = cause.cause) {
            seen.add(cause);
            if (cause.code === 'PROMPT_CANCELLED' || cause.name === 'PromptCancellationError') return true;
        }
        return false;
    }

    // Callers may add context to a reported exception without copying its
    // non-enumerable envelope. Forward that same event, not a new invocation.
    static getFailure(error) {
        const seen = new Set();
        for (let cause = error; cause && typeof cause === 'object' && !seen.has(cause); cause = cause.cause) {
            seen.add(cause);
            if (cause.promptFailure) return cause.promptFailure;
        }
        return null;
    }

    static async run({ metadataLabel = 'unknown', kind = 'completion', signal = null, join = true } = {}, callback) {
        return await PromptAuditLog.runPrompt({ metadataLabel, kind, join }, () => this.#run({ metadataLabel, kind, signal, join }, callback));
    }

    static async #run({ metadataLabel, kind, signal, join }, callback) {
        if (join && this.current(metadataLabel)) return await callback();
        const owner = { id: IdGenerator.nextSequential('prompt_failure'), metadataLabel: metadataLabel || 'unknown', kind, transportAttempts: 0, validationRetries: 0, toolCalls: null, toolErrors: [], reported: false };
        return await context.run(owner, async () => {
            try {
                return await callback();
            } catch (error) {
                const intentionallyAborted = signal?.aborted && signal.reason?.name !== 'TimeoutError';
                if (intentionallyAborted || this.isCancellation(error)) {
                    PromptAuditLog.recordCancellation({ source: 'prompt', metadataLabel });
                } else {
                    PromptAuditLog.recordFailure(error, { phase: 'terminal', propagated: true });
                    this.report(error, owner);
                }
                throw error;
            }
        });
    }

    static report(error, owner = context.getStore()) {
        if (!owner || owner.reported || this.isCancellation(error)) return;
        PromptAuditLog.recordFailure(error, { phase: 'terminal', propagated: true, terminal: true });
        owner.reported = true;
        const causes = [];
        const seen = new Set();
        for (let cause = error; cause && !seen.has(cause); cause = cause.cause) {
            seen.add(cause);
            causes.push(cause.stack || cause.message || String(cause));
        }
        const payload = {
            id: owner.id,
            metadataLabel: owner.metadataLabel,
            kind: owner.kind,
            message: error?.message || String(error),
            stack: [...causes, ...owner.toolErrors].join('\n\nCaused by:\n'),
            transportAttempts: owner.transportAttempts,
            validationRetries: owner.validationRetries,
            toolCalls: owner.toolCalls ? { ...owner.toolCalls } : null,
            serverTime: new Date().toISOString()
        };
        if (error && typeof error === 'object' && Object.isExtensible(error)) {
            Object.defineProperty(error, 'promptFailure', { value: payload, configurable: true });
        }
        // Use the same global audience as prompt_progress. Notifications are transient.
        Globals.realtimeHub?.emit(null, 'prompt_failed', payload);
    }

    static transportAttempt(metadataLabel) {
        const owner = this.current(metadataLabel);
        if (owner) owner.transportAttempts += 1;
    }

    static validationRetry(metadataLabel) {
        const owner = this.current(metadataLabel);
        if (owner) owner.validationRetries += 1;
    }

    static configureTools(metadataLabel, { limit, limitUnit }) {
        const owner = this.current(metadataLabel);
        if (!owner) return;
        if (!owner.toolCalls) owner.toolCalls = { attempted: 0, executed: 0, denied: 0, cached: 0 };
        owner.toolCalls.limit = limit;
        owner.toolCalls.limitUnit = limitUnit;
    }

    static tools(metadataLabel, counts) {
        const owner = this.current(metadataLabel);
        if (!owner) return;
        if (!owner.toolCalls) owner.toolCalls = { attempted: 0, executed: 0, denied: 0, cached: 0 };
        for (const name of ['attempted', 'executed', 'denied', 'cached']) owner.toolCalls[name] += counts[name] || 0;
    }

    static toolError(metadataLabel, { functionName, message, stack }) {
        const owner = this.current(metadataLabel);
        if (owner) owner.toolErrors.push(`Tool ${functionName}: ${message}${stack ? `\n${stack}` : ''}`);
    }
}

module.exports = PromptFailureReporter;
