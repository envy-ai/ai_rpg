const test = require('node:test');
const assert = require('node:assert/strict');
const LlamaCppRouterClient = require('../LlamaCppRouterClient.js');

function createHttpHarness(statuses = []) {
    const calls = [];
    const pendingStatuses = [...statuses];
    return {
        calls,
        client: {
            get: async (url, options) => {
                calls.push({ method: 'get', url, options });
                const status = pendingStatuses.shift();
                return {
                    data: {
                        data: [{
                            id: 'story-model',
                            status: { value: status }
                        }]
                    }
                };
            },
            post: async (url, payload, options) => {
                calls.push({ method: 'post', url, payload, options });
                return { data: { success: true } };
            }
        }
    };
}

test('llama.cpp router base URL removes OpenAI chat and v1 suffixes', () => {
    assert.equal(
        LlamaCppRouterClient.resolveRouterBaseUrl('http://router.example:8080/v1/chat/completions'),
        'http://router.example:8080'
    );
    assert.equal(
        LlamaCppRouterClient.resolveRouterBaseUrl('https://example.test/llama/v1'),
        'https://example.test/llama'
    );
});

test('llama.cpp router unloads a loaded model and waits for unloaded status', async () => {
    const harness = createHttpHarness(['loaded', 'unloading', 'unloaded']);
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1/chat/completions',
        model: 'story-model',
        headers: { Authorization: 'Bearer test' },
        timeoutMs: 1000,
        pollIntervalMs: 0,
        httpClient: harness.client,
        sleep: async () => {}
    });

    const result = await client.unloadModelIfLoaded();

    assert.deepEqual(result, {
        unloadedByClient: true,
        initialStatus: 'loaded'
    });
    assert.deepEqual(
        harness.calls.map(call => `${call.method} ${call.url}`),
        [
            'get http://router.example:8080/models',
            'post http://router.example:8080/models/unload',
            'get http://router.example:8080/models',
            'get http://router.example:8080/models'
        ]
    );
    assert.deepEqual(harness.calls[1].payload, { model: 'story-model' });
});

test('llama.cpp router leaves an already-unloaded model untouched', async () => {
    const harness = createHttpHarness(['unloaded']);
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        httpClient: harness.client
    });

    const result = await client.unloadModelIfLoaded();

    assert.equal(result.unloadedByClient, false);
    assert.equal(harness.calls.some(call => call.method === 'post'), false);
});

test('llama.cpp router loads a model and waits for loaded status', async () => {
    const harness = createHttpHarness(['loading', 'loaded']);
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        timeoutMs: 1000,
        pollIntervalMs: 0,
        httpClient: harness.client,
        sleep: async () => {}
    });

    await client.loadModel();

    assert.equal(harness.calls[0].url, 'http://router.example:8080/models/load');
    assert.equal(harness.calls.at(-1).url, 'http://router.example:8080/models');
});

test('llama.cpp router fails explicitly when the configured model is absent', async () => {
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'missing-model',
        httpClient: {
            get: async () => ({ data: { data: [] } }),
            post: async () => ({ data: { success: true } })
        }
    });

    await assert.rejects(() => client.unloadModelIfLoaded(), /does not list configured model/);
});

test('llama.cpp router retries transient model-status connection failures', async () => {
    const calls = [];
    const warnings = [];
    const sleeps = [];
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        statusRetryAttempts: 2,
        statusRetryDelayMs: 15,
        httpClient: {
            get: async () => {
                calls.push('get');
                if (calls.length < 3) {
                    const error = new Error('socket hang up');
                    error.code = 'ECONNRESET';
                    throw error;
                }
                return {
                    data: {
                        data: [{ id: 'story-model', status: { value: 'unloaded' } }]
                    }
                };
            },
            post: async () => ({ data: { success: true } })
        },
        sleep: async milliseconds => sleeps.push(milliseconds),
        logger: { warn: message => warnings.push(message) }
    });

    const result = await client.unloadModelIfLoaded();

    assert.equal(result.unloadedByClient, false);
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [15, 15]);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /socket hang up; retrying/);
});

test('llama.cpp router does not retry non-transient status request failures', async () => {
    let getCalls = 0;
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        httpClient: {
            get: async () => {
                getCalls += 1;
                const error = new Error('bad request');
                error.response = { status: 400, data: { error: 'invalid request' } };
                throw error;
            },
            post: async () => ({ data: { success: true } })
        }
    });

    await assert.rejects(() => client.unloadModelIfLoaded(), /invalid request/);
    assert.equal(getCalls, 1);
});
