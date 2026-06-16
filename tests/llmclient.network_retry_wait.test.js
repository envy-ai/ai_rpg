const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

test('LLMClient.chatCompletion waits the configured duration before retrying network errors', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalSetTimeout = global.setTimeout;
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    const tempBaseDir = fs.mkdtempSync(path.join(tmpRoot, 'llmclient-network-retry-wait-'));
    const retryWaitDurationsMs = [];
    let calls = 0;

    axios.post = async (_endpoint, payload) => {
        calls += 1;
        if (calls === 1) {
            const error = new Error('Synthetic socket reset.');
            error.code = 'ECONNRESET';
            throw error;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'mock_response',
                model: payload.model,
                choices: [
                    {
                        message: { content: 'Recovered response.' },
                        finish_reason: 'stop'
                    }
                ],
                usage: { total_tokens: 12 }
            }
        };
    };
    global.setTimeout = (callback, delayMs, ...args) => {
        if (delayMs === 50) {
            retryWaitDurationsMs.push(delayMs);
        }
        return originalSetTimeout(callback, 0, ...args);
    };
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
            waitAfterNetworkError: 0.05,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Trigger one network retry.' }],
            metadataLabel: 'network_retry_wait',
            validateXML: false,
            stream: false,
            output: 'silent'
        });

        assert.equal(result, 'Recovered response.');
        assert.equal(calls, 2);
        assert.deepEqual(retryWaitDurationsMs, [50]);
    } finally {
        axios.post = originalAxiosPost;
        global.setTimeout = originalSetTimeout;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});
