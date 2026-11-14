const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const {
    createPromptEnv,
    buildBaseRenderContext
} = require('./helpers/baseContextFixtures.js');

const endpoint = 'http://127.0.0.1:8080/v1/chat/completions';

function buildAiConfig(overrides = {}) {
    return {
        backend: 'openai_compatible',
        endpoint,
        apiKey: 'test-key',
        model: 'test-model',
        stream: false,
        retryAttempts: 0,
        max_concurrent_requests: 1,
        supress_seed: true,
        shared_prefix_cache: { provider: 'strata', endpoint },
        ...overrides
    };
}

function renderBasePrompt(sceneTraitText) {
    const promptEnv = createPromptEnv();
    const context = buildBaseRenderContext({
        question: 'Describe the current scene.',
        currencyName: 'Gold',
        regionName: 'The Reach',
        promptUsesCaching: true,
        overrides: {
            gameHistory: 'A stable older history entry.',
            recentGameHistory: 'A recent history entry.'
        }
    });
    context.modSceneContext = [sceneTraitText];
    return promptEnv.render('base-context.xml.njk', context)
        .match(/<generationPrompt><!\[CDATA\[([\s\S]*?)]]><\/generationPrompt>/)[1];
}

function captureRequestPayload({
    messages,
    aiConfig,
    metadataLabel = 'player_action',
    additionalPayload = {},
    topLevelConfig = {}
}) {
    return new Promise(async (resolve, reject) => {
        const originalAxiosPost = axios.post;
        const originalConfig = Globals.config;
        let payload;
        axios.post = async (_url, requestPayload) => {
            payload = JSON.parse(JSON.stringify(requestPayload));
            return {
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {},
                data: {
                    id: 'shared-prefix-cache-test',
                    object: 'chat.completion',
                    created: 1,
                    model: requestPayload.model,
                    choices: [{
                        index: 0,
                        finish_reason: 'stop',
                        message: { role: 'assistant', content: 'ok' }
                    }]
                }
            };
        };
        Globals.config = {
            ai: aiConfig,
            chat_tools: { request_user_input_enabled: true },
            use_legacy_prompt_checks: false,
            ...topLevelConfig
        };

        try {
            await LLMClient.chatCompletion({
                messages,
                metadataLabel,
                additionalPayload,
                validateXML: false,
                output: 'silent',
                retryAttempts: 0
            });
            resolve(payload);
        } catch (error) {
            reject(error);
        } finally {
            axios.post = originalAxiosPost;
            Globals.config = originalConfig;
        }
    });
}

test('scene-only catalog changes preserve a byte-identical stable prefix in the rendered base template', () => {
    const first = renderBasePrompt('<sexualTraits>Scene-only Brat definition.</sexualTraits>');
    const second = renderBasePrompt('<sexualTraits>Scene-only Romantic definition.</sexualTraits>');
    const marker = LLMClient.getStableContextMessageBoundaryMarker();
    const firstMarkerIndex = first.indexOf(marker);
    const secondMarkerIndex = second.indexOf(marker);

    assert.ok(firstMarkerIndex >= 0);
    assert.ok(secondMarkerIndex >= 0);
    for (const source of [first, second]) {
        const factionsEnd = source.indexOf('</factions>');
        const markerIndex = source.indexOf(marker);
        const currentRegionStart = source.indexOf('<currentRegion>');
        assert.ok(factionsEnd < markerIndex);
        assert.ok(markerIndex < currentRegionStart);
        assert.ok(source.indexOf('<olderStoryHistory>') < markerIndex);
        assert.ok(source.indexOf('<worldOutline>') < markerIndex);
    }
    assert.equal(first.slice(0, firstMarkerIndex), second.slice(0, secondMarkerIndex));
    assert.notEqual(first.slice(firstMarkerIndex + marker.length), second.slice(secondMarkerIndex + marker.length));

    const firstBoundary = [];
    const secondBoundary = [];
    const firstMessages = LLMClient.expandPromptMessageBoundaries([
        { role: 'system', content: 'Canonical system prompt.' },
        { role: 'user', content: first }
    ], { onStablePrefixBoundary: message => firstBoundary.push(message) });
    const secondMessages = LLMClient.expandPromptMessageBoundaries([
        { role: 'system', content: 'Canonical system prompt.' },
        { role: 'user', content: second }
    ], { onStablePrefixBoundary: message => secondBoundary.push(message) });

    assert.equal(firstBoundary.length, 1);
    assert.equal(secondBoundary.length, 1);
    assert.equal(firstMessages.indexOf(firstBoundary[0]), secondMessages.indexOf(secondBoundary[0]));
    assert.deepEqual(
        firstMessages.slice(0, firstMessages.indexOf(firstBoundary[0])),
        secondMessages.slice(0, secondMessages.indexOf(secondBoundary[0]))
    );
    assert.match(firstBoundary[0].content, /Scene-only Brat definition/);
    assert.match(secondBoundary[0].content, /Scene-only Romantic definition/);
    assert.equal(firstMessages.some(message => message.content.includes(marker)), false);
});

test('real OpenAI-compatible requests pin the final stable message count and strip markers', { concurrency: false }, async () => {
    const first = renderBasePrompt('<sexualTraits>Scene Brat.</sexualTraits>');
    const second = renderBasePrompt('<sexualTraits>Scene Romantic.</sexualTraits>');
    const firstPayload = await captureRequestPayload({
        messages: [
            { role: 'system', content: 'Canonical system prompt.' },
            { role: 'user', content: first }
        ],
        aiConfig: buildAiConfig({
            sysprompt_append: 'Appended system instruction.',
            cachebuster: true
        })
    });
    const secondPayload = await captureRequestPayload({
        messages: [
            { role: 'system', content: 'Canonical system prompt.' },
            { role: 'user', content: second }
        ],
        aiConfig: buildAiConfig({
            sysprompt_append: 'Appended system instruction.',
            cachebuster: true
        })
    });

    assert.equal(firstPayload.strata_prefix.messages, secondPayload.strata_prefix.messages);
    const pinnedCount = firstPayload.strata_prefix.messages;
    assert.equal(pinnedCount, firstPayload.messages.findIndex(message => message.content.includes('<sexualTraits>')));
    assert.equal(pinnedCount, secondPayload.messages.findIndex(message => message.content.includes('<sexualTraits>')));
    assert.equal(firstPayload.messages[1].role, 'system');
    assert.equal(firstPayload.messages[1].content, 'Appended system instruction.');
    assert.ok(firstPayload.messages.length > pinnedCount);
    assert.ok(secondPayload.messages.length > pinnedCount);
    assert.deepEqual(firstPayload.messages.slice(0, pinnedCount), secondPayload.messages.slice(0, pinnedCount));
    assert.equal(firstPayload.messages.some(message => String(message.content).includes('AI_RPG_INTERNAL_MESSAGE_BOUNDARY_')), false);
    assert.equal(secondPayload.messages.some(message => String(message.content).includes('AI_RPG_INTERNAL_MESSAGE_BOUNDARY_')), false);
    assert.match(firstPayload.messages.at(-1).content, /^\[cachebuster:/);
    assert.match(secondPayload.messages.at(-1).content, /^\[cachebuster:/);
});

test('shared prefix configuration is opt-in, endpoint-bound, and base-context-only', { concurrency: false }, async () => {
    const marker = LLMClient.getStableContextMessageBoundaryMarker();
    const messages = [{
        role: 'user',
        content: `Stable content.${marker}Volatile scene content.${LLMClient.getBaseContextEndMarker()}Prompt body.`
    }];
    const baseConfig = buildAiConfig();

    assert.deepEqual(LLMClient.resolveSharedPrefixCacheConfiguration(baseConfig), {
        provider: 'strata',
        endpoint,
        primeBaseContext: true
    });
    assert.equal(LLMClient.resolveSharedPrefixCacheConfiguration({
        ...baseConfig, shared_prefix_cache: { provider: 'strata', endpoint, prime_base_context: false }
    }).primeBaseContext, false);
    assert.throws(() => LLMClient.resolveSharedPrefixCacheConfiguration({
        ...baseConfig, shared_prefix_cache: { provider: 'strata', endpoint, prime_base_context: 'yes' }
    }), /shared_prefix_cache must be null or/);
    assert.equal(LLMClient.resolveSharedPrefixCacheConfiguration({ ...baseConfig, shared_prefix_cache: null }), null);
    assert.throws(
        () => LLMClient.resolveSharedPrefixCacheConfiguration({
            ...baseConfig,
            shared_prefix_cache: { provider: 'unknown', endpoint }
        }),
        /shared_prefix_cache must be null or/);
    assert.throws(
        () => LLMClient.resolveSharedPrefixCacheConfiguration({
            ...baseConfig,
            endpoint: 'http://127.0.0.1:8081/v1/chat/completions'
        }),
        /must match the effective AI endpoint/);
    assert.throws(
        () => LLMClient.resolveSharedPrefixCacheConfiguration({
            ...baseConfig,
            backend: 'codex_cli_bridge'
        }),
        /requires the openai_compatible backend/);
    assert.equal(LLMClient.resolveSharedPrefixCacheConfiguration({
        backend: 'codex_cli_bridge',
        shared_prefix_cache: null
    }), null);

    const generic = await captureRequestPayload({
        messages,
        aiConfig: baseConfig,
        metadataLabel: 'generic_prompt'
    });
    assert.equal(Object.hasOwn(generic, 'strata_prefix'), false);

    const uncached = await captureRequestPayload({
        messages,
        aiConfig: buildAiConfig({ shared_prefix_cache: null })
    });
    assert.equal(Object.hasOwn(uncached, 'strata_prefix'), false);

    const noBoundary = await captureRequestPayload({
        messages: [{ role: 'user', content: `Stable content.${LLMClient.getBaseContextEndMarker()}Prompt body.` }],
        aiConfig: baseConfig
    });
    assert.equal(Object.hasOwn(noBoundary, 'strata_prefix'), false);

    const noBaseContext = await captureRequestPayload({
        messages: [{ role: 'user', content: 'Ordinary prompt without base context.' }],
        aiConfig: baseConfig
    });
    assert.equal(Object.hasOwn(noBaseContext, 'strata_prefix'), false);

    const cliPayload = LLMClient.applySharedPrefixCachePolicy({ messages }, {
        aiConfig: { backend: 'codex_cli_bridge', shared_prefix_cache: null },
        endpoint: null,
        boundaryMessage: messages[0],
        isBaseContextPrompt: true,
        metadataLabel: 'player_action'
    });
    assert.equal(Object.hasOwn(cliPayload, 'strata_prefix'), false);

    await assert.rejects(captureRequestPayload({
        messages,
        aiConfig: baseConfig,
        metadataLabel: 'strata_endpoint_override',
        topLevelConfig: {
            ai_model_overrides: {
                strata_endpoint_override: {
                    prompts: ['strata_endpoint_override'],
                    endpoint: 'http://127.0.0.1:8081/v1/chat/completions'
                }
            }
        }
    }), /shared_prefix_cache.endpoint must match the effective AI endpoint/);

    await assert.rejects(captureRequestPayload({
        messages,
        aiConfig: baseConfig,
        additionalPayload: { strata_prefix: { messages: 1 } }
    }), /cannot be combined with a manually supplied strata_prefix/);
});

test('cache policy counts the resolved prefix in final messages with system append, cachebuster, and prefill', () => {
    const stableMessage = { role: 'user', content: 'Stable canonical context.' };
    const boundaryMessage = { role: 'user', content: 'Volatile scene context.' };
    const payload = {
        messages: [
            { role: 'system', content: 'Canonical system prompt.' },
            { role: 'system', content: 'Appended system instruction.' },
            stableMessage,
            boundaryMessage,
            { role: 'user', content: '[cachebuster:stable-test-id]\n\nFinal request.' },
            { role: 'assistant', content: 'Assistant prefill.' }
        ]
    };

    const resolved = LLMClient.applySharedPrefixCachePolicy(payload, {
        aiConfig: buildAiConfig(),
        endpoint,
        boundaryMessage,
        isBaseContextPrompt: true,
        metadataLabel: 'player_action'
    });

    assert.deepEqual(resolved.strata_prefix, { messages: 3 });
    assert.equal(resolved.messages.indexOf(boundaryMessage), resolved.strata_prefix.messages);
    assert.deepEqual(resolved.messages.slice(0, resolved.strata_prefix.messages), [
        { role: 'system', content: 'Canonical system prompt.' },
        { role: 'system', content: 'Appended system instruction.' },
        stableMessage
    ]);
    assert.deepEqual(payload.messages.at(-1), { role: 'assistant', content: 'Assistant prefill.' });
});

async function runWithTransport(responder, fn) {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const posts = [];
    axios.post = async (_url, requestPayload) => {
        const payload = JSON.parse(JSON.stringify(requestPayload));
        posts.push(payload);
        return {
            status: 200, statusText: 'OK', headers: {}, config: {},
            data: {
                id: `prime-test-${posts.length}`, object: 'chat.completion', created: 1, model: payload.model,
                choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
                usage: responder(payload, posts.length)
            }
        };
    };
    try {
        await fn(posts);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
}

function basePrompt(scene, task) {
    const stable = LLMClient.getStableContextMessageBoundaryMarker();
    const end = LLMClient.getBaseContextEndMarker();
    return [
        { role: 'system', content: 'Canonical system prompt.' },
        { role: 'user', content: `Stable world.${stable}${scene}${end}${task}` }
    ];
}

async function send(messages, aiConfig) {
    Globals.config = { ai: aiConfig, chat_tools: { request_user_input_enabled: true }, use_legacy_prompt_checks: false };
    await LLMClient.chatCompletion({ messages, metadataLabel: 'player_action', validateXML: false, output: 'silent', retryAttempts: 0 });
}

test('base-context prompts prime a checkpoint at the task boundary once per shared prefix and re-prime when Strata lost it', { concurrency: false }, async () => {
    LLMClient.resetSharedPrefixPrimeStateForTests();
    const aiConfig = buildAiConfig();
    // Main requests report how much Strata reused; 'lost' simulates an evicted checkpoint.
    let mainCached = 1000;
    await runWithTransport(payload => (payload.max_tokens === 1
        ? { prompt_tokens: 1004, completion_tokens: 1, total_tokens: 1005 }
        : { prompt_tokens: 1200, completion_tokens: 2, total_tokens: 1202, prompt_tokens_details: { cached_tokens: mainCached } }), async posts => {
        await send(basePrompt('Scene one.', 'Task A.'), aiConfig);
        assert.equal(posts.length, 2, 'first prompt primes, then sends');
        const [prime, main] = posts;
        assert.equal(prime.max_tokens, 1);
        assert.equal(prime.stream, false);
        assert.deepEqual(prime.strata_prefix, main.strata_prefix);
        assert.deepEqual(prime.messages, main.messages.slice(0, prime.messages.length));
        assert.equal(prime.messages.some(message => String(message.content).includes('Task A.')), false);
        assert.equal(main.messages[prime.messages.length].content, 'Task A.');

        await send(basePrompt('Scene one.', 'Task B.'), aiConfig);
        assert.equal(posts.length, 3, 'same shared prefix with a confirmed checkpoint: no prime');

        mainCached = 300;
        await send(basePrompt('Scene one.', 'Task C.'), aiConfig);
        assert.equal(posts.length, 4, 'checkpoint confirmed before this prompt: no prime');
        await send(basePrompt('Scene one.', 'Task D.'), aiConfig);
        assert.equal(posts.length, 6, 'Strata resumed below the checkpoint last time: prime again');

        mainCached = 1000;
        await send(basePrompt('Scene two.', 'Task E.'), aiConfig);
        assert.equal(posts.length, 8, 'a new shared prefix primes');
        assert.equal(posts[6].max_tokens, 1);
    });
});

test('priming is skipped with the cachebuster and can be disabled', { concurrency: false }, async () => {
    for (const aiConfig of [
        buildAiConfig({ cachebuster: true }),
        buildAiConfig({ shared_prefix_cache: { provider: 'strata', endpoint, prime_base_context: false } })
    ]) {
        LLMClient.resetSharedPrefixPrimeStateForTests();
        await runWithTransport(() => ({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }), async posts => {
            await send(basePrompt('Scene one.', 'Task A.'), aiConfig);
            assert.equal(posts.length, 1);
            assert.notEqual(posts[0].max_tokens, 1);
        });
    }
});

test('a continuation of the live session is never primed, even when the checkpoint is unconfirmed', { concurrency: false }, async () => {
    LLMClient.resetSharedPrefixPrimeStateForTests();
    const aiConfig = buildAiConfig();
    // No usage on main responses (like a stream the XML guard ends early): nothing is ever confirmed.
    await runWithTransport(payload => (payload.max_tokens === 1
        ? { prompt_tokens: 1004, completion_tokens: 1, total_tokens: 1005 }
        : undefined), async posts => {
        const first = basePrompt('Scene one.', 'Task A.');
        await send(first, aiConfig);
        assert.equal(posts.length, 2);

        // Next TinyBrain checkpoint: the same transcript plus the reply and a new question.
        const continuation = [...first, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'Next question.' }];
        await send(continuation, aiConfig);
        assert.equal(posts.length, 3, 'continuing from the end of the live session sends no prime');
        assert.deepEqual(posts[2].messages.slice(0, posts[1].messages.length), posts[1].messages);

        // A later checkpoint whose stored reply differs from what was sent (XML guard
        // completion) is still the same transcript: no prime.
        const rewritten = [...first, { role: 'assistant', content: 'ok, completed by the XML guard' },
            { role: 'user', content: 'Next question.' }, { role: 'assistant', content: 'Answer.' }, { role: 'user', content: 'Third question.' }];
        await send(rewritten, aiConfig);
        assert.equal(posts.length, 4, 'same transcript through the task message sends no prime');

        // A sibling prompt with the same shared part diverges at the task: prime again.
        await send(basePrompt('Scene one.', 'Task B.'), aiConfig);
        assert.equal(posts.length, 6);
        assert.equal(posts[4].max_tokens, 1);
    });
});

test('an image after the base-context task keeps the shared message split and leaves the pin alone', { concurrency: false }, async () => {
    LLMClient.resetSharedPrefixPrimeStateForTests();
    const aiConfig = buildAiConfig();
    await runWithTransport(() => ({ prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }), async posts => {
        const textOnly = basePrompt('Scene one.', 'Task A.');
        const withImage = [...basePrompt('Scene one.', 'Describe the attached image.'), { role: 'user', content: [
            { type: 'text', text: 'Attached image:' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } }
        ] }];
        await send(textOnly, aiConfig);
        Globals.config = { ai: aiConfig, ai_multimodal: { enabled: true, backend: 'openai_compatible', endpoint, apiKey: 'test-key', model: 'test-model' },
            chat_tools: { request_user_input_enabled: true }, use_legacy_prompt_checks: false };
        await LLMClient.chatCompletion({ messages: withImage, metadataLabel: 'generate_seasonal_image_vision', multimodal: true,
            validateXML: false, output: 'silent', retryAttempts: 0 });
        const text = posts.filter(payload => payload.max_tokens !== 1)[0];
        const image = posts.at(-1);
        assert.equal(image.messages.some(message => String(typeof message.content === 'string' ? message.content : '').includes('AI_RPG_INTERNAL')), false);
        const shared = text.strata_prefix.messages;
        // Same split up to the end of the shared base context.
        const taskIndex = text.messages.findIndex(message => message.content === 'Task A.');
        assert.deepEqual(image.messages.slice(0, taskIndex), text.messages.slice(0, taskIndex));
        assert.ok(taskIndex > shared);
        assert.ok(Array.isArray(image.messages.at(-1).content) || Array.isArray(image.messages.at(-2).content));
        assert.equal(Object.hasOwn(image, 'strata_prefix'), false, 'images never move the pinned prefix');
    });
});
