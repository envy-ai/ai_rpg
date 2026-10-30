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
        endpoint
    });
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
