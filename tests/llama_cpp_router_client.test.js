const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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

function createMemoryFileSystem(initialPaths = []) {
    const files = new Set(initialPaths);
    const unlinked = [];
    return {
        files,
        unlinked,
        fileSystem: {
            promises: {
                access: async filePath => {
                    if (!files.has(filePath)) {
                        const error = new Error(`ENOENT: ${filePath}`);
                        error.code = 'ENOENT';
                        throw error;
                    }
                },
                unlink: async filePath => {
                    if (!files.delete(filePath)) {
                        const error = new Error(`ENOENT: ${filePath}`);
                        error.code = 'ENOENT';
                        throw error;
                    }
                    unlinked.push(filePath);
                }
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

test('llama.cpp slot-cache filenames are safe, stable, and model-specific', () => {
    const first = LlamaCppRouterClient.buildSlotCacheFilename('org/story model.gguf');
    const repeated = LlamaCppRouterClient.buildSlotCacheFilename('org/story model.gguf');
    const second = LlamaCppRouterClient.buildSlotCacheFilename('org/other model.gguf');

    assert.equal(first, repeated);
    assert.notEqual(first, second);
    assert.equal(path.basename(first), first);
    assert.match(first, /^org_story_model\.gguf-[a-f0-9]{12}-cache\.bin$/);
});

test('llama.cpp router saves slot 0 and verifies the cache file', async () => {
    const memory = createMemoryFileSystem();
    const calls = [];
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        slotCacheDirectory: '/slot-cache',
        fileSystem: memory.fileSystem,
        httpClient: {
            get: async () => ({ data: { data: [] } }),
            post: async (url, payload, options) => {
                calls.push({ url, payload, options });
                memory.files.add(path.join('/slot-cache', payload.filename));
                return {
                    data: {
                        id_slot: 0,
                        filename: payload.filename,
                        n_saved: 42
                    }
                };
            }
        }
    });

    const result = await client.saveSlotCache();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://router.example:8080/slots/0?action=save');
    assert.deepEqual(calls[0].payload, {
        model: 'story-model',
        filename: client.getSlotCacheFilename()
    });
    assert.equal(result.cachePath, path.join('/slot-cache', client.getSlotCacheFilename()));
    assert.equal(memory.files.has(result.cachePath), true);
});

test('llama.cpp router restores an existing slot cache and immediately deletes it', async () => {
    const filename = LlamaCppRouterClient.buildSlotCacheFilename('story-model');
    const cachePath = path.join('/slot-cache', filename);
    const memory = createMemoryFileSystem([cachePath]);
    const calls = [];
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        slotCacheDirectory: '/slot-cache',
        fileSystem: memory.fileSystem,
        httpClient: {
            get: async () => ({ data: { data: [] } }),
            post: async (url, payload) => {
                calls.push({ url, payload });
                return { data: { id_slot: 0, filename: payload.filename, n_restored: 42 } };
            }
        }
    });

    const result = await client.restoreSlotCacheIfPresent();

    assert.equal(result.restored, true);
    assert.equal(result.deleted, true);
    assert.deepEqual(memory.unlinked, [cachePath]);
    assert.equal(memory.files.has(cachePath), false);
    assert.equal(calls[0].url, 'http://router.example:8080/slots/0?action=restore');
    assert.deepEqual(calls[0].payload, { model: 'story-model', filename });
});

test('llama.cpp router skips restore when no saved cache exists', async () => {
    const memory = createMemoryFileSystem();
    let postCalls = 0;
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        slotCacheDirectory: '/slot-cache',
        fileSystem: memory.fileSystem,
        httpClient: {
            get: async () => ({ data: { data: [] } }),
            post: async () => {
                postCalls += 1;
                return { data: {} };
            }
        }
    });

    const result = await client.restoreSlotCacheIfPresent();

    assert.equal(result.restored, false);
    assert.equal(postCalls, 0);
});

test('llama.cpp router reports cache deletion failure after a successful restore', async () => {
    const filename = LlamaCppRouterClient.buildSlotCacheFilename('story-model');
    const cachePath = path.join('/slot-cache', filename);
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        slotCacheDirectory: '/slot-cache',
        fileSystem: {
            promises: {
                access: async () => {},
                unlink: async () => {
                    const error = new Error('permission denied');
                    error.code = 'EACCES';
                    throw error;
                }
            }
        },
        httpClient: {
            get: async () => ({ data: { data: [] } }),
            post: async (_url, payload) => ({
                data: { id_slot: 0, filename: payload.filename }
            })
        }
    });

    await assert.rejects(
        () => client.restoreSlotCacheIfPresent(),
        error => {
            assert.equal(error.slotCacheDeleteFailed, true);
            assert.match(error.message, new RegExp(cachePath));
            return true;
        }
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

test('llama.cpp router startup loading is idempotent for an already-loaded model', async () => {
    const harness = createHttpHarness(['loaded']);
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        httpClient: harness.client
    });

    const result = await client.loadModelIfNeeded();

    assert.deepEqual(result, {
        loadedByClient: false,
        initialStatus: 'loaded'
    });
    assert.equal(harness.calls.some(call => call.method === 'post'), false);
});

test('llama.cpp router startup loading accepts a sleeping model as active', async () => {
    const harness = createHttpHarness(['sleeping']);
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        httpClient: harness.client
    });

    const result = await client.loadModelIfNeeded();

    assert.deepEqual(result, {
        loadedByClient: false,
        initialStatus: 'sleeping'
    });
    assert.equal(harness.calls.some(call => call.method === 'post'), false);
});

test('llama.cpp router startup loading loads an unloaded model', async () => {
    const harness = createHttpHarness(['unloaded', 'loading', 'loaded']);
    const client = new LlamaCppRouterClient({
        endpoint: 'http://router.example:8080/v1',
        model: 'story-model',
        timeoutMs: 1000,
        pollIntervalMs: 0,
        httpClient: harness.client,
        sleep: async () => {}
    });

    const result = await client.loadModelIfNeeded();

    assert.deepEqual(result, {
        loadedByClient: true,
        initialStatus: 'unloaded'
    });
    assert.deepEqual(
        harness.calls.map(call => `${call.method} ${call.url}`),
        [
            'get http://router.example:8080/models',
            'post http://router.example:8080/models/load',
            'get http://router.example:8080/models',
            'get http://router.example:8080/models'
        ]
    );
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
