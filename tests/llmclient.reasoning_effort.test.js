const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load } = require('js-yaml');
const axios = require('axios');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function buildAiConfig(overrides = {}) {
    return {
        backend: 'openai_compatible',
        endpoint: 'https://example.invalid/v1/chat/completions',
        apiKey: 'test-key',
        model: 'test-model',
        stream: false,
        retryAttempts: 0,
        max_concurrent_requests: 1,
        supress_seed: true,
        reasoning: false,
        ...overrides
    };
}

async function captureChatCompletionPayload({ aiConfig, requestOptions = {}, configOverrides = {} }) {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let capturedPayload = null;

    axios.post = async (_endpoint, payload) => {
        capturedPayload = payload;
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'reasoning-effort-test-response',
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: '<final>ok</final>'
                        }
                    }
                ]
            }
        };
    };
    Globals.config = { ai: aiConfig, ...configOverrides };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Reasoning effort payload test.' }],
            metadataLabel: 'reasoning_effort_test',
            validateXML: false,
            output: 'silent',
            ...requestOptions
        });
        assert.equal(result, '<final>ok</final>');
        return capturedPayload;
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
}

test('LLMClient.chatCompletion leaves reasoning payload unchanged when no reasoning effort is set', { concurrency: false }, async () => {
    const payload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig()
    });

    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'reasoning'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(payload, 'reasoning_effort'), false);
});

test('LLMClient.chatCompletion enables reasoning when config reasoning_effort is set', { concurrency: false }, async () => {
    const payload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig({
            reasoning_effort: 'low'
        })
    });

    assert.equal(payload.reasoning, true);
    assert.equal(payload.reasoning_effort, 'low');
});

test('LLMClient.chatCompletion per-call reasoningEffort overrides config reasoning_effort', { concurrency: false }, async () => {
    const payload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig({
            reasoning_effort: 'low'
        }),
        requestOptions: {
            reasoningEffort: 'high'
        }
    });

    assert.equal(payload.reasoning, true);
    assert.equal(payload.reasoning_effort, 'high');
});

test('LLMClient.chatCompletion applies reasoning_effort from prompt-specific AI model overrides', { concurrency: false }, async () => {
    const payload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig(),
        requestOptions: {
            metadataLabel: 'quest_check'
        },
        configOverrides: {
            ai_model_overrides: {
                quest_reasoning: {
                    prompts: ['quest_check'],
                    reasoning_effort: 'low'
                }
            }
        }
    });

    assert.equal(payload.reasoning, true);
    assert.equal(payload.reasoning_effort, 'low');

    const untargetedPayload = await captureChatCompletionPayload({
        aiConfig: buildAiConfig(),
        requestOptions: {
            metadataLabel: 'player_action'
        },
        configOverrides: {
            ai_model_overrides: {
                quest_reasoning: {
                    prompts: ['quest_check'],
                    reasoning_effort: 'low'
                }
            }
        }
    });

    assert.equal(Object.prototype.hasOwnProperty.call(untargetedPayload, 'reasoning'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(untargetedPayload, 'reasoning_effort'), false);
});

test('local config does not force reasoning effort for quest, event, and need-bar event checks', () => {
    const configPath = path.resolve(__dirname, '..', 'config.yaml');
    const config = load(fs.readFileSync(configPath, 'utf8'));
    const profiles = config?.ai_model_overrides || {};
    const checkLabels = new Set(['quest_check', 'event_checks', 'need_bar_event_checks']);
    const checkReasoningProfiles = Object.values(profiles).filter(profile => (
        profile
        && typeof profile === 'object'
        && !Array.isArray(profile)
        && Array.isArray(profile.prompts)
        && profile.prompts.some(prompt => checkLabels.has(prompt))
        && typeof profile.reasoning_effort === 'string'
        && profile.reasoning_effort.trim()
    ));

    assert.deepEqual(checkReasoningProfiles, []);
});

test('LLMClient configuration rejects non-string reasoning_effort', () => {
    const errors = LLMClient.getConfigurationErrors(buildAiConfig({
        reasoning_effort: 3
    }));

    assert.match(errors.join('\n'), /reasoning_effort must be a string/i);
});
