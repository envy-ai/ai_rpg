const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const LLMCompletionCassette = require('../LLMCompletionCassette.js');

function buildConfig(overrides = {}) {
    return {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'cassette-secret-key',
            model: 'cassette-test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true,
            cachebuster: true,
            ...overrides
        }
    };
}

function createTempContext(prefix) {
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const baseDir = fs.mkdtempSync(path.join(tmpRoot, prefix));
    return {
        baseDir,
        cassettePath: path.join(baseDir, 'completion-cassette.json')
    };
}

function normalResponse(payload, content = 'Recorded response.') {
    return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: 'cassette-response',
            object: 'chat.completion',
            model: payload.model,
            choices: [{
                index: 0,
                finish_reason: 'stop',
                message: {
                    role: 'assistant',
                    content
                }
            }],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 3,
                total_tokens: 13
            }
        }
    };
}

async function withCassetteGlobals(callback, prefix = 'completion-cassette-') {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRecordFile = process.env.LLM_RECORD_OUTPUTS_FILE;
    const originalForceFile = process.env.LLM_FORCE_OUTPUTS_FILE;
    const context = createTempContext(prefix);
    Globals.baseDir = context.baseDir;
    Globals.config = buildConfig();
    delete process.env.LLM_FORCE_OUTPUTS_FILE;
    delete process.env.LLM_RECORD_OUTPUTS_FILE;
    LLMClient.resetForcedOutputState();
    try {
        return await callback(context);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        if (originalRecordFile === undefined) {
            delete process.env.LLM_RECORD_OUTPUTS_FILE;
        } else {
            process.env.LLM_RECORD_OUTPUTS_FILE = originalRecordFile;
        }
        if (originalForceFile === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalForceFile;
        }
        LLMClient.resetForcedOutputState();
        fs.rmSync(context.baseDir, { recursive: true, force: true });
    }
}

test('LLMClient records and strictly replays a version 2 logical completion without network transport', { concurrency: false }, async () => {
    await withCassetteGlobals(async ({ cassettePath }) => {
        let networkCalls = 0;
        axios.post = async (_endpoint, payload) => {
            networkCalls += 1;
            return normalResponse(payload, 'The tram remains on its recorded route.');
        };
        process.env.LLM_RECORD_OUTPUTS_FILE = cassettePath;
        Globals.config.ai_model_overrides = {
            playerActionSecretProfile: {
                prompts: ['player_action'],
                apiKey: 'first-override-secret',
                headers: {
                    Authorization: 'Bearer first-secret',
                    Connection: 'close'
                },
                temperature: 0.3
            }
        };

        const requestOptions = {
            messages: [{ role: 'user', content: 'Continue riding the tram.' }],
            metadataLabel: 'player_action',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        };
        const recorded = await LLMClient.chatCompletion(requestOptions);
        assert.equal(recorded, 'The tram remains on its recorded route.');
        assert.equal(networkCalls, 1);

        const incomplete = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
        assert.equal(incomplete.version, 2);
        assert.equal(incomplete.complete, false);
        assert.equal(incomplete.entries.length, 1);
        assert.doesNotMatch(JSON.stringify(incomplete), /cassette-secret-key/);
        assert.doesNotMatch(JSON.stringify(incomplete), /first-(?:override-)?secret/);

        const completed = LLMClient.completeCompletionCassetteRecording({
            description: 'Recorded player-action test.'
        });
        assert.equal(completed.complete, true);
        assert.equal(completed.total, 1);

        delete process.env.LLM_RECORD_OUTPUTS_FILE;
        process.env.LLM_FORCE_OUTPUTS_FILE = cassettePath;
        Globals.config.ai.apiKey = 'rotated-root-secret';
        Globals.config.ai_model_overrides.playerActionSecretProfile.apiKey = 'rotated-override-secret';
        Globals.config.ai_model_overrides.playerActionSecretProfile.headers = {
            Authorization: 'Bearer rotated-secret',
            Connection: 'keep-alive'
        };
        LLMClient.resetForcedOutputState();
        axios.post = async () => {
            throw new Error('Network transport must not run during strict cassette replay.');
        };

        let replayStreamCallbacks = 0;
        const replayed = await LLMClient.chatCompletion({
            ...requestOptions,
            onStreamToken() {
                replayStreamCallbacks += 1;
            }
        });
        assert.equal(replayed, recorded);
        assert.equal(replayStreamCallbacks, 0);
        assert.equal(networkCalls, 1);
        const status = LLMClient.assertCompletionCassetteConsumed();
        assert.equal(status.allConsumed, true);
        assert.equal(status.consumed, 1);
    });
});

test('version 2 replay rejects a changed prompt before transport and does not consume the expected entry', { concurrency: false }, async () => {
    await withCassetteGlobals(async ({ cassettePath }) => {
        axios.post = async (_endpoint, payload) => normalResponse(payload, 'Original response.');
        process.env.LLM_RECORD_OUTPUTS_FILE = cassettePath;
        const baseOptions = {
            messages: [{ role: 'user', content: 'Original prompt.' }],
            metadataLabel: 'event_checks',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        };
        await LLMClient.chatCompletion(baseOptions);
        LLMClient.completeCompletionCassetteRecording();

        delete process.env.LLM_RECORD_OUTPUTS_FILE;
        process.env.LLM_FORCE_OUTPUTS_FILE = cassettePath;
        LLMClient.resetForcedOutputState();
        axios.post = async () => {
            throw new Error('Network transport must not run after a cassette mismatch.');
        };

        await assert.rejects(
            () => LLMClient.chatCompletion({
                ...baseOptions,
                messages: [{ role: 'user', content: 'Changed prompt.' }]
            }),
            /Completion cassette mismatch at ordinal 1/
        );
        const status = LLMClient.getCompletionCassetteStatus().replay;
        assert.equal(status.consumed, 0);
        assert.equal(status.remaining, 1);
        assert.equal(status.failureCount, 1);
        assert.equal(status.failed, true);
        assert.match(status.lastFailure.message, /mismatch at ordinal 1/);
        const replayed = await LLMClient.chatCompletion(baseOptions);
        assert.equal(replayed, 'Original response.');
        assert.equal(LLMClient.getCompletionCassetteStatus().replay.allConsumed, true);
        assert.throws(
            () => LLMClient.assertCompletionCassetteConsumed(),
            /recorded 1 strict failure/
        );
    });
});

test('LLMClient resets an idle incomplete recording before a new attempt without retaining old entries', { concurrency: false }, async () => {
    await withCassetteGlobals(async ({ cassettePath }) => {
        let responseText = 'First failed-attempt response.';
        axios.post = async (_endpoint, payload) => normalResponse(payload, responseText);
        process.env.LLM_RECORD_OUTPUTS_FILE = cassettePath;
        const requestOptions = {
            messages: [{ role: 'user', content: 'Record one logical completion.' }],
            metadataLabel: 'player_action',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        };

        await LLMClient.chatCompletion(requestOptions);
        assert.equal(LLMClient.getCompletionCassetteStatus().recording.total, 1);
        const reset = LLMClient.resetIncompleteCompletionCassetteRecording({
            description: 'Fresh retry.'
        });
        assert.equal(reset.discardedTotal, 1);
        assert.equal(reset.total, 0);
        const resetDocument = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
        assert.equal(resetDocument.complete, false);
        assert.equal(resetDocument.description, 'Fresh retry.');
        assert.deepEqual(resetDocument.entries, []);

        responseText = 'Second successful-attempt response.';
        await LLMClient.chatCompletion(requestOptions);
        const completed = LLMClient.completeCompletionCassetteRecording();
        assert.equal(completed.total, 1);
        const completedDocument = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
        assert.equal(completedDocument.entries.length, 1);
        assert.equal(
            completedDocument.entries[0].response.choices[0].message.content,
            'Second successful-attempt response.'
        );
        assert.throws(
            () => LLMClient.resetIncompleteCompletionCassetteRecording(),
            /Cannot reset a completed completion cassette/
        );
    }, 'completion-cassette-reset-');
});

test('version 2 cassette preserves ordered repeated labels and response-shaped tool calls', { concurrency: false }, async () => {
    await withCassetteGlobals(async ({ cassettePath }) => {
        let call = 0;
        axios.post = async (_endpoint, payload) => {
            call += 1;
            if (call === 1) {
                return {
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: {},
                    data: {
                        id: 'tool-round',
                        model: payload.model,
                        choices: [{
                            index: 0,
                            finish_reason: 'tool_calls',
                            message: {
                                role: 'assistant',
                                content: '',
                                tool_calls: [{
                                    id: 'call_more_info',
                                    type: 'function',
                                    function: {
                                        name: 'moreInfo',
                                        arguments: '{"query":"QA Clockwork Tram"}'
                                    }
                                }]
                            }
                        }]
                    }
                };
            }
            return normalResponse(payload, 'Second checkpoint.');
        };
        process.env.LLM_RECORD_OUTPUTS_FILE = cassettePath;
        const toolPayload = {
            tools: [{
                type: 'function',
                function: {
                    name: 'moreInfo',
                    description: 'Look up canonical information.',
                    parameters: {
                        type: 'object',
                        properties: { query: { type: 'string' } },
                        required: ['query']
                    }
                }
            }]
        };
        let recordedToolResponse = null;
        const firstOptions = {
            messages: [{ role: 'user', content: 'Find the tram.' }],
            metadataLabel: 'player_action',
            additionalPayload: toolPayload,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            onResponse: response => {
                recordedToolResponse = response.data;
            }
        };
        const secondOptions = {
            messages: [
                { role: 'user', content: 'Find the tram.' },
                {
                    role: 'assistant',
                    content: '',
                    tool_calls: recordedToolResponse?.choices?.[0]?.message?.tool_calls || []
                },
                { role: 'tool', tool_call_id: 'call_more_info', content: '{"id":"loc_35"}' },
                { role: 'user', content: 'Continue.' }
            ],
            metadataLabel: 'player_action',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        };

        const first = await LLMClient.chatCompletion(firstOptions);
        assert.equal(first, '');
        assert.equal(recordedToolResponse.choices[0].message.tool_calls[0].function.name, 'moreInfo');
        secondOptions.messages[1].tool_calls = recordedToolResponse.choices[0].message.tool_calls;
        const second = await LLMClient.chatCompletion(secondOptions);
        assert.equal(second, 'Second checkpoint.');
        LLMClient.completeCompletionCassetteRecording();

        delete process.env.LLM_RECORD_OUTPUTS_FILE;
        process.env.LLM_FORCE_OUTPUTS_FILE = cassettePath;
        LLMClient.resetForcedOutputState();
        axios.post = async () => {
            throw new Error('Network transport must not run during cassette replay.');
        };
        let replayedToolResponse = null;
        const replayedFirst = await LLMClient.chatCompletion({
            ...firstOptions,
            onResponse: response => {
                replayedToolResponse = response.data;
            }
        });
        assert.equal(replayedFirst, '');
        assert.deepEqual(
            replayedToolResponse.choices[0].message.tool_calls,
            recordedToolResponse.choices[0].message.tool_calls
        );
        const replayedSecond = await LLMClient.chatCompletion(secondOptions);
        assert.equal(replayedSecond, second);
        assert.equal(LLMClient.assertCompletionCassetteConsumed().consumed, 2);
    }, 'completion-cassette-tools-');
});

test('LLMClient serializes concurrent cassette completions in invocation order for record and replay', { concurrency: false }, async () => {
    await withCassetteGlobals(async ({ cassettePath }) => {
        let releaseFirstTransport;
        const firstTransportReleased = new Promise(resolve => {
            releaseFirstTransport = resolve;
        });
        let reportFirstTransportStarted;
        const firstTransportStarted = new Promise(resolve => {
            reportFirstTransportStarted = resolve;
        });
        const transportLabels = [];
        axios.post = async (_endpoint, payload) => {
            const promptContent = payload.messages.at(-1)?.content || '';
            const label = promptContent.includes('need-bar-stage')
                ? 'need-bar-stage'
                : 'event-stage';
            transportLabels.push(label);
            if (transportLabels.length === 1) {
                reportFirstTransportStarted();
                await firstTransportReleased;
            }
            return normalResponse(payload, `Recorded ${label}`);
        };
        process.env.LLM_RECORD_OUTPUTS_FILE = cassettePath;

        const eventOptions = {
            messages: [{ role: 'user', content: 'event-stage' }],
            metadataLabel: 'event_checks',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        };
        const needBarOptions = {
            messages: [{ role: 'user', content: 'need-bar-stage' }],
            metadataLabel: 'need_bar_event_checks',
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        };

        const first = LLMClient.chatCompletion(eventOptions);
        await firstTransportStarted;
        const second = LLMClient.chatCompletion(needBarOptions);
        await new Promise(resolve => setImmediate(resolve));

        const queuedStatus = LLMClient.getCompletionCassetteStatus();
        assert.equal(queuedStatus.serialization.active, true);
        assert.equal(queuedStatus.serialization.queued, 1);
        assert.equal(queuedStatus.recording.completionActive, true);
        assert.equal(queuedStatus.recording.completionQueued, 1);
        assert.throws(
            () => LLMClient.completeCompletionCassetteRecording(),
            /active or queued/
        );

        releaseFirstTransport();
        assert.deepEqual(await Promise.all([first, second]), [
            'Recorded event-stage',
            'Recorded need-bar-stage'
        ]);
        assert.deepEqual(transportLabels, ['event-stage', 'need-bar-stage']);
        LLMClient.completeCompletionCassetteRecording();

        const recorded = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
        assert.deepEqual(recorded.entries.map(entry => entry.metadataLabel), [
            'event_checks',
            'need_bar_event_checks'
        ]);

        delete process.env.LLM_RECORD_OUTPUTS_FILE;
        process.env.LLM_FORCE_OUTPUTS_FILE = cassettePath;
        LLMClient.resetForcedOutputState();
        axios.post = async () => {
            throw new Error('Network transport must not run during concurrent strict replay.');
        };

        assert.deepEqual(await Promise.all([
            LLMClient.chatCompletion(eventOptions),
            LLMClient.chatCompletion(needBarOptions)
        ]), [
            'Recorded event-stage',
            'Recorded need-bar-stage'
        ]);
        const replayStatus = LLMClient.assertCompletionCassetteConsumed();
        assert.equal(replayStatus.consumed, 2);
        assert.equal(replayStatus.failureCount, 0);
    }, 'completion-cassette-concurrent-client-');
});

test('queue reservations retain cassette ownership across staged completions', { concurrency: false }, async () => {
    await withCassetteGlobals(async ({ cassettePath }) => {
        const transportLabels = [];
        axios.post = async (_endpoint, payload) => {
            const promptContent = payload.messages.at(-1)?.content || '';
            const label = ['event-stage-1', 'event-stage-2', 'need-bar-stage']
                .find(candidate => promptContent.includes(candidate));
            transportLabels.push(label);
            return normalResponse(payload, `Recorded ${label}`);
        };
        process.env.LLM_RECORD_OUTPUTS_FILE = cassettePath;

        const options = (label, metadataLabel) => ({
            messages: [{ role: 'user', content: label }],
            metadataLabel,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        let reportFirstStageFinished;
        const firstStageFinished = new Promise(resolve => {
            reportFirstStageFinished = resolve;
        });
        let allowSecondStage;
        const secondStageAllowed = new Promise(resolve => {
            allowSecondStage = resolve;
        });

        const stagedEvent = LLMClient.withPromptQueueReservation(async queueReservation => {
            const first = await LLMClient.chatCompletion({
                ...options('event-stage-1', 'event_checks'),
                queueReservation
            });
            reportFirstStageFinished();
            await secondStageAllowed;
            const second = await LLMClient.chatCompletion({
                ...options('event-stage-2', 'event_checks'),
                queueReservation
            });
            return [first, second];
        });
        await firstStageFinished;
        const needBar = LLMClient.chatCompletion(options('need-bar-stage', 'need_bar_event_checks'));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(LLMClient.getCompletionCassetteStatus().serialization.queued, 1);
        allowSecondStage();

        assert.deepEqual(await stagedEvent, [
            'Recorded event-stage-1',
            'Recorded event-stage-2'
        ]);
        assert.equal(await needBar, 'Recorded need-bar-stage');
        assert.deepEqual(transportLabels, ['event-stage-1', 'event-stage-2', 'need-bar-stage']);
        LLMClient.completeCompletionCassetteRecording();

        delete process.env.LLM_RECORD_OUTPUTS_FILE;
        process.env.LLM_FORCE_OUTPUTS_FILE = cassettePath;
        LLMClient.resetForcedOutputState();
        axios.post = async () => {
            throw new Error('Network transport must not run during staged strict replay.');
        };

        let reportReplayFirstStageFinished;
        const replayFirstStageFinished = new Promise(resolve => {
            reportReplayFirstStageFinished = resolve;
        });
        let allowReplaySecondStage;
        const replaySecondStageAllowed = new Promise(resolve => {
            allowReplaySecondStage = resolve;
        });
        const replayedEvent = LLMClient.withPromptQueueReservation(async queueReservation => {
            const first = await LLMClient.chatCompletion({
                ...options('event-stage-1', 'event_checks'),
                queueReservation
            });
            reportReplayFirstStageFinished();
            await replaySecondStageAllowed;
            const second = await LLMClient.chatCompletion({
                ...options('event-stage-2', 'event_checks'),
                queueReservation
            });
            return [first, second];
        });
        await replayFirstStageFinished;
        const replayedNeedBar = LLMClient.chatCompletion(
            options('need-bar-stage', 'need_bar_event_checks')
        );
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(LLMClient.getCompletionCassetteStatus().serialization.queued, 1);
        allowReplaySecondStage();

        assert.deepEqual(await replayedEvent, [
            'Recorded event-stage-1',
            'Recorded event-stage-2'
        ]);
        assert.equal(await replayedNeedBar, 'Recorded need-bar-stage');
        assert.equal(LLMClient.assertCompletionCassetteConsumed().failureCount, 0);
    }, 'completion-cassette-reserved-client-');
});

test('version 2 replay rejects incomplete cassettes and recording conflicts with forced output', { concurrency: false }, async () => {
    await withCassetteGlobals(async ({ cassettePath }) => {
        const incomplete = {
            version: 2,
            strict: true,
            complete: false,
            entries: [{
                ordinal: 1,
                metadataLabel: 'player_action',
                requestFingerprint: `sha256:${'0'.repeat(64)}`,
                requestSummary: {},
                response: 'unused'
            }]
        };
        fs.writeFileSync(cassettePath, `${JSON.stringify(incomplete, null, 2)}\n`, 'utf8');
        process.env.LLM_FORCE_OUTPUTS_FILE = cassettePath;
        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Cannot replay incomplete data.' }],
                metadataLabel: 'player_action',
                validateXML: false,
                output: 'silent'
            }),
            /incomplete and cannot be replayed/
        );

        delete process.env.LLM_FORCE_OUTPUTS_FILE;
        process.env.LLM_RECORD_OUTPUTS_FILE = path.join(path.dirname(cassettePath), 'record-conflict.json');
        LLMClient.resetForcedOutputState();
        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Conflicting deterministic output.' }],
                metadataLabel: 'player_action',
                forceOutput: 'forced',
                validateXML: false,
                output: 'silent'
            }),
            /recording cannot be combined with forceOutput/
        );
    }, 'completion-cassette-invalid-');
});

test('version 2 replay rejects a complete cassette with a non-normalized response', { concurrency: false }, async () => {
    await withCassetteGlobals(async ({ cassettePath }) => {
        fs.writeFileSync(cassettePath, `${JSON.stringify({
            version: 2,
            strict: true,
            complete: true,
            entries: [{
                ordinal: 1,
                metadataLabel: 'player_action',
                requestFingerprint: `sha256:${'0'.repeat(64)}`,
                requestSummary: {},
                response: 'legacy string output is not valid in version 2'
            }]
        }, null, 2)}\n`, 'utf8');
        process.env.LLM_FORCE_OUTPUTS_FILE = cassettePath;
        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'Reject malformed version 2.' }],
                metadataLabel: 'player_action',
                validateXML: false,
                output: 'silent'
            }),
            /response must be a normalized response object/
        );
    }, 'completion-cassette-malformed-response-');
});

test('LLMCompletionCassette fingerprints data URLs without copying them into summaries and rejects concurrent recording', { concurrency: false }, () => {
    const { baseDir, cassettePath } = createTempContext('completion-cassette-module-');
    try {
        const descriptor = LLMCompletionCassette.createRequestDescriptor({
            metadataLabel: 'image_prompt',
            expectedXmlRootTags: ['turnResult', 'rejected'],
            messages: [{
                role: 'user',
                content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,secretpixels' } }]
            }]
        });
        const fingerprint = LLMCompletionCassette.fingerprintRequest(descriptor);
        assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/);
        assert.deepEqual(descriptor.validation.expectedXmlRootTags, ['turnResult', 'rejected']);
        assert.doesNotMatch(JSON.stringify(LLMCompletionCassette.summarizeRequest(descriptor)), /secretpixels/);

        const toolResultDescriptor = createdAt => LLMCompletionCassette.createRequestDescriptor({
            metadataLabel: 'player_action',
            messages: [
                { role: 'user', content: 'Inspect the destination.' },
                {
                    role: 'tool',
                    tool_call_id: 'call_more_info',
                    content: JSON.stringify({
                        id: 'loc_1',
                        name: 'Village Square',
                        createdAt,
                        exit: {
                            id: 'exit_1',
                            lastUpdated: createdAt,
                            travelTimeMinutes: 5
                        }
                    })
                }
            ]
        });
        assert.equal(
            LLMCompletionCassette.fingerprintRequest(toolResultDescriptor('2026-08-10T18:52:00.000Z')),
            LLMCompletionCassette.fingerprintRequest(toolResultDescriptor('2026-08-10T18:55:00.000Z'))
        );
        assert.notEqual(
            LLMCompletionCassette.fingerprintRequest(toolResultDescriptor('2026-08-10T18:52:00.000Z')),
            LLMCompletionCassette.fingerprintRequest(LLMCompletionCassette.createRequestDescriptor({
                metadataLabel: 'player_action',
                messages: [
                    { role: 'user', content: 'Inspect the destination.' },
                    {
                        role: 'tool',
                        tool_call_id: 'call_more_info',
                        content: JSON.stringify({
                            id: 'loc_1',
                            name: 'Village Square',
                            createdAt: '2026-08-10T18:52:00.000Z',
                            exit: {
                                id: 'exit_1',
                                lastUpdated: '2026-08-10T18:52:00.000Z',
                                travelTimeMinutes: 6
                            }
                        })
                    }
                ]
            }))
        );

        const first = LLMCompletionCassette.beginRecording({ sourcePath: cassettePath, baseDir });
        assert.throws(
            () => LLMCompletionCassette.beginRecording({ sourcePath: cassettePath, baseDir }),
            /does not allow concurrent logical completions/
        );
        LLMCompletionCassette.endRecording(first);
    } finally {
        LLMCompletionCassette.resetRuntimeState();
        fs.rmSync(baseDir, { recursive: true, force: true });
    }
});

test('LLMCompletionCassette may claim only a validated empty incomplete recording after process restart', { concurrency: false }, () => {
    const { baseDir, cassettePath } = createTempContext('completion-cassette-empty-reset-');
    try {
        fs.writeFileSync(cassettePath, `${JSON.stringify({
            version: 2,
            strict: true,
            complete: false,
            description: 'failed attempt reset',
            recordedAt: '2026-08-12T00:00:00.000Z',
            entries: []
        }, null, 2)}\n`, 'utf8');

        LLMCompletionCassette.resetRuntimeState();
        const lease = LLMCompletionCassette.beginRecording({
            sourcePath: cassettePath,
            baseDir,
            description: 'replacement attempt'
        });
        assert.equal(lease.state.data.description, 'replacement attempt');
        assert.deepEqual(lease.state.data.entries, []);
        LLMCompletionCassette.endRecording(lease);

        LLMCompletionCassette.resetRuntimeState();
        fs.writeFileSync(cassettePath, `${JSON.stringify({
            version: 2,
            strict: true,
            complete: false,
            entries: [{ ordinal: 1 }]
        }, null, 2)}\n`, 'utf8');
        assert.throws(
            () => LLMCompletionCassette.beginRecording({ sourcePath: cassettePath, baseDir }),
            /destination already exists/
        );

        LLMCompletionCassette.resetRuntimeState();
        fs.writeFileSync(cassettePath, `${JSON.stringify({
            version: 2,
            strict: true,
            complete: true,
            entries: []
        }, null, 2)}\n`, 'utf8');
        assert.throws(
            () => LLMCompletionCassette.beginRecording({ sourcePath: cassettePath, baseDir }),
            /destination already exists/
        );
    } finally {
        LLMCompletionCassette.resetRuntimeState();
        fs.rmSync(baseDir, { recursive: true, force: true });
    }
});
