const test = require('node:test');
const assert = require('node:assert/strict');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

test('LLMClient.chatCompletion uses forceOutput string without network call', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let onResponsePayload = null;
    let capturedRequest = null;
    let capturedResponse = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Run deterministic test.' }],
            forceOutput: '<final>Deterministic response</final>',
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0,
            captureRequestPayload: (payload) => {
                capturedRequest = payload;
            },
            captureResponsePayload: (payload) => {
                capturedResponse = payload;
            },
            onResponse: (response) => {
                onResponsePayload = response;
            }
        });

        assert.equal(result, '<final>Deterministic response</final>');
        assert.ok(capturedRequest && capturedRequest.stream === false);
        assert.equal(capturedRequest.forceOutput, '<final>Deterministic response</final>');
        assert.ok(capturedResponse?.choices?.[0]?.message?.content === '<final>Deterministic response</final>');
        assert.ok(onResponsePayload?.data?.choices?.[0]?.message?.content === '<final>Deterministic response</final>');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});

test('LLMClient.chatCompletion supports forceOutput tool calls and skips regex validation for tool rounds', async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    let onResponsePayload = null;

    axios.post = async () => {
        throw new Error('axios.post should not be called when forceOutput is provided.');
    };
    Globals.config = null;

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Find Bob.' }],
            forceOutput: {
                model: 'mock-model',
                finishReason: 'tool_calls',
                message: {
                    content: '',
                    tool_calls: [
                        {
                            id: 'call_1',
                            type: 'function',
                            function: {
                                name: 'locateNpcs',
                                arguments: '{"query":"Bob"}'
                            }
                        }
                    ]
                }
            },
            requiredRegex: /<final>[\s\S]*?<\/final>/,
            output: 'silent',
            retryAttempts: 0,
            onResponse: (response) => {
                onResponsePayload = response;
            }
        });

        assert.equal(result, '');
        assert.ok(onResponsePayload);
        assert.equal(onResponsePayload.data.model, 'mock-model');
        assert.equal(onResponsePayload.data.choices[0].finish_reason, 'tool_calls');
        assert.equal(onResponsePayload.data.choices[0].message.tool_calls.length, 1);
        assert.equal(onResponsePayload.data.choices[0].message.tool_calls[0].function.name, 'locateNpcs');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});
