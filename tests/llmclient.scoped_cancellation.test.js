'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const Globals = require('../Globals');
const LLMClient = require('../LLMClient');

function makeTempBaseDir(label) {
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    return fs.mkdtempSync(path.join(tmpRoot, `${label}-`));
}

function installConfig(baseDir, { stream, maxConcurrent = 1 } = {}) {
    Globals.baseDir = baseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream,
            retryAttempts: 0,
            max_concurrent_requests: maxConcurrent,
            supress_seed: true,
            stream_start_timeout: 10,
            stream_continue_timeout: 10
        }
    };
}

function disableGlobalForcedOutputs() {
    const previous = process.env.LLM_FORCE_OUTPUTS_FILE;
    delete process.env.LLM_FORCE_OUTPUTS_FILE;
    LLMClient.resetForcedOutputState();
    return () => {
        if (previous === undefined) delete process.env.LLM_FORCE_OUTPUTS_FILE;
        else process.env.LLM_FORCE_OUTPUTS_FILE = previous;
        LLMClient.resetForcedOutputState();
    };
}

async function until(predicate, description) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`Timed out waiting for ${description}.`);
}

function streamedResponse(text) {
    const stream = new Readable({ read() {} });
    process.nextTick(() => {
        stream.push(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        stream.push('data: [DONE]\n\n');
        stream.push(null);
    });
    return { status: 200, statusText: 'OK', data: stream };
}

test('an already-aborted signal rejects before transport and preserves its reason', { concurrency: false }, async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    installConfig(makeTempBaseDir('llm-scoped-already-aborted'), { stream: false });
    const reason = new Error('Story job was cancelled before it entered the queue.');
    const controller = new AbortController();
    controller.abort(reason);
    let calls = 0;
    axios.post = async () => { calls += 1; throw new Error('Transport must not run.'); };

    try {
        await assert.rejects(LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Never send this.' }],
            metadataLabel: 'story_cancel_before_queue',
            validateXML: false,
            signal: controller.signal,
            output: 'silent'
        }), error => error === reason);
        assert.equal(calls, 0);
    } finally {
        axios.post = originalPost;
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('cancelling one non-stream request leaves its concurrent sibling intact', { concurrency: false }, async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    installConfig(makeTempBaseDir('llm-scoped-non-stream'), { stream: false, maxConcurrent: 2 });
    const pending = new Map();
    const canceled = [];
    axios.post = async (_url, payload, options = {}) => {
        const label = payload.messages.at(-1).content;
        return await new Promise((resolve, reject) => {
            pending.set(label, resolve);
            const onAbort = () => {
                canceled.push(label);
                reject(options.signal.reason || new Error('Canceled transport.'));
            };
            if (options.signal.aborted) onAbort();
            else options.signal.addEventListener('abort', onAbort, { once: true });
        });
    };
    const controller = new AbortController();
    const reason = new Error('Stop only this story job.');

    try {
        const owned = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'owned story request' }],
            metadataLabel: 'story_owned_non_stream',
            validateXML: false,
            signal: controller.signal,
            output: 'silent'
        });
        const sibling = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'unrelated game request' }],
            metadataLabel: 'game_sibling_non_stream',
            validateXML: false,
            output: 'silent'
        });
        await until(() => pending.size === 2, 'both independent requests to enter transport');
        controller.abort(reason);
        await assert.rejects(owned, error => error === reason);
        pending.get('unrelated game request')({ data: { choices: [{ message: { content: 'game survives' } }] } });
        assert.equal(await sibling, 'game survives');
        assert.deepEqual(canceled, ['owned story request']);
    } finally {
        axios.post = originalPost;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
    }
});

test('cancelling one active streamed request aborts its transport and clears its prompt ownership', { concurrency: false }, async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const originalPost = axios.post;
    const restoreForcedOutputs = disableGlobalForcedOutputs();
    installConfig(makeTempBaseDir('llm-scoped-active-stream'), { stream: true, maxConcurrent: 1 });
    Globals.realtimeHub = { emit() {} };
    const controller = new AbortController();
    let transportCalls = 0;
    let transportCanceled = 0;
    axios.post = async (_url, _payload, options = {}) => {
        transportCalls += 1;
        return await new Promise((_, reject) => {
            const onAbort = () => {
                transportCanceled += 1;
                reject(options.signal.reason || new Error('Stream request aborted.'));
            };
            if (options.signal.aborted) onAbort();
            else options.signal.addEventListener('abort', onAbort, { once: true });
        });
    };

    try {
        let promptId;
        const request = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'active story stream' }],
            metadataLabel: 'story_active_stream',
            validateXML: false,
            stream: true,
            signal: controller.signal,
            onPromptId: id => { promptId = id; },
            output: 'stdout'
        });
        await until(() => Boolean(promptId && transportCalls), 'stream prompt to reach its transport');
        controller.abort('Cancel this story stream.');
        await assert.rejects(request, error => error === 'Cancel this story stream.');
        assert.equal(transportCanceled, 1);
        const drain = await LLMClient.waitForPromptDrain({ timeoutMs: 1000, pollIntervalMs: 5 });
        assert.equal(drain.activeAttemptCount, 0);
        assert.equal(drain.trackedCount, 0);
    } finally {
        controller.abort();
        axios.post = originalPost;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
        Globals.realtimeHub = originalRealtimeHub;
        restoreForcedOutputs();
    }
});

test('onPromptId callback errors propagate unchanged and leave no owned prompt or transport', { concurrency: false }, async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const originalPost = axios.post;
    const restoreForcedOutputs = disableGlobalForcedOutputs();
    installConfig(makeTempBaseDir('llm-prompt-id-callback'), { stream: true });
    Globals.realtimeHub = { emit() {} };
    const callbackError = new Error('Story run owner callback failed.');
    let transportCalls = 0;
    axios.post = async () => {
        transportCalls += 1;
        return streamedResponse('unexpected response');
    };

    try {
        await assert.rejects(LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'callback failure request' }],
            metadataLabel: 'story_prompt_callback_failure',
            validateXML: false,
            stream: true,
            onPromptId() { throw callbackError; },
            output: 'stdout'
        }), error => error === callbackError);
        assert.equal(transportCalls, 0);
        const drain = await LLMClient.waitForPromptDrain({ timeoutMs: 1000, pollIntervalMs: 5 });
        assert.equal(drain.activeAttemptCount, 0);
        assert.equal(drain.trackedCount, 0);
    } finally {
        axios.post = originalPost;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
        Globals.realtimeHub = originalRealtimeHub;
        restoreForcedOutputs();
    }
});

test('cancellation while waiting for the model lifecycle gate prevents transport and releases ownership', { concurrency: false }, async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalRealtimeHub = Globals.realtimeHub;
    const originalPost = axios.post;
    const restoreForcedOutputs = disableGlobalForcedOutputs();
    installConfig(makeTempBaseDir('llm-scoped-model-lifecycle'), { stream: true });
    Globals.realtimeHub = { emit() {} };
    let enterExclusive;
    let releaseExclusive;
    const exclusiveEntered = new Promise(resolve => { enterExclusive = resolve; });
    const exclusiveHold = new Promise(resolve => { releaseExclusive = resolve; });
    let transportCalls = 0;
    axios.post = async () => { transportCalls += 1; throw new Error('Lifecycle-wait cancellation must happen before transport.'); };
    const exclusive = LLMClient.withExclusiveModelLifecycle(async () => {
        enterExclusive();
        await exclusiveHold;
    });
    const controller = new AbortController();

    try {
        await exclusiveEntered;
        let promptId;
        const request = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'wait behind render lifecycle' }],
            metadataLabel: 'story_waiting_for_lifecycle',
            validateXML: false,
            stream: true,
            signal: controller.signal,
            onPromptId: id => { promptId = id; },
            output: 'stdout'
        });
        await until(() => Boolean(promptId), 'queued prompt to be visible while lifecycle is locked');
        controller.abort('Cancel before lifecycle handoff.');
        await assert.rejects(request, error => error === 'Cancel before lifecycle handoff.');
        assert.equal(transportCalls, 0);
    } finally {
        controller.abort();
        releaseExclusive();
        await exclusive;
        axios.post = originalPost;
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
        Globals.realtimeHub = originalRealtimeHub;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        restoreForcedOutputs();
    }
    const drain = await LLMClient.waitForPromptDrain({ timeoutMs: 1000, pollIntervalMs: 5 });
    assert.equal(drain.activeAttemptCount, 0);
    assert.equal(drain.trackedCount, 0);
});

test('request-scoped cancellation interrupts a retry delay and the model queue remains usable', { concurrency: false }, async () => {
    const originalBaseDir = Globals.baseDir;
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    const originalSetTimeout = global.setTimeout;
    const restoreForcedOutputs = disableGlobalForcedOutputs();
    installConfig(makeTempBaseDir('llm-scoped-retry-delay'), { stream: false });
    Globals.config.ai.retryAttempts = 2;
    Globals.config.ai.waitAfterNetworkError = 5;
    const controller = new AbortController();
    let waitStarted;
    const retryWaitStarted = new Promise(resolve => { waitStarted = resolve; });
    let calls = 0;
    axios.post = async (_url, payload) => {
        calls += 1;
        if (calls === 1) {
            const error = new Error('Synthetic socket reset.');
            error.code = 'ECONNRESET';
            throw error;
        }
        return { data: { choices: [{ message: { content: payload.messages.at(-1).content === 'queue recovery' ? 'queue recovered' : 'unexpected retry' } }] } };
    };
    global.setTimeout = (callback, delayMs, ...args) => {
        if (delayMs === 5000) waitStarted();
        return originalSetTimeout(callback, delayMs, ...args);
    };

    try {
        const request = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'request that will enter retry delay' }],
            metadataLabel: 'story_scoped_retry_delay',
            validateXML: false,
            waitAfterNetworkError: 5,
            signal: controller.signal,
            throwOnError: true,
            output: 'silent'
        });
        await retryWaitStarted;
        controller.abort('Stop this story retry only.');
        await assert.rejects(request, error => error === 'Stop this story retry only.');
        assert.equal(calls, 1);
        assert.equal(await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'queue recovery' }],
            metadataLabel: 'story_retry_queue_recovery',
            validateXML: false,
            output: 'silent'
        }), 'queue recovered');
        assert.equal(calls, 2);
    } finally {
        axios.post = originalPost;
        global.setTimeout = originalSetTimeout;
        Globals.baseDir = originalBaseDir;
        Globals.config = originalConfig;
        LLMClient.resetPromptOutputCharacterStatsForTests();
        restoreForcedOutputs();
    }
});
