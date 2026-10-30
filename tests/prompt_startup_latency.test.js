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

function makeLogDirectory() {
    return fs.mkdtempSync(path.join(tempRoot, 'prompt-startup-latency-'));
}

function makeConfig({ stream = false, highLatencySeconds } = {}) {
    return {
        ...(highLatencySeconds === undefined ? {} : { prompt_audit: { high_latency_seconds: highLatencySeconds } }),
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'startup-latency-test-model',
            stream,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true,
            prefill: null,
            stream_start_timeout: 3600,
            stream_continue_timeout: 3600
        }
    };
}

function providerResponse(payload, message, { finishReason = 'stop', logprobs = undefined } = {}) {
    const choice = { message, finish_reason: finishReason };
    if (logprobs !== undefined) choice.logprobs = logprobs;
    return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: 'startup-latency-test',
            model: payload.model,
            choices: [choice]
        }
    };
}

function withMockClock(start = 10000) {
    const originalNow = Date.now;
    let current = start;
    Date.now = () => current;
    return {
        now: () => current,
        set: value => { current = value; },
        advance: duration => { current += duration; },
        restore: () => { Date.now = originalNow; }
    };
}

test('latency threshold config uses five seconds by default, accepts fractions, and rejects invalid values', { concurrency: false }, () => {
    assert.equal(PromptAuditLog.resolveHighLatencySeconds({}), 5);
    assert.equal(PromptAuditLog.resolveHighLatencySeconds({ prompt_audit: {} }), 5);
    assert.equal(PromptAuditLog.resolveHighLatencySeconds({ prompt_audit: { high_latency_seconds: 2.5 } }), 2.5);
    assert.equal(PromptAuditLog.resolveHighLatencySeconds({ prompt_audit: { high_latency_seconds: 0.125 } }), 0.125);

    for (const promptAudit of [null, [], '5']) {
        assert.throws(
            () => PromptAuditLog.resolveHighLatencySeconds({ prompt_audit: promptAudit }),
            /prompt_audit must be an object/
        );
    }
    for (const value of [null, '5', true, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.throws(
            () => PromptAuditLog.resolveHighLatencySeconds({ prompt_audit: { high_latency_seconds: value } }),
            /high_latency_seconds must be a positive finite number/
        );
    }
});

test('latency records include the exact threshold, omit 4,999 ms, and honor a 2.5 second override', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    Globals.config = { prompt_audit: {} };
    let owner;
    let duringTurn;
    try {
        await PromptAuditLog.runTurn({
            requestId: 'latency-boundaries',
            logDirectory: makeLogDirectory()
        }, async () => {
            owner = PromptAuditLog.currentTurn();
            PromptAuditLog.recordStartupLatency(4999, {
                metadataLabel: 'below-default', kind: 'first_generated_output'
            });
            PromptAuditLog.recordStartupLatency(5000, {
                metadataLabel: 'at-default', kind: 'first_generated_output'
            });
            PromptAuditLog.recordStartupLatency(2499, {
                metadataLabel: 'below-override', kind: 'first_chunk', thresholdSeconds: 2.5
            });
            PromptAuditLog.recordStartupLatency(2500, {
                metadataLabel: 'at-override', kind: 'first_chunk', thresholdSeconds: 2.5
            });
            duringTurn = PromptAuditLog.snapshot(owner);
        });

        assert.equal(duringTurn.latencyCount, 2);
        assert.equal(duringTurn.errorCount, 0);
        assert.deepEqual(duringTurn.latencyRows.map(row => row.metadataLabel).sort(), ['at-default', 'at-override']);
        const defaultRow = duringTurn.latencyRows.find(row => row.metadataLabel === 'at-default');
        assert.equal(defaultRow.kind, 'first_generated_output');
        assert.equal(defaultRow.thresholdSeconds, 5);
        assert.equal(defaultRow.totalMs, 5000);
        const overrideRow = duringTurn.latencyRows.find(row => row.metadataLabel === 'at-override');
        assert.equal(overrideRow.kind, 'first_chunk');
        assert.equal(overrideRow.thresholdSeconds, 2.5);
        assert.equal(overrideRow.totalMs, 2500);
        await PromptAuditLog.waitForFinalization(owner);
    } finally {
        Globals.config = originalConfig;
    }
});

test('startup tracker includes preparation time, records no-output waits, and separates latency from errors', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const clock = withMockClock(10000);
    Globals.config = { prompt_audit: { high_latency_seconds: 5 } };
    let owner;
    let snapshot;
    try {
        await PromptAuditLog.runTurn({
            requestId: 'latency-tracker-outcomes',
            logDirectory: makeLogDirectory()
        }, async () => {
            owner = PromptAuditLog.currentTurn();
            await PromptAuditLog.runPrompt({ metadataLabel: 'slow-response' }, async () => {
                await PromptAuditLog.runStage({ stage: 'checkpoint_1', parser: 'response', checkpoint: 1 }, async () => {
                    const output = PromptAuditLog.beginStartupLatency({ metadataLabel: 'slow-response' });
                    clock.advance(2000); // Queue and prompt preparation time.
                    output.transportStarted();
                    clock.advance(3000);
                    output.firstOutput({ kind: 'first_response' });
                    output.firstOutput({ kind: 'first_chunk' });
                    output.finish({ outcome: 'success' });

                    const noOutput = PromptAuditLog.beginStartupLatency({ metadataLabel: 'slow-response' });
                    noOutput.transportStarted();
                    clock.advance(5000);
                    noOutput.finish({ outcome: 'no_output' });

                    const noDispatch = PromptAuditLog.beginStartupLatency({ metadataLabel: 'pre-dispatch-cancel' });
                    clock.advance(5000);
                    noDispatch.finish({ outcome: 'cancelled' });

                    const failedError = new Error('The response parser rejected the completed output.');
                    const failed = PromptAuditLog.beginStartupLatency({ metadataLabel: 'slow-response' });
                    failed.transportStarted();
                    clock.advance(5000);
                    failed.firstOutput({ kind: 'first_generated_output' });
                    failed.finish({ outcome: 'error' });
                    PromptAuditLog.recordFailure(failedError, { phase: 'validation', source: 'latency-fixture' });
                });
            });
            snapshot = PromptAuditLog.snapshot(owner);
        });

        assert.equal(snapshot.latencyCount, 3);
        assert.equal(snapshot.errorCount, 1);
        const output = snapshot.latencyRows.find(row => row.kind === 'first_response');
        assert.ok(output);
        assert.equal(output.totalMs, 5000);
        assert.equal(output.preparationTotalMs, 2000);
        assert.equal(output.stage, 'checkpoint_1');
        assert.equal(output.checkpoint, 1);
        assert.equal(output.outcome, 'output');
        assert.equal(output.count, 1, 'repeated output/finish notifications must not duplicate a completion sample');
        const noOutput = snapshot.latencyRows.find(row => row.kind === 'no_output');
        assert.equal(noOutput.outcome, 'no_output');
        assert.equal(noOutput.totalMs, 5000);
        const failedOutput = snapshot.latencyRows.find(row => row.kind === 'first_generated_output');
        assert.equal(failedOutput.outcome, 'output');
        assert.equal(snapshot.rows.length, 1);
        assert.equal(snapshot.rows[0].phase, 'validation');

        const filePath = await PromptAuditLog.waitForFinalization(owner);
        const content = await fs.promises.readFile(filePath, 'utf8');
        assert.match(content, /Error occurrences: 1.*High startup latency: 3/);
        assert.match(content, /LATENCY 1 x \| slow-response \| checkpoint_1\/response/);
    } finally {
        clock.restore();
        Globals.config = originalConfig;
    }
});

test('latency trackers created in detached shared work fan out to each reserved owner', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const clock = withMockClock(20000);
    Globals.config = { prompt_audit: { high_latency_seconds: 5 } };
    const createOwner = async requestId => {
        let handle;
        const state = await PromptAuditLog.runTurn({ requestId, logDirectory: makeLogDirectory() }, async () => {
            const owner = PromptAuditLog.currentTurn();
            await PromptAuditLog.runPrompt({ metadataLabel: 'image_prompt_generation', kind: 'image' }, () => (
                PromptAuditLog.runStage({ stage: 'image-text', parser: 'image_prompt' }, async () => {
                    handle = PromptAuditLog.reserveWork();
                })
            ));
            return { owner, handle };
        });
        return state;
    };

    try {
        const [ownerA, ownerB] = await Promise.all([createOwner('latency-owner-a'), createOwner('latency-owner-b')]);
        let ambientTurn;
        await PromptAuditLog.withoutTurn(() => {
            ambientTurn = PromptAuditLog.currentTurn();
            const tracker = PromptAuditLog.beginStartupLatency({ metadataLabel: 'shared_image_prompt' });
            tracker.transportStarted();
            clock.advance(5000);
            PromptAuditLog.addLogReference('/tmp/shared image [prompt].log');
            tracker.firstOutput({ kind: 'first_chunk' });
            tracker.finish({ outcome: 'success' });
        }, { failureContexts: [ownerA.handle, ownerB.handle] });

        assert.equal(ambientTurn, null);
        for (const {owner} of [ownerA, ownerB]) {
            const snapshot = PromptAuditLog.snapshot(owner);
            assert.equal(snapshot.latencyCount, 1);
            assert.equal(snapshot.errorCount, 0);
            assert.equal(snapshot.latencyRows[0].metadataLabel, 'shared_image_prompt');
            assert.equal(snapshot.latencyRows[0].stage, 'image-text');
            assert.equal(snapshot.latencyRows[0].kind, 'first_chunk');
            assert.equal(snapshot.latencyRows[0].totalMs, 5000);
            assert.deepEqual(snapshot.latencyRows[0].logPaths, ['/tmp/shared image [prompt].log']);
        }

        ownerA.handle.release();
        ownerB.handle.release();
        const [fileA, fileB] = await Promise.all([
            PromptAuditLog.waitForFinalization(ownerA.owner),
            PromptAuditLog.waitForFinalization(ownerB.owner)
        ]);
        const [contentA, contentB] = await Promise.all([
            fs.promises.readFile(fileA, 'utf8'),
            fs.promises.readFile(fileB, 'utf8')
        ]);
        assert.match(contentA, /LATENCY 1 x \| shared_image_prompt \| image-text\/image_prompt/);
        assert.match(contentB, /shared image \[prompt\]\.log/);
        assert.equal(ownerA.owner.latencyRows.size, 0);
        assert.equal(ownerB.owner.latencyRows.size, 0);
    } finally {
        clock.restore();
        Globals.config = originalConfig;
    }
});

test('ownerless reserved work stays isolated when invoked inside a shared-turn forwarding scope', { concurrency: false }, async () => {
    const ownerlessHandle = PromptAuditLog.reserveWork();
    const originalConfig = Globals.config;
    const clock = withMockClock(40000);
    Globals.config = { prompt_audit: { high_latency_seconds: 1 } };
    let foreignOwner;
    let duringTurn;
    try {
        await PromptAuditLog.runTurn({
            requestId: 'ownerless-forwarding-isolation',
            logDirectory: makeLogDirectory()
        }, async () => {
            foreignOwner = PromptAuditLog.currentTurn();
            await PromptAuditLog.withoutTurn(() => {
                assert.equal(PromptAuditLog.currentTurn(), null);
                assert.doesNotThrow(() => {
                    PromptAuditLog.recordFailure(new Error('detached shared failure'), {
                        phase: 'transport', source: 'ownerless-forwarding-fixture'
                    });
                    PromptAuditLog.addLogReference('/tmp/ownerless shared [prompt].log');
                    PromptAuditLog.recordCancellation();
                    const tracker = PromptAuditLog.beginStartupLatency({ metadataLabel: 'ownerless_shared_prompt' });
                    tracker.transportStarted();
                    clock.advance(1000);
                    tracker.firstOutput({ kind: 'first_chunk' });
                    tracker.finish({ outcome: 'success' });
                });
            }, { failureContexts: [ownerlessHandle] });
            assert.equal(PromptAuditLog.currentTurn(), foreignOwner);
            duringTurn = PromptAuditLog.snapshot(foreignOwner);
        });

        assert.equal(duringTurn.errorCount, 0);
        assert.equal(duringTurn.latencyCount, 0);
        assert.equal(duringTurn.cancelledCount, 0);
        assert.deepEqual(duringTurn.rows, []);
        assert.deepEqual(duringTurn.latencyRows, []);
        const filePath = await PromptAuditLog.waitForFinalization(foreignOwner);
        assert.doesNotMatch(await fs.promises.readFile(filePath, 'utf8'), /ownerless shared|detached shared/);
    } finally {
        ownerlessHandle.release();
        clock.restore();
        Globals.config = originalConfig;
    }
});

test('LLMClient streaming starts before dispatch, ignores empty deltas, and records one first-output sample', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRealtimeHub = Globals.realtimeHub;
    const clock = withMockClock(10000);
    const baseDir = makeLogDirectory();
    let responseStream;
    Globals.baseDir = baseDir;
    Globals.config = makeConfig({ stream: true, highLatencySeconds: 5 });
    Globals.realtimeHub = { emit() {} };
    axios.post = async () => {
        clock.set(12000); // Time spent preparing/queueing before actual dispatch.
        responseStream = new EventEmitter();
        setImmediate(async () => {
            clock.set(14000);
            responseStream.emit('data', 'data: {"choices":[{"delta":{}}]}\n\n');
            await new Promise(resolve => setImmediate(resolve));
            clock.set(15000);
            responseStream.emit('data', 'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n');
            await new Promise(resolve => setImmediate(resolve));
            clock.set(16000);
            responseStream.emit('data', 'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
            await new Promise(resolve => setImmediate(resolve));
            clock.set(17000);
            responseStream.emit('data', 'data: {"choices":[{"delta":{"content":"world"}}]}\n\n');
            responseStream.emit('data', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
            responseStream.emit('data', 'data: [DONE]\n\n');
            responseStream.emit('end');
        });
        return { status: 200, statusText: 'OK', headers: {}, data: responseStream };
    };

    let owner;
    try {
        const response = await PromptAuditLog.runTurn({
            requestId: 'stream-startup-latency',
            logDirectory: path.join(baseDir, 'turn-logs')
        }, async () => {
            owner = PromptAuditLog.currentTurn();
            const text = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Return one streamed response.' }],
                metadataLabel: 'stream_latency_prompt',
                stream: true,
                validateXML: false,
                retryAttempts: 0,
                output: 'silent'
            });
            return { text, snapshot: PromptAuditLog.snapshot(owner) };
        });

        assert.equal(response.text, 'Hello world');
        assert.equal(response.snapshot.latencyCount, 1);
        assert.equal(response.snapshot.errorCount, 0);
        const [row] = response.snapshot.latencyRows;
        assert.equal(row.kind, 'first_generated_output', 'reasoning is generated output even before prose');
        assert.equal(row.totalMs, 5000, 'latency starts before dispatch and ignores headers plus an empty SSE delta');
        assert.equal(row.preparationTotalMs, 0, 'the mocked stream begins dispatch immediately after the completion starts');
        assert.equal(row.outcome, 'output');
        assert.equal(row.count, 1, 'multiple stream fragments must not create multiple completion samples');
        const filePath = await PromptAuditLog.waitForFinalization(owner);
        const content = await fs.promises.readFile(filePath, 'utf8');
        assert.match(content, /LATENCY 1 x \| stream_latency_prompt \| completion/);
    } finally {
        responseStream?.removeAllListeners();
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.realtimeHub = originalRealtimeHub;
        clock.restore();
    }
});

test('LLMClient nonstream labels responses and token chunks accurately, including tool-only output', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRealtimeHub = Globals.realtimeHub;
    const clock = withMockClock(30000);
    const baseDir = makeLogDirectory();
    Globals.baseDir = baseDir;
    Globals.config = makeConfig({ highLatencySeconds: 2.5 });
    Globals.realtimeHub = { emit() {} };
    const providerResponses = [
        payload => {
            clock.advance(2500);
            return providerResponse(payload, { role: 'assistant', content: 'Plain response.' });
        },
        payload => {
            clock.advance(2500);
            return providerResponse(payload, { role: 'assistant', content: 'Hello ' }, {
                finishReason: 'length',
                logprobs: { content: [{ token: 'Hello ', bytes: [72, 101, 108, 108, 111, 32] }] }
            });
        },
        payload => {
            clock.advance(1000);
            return providerResponse(payload, { role: 'assistant', content: 'world' }, {
                finishReason: 'stop',
                logprobs: { content: [{ token: 'world', bytes: [119, 111, 114, 108, 100] }] }
            });
        },
        payload => {
            clock.advance(2500);
            return providerResponse(payload, {
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: 'latency-tool-call',
                    type: 'function',
                    function: { name: 'moreInfo', arguments: '{"name":"Fixture"}' }
                }]
            });
        }
    ];
    const providerPayloads = [];
    axios.post = async (_endpoint, payload) => {
        providerPayloads.push(structuredClone(payload));
        const makeResponse = providerResponses.shift();
        assert.ok(makeResponse, 'No unexpected provider request should be made.');
        return makeResponse(payload);
    };

    let owner;
    let snapshot;
    let chunkCalls = 0;
    try {
        await PromptAuditLog.runTurn({
            requestId: 'nonstream-startup-latency',
            logDirectory: path.join(baseDir, 'turn-logs')
        }, async () => {
            owner = PromptAuditLog.currentTurn();
            const plain = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Return a regular response.' }],
                metadataLabel: 'latency_first_response',
                stream: false,
                validateXML: false,
                retryAttempts: 0,
                output: 'silent'
            });
            assert.equal(plain, 'Plain response.');

            const chunked = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Return a chunked response.' }],
                metadataLabel: 'latency_first_chunk',
                stream: false,
                validateXML: false,
                retryAttempts: 0,
                output: 'silent',
                maxTokens: 3,
                nonStreamTokenChunkSize: 1,
                onStreamToken: () => { chunkCalls += 1; }
            });
            assert.equal(chunked, 'Hello world');

            const toolSchema = {
                type: 'function',
                function: {
                    name: 'moreInfo',
                    description: 'Test-only tool schema.',
                    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }
                }
            };
            const toolText = await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Return a tool call.' }],
                metadataLabel: 'latency_tool_only',
                additionalPayload: { tools: [toolSchema], tool_choice: 'auto' },
                stream: false,
                validateXML: false,
                retryAttempts: 0,
                output: 'silent'
            });
            assert.equal(toolText, '');
            snapshot = PromptAuditLog.snapshot(owner);
        });

        const timingRows = fs.readdirSync(path.join(baseDir, 'turn-logs'))
            .filter(name => /^completion-timing-.*\.jsonl$/.test(name))
            .flatMap(name => fs.readFileSync(path.join(baseDir, 'turn-logs', name), 'utf8').trim().split('\n').map(JSON.parse));
        assert.equal(timingRows.length, 4);
        const plainTiming = timingRows.find(row => row.metadataLabel === 'latency_first_response');
        assert.equal(plainTiming.firstOutputKind, 'first_response');
        assert.equal(plainTiming.ttftMs, null);
        assert.equal(plainTiming.firstResponseMs, plainTiming.dispatchToFirstOutputMs);
        const chunks = timingRows.filter(row => row.metadataLabel === 'latency_first_chunk');
        assert.equal(chunks.length, 2);
        for (const row of chunks) {
            assert.equal(row.firstOutputKind, 'first_chunk');
            assert.equal(row.ttftMs, null);
            assert.equal(row.firstChunkMs, row.dispatchToFirstOutputMs);
        }
        assert.equal(providerPayloads.length, 4);
        assert.equal(chunkCalls, 2);
        assert.equal(snapshot.latencyCount, 3);
        assert.equal(snapshot.errorCount, 0);
        const byLabel = new Map(snapshot.latencyRows.map(row => [row.metadataLabel, row]));
        assert.equal(byLabel.get('latency_first_response').kind, 'first_response');
        assert.equal(byLabel.get('latency_first_response').totalMs, 2500);
        assert.equal(byLabel.get('latency_first_chunk').kind, 'first_chunk');
        assert.equal(byLabel.get('latency_first_chunk').totalMs, 2500);
        assert.equal(byLabel.get('latency_first_chunk').count, 1, 'two token callbacks stay one completion sample');
        assert.equal(byLabel.get('latency_tool_only').kind, 'first_response', 'a tool call alone is generated output');
        assert.equal(byLabel.get('latency_tool_only').totalMs, 2500);
        const filePath = await PromptAuditLog.waitForFinalization(owner);
        const content = await fs.promises.readFile(filePath, 'utf8');
        assert.match(content, /LATENCY 1 x \| latency_first_response/);
        assert.match(content, /LATENCY 1 x \| latency_first_chunk/);
        assert.match(content, /LATENCY 1 x \| latency_tool_only/);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.realtimeHub = originalRealtimeHub;
        clock.restore();
    }
});
