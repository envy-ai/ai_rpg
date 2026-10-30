const test = require('node:test');
const assert = require('node:assert/strict');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const {
    WORLD_GENERATION_PROMPT_FAMILIES,
    getWorldGenerationTokenBudgetConfigurationErrors,
    resolveWorldGenerationMaxTokens
} = require('../WorldGenerationTokenBudget.js');

function mockCompletionResponse(payload) {
    return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: 'world-generation-budget-test',
            model: payload.model,
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
            usage: { total_tokens: 1 }
        }
    };
}

test('world generation token budget validates its config and covers only structured generation families', () => {
    assert.deepEqual(getWorldGenerationTokenBudgetConfigurationErrors({}), []);
    assert.deepEqual(getWorldGenerationTokenBudgetConfigurationErrors({ world_generation: {} }), []);
    assert.deepEqual(getWorldGenerationTokenBudgetConfigurationErrors({ world_generation: { max_tokens: 20000 } }), []);
    assert.equal(resolveWorldGenerationMaxTokens('location_things_generation', {}), null);
    assert.equal(resolveWorldGenerationMaxTokens('location_things_generation', { world_generation: {} }), null);

    for (const family of WORLD_GENERATION_PROMPT_FAMILIES) {
        assert.equal(
            resolveWorldGenerationMaxTokens(`${family}_tinybrain`, { world_generation: { max_tokens: 20000 } }),
            20000,
            `${family} suffix should inherit its family budget`
        );
    }
    for (const label of ['player_action', 'player_action_tinybrain', 'region_arrival_selection', 'image_prompt_generation', 'scene_summarize']) {
        assert.equal(resolveWorldGenerationMaxTokens(label, { world_generation: { max_tokens: 20000 } }), null, `${label} is not a generation label`);
    }

    for (const invalid of [null, [], 'tokens', 5]) {
        assert.deepEqual(
            getWorldGenerationTokenBudgetConfigurationErrors({ world_generation: invalid }),
            ['world_generation must be an object when provided.']
        );
    }
    for (const max_tokens of [null, 0, -1, 1.5, '20000']) {
        assert.deepEqual(
            getWorldGenerationTokenBudgetConfigurationErrors({ world_generation: { max_tokens } }),
            ['world_generation.max_tokens must be a positive integer when provided.']
        );
    }
});

test('LLMClient applies world generation max_tokens after caller and model profile caps and removes max_completion_tokens', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const payloads = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return mockCompletionResponse(payload);
    };
    Globals.config = {
        world_generation: { max_tokens: 20000 },
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-generation-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            maxTokens: 18000,
            supress_seed: true
        },
        ai_model_overrides: {
            generation: {
                prompts: ['location_things_generation'],
                maxTokens: 12000
            }
        }
    };

    try {
        await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Generate location Things.' }],
            metadataLabel: 'location_things_generation',
            maxTokens: 700,
            additionalPayload: { max_completion_tokens: 500 },
            validateXML: false,
            stream: false,
            retryAttempts: 0,
            output: 'silent'
        });
        await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Continue the staged generation.' }],
            metadataLabel: 'location_things_generation',
            maxTokens: 900,
            additionalPayload: { max_completion_tokens: 600 },
            validateXML: false,
            stream: false,
            retryAttempts: 0,
            output: 'silent'
        });

        assert.equal(payloads.length, 2, 'the staged follow-up uses the same central request path');
        for (const payload of payloads) {
            assert.equal(payload.max_tokens, 20000);
            assert.equal(Object.hasOwn(payload, 'max_completion_tokens'), false);
        }
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('unaffected prose requests retain their ordinary caller token limit', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const payloads = [];
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return mockCompletionResponse(payload);
    };
    Globals.config = {
        world_generation: { max_tokens: 20000 },
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-prose-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };

    try {
        await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Write a scene.' }],
            metadataLabel: 'player_action',
            maxTokens: 800,
            additionalPayload: { max_completion_tokens: 600 },
            validateXML: false,
            stream: false,
            retryAttempts: 0,
            output: 'silent'
        });

        assert.equal(payloads.length, 1);
        assert.equal(payloads[0].max_tokens, 800);
        assert.equal(payloads[0].max_completion_tokens, 600);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});
