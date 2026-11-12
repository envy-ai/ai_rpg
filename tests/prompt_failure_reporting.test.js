const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const PromptFailureReporter = require('../PromptFailureReporter.js');
const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');
const { createChatToolRuntime } = require('../chat_tool_calls.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const nunjucks = require('nunjucks');
const {
    TinyBrainPromptExtension,
    TinyBrainPromptRunner
} = require('../TinyBrainPromptRunner.js');

function installFailureFixture() {
    const tempRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    const tempBaseDir = fs.mkdtempSync(path.join(tempRoot, 'prompt-failure-reporting-'));
    const original = {
        axiosPost: axios.post,
        config: Globals.config,
        baseDir: Globals.baseDir,
        realtimeHub: Globals.realtimeHub
    };
    const events = [];
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'prompt-failure-test',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true,
            prefill: null
        }
    };
    Globals.realtimeHub = {
        emit(_room, type, payload) {
            if (type === 'prompt_failed') events.push(payload);
        }
    };
    return {
        events,
        restore() {
            axios.post = original.axiosPost;
            Globals.config = original.config;
            Globals.baseDir = original.baseDir;
            Globals.realtimeHub = original.realtimeHub;
        }
    };
}

function buildRunnerEnvironment() {
    const loader = new nunjucks.Loader();
    loader.getSource = (name) => {
        const templates = {
            'wrapper.xml.njk': '<template><systemPrompt><![CDATA[Test.]]></systemPrompt><generationPrompt><![CDATA[{{ __tinyBrainState.programStartMarker }}{% include "program.njk" %}]]></generationPrompt></template>',
            'program.njk': 'Check this. {% llmparse("always_fail") %} Write final.'
        };
        return Object.hasOwn(templates, name) ? { src: templates[name], path: name, noCache: true } : null;
    };
    const environment = new nunjucks.Environment(loader, { autoescape: false });
    environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return environment;
}

function parseWrapper(rendered) {
    const systemPrompt = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/)?.[1];
    const generationPrompt = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/)?.[1];
    if (typeof systemPrompt !== 'string' || typeof generationPrompt !== 'string') {
        throw new Error('Test wrapper did not render prompt fields.');
    }
    return { systemPrompt, generationPrompt };
}

function installQueuedCompletionResponses(responses) {
    const requests = [];
    axios.post = async (_endpoint, payload) => {
        requests.push(payload);
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `prompt-failure-validation-${requests.length}`,
                model: payload.model,
                choices: [{ message: { role: 'assistant', content: responses.shift() }, finish_reason: 'stop' }],
                usage: { total_tokens: 1 }
            }
        };
    };
    return requests;
}

function runMockedParsePrompt(metadataLabel, responses, parse, maxAttempts = responses.length) {
    return runPromptWithParseRetries({
        metadataLabel,
        messages: [{ role: 'user', content: 'Return a structured test response.' }],
        maxAttempts,
        complete: ({ messages }) => LLMClient.chatCompletion({
            messages,
            metadataLabel,
            validateXML: false,
            throwOnError: true,
            stream: false,
            retryAttempts: 0,
            output: 'silent'
        }),
        parse,
        buildRetryInstruction: error => `Correct the structured response: ${error.message}`
    });
}

test('exhausted direct LLM retries emit one failure with actual attempts and original stack', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    let calls = 0;
    const transportError = new Error('Synthetic terminal transport failure.');
    transportError.status = 503;
    axios.post = async () => {
        calls += 1;
        throw transportError;
    };

    try {
        const response = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Exercise exhausted retry reporting.' }],
            metadataLabel: 'failure_reporting_direct',
            validateXML: false,
            stream: false,
            retryAttempts: 1,
            output: 'silent'
        });

        assert.equal(response, '');
        assert.equal(calls, 2);
        assert.equal(fixture.events.length, 1);
        const [event] = fixture.events;
        assert.equal(event.metadataLabel, 'failure_reporting_direct');
        assert.equal(event.kind, 'completion');
        assert.equal(event.message, 'Synthetic terminal transport failure.');
        assert.match(event.stack, /Synthetic terminal transport failure/);
        assert.equal(event.transportAttempts, 2);
        assert.equal(event.validationRetries, 0);
        assert.equal(event.toolCalls, null);
        assert.match(event.id, /^prompt_failure_[1-9]\d*$/);
        assert.ok(Number.isFinite(Date.parse(event.serverTime)));
    } finally {
        fixture.restore();
    }
});

test('recoverable transport retry followed by success emits no terminal failure', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    let calls = 0;
    axios.post = async (_endpoint, payload) => {
        calls += 1;
        if (calls === 1) throw new Error('Synthetic recoverable transport failure.');
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'prompt-failure-retry-success',
                model: payload.model,
                choices: [{ message: { content: 'Recovered successfully.' }, finish_reason: 'stop' }]
            }
        };
    };

    try {
        const response = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Exercise retry success.' }],
            metadataLabel: 'failure_reporting_recovered',
            validateXML: false,
            stream: false,
            retryAttempts: 1,
            output: 'silent'
        });
        assert.equal(response, 'Recovered successfully.');
        assert.equal(calls, 2);
        assert.deepEqual(fixture.events, []);
    } finally {
        fixture.restore();
    }
});

test('separate failed runs with the same prompt label receive distinct ids', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    axios.post = async () => { throw new Error('Same-label failure.'); };
    try {
        for (let run = 0; run < 2; run += 1) {
            await LLMClient.chatCompletion({
                messages: [{ role: 'user', content: `Failed run ${run}.` }],
                metadataLabel: 'same_prompt_label',
                validateXML: false,
                stream: false,
                retryAttempts: 0,
                output: 'silent'
            });
        }
        assert.equal(fixture.events.length, 2);
        assert.equal(fixture.events[0].metadataLabel, fixture.events[1].metadataLabel);
        assert.notEqual(fixture.events[0].id, fixture.events[1].id);
    } finally {
        fixture.restore();
    }
});

test('an exhausted Axios stream timeout reported as ERR_CANCELED is still a terminal failure', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    const timeoutError = new Error('Stream start timeout.');
    timeoutError.code = 'ERR_CANCELED';
    axios.post = async () => { throw timeoutError; };
    try {
        await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Exercise an Axios cancellation-shaped timeout.' }],
            metadataLabel: 'failure_reporting_stream_timeout',
            validateXML: false,
            stream: false,
            retryAttempts: 0,
            output: 'silent'
        });
        assert.equal(fixture.events.length, 1);
        assert.equal(fixture.events[0].message, 'Stream start timeout.');
        assert.match(fixture.events[0].stack, /Stream start timeout/);
    } finally {
        fixture.restore();
    }
});

test('intentional PROMPT_CANCELLED and user cancellation signals do not emit failure events', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    const cancellation = new Error('Prompt cancelled by the user.');
    cancellation.name = 'PromptCancellationError';
    cancellation.code = 'PROMPT_CANCELLED';
    const controller = new AbortController();
    controller.abort(cancellation);
    try {
        await assert.rejects(PromptFailureReporter.run({
            metadataLabel: 'failure_reporting_cancelled',
            signal: controller.signal
        }, async () => { throw cancellation; }), error => error === cancellation);
        assert.deepEqual(fixture.events, []);
    } finally {
        fixture.restore();
    }
});

test('generic parse retries own terminal exhaustion while nested LLM completions join and count corrections once', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    const requests = installQueuedCompletionResponses(['bad', 'bad']);
    const label = 'generic_parse_retry_terminal';
    try {
        await assert.rejects(
            runMockedParsePrompt(label, [], () => { throw new Error('Synthetic domain validation rejection.'); }, 2),
            /failed to parse after 2 attempts/i
        );
        assert.equal(requests.length, 2);
        assert.equal(fixture.events.length, 1);
        assert.equal(fixture.events[0].metadataLabel, label);
        assert.equal(fixture.events[0].kind, 'parse_retry');
        assert.equal(fixture.events[0].transportAttempts, 2);
        assert.equal(fixture.events[0].validationRetries, 1);
        assert.match(fixture.events[0].stack, /Synthetic domain validation rejection/);
    } finally {
        fixture.restore();
    }
});

test('generic parser recovery and explicit parser cancellation remain quiet', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    const requests = installQueuedCompletionResponses(['bad', 'valid', 'cancel response']);
    const label = 'generic_parse_retry_recovery';
    try {
        const recovered = await runMockedParsePrompt(label, [], response => {
            if (response !== 'valid') throw new Error('Recoverable domain validation rejection.');
            return { accepted: true };
        }, 2);
        assert.deepEqual(recovered.value, { accepted: true });
        assert.equal(requests.length, 2);
        assert.deepEqual(fixture.events, []);

        const cancellation = new Error('Cancelled structured prompt by the user.');
        cancellation.name = 'PromptCancellationError';
        cancellation.code = 'PROMPT_CANCELLED';
        await assert.rejects(runMockedParsePrompt('generic_parse_retry_cancelled', [], () => { throw cancellation; }, 3), error => error === cancellation);
        assert.equal(requests.length, 3, 'explicit parser cancellation stops without another parse attempt');
        assert.deepEqual(fixture.events, []);
    } finally {
        fixture.restore();
    }
});

test('cause-wrapped startup errors forward the original prompt-failure envelope UUID', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    const metadataLabel = 'wrapped_startup_prompt_failure';
    let terminalError;
    try {
        await assert.rejects(PromptFailureReporter.run({ metadataLabel, kind: 'parse_retry' }, async () => {
            PromptFailureReporter.transportAttempt(metadataLabel);
            throw new Error('Terminal startup parser failure.');
        }), error => { terminalError = error; return true; });
        const wrapped = new Error('New-game setup failed.', { cause: terminalError });
        const forwarded = PromptFailureReporter.getFailure(wrapped);
        assert.equal(fixture.events.length, 1);
        assert.equal(forwarded.id, fixture.events[0].id);
        assert.equal(forwarded, terminalError.promptFailure);
        assert.equal(forwarded.message, 'Terminal startup parser failure.');
    } finally {
        fixture.restore();
    }
});

test('an AbortSignal timeout reason remains reportable, while its signal is aborted', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    const timeout = new Error('Synthetic deadline exceeded.');
    timeout.name = 'TimeoutError';
    const controller = new AbortController();
    controller.abort(timeout);
    try {
        await assert.rejects(PromptFailureReporter.run({
            metadataLabel: 'failure_reporting_abort_signal_timeout',
            signal: controller.signal
        }, async () => { throw timeout; }), error => error === timeout);
        assert.equal(fixture.events.length, 1);
        assert.equal(fixture.events[0].message, 'Synthetic deadline exceeded.');
    } finally {
        fixture.restore();
    }
});

test('TinyBrain parser exhaustion emits one grouped terminal failure with its retry count', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    const environment = buildRunnerEnvironment();
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseWrapper,
        metadataLabel: 'failure_reporting_tinybrain',
        retryAttempts: 1,
        parsers: {
            always_fail() {
                throw new Error('Synthetic parser rejected the response.');
            }
        },
        logPrompt(options) {
            return options.filePath || '/test/logs/tinybrain-failure-reporting.log';
        },
        async complete({ messages }) {
            const aiResponse = 'A response that fails parsing.';
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    try {
        await assert.rejects(runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk'
        }), /failed to parse after 2 attempts/i);

        assert.equal(fixture.events.length, 1);
        const [event] = fixture.events;
        assert.equal(event.metadataLabel, 'failure_reporting_tinybrain');
        assert.equal(event.kind, 'tinybrain');
        assert.equal(event.transportAttempts, 0);
        assert.equal(event.validationRetries, 1);
        assert.match(event.message, /failed to parse after 2 attempts/i);
        assert.match(event.stack, /Synthetic parser rejected the response/);
        assert.match(event.stack, /Caused by:/);
    } finally {
        fixture.restore();
    }
});

test('the tool runtime joins its nested LLM failure and reports it only once', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    axios.post = async () => { throw new Error('Nested tool-loop transport failure.'); };
    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: Globals.config.ai, max_tool_calls: 2 }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ currentLocation: 'fixture-location' }),
        createLocationFromEvent: async () => { throw new Error('Unexpected location creation.'); },
        createRegionStubFromEvent: async () => { throw new Error('Unexpected region creation.'); },
        generateItemsByNames: async () => [],
        ensureExitConnection: () => { throw new Error('Unexpected exit creation.'); },
        findRegionByLocationId: () => null,
        LLMClient,
        Player,
        Thing,
        Location,
        Region,
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
    try {
        await assert.rejects(runtime.runChatCompletionWithToolLoop({
            requestOptions: {
                messages: [{ role: 'user', content: 'Nested tool-loop failure.' }],
                metadataLabel: 'failure_reporting_tool_loop',
                validateXML: false,
                stream: false,
                retryAttempts: 0,
                output: 'silent'
            },
            metadataLabel: 'failure_reporting_tool_loop',
            allowedToolNames: []
        }), error => {
            assert.match(error.message, /Nested tool-loop transport failure/);
            assert.equal(error.promptFailure.id, fixture.events[0]?.id);
            return true;
        });

        assert.equal(fixture.events.length, 1);
        assert.equal(fixture.events[0].kind, 'tool_loop');
        assert.equal(fixture.events[0].metadataLabel, 'failure_reporting_tool_loop');
        assert.equal(fixture.events[0].transportAttempts, 1);
        assert.equal(fixture.events[0].message, 'Nested tool-loop transport failure.');
        assert.equal(fixture.events[0].toolCalls.attempted, 0);
        assert.equal(fixture.events[0].toolCalls.executed, 0);
        assert.equal(fixture.events[0].toolCalls.denied, 0);
        assert.equal(fixture.events[0].toolCalls.limit, 2);
        assert.equal(fixture.events[0].toolCalls.limitUnit, 'rounds');
    } finally {
        fixture.restore();
    }
});

test('failure events include authoritative tool attempts, executions, denials, and configured limit units', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    try {
        await assert.rejects(PromptFailureReporter.run({
            metadataLabel: 'failure_reporting_tool_counts',
            kind: 'tool_loop'
        }, async () => {
            PromptFailureReporter.configureTools('failure_reporting_tool_counts', {
                limit: 3,
                limitUnit: 'rounds'
            });
            PromptFailureReporter.tools('failure_reporting_tool_counts', {
                attempted: 2,
                executed: 1,
                denied: 1
            });
            throw new Error('Tool loop terminated after a denied call.');
        }), /Tool loop terminated/);

        assert.equal(fixture.events.length, 1);
        assert.equal(fixture.events[0].toolCalls.attempted, 2);
        assert.equal(fixture.events[0].toolCalls.executed, 1);
        assert.equal(fixture.events[0].toolCalls.denied, 1);
        assert.equal(fixture.events[0].toolCalls.limit, 3);
        assert.equal(fixture.events[0].toolCalls.limitUnit, 'rounds');
    } finally {
        fixture.restore();
    }
});

test('configureTools merges limit metadata into previously recorded tool counters', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    try {
        await assert.rejects(PromptFailureReporter.run({
            metadataLabel: 'failure_reporting_late_tool_limit',
            kind: 'tool_loop'
        }, async () => {
            PromptFailureReporter.tools('failure_reporting_late_tool_limit', {
                attempted: 3,
                executed: 2,
                denied: 1
            });
            PromptFailureReporter.configureTools('failure_reporting_late_tool_limit', {
                limit: 3,
                limitUnit: 'calls'
            });
            throw new Error('Tool call limit exhausted.');
        }), /Tool call limit exhausted/);

        assert.equal(fixture.events[0].toolCalls.attempted, 3);
        assert.equal(fixture.events[0].toolCalls.executed, 2);
        assert.equal(fixture.events[0].toolCalls.denied, 1);
        assert.equal(fixture.events[0].toolCalls.limit, 3);
        assert.equal(fixture.events[0].toolCalls.limitUnit, 'calls');
    } finally {
        fixture.restore();
    }
});

test('metadata aliases join only their owner, restore afterward, and preserve cancellation', { concurrency: false }, async () => {
    const fixture = installFailureFixture();
    try {
        await assert.rejects(PromptFailureReporter.withMetadataAlias('need_bar_event_checks', async () => {}), /owner|active/i);
        const failure = new Error('need-bar stage failed');
        await assert.rejects(PromptFailureReporter.run({ metadataLabel: 'event_checks', kind: 'parse_retry' }, async () => {
            const owner = PromptFailureReporter.current('event_checks');
            await PromptFailureReporter.withMetadataAlias('need_bar_event_checks', async () => {
                assert.equal(PromptFailureReporter.current('need_bar_event_checks'), owner);
                PromptFailureReporter.transportAttempt('need_bar_event_checks');
                await PromptFailureReporter.run({ metadataLabel: 'unrelated', join: false }, async () => {
                    assert.equal(PromptFailureReporter.current('need_bar_event_checks'), null);
                });
                assert.equal(PromptFailureReporter.current('need_bar_event_checks'), owner);
            });
            assert.equal(PromptFailureReporter.current('need_bar_event_checks'), null);
            throw failure;
        }), error => error === failure);
        assert.equal(fixture.events.length, 1);
        assert.equal(fixture.events[0].metadataLabel, 'event_checks');
        assert.equal(fixture.events[0].transportAttempts, 1);
        const cancelled = Object.assign(new Error('cancelled'), { code: 'PROMPT_CANCELLED' });
        await assert.rejects(PromptFailureReporter.run({ metadataLabel: 'event_checks' }, () => PromptFailureReporter.withMetadataAlias('need_bar_event_checks', async () => { throw cancelled; })), error => error === cancelled);
        assert.equal(fixture.events.length, 1, 'cancellation produces no terminal notification');
    } finally { fixture.restore(); }
});
