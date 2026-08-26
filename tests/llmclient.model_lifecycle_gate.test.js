const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function deferred() {
    let resolve;
    const promise = new Promise(innerResolve => {
        resolve = innerResolve;
    });
    return { promise, resolve };
}

function flushTurn() {
    return new Promise(resolve => setImmediate(resolve));
}

function responseFor(payload) {
    return {
        status: 200,
        data: {
            model: payload.model,
            choices: [{
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'ok' }
            }]
        }
    };
}

test('exclusive model lifecycle waits for active requests and blocks new LLM requests', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    const firstResponse = deferred();
    const releaseExclusive = deferred();
    const started = [];
    let secondRequest = null;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1',
            apiKey: 'test-key',
            model: `lifecycle-gate-${Date.now()}`,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 2,
            supress_seed: true
        }
    };
    axios.post = async (_url, payload) => {
        const text = payload.messages[0].content;
        started.push(text);
        if (text === 'first') {
            await firstResponse.promise;
        }
        return responseFor(payload);
    };

    try {
        const firstRequest = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'first' }],
            metadataLabel: 'lifecycle_gate_first',
            validateXML: false,
            output: 'silent'
        });
        await flushTurn();
        assert.deepEqual(started, ['first']);

        let exclusiveEntered = false;
        const exclusive = LLMClient.withExclusiveModelLifecycle(async () => {
            exclusiveEntered = true;
            secondRequest = LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'second' }],
                metadataLabel: 'lifecycle_gate_second',
                validateXML: false,
                output: 'silent'
            });
            await releaseExclusive.promise;
        });

        await flushTurn();
        assert.equal(exclusiveEntered, false);
        firstResponse.resolve();
        await firstRequest;
        await flushTurn();
        assert.equal(exclusiveEntered, true);
        assert.deepEqual(started, ['first']);

        releaseExclusive.resolve();
        await exclusive;
        await secondRequest;
        assert.deepEqual(started, ['first', 'second']);
    } finally {
        firstResponse.resolve();
        releaseExclusive.resolve();
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('a local prompt waiting behind image generation does not start its timeout countdown', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    const originalRealtimeHub = Globals.realtimeHub;
    const releaseImageLifecycle = deferred();
    const imageLifecycleEntered = deferred();
    const progressPayloads = [];
    const events = [];
    let transportCalls = 0;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1',
            apiKey: 'test-key',
            model: `image-wait-timeout-${Date.now()}`,
            unload_during_image_generation: true,
            stream: true,
            stream_start_timeout: 0.05,
            stream_continue_timeout: 5,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        },
        prompt_progress: {
            character_targets: {
                image_wait_timeout: 100
            }
        }
    };
    Globals.realtimeHub = {
        emit(_clientId, eventName, payload) {
            if (eventName === 'prompt_progress') {
                progressPayloads.push(structuredClone(payload));
            }
        }
    };
    LLMClient.setComfyModelCleanupHandler(async () => {
        events.push('comfy-yielded');
    });
    axios.post = async () => {
        transportCalls += 1;
        events.push('llm-transport');
        const responseStream = new Readable({ read() {} });
        setImmediate(() => {
            responseStream.push('data: {"choices":[{"delta":{"content":"ready"},"finish_reason":"stop"}]}\n\n');
            responseStream.push('data: [DONE]\n\n');
            responseStream.push(null);
        });
        return {
            status: 200,
            statusText: 'OK',
            data: responseStream
        };
    };

    try {
        const imageLifecycle = LLMClient.withExclusiveModelLifecycle(async () => {
            imageLifecycleEntered.resolve();
            await releaseImageLifecycle.promise;
        });
        await imageLifecycleEntered.promise;

        const completion = LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Wait until image generation yields VRAM.' }],
            metadataLabel: 'image_wait_timeout',
            validateXML: false,
            retryAttempts: 0,
            output: 'stdout'
        });
        await new Promise(resolve => setTimeout(resolve, 80));

        assert.equal(transportCalls, 0);
        const queuedEntry = progressPayloads
            .flatMap(payload => payload.entries || [])
            .find(entry => entry.promptText.includes('Wait until image generation yields VRAM.'));
        assert.ok(queuedEntry, 'expected the queued local prompt to remain visible');
        assert.equal(queuedEntry.timeoutSeconds, null);

        releaseImageLifecycle.resolve();
        await imageLifecycle;
        assert.equal(await completion, 'ready');
        assert.deepEqual(events, ['comfy-yielded', 'llm-transport']);

        const activeTimeoutEntry = progressPayloads
            .flatMap(payload => payload.entries || [])
            .find(entry => (
                entry.promptText.includes('Wait until image generation yields VRAM.')
                && entry.timeoutSeconds !== null
            ));
        assert.ok(activeTimeoutEntry, 'expected the full timeout to activate after VRAM release');
    } finally {
        releaseImageLifecycle.resolve();
        LLMClient.setComfyModelCleanupHandler(null);
        axios.post = originalPost;
        Globals.realtimeHub = originalRealtimeHub;
        Globals.config = originalConfig;
    }
});

test('image prompt model management target applies prompt-specific model overrides', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'http://router.example:8080/v1',
            apiKey: 'base-key',
            model: 'base-model',
            unload_during_image_generation: false,
            baseTimeoutSeconds: 30
        },
        ai_model_overrides: {
            image_model: {
                prompts: ['image_prompt_generation'],
                model: 'image-prompt-model',
                unload_during_image_generation: true,
                headers: {
                    'X-Router-Test': 'yes'
                }
            }
        }
    };

    try {
        const target = await LLMClient.resolveOpenAICompatibleModelManagementTarget();
        assert.equal(target.endpoint, 'http://router.example:8080/v1/chat/completions');
        assert.equal(target.model, 'image-prompt-model');
        assert.equal(target.headers.Authorization, 'Bearer base-key');
        assert.equal(target.headers['X-Router-Test'], 'yes');
        assert.equal(target.timeoutMs, 30000);
    } finally {
        Globals.config = originalConfig;
    }
});

test('enabled unload mode frees ComfyUI before the effective prompt transport starts', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    const events = [];
    let cleanupContext = null;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1',
            apiKey: 'test-key',
            model: 'base-model',
            unload_during_image_generation: false,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        },
        ai_model_overrides: {
            cleanup: {
                prompts: ['cleanup_prompt'],
                unload_during_image_generation: true
            }
        }
    };
    LLMClient.setComfyModelCleanupHandler(async context => {
        cleanupContext = context;
        events.push('comfy-unload');
    });
    axios.post = async (_url, payload) => {
        events.push('llm-transport');
        return responseFor(payload);
    };

    try {
        await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'cleanup first' }],
            metadataLabel: 'cleanup_prompt',
            validateXML: false,
            output: 'silent'
        });

        assert.deepEqual(events, ['comfy-unload', 'llm-transport']);
        assert.equal(cleanupContext.metadataLabel, 'cleanup_prompt');
        assert.equal(cleanupContext.aiConfig.unload_during_image_generation, true);
    } finally {
        LLMClient.setComfyModelCleanupHandler(null);
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('disabled unload mode does not call the ComfyUI cleanup handler', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    let cleanupCalls = 0;
    let transportCalls = 0;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1',
            apiKey: 'test-key',
            model: 'base-model',
            unload_during_image_generation: false,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    LLMClient.setComfyModelCleanupHandler(async () => {
        cleanupCalls += 1;
    });
    axios.post = async (_url, payload) => {
        transportCalls += 1;
        return responseFor(payload);
    };

    try {
        await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'no cleanup' }],
            metadataLabel: 'cleanup_disabled',
            validateXML: false,
            output: 'silent'
        });

        assert.equal(cleanupCalls, 0);
        assert.equal(transportCalls, 1);
    } finally {
        LLMClient.setComfyModelCleanupHandler(null);
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('ComfyUI cleanup failure prevents the enabled prompt transport', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    let transportCalls = 0;

    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1',
            apiKey: 'test-key',
            model: 'base-model',
            unload_during_image_generation: true,
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    LLMClient.setComfyModelCleanupHandler(async () => {
        throw new Error('ComfyUI /free unavailable');
    });
    axios.post = async (_url, payload) => {
        transportCalls += 1;
        return responseFor(payload);
    };

    try {
        await assert.rejects(
            () => LLMClient.chatCompletion({
                messages: [{ role: 'user', content: 'must not run' }],
                metadataLabel: 'cleanup_failure',
                validateXML: false,
                output: 'silent'
            }),
            /Failed to unload ComfyUI models before LLM prompt "cleanup_failure": ComfyUI \/free unavailable/
        );
        assert.equal(transportCalls, 0);
    } finally {
        LLMClient.setComfyModelCleanupHandler(null);
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});
