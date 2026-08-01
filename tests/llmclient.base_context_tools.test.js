const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function buildAiConfig() {
    return {
        backend: 'openai_compatible',
        endpoint: 'https://example.invalid/v1/chat/completions',
        apiKey: 'test-key',
        model: 'test-model',
        stream: false,
        retryAttempts: 0,
        max_concurrent_requests: 1,
        supress_seed: true,
        prefill: null
    };
}

async function capturePayload({
    metadataLabel,
    additionalPayload = {},
    messages
}) {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let capturedPayload = null;

    axios.post = async (_endpoint, payload) => {
        capturedPayload = JSON.parse(JSON.stringify(payload));
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'base-context-tools-test',
                object: 'chat.completion',
                created: 1,
                model: payload.model,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: {
                        role: 'assistant',
                        content: 'ok'
                    }
                }]
            }
        };
    };
    Globals.config = {
        ai: buildAiConfig(),
        chat_tools: {
            request_user_input_enabled: true
        }
    };

    try {
        const response = await LLMClient.chatCompletion({
            messages,
            metadataLabel,
            additionalPayload,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        assert.equal(response, 'ok');
        return capturedPayload;
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
}

function buildBaseContextMessages() {
    return [
        { role: 'system', content: 'Shared system prompt.' },
        {
            role: 'user',
            content: [
                'Stable base context.',
                LLMClient.getRecentStoryMessageBoundaryMarker(),
                'Recent story and current conditions.',
                LLMClient.getBaseContextEndMarker(),
                'Prompt-specific instructions.'
            ].join('\n')
        }
    ];
}

test('chatCompletion sends one shared tool schema for tool-enabled and formerly tool-less base-context prompts', { concurrency: false }, async () => {
    const toolLessPayload = await capturePayload({
        metadataLabel: 'slop_remover',
        messages: buildBaseContextMessages()
    });
    const toolEnabledPayload = await capturePayload({
        metadataLabel: 'player_action',
        messages: buildBaseContextMessages(),
        additionalPayload: {
            tools: [{
                type: 'function',
                function: {
                    name: 'callerSpecificTool',
                    parameters: { type: 'object' }
                }
            }],
            tool_choice: 'auto'
        }
    });

    assert.ok(Array.isArray(toolLessPayload.tools));
    assert.ok(toolLessPayload.tools.length > 0);
    assert.equal(toolLessPayload.tool_choice, 'auto');
    assert.deepEqual(toolEnabledPayload.tools, toolLessPayload.tools);
    assert.equal(toolEnabledPayload.tool_choice, 'auto');
    assert.equal(toolLessPayload.messages.length, 3);
    assert.match(toolLessPayload.messages[2].content, /Do not make tool calls\./);
    assert.doesNotMatch(toolEnabledPayload.messages[2].content, /Do not make tool calls\./);
    assert.doesNotMatch(JSON.stringify(toolLessPayload.messages), /AI_RPG_INTERNAL_/);
    assert.doesNotMatch(JSON.stringify(toolEnabledPayload.messages), /AI_RPG_INTERNAL_/);
});

test('chatCompletion leaves generic base-context tool payloads unchanged', { concurrency: false }, async () => {
    const genericTools = [{
        type: 'function',
        function: {
            name: 'genericOnlyTool',
            parameters: { type: 'object' }
        }
    }];
    const payload = await capturePayload({
        metadataLabel: 'generic_prompt',
        messages: buildBaseContextMessages(),
        additionalPayload: {
            tools: genericTools,
            tool_choice: 'required'
        }
    });

    assert.deepEqual(payload.tools, genericTools);
    assert.equal(payload.tool_choice, 'required');
    assert.doesNotMatch(JSON.stringify(payload.messages), /AI_RPG_INTERNAL_/);
    assert.doesNotMatch(JSON.stringify(payload.messages), /Do not make tool calls\./);
});

test('chatCompletion does not add shared tools to prompts without the base-context marker', { concurrency: false }, async () => {
    const payload = await capturePayload({
        metadataLabel: 'standalone_prompt',
        messages: [{ role: 'user', content: 'Standalone prompt.' }]
    });

    assert.equal(payload.tools, undefined);
    assert.equal(payload.tool_choice, undefined);
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'Standalone prompt.' }]);
});
