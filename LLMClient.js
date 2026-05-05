const axios = require('axios');
const { Console } = require('console');
const { createHash, randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const Globals = require('./Globals.js');
const { response } = require('express');
const Utils = require('./Utils.js');
const { dump } = require('js-yaml');
const readline = require('readline');
const CodexBridgeClient = require('./CodexBridgeClient.js');
let sharpModule = null;

const PROMPT_PROGRESS_BROADCAST_INTERVAL_MS = 500;
const OAUTH_REFRESH_THRESHOLD_SECONDS = 300;

class Semaphore {
    constructor(maxConcurrent = 1) {
        this.maxConcurrent = Number.isInteger(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 1;
        this.current = 0;
        this.currentBackground = 0;
        this.queue = [];
    }

    maxBackgroundConcurrent() {
        return this.maxConcurrent > 1 ? this.maxConcurrent - 1 : 1;
    }

    canAcquire(background = false) {
        if (this.current >= this.maxConcurrent) {
            return false;
        }
        if (!background) {
            return true;
        }
        if (this.queue.some(entry => entry && entry.background === false)) {
            return false;
        }
        return this.currentBackground < this.maxBackgroundConcurrent();
    }

    createPermit(background = false) {
        return { background: Boolean(background) };
    }

    async acquire({ background = false } = {}) {
        const isBackground = Boolean(background);
        if (this.canAcquire(isBackground)) {
            this.current += 1;
            if (isBackground) {
                this.currentBackground += 1;
            }
            return this.createPermit(isBackground);
        }
        return new Promise(resolve => {
            this.queue.push({
                resolve,
                background: isBackground
            });
        });
    }

    release(permit = null) {
        if (this.current > 0) {
            this.current -= 1;
        }
        if (permit?.background && this.currentBackground > 0) {
            this.currentBackground -= 1;
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
            let nextIndex = this.queue.findIndex(entry => entry && entry.background === false && this.canAcquire(false));
            if (nextIndex < 0) {
                nextIndex = this.queue.findIndex(entry => entry && entry.background === true && this.canAcquire(true));
            }
            if (nextIndex < 0) {
                break;
            }

            const next = this.queue.splice(nextIndex, 1)[0];
            if (next && typeof next.resolve === 'function') {
                this.current += 1;
                if (next.background) {
                    this.currentBackground += 1;
                }
                next.resolve(this.createPermit(next.background));
            }
        }
    }
}

class LLMClient {
    static #semaphores = new Map();
    static #semaphoreLimit = null;
    static #forcedOutputFixtureSource = null;
    static #forcedOutputFixtureData = null;
    static #forcedOutputLabelCounters = new Map();
    static #streamProgress = {
        active: new Map(),
        timer: null,
        broadcastTimer: null,
        lastBroadcastTs: 0,
        lastLines: 0,
        lastWidth: 0,
        lastBroadcastHadEntries: false,
        hadEntries: false
    };
    static #streamCounter = 0;
    static #abortControllers = new Map();
    static #controllerAbortIntents = new WeakMap();
    static #codexUsageStats = {
        promptCount: 0,
        quotaTurnCount: 0
    };
    static #codexQuotaTurnKeys = new Set();
    static #codexQuotaTurnKeyQueue = [];
    static #oauthStates = new Map();
    static #oauthRefreshPromises = new Map();

    static #isInteractive() {
        return process.stdout && process.stdout.isTTY;
    }

    static #shouldTrackPromptProgress() {
        return LLMClient.#isInteractive()
            || Boolean(Globals?.realtimeHub && typeof Globals.realtimeHub.emit === 'function');
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
                const receivedUnit = entry.receivedUnit === 'characters' ? '' : ' bytes';
                const receivedCount = Number.isFinite(entry.receivedCount) ? entry.receivedCount : entry.bytes;
                const line = `📡 ${entry.label} – ${receivedCount}${receivedUnit} – ${elapsedSec}s`;
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
        if (!LLMClient.#shouldTrackPromptProgress()) {
            return;
        }
        if (LLMClient.#streamProgress.timer) {
            return;
        }
        LLMClient.#streamProgress.timer = setInterval(() => {
            if (!LLMClient.#streamProgress.active.size) {
                if (LLMClient.#isInteractive() && LLMClient.#streamProgress.lastLines > 0) {
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

    static #trackStreamStart(label, { startTimeoutMs = null, continueTimeoutMs = null, isBackground = false, model = null, promptText = '', receivedUnit = 'bytes' } = {}) {
        if (!LLMClient.#shouldTrackPromptProgress()) {
            return null;
        }
        const idNum = ++LLMClient.#streamCounter;
        const id = `${label || 'chat'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const startTs = Date.now();
        const labelWithCounter = `${label || 'chat'}[${idNum}]`;
        const startDeadline = Number.isFinite(startTimeoutMs) ? startTs + startTimeoutMs : null;
        const continueDeadline = null; // set after first received data arrives
        const normalizedReceivedUnit = receivedUnit === 'characters' ? 'characters' : 'bytes';
        LLMClient.#streamProgress.active.set(id, {
            label: labelWithCounter,
            model: model || null,
            bytes: 0,
            receivedCount: 0,
            receivedUnit: normalizedReceivedUnit,
            countedPreviewText: '',
            promptText: typeof promptText === 'string' ? promptText : '',
            previewText: '',
            hasTextPreview: false,
            startTs,
            startDeadline,
            continueDeadline,
            firstByteTs: null,
            isBackground: Boolean(isBackground)
        });
        LLMClient.#ensureProgressTicker();
        return id;
    }

    static #countTextCharacters(text) {
        if (typeof text !== 'string') {
            return 0;
        }
        return Array.from(text).length;
    }

    static #trackStreamReceived(id, count, continueTimeoutMs = null, previewDelta = '') {
        if (!id) return;
        const entry = LLMClient.#streamProgress.active.get(id);
        if (!entry) return;
        const numericCount = Number(count);
        if (!Number.isFinite(numericCount)) {
            throw new Error('Stream received count must be a finite number.');
        }
        const now = Date.now();
        if (!entry.firstByteTs) {
            entry.firstByteTs = now;
        }
        entry.bytes += numericCount;
        entry.receivedCount = Number.isFinite(entry.receivedCount)
            ? entry.receivedCount + numericCount
            : entry.bytes;
        if (typeof previewDelta === 'string' && previewDelta) {
            entry.previewText += previewDelta;
            LLMClient.#renderStreamProgress();
        }
        entry.startDeadline = null;
        if (Number.isFinite(continueTimeoutMs)) {
            entry.continueDeadline = now + continueTimeoutMs;
        } else {
            entry.continueDeadline = now;
        }
    }

    static #trackStreamBytes(id, bytes, continueTimeoutMs = null, previewDelta = '') {
        LLMClient.#trackStreamReceived(id, bytes, continueTimeoutMs, previewDelta);
    }

    static #applyStreamPreviewText(id, previewText, continueTimeoutMs = null, { replace = false } = {}) {
        if (!id || typeof previewText !== 'string' || !previewText) {
            return;
        }
        const entry = LLMClient.#streamProgress.active.get(id);
        if (!entry) {
            return;
        }
        const now = Date.now();
        if (!entry.firstByteTs) {
            entry.firstByteTs = now;
        }
        if (replace || !entry.hasTextPreview) {
            entry.previewText = previewText;
        } else {
            entry.previewText += previewText;
        }
        entry.hasTextPreview = true;
        entry.startDeadline = null;
        if (Number.isFinite(continueTimeoutMs)) {
            entry.continueDeadline = now + continueTimeoutMs;
        } else {
            entry.continueDeadline = now;
        }
        LLMClient.#renderStreamProgress();
    }

    static #applyCodexPreviewUpdate(id, previewUpdate, continueTimeoutMs = null) {
        if (!id || !previewUpdate || typeof previewUpdate.text !== 'string' || !previewUpdate.text) {
            return false;
        }
        const entry = LLMClient.#streamProgress.active.get(id);
        if (!entry) {
            return false;
        }
        if (entry.receivedUnit !== 'characters') {
            throw new Error('Codex preview character tracking requires a character-counted stream entry.');
        }

        const nextPreviewText = previewUpdate.text;
        const previousCountedText = typeof entry.countedPreviewText === 'string'
            ? entry.countedPreviewText
            : '';
        let newlyReceivedText = nextPreviewText;

        if (previewUpdate.replace === true) {
            if (nextPreviewText === previousCountedText || previousCountedText.startsWith(nextPreviewText)) {
                newlyReceivedText = '';
            } else if (nextPreviewText.startsWith(previousCountedText)) {
                newlyReceivedText = nextPreviewText.slice(previousCountedText.length);
            }
            entry.countedPreviewText = nextPreviewText;
        } else {
            entry.countedPreviewText = `${previousCountedText}${nextPreviewText}`;
        }

        const receivedCharacters = LLMClient.#countTextCharacters(newlyReceivedText);
        if (receivedCharacters !== 0) {
            LLMClient.#trackStreamReceived(id, receivedCharacters, continueTimeoutMs);
        }
        LLMClient.#applyStreamPreviewText(
            id,
            nextPreviewText,
            continueTimeoutMs,
            { replace: previewUpdate.replace === true }
        );
        return true;
    }

    static #trackStreamStatus(id, statusText, continueTimeoutMs = null) {
        if (!id) return;
        const trimmed = typeof statusText === 'string' ? statusText.trim() : '';
        if (!trimmed) {
            return;
        }
        const entry = LLMClient.#streamProgress.active.get(id);
        if (!entry) {
            return;
        }
        if (entry.hasTextPreview) {
            return;
        }
        const separator = entry.previewText && !entry.previewText.endsWith('\n') ? '\n' : '';
        LLMClient.#trackStreamBytes(id, 0, continueTimeoutMs, `${separator}${trimmed}\n`);
    }

    static #clearPendingProgressBroadcast() {
        if (LLMClient.#streamProgress.broadcastTimer) {
            clearTimeout(LLMClient.#streamProgress.broadcastTimer);
            LLMClient.#streamProgress.broadcastTimer = null;
        }
    }

    static #scheduleProgressBroadcast(delayMs) {
        if (LLMClient.#streamProgress.broadcastTimer) {
            return;
        }
        const normalizedDelay = Math.max(0, Math.floor(delayMs));
        LLMClient.#streamProgress.broadcastTimer = setTimeout(() => {
            LLMClient.#streamProgress.broadcastTimer = null;
            LLMClient.#broadcastProgress(false, { force: true });
        }, normalizedDelay);
        if (typeof LLMClient.#streamProgress.broadcastTimer.unref === 'function') {
            LLMClient.#streamProgress.broadcastTimer.unref();
        }
    }

    static #normalizeCodexEventKey(value) {
        if (typeof value !== 'string') {
            return '';
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return '';
        }
        return trimmed
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[/.]+/g, '_')
            .replace(/[^a-zA-Z0-9_]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toLowerCase();
    }

    static #extractCodexPreviewUpdate(event) {
        if (!event || typeof event !== 'object') {
            return null;
        }
        const typeKey = LLMClient.#normalizeCodexEventKey(
            typeof event.type === 'string' && event.type.trim()
                ? event.type
                : event.method
        );
        if (!typeKey) {
            return null;
        }
        const deltaTypeKeys = new Set([
            'agent_message_delta',
            'agent_message_content_delta',
            'item_agent_message_delta',
            'item_agent_message_content_delta'
        ]);
        if (deltaTypeKeys.has(typeKey)) {
            const deltaText = LLMClient.#extractTextContent(
                event.delta ?? event.text ?? event.content ?? event.message ?? ''
            );
            return deltaText
                ? { text: deltaText, replace: false }
                : null;
        }

        if (typeKey === 'item_completed') {
            const itemTypeKey = LLMClient.#normalizeCodexEventKey(event.item?.type);
            if (!['agent_message', 'assistant_message', 'message'].includes(itemTypeKey)) {
                return null;
            }
            const messageText = LLMClient.#extractTextContent(
                event.item?.text ?? event.item?.content ?? event.item?.message ?? ''
            );
            return messageText
                ? { text: messageText, replace: true }
                : null;
        }

        if (typeKey === 'agent_message') {
            const messageText = LLMClient.#extractTextContent(
                event.text ?? event.content ?? event.message ?? ''
            );
            return messageText
                ? { text: messageText, replace: true }
                : null;
        }

        const lastAgentMessage = typeof event.last_agent_message === 'string'
            ? event.last_agent_message
            : '';
        if (lastAgentMessage) {
            return { text: lastAgentMessage, replace: true };
        }

        return null;
    }

    static #formatCodexProgressEvent(event) {
        if (!event || typeof event !== 'object') {
            return '';
        }
        const type = typeof event.type === 'string' ? event.type.trim() : '';
        if (!type) {
            return '';
        }
        const nestedErrorMessage = typeof event.error?.message === 'string'
            ? event.error.message.trim()
            : '';
        const message = typeof event.message === 'string'
            ? event.message.trim()
            : nestedErrorMessage;
        switch (type) {
            case 'thread.started':
                if (typeof event.thread_id === 'string' && event.thread_id.trim()) {
                    return `Codex thread started (${event.thread_id.trim()}).`;
                }
                return 'Codex thread started.';
            case 'turn.started':
                return 'Codex turn started.';
            case 'turn.completed':
                return 'Codex turn completed.';
            case 'turn.failed':
                return message ? `Codex turn failed: ${message}` : 'Codex turn failed.';
            case 'error':
                return message ? `Codex error: ${message}` : 'Codex reported an error.';
            case 'item.started': {
                const itemType = typeof event.item?.type === 'string' ? event.item.type.trim() : '';
                return itemType ? `Codex started ${itemType}.` : 'Codex started an item.';
            }
            case 'item.completed': {
                const itemType = typeof event.item?.type === 'string' ? event.item.type.trim() : '';
                return itemType ? `Codex completed ${itemType}.` : 'Codex completed an item.';
            }
            default:
                return `Codex event: ${type}`;
        }
    }

    static #formatTokenCount(value) {
        return Number.isFinite(value) ? Math.trunc(value).toLocaleString() : '0';
    }

    static #formatEpochTimestamp(epochValue) {
        if (!Number.isFinite(epochValue)) {
            return 'unknown';
        }
        const normalized = epochValue > 1e12 ? epochValue : epochValue * 1000;
        return new Date(normalized).toISOString();
    }

    static #normalizeEpochMilliseconds(epochValue) {
        if (!Number.isFinite(epochValue)) {
            return null;
        }
        return epochValue > 1e12 ? epochValue : epochValue * 1000;
    }

    static #getOrdinalSuffix(dayValue) {
        const day = Number(dayValue);
        if (!Number.isInteger(day)) {
            return '';
        }
        const mod100 = day % 100;
        if (mod100 >= 11 && mod100 <= 13) {
            return 'th';
        }
        const mod10 = day % 10;
        if (mod10 === 1) {
            return 'st';
        }
        if (mod10 === 2) {
            return 'nd';
        }
        if (mod10 === 3) {
            return 'rd';
        }
        return 'th';
    }

    static #formatLocalClockTime(epochValue) {
        const normalized = LLMClient.#normalizeEpochMilliseconds(epochValue);
        if (normalized === null) {
            return null;
        }
        return new Intl.DateTimeFormat('en-US', {
            hour: 'numeric',
            minute: '2-digit'
        }).format(new Date(normalized));
    }

    static #formatLocalMonthDayAtTime(epochValue) {
        const normalized = LLMClient.#normalizeEpochMilliseconds(epochValue);
        if (normalized === null) {
            return null;
        }
        const date = new Date(normalized);
        const monthDayParts = new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric'
        }).formatToParts(date);
        const month = monthDayParts.find(part => part.type === 'month')?.value || '';
        const dayText = monthDayParts.find(part => part.type === 'day')?.value || '';
        const day = Number.parseInt(dayText, 10);
        const timeText = LLMClient.#formatLocalClockTime(epochValue);
        if (!month || !Number.isInteger(day) || !timeText) {
            return null;
        }
        return `${month} ${day}${LLMClient.#getOrdinalSuffix(day)} at ${timeText}`;
    }

    static #buildCodexCreditsLine(credits) {
        if (!credits || typeof credits !== 'object') {
            return null;
        }
        if (credits.unlimited === true || credits.hasCredits === false) {
            return null;
        }
        const rawBalance = typeof credits.balance === 'string'
            ? credits.balance.trim()
            : '';
        if (!rawBalance) {
            return null;
        }
        const numericBalance = Number(rawBalance.replace(/,/g, ''));
        if (Number.isFinite(numericBalance) && numericBalance <= 0) {
            return null;
        }
        return `${rawBalance} credits`;
    }

    static #buildCodexQuotaWindowLine(label, window, { includeDate = false } = {}) {
        if (!window || typeof window !== 'object') {
            return null;
        }
        const usedPercent = Number(window.usedPercent);
        const remainingPercent = Number.isFinite(usedPercent)
            ? Math.max(0, 100 - Math.trunc(usedPercent))
            : null;
        const resetText = includeDate
            ? LLMClient.#formatLocalMonthDayAtTime(Number(window.resetsAt))
            : LLMClient.#formatLocalClockTime(Number(window.resetsAt));
        let line = `${label}: ${remainingPercent === null ? 'remaining unknown' : `${remainingPercent}% remaining`}`;
        if (resetText) {
            line += `; resets ${resetText}`;
        }
        return line;
    }

    static #formatCodexRateLimitWindow(label, window) {
        if (!window || typeof window !== 'object') {
            return `${label}: unavailable`;
        }
        const usedPercent = Number(window.usedPercent);
        const remainingPercent = Number.isFinite(usedPercent)
            ? Math.max(0, 100 - Math.trunc(usedPercent))
            : null;
        const duration = Number.isFinite(Number(window.windowDurationMins))
            ? `${Math.trunc(Number(window.windowDurationMins))}m`
            : 'unknown';
        const resetAt = LLMClient.#formatEpochTimestamp(Number(window.resetsAt));
        return `${label}: used=${Number.isFinite(usedPercent) ? `${Math.trunc(usedPercent)}%` : 'unknown'}`
            + `${remainingPercent === null ? '' : ` remaining~=${remainingPercent}%`}`
            + ` window=${duration} reset=${resetAt}`;
    }

    static #getCodexRateLimitBuckets(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            return [];
        }
        const buckets = snapshot.rateLimitsByLimitId && typeof snapshot.rateLimitsByLimitId === 'object'
            ? Object.entries(snapshot.rateLimitsByLimitId)
            : [];
        if (buckets.length) {
            return buckets;
        }
        if (snapshot.rateLimits && typeof snapshot.rateLimits === 'object') {
            return [['default', snapshot.rateLimits]];
        }
        return [];
    }

    static #normalizeCodexBucketSelector(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    static #selectPreferredCodexRateLimitBucket(snapshot, { model = '', aiConfig = null } = {}) {
        const buckets = LLMClient.#getCodexRateLimitBuckets(snapshot);
        if (!buckets.length) {
            return null;
        }

        const requestedModel = typeof model === 'string' && model.trim()
            ? model.trim()
            : (typeof aiConfig?.model === 'string' ? aiConfig.model.trim() : '');
        const normalizedRequestedModel = LLMClient.#normalizeCodexBucketSelector(requestedModel);
        const genericCodexNames = new Set(['codex', 'gpt5codex', 'gpt54codex', 'gpt54minicodex']);

        const matchBucket = (predicate) => {
            for (const [bucketKey, bucketValue] of buckets) {
                if (!bucketValue || typeof bucketValue !== 'object') {
                    continue;
                }
                if (predicate(bucketKey, bucketValue)) {
                    return [bucketKey, bucketValue];
                }
            }
            return null;
        };

        if (normalizedRequestedModel) {
            const exactMatch = matchBucket((bucketKey, bucketValue) => {
                const candidates = [
                    bucketKey,
                    bucketValue.limitId,
                    bucketValue.limitName
                ].map(entry => LLMClient.#normalizeCodexBucketSelector(entry));
                return candidates.includes(normalizedRequestedModel);
            });
            if (exactMatch) {
                return exactMatch;
            }
        }

        const genericCodexMatch = matchBucket((bucketKey, bucketValue) => {
            const candidates = [
                bucketKey,
                bucketValue.limitId,
                bucketValue.limitName
            ].map(entry => LLMClient.#normalizeCodexBucketSelector(entry));
            return candidates.some(candidate => genericCodexNames.has(candidate));
        });
        if (genericCodexMatch) {
            return genericCodexMatch;
        }

        return buckets[0];
    }

    static #formatSingleCodexRateLimitBucket(bucketKey, bucketValue) {
        const label = bucketValue?.limitName || bucketValue?.limitId || bucketKey;
        const plan = bucketValue?.planType ? `plan=${bucketValue.planType}` : 'plan=unknown';
        const credits = (() => {
            const snapshotCredits = bucketValue?.credits;
            if (!snapshotCredits || typeof snapshotCredits !== 'object') {
                return 'credits=unavailable';
            }
            if (snapshotCredits.unlimited === true) {
                return 'credits=unlimited';
            }
            if (snapshotCredits.hasCredits === false) {
                return 'credits=none';
            }
            if (typeof snapshotCredits.balance === 'string' && snapshotCredits.balance.trim()) {
                return `credits=${snapshotCredits.balance.trim()}`;
            }
            return 'credits=available';
        })();
        return `${label} { ${plan}; ${credits}; ${LLMClient.#formatCodexRateLimitWindow('primary', bucketValue?.primary)}; `
            + `${LLMClient.#formatCodexRateLimitWindow('secondary', bucketValue?.secondary)} }`;
    }

    static #formatCodexRateLimits(snapshot, { model = '', aiConfig = null } = {}) {
        if (!snapshot || typeof snapshot !== 'object') {
            return 'rate limits unavailable';
        }
        const selectedBucket = LLMClient.#selectPreferredCodexRateLimitBucket(snapshot, { model, aiConfig });
        if (!selectedBucket) {
            return 'rate limits unavailable';
        }
        const [bucketKey, bucketValue] = selectedBucket;
        return LLMClient.#formatSingleCodexRateLimitBucket(bucketKey, bucketValue);
    }

    static #buildCodexQuotaChatEntry(snapshot, { model = '', aiConfig = null } = {}) {
        const selectedBucket = LLMClient.#selectPreferredCodexRateLimitBucket(snapshot, { model, aiConfig });
        if (!selectedBucket) {
            return null;
        }

        const [bucketKey, bucketValue] = selectedBucket;
        if (!bucketValue || typeof bucketValue !== 'object') {
            return null;
        }

        const label = bucketValue.limitName || bucketValue.limitId || bucketKey || 'Codex';
        const primaryWindow = bucketValue.primary && typeof bucketValue.primary === 'object'
            ? bucketValue.primary
            : null;
        const usedPercent = Number(primaryWindow?.usedPercent);
        const remainingPercent = Number.isFinite(usedPercent)
            ? Math.max(0, 100 - Math.trunc(usedPercent))
            : null;
        const resetAtRaw = Number(primaryWindow?.resetsAt);
        const credits = bucketValue.credits && typeof bucketValue.credits === 'object'
            ? bucketValue.credits
            : null;
        const secondaryWindow = bucketValue.secondary && typeof bucketValue.secondary === 'object'
            ? bucketValue.secondary
            : null;
        const creditsLine = LLMClient.#buildCodexCreditsLine(credits);
        const primaryLine = LLMClient.#buildCodexQuotaWindowLine('Primary', primaryWindow, { includeDate: false });
        const secondaryLine = LLMClient.#buildCodexQuotaWindowLine('Secondary', secondaryWindow, { includeDate: true });
        const summaryItems = [creditsLine, primaryLine, secondaryLine]
            .filter(line => typeof line === 'string' && line.trim())
            .map(line => ({
                icon: '•',
                text: line.trim(),
                category: 'status'
            }));
        if (!summaryItems.length) {
            return null;
        }

        const metadata = {
            excludeFromBaseContextHistory: true,
            codexQuotaSnapshot: {
                limitId: bucketValue.limitId || null,
                limitName: bucketValue.limitName || label,
                remainingPercent,
                usedPercent: Number.isFinite(usedPercent) ? Math.trunc(usedPercent) : null,
                creditsBalance: typeof credits?.balance === 'string' ? credits.balance.trim() : null,
                resetAt: Number.isFinite(resetAtRaw) ? LLMClient.#formatEpochTimestamp(resetAtRaw) : null,
                primary: primaryWindow ? {
                    remainingPercent,
                    usedPercent: Number.isFinite(usedPercent) ? Math.trunc(usedPercent) : null,
                    resetAt: Number.isFinite(resetAtRaw) ? LLMClient.#formatEpochTimestamp(resetAtRaw) : null
                } : null,
                secondary: secondaryWindow ? {
                    remainingPercent: Number.isFinite(Number(secondaryWindow.usedPercent))
                        ? Math.max(0, 100 - Math.trunc(Number(secondaryWindow.usedPercent)))
                        : null,
                    usedPercent: Number.isFinite(Number(secondaryWindow.usedPercent))
                        ? Math.trunc(Number(secondaryWindow.usedPercent))
                        : null,
                    resetAt: Number.isFinite(Number(secondaryWindow.resetsAt))
                        ? LLMClient.#formatEpochTimestamp(Number(secondaryWindow.resetsAt))
                        : null
                } : null
            }
        };

        return {
            role: 'assistant',
            type: 'status-summary',
            content: summaryItems.map(item => item.text).join('\n'),
            summaryTitle: '🌀 Codex Quota',
            summaryItems,
            timestamp: new Date().toISOString(),
            metadata
        };
    }

    static #appendCodexQuotaChatEntry({ snapshot = null, clientId = null, model = '', aiConfig = null } = {}) {
        if (!snapshot || typeof snapshot !== 'object') {
            return null;
        }
        if (typeof Globals?.appendChatEntry !== 'function') {
            throw new Error('Globals.appendChatEntry is not available.');
        }
        const entry = LLMClient.#buildCodexQuotaChatEntry(snapshot, { model, aiConfig });
        if (!entry) {
            return null;
        }
        return Globals.appendChatEntry(entry, {
            clientId: typeof clientId === 'string' && clientId.trim() ? clientId.trim() : null,
            emitClientRefresh: true,
            refreshPayload: {
                reason: 'codex_quota_check'
            }
        });
    }

    static #consumeCodexQuotaTurn(metadata = null) {
        if (!metadata || typeof metadata !== 'object') {
            return false;
        }
        const explicitCount = metadata.__codexQuotaCountAsTurn;
        if (explicitCount !== true) {
            return false;
        }
        const turnKey = typeof metadata.__codexQuotaTurnKey === 'string'
            ? metadata.__codexQuotaTurnKey.trim()
            : '';
        if (!turnKey) {
            throw new Error('Codex quota turn counting requires metadata.__codexQuotaTurnKey when __codexQuotaCountAsTurn is true.');
        }
        if (LLMClient.#codexQuotaTurnKeys.has(turnKey)) {
            return false;
        }
        LLMClient.#codexQuotaTurnKeys.add(turnKey);
        LLMClient.#codexQuotaTurnKeyQueue.push(turnKey);
        const maxTrackedTurnKeys = 1000;
        while (LLMClient.#codexQuotaTurnKeyQueue.length > maxTrackedTurnKeys) {
            const expiredKey = LLMClient.#codexQuotaTurnKeyQueue.shift();
            if (expiredKey) {
                LLMClient.#codexQuotaTurnKeys.delete(expiredKey);
            }
        }
        return true;
    }

    static async #reportCodexUsage({
        metadataLabel = '',
        model = '',
        usage = null,
        aiConfig = null,
        attemptNumber = 1,
        clientId = null,
        metadata = null
    } = {}) {
        if (!usage || typeof usage !== 'object') {
            return;
        }
        const inputTokens = Number(usage.input_tokens);
        const cachedInputTokens = Number(usage.cached_input_tokens);
        const outputTokens = Number(usage.output_tokens);
        const totalTokens = Number(usage.total_tokens);
        if (
            !Number.isFinite(inputTokens)
            && !Number.isFinite(cachedInputTokens)
            && !Number.isFinite(outputTokens)
            && !Number.isFinite(totalTokens)
        ) {
            return;
        }

        LLMClient.#codexUsageStats.promptCount += 1;
        const promptIndex = LLMClient.#codexUsageStats.promptCount;
        const label = typeof metadataLabel === 'string' && metadataLabel.trim()
            ? metadataLabel.trim()
            : 'unknown';
        const modelLabel = typeof model === 'string' && model.trim() ? model.trim() : 'codex';
        console.log(
            `[codex usage ${promptIndex}] prompt=${label} attempt=${attemptNumber} model=${modelLabel}`
            + ` input=${LLMClient.#formatTokenCount(inputTokens)}`
            + ` cached=${LLMClient.#formatTokenCount(cachedInputTokens)}`
            + ` output=${LLMClient.#formatTokenCount(outputTokens)}`
            + ` total=${LLMClient.#formatTokenCount(totalTokens)}`
        );

        if (!LLMClient.#consumeCodexQuotaTurn(metadata)) {
            return;
        }

        LLMClient.#codexUsageStats.quotaTurnCount += 1;
        const quotaTurnIndex = LLMClient.#codexUsageStats.quotaTurnCount;
        if (quotaTurnIndex % 5 !== 0) {
            return;
        }

        try {
            const rateLimits = await CodexBridgeClient.readRateLimits({ aiConfig });
            console.log(`[codex quota turn ${quotaTurnIndex}] ${LLMClient.#formatCodexRateLimits(rateLimits, { model, aiConfig })}`);
            try {
                LLMClient.#appendCodexQuotaChatEntry({
                    snapshot: rateLimits,
                    clientId,
                    model,
                    aiConfig
                });
            } catch (error) {
                console.warn(`[codex quota turn ${quotaTurnIndex}] chat notice failed: ${error?.message || error}`);
            }
        } catch (error) {
            console.warn(`[codex quota turn ${quotaTurnIndex}] failed: ${error?.message || error}`);
        }
    }

    static #trackStreamEnd(id) {
        if (!id) return;
        if (LLMClient.#streamProgress.broadcastTimer) {
            LLMClient.#broadcastProgress(false, { force: true });
        }
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

    static #broadcastProgress(isFinal = false, { force = false } = {}) {
        if (isFinal || force) {
            LLMClient.#clearPendingProgressBroadcast();
        }
        const hub = Globals?.realtimeHub;
        if (!hub || typeof hub.emit !== 'function') {
            return;
        }
        const now = Date.now();
        const shouldBroadcast = LLMClient.#streamProgress.active.size > 0
            || LLMClient.#streamProgress.lastBroadcastHadEntries
            || isFinal;
        if (!shouldBroadcast) {
            return;
        }
        if (!isFinal && !force) {
            const elapsedSinceBroadcast = now - LLMClient.#streamProgress.lastBroadcastTs;
            if (
                LLMClient.#streamProgress.lastBroadcastTs > 0
                && elapsedSinceBroadcast < PROMPT_PROGRESS_BROADCAST_INTERVAL_MS
            ) {
                LLMClient.#scheduleProgressBroadcast(
                    PROMPT_PROGRESS_BROADCAST_INTERVAL_MS - elapsedSinceBroadcast,
                );
                return;
            }
        }
        const entries = Array.from(LLMClient.#streamProgress.active.entries()).map(([id, entry]) => {
            const deadline = entry.continueDeadline || entry.startDeadline || null;
            const timeoutSeconds = deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : null;
            const latencyMs = entry.firstByteTs ? (entry.firstByteTs - entry.startTs) : null;
            const elapsedAfterFirst = entry.firstByteTs ? Math.max(1, (now - entry.firstByteTs) / 1000) : null;
            const receivedCount = Number.isFinite(entry.receivedCount) ? entry.receivedCount : entry.bytes;
            const receivedUnit = entry.receivedUnit === 'characters' ? 'characters' : 'bytes';
            const avgReceivedPerSecond = elapsedAfterFirst ? Math.round(receivedCount / elapsedAfterFirst) : null;
            return {
                id,
                label: entry.label,
                model: entry.model || null,
                bytes: entry.bytes,
                receivedCount,
                receivedUnit,
                promptText: typeof entry.promptText === 'string' ? entry.promptText : '',
                previewText: typeof entry.previewText === 'string' ? entry.previewText : '',
                seconds: Math.round((now - entry.startTs) / 1000),
                timeoutSeconds,
                retries: entry.retries ?? 0,
                latencyMs,
                avgBps: avgReceivedPerSecond,
                avgReceivedPerSecond,
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
            LLMClient.#streamProgress.lastBroadcastTs = now;
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

    static resolveBackend(aiConfigOverride = null) {
        const config = aiConfigOverride || LLMClient.ensureAiConfig();
        return CodexBridgeClient.normalizeBackend(config?.backend);
    }

    static getConfigurationErrors(aiConfigOverride = null) {
        const config = aiConfigOverride === null
            ? Globals?.config?.ai
            : aiConfigOverride;
        return CodexBridgeClient.getConfigurationErrors(config);
    }

    static isConfigured(aiConfigOverride = null) {
        try {
            return LLMClient.getConfigurationErrors(aiConfigOverride).length === 0;
        } catch (_) {
            return false;
        }
    }

    static getMaxConcurrent(aiConfigOverride = null) {
        const config = aiConfigOverride || LLMClient.ensureAiConfig();
        const backend = LLMClient.resolveBackend(config);
        if (backend === CodexBridgeClient.backendName) {
            return CodexBridgeClient.getMaxConcurrent(config);
        }
        const raw = Number(config?.max_concurrent_requests);
        if (Number.isInteger(raw) && raw > 0) {
            return raw;
        }
        return 1;
    }

    static #hashSecret(value) {
        return createHash('sha256').update(String(value || '')).digest('hex');
    }

    static #normalizeOAuthKey(aiConfig) {
        if (!aiConfig || typeof aiConfig !== 'object') {
            return null;
        }
        const raw = aiConfig['oauth-key'] ?? aiConfig.oauthKey;
        if (raw === undefined || raw === null || raw === '') {
            return null;
        }
        if (typeof raw !== 'string') {
            throw new Error('ai.oauth-key must be a string when configured.');
        }
        const trimmed = raw.trim();
        if (!trimmed) {
            return null;
        }
        return trimmed;
    }

    static #normalizeOAuthUrl(aiConfig) {
        if (!aiConfig || typeof aiConfig !== 'object') {
            return null;
        }
        const raw = aiConfig['oauth-url'] ?? aiConfig.oauthUrl;
        if (raw === undefined || raw === null || raw === '') {
            return null;
        }
        if (typeof raw !== 'string') {
            throw new Error('ai.oauth-url must be a string when configured.');
        }
        const trimmed = raw.trim();
        if (!trimmed) {
            return null;
        }
        return trimmed;
    }

    static #normalizeOAuthClientId(aiConfig) {
        if (!aiConfig || typeof aiConfig !== 'object') {
            return null;
        }
        const raw = aiConfig['oauth-client-id'] ?? aiConfig.oauthClientId;
        if (raw === undefined || raw === null || raw === '') {
            return null;
        }
        if (typeof raw !== 'string') {
            throw new Error('ai.oauth-client-id must be a string when configured.');
        }
        const trimmed = raw.trim();
        return trimmed || null;
    }

    static #getOAuthCacheDir() {
        const baseDir = Globals?.baseDir || process.cwd();
        const cacheDir = path.join(baseDir, 'tmp', 'oauth');
        fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
        try {
            fs.chmodSync(cacheDir, 0o700);
        } catch (_) {
            // Some filesystems do not support chmod; the write path below still uses private file modes.
        }
        return cacheDir;
    }

    static #getOAuthCacheKey({ tokenUrl, refreshToken }) {
        return LLMClient.#hashSecret(`${tokenUrl || ''}\n${refreshToken || ''}`);
    }

    static #getOAuthCachePath(cacheKey) {
        return path.join(LLMClient.#getOAuthCacheDir(), `${cacheKey}.json`);
    }

    static #buildOAuthRefreshHeaders(effectiveHeaders = {}) {
        const headers = {};
        if (effectiveHeaders && typeof effectiveHeaders === 'object') {
            for (const [key, value] of Object.entries(effectiveHeaders)) {
                const normalized = String(key || '').trim();
                const lower = normalized.toLowerCase();
                if (!normalized || lower === 'authorization' || lower === 'content-type' || lower === 'content-length') {
                    continue;
                }
                if (typeof value === 'string') {
                    headers[normalized] = value;
                }
            }
        }
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        return headers;
    }

    static #loadOAuthState(cacheKey, bootstrapRefreshToken) {
        const cached = LLMClient.#oauthStates.get(cacheKey);
        if (cached) {
            return cached;
        }

        const cachePath = LLMClient.#getOAuthCachePath(cacheKey);
        let state = {
            accessToken: '',
            refreshToken: bootstrapRefreshToken,
            expiresAt: 0,
            expiresIn: 0,
            tokenType: 'Bearer',
            scope: ''
        };
        try {
            if (fs.existsSync(cachePath)) {
                const raw = fs.readFileSync(cachePath, 'utf8');
                const payload = JSON.parse(raw);
                if (payload && typeof payload === 'object') {
                    state = {
                        accessToken: typeof payload.accessToken === 'string'
                            ? payload.accessToken
                            : (typeof payload.access_token === 'string' ? payload.access_token : ''),
                        refreshToken: typeof payload.refreshToken === 'string'
                            ? payload.refreshToken
                            : (typeof payload.refresh_token === 'string' ? payload.refresh_token : bootstrapRefreshToken),
                        expiresAt: Number(payload.expiresAt ?? payload.expires_at) || 0,
                        expiresIn: Number(payload.expiresIn ?? payload.expires_in) || 0,
                        tokenType: typeof payload.tokenType === 'string'
                            ? payload.tokenType
                            : (typeof payload.token_type === 'string' ? payload.token_type : 'Bearer'),
                        scope: typeof payload.scope === 'string' ? payload.scope : ''
                    };
                }
            }
        } catch (error) {
            console.warn(`Failed to read OAuth cache; refreshing from configured key: ${error.message}`);
        }

        if (!state.refreshToken) {
            state.refreshToken = bootstrapRefreshToken;
        }
        LLMClient.#oauthStates.set(cacheKey, state);
        return state;
    }

    static #saveOAuthState(cacheKey, bootstrapRefreshToken, state) {
        const cachePath = LLMClient.#getOAuthCachePath(cacheKey);
        const tmpPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
        const payload = {
            accessToken: state.accessToken || '',
            refreshToken: state.refreshToken || bootstrapRefreshToken,
            expiresAt: Number(state.expiresAt) || 0,
            expiresIn: Number(state.expiresIn) || 0,
            tokenType: state.tokenType || 'Bearer',
            scope: state.scope || ''
        };
        fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
        try {
            fs.chmodSync(tmpPath, 0o600);
        } catch (_) {
            // Non-POSIX filesystems may ignore chmod after creation.
        }
        fs.renameSync(tmpPath, cachePath);
        LLMClient.#oauthStates.set(cacheKey, payload);
    }

    static #invalidateOAuthAccessToken(oauthConfig) {
        if (!oauthConfig?.refreshToken || !oauthConfig?.tokenUrl) {
            return;
        }
        const cacheKey = LLMClient.#getOAuthCacheKey(oauthConfig);
        const state = LLMClient.#loadOAuthState(cacheKey, oauthConfig.refreshToken);
        const invalidated = {
            ...state,
            accessToken: '',
            expiresAt: 0
        };
        LLMClient.#saveOAuthState(cacheKey, oauthConfig.refreshToken, invalidated);
    }

    static #isOAuthStateFresh(state) {
        if (!state?.accessToken) {
            return false;
        }
        const expiresAt = Number(state.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
            return false;
        }
        const expiresIn = Number(state.expiresIn);
        const thresholdSeconds = Number.isFinite(expiresIn) && expiresIn > 0
            ? Math.max(OAUTH_REFRESH_THRESHOLD_SECONDS, expiresIn * 0.5)
            : OAUTH_REFRESH_THRESHOLD_SECONDS;
        return expiresAt - Date.now() >= thresholdSeconds * 1000;
    }

    static async #refreshOAuthState(oauthConfig, currentState, effectiveHeaders = {}) {
        const refreshToken = currentState?.refreshToken || oauthConfig?.refreshToken;
        if (!refreshToken) {
            throw new Error('OAuth refresh token is missing.');
        }

        const data = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        });
        if (oauthConfig?.clientId) {
            data.set('client_id', oauthConfig.clientId);
        }
        const authHeaders = {
            ...LLMClient.#buildOAuthRefreshHeaders(effectiveHeaders)
        };

        let response;
        try {
            response = await axios.post(
                oauthConfig.tokenUrl,
                data.toString(),
                {
                    headers: authHeaders,
                    timeout: 30000,
                    validateStatus: () => true
                }
            );
        } catch (error) {
            throw new Error(`OAuth token refresh request failed: ${error.message}`);
        }

        const payload = typeof response.data === 'string'
            ? (() => {
                try {
                    return JSON.parse(response.data);
                } catch (_) {
                    return {};
                }
            })()
            : (response.data || {});

        if (response.status === 401 || response.status === 403) {
            const detail = typeof payload.error_description === 'string' && payload.error_description.trim()
                ? `: ${payload.error_description.trim()}`
                : '';
            throw new Error(`OAuth credentials rejected (HTTP ${response.status})${detail}`);
        }
        if (response.status !== 200) {
            const detail = typeof payload.error_description === 'string' && payload.error_description.trim()
                ? `: ${payload.error_description.trim()}`
                : '';
            throw new Error(`OAuth token refresh failed (HTTP ${response.status})${detail}`);
        }
        if (!payload || typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
            throw new Error('OAuth token refresh response did not include an access token.');
        }

        const expiresIn = Number(payload.expires_in) || 0;
        return {
            accessToken: payload.access_token.trim(),
            refreshToken: typeof payload.refresh_token === 'string' && payload.refresh_token.trim()
                ? payload.refresh_token.trim()
                : refreshToken,
            expiresAt: expiresIn > 0 ? Date.now() + (expiresIn * 1000) : 0,
            expiresIn,
            tokenType: typeof payload.token_type === 'string' && payload.token_type.trim()
                ? payload.token_type.trim()
                : 'Bearer',
            scope: typeof payload.scope === 'string' ? payload.scope : ''
        };
    }

    static async #resolveOAuthAccessToken(oauthConfig, effectiveHeaders = {}) {
        const cacheKey = LLMClient.#getOAuthCacheKey(oauthConfig);
        const currentState = LLMClient.#loadOAuthState(cacheKey, oauthConfig.refreshToken);
        if (LLMClient.#isOAuthStateFresh(currentState)) {
            return currentState.accessToken;
        }

        const existingRefresh = LLMClient.#oauthRefreshPromises.get(cacheKey);
        if (existingRefresh) {
            return existingRefresh;
        }

        const refreshPromise = (async () => {
            const latestState = LLMClient.#loadOAuthState(cacheKey, oauthConfig.refreshToken);
            if (LLMClient.#isOAuthStateFresh(latestState)) {
                return latestState.accessToken;
            }
            const refreshed = await LLMClient.#refreshOAuthState(
                oauthConfig,
                latestState,
                effectiveHeaders
            );
            LLMClient.#saveOAuthState(cacheKey, oauthConfig.refreshToken, refreshed);
            return refreshed.accessToken;
        })();

        LLMClient.#oauthRefreshPromises.set(cacheKey, refreshPromise);
        try {
            return await refreshPromise;
        } finally {
            LLMClient.#oauthRefreshPromises.delete(cacheKey);
        }
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
            const filePath = path.join(logDir, `ERROR_${prefix}_${safeLabel}_${Date.now()}.log`);

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

    static #buildPromptCachebusterLine() {
        return `[cachebuster:${randomUUID()}]`;
    }

    static #isPromptCachebusterEnabled(rawValue) {
        if (rawValue === undefined) {
            return false;
        }
        if (rawValue === true || rawValue === false) {
            return rawValue;
        }
        throw new Error('AI cachebuster must be a boolean when configured.');
    }

    static #prependCachebusterToMessageContent(content, cachebusterLine) {
        if (typeof cachebusterLine !== 'string' || !cachebusterLine.trim()) {
            return content;
        }
        if (content === null || content === undefined) {
            return cachebusterLine;
        }
        if (typeof content === 'string') {
            return `${cachebusterLine}\n\n${content}`;
        }
        if (Array.isArray(content)) {
            return [
                { type: 'text', text: cachebusterLine },
                ...content
            ];
        }
        if (typeof content === 'object' && typeof content.text === 'string') {
            return {
                ...content,
                text: `${cachebusterLine}\n\n${content.text}`
            };
        }
        throw new Error(
            'Prompt cachebuster requires the final user message content to be a string, '
            + 'an array of content parts, or an object with a text field.'
        );
    }

    static #applyPromptCachebuster(messages, enabled = false) {
        if (enabled !== true || !Array.isArray(messages) || messages.length === 0) {
            return messages;
        }

        let finalUserMessageIndex = -1;
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const role = typeof messages[index]?.role === 'string'
                ? messages[index].role.trim().toLowerCase()
                : '';
            if (role === 'user') {
                finalUserMessageIndex = index;
                break;
            }
        }

        if (finalUserMessageIndex < 0) {
            return messages;
        }

        const targetMessage = messages[finalUserMessageIndex];
        const modifiedMessages = messages.slice();
        modifiedMessages[finalUserMessageIndex] = {
            ...targetMessage,
            content: LLMClient.#prependCachebusterToMessageContent(
                targetMessage?.content,
                LLMClient.#buildPromptCachebusterLine()
            )
        };
        return modifiedMessages;
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

    static resetForcedOutputState() {
        LLMClient.#forcedOutputFixtureSource = null;
        LLMClient.#forcedOutputFixtureData = null;
        LLMClient.#forcedOutputLabelCounters = new Map();
    }

    static #resolveForcedOutputFixturePath() {
        const envPath = typeof process.env.LLM_FORCE_OUTPUTS_FILE === 'string'
            ? process.env.LLM_FORCE_OUTPUTS_FILE.trim()
            : '';
        if (envPath) {
            return envPath;
        }
        const configPath = typeof Globals?.config?.ai?.force_outputs_file === 'string'
            ? Globals.config.ai.force_outputs_file.trim()
            : '';
        return configPath || '';
    }

    static #loadForcedOutputFixtureFromDisk(sourcePath) {
        const fs = require('fs');
        const path = require('path');
        const baseDir = Globals?.baseDir || process.cwd();
        const resolvedPath = path.isAbsolute(sourcePath)
            ? sourcePath
            : path.join(baseDir, sourcePath);
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Forced output fixture file not found: ${resolvedPath}`);
        }
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new Error(`Forced output fixture JSON is invalid (${resolvedPath}): ${error.message}`);
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(`Forced output fixture must be a JSON object: ${resolvedPath}`);
        }
        const groupsSource = (() => {
            if (parsed.byMetadataLabel && typeof parsed.byMetadataLabel === 'object' && !Array.isArray(parsed.byMetadataLabel)) {
                return parsed.byMetadataLabel;
            }
            if (parsed.labels && typeof parsed.labels === 'object' && !Array.isArray(parsed.labels)) {
                return parsed.labels;
            }
            if (parsed.outputs && typeof parsed.outputs === 'object' && !Array.isArray(parsed.outputs)) {
                return parsed.outputs;
            }
            const excluded = new Set(['strict', 'description']);
            const inferred = {};
            for (const [key, value] of Object.entries(parsed)) {
                if (excluded.has(key)) {
                    continue;
                }
                inferred[key] = value;
            }
            return inferred;
        })();
        if (!groupsSource || typeof groupsSource !== 'object' || Array.isArray(groupsSource)) {
            throw new Error(`Forced output fixture must define object groups under byMetadataLabel/labels/outputs: ${resolvedPath}`);
        }

        const groups = new Map();
        for (const [label, entries] of Object.entries(groupsSource)) {
            if (!Array.isArray(entries)) {
                throw new Error(`Forced output fixture label "${label}" must be an array in ${resolvedPath}.`);
            }
            groups.set(String(label), entries);
        }
        if (!groups.size) {
            throw new Error(`Forced output fixture has no label entries: ${resolvedPath}`);
        }

        return {
            sourcePath,
            resolvedPath,
            strict: parsed.strict !== false,
            groups
        };
    }

    static #getForcedOutputFixture() {
        const sourcePath = LLMClient.#resolveForcedOutputFixturePath();
        if (!sourcePath) {
            return null;
        }
        if (LLMClient.#forcedOutputFixtureData && LLMClient.#forcedOutputFixtureSource === sourcePath) {
            return LLMClient.#forcedOutputFixtureData;
        }
        const fixture = LLMClient.#loadForcedOutputFixtureFromDisk(sourcePath);
        LLMClient.#forcedOutputFixtureSource = sourcePath;
        LLMClient.#forcedOutputFixtureData = fixture;
        LLMClient.#forcedOutputLabelCounters = new Map();
        return fixture;
    }

    static #resolveForcedOutputFromFixture(metadataLabel = '') {
        const fixture = LLMClient.#getForcedOutputFixture();
        if (!fixture) {
            return null;
        }

        const rawLabel = typeof metadataLabel === 'string' ? metadataLabel.trim() : '';
        const normalizedLabel = LLMClient.#normalizePromptLabel(rawLabel) || 'unknown';
        const preferredLabels = [];
        if (rawLabel) {
            preferredLabels.push(rawLabel);
        }
        preferredLabels.push(normalizedLabel);
        if (!preferredLabels.includes('unknown')) {
            preferredLabels.push('unknown');
        }

        let resolvedLabel = null;
        let bucket = null;
        for (const key of preferredLabels) {
            if (fixture.groups.has(key)) {
                resolvedLabel = key;
                bucket = fixture.groups.get(key);
                break;
            }
        }

        const resolveGroupedBucket = (baseLabel) => {
            const normalizedBase = typeof baseLabel === 'string' ? baseLabel.trim() : '';
            if (!normalizedBase) {
                return null;
            }
            const prefix = `${normalizedBase}_group_`;
            const groupedEntries = [];
            for (const [key, entries] of fixture.groups.entries()) {
                if (!key.startsWith(prefix)) {
                    continue;
                }
                const suffix = key.slice(prefix.length).trim();
                const order = Number.parseInt(suffix, 10);
                groupedEntries.push({
                    key,
                    entries,
                    hasNumericOrder: Number.isInteger(order),
                    order: Number.isInteger(order) ? order : Number.MAX_SAFE_INTEGER,
                    suffix
                });
            }

            if (!groupedEntries.length) {
                return null;
            }

            groupedEntries.sort((left, right) => {
                if (left.hasNumericOrder && right.hasNumericOrder && left.order !== right.order) {
                    return left.order - right.order;
                }
                if (left.hasNumericOrder !== right.hasNumericOrder) {
                    return left.hasNumericOrder ? -1 : 1;
                }
                return left.key.localeCompare(right.key);
            });

            const flattened = groupedEntries.flatMap(entry => entry.entries);
            return flattened.length ? flattened : null;
        };

        if (!bucket) {
            const promptPrefixedKeys = [];
            for (const key of preferredLabels) {
                if (!key || key === 'unknown') {
                    continue;
                }
                promptPrefixedKeys.push(`prompt_${key}`);
            }
            for (const key of promptPrefixedKeys) {
                if (fixture.groups.has(key)) {
                    resolvedLabel = key;
                    bucket = fixture.groups.get(key);
                    break;
                }
            }
        }

        if (!bucket) {
            for (const key of preferredLabels) {
                const groupedBucket = resolveGroupedBucket(key);
                if (groupedBucket) {
                    resolvedLabel = key;
                    bucket = groupedBucket;
                    break;
                }
            }
        }

        if (!bucket) {
            if (fixture.strict) {
                throw new Error(`No forced output bucket configured for metadataLabel "${rawLabel || 'unknown'}" (normalized="${normalizedLabel}").`);
            }
            return null;
        }

        const index = LLMClient.#forcedOutputLabelCounters.get(resolvedLabel) || 0;
        if (index >= bucket.length) {
            if (fixture.strict) {
                throw new Error(`Forced output bucket "${resolvedLabel}" is exhausted at index ${index} (total=${bucket.length}).`);
            }
            return null;
        }

        const entry = bucket[index];
        LLMClient.#forcedOutputLabelCounters.set(resolvedLabel, index + 1);
        if (typeof entry !== 'string' && (!entry || typeof entry !== 'object')) {
            throw new Error(`Forced output entry "${resolvedLabel}" index ${index} must be a string or object.`);
        }
        return entry;
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

    static #resolveForcedOutput(forceOutput, {
        sourceLabel = 'forced output',
        requestedModel = null
    } = {}) {
        let content = '';
        let rawToolCalls = [];
        let usage = null;
        let finishReason = null;
        let fallbackModel = requestedModel;
        let fallbackId = null;
        let rawResponseData = null;

        if (typeof forceOutput === 'string') {
            content = forceOutput;
            finishReason = 'stop';
        } else if (forceOutput && typeof forceOutput === 'object') {
            if (Array.isArray(forceOutput.choices)) {
                rawResponseData = forceOutput;
                const firstChoice = forceOutput.choices[0] || null;
                const responseMessage = firstChoice?.message || null;
                content = LLMClient.#extractTextContent(responseMessage?.content);
                rawToolCalls = Array.isArray(responseMessage?.tool_calls)
                    ? responseMessage.tool_calls
                    : [];
                usage = forceOutput?.usage && typeof forceOutput.usage === 'object'
                    ? { ...forceOutput.usage }
                    : null;
                finishReason = typeof firstChoice?.finish_reason === 'string'
                    ? firstChoice.finish_reason
                    : null;
                if (typeof forceOutput.model === 'string' && forceOutput.model.trim()) {
                    fallbackModel = forceOutput.model.trim();
                }
                if (typeof forceOutput.id === 'string' && forceOutput.id.trim()) {
                    fallbackId = forceOutput.id.trim();
                }
            } else {
                const directMessage = forceOutput.message && typeof forceOutput.message === 'object'
                    ? forceOutput.message
                    : null;
                if (forceOutput.content !== undefined) {
                    content = LLMClient.#extractTextContent(forceOutput.content);
                } else {
                    content = LLMClient.#extractTextContent(directMessage?.content);
                }
                if (Array.isArray(forceOutput.tool_calls)) {
                    rawToolCalls = forceOutput.tool_calls;
                } else if (Array.isArray(forceOutput.toolCalls)) {
                    rawToolCalls = forceOutput.toolCalls;
                } else if (Array.isArray(directMessage?.tool_calls)) {
                    rawToolCalls = directMessage.tool_calls;
                } else {
                    rawToolCalls = [];
                }
                usage = forceOutput?.usage && typeof forceOutput.usage === 'object'
                    ? { ...forceOutput.usage }
                    : null;
                if (typeof forceOutput.finish_reason === 'string') {
                    finishReason = forceOutput.finish_reason;
                } else if (typeof forceOutput.finishReason === 'string') {
                    finishReason = forceOutput.finishReason;
                }
                if (typeof forceOutput.model === 'string' && forceOutput.model.trim()) {
                    fallbackModel = forceOutput.model.trim();
                }
                if (typeof forceOutput.id === 'string' && forceOutput.id.trim()) {
                    fallbackId = forceOutput.id.trim();
                }
            }
        } else {
            throw new Error('forceOutput must be a string or an object when provided.');
        }

        const toolCalls = LLMClient.#normalizeToolCalls(rawToolCalls, {
            sourceLabel,
            requireJsonArguments: true
        });
        const normalizedResponseData = LLMClient.#buildNormalizedResponseData({
            rawResponseData,
            fallbackModel,
            fallbackId,
            content,
            toolCalls,
            finishReason,
            usage
        });

        return {
            normalizedResponseData,
            content: LLMClient.#extractTextContent(
                normalizedResponseData?.choices?.[0]?.message?.content
            ),
            toolCalls,
            usage: normalizedResponseData?.usage && typeof normalizedResponseData.usage === 'object'
                ? { ...normalizedResponseData.usage }
                : null,
            finishReason: normalizedResponseData?.choices?.[0]?.finish_reason || null
        };
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
        errorLogLabel = '',
        metadata,
        retryAttempts = null,
        headers = {},
        additionalPayload = {},
        onResponse = null,
        validateXML = true,
        validateXMLStrict = false,
        requiredTags = [],
        requiredRegex = null,
        waitAfterError = null,
        waitAfterRateLimitError = null,
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
        forceOutput = null,
        logStreamChunksToConsole = false,
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
        const resolvedErrorLogLabel = (() => {
            if (typeof errorLogLabel === 'string' && errorLogLabel.trim()) {
                return errorLogLabel.trim();
            }
            if (metadata && typeof metadata === 'object') {
                const promptName = typeof metadata.promptName === 'string'
                    ? metadata.promptName.trim()
                    : '';
                if (promptName) {
                    return promptName;
                }
                const promptType = typeof metadata.promptType === 'string'
                    ? metadata.promptType.trim()
                    : '';
                if (promptType) {
                    return promptType;
                }
            }
            return metadataLabel;
        })();
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
                validateXMLStrict,
                requiredTags,
                requiredRegex,
                waitAfterError,
                waitAfterRateLimitError,
                dumpReasoningToConsole,
                seed,
                topP,
                multimodal,
                forceOutput: forceOutput !== null && forceOutput !== undefined ? '[provided]' : null
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
            const resolvedForcedOutput = (forceOutput !== null && forceOutput !== undefined)
                ? forceOutput
                : LLMClient.#resolveForcedOutputFromFixture(metadataLabel);

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

            const resolveAttemptRuntime = async ({ attemptNumber = 0 } = {}) => {
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
                    log(`Applying AI model overrides for ${metadataLabel}${profileSummary}`);
                    for (const [key, value] of Object.entries(overrides)) {
                        if (key === 'custom_args') {
                            overrideCustomArgs = value;
                            continue;
                        }
                        if (key === 'headers') {
                            overrideHeaders = value;
                            continue;
                        }
                        aiConfig[key] = value;
                    }
                }

                const resolvedBackend = LLMClient.resolveBackend(aiConfig);
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
                const requestMessages = LLMClient.#applyPromptCachebuster(
                    messages,
                    LLMClient.#isPromptCachebusterEnabled(aiConfig.cachebuster)
                );
                payload.messages = requestMessages;

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
                payload.stream = resolvedBackend === CodexBridgeClient.backendName
                    ? false
                    : resolvedStream !== false;

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

                const configuredMaxConcurrent = resolvedBackend === CodexBridgeClient.backendName
                    ? CodexBridgeClient.getMaxConcurrent(aiConfig)
                    : LLMClient.getMaxConcurrent(aiConfig);
                const effectiveMaxConcurrent = Number.isInteger(maxConcurrent) && maxConcurrent > 0
                    ? maxConcurrent
                    : configuredMaxConcurrent;
                let resolvedWaitAfterError = 10;
                if (waitAfterError !== null && waitAfterError !== undefined) {
                    const explicitWaitAfterError = Number(waitAfterError);
                    if (!Number.isFinite(explicitWaitAfterError) || explicitWaitAfterError < 0) {
                        throw new Error('waitAfterError must be a non-negative number when provided.');
                    }
                    resolvedWaitAfterError = explicitWaitAfterError;
                } else if (Object.prototype.hasOwnProperty.call(aiConfig, 'waitAfterError')) {
                    const configuredWaitAfterError = Number(aiConfig.waitAfterError);
                    if (!Number.isFinite(configuredWaitAfterError) || configuredWaitAfterError < 0) {
                        throw new Error('AI waitAfterError must be a non-negative number when configured.');
                    }
                    resolvedWaitAfterError = configuredWaitAfterError;
                }
                let resolvedWaitAfterRateLimitError = resolvedWaitAfterError;
                if (waitAfterRateLimitError !== null && waitAfterRateLimitError !== undefined) {
                    const explicitRateLimitWait = Number(waitAfterRateLimitError);
                    if (!Number.isFinite(explicitRateLimitWait) || explicitRateLimitWait < 0) {
                        throw new Error('waitAfterRateLimitError must be a non-negative number when provided.');
                    }
                    resolvedWaitAfterRateLimitError = explicitRateLimitWait;
                } else if (Object.prototype.hasOwnProperty.call(aiConfig, 'waitAfterRateLimitError')) {
                    const configuredRateLimitWait = Number(aiConfig.waitAfterRateLimitError);
                    if (!Number.isFinite(configuredRateLimitWait) || configuredRateLimitWait < 0) {
                        throw new Error('AI waitAfterRateLimitError must be a non-negative number when configured.');
                    }
                    resolvedWaitAfterRateLimitError = configuredRateLimitWait;
                }
                const resolvedEndpoint = resolvedBackend === CodexBridgeClient.backendName
                    ? null
                    : LLMClient.resolveChatEndpoint(endpoint || aiConfig.endpoint);
                const oauthKey = resolvedBackend === CodexBridgeClient.backendName
                    ? null
                    : LLMClient.#normalizeOAuthKey(aiConfig);
                const oauthUrl = oauthKey ? LLMClient.#normalizeOAuthUrl(aiConfig) : null;
                const oauthClientId = oauthKey ? LLMClient.#normalizeOAuthClientId(aiConfig) : null;
                if (oauthKey && !oauthUrl) {
                    throw new Error('ai.oauth-url is required when ai.oauth-key is configured.');
                }
                const oauthConfig = oauthKey
                    ? { refreshToken: oauthKey, tokenUrl: oauthUrl, clientId: oauthClientId }
                    : null;
                const configuredRequestHeaders = {
                    ...effectiveHeaders,
                    ...headers
                };
                const resolvedApiKey = resolvedBackend === CodexBridgeClient.backendName
                    ? null
                    : (apiKey || (oauthConfig
                        ? await LLMClient.#resolveOAuthAccessToken(oauthConfig, configuredRequestHeaders)
                        : aiConfig.apiKey));
                if (resolvedBackend !== CodexBridgeClient.backendName && !resolvedApiKey) {
                    throw new Error('AI API key is not configured.');
                }

                const semaphoreKey = resolvedBackend === CodexBridgeClient.backendName
                    ? CodexBridgeClient.getSemaphoreKey(aiConfig, resolvedModel)
                    : `${oauthConfig ? `oauth:${LLMClient.#getOAuthCacheKey(oauthConfig)}` : (resolvedApiKey || 'no-key')}::${resolvedModel || 'no-model'}`;
                let resolvedTimeout = LLMClient.resolveTimeout(timeoutMs, timeoutScale);
                let baseStartTimeoutMs = Number.isFinite(aiConfig.stream_start_timeout)
                    ? aiConfig.stream_start_timeout * 1000
                    : 40000;
                let baseContinueTimeoutMs = Number.isFinite(aiConfig.stream_continue_timeout)
                    ? aiConfig.stream_continue_timeout * 1000
                    : 10000;
                const incrementStartTimeoutMs = Number.isFinite(aiConfig.increment_start_timeout)
                    ? aiConfig.increment_start_timeout * 1000
                    : 0;
                const incrementContinueTimeoutMs = Number.isFinite(aiConfig.increment_continue_timeout)
                    ? aiConfig.increment_continue_timeout * 1000
                    : 0;
                if (resolvedBackend === CodexBridgeClient.backendName) {
                    resolvedTimeout = CodexBridgeClient.resolveBridgeIdleTimeoutMs(aiConfig);
                    baseStartTimeoutMs = resolvedTimeout;
                    baseContinueTimeoutMs = resolvedTimeout;
                }
                const effectiveIncrementStartTimeoutMs = resolvedBackend === CodexBridgeClient.backendName
                    ? 0
                    : incrementStartTimeoutMs;
                const effectiveIncrementContinueTimeoutMs = resolvedBackend === CodexBridgeClient.backendName
                    ? 0
                    : incrementContinueTimeoutMs;
                const streamStartTimeoutMs = baseStartTimeoutMs + (effectiveIncrementStartTimeoutMs * attemptNumber);
                const streamContinueTimeoutMs = baseContinueTimeoutMs + (effectiveIncrementContinueTimeoutMs * attemptNumber);

                if (resolvedBackend === CodexBridgeClient.backendName) {
                    return {
                        backend: resolvedBackend,
                        aiConfig,
                        bridgeConfig: CodexBridgeClient.resolveBridgeConfig(aiConfig),
                        payload,
                        requestMessages,
                        resolvedModel,
                        resolvedEndpoint,
                        resolvedApiKey,
                        resolvedTemperature,
                        resolvedTimeout,
                        effectiveMaxConcurrent,
                        resolvedWaitAfterError,
                        resolvedWaitAfterRateLimitError,
                        semaphoreKey,
                        streamStartTimeoutMs,
                        streamContinueTimeoutMs,
                        oauthConfig,
                        configuredRequestHeaders,
                        baseAxiosOptions: null
                    };
                }

                const requestHeaders = {
                    'Authorization': `Bearer ${resolvedApiKey}`,
                    'Content-Type': 'application/json',
                    ...effectiveHeaders,
                    ...headers
                };
                if (oauthConfig) {
                    for (const key of Object.keys(requestHeaders)) {
                        if (key.toLowerCase() === 'authorization') {
                            delete requestHeaders[key];
                        }
                    }
                    requestHeaders.Authorization = `Bearer ${resolvedApiKey}`;
                }
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
                    backend: resolvedBackend,
                    aiConfig,
                    bridgeConfig: null,
                    payload,
                    requestMessages,
                    resolvedModel,
                    resolvedEndpoint,
                    resolvedApiKey,
                    resolvedTemperature,
                    resolvedTimeout,
                    effectiveMaxConcurrent,
                    resolvedWaitAfterError,
                    resolvedWaitAfterRateLimitError,
                    semaphoreKey,
                    streamStartTimeoutMs,
                    streamContinueTimeoutMs,
                    oauthConfig,
                    configuredRequestHeaders,
                    baseAxiosOptions
                };
            };

            let attempt = 0;
            let responseContent = '';
            let streamTrackerId = null;
            let startTimer = null;
            let lastTotalTokens = null;
            const shouldLogStreamChunks = logStreamChunksToConsole === true;
            const hasForcedOutput = resolvedForcedOutput !== null && resolvedForcedOutput !== undefined;
            let oauthForcedRefreshRetries = 0;
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
                let attemptSemaphorePermit = null;
                let attemptRuntime = null;
                let payload = null;
                let requestMessages = messages;
                let resolvedBackend = null;
                let resolvedModel = null;
                let resolvedEndpoint = null;
                let resolvedTimeout = null;
                let waitAfterErrorSeconds = 10;
                let waitAfterRateLimitErrorSeconds = 10;
                let streamStartTimeoutMs = 40000;
                let streamContinueTimeoutMs = 10000;
                const controller = new AbortController();
                let response = null;
                try {
                    if (hasForcedOutput) {
                        requestMessages = LLMClient.#applyPromptCachebuster(
                            messages,
                            LLMClient.#isPromptCachebusterEnabled(Globals?.config?.ai?.cachebuster)
                        );
                        payload = {
                            forceOutput: resolvedForcedOutput,
                            messages: requestMessages,
                            stream: false
                        };
                        if (typeof captureRequestPayload === 'function') {
                            try {
                                captureRequestPayload(JSON.parse(JSON.stringify(payload)));
                            } catch (_) {
                                captureRequestPayload(payload);
                            }
                        }

                        const forcedResponse = LLMClient.#resolveForcedOutput(resolvedForcedOutput, {
                            sourceLabel: `forced output (${metadataLabel || 'chat'})`,
                            requestedModel: model || null
                        });
                        response = {
                            status: 200,
                            statusText: 'OK',
                            headers: {},
                            config: {},
                            data: forcedResponse.normalizedResponseData
                        };
                        if (response?.data?.usage && Number.isFinite(response.data.usage.total_tokens)) {
                            lastTotalTokens = response.data.usage.total_tokens;
                        }
                    } else {
                        attemptRuntime = await resolveAttemptRuntime({ attemptNumber: attempt });
                        payload = attemptRuntime.payload;
                        requestMessages = attemptRuntime.requestMessages;
                        resolvedBackend = attemptRuntime.backend;
                        resolvedModel = attemptRuntime.resolvedModel;
                        resolvedEndpoint = attemptRuntime.resolvedEndpoint;
                        resolvedTimeout = attemptRuntime.resolvedTimeout;
                        waitAfterErrorSeconds = attemptRuntime.resolvedWaitAfterError;
                        waitAfterRateLimitErrorSeconds = attemptRuntime.resolvedWaitAfterRateLimitError;
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
                        attemptSemaphorePermit = await attemptSemaphore.acquire({
                            background: Boolean(runInBackground)
                        });

                        const shouldTrackPromptProgress = !isSilent
                            && (payload.stream || resolvedBackend === CodexBridgeClient.backendName);
                        streamTrackerId = shouldTrackPromptProgress
                            ? LLMClient.#trackStreamStart(metadataLabel, {
                                startTimeoutMs: streamStartTimeoutMs,
                                continueTimeoutMs: streamContinueTimeoutMs,
                                isBackground: Boolean(runInBackground),
                                model: resolvedModel,
                                promptText: LLMClient.formatMessagesForErrorLog(payload.messages),
                                receivedUnit: resolvedBackend === CodexBridgeClient.backendName ? 'characters' : 'bytes'
                            })
                            : null;
                        if (streamTrackerId) {
                            LLMClient.#abortControllers.set(streamTrackerId, controller);
                        }

                        if (resolvedBackend === CodexBridgeClient.backendName) {
                            response = await CodexBridgeClient.chatCompletion({
                                messages: requestMessages,
                                model: resolvedModel,
                                timeoutMs: resolvedTimeout,
                                metadataLabel,
                                additionalPayload: payload,
                                aiConfig: attemptRuntime.aiConfig,
                                signal: controller.signal,
                                onStdoutEvent: (event) => {
                                    if (!streamTrackerId) {
                                        return;
                                    }
                                    const previewUpdate = LLMClient.#extractCodexPreviewUpdate(event);
                                    if (previewUpdate) {
                                        LLMClient.#applyCodexPreviewUpdate(
                                            streamTrackerId,
                                            previewUpdate,
                                            streamContinueTimeoutMs
                                        );
                                        return;
                                    }
                                    const statusLine = LLMClient.#formatCodexProgressEvent(event);
                                    if (statusLine) {
                                        LLMClient.#trackStreamStatus(
                                            streamTrackerId,
                                            statusLine,
                                            streamContinueTimeoutMs
                                        );
                                    }
                                }
                            });
                        } else {
                            const axiosOptions = { ...attemptRuntime.baseAxiosOptions, signal: controller.signal };
                            if (payload.stream) {
                                startTimer = setTimeout(() => {
                                    controller.abort(new Error('Stream start timeout'));
                                }, streamStartTimeoutMs);
                            }
                            response = await axios.post(resolvedEndpoint, payload, axiosOptions);
                            if (startTimer) {
                                clearTimeout(startTimer);
                                startTimer = null;
                            }
                        }
                        if (response?.data?.usage && Number.isFinite(response.data.usage.total_tokens)) {
                            lastTotalTokens = response.data.usage.total_tokens;
                        }

                        // On any 5xx response, wait waitAfterError seconds and then retry
                        if (resolvedBackend !== CodexBridgeClient.backendName
                            && (response.status == 429 || (response.status >= 500 && response.status < 600))) {
                            errorLog(`Server error from LLM (status ${response.status}) on attempt ${attempt + 1}.`);
                            const retryWaitSeconds = response.status == 429
                                ? waitAfterRateLimitErrorSeconds
                                : waitAfterErrorSeconds;
                            if (retryWaitSeconds > 0) {
                                log(`Waiting ${retryWaitSeconds} seconds before retrying...`);
                                await new Promise(resolve => setTimeout(resolve, retryWaitSeconds * 1000));
                            }
                            throw new Error(`Server error from LLM (status ${response.status}).`);
                        }
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

                        const logStreamChunk = (payloadStr) => {
                            if (!shouldLogStreamChunks) {
                                return;
                            }
                            const label = metadataLabel || 'unknown';
                            console.log(`========== LLM STREAM CHUNK [${label}] ==========`);
                            console.log(payloadStr);
                            console.log('===============================================');
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
                                logStreamChunk(payloadStr);
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
                                        LLMClient.#trackStreamBytes(streamId, deltaBytes, streamContinueTimeoutMs, delta);
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

                    if (resolvedBackend === CodexBridgeClient.backendName && responseUsage) {
                        await LLMClient.#reportCodexUsage({
                            metadataLabel,
                            model: resolvedModel,
                            usage: responseUsage,
                            aiConfig: attemptRuntime?.aiConfig,
                            attemptNumber: attempt + 1,
                            clientId: typeof metadata?.clientId === 'string' ? metadata.clientId : null,
                            metadata
                        });
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
                                metadataLabel: resolvedErrorLogLabel,
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
                                    waitAfterError: waitAfterErrorSeconds,
                                    waitAfterRateLimitError: waitAfterRateLimitErrorSeconds,
                                    validateXML,
                                    validateXMLStrict,
                                    requiredTags,
                                    requiredRegex: resolvedRequiredRegex ? resolvedRequiredRegex.toString() : requiredRegex,
                                    dumpReasoningToConsole
                                },
                                aiConfigOverride: attemptRuntime?.aiConfig,
                                requestPayload: payload,
                                rawResponse: response.data,
                                messages: payload.messages
                            };

                            fs.writeFileSync(filePath, JSON.stringify(logPayload, null, 2), 'utf8');
                            log(`Debug log written to ${filePath}`);
                        } catch (debugError) {
                            warn('Failed to write debug log file:', debugError.message);
                        }
                    }

                    if (validateXML && !hasToolCalls) {
                        try {
                            if (validateXMLStrict) {
                                Utils.parseXmlDocumentStrict(responseContent);
                            } else {
                                Utils.parseXmlDocument(responseContent);
                            }
                        } catch (xmlError) {
                            errorLog(`XML validation failed (attempt ${attempt + 1}):`, xmlError);
                            const filePath = LLMClient.writeLogFile({
                                prefix: 'invalidXML',
                                metadataLabel: resolvedErrorLogLabel,
                                error: xmlError,
                                payload: `${LLMClient.formatMessagesForErrorLog(payload?.messages || requestMessages || messages)}\n\nResponse:\n\n${responseContent || ''}`,
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
                                    metadataLabel: resolvedErrorLogLabel,
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
                    if (resolvedBackend === CodexBridgeClient.backendName && streamTrackerId) {
                        LLMClient.#trackStreamEnd(streamTrackerId);
                        streamTrackerId = null;
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

                    const errorStatus = Number(error?.status ?? error?.response?.status);
                    if (errorStatus === 429) {
                        log('Rate limit exceeded. Waiting before retrying...');
                        if (waitAfterRateLimitErrorSeconds > 0) {
                            log(`Waiting ${waitAfterRateLimitErrorSeconds} seconds before retrying...`);
                            await new Promise(resolve => setTimeout(resolve, waitAfterRateLimitErrorSeconds * 1000));
                        }
                    }

                    const shouldForceOAuthRefresh = errorStatus === 401
                        && attemptRuntime?.oauthConfig
                        && oauthForcedRefreshRetries < 1;
                    if (shouldForceOAuthRefresh) {
                        oauthForcedRefreshRetries += 1;
                        warn('OAuth access token was rejected; refreshing and retrying once.');
                        LLMClient.#invalidateOAuthAccessToken(attemptRuntime.oauthConfig);
                        if (attempt === retryAttempts) {
                            retryAttempts += 1;
                        }
                    } else {
                        const promptAppend = LLMClient.formatMessagesForErrorLog(payload?.messages || requestMessages || messages);
                        const filePath = LLMClient.writeLogFile({
                            prefix: 'chatCompletionError',
                            metadataLabel: resolvedErrorLogLabel,
                            error: error,
                            payload: responseContent || '',
                            append: promptAppend,
                            onFailureMessage: 'Failed to write chat completion error log file'
                        });
                        if (filePath) {
                            warn(`Chat completion error response logged to ${filePath}`);
                        }
                    }

                    if (!shouldForceOAuthRefresh && attempt === retryAttempts) {
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
                        attemptSemaphore.release(attemptSemaphorePermit);
                    }
                }

                errorLog(`Retrying chat completion (attempt ${attempt + 2} of ${retryAttempts + 1})...`);
                attempt++;
                if ((attemptRuntime?.payload?.stream || attemptRuntime?.backend === CodexBridgeClient.backendName) && streamTrackerId) {
                    // bump retry count on all active streams
                    const entry = LLMClient.#streamProgress.active.get(streamTrackerId);
                    if (entry) {
                        entry.retries = (entry.retries || 0) + 1;
                    }
                }
            }

            let totalTime = Date.now() - currentTime;
            const finalProgressEntry = streamTrackerId && LLMClient.#streamProgress.active.has(streamTrackerId)
                ? LLMClient.#streamProgress.active.get(streamTrackerId)
                : null;
            const finalReceivedCount = finalProgressEntry
                ? (Number.isFinite(finalProgressEntry.receivedCount) ? finalProgressEntry.receivedCount : finalProgressEntry.bytes)
                : null;
            const finalReceivedKey = finalProgressEntry?.receivedUnit === 'characters' ? 'received' : 'bytes';
            const receivedNote = Number.isFinite(finalReceivedCount) ? ` | ${finalReceivedKey}=${finalReceivedCount}` : '';
            const tokensNote = Number.isFinite(lastTotalTokens) ? ` | tokens=${lastTotalTokens}` : '';
            const label = metadataLabel || 'unknown';
            log(`Prompt '${label}' completed after ${attempt} retries in ${totalTime / 1000} seconds.${receivedNote}${tokensNote}`);
            return responseContent;
        } finally {
            // per-attempt resources are released inside the retry loop.
        }
    }
}

module.exports = LLMClient;
