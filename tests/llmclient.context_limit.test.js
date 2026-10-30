'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

test('streamed HTTP context overflow propagates once instead of becoming an empty response', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRealtimeHub = Globals.realtimeHub;
    const tempBaseDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '..', 'tmp'), 'llmclient-context-limit-'));
    let transportCalls = 0;
    let responseCallbacks = 0;

    Globals.baseDir = tempBaseDir;
    Globals.realtimeHub = { emit() {} };
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: true,
            retryAttempts: 3,
            waitAfterError: 0,
            waitAfterRateLimitError: 0,
            waitAfterNetworkError: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    axios.post = async () => {
        transportCalls += 1;
        const error = new Error('Request failed with status code 400');
        error.response = {
            status: 400,
            statusText: 'Bad Request',
            data: Readable.from([JSON.stringify({
                error: {
                    message: 'This request exceeds the model context window of 131072 tokens.',
                    type: 'invalid_request_error',
                    code: 'context_length_exceeded'
                }
            })])
        };
        throw error;
    };

    try {
        await assert.rejects(LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'A deliberately oversized prompt.' }],
            metadataLabel: 'player_action',
            validateXML: false,
            onResponse() { responseCallbacks += 1; },
            output: 'silent'
        }), error => {
            assert.equal(error.code, 'LLM_CONTEXT_LIMIT_EXCEEDED');
            assert.equal(error.status, 400);
            assert.equal(error.isContextLimitError, true);
            assert.equal(error.nonRetryable, true);
            assert.match(error.providerErrorMessage, /exceeds the model context window of 131072 tokens/);
            assert.match(error.message, /400[\s\S]*context window of 131072 tokens/);
            assert.match(error.stack, /context window of 131072 tokens/);
            return true;
        });
        assert.equal(transportCalls, 1, 'context overflow is not retried even when retryAttempts is positive');
        assert.equal(responseCallbacks, 0, 'provider error content never reaches response parsing or callbacks');
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.realtimeHub = originalRealtimeHub;
    }
});

test('an unrelated HTTP 400 keeps the configured retry path', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const tempBaseDir = fs.mkdtempSync(path.join(path.resolve(__dirname, '..', 'tmp'), 'llmclient-context-limit-retry-'));
    let transportCalls = 0;

    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 1,
            waitAfterError: 0,
            waitAfterRateLimitError: 0,
            waitAfterNetworkError: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    axios.post = async (_endpoint, payload) => {
        transportCalls += 1;
        if (transportCalls === 1) {
            const error = new Error('Request failed with status code 400');
            error.response = { status: 400, data: { error: { message: 'Invalid parameter: unsupported response format.' } } };
            throw error;
        }
        return { data: { model: payload.model, choices: [{ message: { content: 'Recovered response.' }, finish_reason: 'stop' }] } };
    };

    try {
        const response = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Retry an unrelated provider error.' }],
            metadataLabel: 'unrelated_http_400_retry',
            validateXML: false,
            output: 'silent'
        });
        assert.equal(response, 'Recovered response.');
        assert.equal(transportCalls, 2);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});
