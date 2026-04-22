const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function createDeferred() {
    let resolve;
    const promise = new Promise(innerResolve => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

function flushTurn() {
    return new Promise(resolve => setImmediate(resolve));
}

test('background LLM requests leave one configured slot available for foreground prompts', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const modelName = `priority-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const started = [];
    const backgroundOne = createDeferred();
    const backgroundTwo = createDeferred();

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: modelName,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 2
        }
    };

    axios.post = async (_endpoint, payload) => {
        const label = payload?.messages?.[0]?.content || '';
        started.push(label);
        if (label === 'background one') {
            await backgroundOne.promise;
        }
        if (label === 'background two') {
            await backgroundTwo.promise;
        }
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: `response-${label.replace(/\s+/g, '-')}`,
                object: 'chat.completion',
                created: 1,
                model: modelName,
                choices: [
                    {
                        index: 0,
                        finish_reason: 'stop',
                        message: {
                            role: 'assistant',
                            content: `<final>${label}</final>`
                        }
                    }
                ]
            }
        };
    };

    try {
        const firstBackground = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'background one' }],
            metadataLabel: 'npc_memories_background_one',
            runInBackground: true,
            validateXML: false,
            output: 'silent'
        });
        const secondBackground = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'background two' }],
            metadataLabel: 'npc_memories_background_two',
            runInBackground: true,
            validateXML: false,
            output: 'silent'
        });

        await flushTurn();
        assert.deepEqual(started, ['background one']);

        const foreground = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'foreground travel' }],
            metadataLabel: 'player_action',
            validateXML: false,
            output: 'silent'
        });

        await flushTurn();
        assert.deepEqual(started, ['background one', 'foreground travel']);

        backgroundOne.resolve();
        backgroundTwo.resolve();
        await Promise.all([firstBackground, secondBackground, foreground]);
        assert.deepEqual(started, ['background one', 'foreground travel', 'background two']);
    } finally {
        backgroundOne.resolve();
        backgroundTwo.resolve();
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
    }
});
