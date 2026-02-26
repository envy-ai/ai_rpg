const axios = require('axios');
const { Console } = require('console');
const Globals = require('./Globals.js');
const { response } = require('express');
const Utils = require('./Utils.js');
const { dump } = require('js-yaml');
const readline = require('readline');
let sharpModule = null;

class Semaphore {
    constructor(maxConcurrent = 1) {
        this.maxConcurrent = Number.isInteger(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 1;
        this.current = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.current < this.maxConcurrent) {
            this.current += 1;
            return;
        }
        return new Promise(resolve => {
            this.queue.push(resolve);
        });
    }

    release() {
        if (this.current > 0) {
            this.current -= 1;
        }
        this.dispatch();
    }

    setLimit(newLimit) {
        const normalized = Number.isInteger(newLimit) && newLimit > 0 ? newLimit : this.maxConcurrent;
        if (normalized !== this.maxConcurrent) {
            this.maxConcurrent = normalized;
            this.dispatch();
        }
    }

    dispatch() {
        while (this.current < this.maxConcurrent && this.queue.length) {
            const next = this.queue.shift();
            if (typeof next === 'function') {
                this.current += 1;
                next();
            }
        }
    }
}

class LLMClient {
    static #semaphores = new Map();
    static #semaphoreLimit = null;
    static #streamProgress = {
        active: new Map(),
        timer: null,
        lastLines: 0,
        lastWidth: 0,
        lastBroadcastHadEntries: false,
        hadEntries: false
    };
    static #streamCounter = 0;
    static #abortControllers = new Map();
    static #controllerAbortIntents = new WeakMap();

    static #isInteractive() {
        return process.stdout && process.stdout.isTTY;
    }

    static #renderStreamProgress() {
        const entries = Array.from(LLMClient.#streamProgress.active.values());
        if (LLMClient.#isInteractive()) {
            const stdout = process.stdout;
            const { moveCursor, clearLine } = readline;

            if (LLMClient.#streamProgress.lastLines > 0) {
                //moveCursor(stdout, 0, -LLMClient.#streamProgress.lastLines);
            }

            let maxWidth = 0;
            const lines = entries.map(entry => {
                const elapsedSec = Math.round((Date.now() - entry.startTs) / 1000);
                const line = `📡 ${entry.label} – ${entry.bytes} bytes – ${elapsedSec}s`;
                if (line.length > maxWidth) {
                    maxWidth = line.length;
                }
                return line;
            });
            maxWidth = Math.max(maxWidth, LLMClient.#streamProgress.lastWidth);

            for (const line of lines) {
                //clearLine(stdout, 0);
                //stdout.write(line.padEnd(maxWidth, ' ') + '\n');
            }

            const extras = Math.max(0, LLMClient.#streamProgress.lastLines - lines.length);
            for (let i = 0; i < extras; i += 1) {
                //clearLine(stdout, 0);
                //stdout.write('\n');
            }

            LLMClient.#streamProgress.lastLines = lines.length;
            LLMClient.#streamProgress.lastWidth = maxWidth;
        }

        const shouldBroadcast = LLMClient.#streamProgress.active.size > 0
            || LLMClient.#streamProgress.lastBroadcastHadEntries;
        if (shouldBroadcast) {
            LLMClient.#broadcastProgress();
        }
    }

    static #ensureProgressTicker() {
        if (!LLMClient.#isInteractive()) {
            return;
        }
        if (LLMClient.#streamProgress.timer) {
            return;
        }
        LLMClient.#streamProgress.timer = setInterval(() => {
            if (!LLMClient.#streamProgress.active.size) {
                if (LLMClient.#streamProgress.lastLines > 0) {
                    // Clear previous lines then stop ticking
                    const { moveCursor, clearLine } = readline;
                    moveCursor(process.stdout, 0, -LLMClient.#streamProgress.lastLines);
                    for (let i = 0; i < LLMClient.#streamProgress.lastLines; i += 1) {
                        clearLine(process.stdout, 0);
                        process.stdout.write('\n');
                    }
                    LLMClient.#streamProgress.lastLines = 0;
                    LLMClient.#streamProgress.lastWidth = 0;
                }
                if (LLMClient.#streamProgress.lastBroadcastHadEntries) {
                    LLMClient.#broadcastProgress(true);
                }
                clearInterval(LLMClient.#streamProgress.timer);
                LLMClient.#streamProgress.timer = null;
                return;
            }
            LLMClient.#renderStreamProgress();
        }, 1000);
    }

    static #trackStreamStart(label, { startTimeoutMs = null, continueTimeoutMs = null, isBackground = false, model = null } = {}) {
        if (!LLMClient.#isInteractive()) {
            return null;
        }
        const idNum = ++LLMClient.#streamCounter;
        const id = `${label || 'chat'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const startTs = Date.now();
        const labelWithCounter = `${label || 'chat'}[${idNum}]`;
        const startDeadline = Number.isFinite(startTimeoutMs) ? startTs + startTimeoutMs : null;
        const continueDeadline = null; // set after first bytes arrive
        LLMClient.#streamProgress.active.set(id, {
            label: labelWithCounter,
            model: model || null,
            bytes: 0,
            startTs,
            startDeadline,
            continueDeadline,
            firstByteTs: null,
            isBackground: Boolean(isBackground)
        });
        LLMClient.#ensureProgressTicker();
        return id;
    }

    static #trackStreamBytes(id, bytes, continueTimeoutMs = null) {
        if (!id) return;
        const entry = LLMClient.#streamProgress.active.get(id);
        if (!entry) return;
        const now = Date.now();
        if (!entry.firstByteTs) {
            entry.firstByteTs = now;
        }
        entry.bytes += bytes;
        entry.startDeadline = null;
        if (Number.isFinite(continueTimeoutMs)) {
            entry.continueDeadline = now + continueTimeoutMs;
        } else {
            entry.continueDeadline = now;
        }
    }

    static #trackStreamEnd(id) {
        if (!id) return;
        LLMClient.#streamProgress.active.delete(id);
        LLMClient.#abortControllers.delete(id);
        if (!LLMClient.#streamProgress.active.size) {
            LLMClient.#streamProgress.lastBroadcastHadEntries = false;
        }
        // Emit a final progress update so clients can clear any in-flight UI.
        LLMClient.#broadcastProgress(true);
    }

    static cancelPrompt(streamId, reason = 'Prompt canceled by user') {
        return LLMClient.#abortPrompt(streamId, {
            reason,
            mode: 'cancel'
        });
    }

    static retryPrompt(streamId, reason = 'Prompt retry requested by user') {
        return LLMClient.#abortPrompt(streamId, {
            reason,
            mode: 'retry'
        });
    }

    static cancelAllPrompts(reason = 'Prompt canceled by user') {
        const resolvedReason = typeof reason === 'string' && reason.trim()
            ? reason.trim()
            : 'Prompt canceled by user';
        const entries = Array.from(LLMClient.#abortControllers.entries());
        const canceledPromptIds = [];
        const cancellationErrors = [];

        for (const [streamId, controller] of entries) {
            if (!controller) {
                cancellationErrors.push(`Prompt '${streamId}' has no abort controller.`);
                continue;
            }

            LLMClient.#controllerAbortIntents.set(controller, 'cancel');
            LLMClient.#abortControllers.delete(streamId);
            try {
                controller.abort(new Error(resolvedReason));
                canceledPromptIds.push(streamId);
            } catch (error) {
                const message = error?.message || String(error);
                cancellationErrors.push(`Prompt '${streamId}' failed to cancel: ${message}`);
            }
        }

        if (cancellationErrors.length) {
            throw new Error(cancellationErrors.join(' '));
        }

        return {
            canceledCount: canceledPromptIds.length,
            canceledPromptIds,
            trackedBefore: entries.length,
            trackedAfter: LLMClient.#abortControllers.size,
            activeAfterRequest: LLMClient.#streamProgress.active.size
        };
    }

    static async waitForPromptDrain({ timeoutMs = 5000, pollIntervalMs = 50 } = {}) {
        const normalizedTimeoutMs = Number(timeoutMs);
        if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs < 0) {
            throw new Error('waitForPromptDrain timeoutMs must be a finite number >= 0.');
        }

        const normalizedPollIntervalMs = Number(pollIntervalMs);
        if (!Number.isFinite(normalizedPollIntervalMs) || normalizedPollIntervalMs <= 0) {
            throw new Error('waitForPromptDrain pollIntervalMs must be a finite number > 0.');
        }

        const startedAt = Date.now();
        const timeoutAt = startedAt + Math.floor(normalizedTimeoutMs);

        while (true) {
            const activeCount = LLMClient.#streamProgress.active.size;
            const trackedCount = LLMClient.#abortControllers.size;
            if (activeCount === 0 && trackedCount === 0) {
                return {
                    elapsedMs: Date.now() - startedAt,
                    activeCount,
                    trackedCount
                };
            }

            if (Date.now() >= timeoutAt) {
                throw new Error(
                    `Timed out waiting for prompt drain after ${Math.floor(normalizedTimeoutMs)}ms `
                    + `(active=${activeCount}, tracked=${trackedCount}).`
                );
            }

            await new Promise(resolve => setTimeout(resolve, Math.floor(normalizedPollIntervalMs)));
        }
    }

    static #abortPrompt(streamId, { reason = 'Prompt canceled by user', mode = 'cancel' } = {}) {
        const resolvedId = typeof streamId === 'string' ? streamId.trim() : '';
        if (!resolvedId) {
            throw new Error('Prompt id is required.');
        }
        const controller = LLMClient.#abortControllers.get(resolvedId);
        if (!controller) {
            throw new Error(`Prompt '${resolvedId}' is not active.`);
        }
        const normalizedMode = mode === 'retry' ? 'retry' : 'cancel';
        LLMClient.#controllerAbortIntents.set(controller, normalizedMode);
        LLMClient.#abortControllers.delete(resolvedId);
        controller.abort(new Error(reason));
        return true;
    }

    static #broadcastProgress(isFinal = false) {
        const hub = Globals?.realtimeHub;
        if (!hub || typeof hub.emit !== 'function') {
            return;
        }
        const now = Date.now();
        const entries = Array.from(LLMClient.#streamProgress.active.entries()).map(([id, entry]) => {
            const deadline = entry.continueDeadline || entry.startDeadline || null;
            const timeoutSeconds = deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : null;
            const latencyMs = entry.firstByteTs ? (entry.firstByteTs - entry.startTs) : null;
            const elapsedAfterFirst = entry.firstByteTs ? Math.max(1, (now - entry.firstByteTs) / 1000) : null;
            const avgBps = elapsedAfterFirst ? Math.round(entry.bytes / elapsedAfterFirst) : null;
            return {
                id,
                label: entry.label,
                model: entry.model || null,
                bytes: entry.bytes,
                seconds: Math.round((now - entry.startTs) / 1000),
                timeoutSeconds,
                retries: entry.retries ?? 0,
                latencyMs,
                avgBps,
                isBackground: Boolean(entry.isBackground)
            };
        });
        if (entries.length === 0 && !isFinal) {
            return;
        }
        const hasForegroundEntries = entries.some(entry => !entry.isBackground);
        if (hasForegroundEntries) {
            LLMClient.#streamProgress.hadEntries = true;
        }
        const payload = {
            type: 'prompt_progress',
            entries,
            done: isFinal || entries.length === 0
        };
        try {
            hub.emit(null, 'prompt_progress', payload);
            LLMClient.#streamProgress.lastBroadcastHadEntries = entries.length > 0 && !isFinal;
            const activeForeground = Array.from(LLMClient.#streamProgress.active.values())
                .filter(entry => !entry.isBackground);
            const allDone = isFinal && activeForeground.length === 0;
            if (allDone && LLMClient.#streamProgress.hadEntries) {
                hub.emit(null, 'prompt_progress_cleared', {
                    type: 'prompt_progress_cleared',
                    timestamp: new Date().toISOString()
                });
                LLMClient.#streamProgress.hadEntries = false;
            }
        } catch (error) {
            console.warn('Failed to broadcast prompt progress:', error?.message || error);
        }
    }

    static ensureAiConfig() {
        const globalConfig = Globals?.config;
        if (!globalConfig || typeof globalConfig !== 'object') {
            throw new Error('Globals.config is not set; AI configuration unavailable.');
        }
        const aiConfig = globalConfig.ai;
        if (!aiConfig || typeof aiConfig !== 'object') {
            throw new Error('Globals.config.ai is not set; AI configuration unavailable.');
        }
        return aiConfig;
    }

    static getMaxConcurrent(aiConfigOverride = null) {
        const config = aiConfigOverride || LLMClient.ensureAiConfig();
        const raw = Number(config?.max_concurrent_requests);
        if (Number.isInteger(raw) && raw > 0) {
            return raw;
        }
        return 1;
    }

    static #ensureSemaphore(key, maxConcurrent, log = null) {
        const limit = Number.isInteger(maxConcurrent) && maxConcurrent > 0
            ? maxConcurrent
            : 1;
        const resolvedKey = key || 'default';
        const logFn = typeof log === 'function' ? log : null;
        const existing = LLMClient.#semaphores.get(resolvedKey);
        if (!existing) {
            const sem = new Semaphore(limit);
            LLMClient.#semaphores.set(resolvedKey, sem);
            if (logFn) {
                logFn(`🔒 LLMClient semaphore initialized for ${resolvedKey} with maxConcurrent=${limit}`);
            }
            return sem;
        }
        if (LLMClient.#semaphoreLimit !== limit) {
            LLMClient.#semaphoreLimit = limit;
            existing.setLimit(limit);
            if (logFn) {
                logFn(`🔒 LLMClient semaphore limit updated for ${resolvedKey} to maxConcurrent=${limit}`);
            }
        }
        return existing;
    }

    static writeLogFile({
        prefix = 'log',
        metadataLabel = '',
        payload = '',
        serializeJson = false,
        onFailureMessage = 'Failed to write log file',
        error = '',
        append = '',
    } = {}) {
        try {
            const fs = require('fs');
            const path = require('path');
            const baseDir = Globals?.baseDir || process.cwd();
            const logDir = path.join(baseDir, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            const safeLabel = metadataLabel
                ? metadataLabel.replace(/[^a-z0-9_-]/gi, '_')
                : 'unknown';
            const filePath = path.join(logDir, `ERROR_${prefix}_${Date.now()}.log`);

            let dataToWrite = payload;
            if (serializeJson) {
                dataToWrite = JSON.stringify(payload, null, 2);
            } else if (typeof payload !== 'string') {
                dataToWrite = JSON.stringify(payload ?? '', null, 2);
            }

            error = JSON.stringify(error);
            if (error) {
                dataToWrite = `Error Details:\n${error}\n\nPayload:\n${dataToWrite}`;
            }

            const appendText = typeof append === 'string' ? append.trim() : '';
            if (appendText) {
                dataToWrite = `${dataToWrite}\n\n${appendText}`;
            }

            fs.writeFileSync(filePath, dataToWrite || '', 'utf8');
            return filePath;
        } catch (error) {
            console.warn(`${onFailureMessage}: ${error.message}`);
            return null;
        }
    }

    static #formatMessageContent(content) {
        if (content === null || content === undefined) {
            return '';
        }
        if (typeof content === 'string') {
            return content;
        }
        if (Array.isArray(content)) {
            const parts = [];
            content.forEach(part => {
                if (part === null || part === undefined) {
                    return;
                }
                if (typeof part === 'string') {
                    if (part.trim()) {
                        parts.push(part);
                    }
                    return;
                }
                if (typeof part === 'object') {
                    const type = part.type || '';
                    if (type === 'text' && typeof part.text === 'string') {
                        if (part.text.trim()) {
                            parts.push(part.text);
                        }
                        return;
                    }
                    if (type === 'image_url') {
                        const url = part.image_url?.url || '';
                        if (url) {
                            if (url.startsWith('data:')) {
                                parts.push('[image_url: data url omitted]');
                            } else {
                                parts.push(`[image_url: ${url}]`);
                            }
                        } else {
                            parts.push('[image_url]');
                        }
                        return;
                    }
                    if (typeof part.text === 'string' && part.text.trim()) {
                        parts.push(part.text);
                        return;
                    }
                }
                const fallback = String(part);
                if (fallback && fallback !== '[object Object]') {
                    parts.push(fallback);
                }
            });
            return parts.join('\n').trim();
        }
        if (typeof content === 'object') {
            if (typeof content.text === 'string') {
                return content.text;
            }
            const fallback = JSON.stringify(content, null, 2);
            return typeof fallback === 'string' ? fallback : String(content);
        }
        return String(content);
    }

    static formatMessagesForErrorLog(messages = []) {
        const systemParts = [];
        const userParts = [];
        const otherParts = [];
        if (Array.isArray(messages)) {
            messages.forEach(message => {
                if (!message || typeof message !== 'object') {
                    return;
                }
                const role = typeof message.role === 'string' ? message.role.trim().toLowerCase() : 'unknown';
                const content = LLMClient.#formatMessageContent(message.content).trim();
                if (!content) {
                    return;
                }
                if (role === 'system') {
                    systemParts.push(content);
                } else if (role === 'user') {
                    userParts.push(content);
                } else {
                    otherParts.push(`[${role || 'unknown'}]\n${content}`);
                }
            });
        }

        const lines = [];
        lines.push('=== SYSTEM PROMPT ===');
        lines.push(systemParts.length ? systemParts.join('\n\n') : '(none)');
        lines.push('');
        lines.push('=== PROMPT ===');
        lines.push(userParts.length ? userParts.join('\n\n') : '(none)');

        if (otherParts.length) {
            lines.push('');
            lines.push('=== OTHER MESSAGES ===');
            lines.push(otherParts.join('\n\n'));
        }

        return lines.join('\n');
    }

    static logPrompt({
        prefix = 'prompt',
        metadataLabel = '',
        systemPrompt = '',
        generationPrompt = '',
        response = '',
        reasoning = '',
        sections = [],
        totalTokens = null,
        model = null,
        endpoint = null,
        requestPayload = null,
        responsePayload = null,
        output = 'stdout'
    } = {}) {
        const resolvedOutput = LLMClient.resolveOutput(output);
        const isSilent = resolvedOutput === 'silent';
        const outputConsole = resolvedOutput === 'stderr'
            ? new Console({ stdout: process.stderr, stderr: process.stderr })
            : new Console({ stdout: process.stdout, stderr: process.stdout });
        try {
            const fs = require('fs');
            const path = require('path');
            const baseDir = Globals?.baseDir || process.cwd();
            const logDir = path.join(baseDir, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            const safeLabel = metadataLabel
                ? metadataLabel.replace(/[^a-z0-9_-]/gi, '_')
                : 'unknown';
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filePath = path.join(logDir, `${timestamp}_${prefix}_${safeLabel}.log`);

            const lines = [];

            const resolveModelAndEndpoint = () => {
                const globalConfig = Globals?.config || {};
                const aiConfigSource = globalConfig.ai || {};
                let aiConfig;
                try {
                    aiConfig = JSON.parse(JSON.stringify(aiConfigSource));
                } catch (_) {
                    aiConfig = { ...aiConfigSource };
                }

                const { overrides } = LLMClient.#resolveAiModelOverrides(metadataLabel, globalConfig);
                if (overrides) {
                    Object.entries(overrides).forEach(([key, value]) => {
                        aiConfig[key] = value;
                    });
                }

                const resolvedModel = model || aiConfig.model || null;
                let resolvedEndpoint = endpoint || aiConfig.endpoint || null;
                if (resolvedEndpoint) {
                    try {
                        resolvedEndpoint = LLMClient.resolveChatEndpoint(resolvedEndpoint);
                    } catch (_) {
                        // leave as provided if normalization fails
                    }
                }

                return { resolvedModel, resolvedEndpoint };
            };

            const { resolvedModel, resolvedEndpoint } = resolveModelAndEndpoint();
            if (resolvedModel || resolvedEndpoint || Number.isFinite(totalTokens)) {
                lines.push('=== MODEL INFO ===');
                if (resolvedModel) {
                    lines.push(`Model: ${resolvedModel}`);
                }
                if (resolvedEndpoint) {
                    lines.push(`API: ${resolvedEndpoint}`);
                }
                if (Number.isFinite(totalTokens)) {
                    lines.push(`Tokens: ${totalTokens}`);
                }
                lines.push('');
            }

            if (requestPayload && typeof requestPayload === 'object') {
                try {
                    lines.push('=== REQUEST PAYLOAD ===');
                    lines.push(JSON.stringify(requestPayload, null, 2));
                    lines.push('');
                } catch (_) {
                    // ignore payload serialization issues
                }
            }

            if (responsePayload && typeof responsePayload === 'object') {
                try {
                    lines.push('=== RESPONSE JSON ===');
                    lines.push(JSON.stringify(responsePayload, null, 2));
                    lines.push('');
                } catch (_) {
                    // ignore payload serialization issues
                }
            }

            if (Number.isFinite(totalTokens)) {
                lines.push(`=== TOTAL TOKENS: ${totalTokens} ===`, '');
            }

            if (systemPrompt) {
                lines.push('=== SYSTEM PROMPT ===', systemPrompt, '');
            }

            if (generationPrompt) {
                lines.push('=== GENERATION PROMPT ===', generationPrompt, '');
            }

            if (reasoning) {
                lines.push('=== REASONING ===', reasoning, '');
            }

            if (Array.isArray(sections)) {
                for (const entry of sections) {
                    if (!entry) {
                        continue;
                    }
                    const title = typeof entry.title === 'string' && entry.title.trim()
                        ? entry.title.trim()
                        : null;
                    const content = entry.content !== undefined && entry.content !== null
                        ? String(entry.content)
                        : '';
                    if (!title || !content) {
                        continue;
                    }
                    lines.push(`=== ${title.toUpperCase()} ===`, content, '');
                }
            }

            if (response) {
                lines.push('=== RESPONSE ===', response, '');
            }

            if (!lines.length) {
                return null;
            }

            fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
            if (!isSilent) {
                outputConsole.log(`Prompt log written to ${filePath}`);
            }
            return filePath;
        } catch (error) {
            const errorMessage = error?.message || String(error);
            console.error(`Failed to write prompt log file: ${errorMessage}`);
            return null;
        }
    }

    static #cloneAiConfig() {
        const source = LLMClient.ensureAiConfig();
        try {
            return JSON.parse(JSON.stringify(source));
        } catch (error) {
            throw new Error(`Failed to clone AI configuration: ${error.message}`);
        }
    }

    static #normalizePromptLabel(label) {
        if (typeof label !== 'string') {
            return '';
        }
        return label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    static #isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    static #cloneJsonCompatibleValue(value) {
        if (Array.isArray(value)) {
            return value.map(item => LLMClient.#cloneJsonCompatibleValue(item));
        }
        if (LLMClient.#isPlainObject(value)) {
            const clone = {};
            for (const [key, entry] of Object.entries(value)) {
                clone[key] = LLMClient.#cloneJsonCompatibleValue(entry);
            }
            return clone;
        }
        return value;
    }

    // Merge override custom_args profiles while preserving null deletion markers.
    static #mergeCustomArgsForOverrideProfiles(target, source) {
        if (!LLMClient.#isPlainObject(source)) {
            throw new Error('AI model override custom_args must be an object.');
        }
        for (const [key, value] of Object.entries(source)) {
            if (value === undefined) {
                continue;
            }
            if (LLMClient.#isPlainObject(value)) {
                const existing = target[key];
                const mergedChild = LLMClient.#isPlainObject(existing)
                    ? { ...existing }
                    : {};
                LLMClient.#mergeCustomArgsForOverrideProfiles(mergedChild, value);
                target[key] = mergedChild;
                continue;
            }
            target[key] = LLMClient.#cloneJsonCompatibleValue(value);
        }
        return target;
    }

    // Merge effective custom_args onto base args; null deletes keys.
    static #mergeEffectiveCustomArgs(target, source) {
        if (!LLMClient.#isPlainObject(source)) {
            throw new Error('custom_args must be an object.');
        }
        for (const [key, value] of Object.entries(source)) {
            if (value === undefined) {
                continue;
            }
            if (value === null) {
                delete target[key];
                continue;
            }
            if (LLMClient.#isPlainObject(value)) {
                const existing = target[key];
                const mergedChild = LLMClient.#isPlainObject(existing)
                    ? { ...existing }
                    : {};
                LLMClient.#mergeEffectiveCustomArgs(mergedChild, value);
                if (Object.keys(mergedChild).length === 0) {
                    delete target[key];
                } else {
                    target[key] = mergedChild;
                }
                continue;
            }
            target[key] = LLMClient.#cloneJsonCompatibleValue(value);
        }
        return target;
    }

    // Merge override headers profiles while preserving null deletion markers.
    static #mergeHeadersForOverrideProfiles(target, source) {
        if (!LLMClient.#isPlainObject(source)) {
            throw new Error('AI model override headers must be an object.');
        }
        for (const [rawKey, rawValue] of Object.entries(source)) {
            if (rawValue === undefined) {
                continue;
            }
            const key = typeof rawKey === 'string' ? rawKey.trim() : '';
            if (!key) {
                throw new Error('AI model override headers keys must be non-empty strings.');
            }
            if (rawValue === null) {
                target[key] = null;
                continue;
            }
            if (typeof rawValue !== 'string') {
                throw new Error(`AI model override header "${key}" must be a string or null.`);
            }
            target[key] = rawValue;
        }
        return target;
    }

    // Merge effective headers onto base headers; null deletes keys.
    static #mergeEffectiveHeaders(target, source) {
        if (!LLMClient.#isPlainObject(source)) {
            throw new Error('headers must be an object.');
        }
        for (const [rawKey, rawValue] of Object.entries(source)) {
            if (rawValue === undefined) {
                continue;
            }
            const key = typeof rawKey === 'string' ? rawKey.trim() : '';
            if (!key) {
                throw new Error('headers keys must be non-empty strings.');
            }
            if (rawValue === null) {
                delete target[key];
                continue;
            }
            if (typeof rawValue !== 'string') {
                throw new Error(`header "${key}" must be a string.`);
            }
            target[key] = rawValue;
        }
        return target;
    }

    static #buildEffectiveHeaders({ baseHeaders, overrideHeaders } = {}) {
        let effective = {};
        if (baseHeaders !== undefined && baseHeaders !== null) {
            if (!LLMClient.#isPlainObject(baseHeaders)) {
                throw new Error('config.ai.headers must be an object when provided.');
            }
            for (const [rawKey, rawValue] of Object.entries(baseHeaders)) {
                const key = typeof rawKey === 'string' ? rawKey.trim() : '';
                if (!key) {
                    throw new Error('config.ai.headers keys must be non-empty strings.');
                }
                if (typeof rawValue !== 'string') {
                    throw new Error(`config.ai.headers.${key} must be a string.`);
                }
                effective[key] = rawValue;
            }
        }

        if (overrideHeaders !== undefined) {
            if (overrideHeaders === null) {
                effective = {};
            } else {
                if (!LLMClient.#isPlainObject(overrideHeaders)) {
                    throw new Error('ai_model_overrides.*.headers must be an object or null.');
                }
                LLMClient.#mergeEffectiveHeaders(effective, overrideHeaders);
            }
        }

        return effective;
    }

    static #assertCustomArgsNoReservedTopLevelKeys(customArgs) {
        if (!LLMClient.#isPlainObject(customArgs)) {
            throw new Error('custom_args must be an object.');
        }
        const reservedKeys = new Set([
            'messages',
            'model',
            'seed',
            'stream',
            'max_tokens',
            'temperature',
            'top_p',
            'frequency_penalty',
            'presence_penalty'
        ]);
        for (const key of Object.keys(customArgs)) {
            const normalized = String(key).trim().toLowerCase();
            if (reservedKeys.has(normalized)) {
                throw new Error(`ai.custom_args cannot include reserved top-level key "${key}".`);
            }
        }
    }

    static #buildEffectiveCustomArgs({ baseCustomArgs, overrideCustomArgs } = {}) {
        let effective = {};
        if (baseCustomArgs !== undefined && baseCustomArgs !== null) {
            if (!LLMClient.#isPlainObject(baseCustomArgs)) {
                throw new Error('config.ai.custom_args must be an object when provided.');
            }
            effective = LLMClient.#cloneJsonCompatibleValue(baseCustomArgs);
        }

        if (overrideCustomArgs !== undefined) {
            if (overrideCustomArgs === null) {
                effective = {};
            } else {
                if (!LLMClient.#isPlainObject(overrideCustomArgs)) {
                    throw new Error('ai_model_overrides.*.custom_args must be an object or null.');
                }
                LLMClient.#mergeEffectiveCustomArgs(effective, overrideCustomArgs);
            }
        }

        LLMClient.#assertCustomArgsNoReservedTopLevelKeys(effective);
        return effective;
    }

    static #resolveAiModelOverrides(metadataLabel, globalConfig = Globals?.config) {
        const normalizedLabel = LLMClient.#normalizePromptLabel(metadataLabel);
        if (!normalizedLabel) {
            return { overrides: null, profiles: [] };
        }

        const overrideProfiles = globalConfig?.ai_model_overrides;
        if (!overrideProfiles || typeof overrideProfiles !== 'object' || Array.isArray(overrideProfiles)) {
            return { overrides: null, profiles: [] };
        }

        const overrides = {};
        const appliedProfiles = [];
        for (const [profileName, profileConfig] of Object.entries(overrideProfiles)) {
            if (!profileConfig || typeof profileConfig !== 'object' || Array.isArray(profileConfig)) {
                continue;
            }

            const prompts = Array.isArray(profileConfig.prompts) ? profileConfig.prompts : [];
            const matchesPrompt = prompts.some((promptLabel) => (
                LLMClient.#normalizePromptLabel(promptLabel) === normalizedLabel
            ));
            if (!matchesPrompt) {
                continue;
            }

            appliedProfiles.push(profileName);
            for (const [key, value] of Object.entries(profileConfig)) {
                if (key === 'prompts' || value === undefined) {
                    continue;
                }
                if (key === 'custom_args') {
                    if (value === null) {
                        overrides.custom_args = null;
                        continue;
                    }
                    if (!LLMClient.#isPlainObject(value)) {
                        throw new Error(`ai_model_overrides.${profileName}.custom_args must be an object or null.`);
                    }
                    const existingCustomArgs = overrides.custom_args;
                    if (!LLMClient.#isPlainObject(existingCustomArgs)) {
                        overrides.custom_args = {};
                    }
                    LLMClient.#mergeCustomArgsForOverrideProfiles(overrides.custom_args, value);
                    continue;
                }
                if (key === 'headers') {
                    if (value === null) {
                        overrides.headers = null;
                        continue;
                    }
                    if (!LLMClient.#isPlainObject(value)) {
                        throw new Error(`ai_model_overrides.${profileName}.headers must be an object or null.`);
                    }
                    const existingHeaders = overrides.headers;
                    if (!LLMClient.#isPlainObject(existingHeaders)) {
                        overrides.headers = {};
                    }
                    LLMClient.#mergeHeadersForOverrideProfiles(overrides.headers, value);
                    continue;
                }
                overrides[key] = value;
            }
        }

        if (!Object.keys(overrides).length) {
            return { overrides: null, profiles: appliedProfiles };
        }
        return { overrides, profiles: appliedProfiles };
    }

    static baseTimeoutMilliseconds() {
        const globalConfig = Globals?.config;
        const seconds = Number(globalConfig?.ai?.baseTimeoutSeconds);
        if (Number.isFinite(seconds) && seconds > 0) {
            return seconds * 1000;
        }
        return 120 * 1000;
    }

    static resolveTimeout(timeoutMs, multiplier = 1) {
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            return timeoutMs;
        }
        const base = LLMClient.baseTimeoutMilliseconds();
        const factor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
        const computed = base * factor;
        if (!Number.isFinite(computed) || computed <= 0) {
            throw new Error('Invalid timeout; cannot resolve effective timeout for LLM call.');
        }
        return Math.min(Number.MAX_SAFE_INTEGER, computed);
    }

    static resolveChatEndpoint(endpoint) {
        const candidate = typeof endpoint === 'string' && endpoint.trim()
            ? endpoint.trim()
            : null;

        if (!candidate) {
            throw new Error('LLM endpoint is not configured.');
        }

        if (/\/chat\/completions\/?$/i.test(candidate)) {
            return candidate.endsWith('/')
                ? candidate.slice(0, -1)
                : candidate;
        }

        return candidate.endsWith('/')
            ? `${candidate}chat/completions`
            : `${candidate}/chat/completions`;
    }

    static resolveTemperature(explicit, fallback) {
        if (Number.isFinite(explicit)) {
            return explicit;
        }
        if (Number.isFinite(fallback)) {
            return fallback;
        }
        return 0.7;
    }

    static resolveOutput(output, fallback = 'stdout') {
        const resolvedFallback = fallback || 'stdout';
        if (output === undefined || output === null || output === '') {
            return resolvedFallback;
        }
        if (typeof output !== 'string') {
            throw new Error('output must be "stdout", "stderr", or "silent".');
        }
        const normalized = output.trim().toLowerCase();
        if (normalized === 'stdout' || normalized === 'stderr' || normalized === 'silent') {
            return normalized;
        }
        throw new Error('output must be "stdout", "stderr", or "silent".');
    }

    static #resolveBoolean(value, fallback) {
        if (value === true) return true;
        if (value === false) return false;
        return Boolean(fallback);
    }

    static #generateSeed() {
        return Math.floor(Math.random() * 1e12) + 1;
    }

    static #getSharp() {
        if (sharpModule) {
            return sharpModule;
        }
        try {
            // Lazy-load so non-image calls do not require sharp.
            sharpModule = require('sharp');
            return sharpModule;
        } catch (error) {
            throw new Error('sharp is required to convert image data URLs to WebP.');
        }
    }

    static #parseImageDataUrl(dataUrl) {
        if (typeof dataUrl !== 'string' || !dataUrl.trim()) {
            throw new Error('Image data URL is required.');
        }
        const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
        if (!match) {
            throw new Error('Image data URL is invalid.');
        }
        const mimeType = match[1].toLowerCase();
        const base64Payload = match[2];
        if (!base64Payload) {
            throw new Error('Image data URL payload is missing.');
        }
        const buffer = Buffer.from(base64Payload, 'base64');
        if (!buffer.length) {
            throw new Error('Image data URL payload is empty.');
        }
        return { mimeType, buffer };
    }

    static async #convertImageDataUrlToWebp(dataUrl) {
        if (/^data:image\/webp;base64,/i.test(dataUrl)) {
            return dataUrl;
        }
        const { buffer } = LLMClient.#parseImageDataUrl(dataUrl);
        const sharp = LLMClient.#getSharp();
        const converted = await sharp(buffer).webp({ quality: 90 }).toBuffer();
        if (!converted || !converted.length) {
            throw new Error('WebP conversion produced empty output.');
        }
        const base64 = converted.toString('base64');
        return `data:image/webp;base64,${base64}`;
    }

    static async #convertMessagesToWebp(messages) {
        if (!Array.isArray(messages)) {
            return messages;
        }
        let hasImages = false;
        for (const message of messages) {
            if (!message || !Array.isArray(message.content)) {
                continue;
            }
            for (const part of message.content) {
                if (part?.type === 'image_url') {
                    hasImages = true;
                    break;
                }
            }
            if (hasImages) {
                break;
            }
        }
        if (!hasImages) {
            return messages;
        }

        const convertedMessages = [];
        for (const message of messages) {
            if (!message || !Array.isArray(message.content)) {
                convertedMessages.push(message);
                continue;
            }
            const convertedContent = [];
            for (const part of message.content) {
                if (!part || part.type !== 'image_url') {
                    convertedContent.push(part);
                    continue;
                }
                const imageUrl = typeof part?.image_url?.url === 'string' ? part.image_url.url.trim() : '';
                if (!imageUrl) {
                    throw new Error('Image URL content is missing.');
                }
                if (!imageUrl.startsWith('data:image/')) {
                    throw new Error('Image URLs must be data URLs to convert to WebP.');
                }
                const webpUrl = await LLMClient.#convertImageDataUrlToWebp(imageUrl);
                convertedContent.push({
                    ...part,
                    image_url: {
                        ...part.image_url,
                        url: webpUrl
                    }
                });
            }
            convertedMessages.push({
                ...message,
                content: convertedContent
            });
        }
        return convertedMessages;
    }

    static #extractTextContent(rawContent) {
        if (typeof rawContent === 'string') {
            return rawContent;
        }
        if (Array.isArray(rawContent)) {
            return rawContent
                .map(part => {
                    if (!part || typeof part !== 'object') {
                        return '';
                    }
                    if (typeof part.text === 'string') {
                        return part.text;
                    }
                    if (typeof part.content === 'string') {
                        return part.content;
                    }
                    return '';
                })
                .join('');
        }
        return '';
    }

    static #appendStreamToolCalls(toolCallMap, toolCallDeltas = []) {
        if (!(toolCallMap instanceof Map)) {
            throw new Error('appendStreamToolCalls requires a Map.');
        }
        if (!Array.isArray(toolCallDeltas)) {
            return;
        }

        toolCallDeltas.forEach((deltaCall, fallbackIndex) => {
            if (!deltaCall || typeof deltaCall !== 'object') {
                return;
            }
            const rawIndex = Number(deltaCall.index);
            const index = Number.isInteger(rawIndex) && rawIndex >= 0
                ? rawIndex
                : fallbackIndex;
            const existing = toolCallMap.get(index) || {
                index,
                id: '',
                type: 'function',
                function: {
                    name: '',
                    arguments: ''
                }
            };

            if (typeof deltaCall.id === 'string' && deltaCall.id.trim()) {
                existing.id = deltaCall.id.trim();
            }
            if (typeof deltaCall.type === 'string' && deltaCall.type.trim()) {
                existing.type = deltaCall.type.trim();
            }

            const functionDelta = deltaCall.function;
            if (functionDelta && typeof functionDelta === 'object') {
                if (typeof functionDelta.name === 'string' && functionDelta.name) {
                    existing.function.name += functionDelta.name;
                }
                if (typeof functionDelta.arguments === 'string' && functionDelta.arguments) {
                    existing.function.arguments += functionDelta.arguments;
                }
            }

            toolCallMap.set(index, existing);
        });
    }

    static #normalizeToolCalls(rawToolCalls, {
        sourceLabel = 'response',
        requireJsonArguments = true
    } = {}) {
        if (!Array.isArray(rawToolCalls)) {
            return [];
        }

        const normalized = [];
        for (let i = 0; i < rawToolCalls.length; i += 1) {
            const rawCall = rawToolCalls[i];
            if (!rawCall || typeof rawCall !== 'object') {
                continue;
            }
            const rawFunction = rawCall.function;
            const name = typeof rawFunction?.name === 'string' ? rawFunction.name.trim() : '';
            if (!name) {
                throw new Error(`Malformed tool call in ${sourceLabel}: function.name is required.`);
            }

            const id = typeof rawCall.id === 'string' ? rawCall.id.trim() : '';
            const type = typeof rawCall.type === 'string' && rawCall.type.trim()
                ? rawCall.type.trim()
                : 'function';
            const argumentsText = typeof rawFunction?.arguments === 'string'
                ? rawFunction.arguments
                : '';

            let parsedArguments = null;
            if (requireJsonArguments) {
                const trimmedArguments = argumentsText.trim();
                if (!trimmedArguments) {
                    throw new Error(`Malformed tool call "${name}" in ${sourceLabel}: function.arguments is empty.`);
                }
                try {
                    parsedArguments = JSON.parse(trimmedArguments);
                } catch (error) {
                    throw new Error(`Malformed tool call "${name}" in ${sourceLabel}: function.arguments is not valid JSON (${error.message}).`);
                }
            }

            normalized.push({
                id,
                type,
                function: {
                    name,
                    arguments: argumentsText,
                    parsedArguments
                }
            });
        }

        return normalized;
    }

    static #buildNormalizedResponseData({
        rawResponseData = null,
        fallbackModel = null,
        fallbackId = null,
        content = '',
        toolCalls = [],
        finishReason = null,
        usage = null
    } = {}) {
        const firstChoice = rawResponseData?.choices?.[0] || null;
        const rawMessage = firstChoice?.message || null;
        const messageRole = typeof rawMessage?.role === 'string' && rawMessage.role.trim()
            ? rawMessage.role.trim()
            : 'assistant';
        const model = typeof rawResponseData?.model === 'string' && rawResponseData.model.trim()
            ? rawResponseData.model.trim()
            : fallbackModel;
        const id = typeof rawResponseData?.id === 'string' && rawResponseData.id.trim()
            ? rawResponseData.id.trim()
            : fallbackId;
        const rawUsage = rawResponseData?.usage;
        const resolvedUsage = usage || (rawUsage && typeof rawUsage === 'object' ? { ...rawUsage } : null);

        const normalizedMessage = {
            role: messageRole,
            content: typeof content === 'string' ? content : ''
        };
        if (Array.isArray(toolCalls) && toolCalls.length) {
            normalizedMessage.tool_calls = toolCalls.map(call => ({
                id: call.id || '',
                type: call.type || 'function',
                function: {
                    name: call?.function?.name || '',
                    arguments: call?.function?.arguments || ''
                }
            }));
        }

        const normalized = {
            id: id || undefined,
            object: 'chat.completion',
            model: model || undefined,
            choices: [{
                index: 0,
                finish_reason: finishReason ?? firstChoice?.finish_reason ?? null,
                message: normalizedMessage
            }]
        };
        if (resolvedUsage) {
            normalized.usage = resolvedUsage;
        }
        return normalized;
    }

    static async chatCompletion({
        messages,
        maxTokens,
        temperature,
        model,
        apiKey,
        endpoint,
        timeoutMs,
        timeoutScale = 1,
        metadataLabel = '',
        metadata,
        retryAttempts = null,
        headers = {},
        additionalPayload = {},
        onResponse = null,
        validateXML = true,
        requiredTags = [],
        requiredRegex = null,
        waitAfterError = 10,
        dumpReasoningToConsole = false,
        debug = false,
        output = 'stdout',
        frequencyPenalty = null,
        presencePenalty = null,
        topP = null,
        seed = LLMClient.#generateSeed(),
        stream = undefined,
        captureRequestPayload = null,
        captureResponsePayload = null,
        runInBackground = false,
        maxConcurrent = null,
        multimodal = false,
    } = {}) {
        const resolvedOutput = LLMClient.resolveOutput(output);
        const isSilent = resolvedOutput === 'silent';
        const outputConsole = resolvedOutput === 'stderr'
            ? new Console({ stdout: process.stderr, stderr: process.stderr })
            : new Console({ stdout: process.stdout, stderr: process.stdout });
        const log = (...args) => {
            if (!isSilent) {
                outputConsole.log(...args);
            }
        };
        const warn = (...args) => {
            if (!isSilent) {
                outputConsole.warn(...args);
            }
        };
        const errorLog = (...args) => {
            console.error(...args);
        };
        const debugLog = (...args) => {
            if (!isSilent) {
                outputConsole.debug(...args);
            }
        };
        const traceLog = (...args) => {
            if (!isSilent) {
                outputConsole.trace(...args);
            }
        };

        if (debug && !isSilent) {
            log('LLMClient.chatCompletion called with parameters:');
            log({
                messages,
                maxTokens,
                temperature,
                model,
                apiKey: apiKey ? '***REDACTED***' : null,
                endpoint,
                timeoutMs,
                timeoutScale,
                metadataLabel,
                metadata,
                retryAttempts,
                headers,
                additionalPayload,
                validateXML,
                requiredTags,
                requiredRegex,
                waitAfterError,
                dumpReasoningToConsole,
                seed,
                topP,
                multimodal,
            });
        }
        let currentTime = Date.now();
        try {
            dumpReasoningToConsole = true;

            if (metadataLabel) {
                log(`🧠 LLMClient.chatCompletion called with metadataLabel: ${metadataLabel}`);
            } else {
                log('🧠 LLMClient.chatCompletion called without metadataLabel.');
                traceLog();
            }

            const basePayload = additionalPayload && typeof additionalPayload === 'object'
                ? { ...additionalPayload }
                : {};
            if (headers !== undefined && headers !== null && !LLMClient.#isPlainObject(headers)) {
                throw new Error('chatCompletion headers must be an object when provided.');
            }
            const resolvedSeed = Number.isFinite(seed) ? Math.trunc(seed) : LLMClient.#generateSeed();
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('LLMClient.chatCompletion requires at least one message.');
            }

            messages = await LLMClient.#convertMessagesToWebp(messages);

            const explicitRetryAttempts = Number.isInteger(retryAttempts) && retryAttempts >= 0
                ? retryAttempts
                : null;
            if (explicitRetryAttempts !== null) {
                retryAttempts = explicitRetryAttempts;
            } else {
                const configuredRetryAttempts = Number(Globals?.config?.ai?.retryAttempts);
                retryAttempts = Number.isInteger(configuredRetryAttempts) && configuredRetryAttempts >= 0
                    ? configuredRetryAttempts
                    : 0;
            }

            const resolveAttemptRuntime = ({ attemptNumber = 0 } = {}) => {
                const aiConfig = LLMClient.#cloneAiConfig();
                if (multimodal) {
                    const multimodalConfig = Globals?.config?.ai_multimodal;
                    if (!multimodalConfig || typeof multimodalConfig !== 'object') {
                        throw new Error('AI multimodal configuration is not set.');
                    }
                    if (multimodalConfig.enabled !== true) {
                        throw new Error('AI multimodal configuration is disabled.');
                    }
                    for (const [key, value] of Object.entries(multimodalConfig)) {
                        if (key === 'enabled' || value === undefined) {
                            continue;
                        }
                        aiConfig[key] = value;
                    }
                }

                const { overrides, profiles: overrideProfiles } = LLMClient.#resolveAiModelOverrides(metadataLabel, Globals?.config);
                let overrideCustomArgs = undefined;
                let overrideHeaders = undefined;
                if (overrides) {
                    const profileSummary = overrideProfiles.length ? ` (profiles: ${overrideProfiles.join(', ')})` : '';
                    log(`Applying AI model overrides for ${metadataLabel}${profileSummary}:`, overrides);
                    for (const [key, value] of Object.entries(overrides)) {
                        if (key === 'custom_args') {
                            overrideCustomArgs = value;
                            continue;
                        }
                        if (key === 'headers') {
                            overrideHeaders = value;
                            continue;
                        }
                        log(`Applying AI config override for ${metadataLabel}: setting ${key} to ${value}`);
                        aiConfig[key] = value;
                    }
                }

                const effectiveCustomArgs = LLMClient.#buildEffectiveCustomArgs({
                    baseCustomArgs: aiConfig.custom_args,
                    overrideCustomArgs
                });
                const effectiveHeaders = LLMClient.#buildEffectiveHeaders({
                    baseHeaders: aiConfig.headers,
                    overrideHeaders
                });
                const payload = {
                    ...effectiveCustomArgs,
                    ...basePayload
                };
                payload.messages = messages;

                if (aiConfig.frequency_penalty !== undefined && frequencyPenalty === null) {
                    payload.frequency_penalty = aiConfig.frequency_penalty;
                }

                if (aiConfig.presence_penalty !== undefined && presencePenalty === null) {
                    payload.presence_penalty = aiConfig.presence_penalty;
                }

                const resolvedTopP = (() => {
                    if (topP !== null && topP !== undefined) {
                        return topP;
                    }
                    if (payload.top_p !== undefined) {
                        return payload.top_p;
                    }
                    if (aiConfig.top_p !== undefined) {
                        return aiConfig.top_p;
                    }
                    return null;
                })();

                if (resolvedTopP !== null && resolvedTopP !== undefined) {
                    if (!Number.isFinite(resolvedTopP) || resolvedTopP < 0 || resolvedTopP > 1) {
                        throw new Error('top_p must be a number between 0 and 1.');
                    }
                    payload.top_p = resolvedTopP;
                }

                const resolvedModel = model || payload.model || aiConfig.model;
                if (!resolvedModel) {
                    throw new Error('AI model is not configured.');
                }
                payload.model = resolvedModel;

                if (!Globals?.config?.ai?.supress_seed) {
                    payload.seed = resolvedSeed;
                }

                const resolvedStream = LLMClient.#resolveBoolean(
                    stream,
                    payload.stream !== undefined ? payload.stream : aiConfig.stream
                );
                payload.stream = resolvedStream !== false;

                if (maxTokens !== undefined) {
                    if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
                        throw new Error('maxTokens must be a positive number when provided.');
                    }
                    payload.max_tokens = maxTokens;
                } else if (payload.max_tokens === undefined && Number.isFinite(aiConfig.maxTokens) && aiConfig.maxTokens > 0) {
                    payload.max_tokens = aiConfig.maxTokens;
                }

                const resolvedTemperature = LLMClient.resolveTemperature(
                    temperature,
                    payload.temperature !== undefined ? payload.temperature : aiConfig.temperature
                );
                payload.temperature = resolvedTemperature;

                const resolvedEndpoint = LLMClient.resolveChatEndpoint(endpoint || aiConfig.endpoint);
                const resolvedApiKey = apiKey || aiConfig.apiKey;
                if (!resolvedApiKey) {
                    throw new Error('AI API key is not configured.');
                }

                const configuredMaxConcurrent = LLMClient.getMaxConcurrent(aiConfig);
                const effectiveMaxConcurrent = Number.isInteger(maxConcurrent) && maxConcurrent > 0
                    ? maxConcurrent
                    : configuredMaxConcurrent;
                const semaphoreKey = `${resolvedApiKey || 'no-key'}::${resolvedModel || 'no-model'}`;
                const resolvedTimeout = LLMClient.resolveTimeout(timeoutMs, timeoutScale);
                const baseStartTimeoutMs = Number.isFinite(aiConfig.stream_start_timeout)
                    ? aiConfig.stream_start_timeout * 1000
                    : 40000;
                const baseContinueTimeoutMs = Number.isFinite(aiConfig.stream_continue_timeout)
                    ? aiConfig.stream_continue_timeout * 1000
                    : 10000;
                const incrementStartTimeoutMs = Number.isFinite(aiConfig.increment_start_timeout)
                    ? aiConfig.increment_start_timeout * 1000
                    : 0;
                const incrementContinueTimeoutMs = Number.isFinite(aiConfig.increment_continue_timeout)
                    ? aiConfig.increment_continue_timeout * 1000
                    : 0;
                const streamStartTimeoutMs = baseStartTimeoutMs + (incrementStartTimeoutMs * attemptNumber);
                const streamContinueTimeoutMs = baseContinueTimeoutMs + (incrementContinueTimeoutMs * attemptNumber);

                const requestHeaders = {
                    'Authorization': `Bearer ${resolvedApiKey}`,
                    'Content-Type': 'application/json',
                    ...effectiveHeaders,
                    ...headers
                };
                const baseAxiosOptions = {
                    headers: requestHeaders,
                    timeout: payload.stream ? undefined : resolvedTimeout,
                    responseType: payload.stream ? 'stream' : undefined
                };

                if (metadataLabel && metadata) {
                    baseAxiosOptions.metadata = { ...metadata, aiMetricsLabel: metadataLabel };
                } else if (metadataLabel) {
                    baseAxiosOptions.metadata = { aiMetricsLabel: metadataLabel };
                } else if (metadata) {
                    baseAxiosOptions.metadata = metadata;
                }

                return {
                    aiConfig,
                    payload,
                    resolvedModel,
                    resolvedEndpoint,
                    resolvedApiKey,
                    resolvedTemperature,
                    resolvedTimeout,
                    effectiveMaxConcurrent,
                    semaphoreKey,
                    streamStartTimeoutMs,
                    streamContinueTimeoutMs,
                    baseAxiosOptions
                };
            };

            let attempt = 0;
            let responseContent = '';
            let streamTrackerId = null;
            let startTimer = null;
            let lastTotalTokens = null;
            const resolvedRequiredRegex = (() => {
                if (!requiredRegex) {
                    return null;
                }
                if (requiredRegex instanceof RegExp) {
                    return requiredRegex;
                }
                if (typeof requiredRegex === 'string') {
                    const trimmed = requiredRegex.trim();
                    if (!trimmed) {
                        return null;
                    }
                    if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
                        const lastSlash = trimmed.lastIndexOf('/');
                        const pattern = trimmed.slice(1, lastSlash);
                        const flags = trimmed.slice(lastSlash + 1);
                        return new RegExp(pattern, flags);
                    }
                    return new RegExp(trimmed);
                }
                if (typeof requiredRegex === 'object' && requiredRegex.pattern) {
                    const pattern = String(requiredRegex.pattern);
                    const flags = requiredRegex.flags ? String(requiredRegex.flags) : undefined;
                    return flags ? new RegExp(pattern, flags) : new RegExp(pattern);
                }
                throw new Error('requiredRegex must be a RegExp, a string, or { pattern, flags }.');
            })();
            while (attempt <= retryAttempts) {
                responseContent = '';
                streamTrackerId = null;
                startTimer = null;
                let responseToolCalls = [];
                let responseUsage = null;
                let responseFinishReason = null;
                let attemptSemaphore = null;
                let attemptRuntime = null;
                let payload = null;
                let resolvedModel = null;
                let resolvedEndpoint = null;
                let resolvedTimeout = null;
                let streamStartTimeoutMs = 40000;
                let streamContinueTimeoutMs = 10000;
                const controller = new AbortController();
                try {
                    attemptRuntime = resolveAttemptRuntime({ attemptNumber: attempt });
                    payload = attemptRuntime.payload;
                    resolvedModel = attemptRuntime.resolvedModel;
                    resolvedEndpoint = attemptRuntime.resolvedEndpoint;
                    resolvedTimeout = attemptRuntime.resolvedTimeout;
                    streamStartTimeoutMs = attemptRuntime.streamStartTimeoutMs;
                    streamContinueTimeoutMs = attemptRuntime.streamContinueTimeoutMs;

                    if (typeof captureRequestPayload === 'function') {
                        try {
                            captureRequestPayload(JSON.parse(JSON.stringify(payload)));
                        } catch (_) {
                            captureRequestPayload(payload);
                        }
                    }

                    attemptSemaphore = LLMClient.#ensureSemaphore(
                        attemptRuntime.semaphoreKey,
                        attemptRuntime.effectiveMaxConcurrent,
                        log
                    );
                    await attemptSemaphore.acquire();

                    const axiosOptions = { ...attemptRuntime.baseAxiosOptions, signal: controller.signal };
                    streamTrackerId = payload.stream && !isSilent
                        ? LLMClient.#trackStreamStart(metadataLabel, {
                            startTimeoutMs: streamStartTimeoutMs,
                            continueTimeoutMs: streamContinueTimeoutMs,
                            isBackground: Boolean(runInBackground),
                            model: resolvedModel
                        })
                        : null;
                    if (streamTrackerId) {
                        LLMClient.#abortControllers.set(streamTrackerId, controller);
                    }
                    if (payload.stream) {
                        startTimer = setTimeout(() => {
                            controller.abort(new Error('Stream start timeout'));
                        }, streamStartTimeoutMs);
                    }
                    const response = await axios.post(resolvedEndpoint, payload, axiosOptions);
                    if (startTimer) {
                        clearTimeout(startTimer);
                        startTimer = null;
                    }
                    if (response?.data?.usage && Number.isFinite(response.data.usage.total_tokens)) {
                        lastTotalTokens = response.data.usage.total_tokens;
                    }

                    // On any 5xx response, wait waitAfterError seconds and then retry
                    if (response.status == 429 || (response.status >= 500 && response.status < 600)) {
                        errorLog(`Server error from LLM (status ${response.status}) on attempt ${attempt + 1}.`);
                        if (waitAfterError > 0) {
                            log(`Waiting ${waitAfterError} seconds before retrying...`);
                            await new Promise(resolve => setTimeout(resolve, waitAfterError * 1000));
                        }
                        throw new Error(`Server error from LLM (status ${response.status}).`);
                    }

                    const handleStream = (streamId) => new Promise((resolve, reject) => {
                        let buffer = '';
                        let assembled = '';
                        const streamToolCallMap = new Map();
                        let streamFinishReason = null;
                        let streamUsage = null;
                        let timer = null;

                        const rejectWithPartial = (err) => {
                            const error = err instanceof Error ? err : new Error(String(err));
                            error.partialResponse = assembled;
                            reject(error);
                        };

                        const clear = () => {
                            if (timer) {
                                clearTimeout(timer);
                                timer = null;
                            }
                        };

                        const resetTimer = (ms) => {
                            clear();
                            timer = setTimeout(() => {
                                rejectWithPartial(new Error('Stream timeout'));
                            }, ms);
                            const entry = streamId ? LLMClient.#streamProgress.active.get(streamId) : null;
                            if (entry) {
                                const deadlineTs = Date.now() + ms;
                                if (entry.firstByteTs) {
                                    entry.continueDeadline = deadlineTs;
                                } else {
                                    entry.startDeadline = deadlineTs;
                                }
                            }
                        };

                        resetTimer(streamStartTimeoutMs);

                        response.data.on('data', chunk => {
                            buffer += chunk.toString('utf8');
                            const lines = buffer.split('\n');
                            buffer = lines.pop() || '';
                            for (const line of lines) {
                                const trimmed = line.trim();
                                if (!trimmed || !trimmed.startsWith('data:')) continue;
                                const payloadStr = trimmed.slice(5).trim();
                                if (payloadStr === '[DONE]') {
                                    continue;
                                }
                                try {
                                    const parsed = JSON.parse(payloadStr);
                                    const firstChoice = parsed?.choices?.[0] || null;
                                    const deltaPayload = firstChoice?.delta || firstChoice?.message || null;
                                    const delta = LLMClient.#extractTextContent(deltaPayload?.content);
                                    if (parsed?.usage && typeof parsed.usage === 'object') {
                                        streamUsage = { ...parsed.usage };
                                    }
                                    if (firstChoice && typeof firstChoice.finish_reason === 'string') {
                                        streamFinishReason = firstChoice.finish_reason;
                                    }
                                    if (Array.isArray(deltaPayload?.tool_calls)) {
                                        LLMClient.#appendStreamToolCalls(streamToolCallMap, deltaPayload.tool_calls);
                                    }
                                    if (delta) {
                                        resetTimer(streamContinueTimeoutMs);
                                        assembled += delta;
                                        responseContent = assembled;
                                        const deltaBytes = Buffer.byteLength(delta, 'utf8');
                                        LLMClient.#trackStreamBytes(streamId, deltaBytes, streamContinueTimeoutMs);
                                    }
                                } catch (parseError) {
                                    // ignore malformed chunks, but log for visibility
                                    warn('Failed to parse stream chunk:', parseError?.message || parseError);
                                }
                            }
                        });

                        response.data.on('end', () => {
                            clear();
                            LLMClient.#trackStreamEnd(streamId);
                            responseContent = assembled;
                            const toolCalls = LLMClient.#normalizeToolCalls(
                                Array.from(streamToolCallMap.values()).sort((a, b) => a.index - b.index),
                                { sourceLabel: 'streamed response', requireJsonArguments: true }
                            );
                            resolve({
                                content: assembled,
                                toolCalls,
                                usage: streamUsage,
                                finishReason: streamFinishReason
                            });
                        });
                        response.data.on('error', err => {
                            clear();
                            LLMClient.#trackStreamEnd(streamId);
                            rejectWithPartial(err);
                        });
                    });

                    if (payload.stream) {
                        const streamResult = await handleStream(streamTrackerId);
                        responseContent = streamResult.content || '';
                        responseToolCalls = Array.isArray(streamResult.toolCalls) ? streamResult.toolCalls : [];
                        responseUsage = streamResult.usage && typeof streamResult.usage === 'object'
                            ? { ...streamResult.usage }
                            : null;
                        responseFinishReason = streamResult.finishReason || null;
                        if (responseUsage && Number.isFinite(responseUsage.total_tokens)) {
                            lastTotalTokens = responseUsage.total_tokens;
                        }
                    } else {
                        const firstChoice = response.data?.choices?.[0] || null;
                        const responseMessage = firstChoice?.message || null;
                        responseContent = LLMClient.#extractTextContent(responseMessage?.content);
                        responseToolCalls = LLMClient.#normalizeToolCalls(
                            responseMessage?.tool_calls || [],
                            { sourceLabel: 'non-stream response', requireJsonArguments: true }
                        );
                        responseUsage = response?.data?.usage && typeof response.data.usage === 'object'
                            ? { ...response.data.usage }
                            : null;
                        responseFinishReason = firstChoice?.finish_reason || null;
                    }

                    const normalizedResponseData = LLMClient.#buildNormalizedResponseData({
                        rawResponseData: payload.stream ? null : response.data,
                        fallbackModel: resolvedModel,
                        fallbackId: null,
                        content: responseContent,
                        toolCalls: responseToolCalls,
                        finishReason: responseFinishReason,
                        usage: responseUsage
                    });

                    if (typeof captureResponsePayload === 'function') {
                        try {
                            captureResponsePayload(JSON.parse(JSON.stringify(normalizedResponseData)));
                        } catch (_) {
                            captureResponsePayload(normalizedResponseData);
                        }
                    }

                    if (typeof onResponse === 'function') {
                        onResponse({
                            ...response,
                            data: normalizedResponseData
                        });
                    }
                    if (debug) {
                        log('Raw LLM response content:', responseContent);
                    }
                    // Check for presence of <think></think> tags and log a warning to the console with the contents of the tags
                    let thinkTags = [];
                    if (/<think>[\s\S]*?<\/think>/i.test(responseContent)) {
                        thinkTags = responseContent.match(/<think>[\s\S]*?<\/think>/gi);
                        warn('⚠️ Response content contains <think></think> tags');
                    }
                    // Check if <think></think> tags are present and remove them and anything inside
                    const thinkTagPattern = /<think>[\s\S]*?<\/think>/gi;
                    responseContent = responseContent.replace(thinkTagPattern, '').trim();

                    const hasToolCalls = responseToolCalls.length > 0;

                    if (responseContent.trim() === '' && !hasToolCalls) {
                        errorLog(`Empty response content received (attempt ${attempt + 1}).`);
                        if (thinkTags.length > 0) {
                            warn('⚠️ Contents of <think></think> tags:', thinkTags);
                        }
                        throw new Error('Received empty response content from LLM.');
                    }

                    if (!isSilent && dumpReasoningToConsole && thinkTags.length > 0) {
                        log('💡 Dumping reasoning from <think></think> tags to console:');
                        thinkTags.forEach(tag => log(` - ${tag}`));
                    }

                    if (resolvedRequiredRegex && !hasToolCalls) {
                        if (resolvedRequiredRegex.global || resolvedRequiredRegex.sticky) {
                            resolvedRequiredRegex.lastIndex = 0;
                        }
                        if (!resolvedRequiredRegex.test(responseContent)) {
                            const errorMsg = `Required regex ${resolvedRequiredRegex} did not match response (attempt ${attempt + 1}).`;
                            const filePath = LLMClient.writeLogFile({
                                prefix: 'missingRegex',
                                metadataLabel,
                                error: errorMsg,
                                payload: responseContent || '',
                                onFailureMessage: 'Failed to write missing regex log file'
                            });
                            if (filePath) {
                                warn(`Missing regex response logged to ${filePath}`);
                            }
                            errorLog(errorMsg);
                            throw new Error(errorMsg);
                        }
                    }

                    if (debug) {
                        try {
                            const fs = require('fs');
                            const path = require('path');
                            const baseDir = Globals?.baseDir || process.cwd();
                            const logDir = path.join(baseDir, 'logs');
                            if (!fs.existsSync(logDir)) {
                                fs.mkdirSync(logDir, { recursive: true });
                            }
                            const safeLabel = metadataLabel
                                ? metadataLabel.replace(/[^a-z0-9_-]/gi, '_')
                                : 'unknown';
                            const timestamp = Date.now();
                            const filePath = path.join(logDir, `debug_${safeLabel}_${timestamp}.log`);

                            const logPayload = {
                                timestamp,
                                metadataLabel,
                                parameters: {
                                    maxTokens,
                                    temperature: attemptRuntime?.resolvedTemperature,
                                    model: payload.model,
                                    endpoint: resolvedEndpoint,
                                    timeoutMs: resolvedTimeout,
                                    frequencyPenalty,
                                    presencePenalty,
                                    timeoutScale,
                                    retryAttempts,
                                    waitAfterError,
                                    validateXML,
                                    requiredTags,
                                    requiredRegex: resolvedRequiredRegex ? resolvedRequiredRegex.toString() : requiredRegex,
                                    dumpReasoningToConsole
                                },
                                aiConfigOverride: attemptRuntime?.aiConfig,
                                requestPayload: payload,
                                rawResponse: response.data,
                                messages
                            };

                            fs.writeFileSync(filePath, JSON.stringify(logPayload, null, 2), 'utf8');
                            log(`Debug log written to ${filePath}`);
                        } catch (debugError) {
                            warn('Failed to write debug log file:', debugError.message);
                        }
                    }

                    if (validateXML && !hasToolCalls) {
                        try {
                            Utils.parseXmlDocument(responseContent);
                        } catch (xmlError) {
                            errorLog(`XML validation failed (attempt ${attempt + 1}):`, xmlError);
                            const filePath = LLMClient.writeLogFile({
                                prefix: 'invalidXML',
                                metadataLabel,
                                error: xmlError,
                                payload: messages + "\n\nResponse:\n\n" + (responseContent || ''),
                                onFailureMessage: 'Failed to write invalid XML log file'
                            });
                            if (filePath) {
                                warn(`Invalid XML response logged to ${filePath}`);
                            }
                            throw xmlError;
                        }

                        // use regex to check for required tags
                        for (const tag of requiredTags) {
                            const tagPattern = new RegExp(`<${tag}[\s\S]*?>[\s\S]*?<\/${tag}>`, 'i');
                            if (!tagPattern.test(responseContent)) {
                                const errorMsg = `Required XML tag <${tag}> is missing in the response (attempt ${attempt + 1}).`;
                                const filePath = LLMClient.writeLogFile({
                                    prefix: 'missingTag',
                                    metadataLabel,
                                    error: errorMsg,
                                    payload: responseContent || '',
                                    onFailureMessage: 'Failed to write missing tag log file'
                                });
                                if (filePath) {
                                    warn(`Invalid XML response logged to ${filePath}`);
                                }
                                errorLog(errorMsg);
                                throw new Error(errorMsg);
                            }
                        }
                    }
                    break;

                } catch (error) {
                    if (!responseContent && typeof error?.partialResponse === 'string') {
                        responseContent = error.partialResponse;
                    }
                    const abortIntent = LLMClient.#controllerAbortIntents.get(controller);
                    if (abortIntent === 'cancel' || abortIntent === 'retry') {
                        LLMClient.#controllerAbortIntents.delete(controller);
                        if (streamTrackerId) {
                            LLMClient.#trackStreamEnd(streamTrackerId);
                        }
                        if (startTimer) {
                            clearTimeout(startTimer);
                            startTimer = null;
                        }
                        if (abortIntent === 'retry') {
                            warn(`Prompt '${metadataLabel || 'unknown'}' retry requested by user.`);
                            continue;
                        }
                        warn(`Prompt '${metadataLabel || 'unknown'}' canceled by user.`);
                        return '';
                    }
                    errorLog(`Error occurred during chat completion (attempt ${attempt + 1}): `, error.message);
                    //console.debug(error);

                    if (streamTrackerId) {
                        LLMClient.#trackStreamEnd(streamTrackerId);
                    }
                    if (startTimer) {
                        clearTimeout(startTimer);
                        startTimer = null;
                    }

                    if (error.status == 429) {
                        log('Rate limit exceeded. Waiting before retrying...');
                        if (waitAfterError > 0) {
                            log(`Waiting ${waitAfterError} seconds before retrying...`);
                            await new Promise(resolve => setTimeout(resolve, waitAfterError * 1000));
                        }
                    }

                    const promptAppend = LLMClient.formatMessagesForErrorLog(messages);
                    const filePath = LLMClient.writeLogFile({
                        prefix: 'chatCompletionError',
                        metadataLabel,
                        error: error,
                        payload: responseContent || '',
                        append: promptAppend,
                        onFailureMessage: 'Failed to write chat completion error log file'
                    });
                    if (filePath) {
                        warn(`Chat completion error response logged to ${filePath}`);
                    }

                    if (attempt === retryAttempts) {
                        errorLog('Max retry attempts reached. Failing the chat completion request.');
                        debugLog(error);
                        return '';
                    }
                } finally {
                    LLMClient.#controllerAbortIntents.delete(controller);
                    if (startTimer) {
                        clearTimeout(startTimer);
                        startTimer = null;
                    }
                    if (attemptSemaphore) {
                        attemptSemaphore.release();
                    }
                }

                errorLog(`Retrying chat completion (attempt ${attempt + 2} of ${retryAttempts + 1})...`);
                attempt++;
                if (attemptRuntime?.payload?.stream) {
                    // bump retry count on all active streams
                    LLMClient.#streamProgress.active.forEach(entry => {
                        entry.retries = (entry.retries || 0) + 1;
                    });
                }
            }

            let totalTime = Date.now() - currentTime;
            const finalBytes = streamTrackerId && LLMClient.#streamProgress.active.has(streamTrackerId)
                ? LLMClient.#streamProgress.active.get(streamTrackerId).bytes
                : null;
            const bytesNote = Number.isFinite(finalBytes) ? ` | bytes=${finalBytes}` : '';
            const tokensNote = Number.isFinite(lastTotalTokens) ? ` | tokens=${lastTotalTokens}` : '';
            const label = metadataLabel || 'unknown';
            log(`Prompt '${label}' completed after ${attempt} retries in ${totalTime / 1000} seconds.${bytesNote}${tokensNote}`);
            return responseContent;
        } finally {
            // per-attempt resources are released inside the retry loop.
        }
    }
}

module.exports = LLMClient;
