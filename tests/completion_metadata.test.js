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
const makeDir = () => fs.mkdtempSync(path.join(tempRoot, 'completion-metadata-'));
const readRows = dir => fs.readdirSync(dir).filter(name => /^completion-timing-.*\.jsonl$/.test(name))
    .flatMap(name => fs.readFileSync(path.join(dir, name), 'utf8').trim().split('\n').map(JSON.parse));
const config = stream => ({ ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'secret-test-key', model: 'metadata-model', stream, retryAttempts: 0, max_concurrent_requests: 4, supress_seed: true, prefill: null, stream_start_timeout: 3600, stream_continue_timeout: 3600 } });
const opts = (label, extra = {}) => ({ messages: [{ role: 'user', content: 'private prompt text' }], metadataLabel: label, validateXML: false, retryAttempts: 0, output: 'silent', ...extra });
const response = (text, finish, usage, extra = {}) => ({ status: 200, statusText: 'OK', headers: {}, data: { choices: [{ message: { role: 'assistant', content: text }, ...(finish === undefined ? {} : { finish_reason: finish }), ...extra }], ...(usage === undefined ? {} : { usage }) } });

async function fixture(stream, run) {
    const original = { post: axios.post, config: Globals.config, baseDir: Globals.baseDir, hub: Globals.realtimeHub, log: console.log };
    const dir = makeDir();
    const consoleRows = [];
    Globals.baseDir = dir;
    Globals.config = config(stream);
    Globals.realtimeHub = { emit() {} };
    console.log = (...args) => {
        if (typeof args[0] === 'string' && args[0].startsWith('LLM completion timing: ')) consoleRows.push(JSON.parse(args[0].slice('LLM completion timing: '.length)));
    };
    try { await run({ dir, consoleRows }); }
    finally { axios.post = original.post; Globals.config = original.config; Globals.baseDir = original.baseDir; Globals.realtimeHub = original.hub; console.log = original.log; }
}

function fakeStream(frames) {
    const stream = new EventEmitter();
    setImmediate(() => {
        for (const frame of frames) stream.emit('data', frame);
        stream.emit('end');
    });
    return { status: 200, statusText: 'OK', headers: {}, data: stream };
}

test('stream terminal metadata survives a later caller parser failure and is mirrored to console', { concurrency: false }, async () => {
    await fixture(true, async ({ dir, consoleRows }) => {
        let sentPayload;
        axios.post = async (_url, payload) => {
            sentPayload = structuredClone(payload);
            return fakeStream([
                'data: {"id":"stream-response-id","choices":[{"delta":{"content":"malformed result"}}]}\n\n',
                'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
                'data: {"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":5,"total_tokens":22,"private":"sensitive"}}',
            ]);
        };
        let owner;
        await assert.rejects(PromptAuditLog.runTurn({ requestId: 'parser-failure', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            const output = await LLMClient.chatCompletion(opts('inventory', { stream: true, maxTokens: 25, additionalPayload: { stop: ['END'] } }));
            assert.equal(output, 'malformed result');
            throw new Error('domain parser failure');
        }), /domain parser failure/);
        const [row] = readRows(dir);
        assert.equal(readRows(dir).length, 1);
        assert.deepEqual(consoleRows, [row]);
        assert.equal(sentPayload.max_tokens, 25);
        assert.deepEqual(sentPayload.stop, ['END']);
        assert.equal(row.backend, 'openai_compatible');
        assert.equal(row.streaming, true);
        assert.equal(row.model, 'metadata-model');
        assert.equal(row.providerResponseId, 'stream-response-id');
        assert.equal(row.providerFinishReason, 'length');
        assert.deepEqual([row.promptTokens, row.completionTokens, row.totalTokens], [17, 5, 22]);
        assert.equal(row.requestMaxTokens, 25);
        assert.deepEqual(row.requestStop, ['END']);
        assert.doesNotMatch(JSON.stringify(row), /secret-test-key|private prompt text|malformed result|sensitive/);
        await PromptAuditLog.waitForFinalization(owner);
    });
});

test('same-label concurrent nonstream completions retain independent metadata and missing fields stay null', { concurrency: false }, async () => {
    await fixture(false, async ({ dir }) => {
        let release;
        const barrier = new Promise(resolve => { release = resolve; });
        let count = 0;
        axios.post = async (_url, payload) => {
            const which = payload.messages[0].content;
            if (++count === 2) release();
            await barrier;
            const result = which === 'a' ? response('A', 'length', { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }) : response('B', undefined, { prompt_tokens: '9', completion_tokens: 0 });
            result.data.id = `response-${which}`;
            return result;
        };
        const owners = [];
        await Promise.all(['a', 'b'].map(id => PromptAuditLog.runTurn({ requestId: id, logDirectory: dir }, async () => {
            owners.push(PromptAuditLog.currentTurn());
            assert.equal(await LLMClient.chatCompletion(opts('same-label', { messages: [{ role: 'user', content: id }], stream: false, model: `model-${id}` })), id.toUpperCase());
        })));
        const result = new Map(readRows(dir).map(row => [row.requestId, row]));
        assert.equal(result.size, 2);
        const a = result.get('a');
        const b = result.get('b');
        assert.notEqual(a.completionId, b.completionId);
        assert.equal(a.model, 'model-a');
        assert.equal(b.model, 'model-b');
        assert.equal(a.providerResponseId, 'response-a');
        assert.equal(b.providerResponseId, 'response-b');
        assert.equal(a.streaming, false);
        assert.equal(a.providerFinishReason, 'length');
        assert.deepEqual([a.promptTokens, a.completionTokens, a.totalTokens], [3, 4, 7]);
        assert.equal(b.providerFinishReason, null);
        assert.deepEqual([b.promptTokens, b.completionTokens, b.totalTokens], [null, 0, null]);
        assert.equal(b.requestMaxTokens, null);
        assert.equal(b.requestStop, null);
        await Promise.all(owners.map(owner => PromptAuditLog.waitForFinalization(owner)));
    });
});

test('token-chunk continuations report each actual request and response separately', { concurrency: false }, async () => {
    await fixture(false, async ({ dir }) => {
        const requests = [];
        axios.post = async (_url, payload) => {
            requests.push(structuredClone(payload));
            return requests.length === 1
                ? response('Hi ', 'length', { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 }, { logprobs: { content: [{ token: 'Hi ', bytes: [72, 105, 32] }] } })
                : response('there', 'stop', { prompt_tokens: 6, completion_tokens: 1, total_tokens: 7 }, { logprobs: { content: [{ token: 'there', bytes: [116, 104, 101, 114, 101] }] } });
        };
        let owner;
        await PromptAuditLog.runTurn({ requestId: 'chunked', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            assert.equal(await LLMClient.chatCompletion(opts('chunked', { stream: false, maxTokens: 3, nonStreamTokenChunkSize: 1, onStreamToken() {} })), 'Hi there');
        });
        const result = readRows(dir);
        assert.equal(result.length, 2);
        assert.equal(result[0].completionId, result[1].completionId);
        assert.deepEqual(result.map(row => row.providerFinishReason), ['length', 'stop']);
        assert.deepEqual(result.map(row => row.promptTokens), [4, 6]);
        assert.deepEqual(result.map(row => row.requestMaxTokens), requests.map(payload => payload.max_tokens));
        assert.deepEqual(result.map(row => row.requestMaxTokens), [1, 1]);
        await PromptAuditLog.waitForFinalization(owner);
    });
});

test('CLI bridge usage is captured without inventing a provider finish reason', { concurrency: false }, async () => {
    await fixture(false, async ({ dir }) => {
        const bridge = require('../CodexBridgeClient.js');
        const original = bridge.chatCompletion;
        Globals.config = { ai: { backend: 'codex_cli_bridge', model: 'cli-model', stream: true, retryAttempts: 0, max_concurrent_requests: 1, codex_bridge: { command: 'codex', home: './tmp/test-codex-home', session_mode: 'fresh', session_id: '', sandbox: 'read-only', skip_git_repo_check: true, reasoning_effort: '', profile: '', prompt_preamble: '' } } };
        bridge.chatCompletion = async () => {
            const result = response('Bridge result', 'stop', { input_tokens: 12, cached_input_tokens: 2, output_tokens: 4, total_tokens: 16 });
            result.data.id = 'synthetic-cli-id';
            return result;
        };
        let owner;
        try {
            await PromptAuditLog.runTurn({ requestId: 'cli', logDirectory: dir }, async () => {
                owner = PromptAuditLog.currentTurn();
                assert.equal(await LLMClient.chatCompletion(opts('cli', { maxTokens: 99, additionalPayload: { stop: ['END'] } })), 'Bridge result');
            });
            const [row] = readRows(dir);
            assert.equal(row.backend, 'codex_cli_bridge');
            assert.equal(row.providerResponseId, null);
            assert.equal(row.streaming, true);
            assert.equal(row.model, 'cli-model');
            assert.equal(row.providerFinishReason, null);
            assert.deepEqual([row.promptTokens, row.cachedInputTokens, row.completionTokens, row.totalTokens], [12, 2, 4, 16]);
            assert.equal(row.requestMaxTokens, 99);
            assert.deepEqual(row.requestStop, ['END']);
            assert.equal(row.settingsForwardedToProvider, false);
            await PromptAuditLog.waitForFinalization(owner);
        } finally { bridge.chatCompletion = original; }
    });
});

test('a failed stream keeps observed partial metadata and leaves unavailable values null', { concurrency: false }, async () => {
    await fixture(true, async ({ dir }) => {
        axios.post = async () => {
            const stream = new EventEmitter();
            setImmediate(async () => {
                stream.emit('data', 'data: {"choices":[],"usage":{"prompt_tokens":8}}\n\n');
                await new Promise(resolve => setImmediate(resolve));
                stream.emit('error', new Error('transport interrupted'));
            });
            return { status: 200, statusText: 'OK', headers: {}, data: stream };
        };
        let owner;
        await assert.rejects(PromptAuditLog.runTurn({ requestId: 'partial', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            await LLMClient.chatCompletion(opts('partial', { stream: true, throwOnError: true }));
        }), /transport interrupted/);
        const [row] = readRows(dir);
        assert.equal(row.firstOutputKind, null);
        assert.equal(row.providerFinishReason, null);
        assert.deepEqual([row.promptTokens, row.completionTokens, row.totalTokens], [8, null, null]);
        await PromptAuditLog.waitForFinalization(owner);
    });
});

test('a validation retry does not reuse the prior attempt metadata', { concurrency: false }, async () => {
    await fixture(false, async ({ dir }) => {
        let calls = 0;
        axios.post = async () => ++calls === 1
            ? response('<result>', 'length', { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 })
            : response('<result>ok</result>', undefined, { completion_tokens: 3 });
        let owner;
        await PromptAuditLog.runTurn({ requestId: 'retry', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            assert.equal(await LLMClient.chatCompletion(opts('retry', { stream: false, validateXML: true, validateXMLStrict: true, retryAttempts: 1, waitAfterError: 0, throwOnError: true })), '<result>ok</result>');
        });
        const result = readRows(dir);
        assert.equal(result.length, 2);
        assert.deepEqual(result.map(row => row.attempt), [1, 2]);
        assert.deepEqual(result.map(row => row.providerFinishReason), ['length', null]);
        assert.deepEqual(result.map(row => [row.promptTokens, row.completionTokens, row.totalTokens]), [[8, 2, 10], [null, 3, null]]);
        await PromptAuditLog.waitForFinalization(owner);
    });
});

test('cancelled dispatched request records known settings and null unobserved response metadata', { concurrency: false }, async () => {
    await fixture(false, async ({ dir }) => {
        const controller = new AbortController();
        axios.post = async (_url, _payload, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason || new Error('cancelled')), { once: true });
            setImmediate(() => controller.abort(new Error('cancelled by test')));
        });
        let owner;
        await assert.rejects(PromptAuditLog.runTurn({ requestId: 'cancel', logDirectory: dir }, async () => {
            owner = PromptAuditLog.currentTurn();
            await LLMClient.chatCompletion(opts('cancel', { stream: false, maxTokens: 20, signal: controller.signal, throwOnError: true }));
        }), /cancel/i);
        const [row] = readRows(dir);
        assert.equal(row.outcome, 'cancelled');
        assert.equal(row.providerResponseId, null);
        assert.equal(row.requestMaxTokens, 20);
        assert.equal(row.firstOutputKind, null);
        assert.equal(row.providerFinishReason, null);
        assert.deepEqual([row.promptTokens, row.completionTokens, row.totalTokens], [null, null, null]);
        await PromptAuditLog.waitForFinalization(owner);
    });
});

test('shared detached completion fans startup latency to reserved owners and emits one transport record', { concurrency: false }, async () => {
    await fixture(true, async ({ dir }) => {
        Globals.config.prompt_audit = { high_latency_seconds: 1 };
        const originalNow = Date.now;
        let now = 10000;
        Date.now = () => now;
        const owners = [];
        try {
            for (const id of ['shared-a', 'shared-b']) {
                await PromptAuditLog.runTurn({ requestId: id, logDirectory: path.join(dir, id) }, async () => {
                    const owner = PromptAuditLog.currentTurn();
                    await PromptAuditLog.runPrompt({ metadataLabel: 'image_owner', kind: 'image' }, () => (
                        PromptAuditLog.runStage({ stage: 'image-text', parser: 'image_prompt' }, async () => {
                            owners.push({ owner, handle: PromptAuditLog.reserveWork() });
                        })
                    ));
                });
            }
            let release;
            const gate = new Promise(resolve => { release = resolve; });
            let dispatched;
            const dispatch = new Promise(resolve => { dispatched = resolve; });
            axios.post = async () => {
                const stream = new EventEmitter();
                setImmediate(async () => {
                    dispatched();
                    await gate;
                    now += 1000;
                    stream.emit('data', 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"total_tokens":7}}\n\n');
                    stream.emit('end');
                });
                return { status: 200, statusText: 'OK', headers: {}, data: stream };
            };
            const completion = PromptAuditLog.withoutTurn(() => LLMClient.chatCompletion(opts('shared-image', { stream: true })), { failureContexts: owners.map(item => item.handle) });
            await dispatch;
            for (const { owner } of owners) assert.equal(PromptAuditLog.snapshot(owner).latencyCount, 0);
            release();
            assert.equal(await completion, 'ok');
            for (const { owner } of owners) {
                const snapshot = PromptAuditLog.snapshot(owner);
                assert.equal(snapshot.latencyCount, 1);
                assert.equal(snapshot.latencyRows[0].stage, 'image-text');
                assert.equal(snapshot.latencyRows[0].metadataLabel, 'shared-image');
                assert.equal(snapshot.latencyRows[0].kind, 'first_generated_output');
            }
            const [row] = readRows(path.join(dir, 'logs'));
            assert.equal(readRows(path.join(dir, 'logs')).length, 1);
            assert.equal(row.requestId, null);
            assert.equal(row.providerFinishReason, 'stop');
            assert.equal(row.totalTokens, 7);
        } finally {
            for (const { handle } of owners) handle.release();
            await Promise.all(owners.map(({ owner }) => PromptAuditLog.waitForFinalization(owner)));
            Date.now = originalNow;
        }
    });
});
