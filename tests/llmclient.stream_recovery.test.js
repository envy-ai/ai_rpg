const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function stream(chunks) {
    return Readable.from([...chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`), 'data: [DONE]\n\n']);
}
function textChunk(text, token = text) {
    return { choices: [{ delta: { content: text }, finish_reason: 'stop', logprobs: { content: [{ token, bytes: [...Buffer.from(token)], logprob: -0.1, top_logprobs: [] }] } }] };
}
async function withFixture(fn) {
    const saved = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir, hub: Globals.realtimeHub };
    const tmp = path.resolve(__dirname, '..', 'tmp'); fs.mkdirSync(tmp, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(tmp, 'llm-stream-recovery-'));
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test', model: 'test', stream: true, retryAttempts: 1, max_concurrent_requests: 1, maxTokens: 20, suppress_seed: true, stream_start_timeout: 5, stream_continue_timeout: 5 } };
    LLMClient.resetLiveTokenStreamCapabilitiesForTests(); LLMClient.resetPromptOutputCharacterStatsForTests();
    try { await fn(); } finally {
        axios.post = saved.post; Globals.config = saved.config; Globals.baseDir = saved.baseDir; Globals.realtimeHub = saved.hub;
        LLMClient.resetLiveTokenStreamCapabilitiesForTests(); LLMClient.resetPromptOutputCharacterStatsForTests();
    }
}
function request(options = {}) {
    return LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Continue.' }], metadataLabel: 'stream_recovery_test', validateXML: false,
        retryAttempts: 1, output: 'silent', stream: true, liveTokenStreamFallbackChunkSize: 500,
        liveTokenStreamCapabilityKey: 'test-endpoint::test-process', additionalPayload: { logprobs: true, top_logprobs: 2 },
        onStreamToken: async () => null, ...options });
}

test('empty completed stream retries streaming and does not poison later calls', { concurrency: false }, async () => withFixture(async () => {
    const streams = []; let n = 0;
    axios.post = async (_url, payload) => { streams.push(payload.stream); return { status: 200, data: stream(++n === 1 ? [{ choices: [{ delta: {}, finish_reason: 'stop' }] }] : [textChunk('Valid')]) }; };
    assert.equal(await request(), 'Valid');
    assert.equal(await request(), 'Valid');
    assert.deepEqual(streams, [true, true, true]);
}));

test('transient pre-text transport failure uses ordinary retry and leaves streaming enabled', { concurrency: false }, async () => withFixture(async () => {
    const streams = []; let n = 0;
    axios.post = async (_url, payload) => {
        streams.push(payload.stream);
        if (++n === 1) { const error = new Error('temporary transport failure'); error.code = 'ECONNRESET'; throw error; }
        return { status: 200, data: stream([textChunk('Valid')]) };
    };
    assert.equal(await request(), 'Valid');
    assert.equal(await request(), 'Valid');
    assert.deepEqual(streams, [true, true, true]);
}));

function completion(content, finish = 'stop', token = content) {
    return { status: 200, data: { choices: [{ finish_reason: finish, message: { role: 'assistant', content }, logprobs: { content: [{ token, bytes: [...Buffer.from(token)], logprob: -0.1, top_logprobs: [] }] } }] } };
}
function collectProgress() {
    const events = [];
    Globals.realtimeHub = { emit(_room, type, payload) { events.push({ type, payload: structuredClone(payload) }); } };
    return events;
}
function entries(events) { return events.filter(e => e.type === 'prompt_progress').flatMap(e => e.payload.entries || []); }

test('nonstream responses publish start and completion with generated character count; silent calls do not', { concurrency: false }, async () => withFixture(async () => {
    const events = collectProgress();
    axios.post = async () => completion('Hello');
    assert.equal(await request({ stream: false, output: 'stdout', liveTokenStreamFallbackChunkSize: undefined, liveTokenStreamCapabilityKey: undefined, onStreamToken: undefined, additionalPayload: undefined }), 'Hello');
    const observed = entries(events);
    assert.ok(observed.some(e => e.receivedCount === 0 && !e.isComplete), 'expected running entry');
    assert.ok(observed.some(e => e.receivedCount === 5 && e.previewText === 'Hello' && e.isComplete), 'expected completed response and count');
    assert.ok(observed.every(e => e.timeoutSeconds === null), 'nonstream entries never advertise stream deadlines');
    events.length = 0;
    assert.equal(await request({ stream: false, output: 'silent', liveTokenStreamFallbackChunkSize: undefined, liveTokenStreamCapabilityKey: undefined, onStreamToken: undefined, additionalPayload: undefined }), 'Hello');
    assert.equal(entries(events).length, 0);
}));

test('grouped nonstream chunks accumulate generated text once across continuation', { concurrency: false }, async () => withFixture(async () => {
    const events = collectProgress(); let n = 0;
    axios.post = async () => ++n === 1 ? completion('One', 'length', 'One') : completion('One two', 'stop', ' two');
    const group = 'nonstream-chunk-recovery-group';
    try {
        await LLMClient.withPromptProgressGroup({ progressGroupId: group, progressGroupTargetLabel: 'stream_recovery_test' }, async () => {
            assert.equal(await request({ stream: false, output: 'stdout', nonStreamTokenChunkSize: 2, liveTokenStreamFallbackChunkSize: undefined, liveTokenStreamCapabilityKey: undefined }), 'One two');
        });
        const groupEntries = entries(events).filter(e => e.progressGroupId === group);
        assert.equal(new Set(groupEntries.map(e => e.id)).size, 1);
        assert.ok(groupEntries.some(e => e.isGroupWaiting && e.receivedCount === 7), 'group counts only generated text');
        assert.ok(groupEntries.every(e => e.timeoutSeconds === null), 'nonstream chunk entries never advertise stream deadlines');
        assert.equal(n, 2);
    } finally { LLMClient.clearPromptProgressGroup(group); await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 }); }
}));

test('incompatible stream token metadata retains explicit chunk fallback for the process key', { concurrency: false }, async () => withFixture(async () => {
    const modes = [], diagnostics = [], events = collectProgress();
    axios.post = async (_url, payload) => {
        modes.push(payload.stream);
        return payload.stream ? { status: 200, data: stream([textChunk('Mismatch', 'Different')]) } : completion('Fallback');
    };
    const options = { retryAttempts: 0, output: 'stdout', onLiveTokenStreamFallback: diagnostic => diagnostics.push(diagnostic) };
    assert.equal(await request(options), 'Fallback');
    assert.equal(await request(options), 'Fallback');
    assert.deepEqual(modes, [true, false, false]);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].failureType, 'stream_compatibility_error');
    assert.ok(entries(events).some(e => e.isComplete && e.receivedCount === 8 && e.previewText === 'Fallback'));
}));

test('queued nonstream prompt is visible and cancellable before transport', { concurrency: false }, async () => withFixture(async () => {
    collectProgress();
    let release, entered;
    const hold = new Promise(resolve => { release = resolve; });
    const locked = new Promise(resolve => { entered = resolve; });
    const exclusive = LLMClient.withExclusiveModelLifecycle(async () => { entered(); await hold; });
    let calls = 0;
    axios.post = async () => { calls++; return completion('unexpected'); };
    const abort = new AbortController();
    let onId;
    const identified = new Promise(resolve => { onId = resolve; });
    try {
        await locked;
        const pending = request({ stream: false, output: 'stdout', signal: abort.signal, onPromptId: onId,
            liveTokenStreamFallbackChunkSize: undefined, liveTokenStreamCapabilityKey: undefined, onStreamToken: undefined, additionalPayload: undefined });
        const promptId = await identified;
        assert.ok(promptId);
        abort.abort('cancel queued nonstream');
        await assert.rejects(pending, error => error === 'cancel queued nonstream');
        assert.equal(calls, 0);
    } finally { abort.abort(); release(); await exclusive; }
    const drain = await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 10 });
    assert.equal(drain.trackedCount, 0);
}));

test('grouped JSON response validator can launch a nested completion after transport', { concurrency: false }, async () => withFixture(async () => {
    const events = collectProgress();
    Globals.config.ai.max_concurrent_requests = 2;
    Globals.config.ai.max_concurrent_requests_all_models = 2;
    let calls = 0;
    axios.post = async () => completion(++calls === 1 ? 'Outer' : 'Inner');
    const group = 'nested-json-validator-group';
    const options = { stream: false, output: 'stdout', throwOnError: true,
        liveTokenStreamFallbackChunkSize: undefined, liveTokenStreamCapabilityKey: undefined,
        onStreamToken: undefined, additionalPayload: undefined };
    try {
        await LLMClient.withPromptProgressGroup({ progressGroupId: group, progressGroupTargetLabel: 'stream_recovery_test' }, async () => {
            const result = await request({ ...options, responseValidator: async () => {
                assert.equal(await request(options), 'Inner');
            } });
            assert.equal(result, 'Outer');
        });
        assert.equal(calls, 2);
        const groupEntries = entries(events).filter(e => e.progressGroupId === group);
        assert.equal(new Set(groupEntries.map(e => e.id)).size, 1);
        assert.ok(groupEntries.some(e => e.isGroupWaiting && e.receivedCount === 10));
    } finally { LLMClient.clearPromptProgressGroup(group); await LLMClient.waitForPromptDrain({ timeoutMs: 3000, pollIntervalMs: 25 }); }
}));
