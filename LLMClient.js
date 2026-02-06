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
    static #canceledStreams = new Set();

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
        LLMClient.#canceledStreams.delete(id);
        if (!LLMClient.#streamProgress.active.size) {
            LLMClient.#streamProgress.lastBroadcastHadEntries = false;
        }
        // Emit a final progress update so clients can clear any in-flight UI.
        LLMClient.#broadcastProgress(true);
    }

    static cancelPrompt(streamId, reason = 'Prompt canceled by user') {
        const resolvedId = typeof streamId === 'string' ? streamId.trim() : '';
        if (!resolvedId) {
            throw new Error('Prompt id is required to cancel.');
        }
        const controller = LLMClient.#abortControllers.get(resolvedId);
        if (!controller) {
            throw new Error(`Prompt '${resolvedId}' is not active.`);
        }
        LLMClient.#abortControllers.delete(resolvedId);
        LLMClient.#canceledStreams.add(resolvedId);
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

                if (metadataLabel && globalConfig.prompt_ai_overrides && globalConfig.prompt_ai_overrides[metadataLabel]) {
                    const overrides = globalConfig.prompt_ai_overrides[metadataLabel];
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
        const aiConfig = LLMClient.#cloneAiConfig();
        let currentTime = Date.now();
        let semaphore = null;
        try {
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

            //check if Globals.config.prompt_ai_overrides[metadataLabel] exists, and if so, iterate through the keys and set the corresponding variables
            //console.log(`Checking for AI config overrides for metadataLabel: ${metadataLabel}`);
            if (metadataLabel && Globals.config.prompt_ai_overrides && Globals.config.prompt_ai_overrides[metadataLabel]) {
                const overrides = Globals.config.prompt_ai_overrides[metadataLabel];
                log(`Applying AI config overrides for ${metadataLabel}:`, overrides);
                for (const [key, value] of Object.entries(overrides)) {
                    log(`Applying AI config override for ${metadataLabel}: setting ${key} to ${value}`);
                    aiConfig[key] = value;
                }
            }

            dumpReasoningToConsole = true;

            if (metadataLabel) {
                log(`🧠 LLMClient.chatCompletion called with metadataLabel: ${metadataLabel}`);
            } else {
                log('🧠 LLMClient.chatCompletion called without metadataLabel.');
                traceLog();
            }

            const payload = additionalPayload && typeof additionalPayload === 'object'
                ? { ...additionalPayload }
                : {};

            // payload.reasoning = true;
            const resolvedSeed = Number.isFinite(seed) ? Math.trunc(seed) : LLMClient.#generateSeed();

            if (aiConfig.frequency_penalty !== undefined && frequencyPenalty === null) {
                payload.frequency_penalty = frequencyPenalty !== null ? frequencyPenalty : aiConfig.frequency_penalty;
            }

            if (aiConfig.presence_penalty !== undefined && presencePenalty === null) {
                payload.presence_penalty = presencePenalty !== null ? presencePenalty : aiConfig.presence_penalty;
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

            if (Array.isArray(messages)) {
                payload.messages = messages;
            }

            if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
                throw new Error('LLMClient.chatCompletion requires at least one message.');
            }

            payload.messages = await LLMClient.#convertMessagesToWebp(payload.messages);
            messages = payload.messages;

            const resolvedModel = model || payload.model || aiConfig.model;
            if (!resolvedModel) {
                throw new Error('AI model is not configured.');
            }
            payload.model = resolvedModel;
            if (!Globals.config.ai.supress_seed) {
                payload.seed = resolvedSeed;
            }

            const resolvedStream = LLMClient.#resolveBoolean(
                stream,
                payload.stream !== undefined ? payload.stream : aiConfig.stream
            );
            payload.stream = resolvedStream !== false;

            // if (payload.model !== aiConfig.model) {
            //     console.log(`Using overridden model: ${payload.model} (default is ${aiConfig.model})`);
            //     console.trace();
            // }

            log(`Using model: ${payload.model}`);

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

            if (typeof captureRequestPayload === 'function') {
                try {
                    captureRequestPayload(JSON.parse(JSON.stringify(payload)));
                } catch (_) {
                    captureRequestPayload(payload);
                }
            }

            retryAttempts = Number.isInteger(retryAttempts) && retryAttempts >= 0 ? retryAttempts : Globals.config.ai.retryAttempts || 0;

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
            semaphore = LLMClient.#ensureSemaphore(semaphoreKey, effectiveMaxConcurrent, log);
            await semaphore.acquire();

            const resolvedTimeout = LLMClient.resolveTimeout(timeoutMs, timeoutScale);
            let streamStartTimeoutMs = Number.isFinite(aiConfig.stream_start_timeout)
                ? aiConfig.stream_start_timeout * 1000
                : 40000;
            let streamContinueTimeoutMs = Number.isFinite(aiConfig.stream_continue_timeout)
                ? aiConfig.stream_continue_timeout * 1000
                : 10000;
            const incrementStartTimeoutMs = Number.isFinite(aiConfig.increment_start_timeout)
                ? aiConfig.increment_start_timeout * 1000
                : 0;
            const incrementContinueTimeoutMs = Number.isFinite(aiConfig.increment_continue_timeout)
                ? aiConfig.increment_continue_timeout * 1000
                : 0;

            const requestHeaders = {
                'Authorization': `Bearer ${resolvedApiKey}`,
                'Content-Type': 'application/json',
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
                const controller = new AbortController();
                const axiosOptions = { ...baseAxiosOptions, signal: controller.signal };
                try {
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

                    if (!payload.stream && typeof captureResponsePayload === 'function') {
                        try {
                            captureResponsePayload(JSON.parse(JSON.stringify(response.data)));
                        } catch (_) {
                            captureResponsePayload(response.data);
                        }
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
                                    const delta = parsed?.choices?.[0]?.delta?.content
                                        || parsed?.choices?.[0]?.message?.content
                                        || '';
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
                            resolve(assembled);
                        });
                        response.data.on('error', err => {
                            clear();
                            LLMClient.#trackStreamEnd(streamId);
                            rejectWithPartial(err);
                        });
                    });

                    if (payload.stream) {
                        responseContent = await handleStream(streamTrackerId);
                    } else {
                        responseContent = response.data?.choices?.[0]?.message?.content || '';
                    }

                    if (typeof onResponse === 'function') {
                        onResponse(response);
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


                    if (responseContent.trim() === '') {
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

                    if (resolvedRequiredRegex) {
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
                                    temperature: resolvedTemperature,
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
                                aiConfigOverride: aiConfig,
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

                    if (validateXML) {
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
                    const wasCanceled = streamTrackerId && LLMClient.#canceledStreams.has(streamTrackerId);
                    if (wasCanceled) {
                        LLMClient.#canceledStreams.delete(streamTrackerId);
                        if (streamTrackerId) {
                            LLMClient.#trackStreamEnd(streamTrackerId);
                        }
                        if (startTimer) {
                            clearTimeout(startTimer);
                            startTimer = null;
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
                }

                errorLog(`Retrying chat completion (attempt ${attempt + 2} of ${retryAttempts + 1})...`);
                attempt++;
                if (payload.stream) {
                    streamStartTimeoutMs += incrementStartTimeoutMs;
                    streamContinueTimeoutMs += incrementContinueTimeoutMs;
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
            if (semaphore) {
                semaphore.release();
            }
        }
    }
}

module.exports = LLMClient;
