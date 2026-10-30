const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const PromptAuditLog = require('../PromptAuditLog.js');

const tempRoot = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const directory = () => fs.mkdtempSync(path.join(tempRoot, 'completion-timing-'));
const rows = dir => fs.readdirSync(dir).filter(name => /^completion-timing-.*\.jsonl$/.test(name))
    .flatMap(name => fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n').map(JSON.parse));

function clock() {
    const original = process.hrtime.bigint;
    let ms = 0;
    process.hrtime.bigint = () => BigInt(ms) * 1000000n;
    return { advance: n => { ms += n; }, restore: () => { process.hrtime.bigint = original; } };
}

test('attempt timing records independent monotonic intervals and omits undispatched attempts', { concurrency: false }, async () => {
    const dir = directory();
    const time = clock();
    let owner;
    try {
        await PromptAuditLog.runTurn({ requestId: 'timing-turn', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            const timing = PromptAuditLog.beginCompletionTiming({ metadataLabel: 'timing-test' });
            time.advance(100);
            timing.beginAttempt({ attempt: 1 });
            time.advance(300);
            timing.transportStarted({ backend: 'openai_compatible', streaming: true });
            time.advance(2000);
            timing.firstOutput({ kind: 'first_generated_output' });
            time.advance(500);
            timing.firstOutput({ kind: 'first_generated_output' });
            timing.transportFinished();
            time.advance(50);
            timing.finishAttempt({ outcome: 'success' });
            timing.beginAttempt({ attempt: 2 });
            time.advance(10);
            timing.finishAttempt({ outcome: 'cancelled' });
        });
        const [row] = rows(dir);
        assert.equal(rows(dir).length, 1);
        assert.equal(row.requestId, 'timing-turn');
        assert.equal(row.metadataLabel, 'timing-test');
        assert.match(row.completionId, /^[0-9a-f-]{36}$/);
        assert.equal(row.attempt, 1);
        assert.equal(row.backend, 'openai_compatible');
        assert.equal(row.streaming, true);
        assert.equal(row.firstOutputKind, 'first_generated_output');
        assert.equal(row.preparationMs, 300);
        assert.equal(row.dispatchToFirstOutputMs, 2000);
        assert.equal(row.completionToFirstOutputMs, 2400);
        assert.equal(row.transportDurationMs, 2500);
        assert.equal(row.attemptTotalMs, 2850);
        assert.equal(row.completionElapsedMs, 2950);
        assert.equal(PromptAuditLog.snapshot(owner).latencyCount, 0);
        await PromptAuditLog.waitForFinalization(owner);
    } finally { time.restore(); }
});

test('dispatched retries and cancellation have separate records, including no-output attempts', { concurrency: false }, async () => {
    const dir = directory();
    const time = clock();
    let owner;
    try {
        await PromptAuditLog.runTurn({ requestId: 'retry-turn', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            const timing = PromptAuditLog.beginCompletionTiming({ metadataLabel: 'retry-test' });
            timing.beginAttempt({ attempt: 1 });
            timing.transportStarted({ backend: 'openai_compatible', streaming: false });
            time.advance(300);
            timing.transportFinished();
            timing.retryDelayStarted();
            time.advance(400);
            timing.retryDelayFinished();
            timing.finishAttempt({ outcome: 'error' });
            timing.beginAttempt({ attempt: 2 });
            time.advance(200);
            timing.transportStarted({ backend: 'openai_compatible', streaming: false });
            time.advance(300);
            timing.finishAttempt({ outcome: 'cancelled' });
        });
        const result = rows(dir);
        assert.equal(result.length, 2);
        assert.equal(result[0].completionId, result[1].completionId);
        assert.deepEqual(result.map(row => row.outcome), ['error', 'cancelled']);
        assert.deepEqual(result.map(row => row.attempt), [1, 2]);
        assert.equal(result[0].retryBackoffMs, 400);
        assert.equal(result[1].preparationMs, 200);
        for (const row of result) {
            assert.equal(row.firstOutputKind, null);
            assert.equal(row.dispatchToFirstOutputMs, null);
        }
        await PromptAuditLog.waitForFinalization(owner);
    } finally { time.restore(); }
});

test('stream timing starts at dispatch and ignores headers and non-output frames', { concurrency: false }, async () => {
    const dir = directory();
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir, hub: Globals.realtimeHub };
    const time = clock();
    Globals.baseDir = dir;
    Globals.realtimeHub = { emit() {} };
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test', model: 'timing-model', stream: true, retryAttempts: 0, max_concurrent_requests: 1, supress_seed: true, prefill: null, stream_start_timeout: 3600, stream_continue_timeout: 3600 } };
    axios.post = async () => {
        time.advance(500); // Waiting for HTTP headers is not generated output.
        const stream = new EventEmitter();
        setImmediate(async () => {
            stream.emit('data', ': keepalive\n\ndata: {"usage":{"total_tokens":0},"choices":[]}\n\ndata: {"choices":[{"delta":{}}]}\n\n');
            await new Promise(resolve => setImmediate(resolve));
            time.advance(1500);
            stream.emit('data', 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
            await new Promise(resolve => setImmediate(resolve));
            time.advance(100);
            stream.emit('data', 'data: [DONE]\n\n');
            stream.emit('end');
        });
        return { status: 200, statusText: 'OK', headers: {}, data: stream };
    };
    let owner;
    try {
        const result = await PromptAuditLog.runTurn({ requestId: 'stream-turn', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            const response = await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Hello' }], metadataLabel: 'stream-test', stream: true, validateXML: false, retryAttempts: 0, output: 'silent' });
            return { response, snapshot: PromptAuditLog.snapshot(owner) };
        });
        assert.equal(result.response, 'Hello');
        assert.equal(result.snapshot.latencyCount, 0);
        const [row] = rows(dir);
        assert.equal(rows(dir).length, 1);
        assert.equal(row.firstOutputKind, 'first_generated_output');
        assert.equal(row.dispatchToFirstOutputMs, 2000);
        assert.equal(row.requestId, 'stream-turn');
        await PromptAuditLog.waitForFinalization(owner);
    } finally {
        axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; Globals.realtimeHub = original.hub; time.restore();
    }
});

test('same-label concurrent turn timings keep their request owners and completion IDs', { concurrency: false }, async () => {
    const dir = directory();
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const owners = [];
    const run = requestId => PromptAuditLog.runTurn({ requestId, logDirectory: dir }, async () => {
        owners.push(PromptAuditLog.currentTurn());
        const timing = PromptAuditLog.beginCompletionTiming({ metadataLabel: 'same-label' });
        timing.beginAttempt({ attempt: 1 });
        timing.transportStarted({ backend: 'openai_compatible', streaming: true });
        if (owners.length === 2) release();
        await barrier;
        timing.firstOutput({ kind: 'first_generated_output' });
        timing.finishAttempt({ outcome: 'completed' });
    });
    await Promise.all([run('turn-a'), run('turn-b')]);
    const result = rows(dir);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map(row => row.requestId).sort(), ['turn-a', 'turn-b']);
    assert.notEqual(result[0].completionId, result[1].completionId);
    assert.notEqual(result[0].auditId, result[1].auditId);
    await Promise.all(owners.map(owner => PromptAuditLog.waitForFinalization(owner)));
});

test('timing write failure warns with the filesystem error without replacing the operation error', { concurrency: false }, async () => {
    const dir = directory();
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'not a directory');
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    const originalError = new Error('original provider failure');
    try {
        await assert.rejects(PromptAuditLog.runTurn({ requestId: 'writer-failure', logDirectory: path.join(blocker, 'logs') }, async () => {
            const timing = PromptAuditLog.beginCompletionTiming({ metadataLabel: 'writer-failure' });
            timing.beginAttempt({ attempt: 1 });
            timing.transportStarted({ backend: 'openai_compatible', streaming: true });
            try { throw originalError; }
            finally { timing.finishAttempt({ outcome: 'error' }); }
        }), error => error === originalError);
        assert.ok(warnings.some(args => /Failed to write completion timing log/.test(String(args[0])) && /ENOTDIR|EEXIST/.test(String(args[1]))));
    } finally { console.warn = originalWarn; }
});

test('streamed tool call IDs and names do not count before argument output', { concurrency: false }, async () => {
    const dir = directory();
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir, hub: Globals.realtimeHub };
    const time = clock();
    Globals.baseDir = dir;
    Globals.realtimeHub = { emit() {} };
    Globals.config = { ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test', model: 'tool-timing-model', stream: true, retryAttempts: 0, max_concurrent_requests: 1, supress_seed: true, prefill: null, stream_start_timeout: 3600, stream_continue_timeout: 3600 } };
    axios.post = async () => {
        const stream = new EventEmitter();
        setImmediate(async () => {
            stream.emit('data', 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup"}}]}}]}\n\n');
            await new Promise(resolve => setImmediate(resolve));
            time.advance(2000);
            stream.emit('data', 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n');
            await new Promise(resolve => setImmediate(resolve));
            stream.emit('data', 'data: [DONE]\n\n');
            stream.emit('end');
        });
        return { status: 200, statusText: 'OK', headers: {}, data: stream };
    };
    let owner;
    try {
        await PromptAuditLog.runTurn({ requestId: 'tool-stream-turn', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Call lookup' }], metadataLabel: 'tool-stream', additionalPayload: { tools: [{ type: 'function', function: { name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } } }], tool_choice: 'auto' }, stream: true, validateXML: false, retryAttempts: 0, output: 'silent' });
        });
        const [row] = rows(dir);
        assert.equal(row.firstOutputKind, 'first_generated_output');
        assert.equal(row.ttftMs, 2000);
        await PromptAuditLog.waitForFinalization(owner);
    } finally {
        axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; Globals.realtimeHub = original.hub; time.restore();
    }
});

test('CLI bridge snapshots are first responses while incremental deltas are TTFT', { concurrency: false }, async () => {
    const CodexBridgeClient = require('../CodexBridgeClient.js');
    const dir = directory();
    const original = { bridge: CodexBridgeClient.chatCompletion, config: Globals.config, baseDir: Globals.baseDir, hub: Globals.realtimeHub };
    const time = clock();
    Globals.baseDir = dir;
    Globals.realtimeHub = { emit() {} };
    Globals.config = { ai: { backend: 'codex_cli_bridge', model: 'timing-model', stream: true, retryAttempts: 0, max_concurrent_requests: 1, codex_bridge: { command: 'codex', home: './tmp/test-codex-home', session_mode: 'fresh', session_id: '', sandbox: 'read-only', skip_git_repo_check: true, reasoning_effort: '', profile: '', prompt_preamble: '' } } };
    let event;
    CodexBridgeClient.chatCompletion = async ({ onStdoutEvent }) => {
        time.advance(2000);
        if (event) onStdoutEvent(event);
        return { status: 200, statusText: 'OK', headers: {}, data: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Bridge output' } }] } };
    };
    let owner;
    try {
        await PromptAuditLog.runTurn({ requestId: 'bridge-timing', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            for (const [label, payload] of [
                ['snapshot', { type: 'item.completed', item: { type: 'agent_message', text: 'Bridge output' } }],
                ['delta', { type: 'agent_message_delta', delta: 'Bridge output' }],
                ['final', null]
            ]) {
                event = payload;
                assert.equal(await LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Hello' }], metadataLabel: label, validateXML: false, output: 'silent' }), 'Bridge output');
            }
        });
        const result = new Map(rows(dir).map(row => [row.metadataLabel, row]));
        assert.equal(result.size, 3);
        for (const label of ['snapshot', 'final']) {
            assert.equal(result.get(label).firstOutputKind, 'first_response');
            assert.equal(result.get(label).firstResponseMs, 2000);
            assert.equal(result.get(label).ttftMs, null);
        }
        assert.equal(result.get('delta').firstOutputKind, 'first_generated_output');
        assert.equal(result.get('delta').ttftMs, 2000);
        assert.equal(result.get('delta').firstResponseMs, null);
        await PromptAuditLog.waitForFinalization(owner);
    } finally {
        CodexBridgeClient.chatCompletion = original.bridge; Globals.config = original.config; Globals.baseDir = original.baseDir; Globals.realtimeHub = original.hub; time.restore();
    }
});
