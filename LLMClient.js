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
const { AsyncLocalStorage } = require('async_hooks');
const CodexBridgeClient = require('./CodexBridgeClient.js');
const ClineBridgeClient = require('./ClineBridgeClient.js');
const KimiBridgeClient = require('./KimiBridgeClient.js');
const LlamaCppRouterClient = require('./LlamaCppRouterClient.js');
const { getChatToolDefinitions } = require('./chat_tool_calls.js');
const { formatMessageContent: formatBridgeMessageContent } = require('./bridge_client_utils.js');
const { TinyBrainXmlRepetitionDetector } = require('./TinyBrainXmlRepetition.js');
const LLMCompletionCassette = require('./LLMCompletionCassette.js');
let sharpModule = null;

const ERROR_LOG_IMAGE_CONTENT_FORMAT_OPTIONS = Object.freeze({
    trimPartType: false,
    dataUrlImagePlaceholder: '[image_url: data url omitted]',
    missingImageUrlPlaceholder: '[image_url]'
});

const PROMPT_PROGRESS_BROADCAST_INTERVAL_MS = 500;
const PROMPT_PROGRESS_COMPLETION_HOLD_MS = 250;
const OAUTH_REFRESH_THRESHOLD_SECONDS = 300;
const PROMPT_OUTPUT_CHARACTER_STATS_FILENAME = 'prompt-output-character-stats.json';
const PROMPT_OUTPUT_CHARACTER_STATS_VERSION = 1;
const COMPLETION_CASSETTE_RESOLUTION = Symbol('completionCassetteResolution');
const RECENT_STORY_MESSAGE_BOUNDARY_MARKER = '[[[AI_RPG_INTERNAL_MESSAGE_BOUNDARY_RECENT_STORY_HISTORY_V1]]]';
const BASE_CONTEXT_SECTION_MESSAGE_BOUNDARY_MARKER = '[[[AI_RPG_INTERNAL_MESSAGE_BOUNDARY_BASE_CONTEXT_SECTION_V1]]]';
const BASE_CONTEXT_END_MARKER = '[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]';
const BASE_CONTEXT_NO_TOOL_CALLS_INSTRUCTION = 'Do not make tool calls.';
const MAX_BASE_CONTEXT_SECTION_MESSAGE_BOUNDARIES = 12;
const BASE_CONTEXT_LEGACY_CHECK_TOOL_NAMES = new Set([
    'resolveAttack',
    'resolveAreaAttack',
    'resolveSkillCheck',
    'resolveOpposedSkillCheck',
    'resolvePlausibilityCheck',
    'resolveOpposedPlausibilityCheck'
]);
const PROMPT_OUTPUT_CHARACTER_STATS_BASE_LABEL_PREFIXES = Object.freeze([
    'inventory_generation',
    'npc_memories',
    'npc_progression_assignments',
    'npc_ability_assignments',
    'npc_alias_assignments'
]);

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

    hasQueuedForeground() {
        return this.queue.some(entry => entry && entry.background === false);
    }

    createPermit(background = false) {
        return { background: Boolean(background) };
    }

    async acquire({ background = false, front = false } = {}) {
        const isBackground = Boolean(background);
        if (this.canAcquire(isBackground)) {
            this.current += 1;
            if (isBackground) {
                this.currentBackground += 1;
            }
            return this.createPermit(isBackground);
        }
        return new Promise(resolve => {
            const entry = {
                resolve,
                background: isBackground
            };
            if (front) {
                this.queue.unshift(entry);
            } else {
                this.queue.push(entry);
            }
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

class AsyncReadWriteGate {
    constructor() {
        this.activeReaders = 0;
        this.writerActive = false;
        this.queue = [];
    }

    acquireShared() {
        const writerQueued = this.queue.some(entry => entry?.mode === 'exclusive');
        if (!this.writerActive && !writerQueued) {
            this.activeReaders += 1;
            return Promise.resolve(this.createRelease('shared'));
        }
        return new Promise(resolve => {
            this.queue.push({ mode: 'shared', resolve });
        });
    }

    acquireExclusive() {
        if (!this.writerActive && this.activeReaders === 0 && this.queue.length === 0) {
            this.writerActive = true;
            return Promise.resolve(this.createRelease('exclusive'));
        }
        return new Promise(resolve => {
            this.queue.push({ mode: 'exclusive', resolve });
            this.dispatch();
        });
    }

    createRelease(mode) {
        let released = false;
        return () => {
            if (released) {
                return;
            }
            released = true;
            if (mode === 'exclusive') {
                this.writerActive = false;
            } else if (this.activeReaders > 0) {
                this.activeReaders -= 1;
            }
            this.dispatch();
        };
    }

    dispatch() {
        if (this.writerActive) {
            return;
        }
        if (this.activeReaders === 0 && this.queue[0]?.mode === 'exclusive') {
            const writer = this.queue.shift();
            this.writerActive = true;
            writer.resolve(this.createRelease('exclusive'));
            return;
        }
        if (this.queue.some(entry => entry?.mode === 'exclusive')) {
            const writerIndex = this.queue.findIndex(entry => entry?.mode === 'exclusive');
            if (writerIndex === 0 || this.activeReaders > 0) {
                return;
            }
            const readers = this.queue.splice(0, writerIndex);
            for (const reader of readers) {
                this.activeReaders += 1;
                reader.resolve(this.createRelease('shared'));
            }
            return;
        }
        while (this.queue[0]?.mode === 'shared') {
            const reader = this.queue.shift();
            this.activeReaders += 1;
            reader.resolve(this.createRelease('shared'));
        }
    }
}

class LLMClient {
    static #semaphores = new Map();
    static #semaphoreLimit = null;
    static #allModelsSemaphore = null;
    static #allModelsSemaphoreLimit = null;
    static #modelLifecycleGate = new AsyncReadWriteGate();
    static #comfyModelCleanupHandler = null;
    static #managedLocalModelStartupHandler = null;
    static #lastPromptModelTarget = null;
    static #routerContextCachePaths = new Set();
    static #promptQueueReservationStates = new WeakMap();
    static #completionCassetteSemaphore = new Semaphore(1);
    static #promptProgressGroupContext = new AsyncLocalStorage();
    static #tinyBrainXmlRepetitionContext = new AsyncLocalStorage();
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
        hadEntries: false,
        failedResponsesByGroup: new Map()
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
    static #promptOutputCharacterStats = null;
    static #promptOutputCharacterStatsPath = null;
    static #failedLiveTokenStreamCapabilityKeys = new Set();

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

    static #trackStreamStart(label, { startTimeoutMs = null, continueTimeoutMs = null, isBackground = false, model = null, promptText = '', progressGroupId = null, progressGroupTargetLabel = null, receivedUnit = 'characters' } = {}) {
        if (!LLMClient.#shouldTrackPromptProgress()) {
            return null;
        }
        const promptLabel = typeof label === 'string' && label.trim() ? label.trim() : 'chat';
        const normalizedPromptLabel = LLMClient.#normalizePromptLabel(promptLabel) || 'chat';
        const startTs = Date.now();
        const startDeadline = Number.isFinite(startTimeoutMs) ? startTs + startTimeoutMs : null;
        const continueDeadline = null; // set after first received data arrives
        const normalizedReceivedUnit = receivedUnit === 'bytes' ? 'bytes' : 'characters';
        const resolvedProgressGroupId = typeof progressGroupId === 'string' && progressGroupId.trim()
            ? progressGroupId.trim()
            : null;
        const resolvedProgressGroupTargetLabel = typeof progressGroupTargetLabel === 'string' && progressGroupTargetLabel.trim()
            ? LLMClient.#normalizePromptLabel(progressGroupTargetLabel)
            : null;
        const progressTargetLabel = resolvedProgressGroupTargetLabel || promptLabel;
        const characterStats = LLMClient.getPromptOutputCharacterStats(progressTargetLabel);
        const targetCharacters = LLMClient.#resolvePromptProgressTargetForRun(progressTargetLabel, characterStats);

        if (resolvedProgressGroupId) {
            for (const [existingId, existingEntry] of LLMClient.#streamProgress.active.entries()) {
                if (existingEntry?.progressGroupId !== resolvedProgressGroupId) {
                    continue;
                }
                if (LLMClient.#abortControllers.has(existingId)) {
                    throw new Error(`Prompt progress group '${resolvedProgressGroupId}' cannot run concurrent requests.`);
                }
                if (existingEntry.progressGroupTargetLabel !== resolvedProgressGroupTargetLabel) {
                    throw new Error(`Prompt progress group '${resolvedProgressGroupId}' changed its target label.`);
                }
                const previousReceivedCount = Number.isFinite(existingEntry.receivedCount)
                    ? existingEntry.receivedCount
                    : (Number.isFinite(existingEntry.bytes) ? existingEntry.bytes : 0);
                const previousBytes = Number.isFinite(existingEntry.bytes)
                    ? existingEntry.bytes
                    : previousReceivedCount;
                Object.assign(existingEntry, {
                    promptLabel,
                    normalizedPromptLabel,
                    model: model || null,
                    bytes: previousBytes,
                    receivedCount: previousReceivedCount,
                    receivedUnit: normalizedReceivedUnit,
                    countedPreviewText: '',
                    promptText: typeof promptText === 'string' ? promptText : '',
                    previewText: '',
                    failedResponses: [
                        ...(LLMClient.#streamProgress.failedResponsesByGroup.get(resolvedProgressGroupId) || [])
                    ],
                    responseFailed: false,
                    hasTextPreview: false,
                    stageStartTs: startTs,
                    stageReceivedStartCount: previousReceivedCount,
                    startDeadline,
                    continueDeadline,
                    firstByteTs: null,
                    isBackground: Boolean(isBackground),
                    isComplete: false,
                    isGroupWaiting: false
                });
                delete existingEntry.completedAt;
                LLMClient.#ensureProgressTicker();
                LLMClient.#broadcastProgress(false, { force: true });
                return existingId;
            }
        }

        const idNum = ++LLMClient.#streamCounter;
        const id = `${promptLabel}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const labelWithCounter = `${promptLabel}[${idNum}]`;
        LLMClient.#streamProgress.active.set(id, {
            label: labelWithCounter,
            promptLabel,
            normalizedPromptLabel,
            model: model || null,
            bytes: 0,
            receivedCount: 0,
            receivedUnit: normalizedReceivedUnit,
            targetCharacters,
            runCount: characterStats.runs,
            averageOutputCharacters: characterStats.averageOutputCharacters,
            countedPreviewText: '',
            promptText: typeof promptText === 'string' ? promptText : '',
            previewText: '',
            progressGroupId: resolvedProgressGroupId,
            progressGroupTargetLabel: resolvedProgressGroupTargetLabel,
            failedResponses: resolvedProgressGroupId
                ? [...(LLMClient.#streamProgress.failedResponsesByGroup.get(resolvedProgressGroupId) || [])]
                : [],
            responseFailed: false,
            hasTextPreview: false,
            startTs,
            stageStartTs: startTs,
            stageReceivedStartCount: 0,
            startDeadline,
            continueDeadline,
            firstByteTs: null,
            isBackground: Boolean(isBackground),
            isGroupWaiting: false
        });
        LLMClient.#ensureProgressTicker();
        LLMClient.#broadcastProgress(false, { force: true });
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
        if (!Number.isFinite(numericCount) || numericCount < 0) {
            throw new Error('Stream received count must be a finite number >= 0.');
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

    static #trackStreamCharacters(id, characters, continueTimeoutMs = null, previewDelta = '') {
        LLMClient.#trackStreamReceived(id, characters, continueTimeoutMs, previewDelta);
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
        LLMClient.#trackStreamCharacters(id, 0, continueTimeoutMs, `${separator}${trimmed}\n`);
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

    static #isCodexBridgeBackend(backend) {
        return backend === CodexBridgeClient.backendName;
    }

    static #isClineBridgeBackend(backend) {
        return backend === ClineBridgeClient.backendName;
    }

    static #isKimiBridgeBackend(backend) {
        return backend === KimiBridgeClient.backendName;
    }

    static #isCliBridgeBackend(backend) {
        return LLMClient.#isCodexBridgeBackend(backend)
            || LLMClient.#isClineBridgeBackend(backend)
            || LLMClient.#isKimiBridgeBackend(backend);
    }

    static #resolveCliBridgeClient(backend) {
        if (LLMClient.#isCodexBridgeBackend(backend)) {
            return CodexBridgeClient;
        }
        if (LLMClient.#isClineBridgeBackend(backend)) {
            return ClineBridgeClient;
        }
        if (LLMClient.#isKimiBridgeBackend(backend)) {
            return KimiBridgeClient;
        }
        return null;
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

    static #completeStreamProgressEntry(id, entry) {
        entry.isComplete = true;
        entry.isGroupWaiting = false;
        entry.startDeadline = null;
        entry.continueDeadline = null;
        entry.completedAt = Date.now();
        LLMClient.#broadcastProgress(false, { force: true });
        setTimeout(() => {
            const currentEntry = LLMClient.#streamProgress.active.get(id);
            if (currentEntry !== entry || currentEntry?.isComplete !== true) {
                return;
            }
            LLMClient.#streamProgress.active.delete(id);
            const allDone = LLMClient.#streamProgress.active.size === 0;
            if (allDone) {
                LLMClient.#streamProgress.lastBroadcastHadEntries = false;
            }
            LLMClient.#broadcastProgress(allDone, { force: true });
        }, PROMPT_PROGRESS_COMPLETION_HOLD_MS);
    }

    static #trackStreamEnd(id) {
        if (!id) return;
        if (LLMClient.#streamProgress.broadcastTimer) {
            LLMClient.#broadcastProgress(false, { force: true });
        }
        const entry = LLMClient.#streamProgress.active.get(id);
        LLMClient.#abortControllers.delete(id);
        if (!entry) {
            if (!LLMClient.#streamProgress.active.size) {
                LLMClient.#streamProgress.lastBroadcastHadEntries = false;
                LLMClient.#broadcastProgress(true);
            }
            return;
        }
        if (entry.progressGroupId) {
            entry.isComplete = false;
            entry.isGroupWaiting = true;
            entry.startDeadline = null;
            entry.continueDeadline = null;
            entry.completedAt = Date.now();
            LLMClient.#broadcastProgress(false, { force: true });
            return;
        }
        LLMClient.#completeStreamProgressEntry(id, entry);
    }

    static recordPromptProgressGroupFailure(progressGroupId, responseText) {
        const resolvedGroupId = typeof progressGroupId === 'string' ? progressGroupId.trim() : '';
        if (!resolvedGroupId) {
            throw new Error('Prompt progress group id is required when recording a failed response.');
        }
        if (typeof responseText !== 'string') {
            throw new Error('Prompt progress failed response text must be a string.');
        }

        const failedResponses = [
            ...(LLMClient.#streamProgress.failedResponsesByGroup.get(resolvedGroupId) || []),
            responseText
        ];
        LLMClient.#streamProgress.failedResponsesByGroup.set(resolvedGroupId, failedResponses);

        let latestEntry = null;
        let latestPromptId = null;
        for (const [promptId, entry] of LLMClient.#streamProgress.active.entries()) {
            if (entry?.progressGroupId !== resolvedGroupId) {
                continue;
            }
            entry.failedResponses = [...failedResponses];
            latestEntry = entry;
            latestPromptId = promptId;
        }
        if (latestEntry) {
            latestEntry.responseFailed = true;
            LLMClient.#broadcastProgress(false, { force: true });
        }
        const hub = Globals?.realtimeHub;
        if (hub && typeof hub.emit === 'function') {
            hub.emit(null, 'prompt_progress_group_failure', {
                type: 'prompt_progress_group_failure',
                progressGroupId: resolvedGroupId,
                promptId: latestPromptId,
                failedResponses: [...failedResponses]
            });
        }
    }

    static clearPromptProgressGroup(progressGroupId, { recordOutputCharacters = false } = {}) {
        const resolvedGroupId = typeof progressGroupId === 'string' ? progressGroupId.trim() : '';
        if (!resolvedGroupId) {
            throw new Error('Prompt progress group id is required when clearing group state.');
        }
        if (typeof recordOutputCharacters !== 'boolean') {
            throw new Error('Prompt progress group recordOutputCharacters must be a boolean.');
        }
        LLMClient.#streamProgress.failedResponsesByGroup.delete(resolvedGroupId);
        let recordingError = null;
        let recordedOutput = false;
        for (const [promptId, entry] of LLMClient.#streamProgress.active.entries()) {
            if (entry?.progressGroupId !== resolvedGroupId) {
                continue;
            }
            LLMClient.#abortControllers.delete(promptId);
            if (recordOutputCharacters && !recordedOutput) {
                try {
                    if (entry.receivedUnit !== 'characters') {
                        throw new Error(`Prompt progress group '${resolvedGroupId}' cannot record non-character output stats.`);
                    }
                    if (typeof entry.progressGroupTargetLabel !== 'string' || !entry.progressGroupTargetLabel) {
                        throw new Error(`Prompt progress group '${resolvedGroupId}' is missing its target label.`);
                    }
                    const receivedCount = Number.isFinite(entry.receivedCount)
                        ? entry.receivedCount
                        : entry.bytes;
                    LLMClient.recordPromptOutputCharacters(entry.progressGroupTargetLabel, receivedCount);
                    recordedOutput = true;
                } catch (error) {
                    recordingError = error;
                }
            }
            LLMClient.#completeStreamProgressEntry(promptId, entry);
        }
        if (recordingError) {
            throw recordingError;
        }
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
            const stageStartTs = Number.isFinite(entry.stageStartTs) ? entry.stageStartTs : entry.startTs;
            const latencyMs = entry.firstByteTs ? (entry.firstByteTs - stageStartTs) : null;
            const elapsedAfterFirst = entry.firstByteTs ? Math.max(1, (now - entry.firstByteTs) / 1000) : null;
            const receivedCount = Number.isFinite(entry.receivedCount) ? entry.receivedCount : entry.bytes;
            const receivedUnit = entry.receivedUnit === 'characters' ? 'characters' : 'bytes';
            const stageReceivedStartCount = Number.isFinite(entry.stageReceivedStartCount)
                ? entry.stageReceivedStartCount
                : 0;
            const stageReceivedCount = receivedCount - stageReceivedStartCount;
            const avgReceivedPerSecond = elapsedAfterFirst ? Math.round(stageReceivedCount / elapsedAfterFirst) : null;
            const targetCharacters = Number.isFinite(entry.targetCharacters) ? entry.targetCharacters : null;
            const isComplete = entry.isComplete === true;
            const isGroupWaiting = entry.isGroupWaiting === true;
            const progressFraction = isComplete
                ? 1
                : targetCharacters === null
                ? null
                : LLMClient.calculatePromptProgressFraction(receivedCount, targetCharacters);
            return {
                id,
                label: entry.label,
                model: entry.model || null,
                bytes: entry.bytes,
                receivedCount,
                receivedUnit,
                targetCharacters,
                progressFraction,
                isComplete,
                isGroupWaiting,
                runCount: Number.isInteger(entry.runCount) ? entry.runCount : 0,
                averageOutputCharacters: Number.isFinite(entry.averageOutputCharacters)
                    ? entry.averageOutputCharacters
                    : null,
                promptText: typeof entry.promptText === 'string' ? entry.promptText : '',
                previewText: typeof entry.previewText === 'string' ? entry.previewText : '',
                progressGroupId: typeof entry.progressGroupId === 'string' ? entry.progressGroupId : null,
                progressGroupTargetLabel: typeof entry.progressGroupTargetLabel === 'string'
                    ? entry.progressGroupTargetLabel
                    : null,
                failedResponses: Array.isArray(entry.failedResponses)
                    ? entry.failedResponses.filter(response => typeof response === 'string')
                    : [],
                responseFailed: entry.responseFailed === true,
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
        let backend = null;
        try {
            backend = LLMClient.resolveBackend(config);
        } catch (error) {
            return [error.message];
        }
        const bridgeClient = LLMClient.#resolveCliBridgeClient(backend);
        const errors = (bridgeClient || CodexBridgeClient).getConfigurationErrors(config);
        if (config?.live_deslop !== undefined && typeof config.live_deslop !== 'boolean') {
            errors.push('AI live_deslop must be a boolean when provided.');
        }
        if (
            config?.xml_repetition_fix !== undefined
            && typeof config.xml_repetition_fix !== 'boolean'
        ) {
            errors.push('AI xml_repetition_fix must be a boolean when provided.');
        }
        if (
            config?.unload_during_image_generation !== undefined
            && typeof config.unload_during_image_generation !== 'boolean'
        ) {
            errors.push('AI unload_during_image_generation must be a boolean when provided.');
        }
        if (
            config?.terminate_during_image_generation !== undefined
            && typeof config.terminate_during_image_generation !== 'boolean'
        ) {
            errors.push('AI terminate_during_image_generation must be a boolean when provided.');
        }
        if (
            config?.local_startup_script_path !== undefined
            && config.local_startup_script_path !== null
            && typeof config.local_startup_script_path !== 'string'
        ) {
            errors.push('AI local_startup_script_path must be a string when provided.');
        }
        if (config?.router_slot_cache_directory !== undefined) {
            try {
                LLMClient.resolveRouterSlotCacheDirectory(config);
            } catch (error) {
                errors.push(error.message);
            }
        }
        if (
            config?.terminate_during_image_generation === true
            && (
                typeof config.local_startup_script_path !== 'string'
                || !config.local_startup_script_path.trim()
            )
        ) {
            errors.push(
                'AI local_startup_script_path is required when terminate_during_image_generation is true.'
            );
        }
        if (
            config?.unload_during_image_generation === true
            && config?.terminate_during_image_generation === true
        ) {
            errors.push(
                'AI unload_during_image_generation and terminate_during_image_generation cannot both be true.'
            );
        }
        return errors;
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
        const bridgeClient = LLMClient.#resolveCliBridgeClient(backend);
        if (bridgeClient) {
            return bridgeClient.getMaxConcurrent(config);
        }
        const raw = Number(config?.max_concurrent_requests);
        if (Number.isInteger(raw) && raw > 0) {
            return raw;
        }
        return 1;
    }

    static resolveMaxConcurrentAllModels(configOverride = Globals?.config) {
        const raw = configOverride?.max_concurrent_requests_all_models;
        if (raw === undefined || raw === null || raw === '') {
            return null;
        }
        const numeric = Number(raw);
        if (!Number.isInteger(numeric) || numeric < 1) {
            throw LLMClient.#configurationError('max_concurrent_requests_all_models must be a positive integer when provided.');
        }
        return numeric;
    }

    static resolveUnloadModelOnSwitch(configOverride = Globals?.config) {
        const value = configOverride?.unload_model_on_switch;
        if (value === undefined || value === null) {
            return false;
        }
        if (typeof value !== 'boolean') {
            throw LLMClient.#configurationError('unload_model_on_switch must be a boolean when provided.');
        }
        return value;
    }

    static resolveRouterSlotCacheDirectory(aiConfigOverride = Globals?.config?.ai) {
        const value = aiConfigOverride?.router_slot_cache_directory;
        if (value === undefined || value === null) {
            return '/dev/shm';
        }
        if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) {
            throw LLMClient.#configurationError(
                'AI router_slot_cache_directory must be a nonblank absolute path when provided.'
            );
        }
        return path.normalize(value.trim());
    }

    static resolveRouterPreloadModel(configOverride = Globals?.config) {
        const configuredValue = configOverride?.router_preload_model;
        if (
            configuredValue !== undefined
            && configuredValue !== null
            && typeof configuredValue !== 'string'
        ) {
            throw LLMClient.#configurationError(
                'router_preload_model must be a string when provided.'
            );
        }

        const configuredModel = typeof configuredValue === 'string'
            ? configuredValue.trim()
            : '';
        const mainModel = typeof configOverride?.ai?.model === 'string'
            ? configOverride.ai.model.trim()
            : '';
        const model = configuredModel || mainModel;
        if (!model) {
            throw LLMClient.#configurationError(
                'Router model preloading requires router_preload_model or ai.model.'
            );
        }
        return model;
    }

    static shouldPreloadRouterModel(configOverride = Globals?.config) {
        const configuredValue = configOverride?.router_preload_model;
        if (
            configuredValue !== undefined
            && configuredValue !== null
            && typeof configuredValue !== 'string'
        ) {
            throw LLMClient.#configurationError(
                'router_preload_model must be a string when provided.'
            );
        }
        if (typeof configuredValue === 'string' && configuredValue.trim()) {
            return true;
        }
        if (LLMClient.resolveUnloadModelOnSwitch(configOverride)) {
            return true;
        }

        const imagePromptConfiguration = LLMClient.#resolveEffectiveAiConfiguration(
            'image_prompt_generation',
            configOverride
        );
        return imagePromptConfiguration.aiConfig?.unload_during_image_generation === true;
    }

    static #isRetryableNetworkError(error, errorStatus = undefined) {
        const normalizedStatus = Number(errorStatus ?? error?.status ?? error?.response?.status);
        if (Number.isFinite(normalizedStatus)) {
            return false;
        }
        if (axios.isCancel?.(error) || error?.name === 'AbortError' || error?.code === 'ERR_CANCELED') {
            return false;
        }

        const retryableCodes = new Set([
            'EAI_AGAIN',
            'ECONNABORTED',
            'ECONNREFUSED',
            'ECONNRESET',
            'ENETUNREACH',
            'ENOTFOUND',
            'EPIPE',
            'ETIMEDOUT',
            'ERR_HTTP_CONTENT_LENGTH_MISMATCH',
            'ERR_HTTP2_STREAM_CANCEL',
            'ERR_NETWORK',
            'ERR_SOCKET_CLOSED',
            'ERR_STREAM_PREMATURE_CLOSE'
        ]);
        const rawCode = typeof error?.code === 'string' ? error.code : '';
        if (retryableCodes.has(rawCode) || rawCode.startsWith('UND_ERR_')) {
            return true;
        }
        if (Array.isArray(error?.errors)) {
            return error.errors.some(innerError => LLMClient.#isRetryableNetworkError(innerError));
        }
        if (error?.cause && error.cause !== error) {
            return LLMClient.#isRetryableNetworkError(error.cause);
        }
        return Boolean(error?.request && !error?.response);
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

    static #ensureAllModelsSemaphore(log = null) {
        const limit = LLMClient.resolveMaxConcurrentAllModels();
        if (limit === null) {
            return null;
        }
        const logFn = typeof log === 'function' ? log : null;
        if (!LLMClient.#allModelsSemaphore) {
            LLMClient.#allModelsSemaphore = new Semaphore(limit);
            LLMClient.#allModelsSemaphoreLimit = limit;
            if (logFn) {
                logFn(`🔒 LLMClient all-model semaphore initialized with maxConcurrent=${limit}`);
            }
            return LLMClient.#allModelsSemaphore;
        }
        if (LLMClient.#allModelsSemaphoreLimit !== limit) {
            LLMClient.#allModelsSemaphoreLimit = limit;
            LLMClient.#allModelsSemaphore.setLimit(limit);
            if (logFn) {
                logFn(`🔒 LLMClient all-model semaphore limit updated to maxConcurrent=${limit}`);
            }
        }
        return LLMClient.#allModelsSemaphore;
    }

    static #beginPromptQueueReservationRequest(reservation) {
        if (reservation === null || reservation === undefined) {
            return null;
        }
        if ((typeof reservation !== 'object' && typeof reservation !== 'function') || !reservation) {
            throw new Error('queueReservation must be created by LLMClient.withPromptQueueReservation().');
        }
        const state = LLMClient.#promptQueueReservationStates.get(reservation);
        if (!state || state.released) {
            throw new Error('queueReservation is invalid or has already been released.');
        }
        if (state.activeRequest) {
            throw new Error('A prompt queue reservation cannot be used by concurrent chatCompletion requests.');
        }
        state.activeRequest = true;
        return state;
    }

    static #endPromptQueueReservationRequest(state) {
        if (state) {
            state.activeRequest = false;
        }
    }

    static async #retainPromptQueueReservationCompletionCassettePermit(state) {
        if (!state) {
            throw new Error('Prompt queue reservation state is required for cassette serialization.');
        }
        if (state.completionCassettePermit) {
            return;
        }
        state.completionCassettePermit = await LLMClient.#completionCassetteSemaphore.acquire();
    }

    static async #retainPromptQueueReservationPermits(state, {
        semaphore,
        semaphoreKey,
        allModelsSemaphore,
        background = false
    } = {}) {
        if (!state) {
            throw new Error('Prompt queue reservation state is required.');
        }
        if (!semaphore || typeof semaphore.acquire !== 'function' || typeof semaphore.release !== 'function') {
            throw new Error('Prompt queue reservation requires a valid model semaphore.');
        }
        const isBackground = Boolean(background);
        if (state.acquired) {
            if (state.semaphore !== semaphore || state.semaphoreKey !== semaphoreKey) {
                throw new Error(
                    `Prompt queue reservation cannot change semaphore keys from "${state.semaphoreKey}" to "${semaphoreKey}".`
                );
            }
            if (state.allModelsSemaphore !== allModelsSemaphore) {
                throw new Error('Prompt queue reservation cannot change the all-model concurrency configuration while active.');
            }
            if (state.background !== isBackground) {
                throw new Error('Prompt queue reservation cannot change foreground/background priority while active.');
            }
            return;
        }

        const semaphorePermit = await semaphore.acquire({ background: isBackground });
        let allModelsSemaphorePermit = null;
        try {
            if (allModelsSemaphore) {
                allModelsSemaphorePermit = await allModelsSemaphore.acquire({ background: isBackground });
            }
        } catch (error) {
            semaphore.release(semaphorePermit);
            throw error;
        }

        state.acquired = true;
        state.semaphore = semaphore;
        state.semaphoreKey = semaphoreKey;
        state.semaphorePermit = semaphorePermit;
        state.allModelsSemaphore = allModelsSemaphore;
        state.allModelsSemaphorePermit = allModelsSemaphorePermit;
        state.background = isBackground;
    }

    static #releasePromptQueueReservation(state) {
        if (!state || state.released) {
            return;
        }
        if (state.activeRequest) {
            throw new Error('Cannot release a prompt queue reservation while chatCompletion is still active.');
        }
        state.released = true;
        if (state.acquired) {
            if (state.allModelsSemaphore) {
                state.allModelsSemaphore.release(state.allModelsSemaphorePermit);
            }
            state.semaphore.release(state.semaphorePermit);
            state.acquired = false;
        }
        if (state.completionCassettePermit) {
            LLMClient.#completionCassetteSemaphore.release(state.completionCassettePermit);
            state.completionCassettePermit = null;
        }
    }

    static async withPromptQueueReservation(callback) {
        if (typeof callback !== 'function') {
            throw new Error('withPromptQueueReservation requires an async callback.');
        }
        const reservation = Object.freeze({});
        const state = {
            acquired: false,
            activeRequest: false,
            yielded: false,
            released: false,
            semaphore: null,
            semaphoreKey: null,
            semaphorePermit: null,
            allModelsSemaphore: null,
            allModelsSemaphorePermit: null,
            completionCassettePermit: null,
            background: false
        };
        LLMClient.#promptQueueReservationStates.set(reservation, state);
        try {
            return await callback(reservation);
        } finally {
            LLMClient.#releasePromptQueueReservation(state);
        }
    }

    static async withPromptQueueReservationYield(reservation, callback) {
        if (typeof callback !== 'function') {
            throw new Error('withPromptQueueReservationYield requires an async callback.');
        }
        if ((typeof reservation !== 'object' && typeof reservation !== 'function') || !reservation) {
            throw new Error('withPromptQueueReservationYield requires a queue reservation.');
        }
        const state = LLMClient.#promptQueueReservationStates.get(reservation);
        if (!state || state.released) {
            throw new Error('Cannot yield an invalid or released prompt queue reservation.');
        }
        if (state.activeRequest) {
            throw new Error('Cannot yield a prompt queue reservation while chatCompletion is active.');
        }
        if (state.yielded) {
            throw new Error('Cannot yield a prompt queue reservation recursively.');
        }
        if (!state.acquired && !state.completionCassettePermit) {
            return await callback();
        }

        const retained = {
            semaphore: state.semaphore,
            semaphoreKey: state.semaphoreKey,
            allModelsSemaphore: state.allModelsSemaphore,
            completionCassette: Boolean(state.completionCassettePermit),
            background: state.background
        };
        state.yielded = true;
        if (state.allModelsSemaphore) {
            state.allModelsSemaphore.release(state.allModelsSemaphorePermit);
        }
        if (state.semaphore) {
            state.semaphore.release(state.semaphorePermit);
        }
        if (state.completionCassettePermit) {
            LLMClient.#completionCassetteSemaphore.release(state.completionCassettePermit);
            state.completionCassettePermit = null;
        }
        state.acquired = false;
        state.semaphorePermit = null;
        state.allModelsSemaphorePermit = null;

        let callbackResult;
        let callbackError = null;
        try {
            callbackResult = await callback();
        } catch (error) {
            callbackError = error;
        }

        let reacquireError = null;
        let semaphorePermit = null;
        let allModelsSemaphorePermit = null;
        let completionCassettePermit = null;
        try {
            if (retained.completionCassette) {
                completionCassettePermit = await LLMClient.#completionCassetteSemaphore.acquire({ front: true });
            }
            if (retained.semaphore) {
                semaphorePermit = await retained.semaphore.acquire({
                    background: retained.background,
                    front: true
                });
            }
            if (retained.allModelsSemaphore) {
                allModelsSemaphorePermit = await retained.allModelsSemaphore.acquire({
                    background: retained.background,
                    front: true
                });
            }
            state.acquired = Boolean(retained.semaphore);
            state.semaphore = retained.semaphore;
            state.semaphoreKey = retained.semaphoreKey;
            state.semaphorePermit = semaphorePermit;
            state.allModelsSemaphore = retained.allModelsSemaphore;
            state.allModelsSemaphorePermit = allModelsSemaphorePermit;
            state.completionCassettePermit = completionCassettePermit;
            state.background = retained.background;
        } catch (error) {
            reacquireError = error;
            if (allModelsSemaphorePermit && retained.allModelsSemaphore) {
                retained.allModelsSemaphore.release(allModelsSemaphorePermit);
            }
            if (semaphorePermit) {
                retained.semaphore.release(semaphorePermit);
            }
            if (completionCassettePermit) {
                LLMClient.#completionCassetteSemaphore.release(completionCassettePermit);
            }
        } finally {
            state.yielded = false;
        }

        if (callbackError && reacquireError) {
            throw new AggregateError(
                [callbackError, reacquireError],
                'Prompt queue reservation work failed and its permits could not be reacquired.'
            );
        }
        if (reacquireError) {
            throw reacquireError;
        }
        if (callbackError) {
            throw callbackError;
        }
        return callbackResult;
    }

    static async withExclusiveModelLifecycle(callback) {
        if (typeof callback !== 'function') {
            throw new Error('withExclusiveModelLifecycle requires an async callback.');
        }
        const release = await LLMClient.#modelLifecycleGate.acquireExclusive();
        try {
            return await callback();
        } finally {
            release();
        }
    }

    static resetModelSwitchTracking() {
        LLMClient.#lastPromptModelTarget = null;
        LLMClient.#routerContextCachePaths.clear();
    }

    static #trackRouterContextCacheTarget(target) {
        if (!target || target.isLocalRouter !== true) {
            return null;
        }
        const model = typeof target.model === 'string' ? target.model.trim() : '';
        const slotCacheDirectory = typeof target.slotCacheDirectory === 'string'
            ? target.slotCacheDirectory.trim()
            : '';
        if (!model || !slotCacheDirectory || !path.isAbsolute(slotCacheDirectory)) {
            throw new Error('Local llama.cpp router context-cache tracking requires a model and absolute cache directory.');
        }
        const cachePath = path.join(
            path.normalize(slotCacheDirectory),
            LlamaCppRouterClient.buildSlotCacheFilename(model)
        );
        LLMClient.#routerContextCachePaths.add(cachePath);
        return cachePath;
    }

    static resolveRouterContextCachePaths(configOverride = Globals?.config) {
        const cachePaths = new Set(LLMClient.#routerContextCachePaths);
        if (!configOverride || typeof configOverride !== 'object' || Array.isArray(configOverride)) {
            return Array.from(cachePaths).sort();
        }

        const addConfiguration = (aiConfig, modelOverride = null) => {
            if (!aiConfig || typeof aiConfig !== 'object' || Array.isArray(aiConfig)) {
                return;
            }
            const startupScriptPath = typeof aiConfig.local_startup_script_path === 'string'
                ? aiConfig.local_startup_script_path.trim()
                : '';
            const model = typeof modelOverride === 'string' && modelOverride.trim()
                ? modelOverride.trim()
                : (typeof aiConfig.model === 'string' ? aiConfig.model.trim() : '');
            if (!startupScriptPath || !model) {
                return;
            }
            const slotCacheDirectory = LLMClient.resolveRouterSlotCacheDirectory(aiConfig);
            cachePaths.add(path.join(
                slotCacheDirectory,
                LlamaCppRouterClient.buildSlotCacheFilename(model)
            ));
        };

        addConfiguration(configOverride.ai);
        addConfiguration(configOverride.ai, configOverride.router_preload_model);

        const promptLabels = new Set();
        const overrideProfiles = configOverride.ai_model_overrides;
        if (overrideProfiles && typeof overrideProfiles === 'object' && !Array.isArray(overrideProfiles)) {
            for (const profile of Object.values(overrideProfiles)) {
                if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
                    continue;
                }
                for (const promptLabel of Array.isArray(profile.prompts) ? profile.prompts : []) {
                    if (typeof promptLabel === 'string' && promptLabel.trim()) {
                        promptLabels.add(promptLabel.trim());
                    }
                }
            }
        }
        for (const promptLabel of promptLabels) {
            addConfiguration(
                LLMClient.resolveEffectiveAiConfiguration(promptLabel, configOverride).aiConfig
            );
        }

        return Array.from(cachePaths).sort();
    }

    static async deleteRouterContextCacheFiles({
        configOverride = Globals?.config,
        fileSystem = fs,
        logger = console
    } = {}) {
        if (!fileSystem?.promises || typeof fileSystem.promises.unlink !== 'function') {
            throw new Error('Router context-cache cleanup requires fileSystem.promises.unlink().');
        }
        if (!logger || typeof logger.log !== 'function') {
            throw new Error('Router context-cache cleanup requires logger.log().');
        }

        const deleted = [];
        const failures = [];
        for (const cachePath of LLMClient.resolveRouterContextCachePaths(configOverride)) {
            try {
                await fileSystem.promises.unlink(cachePath);
                deleted.push(cachePath);
                LLMClient.#routerContextCachePaths.delete(cachePath);
                logger.log(`🧹 Deleted llama.cpp context cache ${cachePath}.`);
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    LLMClient.#routerContextCachePaths.delete(cachePath);
                    continue;
                }
                failures.push(new Error(
                    `Failed to delete llama.cpp context cache ${cachePath}: ${error?.message || String(error)}`,
                    { cause: error }
                ));
            }
        }
        if (failures.length) {
            throw new AggregateError(
                failures,
                `Failed to delete one or more llama.cpp context cache files: ${failures.map(error => error.message).join('; ')}`
            );
        }
        return { deleted };
    }

    static deleteRouterContextCacheFilesSync({
        configOverride = Globals?.config,
        fileSystem = fs,
        logger = console
    } = {}) {
        if (!fileSystem || typeof fileSystem.unlinkSync !== 'function') {
            throw new Error('Synchronous router context-cache cleanup requires fileSystem.unlinkSync().');
        }
        if (!logger || typeof logger.log !== 'function') {
            throw new Error('Synchronous router context-cache cleanup requires logger.log().');
        }

        const deleted = [];
        const failures = [];
        for (const cachePath of LLMClient.resolveRouterContextCachePaths(configOverride)) {
            try {
                fileSystem.unlinkSync(cachePath);
                deleted.push(cachePath);
                LLMClient.#routerContextCachePaths.delete(cachePath);
                logger.log(`🧹 Deleted llama.cpp context cache ${cachePath}.`);
            } catch (error) {
                if (error?.code === 'ENOENT') {
                    LLMClient.#routerContextCachePaths.delete(cachePath);
                    continue;
                }
                failures.push(new Error(
                    `Failed to delete llama.cpp context cache ${cachePath}: ${error?.message || String(error)}`,
                    { cause: error }
                ));
            }
        }
        if (failures.length) {
            throw new AggregateError(
                failures,
                `Failed to delete one or more llama.cpp context cache files: ${failures.map(error => error.message).join('; ')}`
            );
        }
        return { deleted };
    }

    static #resolvePromptModelTarget(attemptRuntime, { required = false } = {}) {
        if (!attemptRuntime || typeof attemptRuntime !== 'object') {
            throw new Error('Prompt model target resolution requires attempt runtime data.');
        }
        if (attemptRuntime.backend !== 'openai_compatible') {
            if (required) {
                throw LLMClient.#configurationError(
                    'unload_model_on_switch requires the openai_compatible backend.'
                );
            }
            return null;
        }

        const endpoint = typeof attemptRuntime.resolvedEndpoint === 'string'
            ? attemptRuntime.resolvedEndpoint.trim()
            : '';
        const model = typeof attemptRuntime.resolvedModel === 'string'
            ? attemptRuntime.resolvedModel.trim()
            : '';
        if (!endpoint || !model) {
            if (required) {
                throw LLMClient.#configurationError(
                    'unload_model_on_switch requires a configured endpoint and model.'
                );
            }
            return null;
        }
        const routerBaseUrl = LlamaCppRouterClient.resolveRouterBaseUrl(endpoint);
        const startupScriptPath = typeof attemptRuntime.aiConfig?.local_startup_script_path === 'string'
            ? attemptRuntime.aiConfig.local_startup_script_path.trim()
            : '';
        const target = {
            key: `${routerBaseUrl}\n${model}`,
            endpoint,
            model,
            headers: {
                ...(attemptRuntime.baseAxiosOptions?.headers || {})
            },
            timeoutMs: attemptRuntime.resolvedTimeout,
            isLocalRouter: Boolean(startupScriptPath),
            slotCacheDirectory: LLMClient.resolveRouterSlotCacheDirectory(attemptRuntime.aiConfig)
        };
        LLMClient.#trackRouterContextCacheTarget(target);
        return target;
    }

    static #recordPromptModelTarget(attemptRuntime) {
        LLMClient.#lastPromptModelTarget = LLMClient.#resolvePromptModelTarget(attemptRuntime);
    }

    static async #unloadPreviousPromptModelOnSwitch({ attemptRuntime, metadataLabel, log } = {}) {
        const currentTarget = LLMClient.#resolvePromptModelTarget(attemptRuntime, { required: true });
        const previousTarget = LLMClient.#lastPromptModelTarget;
        if (!previousTarget || previousTarget.key === currentTarget.key) {
            LLMClient.#lastPromptModelTarget = currentTarget;
            return;
        }

        const promptLabel = typeof metadataLabel === 'string' && metadataLabel.trim()
            ? metadataLabel.trim()
            : 'unknown';
        const previousRouter = new LlamaCppRouterClient({
            endpoint: previousTarget.endpoint,
            model: previousTarget.model,
            headers: previousTarget.headers,
            timeoutMs: previousTarget.timeoutMs,
            slotCacheDirectory: previousTarget.slotCacheDirectory
        });
        const switchesWithinManagedLocalRouter = previousTarget.isLocalRouter === true
            && currentTarget.isLocalRouter === true
            && LlamaCppRouterClient.resolveRouterBaseUrl(previousTarget.endpoint)
                === LlamaCppRouterClient.resolveRouterBaseUrl(currentTarget.endpoint);
        if (switchesWithinManagedLocalRouter) {
            try {
                const previousStatus = await previousRouter.getModelStatus();
                if (previousStatus.value !== 'unloaded') {
                    const saveState = await previousRouter.saveSlotCache();
                    if (typeof log === 'function') {
                        log(
                            `🧠 Saved llama.cpp slot ${previousRouter.slotId} context for model "${previousTarget.model}" to ${saveState.cachePath}.`
                        );
                    }
                }
            } catch (error) {
                console.warn(
                    `⚠️ Failed to save llama.cpp context cache for model "${previousTarget.model}"; continuing model switch: ${error?.message || String(error)}`
                );
            }
        }

        let unloadState;
        try {
            unloadState = await previousRouter.unloadModelIfLoaded();
        } catch (cause) {
            const error = new Error(
                `Failed to unload previous llama.cpp model "${previousTarget.model}" before prompt "${promptLabel}" switched to "${currentTarget.model}": ${cause?.message || String(cause)}`,
                { cause }
            );
            error.isModelSwitchError = true;
            throw error;
        }

        if (typeof log === 'function') {
            if (unloadState.unloadedByClient) {
                log(
                    `🧠 Unloaded previous llama.cpp model "${previousTarget.model}" before switching to "${currentTarget.model}".`
                );
            } else {
                log(
                    `🧠 Previous llama.cpp model "${previousTarget.model}" was already unloaded before switching to "${currentTarget.model}".`
                );
            }
        }

        if (switchesWithinManagedLocalRouter) {
            const currentRouter = new LlamaCppRouterClient({
                endpoint: currentTarget.endpoint,
                model: currentTarget.model,
                headers: currentTarget.headers,
                timeoutMs: currentTarget.timeoutMs,
                slotCacheDirectory: currentTarget.slotCacheDirectory
            });
            try {
                const cacheExists = await currentRouter.slotCacheFileExists();
                if (cacheExists && typeof log === 'function') {
                    log(
                        `🧠 Submitted llama.cpp slot ${currentRouter.slotId} restore for model "${currentTarget.model}"; `
                        + 'the router will load and wait for the model before restoring.'
                    );
                }
                const restoreState = await currentRouter.restoreSlotCacheIfPresent();
                if (restoreState.restored && typeof log === 'function') {
                    log(
                        `🧠 Restored llama.cpp slot ${currentRouter.slotId} context for model "${currentTarget.model}" and deleted ${restoreState.cachePath}.`
                    );
                } else if (!cacheExists && typeof log === 'function') {
                    log(
                        `🧠 No saved slot cache exists for replacement model "${currentTarget.model}"; `
                        + 'the queued prompt will let the llama.cpp router load and wait for it.'
                    );
                }
            } catch (cause) {
                if (cause?.slotCacheDeleteFailed === true) {
                    cause.isModelSwitchError = true;
                    throw cause;
                }
                console.warn(
                    `⚠️ Failed to restore llama.cpp context cache for model "${currentTarget.model}"; continuing without it: ${cause?.message || String(cause)}`
                );
            }
        }

        LLMClient.#lastPromptModelTarget = currentTarget;
    }

    static setComfyModelCleanupHandler(handler = null) {
        if (handler !== null && typeof handler !== 'function') {
            throw new Error('ComfyUI model cleanup handler must be a function or null.');
        }
        LLMClient.#comfyModelCleanupHandler = handler;
    }

    static setManagedLocalModelStartupHandler(handler = null) {
        if (handler !== null && typeof handler !== 'function') {
            throw new Error('Managed local model startup handler must be a function or null.');
        }
        LLMClient.#managedLocalModelStartupHandler = handler;
    }

    static async #ensureManagedLocalModelBeforePrompt({ aiConfig, metadataLabel } = {}) {
        if (aiConfig?.terminate_during_image_generation !== true) {
            return;
        }
        const label = typeof metadataLabel === 'string' && metadataLabel.trim()
            ? metadataLabel.trim()
            : 'unknown';
        const startupScriptPath = typeof aiConfig.local_startup_script_path === 'string'
            ? aiConfig.local_startup_script_path.trim()
            : '';
        if (!startupScriptPath) {
            const error = new Error(
                `Cannot run LLM prompt "${label}": local_startup_script_path is missing while terminate_during_image_generation is enabled.`
            );
            error.isModelSwitchError = true;
            throw error;
        }
        if (typeof LLMClient.#managedLocalModelStartupHandler !== 'function') {
            const error = new Error(
                `Cannot run LLM prompt "${label}": managed local llama.cpp startup switching is not configured.`
            );
            error.isModelSwitchError = true;
            throw error;
        }
        try {
            await LLMClient.#managedLocalModelStartupHandler({
                aiConfig,
                metadataLabel: label,
                startupScriptPath
            });
        } catch (cause) {
            const error = new Error(
                `Failed to prepare managed local llama.cpp for LLM prompt "${label}" with startup script "${startupScriptPath}": ${cause?.message || String(cause)}`,
                { cause }
            );
            error.isModelSwitchError = true;
            throw error;
        }
    }

    static async #unloadComfyModelsBeforePrompt({ aiConfig, metadataLabel } = {}) {
        if (aiConfig?.unload_during_image_generation !== true) {
            return;
        }
        const label = typeof metadataLabel === 'string' && metadataLabel.trim()
            ? metadataLabel.trim()
            : 'unknown';
        if (typeof LLMClient.#comfyModelCleanupHandler !== 'function') {
            const error = new Error(
                `Cannot run LLM prompt "${label}": ComfyUI model cleanup is not configured while unload_during_image_generation is enabled.`
            );
            error.isPrePromptCleanupError = true;
            throw error;
        }
        try {
            await LLMClient.#comfyModelCleanupHandler({
                aiConfig,
                metadataLabel: label
            });
        } catch (cause) {
            const error = new Error(
                `Failed to unload ComfyUI models before LLM prompt "${label}": ${cause?.message || String(cause)}`,
                { cause }
            );
            error.isPrePromptCleanupError = true;
            throw error;
        }
    }

    static async withPromptProgressGroup({ progressGroupId, progressGroupTargetLabel } = {}, callback) {
        if (typeof callback !== 'function') {
            throw new Error('withPromptProgressGroup requires an async callback.');
        }
        if (typeof progressGroupId !== 'string' || !progressGroupId.trim()) {
            throw new Error('withPromptProgressGroup requires a non-empty progressGroupId.');
        }
        if (typeof progressGroupTargetLabel !== 'string' || !progressGroupTargetLabel.trim()) {
            throw new Error('withPromptProgressGroup requires a non-empty progressGroupTargetLabel.');
        }
        const normalizedTargetLabel = LLMClient.#normalizePromptLabel(progressGroupTargetLabel);
        if (!normalizedTargetLabel) {
            throw new Error('withPromptProgressGroup progressGroupTargetLabel must resolve to a prompt label.');
        }
        if (LLMClient.#promptProgressGroupContext.getStore()) {
            throw new Error('Nested prompt progress groups are not supported.');
        }
        return await LLMClient.#promptProgressGroupContext.run(Object.freeze({
            progressGroupId: progressGroupId.trim(),
            progressGroupTargetLabel: normalizedTargetLabel
        }), callback);
    }

    static isTinyBrainXmlRepetitionFixEnabled() {
        return Globals?.config?.ai?.xml_repetition_fix === true;
    }

    static async withTinyBrainXmlRepetitionFix({ metadataLabel, maxContinuations } = {}, callback) {
        if (typeof callback !== 'function') {
            throw new Error('withTinyBrainXmlRepetitionFix requires an async callback.');
        }
        const normalizedMetadataLabel = LLMClient.#normalizePromptLabel(metadataLabel);
        if (!normalizedMetadataLabel) {
            throw new Error('withTinyBrainXmlRepetitionFix requires a prompt metadata label.');
        }
        if (!Number.isInteger(maxContinuations) || maxContinuations < 0) {
            throw new RangeError('withTinyBrainXmlRepetitionFix requires non-negative integer maxContinuations.');
        }
        return await LLMClient.#tinyBrainXmlRepetitionContext.run(Object.freeze({
            metadataLabel: normalizedMetadataLabel,
            maxContinuations,
            continuationPrompt: 'continue'
        }), callback);
    }

    static async withTinyBrainXmlRepetitionLogger(onCorrection, callback) {
        if (typeof callback !== 'function') {
            throw new Error('withTinyBrainXmlRepetitionLogger requires an async callback.');
        }
        if (typeof onCorrection !== 'function') {
            throw new Error('withTinyBrainXmlRepetitionLogger requires a correction logger.');
        }
        const currentContext = LLMClient.#tinyBrainXmlRepetitionContext.getStore() || null;
        if (!currentContext) {
            return await callback();
        }
        return await LLMClient.#tinyBrainXmlRepetitionContext.run(Object.freeze({
            ...currentContext,
            onCorrection
        }), callback);
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

            error = LLMClient.#serializeErrorForLog(error);
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

    static #serializeErrorForLog(error) {
        if (!error) {
            return '';
        }
        if (typeof error !== 'object') {
            return JSON.stringify(error);
        }

        let details = {};
        if (typeof error.toJSON === 'function') {
            try {
                const jsonDetails = error.toJSON();
                if (jsonDetails && typeof jsonDetails === 'object') {
                    details = { ...jsonDetails };
                }
            } catch (_) {
                details = {};
            }
        }

        if (!Object.keys(details).length) {
            for (const key of Object.keys(error)) {
                details[key] = error[key];
            }
        }

        for (const key of ['message', 'name', 'stack', 'code', 'status']) {
            if (error[key] !== undefined && details[key] === undefined) {
                details[key] = error[key];
            }
        }

        for (const key of ['attemptNumber', 'maxAttempts', 'willRetry']) {
            if (error[key] !== undefined) {
                details[key] = error[key];
            }
        }

        if (Array.isArray(error.errors) && details.errors === undefined) {
            details.errors = error.errors.map((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return { message: String(entry) };
                }
                return {
                    name: entry.name,
                    message: entry.message,
                    code: entry.code,
                    errno: entry.errno,
                    syscall: entry.syscall,
                    address: entry.address,
                    port: entry.port
                };
            });
        }

        return JSON.stringify(details);
    }

    static #formatMessageContent(content) {
        return formatBridgeMessageContent(content, ERROR_LOG_IMAGE_CONTENT_FORMAT_OPTIONS);
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

    static formatMessagesForPromptProgress(messages = []) {
        const formattedMessages = [];
        if (Array.isArray(messages)) {
            messages.forEach(message => {
                if (!message || typeof message !== 'object') {
                    return;
                }
                const role = typeof message.role === 'string'
                    ? message.role.trim().toLowerCase()
                    : 'unknown';
                const content = LLMClient.#formatMessageContent(message.content).trim();
                if (!content) {
                    return;
                }
                let heading;
                switch (role) {
                    case 'system':
                        heading = 'SYSTEM PROMPT';
                        break;
                    case 'developer':
                        heading = 'DEVELOPER PROMPT';
                        break;
                    case 'user':
                        heading = 'USER PROMPT';
                        break;
                    case 'assistant':
                        heading = 'ASSISTANT RESPONSE';
                        break;
                    case 'tool':
                        heading = 'TOOL RESPONSE';
                        break;
                    default:
                        heading = `${role.toUpperCase() || 'UNKNOWN'} MESSAGE`;
                        break;
                }
                formattedMessages.push(`=== ${heading} ===\n${content}`);
            });
        }
        return formattedMessages.length
            ? formattedMessages.join('\n\n')
            : '=== PROMPT ===\n(none)';
    }

    static getRecentStoryMessageBoundaryMarker() {
        return RECENT_STORY_MESSAGE_BOUNDARY_MARKER;
    }

    static getBaseContextSectionMessageBoundaryMarker() {
        return BASE_CONTEXT_SECTION_MESSAGE_BOUNDARY_MARKER;
    }

    static getBaseContextEndMarker() {
        return BASE_CONTEXT_END_MARKER;
    }

    static getBaseContextNoToolCallsInstruction() {
        return BASE_CONTEXT_NO_TOOL_CALLS_INSTRUCTION;
    }

    static #cloneToolDefinition(toolDefinition, sourceLabel) {
        if (!toolDefinition || typeof toolDefinition !== 'object' || Array.isArray(toolDefinition)) {
            throw new Error(`${sourceLabel} contains an invalid tool definition.`);
        }
        try {
            return JSON.parse(JSON.stringify(toolDefinition));
        } catch (error) {
            throw new Error(`Failed to clone ${sourceLabel} tool definition: ${error.message}`);
        }
    }

    static #resolveSharedBaseContextToolDefinitions() {
        const modExtensionRegistry = Globals?.modExtensionRegistry || null;
        const builtInTools = getChatToolDefinitions({ modExtensionRegistry });
        const modTools = modExtensionRegistry && typeof modExtensionRegistry.getChatToolDefinitions === 'function'
            ? modExtensionRegistry.getChatToolDefinitions()
            : [];
        const requestUserInputEnabled = Globals?.config?.chat_tools?.request_user_input_enabled !== false;
        const useLegacyPromptChecks = Globals?.config?.use_legacy_prompt_checks === true;
        const tools = [...builtInTools, ...modTools]
            .filter(toolDefinition => {
                const functionName = typeof toolDefinition?.function?.name === 'string'
                    ? toolDefinition.function.name.trim()
                    : '';
                if (!requestUserInputEnabled && functionName === 'requestUserInput') {
                    return false;
                }
                if (useLegacyPromptChecks && BASE_CONTEXT_LEGACY_CHECK_TOOL_NAMES.has(functionName)) {
                    return false;
                }
                return true;
            })
            .map((toolDefinition, index) => LLMClient.#cloneToolDefinition(
                toolDefinition,
                `shared base-context tool #${index + 1}`
            ));
        if (!tools.length) {
            throw new Error('Shared base-context tool definitions are empty.');
        }

        const toolNames = new Set();
        for (const toolDefinition of tools) {
            const functionName = typeof toolDefinition?.function?.name === 'string'
                ? toolDefinition.function.name.trim()
                : '';
            if (!functionName) {
                throw new Error('Shared base-context tool definition is missing function.name.');
            }
            if (toolNames.has(functionName)) {
                throw new Error(`Shared base-context tool definitions contain duplicate function name "${functionName}".`);
            }
            toolNames.add(functionName);
        }
        return tools;
    }

    static applyBaseContextToolPolicy(messages = [], {
        metadataLabel = '',
        additionalPayload = {},
        preserveCallerToolDefinitions = false
    } = {}) {
        if (!Array.isArray(messages)) {
            throw new Error('Base-context tool policy requires a messages array.');
        }
        if (!additionalPayload || typeof additionalPayload !== 'object' || Array.isArray(additionalPayload)) {
            throw new Error('Base-context tool policy requires additionalPayload to be an object.');
        }
        if (typeof preserveCallerToolDefinitions !== 'boolean') {
            throw new Error('Base-context tool policy preserveCallerToolDefinitions must be a boolean.');
        }

        let markerCount = 0;
        let markerMessageIndex = -1;
        for (let index = 0; index < messages.length; index += 1) {
            const content = messages[index]?.content;
            if (typeof content !== 'string' || !content.includes(BASE_CONTEXT_END_MARKER)) {
                continue;
            }
            const parts = content.split(BASE_CONTEXT_END_MARKER);
            markerCount += parts.length - 1;
            markerMessageIndex = index;
        }
        if (markerCount === 0) {
            return {
                messages,
                additionalPayload,
                isBaseContextPrompt: false,
                sharedToolsApplied: false,
                noToolCallsInstructionAdded: false
            };
        }
        if (markerCount !== 1 || markerMessageIndex < 0) {
            throw new Error('A base-context prompt must contain exactly one internal end marker.');
        }

        const markerMessage = messages[markerMessageIndex];
        const markerRole = typeof markerMessage?.role === 'string'
            ? markerMessage.role.trim().toLowerCase()
            : '';
        if (markerRole !== 'user') {
            throw new Error('The base-context end marker may only appear in a user message.');
        }
        const markerParts = markerMessage.content.split(BASE_CONTEXT_END_MARKER);
        if (markerParts.length !== 2 || !markerParts[0].trim() || !markerParts[1].trim()) {
            throw new Error('The base-context end marker requires non-empty content on both sides.');
        }

        const normalizedLabel = LLMClient.#normalizePromptLabel(metadataLabel);
        const isGenericPrompt = normalizedLabel === 'generic_prompt'
            || normalizedLabel === 'generic_prompt_nocontext';
        const hadToolDefinitions = LLMClient.#payloadHasToolDefinitions(additionalPayload);
        const explicitlyDisablesToolCalls = (
            typeof additionalPayload.tool_choice === 'string'
            && additionalPayload.tool_choice.trim().toLowerCase() === 'none'
        ) || (
            typeof additionalPayload.function_call === 'string'
            && additionalPayload.function_call.trim().toLowerCase() === 'none'
        );
        const noToolCallsInstructionAdded = !isGenericPrompt
            && !hadToolDefinitions
            && !explicitlyDisablesToolCalls;
        const replacement = noToolCallsInstructionAdded
            ? `\n\n${BASE_CONTEXT_NO_TOOL_CALLS_INSTRUCTION}\n\n`
            : '';
        const normalizedMessages = messages.flatMap((message, index) => {
            if (index !== markerMessageIndex) {
                return [message];
            }
            if (isGenericPrompt) {
                return [{ ...message, content: `${markerParts[0]}${markerParts[1]}` }];
            }
            return [
                { ...message, content: markerParts[0] },
                { ...message, content: `${replacement}${markerParts[1]}` }
            ];
        });

        if (isGenericPrompt) {
            return {
                messages: normalizedMessages,
                additionalPayload,
                isBaseContextPrompt: true,
                sharedToolsApplied: false,
                noToolCallsInstructionAdded: false
            };
        }

        if (preserveCallerToolDefinitions) {
            return {
                messages: normalizedMessages,
                additionalPayload,
                isBaseContextPrompt: true,
                sharedToolsApplied: false,
                callerToolDefinitionsPreserved: true,
                noToolCallsInstructionAdded
            };
        }

        return {
            messages: normalizedMessages,
            additionalPayload: {
                ...additionalPayload,
                tools: LLMClient.#resolveSharedBaseContextToolDefinitions(),
                tool_choice: explicitlyDisablesToolCalls ? 'none' : 'auto'
            },
            isBaseContextPrompt: true,
            sharedToolsApplied: true,
            noToolCallsInstructionAdded
        };
    }

    static expandPromptMessageBoundaries(messages = []) {
        if (!Array.isArray(messages)) {
            throw new Error('Prompt message-boundary expansion requires a messages array.');
        }

        const expandedMessages = [];
        let recentStoryBoundaryCount = 0;
        let sectionBoundaryCount = 0;
        let sourceMessageCount = 0;
        const boundaryDefinitions = [
            {
                marker: BASE_CONTEXT_SECTION_MESSAGE_BOUNDARY_MARKER,
                type: 'section'
            },
            {
                marker: RECENT_STORY_MESSAGE_BOUNDARY_MARKER,
                type: 'recent-story'
            }
        ];

        for (const message of messages) {
            const content = message?.content;
            if (typeof content !== 'string' || !boundaryDefinitions.some(({ marker }) => content.includes(marker))) {
                expandedMessages.push(message);
                continue;
            }

            const role = typeof message?.role === 'string'
                ? message.role.trim().toLowerCase()
                : '';
            if (role !== 'user') {
                throw new Error('Internal prompt message boundaries may only appear in a user message.');
            }

            sourceMessageCount += 1;
            if (sourceMessageCount > 1) {
                throw new Error('Internal prompt message boundaries must all appear in one source user message.');
            }

            const parts = [];
            let cursor = 0;
            while (cursor < content.length) {
                let nextBoundary = null;
                for (const definition of boundaryDefinitions) {
                    const index = content.indexOf(definition.marker, cursor);
                    if (index < 0 || (nextBoundary && index >= nextBoundary.index)) {
                        continue;
                    }
                    nextBoundary = { ...definition, index };
                }
                if (!nextBoundary) {
                    break;
                }

                parts.push(content.slice(cursor, nextBoundary.index));
                cursor = nextBoundary.index + nextBoundary.marker.length;
                if (nextBoundary.type === 'recent-story') {
                    recentStoryBoundaryCount += 1;
                } else {
                    sectionBoundaryCount += 1;
                }
            }
            parts.push(content.slice(cursor));

            if (recentStoryBoundaryCount > 1) {
                throw new Error('A prompt may contain only one recent-story message boundary.');
            }
            if (sectionBoundaryCount > MAX_BASE_CONTEXT_SECTION_MESSAGE_BOUNDARIES) {
                throw new Error(`A prompt may contain at most ${MAX_BASE_CONTEXT_SECTION_MESSAGE_BOUNDARIES} base-context section message boundaries.`);
            }
            if (parts.some(part => !part.trim())) {
                throw new Error('Internal prompt message boundaries require non-empty content between every boundary.');
            }

            expandedMessages.push(...parts.map(part => ({ ...message, content: part })));
        }

        return recentStoryBoundaryCount > 0 || sectionBoundaryCount > 0
            ? expandedMessages
            : messages;
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

    static #resolveSystemPromptAppend(configured) {
        if (configured === undefined || configured === null || configured === '') {
            return null;
        }
        if (typeof configured !== 'string') {
            throw LLMClient.#configurationError('ai.sysprompt_append must be a string or null when provided.');
        }
        const trimmed = configured.trim();
        return trimmed || null;
    }

    static #applySystemPromptAppend(messages, configuredAppend) {
        const appendText = LLMClient.#resolveSystemPromptAppend(configuredAppend);
        if (!appendText) {
            return messages;
        }
        if (!Array.isArray(messages) || messages.length === 0) {
            throw LLMClient.#configurationError('ai.sysprompt_append requires at least one request message.');
        }

        const appendedMessages = messages.slice();
        const appendMessage = {
            role: 'system',
            content: appendText
        };
        let lastSystemMessageIndex = -1;
        for (let index = 0; index < appendedMessages.length; index += 1) {
            const role = typeof appendedMessages[index]?.role === 'string'
                ? appendedMessages[index].role.trim().toLowerCase()
                : '';
            if (role === 'system') {
                lastSystemMessageIndex = index;
            }
        }

        if (lastSystemMessageIndex >= 0) {
            appendedMessages.splice(lastSystemMessageIndex + 1, 0, appendMessage);
        } else {
            appendedMessages.unshift(appendMessage);
        }
        return appendedMessages;
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
        output = 'stdout',
        filePath = null,
        append = false,
        responseLabel = 'RESPONSE',
        markResponseBoundaries = false,
        warnOnFailure = true
    } = {}) {
        const resolvedOutput = LLMClient.resolveOutput(output);
        const isSilent = resolvedOutput === 'silent';
        const outputConsole = resolvedOutput === 'stderr'
            ? new Console({ stdout: process.stderr, stderr: process.stderr })
            : new Console({ stdout: process.stdout, stderr: process.stdout });
        const statsHeaderLines = LLMClient.#buildPromptOutputCharacterStatsHeader(metadataLabel);
        try {
            const fs = require('fs');
            const path = require('path');
            const baseDir = Globals?.baseDir || process.cwd();
            const logDir = path.join(baseDir, 'logs');
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }

            let resolvedFilePath = null;
            if (filePath !== null && filePath !== undefined && filePath !== '') {
                if (typeof filePath !== 'string') {
                    throw new Error('Prompt log filePath must be a string when provided.');
                }
                resolvedFilePath = path.resolve(filePath);
                const resolvedLogDir = path.resolve(logDir);
                if (
                    resolvedFilePath !== resolvedLogDir
                    && !resolvedFilePath.startsWith(`${resolvedLogDir}${path.sep}`)
                ) {
                    throw new Error('Prompt log filePath must be inside the configured logs directory.');
                }
                if (append && !fs.existsSync(resolvedFilePath)) {
                    throw new Error(`Cannot append to missing prompt log file: ${resolvedFilePath}`);
                }
            } else {
                if (append) {
                    throw new Error('Prompt log append requires filePath.');
                }
                const safeLabel = metadataLabel
                    ? metadataLabel.replace(/[^a-z0-9_-]/gi, '_')
                    : 'unknown';
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                resolvedFilePath = path.join(logDir, `${timestamp}_${prefix}_${safeLabel}.log`);
            }

            const lines = [];
            if (!append) {
                lines.push(...statsHeaderLines);
            }

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
            if (!append && (resolvedModel || resolvedEndpoint || Number.isFinite(totalTokens))) {
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

            if (response || markResponseBoundaries) {
                const normalizedResponseLabel = typeof responseLabel === 'string' && responseLabel.trim()
                    ? responseLabel.trim().toUpperCase()
                    : 'RESPONSE';
                if (markResponseBoundaries) {
                    lines.push(
                        `=== ${normalizedResponseLabel} BEGIN ===`,
                        response || '',
                        `=== ${normalizedResponseLabel} END ===`,
                        ''
                    );
                } else {
                    lines.push(`=== ${normalizedResponseLabel} ===`, response, '');
                }
            }

            if (!lines.length) {
                return null;
            }

            const logText = lines.join('\n');
            if (append) {
                fs.appendFileSync(resolvedFilePath, `\n${logText}`, 'utf8');
            } else {
                fs.writeFileSync(resolvedFilePath, logText, 'utf8');
            }
            if (!isSilent) {
                outputConsole.log(`Prompt log written to ${resolvedFilePath}`);
            }
            return resolvedFilePath;
        } catch (error) {
            const errorMessage = error?.message || String(error);
            if (warnOnFailure) {
                console.warn(`Prompt logging warning: failed to write prompt log file: ${errorMessage}`);
            }
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

    static #normalizePromptProgressTargetPatternKey(pattern) {
        if (typeof pattern !== 'string') {
            return { wildcard: false, key: '' };
        }
        const trimmed = pattern.trim().toLowerCase();
        if (!trimmed) {
            return { wildcard: false, key: '' };
        }
        const wildcard = trimmed.endsWith('*');
        const body = wildcard ? trimmed.slice(0, -1) : trimmed;
        let normalized = body
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+/, '');
        if (!wildcard) {
            normalized = normalized.replace(/_+$/g, '');
        }
        return { wildcard, key: normalized };
    }

    static #getPromptProgressCharacterTargets(config = Globals?.config) {
        const promptProgressConfig = config?.prompt_progress;
        if (promptProgressConfig === undefined || promptProgressConfig === null) {
            return null;
        }
        if (!promptProgressConfig || typeof promptProgressConfig !== 'object' || Array.isArray(promptProgressConfig)) {
            throw new Error('config.prompt_progress must be an object when configured.');
        }
        const targets = promptProgressConfig.character_targets;
        if (targets === undefined || targets === null) {
            return null;
        }
        if (!targets || typeof targets !== 'object' || Array.isArray(targets)) {
            throw new Error('config.prompt_progress.character_targets must be an object.');
        }
        return targets;
    }

    static #hasPromptProgressCharacterTargetsConfigured(config = Globals?.config) {
        return LLMClient.#getPromptProgressCharacterTargets(config) !== null;
    }

    static resolvePromptProgressCharacterTarget(label, config = Globals?.config) {
        const normalizedLabel = LLMClient.#normalizePromptLabel(label);
        if (!normalizedLabel) {
            throw new Error('Prompt progress character target resolution requires a prompt label.');
        }

        const targets = LLMClient.#getPromptProgressCharacterTargets(config);
        if (!targets) {
            throw new Error('config.prompt_progress.character_targets is required for prompt progress tracking.');
        }

        const exactTargets = new Map();
        const prefixTargets = [];
        for (const [rawPattern, rawTarget] of Object.entries(targets)) {
            const numericTarget = Number(rawTarget);
            if (!Number.isFinite(numericTarget) || numericTarget <= 0) {
                throw new Error(`Prompt progress character target "${rawPattern}" must be a finite number > 0.`);
            }
            const { wildcard, key } = LLMClient.#normalizePromptProgressTargetPatternKey(rawPattern);
            if (!key) {
                throw new Error(`Prompt progress character target "${rawPattern}" has an empty label pattern.`);
            }
            if (wildcard) {
                prefixTargets.push({ prefix: key, target: numericTarget, rawPattern });
            } else {
                exactTargets.set(key, numericTarget);
            }
        }

        if (exactTargets.has(normalizedLabel)) {
            return exactTargets.get(normalizedLabel);
        }

        let match = null;
        for (const candidate of prefixTargets) {
            if (!normalizedLabel.startsWith(candidate.prefix)) {
                continue;
            }
            if (!match || candidate.prefix.length > match.prefix.length) {
                match = candidate;
            }
        }
        if (match) {
            return match.target;
        }

        throw LLMClient.#configurationError(
            `Missing prompt_progress.character_targets character target for prompt label "${normalizedLabel}".`
        );
    }

    static #resolvePromptProgressTargetForRun(label, characterStats) {
        const configuredTarget = LLMClient.#hasPromptProgressCharacterTargetsConfigured()
            ? LLMClient.resolvePromptProgressCharacterTarget(label)
            : null;
        const averageOutputCharacters = Number(characterStats?.averageOutputCharacters);
        if (Number.isFinite(averageOutputCharacters) && averageOutputCharacters > 0) {
            return averageOutputCharacters;
        }
        return configuredTarget;
    }

    static calculatePromptProgressFraction(receivedCharacters, targetCharacters) {
        const received = Number(receivedCharacters);
        if (!Number.isFinite(received) || received < 0) {
            throw new Error('Prompt progress received characters must be a finite number >= 0.');
        }
        const target = Number(targetCharacters);
        if (!Number.isFinite(target) || target <= 0) {
            throw new Error('Prompt progress target characters must be a finite number > 0.');
        }
        if (received <= target) {
            return 0.75 * (received / target);
        }
        return 0.75 + 0.25 * (1 - (0.5 ** ((received - target) / target)));
    }

    static #getPromptOutputCharacterStatsPath() {
        const baseDir = Globals?.baseDir || process.cwd();
        return path.join(baseDir, 'logs', PROMPT_OUTPUT_CHARACTER_STATS_FILENAME);
    }

    static #createEmptyPromptOutputCharacterStatsFile() {
        return {
            version: PROMPT_OUTPUT_CHARACTER_STATS_VERSION,
            updatedAt: null,
            prompts: {}
        };
    }

    static #assertPromptOutputCharacterStatNumber(value, pathLabel, { integer = true, allowNull = false } = {}) {
        if (value === null && allowNull) {
            return;
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
            throw new Error(`Prompt output character stats invalid numeric value at ${pathLabel}.`);
        }
        if (integer && !Number.isInteger(value)) {
            throw new Error(`Prompt output character stats invalid numeric value at ${pathLabel}; expected an integer.`);
        }
    }

    static #validatePromptOutputCharacterStatsFile(stats, statsPath) {
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
            throw new Error(`Prompt output character stats file must contain an object: ${statsPath}`);
        }
        if (stats.version !== PROMPT_OUTPUT_CHARACTER_STATS_VERSION) {
            throw new Error(
                `Prompt output character stats file has unsupported version at ${statsPath}; `
                + `expected ${PROMPT_OUTPUT_CHARACTER_STATS_VERSION}.`
            );
        }
        if (!(stats.updatedAt === null || typeof stats.updatedAt === 'string')) {
            throw new Error(`Prompt output character stats updatedAt must be a string or null: ${statsPath}`);
        }
        if (!stats.prompts || typeof stats.prompts !== 'object' || Array.isArray(stats.prompts)) {
            throw new Error(`Prompt output character stats prompts must be an object: ${statsPath}`);
        }
        for (const [rawLabel, entry] of Object.entries(stats.prompts)) {
            const normalizedLabel = LLMClient.#normalizePromptLabel(rawLabel);
            if (!normalizedLabel || rawLabel !== normalizedLabel) {
                throw new Error(`Prompt output character stats prompt key "${rawLabel}" must be a normalized prompt label.`);
            }
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                throw new Error(`Prompt output character stats entry for "${rawLabel}" must be an object.`);
            }
            LLMClient.#assertPromptOutputCharacterStatNumber(entry.runs, `prompts.${rawLabel}.runs`);
            LLMClient.#assertPromptOutputCharacterStatNumber(
                entry.totalOutputCharacters,
                `prompts.${rawLabel}.totalOutputCharacters`
            );
            LLMClient.#assertPromptOutputCharacterStatNumber(
                entry.averageOutputCharacters,
                `prompts.${rawLabel}.averageOutputCharacters`,
                { integer: false, allowNull: true }
            );
            LLMClient.#assertPromptOutputCharacterStatNumber(
                entry.lastOutputCharacters,
                `prompts.${rawLabel}.lastOutputCharacters`,
                { allowNull: true }
            );
            if (!(entry.updatedAt === null || typeof entry.updatedAt === 'string')) {
                throw new Error(`Prompt output character stats updatedAt for "${rawLabel}" must be a string or null.`);
            }
            if (entry.runs === 0) {
                if (
                    entry.totalOutputCharacters !== 0
                    || entry.averageOutputCharacters !== null
                    || entry.lastOutputCharacters !== null
                    || entry.updatedAt !== null
                ) {
                    throw new Error(`Prompt output character stats entry for "${rawLabel}" is inconsistent for zero runs.`);
                }
            } else if (entry.averageOutputCharacters === null || entry.lastOutputCharacters === null) {
                throw new Error(`Prompt output character stats entry for "${rawLabel}" is missing run values.`);
            }
        }
    }

    static #loadPromptOutputCharacterStats() {
        const statsPath = LLMClient.#getPromptOutputCharacterStatsPath();
        if (
            LLMClient.#promptOutputCharacterStats
            && LLMClient.#promptOutputCharacterStatsPath === statsPath
        ) {
            return LLMClient.#promptOutputCharacterStats;
        }

        let stats;
        if (!fs.existsSync(statsPath)) {
            stats = LLMClient.#createEmptyPromptOutputCharacterStatsFile();
        } else {
            const raw = fs.readFileSync(statsPath, 'utf8');
            try {
                stats = JSON.parse(raw);
            } catch (error) {
                throw new Error(`Prompt output character stats invalid JSON at ${statsPath}: ${error.message}`);
            }
            LLMClient.#validatePromptOutputCharacterStatsFile(stats, statsPath);
        }
        stats = LLMClient.#canonicalizePromptOutputCharacterStatsFile(stats);
        LLMClient.#validatePromptOutputCharacterStatsFile(stats, statsPath);

        LLMClient.#promptOutputCharacterStats = stats;
        LLMClient.#promptOutputCharacterStatsPath = statsPath;
        return stats;
    }

    static #writePromptOutputCharacterStats(stats) {
        const statsPath = LLMClient.#getPromptOutputCharacterStatsPath();
        const logDir = path.dirname(statsPath);
        fs.mkdirSync(logDir, { recursive: true });
        LLMClient.#validatePromptOutputCharacterStatsFile(stats, statsPath);
        const tmpPath = `${statsPath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmpPath, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
        fs.renameSync(tmpPath, statsPath);
        LLMClient.#promptOutputCharacterStats = stats;
        LLMClient.#promptOutputCharacterStatsPath = statsPath;
    }

    static #emptyPromptOutputCharacterStatsEntry() {
        return {
            runs: 0,
            totalOutputCharacters: 0,
            averageOutputCharacters: null,
            lastOutputCharacters: null,
            updatedAt: null
        };
    }

    static #resolvePromptOutputCharacterStatsLabel(label) {
        const normalizedLabel = LLMClient.#normalizePromptLabel(label);
        if (!normalizedLabel) {
            return '';
        }
        for (const baseLabel of PROMPT_OUTPUT_CHARACTER_STATS_BASE_LABEL_PREFIXES) {
            if (normalizedLabel === baseLabel || normalizedLabel.startsWith(`${baseLabel}_`)) {
                return baseLabel;
            }
        }
        return normalizedLabel;
    }

    static #mergePromptOutputCharacterStatsEntry(existingEntry, nextEntry) {
        if (!existingEntry) {
            return { ...nextEntry };
        }
        const runs = existingEntry.runs + nextEntry.runs;
        const totalOutputCharacters = existingEntry.totalOutputCharacters + nextEntry.totalOutputCharacters;
        let latest = existingEntry;
        const existingUpdatedAt = typeof existingEntry.updatedAt === 'string' ? existingEntry.updatedAt : '';
        const nextUpdatedAt = typeof nextEntry.updatedAt === 'string' ? nextEntry.updatedAt : '';
        if (nextUpdatedAt && (!existingUpdatedAt || nextUpdatedAt >= existingUpdatedAt)) {
            latest = nextEntry;
        }

        return {
            runs,
            totalOutputCharacters,
            averageOutputCharacters: runs > 0 ? totalOutputCharacters / runs : null,
            lastOutputCharacters: runs > 0 ? latest.lastOutputCharacters : null,
            updatedAt: runs > 0 ? latest.updatedAt : null
        };
    }

    static #canonicalizePromptOutputCharacterStatsFile(stats) {
        const canonicalPrompts = {};
        for (const [rawLabel, entry] of Object.entries(stats.prompts)) {
            const statsLabel = LLMClient.#resolvePromptOutputCharacterStatsLabel(rawLabel);
            if (!statsLabel) {
                throw new Error(`Prompt output character stats prompt key "${rawLabel}" must resolve to a prompt label.`);
            }
            canonicalPrompts[statsLabel] = LLMClient.#mergePromptOutputCharacterStatsEntry(
                canonicalPrompts[statsLabel],
                entry
            );
        }
        return {
            ...stats,
            prompts: canonicalPrompts
        };
    }

    static #normalizePromptProgressTargetPatternDisplay(pattern) {
        const { wildcard, key } = LLMClient.#normalizePromptProgressTargetPatternKey(pattern);
        if (!key) {
            throw new Error(`Prompt progress character target "${pattern}" has an empty label pattern.`);
        }
        if (wildcard) {
            for (const baseLabel of PROMPT_OUTPUT_CHARACTER_STATS_BASE_LABEL_PREFIXES) {
                if (key === baseLabel || key === `${baseLabel}_`) {
                    return baseLabel;
                }
            }
        }
        return wildcard ? `${key}*` : key;
    }

    static getPromptOutputCharacterStats(label) {
        const normalizedLabel = LLMClient.#normalizePromptLabel(label);
        if (!normalizedLabel) {
            throw new Error('Prompt output character stats require a prompt label.');
        }
        const statsLabel = LLMClient.#resolvePromptOutputCharacterStatsLabel(normalizedLabel);
        const stats = LLMClient.#loadPromptOutputCharacterStats();
        const entry = stats.prompts[statsLabel];
        if (!entry) {
            return LLMClient.#emptyPromptOutputCharacterStatsEntry();
        }
        return { ...entry };
    }

    static listPromptOutputCharacterStats({ includeConfiguredTargets = true } = {}) {
        const stats = LLMClient.#loadPromptOutputCharacterStats();
        const rowsByLabel = new Map();

        const addRow = (label, entry, targetCharacters = null) => {
            const promptLabel = typeof label === 'string' ? label.trim() : '';
            if (!promptLabel) {
                throw new Error('Prompt output character stats list encountered an empty prompt label.');
            }
            const sourceEntry = entry || LLMClient.#emptyPromptOutputCharacterStatsEntry();
            rowsByLabel.set(promptLabel, {
                prompt: promptLabel,
                runs: sourceEntry.runs,
                totalOutputCharacters: sourceEntry.totalOutputCharacters,
                averageOutputCharacters: sourceEntry.averageOutputCharacters,
                lastOutputCharacters: sourceEntry.lastOutputCharacters,
                updatedAt: sourceEntry.updatedAt,
                targetCharacters
            });
        };

        for (const [label, entry] of Object.entries(stats.prompts)) {
            addRow(label, entry);
        }

        if (includeConfiguredTargets) {
            const targets = LLMClient.#getPromptProgressCharacterTargets();
            if (targets) {
                for (const [rawPattern, rawTarget] of Object.entries(targets)) {
                    const targetCharacters = Number(rawTarget);
                    if (!Number.isFinite(targetCharacters) || targetCharacters <= 0) {
                        throw new Error(`Prompt progress character target "${rawPattern}" must be a finite number > 0.`);
                    }
                    const displayLabel = LLMClient.#normalizePromptProgressTargetPatternDisplay(rawPattern);
                    if (rowsByLabel.has(displayLabel)) {
                        rowsByLabel.get(displayLabel).targetCharacters = targetCharacters;
                    } else {
                        addRow(displayLabel, LLMClient.#emptyPromptOutputCharacterStatsEntry(), targetCharacters);
                    }
                }
            }
        }

        return Array.from(rowsByLabel.values())
            .sort((a, b) => a.prompt.localeCompare(b.prompt));
    }

    static clearPromptOutputCharacterStats() {
        const currentStats = LLMClient.#loadPromptOutputCharacterStats();
        const clearedPromptCount = Object.keys(currentStats.prompts).length;
        const stats = LLMClient.#createEmptyPromptOutputCharacterStatsFile();
        stats.updatedAt = new Date().toISOString();
        LLMClient.#writePromptOutputCharacterStats(stats);
        return {
            clearedPromptCount,
            updatedAt: stats.updatedAt
        };
    }

    static recordPromptOutputCharacters(label, outputCharacters) {
        const normalizedLabel = LLMClient.#normalizePromptLabel(label);
        if (!normalizedLabel) {
            throw new Error('Prompt output character stats require a prompt label.');
        }
        if (LLMClient.#hasPromptProgressCharacterTargetsConfigured()) {
            LLMClient.resolvePromptProgressCharacterTarget(normalizedLabel);
        }
        const characterCount = Number(outputCharacters);
        if (!Number.isFinite(characterCount) || characterCount < 0 || !Number.isInteger(characterCount)) {
            throw new Error('Prompt output character count must be a finite integer >= 0.');
        }

        const stats = LLMClient.#loadPromptOutputCharacterStats();
        const statsLabel = LLMClient.#resolvePromptOutputCharacterStatsLabel(normalizedLabel);
        const previous = stats.prompts[statsLabel] || LLMClient.#emptyPromptOutputCharacterStatsEntry();
        const updatedAt = new Date().toISOString();
        const runs = previous.runs + 1;
        const totalOutputCharacters = previous.totalOutputCharacters + characterCount;
        stats.prompts[statsLabel] = {
            runs,
            totalOutputCharacters,
            averageOutputCharacters: totalOutputCharacters / runs,
            lastOutputCharacters: characterCount,
            updatedAt
        };
        stats.updatedAt = updatedAt;
        LLMClient.#writePromptOutputCharacterStats(stats);
        return { ...stats.prompts[statsLabel] };
    }

    static resetPromptOutputCharacterStatsForTests() {
        LLMClient.#promptOutputCharacterStats = null;
        LLMClient.#promptOutputCharacterStatsPath = null;
    }

    static resetLiveTokenStreamCapabilitiesForTests() {
        LLMClient.#failedLiveTokenStreamCapabilityKeys.clear();
    }

    static #buildPromptOutputCharacterStatsHeader(metadataLabel) {
        const normalizedLabel = LLMClient.#normalizePromptLabel(metadataLabel) || 'unknown';
        const statsLabel = LLMClient.#resolvePromptOutputCharacterStatsLabel(normalizedLabel) || normalizedLabel;
        const stats = LLMClient.getPromptOutputCharacterStats(normalizedLabel);
        const lines = [
            '=== PROMPT OUTPUT CHARACTER STATS ===',
            `Prompt: ${statsLabel}`,
            `Runs: ${stats.runs}`,
            `Average Output Characters: ${stats.averageOutputCharacters === null ? 'null' : stats.averageOutputCharacters}`
        ];
        if (statsLabel !== normalizedLabel) {
            lines.push(`Source Prompt: ${normalizedLabel}`);
        }
        if (stats.lastOutputCharacters !== null) {
            lines.push(`Latest Output Characters: ${stats.lastOutputCharacters}`);
        }
        lines.push('');
        return lines;
    }

    static #recordSuccessfulCompletionOutputCharacters(metadataLabel, responseContent, { toolCalls = [] } = {}) {
        const normalizedLabel = LLMClient.#normalizePromptLabel(metadataLabel);
        if (!normalizedLabel) {
            return null;
        }
        const outputCharacters = LLMClient.#countTextCharacters(responseContent);
        if (outputCharacters === 0 && Array.isArray(toolCalls) && toolCalls.length > 0) {
            return null;
        }
        return LLMClient.recordPromptOutputCharacters(normalizedLabel, outputCharacters);
    }

    static resetForcedOutputState() {
        if (
            LLMClient.#completionCassetteSemaphore.current > 0
            || LLMClient.#completionCassetteSemaphore.queue.length > 0
        ) {
            throw new Error('Cannot reset forced-output state while completion cassette requests are active or queued.');
        }
        LLMClient.#forcedOutputFixtureSource = null;
        LLMClient.#forcedOutputFixtureData = null;
        LLMClient.#forcedOutputLabelCounters = new Map();
        LLMClient.#completionCassetteSemaphore = new Semaphore(1);
        LLMCompletionCassette.resetRuntimeState();
    }

    static #getCompletionCassetteSerializationStatus() {
        return {
            active: LLMClient.#completionCassetteSemaphore.current > 0,
            queued: LLMClient.#completionCassetteSemaphore.queue.length
        };
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
        if (LLMCompletionCassette.isVersion2Document(parsed)) {
            return LLMCompletionCassette.parseReplayDocument(parsed, {
                sourcePath,
                resolvedPath
            });
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

    static #resolveForcedOutputFromFixture(metadataLabel = '', requestDescriptor = null) {
        const fixture = LLMClient.#getForcedOutputFixture();
        if (!fixture) {
            return null;
        }

        if (fixture.version === LLMCompletionCassette.version) {
            if (!requestDescriptor) {
                throw new Error('Version 2 completion cassette replay requires a request descriptor.');
            }
            const lease = LLMCompletionCassette.beginReplay(fixture, requestDescriptor);
            return {
                [COMPLETION_CASSETTE_RESOLUTION]: true,
                output: lease.response,
                lease
            };
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

    static getCompletionCassetteStatus() {
        const serialization = LLMClient.#getCompletionCassetteSerializationStatus();
        const replaySource = LLMClient.#resolveForcedOutputFixturePath();
        let replay = { active: false, version: null };
        if (replaySource) {
            const fixture = LLMClient.#getForcedOutputFixture();
            if (fixture?.version === LLMCompletionCassette.version) {
                replay = LLMCompletionCassette.getReplayStatus(fixture);
            } else if (fixture) {
                let total = 0;
                for (const entries of fixture.groups.values()) {
                    total += entries.length;
                }
                replay = {
                    active: true,
                    version: 1,
                    sourcePath: fixture.sourcePath,
                    resolvedPath: fixture.resolvedPath,
                    strict: fixture.strict === true,
                    total,
                    consumed: Array.from(LLMClient.#forcedOutputLabelCounters.values())
                        .reduce((sum, count) => sum + count, 0),
                    allConsumed: null
                };
            }
        }
        const recordingSource = LLMCompletionCassette.resolveRecordingSource(Globals?.config);
        const recording = LLMCompletionCassette.getRecordingStatus({
            sourcePath: recordingSource,
            baseDir: Globals?.baseDir || process.cwd()
        });
        if (replay.active) {
            replay.completionActive = replay.completionActive === true || serialization.active;
            replay.completionQueued = serialization.queued;
        }
        if (recording.active) {
            recording.completionActive = recording.completionActive === true || serialization.active;
            recording.completionQueued = serialization.queued;
        }
        return { replay, recording, serialization };
    }

    static assertCompletionCassetteConsumed() {
        const status = LLMClient.getCompletionCassetteStatus().replay;
        if (!status.active) {
            throw new Error('No completion cassette replay is active.');
        }
        if (status.version !== LLMCompletionCassette.version) {
            throw new Error('Completion cassette consumption assertions require a version 2 replay.');
        }
        if (status.completionActive) {
            throw new Error('Cannot assert completion cassette consumption while a completion is active.');
        }
        if (status.completionQueued > 0) {
            throw new Error(
                `Cannot assert completion cassette consumption while ${status.completionQueued} completion request`
                + `${status.completionQueued === 1 ? ' is' : 's are'} queued.`
            );
        }
        if (status.failureCount > 0) {
            throw new Error(
                `Completion cassette replay recorded ${status.failureCount} strict failure`
                + `${status.failureCount === 1 ? '' : 's'}; last failure: `
                + `${status.lastFailure?.message || 'unknown replay failure'}`
            );
        }
        if (!status.allConsumed) {
            throw new Error(
                `Completion cassette has ${status.remaining} unused entr${status.remaining === 1 ? 'y' : 'ies'} `
                + `(consumed=${status.consumed}, total=${status.total}).`
            );
        }
        return status;
    }

    static completeCompletionCassetteRecording({ description = undefined } = {}) {
        const sourcePath = LLMCompletionCassette.resolveRecordingSource(Globals?.config);
        if (!sourcePath) {
            throw new Error('No completion cassette recording destination is configured.');
        }
        const serialization = LLMClient.#getCompletionCassetteSerializationStatus();
        if (serialization.active || serialization.queued > 0) {
            throw new Error(
                'Cannot complete a cassette while completion requests are active or queued '
                + `(active=${serialization.active}, queued=${serialization.queued}).`
            );
        }
        return LLMCompletionCassette.completeRecording({
            sourcePath,
            baseDir: Globals?.baseDir || process.cwd(),
            description
        });
    }

    static resetIncompleteCompletionCassetteRecording({ description = undefined } = {}) {
        const sourcePath = LLMCompletionCassette.resolveRecordingSource(Globals?.config);
        if (!sourcePath) {
            throw new Error('No completion cassette recording destination is configured.');
        }
        const serialization = LLMClient.#getCompletionCassetteSerializationStatus();
        if (serialization.active || serialization.queued > 0) {
            throw new Error(
                'Cannot reset a cassette while completion requests are active or queued '
                + `(active=${serialization.active}, queued=${serialization.queued}).`
            );
        }
        return LLMCompletionCassette.resetIncompleteRecording({
            sourcePath,
            baseDir: Globals?.baseDir || process.cwd(),
            description
        });
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

    static #resolveEffectiveAiConfiguration(metadataLabel, globalConfig = Globals?.config) {
        const source = globalConfig?.ai;
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            throw new Error('Globals.config.ai is not set; AI configuration unavailable.');
        }

        let aiConfig;
        try {
            aiConfig = JSON.parse(JSON.stringify(source));
        } catch (error) {
            throw new Error(`Failed to clone AI configuration: ${error.message}`);
        }

        const { overrides, profiles } = LLMClient.#resolveAiModelOverrides(metadataLabel, globalConfig);
        let overrideCustomArgs;
        let overrideHeaders;
        if (overrides) {
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

        return {
            aiConfig,
            overrideCustomArgs,
            overrideHeaders,
            profiles
        };
    }

    static resolveEffectiveAiConfiguration(metadataLabel, globalConfig = Globals?.config) {
        return LLMClient.#resolveEffectiveAiConfiguration(metadataLabel, globalConfig);
    }

    static async resolveOpenAICompatibleModelManagementTarget(metadataLabel = 'image_prompt_generation') {
        const resolved = LLMClient.#resolveEffectiveAiConfiguration(metadataLabel, Globals?.config);
        const aiConfig = resolved.aiConfig;
        if (aiConfig.unload_during_image_generation !== true) {
            throw new Error(
                `AI model unload lifecycle is not enabled for prompt label "${metadataLabel}".`
            );
        }
        const backend = LLMClient.resolveBackend(aiConfig);
        if (backend !== 'openai_compatible') {
            throw new Error(
                'ai.unload_during_image_generation requires the openai_compatible backend and a llama.cpp router endpoint.'
            );
        }

        const model = typeof aiConfig.model === 'string' ? aiConfig.model.trim() : '';
        if (!model) {
            throw new Error('ai.unload_during_image_generation requires a configured AI model.');
        }
        return LLMClient.#buildOpenAICompatibleRouterTarget({
            aiConfig,
            model,
            overrideHeaders: resolved.overrideHeaders
        });
    }

    static async resolveRouterPreloadTarget(configOverride = Globals?.config) {
        const aiConfig = configOverride?.ai;
        if (!aiConfig || typeof aiConfig !== 'object' || Array.isArray(aiConfig)) {
            throw new Error('Router model preloading requires ai configuration.');
        }
        if (LLMClient.resolveBackend(aiConfig) !== 'openai_compatible') {
            throw new Error('Router model preloading requires the openai_compatible backend.');
        }
        return LLMClient.#buildOpenAICompatibleRouterTarget({
            aiConfig,
            model: LLMClient.resolveRouterPreloadModel(configOverride)
        });
    }

    static async #buildOpenAICompatibleRouterTarget({
        aiConfig,
        model,
        overrideHeaders = null
    } = {}) {
        const endpoint = LLMClient.resolveChatEndpoint(aiConfig.endpoint);
        const effectiveHeaders = LLMClient.#buildEffectiveHeaders({
            baseHeaders: aiConfig.headers,
            overrideHeaders
        });
        const oauthKey = LLMClient.#normalizeOAuthKey(aiConfig);
        const oauthUrl = oauthKey ? LLMClient.#normalizeOAuthUrl(aiConfig) : null;
        const oauthClientId = oauthKey ? LLMClient.#normalizeOAuthClientId(aiConfig) : null;
        if (oauthKey && !oauthUrl) {
            throw new Error('ai.oauth-url is required when ai.oauth-key is configured.');
        }
        const oauthConfig = oauthKey
            ? { refreshToken: oauthKey, tokenUrl: oauthUrl, clientId: oauthClientId }
            : null;
        const apiKey = oauthConfig
            ? await LLMClient.#resolveOAuthAccessToken(oauthConfig, effectiveHeaders)
            : aiConfig.apiKey;
        if (typeof apiKey !== 'string' || !apiKey.trim()) {
            throw new Error('AI API key is not configured for llama.cpp router model management.');
        }

        const headers = {
            'Content-Type': 'application/json',
            ...effectiveHeaders
        };
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === 'authorization') {
                delete headers[key];
            }
        }
        headers.Authorization = `Bearer ${apiKey.trim()}`;

        return {
            endpoint,
            model,
            headers,
            timeoutMs: LLMClient.resolveTimeout(null, 1),
            isLocalRouter: typeof aiConfig.local_startup_script_path === 'string'
                && Boolean(aiConfig.local_startup_script_path.trim()),
            slotCacheDirectory: LLMClient.resolveRouterSlotCacheDirectory(aiConfig)
        };
    }

    static async preloadRouterModel({
        configOverride = Globals?.config,
        createRouterClient = options => new LlamaCppRouterClient(options),
        logger = console
    } = {}) {
        if (!LLMClient.shouldPreloadRouterModel(configOverride)) {
            return null;
        }
        if (typeof createRouterClient !== 'function') {
            throw new Error('Router model preloading requires createRouterClient().');
        }
        if (!logger || typeof logger.log !== 'function') {
            throw new Error('Router model preloading logger must expose log().');
        }

        const target = await LLMClient.resolveRouterPreloadTarget(configOverride);
        LLMClient.#trackRouterContextCacheTarget(target);
        return LLMClient.withExclusiveModelLifecycle(async () => {
            const router = createRouterClient(target);
            if (!router || typeof router.loadModelIfNeeded !== 'function') {
                throw new Error('Router model preloading requires a client with loadModelIfNeeded().');
            }
            const loadState = await router.loadModelIfNeeded();
            const routerBaseUrl = LlamaCppRouterClient.resolveRouterBaseUrl(target.endpoint);
            LLMClient.#lastPromptModelTarget = {
                key: `${routerBaseUrl}\n${target.model}`,
                endpoint: target.endpoint,
                model: target.model,
                headers: { ...(target.headers || {}) },
                timeoutMs: target.timeoutMs,
                isLocalRouter: target.isLocalRouter,
                slotCacheDirectory: target.slotCacheDirectory
            };
            if (loadState.loadedByClient) {
                logger.log(`🧠 Preloaded llama.cpp router model "${target.model}".`);
            } else {
                logger.log(`🧠 llama.cpp router model "${target.model}" was already active or loading.`);
            }
            return { target, ...loadState };
        });
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

    static #resolveReasoningEffort({ explicit, payloadValue, configured } = {}) {
        const candidate = explicit !== undefined && explicit !== null && explicit !== ''
            ? explicit
            : (payloadValue !== undefined && payloadValue !== null && payloadValue !== ''
                ? payloadValue
                : configured);
        if (candidate === undefined || candidate === null || candidate === '') {
            return null;
        }
        if (typeof candidate !== 'string') {
            throw new Error('reasoningEffort/reasoning_effort must be a string when provided.');
        }
        const trimmed = candidate.trim();
        return trimmed || null;
    }

    static #assistantPrefillError(message) {
        const error = new Error(message);
        error.isAssistantPrefillError = true;
        return error;
    }

    static #configurationError(message) {
        const error = new Error(message);
        error.isConfigurationError = true;
        return error;
    }

    static #resolveAssistantPrefill({
        prefill,
        assistantResponseSeed,
        configured
    } = {}) {
        const hasPrefillOption = prefill !== undefined;
        const hasAssistantResponseSeedOption = assistantResponseSeed !== undefined;
        if (
            hasPrefillOption
            && hasAssistantResponseSeedOption
            && prefill !== assistantResponseSeed
        ) {
            throw LLMClient.#assistantPrefillError(
                'chatCompletion received both prefill and assistantResponseSeed with different values.'
            );
        }

        const candidate = hasAssistantResponseSeedOption
            ? assistantResponseSeed
            : (hasPrefillOption ? prefill : configured);
        if (candidate === undefined || candidate === null || candidate === '') {
            return null;
        }
        if (typeof candidate !== 'string') {
            throw LLMClient.#assistantPrefillError(
                'chatCompletion prefill/assistantResponseSeed must be a string or null when provided.'
            );
        }
        return candidate.trim() ? candidate : null;
    }

    static #payloadHasToolDefinitions(payload) {
        if (!payload || typeof payload !== 'object') {
            return false;
        }
        return (Array.isArray(payload.tools) && payload.tools.length > 0)
            || (Array.isArray(payload.functions) && payload.functions.length > 0);
    }

    static #appendAssistantPrefillMessage(messages, prefill) {
        if (!prefill) {
            return messages;
        }
        if (!Array.isArray(messages) || messages.length === 0) {
            throw LLMClient.#assistantPrefillError(
                'Assistant response prefill requires at least one request message.'
            );
        }
        return [
            ...messages,
            {
                role: 'assistant',
                content: prefill
            }
        ];
    }

    static #mergeAssistantPrefillWithResponse(prefill, responseContent) {
        if (!prefill) {
            return responseContent;
        }
        const text = typeof responseContent === 'string' ? responseContent : '';
        if (!text) {
            return prefill;
        }
        if (text.startsWith(prefill)) {
            return text;
        }
        return `${prefill}${text}`;
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
        waitAfterNetworkError = null,
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
        reasoningEffort = null,
        prefill = undefined,
        assistantResponseSeed = undefined,
        queueReservation = null,
        progressGroupId = null,
        progressGroupTargetLabel = null,
        onStreamToken = null,
        nonStreamTokenChunkSize = null,
        liveTokenStreamFallbackChunkSize = null,
        liveTokenStreamCapabilityKey = null,
        onLiveTokenStreamFallback = null,
        preserveBaseContextToolDefinitions = false,
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
                waitAfterNetworkError,
                dumpReasoningToConsole,
                seed,
                topP,
                multimodal,
                reasoningEffort,
                prefill,
                assistantResponseSeed,
                progressGroupId,
                progressGroupTargetLabel,
                preserveBaseContextToolDefinitions,
                forceOutput: forceOutput !== null && forceOutput !== undefined ? '[provided]' : null
            });
        }
        const inheritedProgressGroup = LLMClient.#promptProgressGroupContext.getStore() || null;
        const inheritedXmlRepetitionFix = LLMClient.#tinyBrainXmlRepetitionContext.getStore() || null;
        const normalizedMetadataLabel = LLMClient.#normalizePromptLabel(metadataLabel);
        const activeXmlRepetitionFix = inheritedXmlRepetitionFix
            && inheritedXmlRepetitionFix.metadataLabel === normalizedMetadataLabel
            ? inheritedXmlRepetitionFix
            : null;
        if (
            inheritedProgressGroup
            && progressGroupId !== null
            && progressGroupId !== undefined
            && (
                typeof progressGroupId !== 'string'
                || progressGroupId.trim() !== inheritedProgressGroup.progressGroupId
            )
        ) {
            throw new Error('chatCompletion progressGroupId conflicts with its inherited prompt progress group.');
        }
        if (
            inheritedProgressGroup
            && progressGroupTargetLabel !== null
            && progressGroupTargetLabel !== undefined
            && (
                typeof progressGroupTargetLabel !== 'string'
                || LLMClient.#normalizePromptLabel(progressGroupTargetLabel)
                    !== inheritedProgressGroup.progressGroupTargetLabel
            )
        ) {
            throw new Error('chatCompletion progressGroupTargetLabel conflicts with its inherited prompt progress group.');
        }
        const effectiveProgressGroupId = progressGroupId ?? inheritedProgressGroup?.progressGroupId ?? null;
        const effectiveProgressGroupTargetLabel = progressGroupTargetLabel
            ?? inheritedProgressGroup?.progressGroupTargetLabel
            ?? null;
        const resolvedProgressGroupId = (() => {
            if (effectiveProgressGroupId === null || effectiveProgressGroupId === undefined) {
                return null;
            }
            if (typeof effectiveProgressGroupId !== 'string' || !effectiveProgressGroupId.trim()) {
                throw new Error('chatCompletion progressGroupId must be a non-empty string when provided.');
            }
            return effectiveProgressGroupId.trim();
        })();
        const resolvedProgressGroupTargetLabel = (() => {
            if (effectiveProgressGroupTargetLabel === null || effectiveProgressGroupTargetLabel === undefined) {
                if (resolvedProgressGroupId) {
                    throw new Error('chatCompletion progressGroupTargetLabel is required with progressGroupId.');
                }
                return null;
            }
            if (!resolvedProgressGroupId) {
                throw new Error('chatCompletion progressGroupTargetLabel requires progressGroupId.');
            }
            if (typeof effectiveProgressGroupTargetLabel !== 'string' || !effectiveProgressGroupTargetLabel.trim()) {
                throw new Error('chatCompletion progressGroupTargetLabel must be a non-empty string when provided.');
            }
            const normalizedLabel = LLMClient.#normalizePromptLabel(effectiveProgressGroupTargetLabel);
            if (!normalizedLabel) {
                throw new Error('chatCompletion progressGroupTargetLabel must resolve to a prompt label.');
            }
            return normalizedLabel;
        })();
        const completionCassetteSerializationEnabled = Boolean(
            LLMCompletionCassette.resolveRecordingSource(Globals?.config)
            || LLMClient.#resolveForcedOutputFixturePath()
        );
        const promptQueueReservationState = LLMClient.#beginPromptQueueReservationRequest(queueReservation);
        let completionCassetteSerializationPermit = null;
        if (completionCassetteSerializationEnabled) {
            if (promptQueueReservationState) {
                await LLMClient.#retainPromptQueueReservationCompletionCassettePermit(
                    promptQueueReservationState
                );
            } else {
                completionCassetteSerializationPermit = await LLMClient.#completionCassetteSemaphore.acquire();
            }
        }
        let completionCassetteReplayLease = null;
        let completionCassetteRecordingLease = null;
        let completionCassetteRequestDescriptor = null;
        let currentTime = Date.now();
        try {
            dumpReasoningToConsole = true;

            if (metadataLabel) {
                log(`🧠 LLMClient.chatCompletion called with metadataLabel: ${metadataLabel}`);
            } else {
                log('🧠 LLMClient.chatCompletion called without metadataLabel.');
                traceLog();
            }

            let basePayload = additionalPayload && typeof additionalPayload === 'object'
                ? { ...additionalPayload }
                : {};
            if (onStreamToken !== null && onStreamToken !== undefined && typeof onStreamToken !== 'function') {
                throw new TypeError('chatCompletion onStreamToken must be a function when provided.');
            }
            if (
                onLiveTokenStreamFallback !== null
                && onLiveTokenStreamFallback !== undefined
                && typeof onLiveTokenStreamFallback !== 'function'
            ) {
                throw new TypeError(
                    'chatCompletion onLiveTokenStreamFallback must be a function when provided.'
                );
            }
            const configuredNonStreamTokenChunkSize = (() => {
                if (nonStreamTokenChunkSize === null || nonStreamTokenChunkSize === undefined) {
                    return null;
                }
                if (!Number.isInteger(nonStreamTokenChunkSize) || nonStreamTokenChunkSize <= 0) {
                    throw new TypeError('chatCompletion nonStreamTokenChunkSize must be a positive integer when provided.');
                }
                if (typeof onStreamToken !== 'function') {
                    throw new Error('chatCompletion nonStreamTokenChunkSize requires onStreamToken.');
                }
                return nonStreamTokenChunkSize;
            })();
            const resolvedLiveTokenStreamFallbackChunkSize = (() => {
                if (
                    liveTokenStreamFallbackChunkSize === null
                    || liveTokenStreamFallbackChunkSize === undefined
                ) {
                    return null;
                }
                if (!Number.isInteger(liveTokenStreamFallbackChunkSize) || liveTokenStreamFallbackChunkSize <= 0) {
                    throw new TypeError(
                        'chatCompletion liveTokenStreamFallbackChunkSize must be a positive integer when provided.'
                    );
                }
                if (configuredNonStreamTokenChunkSize !== null) {
                    throw new Error(
                        'chatCompletion cannot combine nonStreamTokenChunkSize with liveTokenStreamFallbackChunkSize.'
                    );
                }
                if (typeof onStreamToken !== 'function') {
                    throw new Error('chatCompletion liveTokenStreamFallbackChunkSize requires onStreamToken.');
                }
                return liveTokenStreamFallbackChunkSize;
            })();
            const resolvedLiveTokenStreamCapabilityKey = (() => {
                if (resolvedLiveTokenStreamFallbackChunkSize === null) {
                    if (liveTokenStreamCapabilityKey !== null && liveTokenStreamCapabilityKey !== undefined) {
                        throw new Error(
                            'chatCompletion liveTokenStreamCapabilityKey requires liveTokenStreamFallbackChunkSize.'
                        );
                    }
                    return null;
                }
                if (
                    typeof liveTokenStreamCapabilityKey !== 'string'
                    || !liveTokenStreamCapabilityKey.trim()
                ) {
                    throw new Error(
                        'chatCompletion liveTokenStreamCapabilityKey must be a non-empty string when streaming fallback is enabled.'
                    );
                }
                return liveTokenStreamCapabilityKey.trim();
            })();
            if (
                typeof onLiveTokenStreamFallback === 'function'
                && resolvedLiveTokenStreamFallbackChunkSize === null
            ) {
                throw new Error(
                    'chatCompletion onLiveTokenStreamFallback requires liveTokenStreamFallbackChunkSize.'
                );
            }
            if (headers !== undefined && headers !== null && !LLMClient.#isPlainObject(headers)) {
                throw new Error('chatCompletion headers must be an object when provided.');
            }
            if (typeof preserveBaseContextToolDefinitions !== 'boolean') {
                throw new TypeError('chatCompletion preserveBaseContextToolDefinitions must be a boolean.');
            }
            const resolvedSeed = Number.isFinite(seed) ? Math.trunc(seed) : LLMClient.#generateSeed();
            if (!Array.isArray(messages) || messages.length === 0) {
                throw new Error('LLMClient.chatCompletion requires at least one message.');
            }

            const baseContextToolPolicy = LLMClient.applyBaseContextToolPolicy(messages, {
                metadataLabel,
                additionalPayload: basePayload,
                preserveCallerToolDefinitions: preserveBaseContextToolDefinitions
            });
            messages = baseContextToolPolicy.messages;
            basePayload = baseContextToolPolicy.additionalPayload;
            messages = LLMClient.expandPromptMessageBoundaries(messages);
            messages = await LLMClient.#convertMessagesToWebp(messages);
            const configuredAi = Globals?.config?.ai && typeof Globals.config.ai === 'object'
                ? Globals.config.ai
                : {};
            const modelRoutingFingerprint = LLMCompletionCassette.fingerprintValue(
                LLMCompletionCassette.sanitizeRoutingConfigForFingerprint({
                    ai: {
                        backend: configuredAi.backend ?? null,
                        model: configuredAi.model ?? null,
                        endpoint: configuredAi.endpoint ?? null
                    },
                    aiMultimodal: multimodal === true && Globals?.config?.ai_multimodal
                        ? Globals.config.ai_multimodal
                        : null,
                    aiModelOverrides: Globals?.config?.ai_model_overrides ?? null
                })
            );
            const normalizedRequiredRegexForCassette = (() => {
                if (requiredRegex instanceof RegExp) {
                    return requiredRegex.toString();
                }
                if (requiredRegex && typeof requiredRegex === 'object' && requiredRegex.pattern !== undefined) {
                    return `/${String(requiredRegex.pattern)}/${requiredRegex.flags ? String(requiredRegex.flags) : ''}`;
                }
                return requiredRegex;
            })();
            completionCassetteRequestDescriptor = LLMCompletionCassette.createRequestDescriptor({
                metadataLabel: normalizedMetadataLabel || metadataLabel,
                messages,
                additionalPayload: basePayload,
                requestedModel: model,
                configuredModel: configuredAi.model,
                configuredBackend: configuredAi.backend,
                modelRoutingFingerprint,
                prefill: typeof prefill === 'string'
                    ? prefill
                    : (prefill === undefined && typeof configuredAi.prefill === 'string' ? configuredAi.prefill : null),
                assistantResponseSeed,
                systemPromptAppend: configuredAi.sysprompt_append,
                maxTokens,
                temperature,
                topP,
                frequencyPenalty,
                presencePenalty,
                multimodal,
                validateXML,
                validateXMLStrict,
                requiredTags,
                requiredRegex: normalizedRequiredRegexForCassette
            });

            const recordingSource = LLMCompletionCassette.resolveRecordingSource(Globals?.config);
            const forcedFixtureSource = LLMClient.#resolveForcedOutputFixturePath();
            if (recordingSource && (
                (forceOutput !== null && forceOutput !== undefined)
                || forcedFixtureSource
            )) {
                throw new Error(
                    'Completion cassette recording cannot be combined with forceOutput or a forced-output fixture.'
                );
            }
            if (recordingSource) {
                completionCassetteRecordingLease = LLMCompletionCassette.beginRecording({
                    sourcePath: recordingSource,
                    baseDir: Globals?.baseDir || process.cwd()
                });
            }

            let resolvedForcedOutput = null;
            if (forceOutput !== null && forceOutput !== undefined) {
                resolvedForcedOutput = forceOutput;
            } else {
                const fixtureResolution = LLMClient.#resolveForcedOutputFromFixture(
                    metadataLabel,
                    completionCassetteRequestDescriptor
                );
                if (fixtureResolution?.[COMPLETION_CASSETTE_RESOLUTION] === true) {
                    resolvedForcedOutput = fixtureResolution.output;
                    completionCassetteReplayLease = fixtureResolution.lease;
                } else {
                    resolvedForcedOutput = fixtureResolution;
                }
            }
            if (
                typeof onStreamToken === 'function'
                && resolvedForcedOutput !== null
                && resolvedForcedOutput !== undefined
                && !completionCassetteReplayLease
            ) {
                throw new Error('chatCompletion onStreamToken cannot be used with forced output.');
            }

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

            let livePrefillOverride = undefined;
            let liveDisableTools = false;
            let liveTokenRecords = [];
            let liveLogicalMaxTokens = null;
            let useLiveTokenStreamFallback = resolvedLiveTokenStreamCapabilityKey !== null
                && LLMClient.#failedLiveTokenStreamCapabilityKeys.has(resolvedLiveTokenStreamCapabilityKey);
            let liveStreamReceivedTextToken = false;
            const xmlRepetitionDetector = activeXmlRepetitionFix
                ? new TinyBrainXmlRepetitionDetector()
                : null;
            let xmlContinuationPrefix = '';
            let xmlContinuationMessages = null;
            let xmlRepetitionContinuations = 0;
            const inspectTinyBrainXmlRepetition = (currentResponseText) => {
                if (!xmlRepetitionDetector) {
                    return;
                }
                const detection = xmlRepetitionDetector.inspect(currentResponseText);
                if (!detection) {
                    return;
                }
                const correctionError = new Error(
                    `TinyBrain XML repetition detected (${detection.pattern}).`
                );
                correctionError.isTinyBrainXmlRepetitionCorrection = true;
                correctionError.xmlRepetitionDetection = detection;
                correctionError.xmlRepetitionResponseText = currentResponseText;
                throw correctionError;
            };
            if (useLiveTokenStreamFallback) {
                log(
                    `Using token-chunked non-stream live processing because streaming already failed for `
                    + `${resolvedLiveTokenStreamCapabilityKey}.`
                );
            }

            const resolveAttemptRuntime = async ({ attemptNumber = 0 } = {}) => {
                const effectiveNonStreamTokenChunkSize = useLiveTokenStreamFallback
                    ? resolvedLiveTokenStreamFallbackChunkSize
                    : configuredNonStreamTokenChunkSize;
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
                const bridgeClient = LLMClient.#resolveCliBridgeClient(resolvedBackend);
                const isCliBridgeBackend = Boolean(bridgeClient);
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
                if (liveDisableTools) {
                    delete payload.tools;
                    delete payload.functions;
                    delete payload.parallel_tool_calls;
                    payload.tool_choice = 'none';
                    payload.function_call = 'none';
                }
                const resolvedPrefill = LLMClient.#resolveAssistantPrefill({
                    prefill: livePrefillOverride !== undefined ? livePrefillOverride : prefill,
                    assistantResponseSeed: livePrefillOverride !== undefined ? undefined : assistantResponseSeed,
                    configured: aiConfig.prefill
                });
                if (resolvedPrefill && isCliBridgeBackend) {
                    throw LLMClient.#assistantPrefillError(
                        'Assistant response prefill is only supported by the openai_compatible backend.'
                    );
                }
                if (
                    resolvedPrefill
                    && LLMClient.#payloadHasToolDefinitions(payload)
                    && typeof onStreamToken !== 'function'
                ) {
                    throw LLMClient.#assistantPrefillError(
                        'Assistant response prefill cannot be used with tool-call request payloads.'
                    );
                }
                const effectiveMessages = xmlContinuationMessages || messages;
                const systemAppendedMessages = LLMClient.#applySystemPromptAppend(
                    effectiveMessages,
                    aiConfig.sysprompt_append
                );
                const requestMessages = LLMClient.#appendAssistantPrefillMessage(
                    LLMClient.#applyPromptCachebuster(
                        systemAppendedMessages,
                        LLMClient.#isPromptCachebusterEnabled(aiConfig.cachebuster)
                    ),
                    resolvedPrefill
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

                const resolvedModel = LLMClient.#isKimiBridgeBackend(resolvedBackend)
                    ? KimiBridgeClient.resolveResponseModel(aiConfig)
                    : (model || payload.model || aiConfig.model);
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
                const explicitlyConfiguredNonStreamTokens = configuredNonStreamTokenChunkSize !== null;
                payload.stream = isCliBridgeBackend || effectiveNonStreamTokenChunkSize !== null
                    ? false
                    : resolvedStream !== false;
                if (activeXmlRepetitionFix && isCliBridgeBackend) {
                    throw LLMClient.#configurationError(
                        'AI xml_repetition_fix requires the openai_compatible backend for TinyBrain prompts.'
                    );
                }
                if (activeXmlRepetitionFix && effectiveNonStreamTokenChunkSize === null) {
                    payload.stream = true;
                }
                if (effectiveNonStreamTokenChunkSize !== null && isCliBridgeBackend) {
                    throw new Error(
                        'chatCompletion nonStreamTokenChunkSize is only supported by the openai_compatible backend.'
                    );
                }
                if (explicitlyConfiguredNonStreamTokens && resolvedStream !== false) {
                    throw new Error('chatCompletion nonStreamTokenChunkSize requires stream to be false.');
                }
                if (
                    typeof onStreamToken === 'function'
                    && !payload.stream
                    && effectiveNonStreamTokenChunkSize === null
                ) {
                    throw new Error('chatCompletion onStreamToken requires OpenAI-compatible streaming.');
                }

                if (maxTokens !== undefined) {
                    if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
                        throw new Error('maxTokens must be a positive number when provided.');
                    }
                    payload.max_tokens = maxTokens;
                } else if (payload.max_tokens === undefined && Number.isFinite(aiConfig.maxTokens) && aiConfig.maxTokens > 0) {
                    payload.max_tokens = aiConfig.maxTokens;
                }
                if (effectiveNonStreamTokenChunkSize !== null) {
                    if (
                        payload.max_tokens !== undefined
                        && (!Number.isInteger(payload.max_tokens) || payload.max_tokens <= 0)
                    ) {
                        throw new Error(
                            'Token-chunked chat completion requires max_tokens to be a positive integer when provided.'
                        );
                    }
                    if (liveLogicalMaxTokens === null && Number.isInteger(payload.max_tokens)) {
                        liveLogicalMaxTokens = payload.max_tokens;
                    }
                    const remainingTokens = Number.isInteger(liveLogicalMaxTokens)
                        ? liveLogicalMaxTokens - liveTokenRecords.length
                        : effectiveNonStreamTokenChunkSize;
                    if (remainingTokens <= 0) {
                        throw new Error('Token-chunked chat completion exhausted its logical max_tokens budget.');
                    }
                    payload.max_tokens = Math.min(effectiveNonStreamTokenChunkSize, remainingTokens);
                }

                const resolvedTemperature = LLMClient.resolveTemperature(
                    temperature,
                    payload.temperature !== undefined ? payload.temperature : aiConfig.temperature
                );
                payload.temperature = resolvedTemperature;

                const resolvedReasoningEffort = LLMClient.#resolveReasoningEffort({
                    explicit: reasoningEffort,
                    payloadValue: payload.reasoning_effort,
                    configured: aiConfig.reasoning_effort
                });
                if (resolvedReasoningEffort) {
                    payload.reasoning = true;
                    payload.reasoning_effort = resolvedReasoningEffort;
                }

                const configuredMaxConcurrent = isCliBridgeBackend
                    ? bridgeClient.getMaxConcurrent(aiConfig)
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
                let resolvedWaitAfterNetworkError = 0;
                if (waitAfterNetworkError !== null && waitAfterNetworkError !== undefined) {
                    const explicitNetworkWait = Number(waitAfterNetworkError);
                    if (!Number.isFinite(explicitNetworkWait) || explicitNetworkWait < 0) {
                        throw new Error('waitAfterNetworkError must be a non-negative number when provided.');
                    }
                    resolvedWaitAfterNetworkError = explicitNetworkWait;
                } else if (Object.prototype.hasOwnProperty.call(aiConfig, 'waitAfterNetworkError')) {
                    const configuredNetworkWait = Number(aiConfig.waitAfterNetworkError);
                    if (!Number.isFinite(configuredNetworkWait) || configuredNetworkWait < 0) {
                        throw new Error('AI waitAfterNetworkError must be a non-negative number when configured.');
                    }
                    resolvedWaitAfterNetworkError = configuredNetworkWait;
                }
                const resolvedEndpoint = isCliBridgeBackend
                    ? null
                    : LLMClient.resolveChatEndpoint(endpoint || aiConfig.endpoint);
                const oauthKey = isCliBridgeBackend
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
                const resolvedApiKey = isCliBridgeBackend
                    ? null
                    : (apiKey || (oauthConfig
                        ? await LLMClient.#resolveOAuthAccessToken(oauthConfig, configuredRequestHeaders)
                        : aiConfig.apiKey));
                if (!isCliBridgeBackend && !resolvedApiKey) {
                    throw new Error('AI API key is not configured.');
                }

                const semaphoreKey = isCliBridgeBackend
                    ? bridgeClient.getSemaphoreKey(aiConfig, resolvedModel)
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
                if (isCliBridgeBackend) {
                    resolvedTimeout = bridgeClient.resolveBridgeIdleTimeoutMs(aiConfig);
                    baseStartTimeoutMs = resolvedTimeout;
                    baseContinueTimeoutMs = resolvedTimeout;
                }
                const effectiveIncrementStartTimeoutMs = isCliBridgeBackend
                    ? 0
                    : incrementStartTimeoutMs;
                const effectiveIncrementContinueTimeoutMs = isCliBridgeBackend
                    ? 0
                    : incrementContinueTimeoutMs;
                const streamStartTimeoutMs = baseStartTimeoutMs + (effectiveIncrementStartTimeoutMs * attemptNumber);
                const streamContinueTimeoutMs = baseContinueTimeoutMs + (effectiveIncrementContinueTimeoutMs * attemptNumber);

                if (isCliBridgeBackend) {
                    return {
                        backend: resolvedBackend,
                        aiConfig,
                        bridgeConfig: bridgeClient.resolveBridgeConfig(aiConfig),
                        payload,
                        requestMessages,
                        resolvedPrefill,
                        resolvedModel,
                        resolvedEndpoint,
                        resolvedApiKey,
                        resolvedTemperature,
                        resolvedTimeout,
                        effectiveMaxConcurrent,
                        resolvedWaitAfterError,
                        resolvedWaitAfterRateLimitError,
                        resolvedWaitAfterNetworkError,
                        semaphoreKey,
                        streamStartTimeoutMs,
                        streamContinueTimeoutMs,
                        oauthConfig,
                        configuredRequestHeaders,
                        effectiveNonStreamTokenChunkSize,
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
                    resolvedPrefill,
                    resolvedModel,
                    resolvedEndpoint,
                    resolvedApiKey,
                    resolvedTemperature,
                    resolvedTimeout,
                    effectiveMaxConcurrent,
                    resolvedWaitAfterError,
                    resolvedWaitAfterRateLimitError,
                    resolvedWaitAfterNetworkError,
                    semaphoreKey,
                    streamStartTimeoutMs,
                    streamContinueTimeoutMs,
                    oauthConfig,
                    configuredRequestHeaders,
                    effectiveNonStreamTokenChunkSize,
                    baseAxiosOptions
                };
            };

            let attempt = 0;
            let responseContent = '';
            let streamTrackerId = null;
            let startTimer = null;
            let lastTotalTokens = null;
            let finalResponseToolCalls = [];
            let finalNormalizedResponseData = null;
            let retainedRetryPermits = null;
            let queueNextAttemptAtFront = false;
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
                liveStreamReceivedTextToken = false;
                streamTrackerId = null;
                startTimer = null;
                let responseToolCalls = [];
                let responseUsage = null;
                let responseFinishReason = null;
                let attemptSemaphore = null;
                let attemptSemaphorePermit = null;
                let attemptAllModelsSemaphore = null;
                let attemptAllModelsSemaphorePermit = null;
                let attemptModelLifecycleRelease = null;
                let attemptRuntime = null;
                let payload = null;
                let requestMessages = messages;
                let resolvedPrefill = null;
                let resolvedBackend = null;
                let resolvedModel = null;
                let resolvedEndpoint = null;
                let resolvedTimeout = null;
                let waitAfterErrorSeconds = 10;
                let waitAfterRateLimitErrorSeconds = 10;
                let waitAfterNetworkErrorSeconds = 0;
                let streamStartTimeoutMs = 40000;
                let streamContinueTimeoutMs = 10000;
                let activeNonStreamTokenChunkSize = null;
                let retryAttemptAtFront = false;
                const acquireAttemptAtFront = queueNextAttemptAtFront;
                queueNextAttemptAtFront = false;
                const controller = new AbortController();
                let response = null;
                try {
                    if (retainedRetryPermits) {
                        attemptSemaphore = retainedRetryPermits.semaphore;
                        attemptSemaphorePermit = retainedRetryPermits.semaphorePermit;
                        attemptAllModelsSemaphore = retainedRetryPermits.allModelsSemaphore;
                        attemptAllModelsSemaphorePermit = retainedRetryPermits.allModelsSemaphorePermit;
                        retainedRetryPermits = null;
                    }
                    if (hasForcedOutput) {
                        resolvedPrefill = LLMClient.#resolveAssistantPrefill({
                            prefill,
                            assistantResponseSeed,
                            configured: Globals?.config?.ai?.prefill
                        });
                        if (resolvedPrefill && LLMClient.#payloadHasToolDefinitions(basePayload)) {
                            throw LLMClient.#assistantPrefillError(
                                'Assistant response prefill cannot be used with tool-call request payloads.'
                            );
                        }
                        const systemAppendedMessages = LLMClient.#applySystemPromptAppend(
                            messages,
                            Globals?.config?.ai?.sysprompt_append
                        );
                        requestMessages = LLMClient.#appendAssistantPrefillMessage(
                            LLMClient.#applyPromptCachebuster(
                                systemAppendedMessages,
                                LLMClient.#isPromptCachebusterEnabled(Globals?.config?.ai?.cachebuster)
                            ),
                            resolvedPrefill
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
                        resolvedPrefill = attemptRuntime.resolvedPrefill;
                        waitAfterErrorSeconds = attemptRuntime.resolvedWaitAfterError;
                        waitAfterRateLimitErrorSeconds = attemptRuntime.resolvedWaitAfterRateLimitError;
                        waitAfterNetworkErrorSeconds = attemptRuntime.resolvedWaitAfterNetworkError;
                        streamStartTimeoutMs = attemptRuntime.streamStartTimeoutMs;
                        streamContinueTimeoutMs = attemptRuntime.streamContinueTimeoutMs;
                        activeNonStreamTokenChunkSize = attemptRuntime.effectiveNonStreamTokenChunkSize;

                        if (typeof captureRequestPayload === 'function') {
                            try {
                                captureRequestPayload(JSON.parse(JSON.stringify(payload)));
                            } catch (_) {
                                captureRequestPayload(payload);
                            }
                        }

                        const resolvedAttemptSemaphore = LLMClient.#ensureSemaphore(
                            attemptRuntime.semaphoreKey,
                            attemptRuntime.effectiveMaxConcurrent,
                            log
                        );
                        const resolvedAttemptAllModelsSemaphore = LLMClient.#ensureAllModelsSemaphore(log);
                        if (promptQueueReservationState) {
                            await LLMClient.#retainPromptQueueReservationPermits(
                                promptQueueReservationState,
                                {
                                    semaphore: resolvedAttemptSemaphore,
                                    semaphoreKey: attemptRuntime.semaphoreKey,
                                    allModelsSemaphore: resolvedAttemptAllModelsSemaphore,
                                    background: Boolean(runInBackground)
                                }
                            );
                        } else {
                            const isBackgroundAttempt = Boolean(runInBackground);
                            const hasRetainedAttemptPermits = Boolean(attemptSemaphore);
                            const retainedModelPermitChanged = hasRetainedAttemptPermits
                                && attemptSemaphore !== resolvedAttemptSemaphore;
                            if (retainedModelPermitChanged) {
                                attemptSemaphore.release(attemptSemaphorePermit);
                                attemptSemaphore = null;
                                attemptSemaphorePermit = null;
                            }
                            if (!attemptSemaphore) {
                                attemptSemaphore = resolvedAttemptSemaphore;
                                attemptSemaphorePermit = await attemptSemaphore.acquire({
                                    background: isBackgroundAttempt,
                                    front: acquireAttemptAtFront || retainedModelPermitChanged
                                });
                            }

                            const retainedAllModelsPermitChanged = hasRetainedAttemptPermits
                                && attemptAllModelsSemaphore !== resolvedAttemptAllModelsSemaphore;
                            if (retainedAllModelsPermitChanged && attemptAllModelsSemaphore) {
                                attemptAllModelsSemaphore.release(attemptAllModelsSemaphorePermit);
                                attemptAllModelsSemaphore = null;
                                attemptAllModelsSemaphorePermit = null;
                            }
                            if (!attemptAllModelsSemaphore && resolvedAttemptAllModelsSemaphore) {
                                attemptAllModelsSemaphore = resolvedAttemptAllModelsSemaphore;
                                attemptAllModelsSemaphorePermit = await attemptAllModelsSemaphore.acquire({
                                    background: isBackgroundAttempt,
                                    front: acquireAttemptAtFront || retainedAllModelsPermitChanged
                                });
                            }
                        }
                        const shouldTrackPromptProgress = !isSilent
                            && (payload.stream || LLMClient.#isCliBridgeBackend(resolvedBackend));
                        streamTrackerId = shouldTrackPromptProgress
                            ? LLMClient.#trackStreamStart(metadataLabel, {
                                startTimeoutMs: streamStartTimeoutMs,
                                continueTimeoutMs: streamContinueTimeoutMs,
                                isBackground: Boolean(runInBackground),
                                model: resolvedModel,
                                promptText: LLMClient.formatMessagesForPromptProgress(payload.messages),
                                progressGroupId: resolvedProgressGroupId,
                                progressGroupTargetLabel: resolvedProgressGroupTargetLabel,
                                receivedUnit: 'characters'
                            })
                            : null;
                        if (streamTrackerId) {
                            LLMClient.#abortControllers.set(streamTrackerId, controller);
                        }

                        const unloadModelOnSwitch = LLMClient.resolveUnloadModelOnSwitch();
                        const managesLocalModel = attemptRuntime.aiConfig
                            ?.terminate_during_image_generation === true;
                        attemptModelLifecycleRelease = unloadModelOnSwitch || managesLocalModel
                            ? await LLMClient.#modelLifecycleGate.acquireExclusive()
                            : await LLMClient.#modelLifecycleGate.acquireShared();
                        await LLMClient.#ensureManagedLocalModelBeforePrompt({
                            aiConfig: attemptRuntime.aiConfig,
                            metadataLabel
                        });
                        await LLMClient.#unloadComfyModelsBeforePrompt({
                            aiConfig: attemptRuntime.aiConfig,
                            metadataLabel
                        });
                        if (unloadModelOnSwitch) {
                            await LLMClient.#unloadPreviousPromptModelOnSwitch({
                                attemptRuntime,
                                metadataLabel,
                                log
                            });
                        } else {
                            LLMClient.#recordPromptModelTarget(attemptRuntime);
                        }

                        const cliBridgeClient = LLMClient.#resolveCliBridgeClient(resolvedBackend);
                        if (cliBridgeClient) {
                            response = await cliBridgeClient.chatCompletion({
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
                        if (!LLMClient.#isCliBridgeBackend(resolvedBackend)
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
                        const streamPrefill = resolvedPrefill || '';
                        if (typeof onStreamToken === 'function') {
                            const logicalPrefillLength = xmlContinuationPrefix.length + streamPrefill.length;
                            liveTokenRecords = liveTokenRecords.filter(record => record.end <= logicalPrefillLength);
                        }
                        const streamToolCallMap = new Map();
                        let streamFinishReason = null;
                        let streamUsage = null;
                        let timer = null;
                        let settled = false;
                        let streamCompletionNotified = false;

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

                        const logStreamChunk = (payloadStr) => {
                            if (!shouldLogStreamChunks) {
                                return;
                            }
                            const label = metadataLabel || 'unknown';
                            console.log(`========== LLM STREAM CHUNK [${label}] ==========`);
                            console.log(payloadStr);
                            console.log('===============================================');
                        };

                        const removeStreamListeners = () => {
                            response.data.removeListener('data', handleData);
                            response.data.removeListener('end', handleEnd);
                            response.data.removeListener('error', handleError);
                        };

                        const finishStream = () => {
                            if (settled) {
                                return;
                            }
                            settled = true;
                            clear();
                            removeStreamListeners();
                            LLMClient.#trackStreamEnd(streamId);
                            responseContent = assembled;
                            try {
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
                            } catch (error) {
                                rejectWithPartial(error);
                            }

                        };

                        const failStream = (error) => {
                            if (settled) {
                                return;
                            }
                            settled = true;
                            clear();
                            removeStreamListeners();
                            LLMClient.#trackStreamEnd(streamId);
                            rejectWithPartial(error);
                        };

                        const resetTimer = (ms) => {
                            clear();
                            timer = setTimeout(() => {
                                failStream(new Error('Stream timeout'));
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

                        const processLiveTokenDecision = async ({ tokenRecord, responseComplete = false }) => {
                            let decision = null;
                            try {
                                decision = await onStreamToken({
                                    responseText: `${xmlContinuationPrefix}${streamPrefill}${assembled}`,
                                    generatedText: assembled,
                                    prefill: `${xmlContinuationPrefix}${streamPrefill}`,
                                    token: tokenRecord,
                                    tokenRecords: liveTokenRecords,
                                    responseComplete
                                });
                            } catch (error) {
                                error.isLiveStreamTokenError = true;
                                throw error;
                            }
                            if (!decision) {
                                return;
                            }
                            const currentResponseText = `${xmlContinuationPrefix}${streamPrefill}${assembled}`;
                            if (
                                !Number.isInteger(decision.rewindOffset)
                                || decision.rewindOffset < 0
                                || decision.rewindOffset >= currentResponseText.length
                                || !decision.alternative
                                || typeof decision.alternative.token !== 'string'
                                || !decision.alternative.token
                            ) {
                                const error = new Error('Live stream token handler returned an invalid branch correction.');
                                error.isLiveStreamTokenError = true;
                                throw error;
                            }
                            const correctionError = new Error('Live stream branch correction requested.');
                            correctionError.isLiveStreamBranchCorrection = true;
                            correctionError.liveStreamDecision = decision;
                            correctionError.liveStreamResponseText = currentResponseText;
                            throw correctionError;
                        };

                        const processData = async (chunk) => {
                            if (settled) {
                                return;
                            }
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
                                let parsed = null;
                                try {
                                    parsed = JSON.parse(payloadStr);
                                } catch (parseError) {
                                    // ignore malformed chunks, but log for visibility
                                    warn('Failed to parse stream chunk:', parseError?.message || parseError);
                                    continue;
                                }

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
                                if (!delta) {
                                    const responseComplete = !streamCompletionNotified
                                        && typeof onStreamToken === 'function'
                                        && typeof firstChoice?.finish_reason === 'string'
                                        && firstChoice.finish_reason !== 'length'
                                        && streamToolCallMap.size === 0;
                                    const lastTokenRecord = liveTokenRecords[liveTokenRecords.length - 1] || null;
                                    if (responseComplete && lastTokenRecord) {
                                        await processLiveTokenDecision({
                                            tokenRecord: lastTokenRecord,
                                            responseComplete: true
                                        });
                                        streamCompletionNotified = true;
                                    }
                                    continue;
                                }

                                resetTimer(streamContinueTimeoutMs);
                                if (typeof onStreamToken !== 'function') {
                                    assembled += delta;
                                    responseContent = assembled;
                                    inspectTinyBrainXmlRepetition(`${xmlContinuationPrefix}${streamPrefill}${assembled}`);
                                    const deltaCharacters = LLMClient.#countTextCharacters(delta);
                                    LLMClient.#trackStreamCharacters(streamId, deltaCharacters, streamContinueTimeoutMs, delta);
                                    continue;
                                }

                                const logprobTokens = firstChoice?.logprobs?.content;
                                if (!Array.isArray(logprobTokens) || !logprobTokens.length) {
                                    // Some llama.cpp builds omit logprobs for ordinary content tokens such as
                                    // pieces of XML opening tags. Preserve those bytes in the response, but do
                                    // not expose them to live deslop because they have no alternatives to use
                                    // for a branch correction. Structured tool calls are accumulated separately
                                    // from delta.tool_calls above.
                                    assembled += delta;
                                    responseContent = assembled;
                                    inspectTinyBrainXmlRepetition(`${xmlContinuationPrefix}${streamPrefill}${assembled}`);
                                    const deltaCharacters = LLMClient.#countTextCharacters(delta);
                                    LLMClient.#trackStreamCharacters(
                                        streamId,
                                        deltaCharacters,
                                        streamContinueTimeoutMs,
                                        delta
                                    );
                                    continue;
                                }
                                const tokenDelta = logprobTokens.map(entry => entry?.token || '').join('');
                                if (tokenDelta !== delta) {
                                    const error = new Error(
                                        `Live stream token metadata did not align with the text delta (${JSON.stringify(tokenDelta)} !== ${JSON.stringify(delta)}).`
                                    );
                                    error.isLiveStreamTokenError = true;
                                    error.isLiveStreamCompatibilityError = true;
                                    throw error;
                                }

                                for (let tokenIndex = 0; tokenIndex < logprobTokens.length; tokenIndex += 1) {
                                    const tokenEntry = logprobTokens[tokenIndex];
                                    if (!tokenEntry || typeof tokenEntry.token !== 'string' || !tokenEntry.token) {
                                        const error = new Error('Live stream token metadata included an invalid token.');
                                        error.isLiveStreamTokenError = true;
                                        error.isLiveStreamCompatibilityError = true;
                                        throw error;
                                    }
                                    const tokenStart = xmlContinuationPrefix.length
                                        + streamPrefill.length
                                        + assembled.length;
                                    assembled += tokenEntry.token;
                                    responseContent = assembled;
                                    const tokenRecord = {
                                        id: tokenEntry.id ?? null,
                                        token: tokenEntry.token,
                                        bytes: Array.isArray(tokenEntry.bytes) ? [...tokenEntry.bytes] : null,
                                        logprob: Number.isFinite(tokenEntry.logprob) ? tokenEntry.logprob : null,
                                        top_logprobs: Array.isArray(tokenEntry.top_logprobs)
                                            ? tokenEntry.top_logprobs.map(entry => ({ ...entry }))
                                            : [],
                                        start: tokenStart,
                                        end: tokenStart + tokenEntry.token.length
                                    };
                                    liveTokenRecords.push(tokenRecord);
                                    liveStreamReceivedTextToken = true;
                                    inspectTinyBrainXmlRepetition(`${xmlContinuationPrefix}${streamPrefill}${assembled}`);
                                    const responseComplete = tokenIndex === logprobTokens.length - 1
                                        && typeof firstChoice?.finish_reason === 'string'
                                        && firstChoice.finish_reason !== 'length'
                                        && streamToolCallMap.size === 0;
                                    await processLiveTokenDecision({ tokenRecord, responseComplete });
                                    if (responseComplete) {
                                        streamCompletionNotified = true;
                                    }

                                    const tokenCharacters = LLMClient.#countTextCharacters(tokenEntry.token);
                                    LLMClient.#trackStreamCharacters(
                                        streamId,
                                        tokenCharacters,
                                        streamContinueTimeoutMs,
                                        tokenEntry.token
                                    );
                                }
                            }
                        };
                        let processing = Promise.resolve();
                        const handleData = (chunk) => {
                            processing = processing
                                .then(() => processData(chunk))
                                .catch((error) => {
                                    if (
                                        (
                                            error?.isLiveStreamBranchCorrection
                                            || error?.isTinyBrainXmlRepetitionCorrection
                                        )
                                        && typeof response.data?.destroy === 'function'
                                    ) {
                                        response.data.destroy();
                                    }
                                    failStream(error);
                                });
                        };
                        const handleEnd = () => {
                            processing.then(finishStream, failStream);
                        };
                        const handleError = error => failStream(error);

                        response.data.on('data', handleData);
                        response.data.on('end', handleEnd);
                        response.data.on('error', handleError);
                        if (!settled) {
                            resetTimer(streamStartTimeoutMs);
                        }
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

                        if (activeNonStreamTokenChunkSize !== null && responseContent) {
                            const chunkPrefill = resolvedPrefill || '';
                            const generatedContent = chunkPrefill && responseContent.startsWith(chunkPrefill)
                                ? responseContent.slice(chunkPrefill.length)
                                : responseContent;
                            const logprobTokens = firstChoice?.logprobs?.content;
                            if (!Array.isArray(logprobTokens) || !logprobTokens.length) {
                                const error = new Error(
                                    'Token-chunked live processing requires logprobs.content metadata for every response.'
                                );
                                error.isLiveStreamTokenError = true;
                                throw error;
                            }
                            const terminalTokenIndex = logprobTokens.length - 1;
                            const terminalTokenEntry = logprobTokens[terminalTokenIndex];
                            const hasTerminalControlToken = responseFinishReason === 'stop'
                                && responseToolCalls.length === 0
                                && terminalTokenEntry
                                && terminalTokenEntry.token === ''
                                && Array.isArray(terminalTokenEntry.bytes)
                                && terminalTokenEntry.bytes.length === 0;
                            for (let tokenIndex = 0; tokenIndex < logprobTokens.length; tokenIndex += 1) {
                                const tokenEntry = logprobTokens[tokenIndex];
                                const isTerminalControlToken = hasTerminalControlToken
                                    && tokenIndex === terminalTokenIndex;
                                if (
                                    !tokenEntry
                                    || typeof tokenEntry.token !== 'string'
                                    || (!tokenEntry.token && !isTerminalControlToken)
                                ) {
                                    const error = new Error('Token-chunked live metadata included an invalid token.');
                                    error.isLiveStreamTokenError = true;
                                    throw error;
                                }
                            }
                            const contentLogprobTokens = hasTerminalControlToken
                                ? logprobTokens.slice(0, terminalTokenIndex)
                                : logprobTokens;
                            const tokenContent = contentLogprobTokens.map(entry => entry.token).join('');
                            if (tokenContent !== generatedContent) {
                                const error = new Error(
                                    'Token-chunked live metadata did not align with the generated response '
                                    + `(${JSON.stringify(tokenContent)} !== ${JSON.stringify(generatedContent)}).`
                                );
                                error.isLiveStreamTokenError = true;
                                throw error;
                            }

                            const logicalChunkPrefillLength = xmlContinuationPrefix.length
                                + chunkPrefill.length;
                            liveTokenRecords = liveTokenRecords.filter(
                                record => record.end <= logicalChunkPrefillLength
                            );
                            let assembledChunk = '';
                            for (let tokenIndex = 0; tokenIndex < contentLogprobTokens.length; tokenIndex += 1) {
                                const tokenEntry = contentLogprobTokens[tokenIndex];
                                const tokenStart = logicalChunkPrefillLength + assembledChunk.length;
                                assembledChunk += tokenEntry.token;
                                const tokenRecord = {
                                    id: tokenEntry.id ?? null,
                                    token: tokenEntry.token,
                                    bytes: Array.isArray(tokenEntry.bytes) ? [...tokenEntry.bytes] : null,
                                    logprob: Number.isFinite(tokenEntry.logprob) ? tokenEntry.logprob : null,
                                    top_logprobs: Array.isArray(tokenEntry.top_logprobs)
                                        ? tokenEntry.top_logprobs.map(entry => ({ ...entry }))
                                        : [],
                                    start: tokenStart,
                                    end: tokenStart + tokenEntry.token.length
                                };
                                liveTokenRecords.push(tokenRecord);
                                inspectTinyBrainXmlRepetition(
                                    `${xmlContinuationPrefix}${chunkPrefill}${assembledChunk}`
                                );

                                let decision = null;
                                try {
                                    decision = await onStreamToken({
                                        responseText: `${xmlContinuationPrefix}${chunkPrefill}${assembledChunk}`,
                                        generatedText: assembledChunk,
                                        prefill: `${xmlContinuationPrefix}${chunkPrefill}`,
                                        token: tokenRecord,
                                        tokenRecords: liveTokenRecords,
                                        responseComplete: tokenIndex === contentLogprobTokens.length - 1
                                            && responseFinishReason !== 'length'
                                            && responseToolCalls.length === 0
                                    });
                                } catch (error) {
                                    error.isLiveStreamTokenError = true;
                                    throw error;
                                }
                                if (decision) {
                                    const currentResponseText = `${xmlContinuationPrefix}${chunkPrefill}${assembledChunk}`;
                                    if (
                                        !Number.isInteger(decision.rewindOffset)
                                        || decision.rewindOffset < 0
                                        || decision.rewindOffset >= currentResponseText.length
                                        || !decision.alternative
                                        || typeof decision.alternative.token !== 'string'
                                        || !decision.alternative.token
                                    ) {
                                        const error = new Error(
                                            'Token-chunked live handler returned an invalid branch correction.'
                                        );
                                        error.isLiveStreamTokenError = true;
                                        throw error;
                                    }
                                    const correctionError = new Error('Token-chunked live branch correction requested.');
                                    correctionError.isLiveStreamBranchCorrection = true;
                                    correctionError.liveStreamDecision = decision;
                                    correctionError.liveStreamResponseText = currentResponseText;
                                    throw correctionError;
                                }
                            }
                            responseContent = `${chunkPrefill}${assembledChunk}`;
                        }
                    }

                    if (
                        resolvedPrefill
                        && responseToolCalls.length > 0
                        && typeof onStreamToken !== 'function'
                    ) {
                        throw LLMClient.#assistantPrefillError(
                            'Assistant response prefill cannot be applied to a tool-call response.'
                        );
                    }
                    responseContent = LLMClient.#mergeAssistantPrefillWithResponse(
                        resolvedPrefill,
                        responseContent
                    );
                    responseContent = `${xmlContinuationPrefix}${responseContent}`;

                    if (
                        activeNonStreamTokenChunkSize !== null
                        && responseFinishReason === 'length'
                        && responseToolCalls.length === 0
                    ) {
                        const remainingTokens = Number.isInteger(liveLogicalMaxTokens)
                            ? liveLogicalMaxTokens - liveTokenRecords.length
                            : activeNonStreamTokenChunkSize;
                        if (remainingTokens > 0) {
                            livePrefillOverride = responseContent.slice(xmlContinuationPrefix.length);
                            log(
                                `Token-chunked live completion accepted ${liveTokenRecords.length} tokens; `
                                + 'continuing from assistant prefill.'
                            );
                            continue;
                        }
                    }

                    if (LLMClient.#isCodexBridgeBackend(resolvedBackend) && responseUsage) {
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
                    finalNormalizedResponseData = normalizedResponseData;

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
                    finalResponseToolCalls = responseToolCalls;

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
                                    waitAfterNetworkError: waitAfterNetworkErrorSeconds,
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
                        const responseXmlContent = Utils.extractFinalXmlBlockFromResponse(responseContent) || responseContent;
                        try {
                            if (validateXMLStrict) {
                                Utils.parseXmlDocumentStrict(responseXmlContent);
                            } else {
                                Utils.parseXmlDocument(responseXmlContent);
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
                            if (!tagPattern.test(responseXmlContent)) {
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
                    if (LLMClient.#isCliBridgeBackend(resolvedBackend) && streamTrackerId) {
                        LLMClient.#trackStreamEnd(streamTrackerId);
                        streamTrackerId = null;
                    }
                    break;

                } catch (error) {
                    if (!responseContent && typeof error?.partialResponse === 'string') {
                        responseContent = error.partialResponse;
                    }
                    if (error?.isTinyBrainXmlRepetitionCorrection) {
                        const detection = error.xmlRepetitionDetection;
                        const branchResponse = error.xmlRepetitionResponseText;
                        if (
                            !activeXmlRepetitionFix
                            || !detection
                            || typeof branchResponse !== 'string'
                            || !Number.isInteger(detection.truncateOffset)
                            || detection.truncateOffset <= 0
                            || detection.truncateOffset >= branchResponse.length
                        ) {
                            const invalidCorrectionError = new Error(
                                'TinyBrain XML repetition recovery received an invalid correction boundary.'
                            );
                            invalidCorrectionError.isTinyBrainXmlRepetitionError = true;
                            throw invalidCorrectionError;
                        }
                        if (xmlRepetitionContinuations >= activeXmlRepetitionFix.maxContinuations) {
                            const exhaustedError = new Error(
                                `TinyBrain XML repetition recovery exhausted its `
                                + `${activeXmlRepetitionFix.maxContinuations} continuation attempt(s) `
                                + `for prompt "${normalizedMetadataLabel}".`
                            );
                            exhaustedError.isTinyBrainXmlRepetitionError = true;
                            throw exhaustedError;
                        }

                        const acceptedPrefix = branchResponse
                            .slice(0, detection.truncateOffset)
                            .trimEnd();
                        if (!acceptedPrefix || acceptedPrefix.length >= branchResponse.length) {
                            const emptyCorrectionError = new Error(
                                'TinyBrain XML repetition recovery could not preserve a valid response prefix.'
                            );
                            emptyCorrectionError.isTinyBrainXmlRepetitionError = true;
                            throw emptyCorrectionError;
                        }

                        xmlRepetitionContinuations += 1;
                        xmlContinuationPrefix = acceptedPrefix;
                        xmlContinuationMessages = [
                            ...messages,
                            { role: 'assistant', content: acceptedPrefix },
                            { role: 'user', content: activeXmlRepetitionFix.continuationPrompt }
                        ];
                        xmlRepetitionDetector.reset();
                        livePrefillOverride = '';
                        liveTokenRecords = liveTokenRecords.filter(
                            record => record.end <= acceptedPrefix.length
                        );
                        responseContent = acceptedPrefix;
                        if (typeof activeXmlRepetitionFix.onCorrection === 'function') {
                            try {
                                await activeXmlRepetitionFix.onCorrection(Object.freeze({
                                    metadataLabel: normalizedMetadataLabel,
                                    pattern: detection.pattern,
                                    continuationAttempt: xmlRepetitionContinuations,
                                    maxContinuations: activeXmlRepetitionFix.maxContinuations,
                                    acceptedPrefix,
                                    continuationPrompt: activeXmlRepetitionFix.continuationPrompt,
                                    truncateOffset: detection.truncateOffset,
                                    duplicateEndOffset: detection.duplicateEndOffset
                                }));
                            } catch (loggingError) {
                                warn(
                                    `TinyBrain XML repetition prompt logging warning: `
                                    + `${loggingError?.message || String(loggingError)}`
                                );
                            }
                        }
                        retryAttemptAtFront = true;
                        warn(
                            `TinyBrain XML repetition fix removed a duplicated ${detection.pattern} suffix `
                            + `from prompt "${normalizedMetadataLabel}" and requested "continue" `
                            + `(${xmlRepetitionContinuations}/${activeXmlRepetitionFix.maxContinuations}).`
                        );
                        continue;
                    }
                    if (error?.isLiveStreamBranchCorrection) {
                        const decision = error.liveStreamDecision;
                        const branchResponse = error.liveStreamResponseText;
                        const continuationOffset = xmlContinuationPrefix.length;
                        if (decision.rewindOffset < continuationOffset) {
                            const correctionBoundaryError = new Error(
                                'Live stream branch correction cannot rewind into an accepted XML continuation prefix.'
                            );
                            correctionBoundaryError.isLiveStreamTokenError = true;
                            throw correctionBoundaryError;
                        }
                        const currentContinuation = branchResponse.slice(continuationOffset);
                        const nextPrefill = `${branchResponse.slice(continuationOffset, decision.rewindOffset)}`
                            + decision.alternative.token;
                        if (nextPrefill === currentContinuation) {
                            throw new Error('Live stream branch correction did not change the response prefix.');
                        }
                        liveTokenRecords = liveTokenRecords.filter(record => record.end <= decision.rewindOffset);
                        liveTokenRecords.push({
                            id: decision.alternative.id ?? null,
                            token: decision.alternative.token,
                            bytes: Array.isArray(decision.alternative.bytes)
                                ? [...decision.alternative.bytes]
                                : null,
                            logprob: Number.isFinite(decision.alternative.logprob)
                                ? decision.alternative.logprob
                                : null,
                            top_logprobs: Array.isArray(decision.alternative.top_logprobs)
                                ? decision.alternative.top_logprobs.map(entry => ({ ...entry }))
                                : [],
                            start: decision.rewindOffset,
                            end: decision.rewindOffset + decision.alternative.token.length
                        });
                        livePrefillOverride = nextPrefill;
                        liveDisableTools = decision.disableTools === true || liveDisableTools;
                        log(
                            `Live stream correction rewound to response offset ${decision.rewindOffset} `
                            + `and selected token ${JSON.stringify(decision.alternative.token)}.`
                        );
                        continue;
                    }
                    const errorStatus = Number(error?.status ?? error?.response?.status);
                    const abortIntent = LLMClient.#controllerAbortIntents.get(controller);
                    const streamProbeFailedBeforeText = payload?.stream === true
                        && !liveStreamReceivedTextToken
                        && abortIntent !== 'cancel'
                        && abortIntent !== 'retry'
                        && !error?.isLiveStreamTokenError
                        && !error?.isAssistantPrefillError
                        && !error?.isConfigurationError
                        && !error?.isPrePromptCleanupError
                        && !error?.isModelSwitchError;
                    if (
                        resolvedLiveTokenStreamFallbackChunkSize !== null
                        && resolvedLiveTokenStreamCapabilityKey !== null
                        && !useLiveTokenStreamFallback
                        && payload?.stream === true
                        && (error?.isLiveStreamCompatibilityError || streamProbeFailedBeforeText)
                    ) {
                        LLMClient.#failedLiveTokenStreamCapabilityKeys.add(
                            resolvedLiveTokenStreamCapabilityKey
                        );
                        useLiveTokenStreamFallback = true;
                        liveLogicalMaxTokens = null;
                        if (streamTrackerId) {
                            LLMClient.#trackStreamEnd(streamTrackerId);
                            streamTrackerId = null;
                        }
                        if (startTimer) {
                            clearTimeout(startTimer);
                            startTimer = null;
                        }
                        const statusNote = Number.isFinite(errorStatus) ? ` (HTTP ${errorStatus})` : '';
                        const fallbackMessage =
                            `Live token streaming failed for ${resolvedLiveTokenStreamCapabilityKey}${statusNote}: `
                            + `${error?.message || String(error)} `
                            + `Falling back to ${resolvedLiveTokenStreamFallbackChunkSize}-token non-stream batches `
                            + 'until the game server or llama.cpp process restarts.';
                        warn(fallbackMessage);
                        if (typeof onLiveTokenStreamFallback === 'function') {
                            const rawResponseBody = error?.response?.data;
                            let responseBody = null;
                            if (rawResponseBody !== undefined && rawResponseBody !== null) {
                                try {
                                    responseBody = typeof rawResponseBody === 'string'
                                        ? rawResponseBody
                                        : JSON.stringify(rawResponseBody, null, 2);
                                } catch (_) {
                                    responseBody = String(rawResponseBody);
                                }
                            }
                            await onLiveTokenStreamFallback(Object.freeze({
                                timestamp: new Date().toISOString(),
                                metadataLabel: typeof metadataLabel === 'string' ? metadataLabel : '',
                                capabilityKey: resolvedLiveTokenStreamCapabilityKey,
                                failureType: error?.isLiveStreamCompatibilityError
                                    ? 'stream_compatibility_error'
                                    : 'pre_text_stream_failure',
                                httpStatus: Number.isFinite(errorStatus) ? errorStatus : null,
                                errorName: typeof error?.name === 'string' ? error.name : null,
                                errorCode: error?.code !== undefined && error?.code !== null
                                    ? String(error.code)
                                    : null,
                                errorMessage: error?.message || String(error),
                                responseBody,
                                stack: typeof error?.stack === 'string' ? error.stack : null,
                                fallbackChunkSize: resolvedLiveTokenStreamFallbackChunkSize,
                                message: fallbackMessage
                            }));
                        }
                        retryAttemptAtFront = true;
                        continue;
                    }
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
                            retryAttemptAtFront = true;
                            continue;
                        }
                        warn(`Prompt '${metadataLabel || 'unknown'}' canceled by user.`);
                        return '';
                    }
                    if (
                        error?.isAssistantPrefillError
                        || error?.isConfigurationError
                        || error?.isPrePromptCleanupError
                        || error?.isModelSwitchError
                        || error?.isLiveStreamTokenError
                        || error?.isTinyBrainXmlRepetitionError
                    ) {
                        if (streamTrackerId) {
                            LLMClient.#trackStreamEnd(streamTrackerId);
                            streamTrackerId = null;
                        }
                        throw error;
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

                    if (errorStatus === 429) {
                        log('Rate limit exceeded. Waiting before retrying...');
                        if (waitAfterRateLimitErrorSeconds > 0) {
                            log(`Waiting ${waitAfterRateLimitErrorSeconds} seconds before retrying...`);
                            await new Promise(resolve => setTimeout(resolve, waitAfterRateLimitErrorSeconds * 1000));
                        }
                    } else if (LLMClient.#isRetryableNetworkError(error, errorStatus)
                        && attempt < retryAttempts
                        && waitAfterNetworkErrorSeconds > 0) {
                        log(`Network error from LLM transport. Waiting ${waitAfterNetworkErrorSeconds} seconds before retrying...`);
                        await new Promise(resolve => setTimeout(resolve, waitAfterNetworkErrorSeconds * 1000));
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
                        const willRetry = attempt < retryAttempts;
                        let errorForLog = error;
                        if (errorForLog && typeof errorForLog === 'object') {
                            errorForLog.message = typeof errorForLog.message === 'string'
                                ? errorForLog.message
                                : String(errorForLog);
                            if (Number.isFinite(errorStatus) && errorForLog.status === undefined) {
                                errorForLog.status = errorStatus;
                            }
                            errorForLog.attemptNumber = attempt + 1;
                            errorForLog.maxAttempts = retryAttempts + 1;
                            errorForLog.willRetry = willRetry;
                        } else {
                            errorForLog = {
                                message: String(errorForLog),
                                attemptNumber: attempt + 1,
                                maxAttempts: retryAttempts + 1,
                                willRetry
                            };
                            if (Number.isFinite(errorStatus)) {
                                errorForLog.status = errorStatus;
                            }
                        }
                        const filePath = LLMClient.writeLogFile({
                            prefix: 'chatCompletionError',
                            metadataLabel: resolvedErrorLogLabel,
                            error: errorForLog,
                            payload: responseContent || '',
                            append: promptAppend,
                            onFailureMessage: 'Failed to write chat completion error log file'
                        });
                        if (filePath) {
                            warn(`Chat completion error response logged to ${filePath}`);
                        }
                    }

                    const willRetryAttempt = shouldForceOAuthRefresh || attempt < retryAttempts;
                    if (willRetryAttempt) {
                        retryAttemptAtFront = true;
                    }
                    if (!willRetryAttempt) {
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
                    if (attemptModelLifecycleRelease) {
                        attemptModelLifecycleRelease();
                        attemptModelLifecycleRelease = null;
                    }
                    if (attemptSemaphore) {
                        const foregroundWaitingForBackgroundRetry = Boolean(runInBackground) && (
                            attemptSemaphore.hasQueuedForeground()
                            || Boolean(attemptAllModelsSemaphore?.hasQueuedForeground())
                        );
                        if (retryAttemptAtFront && !foregroundWaitingForBackgroundRetry) {
                            retainedRetryPermits = {
                                semaphore: attemptSemaphore,
                                semaphorePermit: attemptSemaphorePermit,
                                allModelsSemaphore: attemptAllModelsSemaphore,
                                allModelsSemaphorePermit: attemptAllModelsSemaphorePermit
                            };
                            attemptSemaphore = null;
                            attemptSemaphorePermit = null;
                            attemptAllModelsSemaphore = null;
                            attemptAllModelsSemaphorePermit = null;
                        } else {
                            if (attemptAllModelsSemaphore) {
                                attemptAllModelsSemaphore.release(attemptAllModelsSemaphorePermit);
                            }
                            attemptSemaphore.release(attemptSemaphorePermit);
                            if (retryAttemptAtFront) {
                                queueNextAttemptAtFront = true;
                            }
                        }
                    }
                }

                errorLog(`Retrying chat completion (attempt ${attempt + 2} of ${retryAttempts + 1})...`);
                attempt++;
                if ((attemptRuntime?.payload?.stream || LLMClient.#isCliBridgeBackend(attemptRuntime?.backend)) && streamTrackerId) {
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
            const finalCumulativeReceivedCount = finalProgressEntry
                ? (Number.isFinite(finalProgressEntry.receivedCount) ? finalProgressEntry.receivedCount : finalProgressEntry.bytes)
                : null;
            const finalStageReceivedStartCount = Number.isFinite(finalProgressEntry?.stageReceivedStartCount)
                ? finalProgressEntry.stageReceivedStartCount
                : 0;
            const finalReceivedCount = Number.isFinite(finalCumulativeReceivedCount)
                ? finalCumulativeReceivedCount - finalStageReceivedStartCount
                : null;
            const finalReceivedKey = finalProgressEntry?.receivedUnit === 'characters' ? 'received' : 'bytes';
            const receivedNote = Number.isFinite(finalReceivedCount) ? ` | ${finalReceivedKey}=${finalReceivedCount}` : '';
            const tokensNote = Number.isFinite(lastTotalTokens) ? ` | tokens=${lastTotalTokens}` : '';
            const label = metadataLabel || 'unknown';
            log(`Prompt '${label}' completed after ${attempt} retries in ${totalTime / 1000} seconds.${receivedNote}${tokensNote}`);
            if (!resolvedProgressGroupId) {
                LLMClient.#recordSuccessfulCompletionOutputCharacters(metadataLabel, responseContent, {
                    toolCalls: finalResponseToolCalls
                });
            }
            if (completionCassetteRecordingLease) {
                if (!finalNormalizedResponseData) {
                    throw new Error('Completion cassette recording is missing the normalized final response.');
                }
                LLMCompletionCassette.recordCompletion(completionCassetteRecordingLease, {
                    descriptor: completionCassetteRequestDescriptor,
                    response: finalNormalizedResponseData
                });
            }
            return responseContent;
        } finally {
            LLMCompletionCassette.endReplay(completionCassetteReplayLease);
            LLMCompletionCassette.endRecording(completionCassetteRecordingLease);
            LLMClient.#endPromptQueueReservationRequest(promptQueueReservationState);
            if (completionCassetteSerializationPermit) {
                LLMClient.#completionCassetteSemaphore.release(completionCassetteSerializationPermit);
            }
            // Non-reserved per-attempt resources are released inside the retry loop.
        }
    }
}

module.exports = LLMClient;
