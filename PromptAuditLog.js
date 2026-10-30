const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const Globals = require('./Globals.js');

const context = new AsyncLocalStorage();
const cancelled = error => error?.code === 'PROMPT_CANCELLED' || error?.name === 'PromptCancellationError';

function brief(value, limit = 240) {
    return String(value || '').split(/[\r\n]/, 1)[0]
        .replace(/["']?(?:headers|config|request|response|data|body|prompt|messages|authorization|api[_-]?key|access[_-]?token|token|password)["']?\s*[:=][\s\S]*$/i, '[request details omitted]')
        .replace(/[\[{][\s\S]*$/, '[structured details omitted]')
        .replace(/<[\s\S]*$/, '[XML details omitted]')
        .replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, '[quoted value omitted]')
        .replace(/Bearer\s+\S+|\bsk-[A-Za-z0-9_-]+/gi, '[redacted]')
        .replace(/\b(api[_-]?key|authorization|access[_-]?token|password)\s*[:=]\s*\S+/gi, '$1=[redacted]')
        .replace(/https?:\/\/[^\s]+/gi, raw => {
            try { const url = new URL(raw); return `${url.protocol}//${url.host}${url.pathname}`; }
            catch { return '[url]'; }
        }).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function location(value) {
    if (typeof value === 'string') return { id: null, name: brief(value, 100) };
    return value && typeof value === 'object'
        ? { id: brief(value.id, 100) || null, name: brief(value.name, 100) || null }
        : null;
}

function logReference(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError('Prompt audit log references must be non-empty file paths.');
    }
    return value.replace(/[\r\n]/g, ' ');
}

function category(error, phase) {
    const message = String(error?.message || error || '');
    if (error?.isContextLimitError || error?.code === 'LLM_CONTEXT_LIMIT_EXCEEDED') return 'context-limit';
    if (/context.{0,30}(limit|length|window)|maximum.{0,20}tokens|too many tokens|prompt.{0,20}too long/i.test(message)) return 'context-limit';
    if (/timeout|timed out/i.test(message) || error?.name === 'TimeoutError' || ['ETIMEDOUT', 'ECONNABORTED'].includes(error?.code)) return 'timeout';
    if (error?.response?.status === 429 || error?.status === 429) return 'rate-limit';
    if (phase === 'tool') return 'tool';
    if (/xml|root element|closing tag/i.test(message)) return 'xml';
    if (phase === 'transport') return 'transport';
    return phase === 'parse' ? 'parse' : 'validation';
}

function stageState(store) {
    return store.stage || store.prompt;
}

class PromptAuditLog {
    static currentTurn() { return context.getStore()?.turn || null; }

    static beginCompletionObservation({ metadataLabel } = {}) {
        const startupLatency = this.beginStartupLatency({ metadataLabel });
        const completionTiming = this.beginCompletionTiming({ metadataLabel });
        return {
            beginAttempt: details => completionTiming.beginAttempt(details),
            transportStarted: details => {
                startupLatency.transportStarted();
                completionTiming.transportStarted(details);
            },
            firstOutput: details => {
                startupLatency.firstOutput(details);
                completionTiming.firstOutput(details);
            },
            observeResponse: (responseData, { bridgeUsage = false, rawProviderResponse = true } = {}) => {
                completionTiming.recordProviderMetadata({
                    responseId: rawProviderResponse ? responseData?.id : undefined,
                    finishReason: rawProviderResponse ? responseData?.choices?.[0]?.finish_reason : undefined,
                    usage: responseData?.usage,
                    bridgeUsage
                });
            },
            transportFinished: () => completionTiming.transportFinished(),
            duringRetryDelay: async callback => {
                if (typeof callback !== 'function') throw new TypeError('Completion retry delay requires a callback.');
                completionTiming.retryDelayStarted();
                try { return await callback(); }
                finally { completionTiming.retryDelayFinished(); }
            },
            finishAttempt: details => completionTiming.finishAttempt(details),
            finish: details => startupLatency.finish(details)
        };
    }

    static beginCompletionTiming({ metadataLabel } = {}) {
        const store = context.getStore();
        const completionId = randomUUID();
        const completionStartedAt = process.hrtime.bigint();
        const startedAt = new Date().toISOString();
        const logDirectory = store?.turn?.logDirectory || path.join(Globals.baseDir || __dirname, 'logs');
        const logPath = path.join(logDirectory, `completion-timing-${startedAt.slice(0, 10)}.jsonl`);
        let activeAttempt = null;
        const elapsedMs = (start, end) => Number(end - start) / 1e6;
        const finiteNumber = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
        const stopSetting = value => typeof value === 'string' ? value
            : Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value] : null;
        const finishAttempt = ({ outcome = 'error' } = {}) => {
            const entry = activeAttempt;
            if (!entry) return;
            activeAttempt = null;
            if (entry.dispatchAt === null) return;
            const endedAt = process.hrtime.bigint();
            if (entry.transportEndedAt === null) entry.transportEndedAt = endedAt;
            if (entry.retryDelayStartedAt !== null) {
                entry.retryBackoffMs += elapsedMs(entry.retryDelayStartedAt, endedAt);
            }
            const row = {
                event: 'completion_attempt_timing',
                completionId,
                requestId: store?.turn?.requestId || null,
                auditId: store?.turn?.id || null,
                promptId: store?.prompt?.id || null,
                stage: store?.stage?.stage || null,
                metadataLabel: brief(metadataLabel || 'unknown', 120),
                attempt: entry.attempt,
                backend: entry.backend,
                streaming: entry.streaming,
                model: entry.model,
                settingsForwardedToProvider: entry.settingsForwardedToProvider,
                requestMaxTokens: entry.requestMaxTokens,
                requestMaxCompletionTokens: entry.requestMaxCompletionTokens,
                requestStop: entry.requestStop,
                requestStopSequences: entry.requestStopSequences,
                providerResponseId: entry.providerResponseId,
                providerFinishReason: entry.providerFinishReason,
                promptTokens: entry.promptTokens,
                completionTokens: entry.completionTokens,
                totalTokens: entry.totalTokens,
                cachedInputTokens: entry.cachedInputTokens,
                reasoningOutputTokens: entry.reasoningOutputTokens,
                startedAt,
                attemptStartedAt: entry.startedAtUtc,
                dispatchedAt: entry.dispatchedAtUtc,
                transportEndedAt: entry.transportEndedAtUtc || new Date().toISOString(),
                endedAt: new Date().toISOString(),
                outcome,
                firstOutputKind: entry.firstOutputKind,
                preparationMs: elapsedMs(entry.startedAt, entry.dispatchAt),
                completionToDispatchMs: elapsedMs(completionStartedAt, entry.dispatchAt),
                dispatchToFirstOutputMs: entry.firstOutputAt === null ? null : elapsedMs(entry.dispatchAt, entry.firstOutputAt),
                ttftMs: entry.firstOutputKind === 'first_generated_output'
                    ? elapsedMs(entry.dispatchAt, entry.firstOutputAt) : null,
                firstResponseMs: entry.firstOutputKind === 'first_response'
                    ? elapsedMs(entry.dispatchAt, entry.firstOutputAt) : null,
                firstChunkMs: entry.firstOutputKind === 'first_chunk'
                    ? elapsedMs(entry.dispatchAt, entry.firstOutputAt) : null,
                completionToFirstOutputMs: entry.firstOutputAt === null ? null : elapsedMs(completionStartedAt, entry.firstOutputAt),
                firstOutputToTransportEndMs: entry.firstOutputAt === null ? null : elapsedMs(entry.firstOutputAt, entry.transportEndedAt),
                transportDurationMs: elapsedMs(entry.dispatchAt, entry.transportEndedAt),
                postTransportMs: elapsedMs(entry.transportEndedAt, endedAt),
                retryBackoffMs: entry.retryBackoffMs,
                attemptTotalMs: elapsedMs(entry.startedAt, endedAt),
                completionElapsedMs: elapsedMs(completionStartedAt, endedAt)
            };
            console.log(`LLM completion timing: ${JSON.stringify(row)}`);
            try {
                fs.mkdirSync(logDirectory, { recursive: true });
                fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, 'utf8');
            } catch (error) {
                console.warn(`Failed to write completion timing log ${logPath}:`, error);
            }
        };
        return {
            beginAttempt: ({ attempt } = {}) => {
                if (activeAttempt) throw new Error('Previous completion timing attempt was not finished.');
                activeAttempt = {
                    attempt, startedAt: process.hrtime.bigint(), startedAtUtc: new Date().toISOString(),
                    dispatchAt: null, dispatchedAtUtc: null, transportEndedAt: null, transportEndedAtUtc: null,
                    firstOutputAt: null, firstOutputKind: null, backend: null, streaming: null,
                    model: null, settingsForwardedToProvider: null,
                    requestMaxTokens: null, requestMaxCompletionTokens: null,
                    requestStop: null, requestStopSequences: null,
                    providerResponseId: null, providerFinishReason: null,
                    promptTokens: null, completionTokens: null,
                    totalTokens: null, cachedInputTokens: null, reasoningOutputTokens: null,
                    retryDelayStartedAt: null, retryBackoffMs: 0
                };
            },
            transportStarted: ({ backend, streaming, model, settingsForwardedToProvider,
                requestMaxTokens, requestMaxCompletionTokens, requestStop, requestStopSequences } = {}) => {
                if (!activeAttempt || activeAttempt.dispatchAt !== null) {
                    throw new Error('Completion timing transport start requires one active, undispatched attempt.');
                }
                activeAttempt.dispatchAt = process.hrtime.bigint();
                activeAttempt.dispatchedAtUtc = new Date().toISOString();
                activeAttempt.backend = backend;
                activeAttempt.streaming = streaming;
                activeAttempt.model = typeof model === 'string' ? model : null;
                activeAttempt.settingsForwardedToProvider = settingsForwardedToProvider === true;
                activeAttempt.requestMaxTokens = finiteNumber(requestMaxTokens);
                activeAttempt.requestMaxCompletionTokens = finiteNumber(requestMaxCompletionTokens);
                activeAttempt.requestStop = stopSetting(requestStop);
                activeAttempt.requestStopSequences = stopSetting(requestStopSequences);
            },
            recordProviderMetadata: ({ responseId, finishReason, usage, bridgeUsage = false } = {}) => {
                if (!activeAttempt || activeAttempt.dispatchAt === null) return;
                if (typeof responseId === 'string' && responseId.trim()) {
                    activeAttempt.providerResponseId = responseId;
                }
                if (typeof finishReason === 'string') activeAttempt.providerFinishReason = finishReason;
                if (!usage || typeof usage !== 'object') return;
                const numeric = (key, value) => {
                    if (typeof value === 'number' && Number.isFinite(value)) activeAttempt[key] = value;
                };
                numeric('promptTokens', usage.prompt_tokens ?? (bridgeUsage ? usage.input_tokens : undefined));
                numeric('completionTokens', usage.completion_tokens ?? (bridgeUsage ? usage.output_tokens : undefined));
                numeric('totalTokens', usage.total_tokens);
                numeric('cachedInputTokens', usage.prompt_tokens_details?.cached_tokens
                    ?? (bridgeUsage ? usage.cached_input_tokens : undefined));
                numeric('reasoningOutputTokens', usage.completion_tokens_details?.reasoning_tokens
                    ?? (bridgeUsage ? usage.reasoning_output_tokens : undefined));
            },
            transportFinished: () => {
                if (activeAttempt && activeAttempt.dispatchAt !== null && activeAttempt.transportEndedAt === null) {
                    activeAttempt.transportEndedAt = process.hrtime.bigint();
                    activeAttempt.transportEndedAtUtc = new Date().toISOString();
                }
            },
            retryDelayStarted: () => {
                if (activeAttempt && activeAttempt.retryDelayStartedAt === null) {
                    activeAttempt.retryDelayStartedAt = process.hrtime.bigint();
                }
            },
            retryDelayFinished: () => {
                if (activeAttempt?.retryDelayStartedAt !== null && activeAttempt?.retryDelayStartedAt !== undefined) {
                    activeAttempt.retryBackoffMs += elapsedMs(activeAttempt.retryDelayStartedAt, process.hrtime.bigint());
                    activeAttempt.retryDelayStartedAt = null;
                }
            },
            firstOutput: ({ kind } = {}) => {
                if (!['first_generated_output', 'first_response', 'first_chunk'].includes(kind)) {
                    throw new TypeError('Completion timing requires a recognized first-output kind.');
                }
                if (activeAttempt && activeAttempt.dispatchAt !== null && activeAttempt.firstOutputAt === null) {
                    activeAttempt.firstOutputAt = process.hrtime.bigint();
                    activeAttempt.firstOutputKind = kind;
                }
            },
            finishAttempt
        };
    }

    static resolveHighLatencySeconds(config = Globals.config) {
        const group = config?.prompt_audit;
        if (group === undefined) return 5;
        if (!group || typeof group !== 'object' || Array.isArray(group)) {
            throw new TypeError('prompt_audit must be an object when provided.');
        }
        const value = group.high_latency_seconds;
        if (value === undefined) return 5;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
            throw new TypeError('prompt_audit.high_latency_seconds must be a positive finite number.');
        }
        return value;
    }

    static beginStartupLatency({ metadataLabel } = {}) {
        const store = context.getStore();
        if (!store?.turn && store?.failureContexts?.length) {
            const trackers = store.failureContexts.map(handle => handle.run(() => this.beginStartupLatency({ metadataLabel })));
            return Object.fromEntries(['transportStarted', 'firstOutput', 'finish'].map(method =>
                [method, details => trackers.forEach(tracker => tracker[method](details))]));
        }
        const startedAt = Date.now();
        const thresholdSeconds = this.resolveHighLatencySeconds();
        const attempt = store?.stage?.attempt ?? null;
        let transportAt = null;
        let finished = false;
        const complete = (kind, outcome) => {
            if (finished) return;
            finished = true;
            if (transportAt === null || !store?.turn) return;
            context.run(store, () => this.recordStartupLatency(Date.now() - startedAt, {
                metadataLabel, thresholdSeconds, attempt, kind, outcome,
                preparationMs: transportAt - startedAt
            }));
        };
        return {
            transportStarted: () => { if (transportAt === null && !finished) transportAt = Date.now(); },
            firstOutput: ({ kind } = {}) => {
                if (!['first_generated_output', 'first_response', 'first_chunk'].includes(kind)) {
                    throw new TypeError('Prompt startup latency requires a recognized first-output kind.');
                }
                complete(kind, 'output');
            },
            finish: ({ outcome = 'no_output' } = {}) => complete('no_output', outcome)
        };
    }

    static recordStartupLatency(durationMs, details = {}) {
        if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
            throw new TypeError('Prompt startup latency duration must be a non-negative finite number.');
        }
        const thresholdSeconds = details.thresholdSeconds === undefined ? this.resolveHighLatencySeconds()
            : this.resolveHighLatencySeconds({ prompt_audit: { high_latency_seconds: details.thresholdSeconds } });
        if (durationMs < thresholdSeconds * 1000) return null;
        const store = context.getStore();
        if (!store?.turn) {
            store?.failureContexts?.forEach(handle => handle.run(() => this.recordStartupLatency(durationMs, details)));
            return null;
        }
        const kind = details.kind || 'no_output';
        if (!['first_generated_output', 'first_response', 'first_chunk', 'no_output'].includes(kind)) {
            throw new TypeError('Prompt startup latency requires a recognized measurement kind.');
        }
        const turn = store.turn;
        const rowData = {
            metadataLabel: brief(details.metadataLabel || store.prompt?.metadataLabel || 'completion', 120),
            promptId: store.prompt?.id || null, stage: brief(store.stage?.stage || 'completion', 100),
            parser: store.stage?.parser || null, checkpoint: store.stage?.checkpoint ?? null,
            kind, outcome: brief(details.outcome || 'output', 40), thresholdSeconds,
            location: location(turn.getLocation())
        };
        if (turn.finalized || turn.flushing) {
            const line = `LATE LATENCY | ${rowData.metadataLabel} | ${rowData.stage} | ${kind} | ${durationMs / 1000}s (threshold ${thresholdSeconds}s)\n`;
            console.warn(`Prompt audit received late owned latency for turn ${turn.id}; appending to ${turn.filePath}.`);
            Promise.resolve(turn.finalization).then(() => fs.promises.appendFile(turn.filePath, line))
                .catch(error => console.warn('Failed to append late prompt audit latency:', error));
            return null;
        }
        const key = JSON.stringify(rowData);
        let row = turn.latencyRows.get(key);
        if (!row) {
            row = { ...rowData, count: 0, totalMs: 0, maxMs: 0, preparationTotalMs: 0, attempts: new Set(), logPaths: new Set() };
            turn.latencyRows.set(key, row);
        }
        row.count += 1; row.totalMs += durationMs; row.maxMs = Math.max(row.maxMs, durationMs);
        row.preparationTotalMs += details.preparationMs ?? 0;
        const attempt = details.attempt ?? store.stage?.attempt;
        if (attempt !== null && attempt !== undefined) row.attempts.add(attempt);
        for (const logPath of [...(store.prompt?.logPaths || []), ...(store.stage?.logPaths || [])]) row.logPaths.add(logPath);
        if (details.logPath) row.logPaths.add(logReference(details.logPath));
        return row;
    }

    static withoutTurn(callback, { failureContexts = [] } = {}) {
        return context.run({ turn: null, prompt: null, stage: null, failureContexts }, callback);
    }

    static acceptStage() {
        const store = context.getStore();
        if (!store?.turn && store?.failureContexts) {
            store.failureContexts.forEach(handle => handle.run(() => this.acceptStage()));
            return;
        }
        if (store?.stage) {
            delete store.stage.terminalFailure;
            if (store.prompt?.terminalStageId === store.stage.id) {
                delete store.prompt.terminalFailure;
                delete store.prompt.terminalStageId;
            }
        }
    }

    static async runTurn(options = {}, callback) {
        if (typeof callback !== 'function') throw new TypeError('Prompt audit turn requires a callback.');
        if (this.currentTurn()) return await callback();
        let settle;
        let reject;
        const finalization = new Promise((resolve, rejectPromise) => { settle = resolve; reject = rejectPromise; });
        // Writing is detached from HTTP completion. Explicit waiters can still
        // observe rejection, and flush failures always warn with their error.
        finalization.catch(() => {});
        const turn = {
            id: randomUUID(), requestId: brief(options.requestId, 160) || null,
            route: brief(options.route, 160) || 'gameplay', startedAt: new Date().toISOString(), endedAt: null,
            startLocation: location(options.startLocation), endLocation: null,
            getLocation: options.getLocation || (() => null),
            logDirectory: options.logDirectory || path.join(Globals.baseDir || __dirname, 'logs'),
            rows: new Map(), latencyRows: new Map(), errors: new WeakMap(), toolErrors: new Map(), prompts: new Set(),
            cancellationIds: new Set(), logPaths: new Set(), sequence: 0, promptCount: 0, active: 0, foregroundDone: false,
            finalized: false, flushing: false, filePath: null, finalization, settle, reject
        };
        return await context.run({ turn, prompt: null, stage: null }, async () => {
            try { return await callback(); }
            finally {
                turn.foregroundDone = true;
                turn.endedAt = new Date().toISOString();
                turn.endLocation = location(turn.getLocation());
                this.#maybeFinalize(turn);
            }
        });
    }

    static async runPrompt({ metadataLabel = 'unknown', kind = 'completion', join = true } = {}, callback) {
        const store = context.getStore();
        if (!store?.turn || (join && store.prompt?.metadataLabel === metadataLabel)) return await callback();
        const prompt = { id: randomUUID(), parent: store.prompt, metadataLabel, kind: brief(kind, 80), status: 'running', logPaths: new Set() };
        const late = store.turn.finalized || store.turn.flushing;
        if (!late) {
            store.turn.promptCount += 1;
            store.turn.prompts.add(prompt);
            store.turn.active += 1;
        }
        return await context.run({ turn: store.turn, prompt, stage: null }, async () => {
            try { const result = await callback(); prompt.status = prompt.terminalFailure ? 'failed' : 'succeeded'; return result; }
            catch (error) {
                prompt.status = cancelled(error) || prompt.cancelled ? 'cancelled' : 'failed';
                if (cancelled(error) || prompt.cancelled) this.recordCancellation();
                else this.recordFailure(error, { phase: 'terminal', propagated: true });
                throw error;
            } finally { if (!late) { store.turn.active -= 1; this.#maybeFinalize(store.turn); } }
        });
    }

    static async runStage({ stage = 'completion', parser = null, checkpoint = null } = {}, callback) {
        const store = context.getStore();
        if (!store?.turn) return await callback();
        const section = { id: randomUUID(), stage: brief(stage, 100), parser: brief(parser, 100) || null, checkpoint, attempt: null, status: 'running', logPaths: new Set() };
        return await context.run({ ...store, stage: section }, async () => {
            try { const result = await callback(); section.status = section.terminalFailure ? 'failed' : 'succeeded'; return result; }
            catch (error) {
                section.status = cancelled(error) || section.cancelled ? 'cancelled' : 'failed';
                if (cancelled(error) || section.cancelled) this.recordCancellation();
                else this.recordFailure(error, { phase: 'terminal', propagated: true });
                throw error;
            }
        });
    }

    static setAttempt(attempt) {
        const store = context.getStore();
        if (!store?.turn && store?.failureContexts) {
            store.failureContexts.forEach(handle => handle.run(() => this.setAttempt(attempt)));
            return;
        }
        const section = store?.stage;
        if (section) section.attempt = attempt;
    }

    static captureFailureBoundary() {
        const store = context.getStore();
        const boundary = new Map();
        const capture = () => {
            const turn = this.currentTurn();
            if (turn) boundary.set(turn.id, turn.sequence);
        };
        if (store?.failureContexts) store.failureContexts.forEach(handle => handle.run(capture));
        else capture();
        return boundary;
    }

    static recordCancellation() {
        const store = context.getStore();
        if (!store?.turn && store?.failureContexts) {
            store.failureContexts.forEach(handle => handle.run(() => this.recordCancellation()));
            return;
        }
        if (store?.turn) {
            store.turn.cancellationIds.add(store.prompt?.id || 'turn');
            if (store.prompt) store.prompt.cancelled = true;
            if (store.stage) store.stage.cancelled = true;
        }
    }

    static recordFailure(error, details = {}) {
        const store = context.getStore();
        if (!store?.turn) {
            if (store?.failureContexts) store.failureContexts.forEach(handle => handle.run(() => this.recordFailure(error, details)));
            return null;
        }
        if (cancelled(error) || store.prompt?.cancelled || store.stage?.cancelled) { this.recordCancellation(); return null; }
        const turn = store.turn;
        if (details.terminal) {
            if (store.prompt) {
                store.prompt.terminalFailure = true;
                store.prompt.terminalStageId = store.stage?.id || null;
            }
            if (store.stage) store.stage.terminalFailure = true;
        }
        if (details.propagated) {
            const isPropagation = existing => {
                if (!store.prompt) return true;
                let related = false;
                for (let owner = existing.prompt; owner; owner = owner.parent) {
                    if (owner === store.prompt) related = true;
                }
                return related && !(details.since && existing.sequence <= (details.since.get(turn.id) ?? 0));
            };
            const seen = new Set();
            for (let cause = error; cause && typeof cause === 'object' && !seen.has(cause); cause = cause.cause) {
                seen.add(cause);
                const existing = turn.errors.get(cause);
                if (existing && isPropagation(existing)) { if (error && typeof error === 'object') turn.errors.set(error, existing); return existing.id; }
            }
            for (const id of details.toolCallIds || (details.toolCallId ? [details.toolCallId] : [])) {
                const existing = turn.toolErrors.get(`${store.prompt?.id || ''}:${id}`);
                if (existing && isPropagation(existing)) { if (error && typeof error === 'object') turn.errors.set(error, existing); return existing.id; }
            }
        }
        const rowData = {
            metadataLabel: brief(details.metadataLabel || store.prompt?.metadataLabel || 'turn_context_work', 120),
            promptId: store.prompt?.id || null,
            stage: brief(details.stage || store.stage?.stage || 'completion', 100),
            parser: brief(details.parser || store.stage?.parser, 100) || null,
            checkpoint: details.checkpoint ?? store.stage?.checkpoint ?? null,
            phase: brief(details.phase || 'validation', 80), category: category(error, details.phase),
            message: brief(error?.message || error), toolName: brief(details.toolName, 100) || null,
            source: brief(details.source, 180) || null,
            location: location(details.location || turn.getLocation())
        };
        if (turn.finalized || turn.flushing) {
            const line = `LATE 1 | ${rowData.metadataLabel} | ${rowData.stage} | ${rowData.category} | ${rowData.message}\n`;
            console.warn(`Prompt audit received late owned failure for turn ${turn.id}; appending to ${turn.filePath}.`);
            Promise.resolve(turn.finalization).then(() => fs.promises.appendFile(turn.filePath, line)).catch(writeError => console.warn('Failed to append late prompt audit failure:', writeError));
            return null;
        }
        const key = JSON.stringify(rowData);
        let row = turn.rows.get(key);
        if (!row) { row = { ...rowData, events: [], logPaths: new Set() }; turn.rows.set(key, row); }
        const event = { id: randomUUID(), sequence: ++turn.sequence, owner: stageState(store), prompt: store.prompt, phase: details.phase,
            attempt: details.attempt ?? store.stage?.attempt ?? null };
        row.events.push(event);
        for (const logPath of [...(store.prompt?.logPaths || []), ...(store.stage?.logPaths || [])]) row.logPaths.add(logPath);
        if (details.logPath) row.logPaths.add(logReference(details.logPath));
        if (error && typeof error === 'object') turn.errors.set(error, event);
        if (details.toolCallId) turn.toolErrors.set(`${store.prompt?.id || ''}:${details.toolCallId}`, event);
        return event.id;
    }

    static addLogReference(logPath) {
        const store = context.getStore();
        if (!store?.turn && store?.failureContexts) {
            store.failureContexts.forEach(handle => handle.run(() => this.addLogReference(logPath)));
            return;
        }
        if (!store?.turn || !logPath) return;
        const reference = logReference(logPath);
        (store.stage?.logPaths || store.prompt?.logPaths || store.turn.logPaths).add(reference);
        for (const row of [...store.turn.rows.values(), ...store.turn.latencyRows.values()]) {
            if (row.promptId === (store.prompt?.id || null) && (!store.stage || row.stage === store.stage.stage)) row.logPaths.add(reference);
        }
    }

    static trackWork(work) {
        const reservation = this.reserveWork();
        Promise.resolve(work).then(() => reservation.release(), error => {
            try { reservation.run(() => this.recordFailure(error, { phase: 'background', propagated: true })); }
            catch (auditError) { console.warn('Failed to record owned background prompt audit failure:', auditError); }
            finally { reservation.release(); }
        });
        return work;
    }

    static reserveWork() {
        const store = context.getStore();
        const turn = store?.turn;
        if (turn && !turn.finalized && !turn.flushing) turn.active += 1;
        let released = false;
        return {
            run: callback => context.run(store, callback),
            release: () => {
                if (released) return;
                released = true;
                if (turn && !turn.finalized && !turn.flushing) { turn.active -= 1; this.#maybeFinalize(turn); }
            }
        };
    }

    static snapshot(turn = this.currentTurn()) {
        if (!turn) return null;
        const latencyRows = [...turn.latencyRows.values()].map(row => ({
            ...row, attempts: [...row.attempts], logPaths: [...row.logPaths]
        }));
        const rows = [...turn.rows.values()].map(row => {
            const statuses = row.events.map(event => event.owner?.status || (turn.foregroundDone ? 'failed' : 'running'));
            const recoveredCount = statuses.filter(status => status === 'succeeded').length;
            const failedCount = statuses.filter(status => status === 'failed').length;
            return {
                ...Object.fromEntries(Object.entries(row).filter(([key]) => !['events', 'logPaths'].includes(key))),
                count: row.events.length, recoveredCount, failedCount,
                pendingCount: statuses.filter(status => status === 'running').length,
                outcome: recoveredCount === row.events.length ? 'recovered' : failedCount === row.events.length ? 'failed' : 'mixed',
                attempts: [...new Set(row.events.map(event => event.attempt).filter(value => value !== null))],
                logPaths: [...row.logPaths]
            };
        });
        return {
            id: turn.id, requestId: turn.requestId, route: turn.route, startedAt: turn.startedAt, endedAt: turn.endedAt,
            startLocation: turn.startLocation, endLocation: turn.endLocation, foregroundDone: turn.foregroundDone,
            inflightWork: turn.active, promptCount: turn.promptCount, errorCount: rows.reduce((sum, row) => sum + row.count, 0),
            cancelledCount: turn.cancellationIds.size, rows,
            latencyCount: latencyRows.reduce((sum, row) => sum + row.count, 0), latencyRows,
            filePath: turn.filePath, finalized: turn.finalized
        };
    }

    static waitForFinalization(turn) { return turn.finalization; }

    static #maybeFinalize(turn) {
        if (!turn.foregroundDone || turn.active || turn.flushing || turn.finalized) return;
        turn.flushing = true;
        const stamp = turn.startedAt.replace(/[:.]/g, '-');
        turn.filePath = path.join(turn.logDirectory, `${stamp}_turn_prompt_errors_${turn.id}.log`);
        const snapshot = this.snapshot(turn);
        const labelLocation = value => value ? `${value.name || '(unnamed)'}${value.id ? ` [${value.id}]` : ''}` : '(unknown)';
        const lines = [
            'Per-turn prompt error audit', `Turn: ${turn.requestId || turn.id} | ${turn.id}`, `Route: ${turn.route}`,
            `Started: ${turn.startedAt} | Ended: ${turn.endedAt}`,
            `Location: ${labelLocation(turn.startLocation)} -> ${labelLocation(turn.endLocation)}`,
            `Prompts: ${snapshot.promptCount} | Error occurrences: ${snapshot.errorCount} | Cancelled prompts: ${snapshot.cancelledCount} | High startup latency: ${snapshot.latencyCount}`,
            ...(snapshot.rows.length ? snapshot.rows.map(row => [
                `${row.count} x ${row.outcome} (${row.recoveredCount} recovered, ${row.failedCount} failed)`,
                row.metadataLabel, `${row.stage}${row.parser ? `/${row.parser}` : ''}`,
                `checkpoint=${row.checkpoint ?? '-'} attempts=${row.attempts.join(',') || '-'}`, `${row.phase}/${row.category}`,
                row.toolName || '', labelLocation(row.location), row.message,
                row.source ? `source=${row.source}` : '', row.logPaths.length ? `logs=${row.logPaths.join(',')}` : ''
            ].filter(Boolean).join(' | ')) : ['Clean turn: no prompt errors.']),
            ...snapshot.latencyRows.map(row => [
                `LATENCY ${row.count} x`, row.metadataLabel, `${row.stage}${row.parser ? `/${row.parser}` : ''}`,
                `checkpoint=${row.checkpoint ?? '-'} attempts=${row.attempts.join(',') || '-'}`,
                row.kind, `outcome=${row.outcome}`, `max=${row.maxMs / 1000}s total=${row.totalMs / 1000}s threshold=${row.thresholdSeconds}s`,
                `preparation-total=${row.preparationTotalMs / 1000}s`, labelLocation(row.location),
                row.logPaths.length ? `logs=${row.logPaths.join(',')}` : ''
            ].filter(Boolean).join(' | ')), ''
        ];
        void fs.promises.mkdir(turn.logDirectory, { recursive: true })
            .then(() => fs.promises.writeFile(turn.filePath, lines.join('\n'), { flag: 'wx' }))
            .then(() => {
                turn.finalized = true;
                turn.rows.clear(); turn.latencyRows.clear(); turn.prompts.clear(); turn.toolErrors.clear(); turn.cancellationIds.clear(); turn.logPaths.clear();
                turn.errors = new WeakMap(); turn.getLocation = () => null;
                turn.settle(turn.filePath);
            }, error => {
                console.warn(`Failed to write turn prompt audit ${turn.filePath}:`, error);
                turn.rows.clear(); turn.latencyRows.clear(); turn.prompts.clear(); turn.toolErrors.clear(); turn.cancellationIds.clear(); turn.logPaths.clear();
                turn.errors = new WeakMap(); turn.getLocation = () => null;
                turn.finalized = true;
                turn.reject(error);
            });
    }
}

module.exports = PromptAuditLog;
