const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function buildAiConfig(overrides = {}) {
    return {
        backend: 'openai_compatible',
        endpoint: 'https://main.example.invalid/v1/chat/completions',
        apiKey: 'main-key',
        model: 'main-text-model',
        stream: false,
        retryAttempts: 0,
        max_concurrent_requests: 1,
        supress_seed: true,
        headers: {
            'X-Route': 'main'
        },
        custom_args: {
            main_route: true
        },
        ...overrides
    };
}

function buildMultimodalConfig(overrides = {}) {
    return {
        enabled: true,
        backend: 'openai_compatible',
        endpoint: 'https://multimodal.example.invalid/v1/chat/completions',
        apiKey: 'multimodal-key',
        model: 'multimodal-model',
        headers: {
            'X-Route': 'multimodal'
        },
        custom_args: {
            multimodal_route: true
        },
        ...overrides
    };
}

function makeTempBaseDir() {
    const tmpRoot = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    return fs.mkdtempSync(path.join(tmpRoot, 'llmclient-vision-routing-'));
}

async function captureMultimodalRequest({
    ai = buildAiConfig(),
    aiMultimodal = buildMultimodalConfig(),
    aiModelOverrides = undefined,
    metadataLabel = 'vision_routing_test',
    preferDedicatedMultimodalConfiguration = false
} = {}) {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const baseDir = makeTempBaseDir();
    const calls = [];
    axios.post = async (endpoint, payload, options) => {
        calls.push({
            endpoint,
            payload: JSON.parse(JSON.stringify(payload)),
            options: JSON.parse(JSON.stringify(options))
        });
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'vision-routing-response',
                object: 'chat.completion',
                model: payload.model,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: 'vision routing response' }
                }]
            }
        };
    };
    Globals.baseDir = baseDir;
    Globals.config = {
        ai,
        ...(aiMultimodal === null ? {} : { ai_multimodal: aiMultimodal }),
        ...(aiModelOverrides === undefined ? {} : { ai_model_overrides: aiModelOverrides })
    };

    try {
        const result = await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'Route this vision-capable prompt.' }],
            metadataLabel,
            multimodal: true,
            preferDedicatedMultimodalConfiguration,
            validateXML: false,
            output: 'silent',
            retryAttempts: 0
        });
        return { result, calls };
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
}

function assertRoute(call, {
    endpoint,
    model,
    apiKey,
    routeHeader,
    includesPayload = [],
    excludesPayload = []
}) {
    assert.equal(call.endpoint, endpoint);
    assert.equal(call.payload.model, model);
    assert.equal(call.options.headers.Authorization, `Bearer ${apiKey}`);
    assert.equal(call.options.headers['X-Route'], routeHeader);
    for (const key of includesPayload) {
        assert.equal(call.payload[key], true, `Expected request payload to include ${key}.`);
    }
    for (const key of excludesPayload) {
        assert.equal(Object.hasOwn(call.payload, key), false, `Expected request payload to omit ${key}.`);
    }
}

test('vision-enabled main AI configuration bypasses ai_multimodal without leaking its transport settings', { concurrency: false }, async () => {
    const { result, calls } = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: true })
    });

    assert.equal(result, 'vision routing response');
    assert.equal(calls.length, 1);
    assertRoute(calls[0], {
        endpoint: 'https://main.example.invalid/v1/chat/completions',
        model: 'main-text-model',
        apiKey: 'main-key',
        routeHeader: 'main',
        includesPayload: ['main_route'],
        excludesPayload: ['multimodal_route']
    });
});

test('a missing has_vision value uses the enabled ai_multimodal configuration', { concurrency: false }, async () => {
    const { result, calls } = await captureMultimodalRequest({
        ai: buildAiConfig()
    });

    assert.equal(result, 'vision routing response');
    assert.equal(calls.length, 1);
    assertRoute(calls[0], {
        endpoint: 'https://multimodal.example.invalid/v1/chat/completions',
        model: 'multimodal-model',
        apiKey: 'multimodal-key',
        routeHeader: 'multimodal',
        includesPayload: ['multimodal_route'],
        excludesPayload: ['main_route']
    });
});

test('effective vision support dispatches the main route when ai_multimodal is disabled or absent', { concurrency: false }, async () => {
    const disabled = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: true }),
        aiMultimodal: buildMultimodalConfig({ enabled: false })
    });
    assert.equal(disabled.result, 'vision routing response');
    assert.equal(disabled.calls.length, 1);
    assertRoute(disabled.calls[0], {
        endpoint: 'https://main.example.invalid/v1/chat/completions',
        model: 'main-text-model',
        apiKey: 'main-key',
        routeHeader: 'main',
        includesPayload: ['main_route'],
        excludesPayload: ['multimodal_route']
    });

    const inheritedOverride = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: true }),
        aiMultimodal: null,
        metadataLabel: 'vision_override_inherits_root',
        aiModelOverrides: {
            inheritedVisionProfile: {
                prompts: ['vision_override_inherits_root'],
                endpoint: 'https://override.example.invalid/v1/chat/completions',
                apiKey: 'override-key',
                model: 'inherited-vision-model',
                headers: { 'X-Route': 'override' },
                custom_args: { override_route: true }
            }
        }
    });
    assert.equal(inheritedOverride.result, 'vision routing response');
    assert.equal(inheritedOverride.calls.length, 1);
    assertRoute(inheritedOverride.calls[0], {
        endpoint: 'https://override.example.invalid/v1/chat/completions',
        model: 'inherited-vision-model',
        apiKey: 'override-key',
        routeHeader: 'override',
        includesPayload: ['main_route', 'override_route'],
        excludesPayload: ['multimodal_route']
    });
});

test('a vision-enabled model override wins over a false root setting and bypasses ai_multimodal', { concurrency: false }, async () => {
    const { result, calls } = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: false }),
        metadataLabel: 'vision_override_enabled',
        aiModelOverrides: {
            visionProfile: {
                prompts: ['vision_override_enabled'],
                has_vision: true,
                endpoint: 'https://override.example.invalid/v1/chat/completions',
                apiKey: 'override-key',
                model: 'override-vision-model',
                headers: { 'X-Route': 'override' },
                custom_args: { override_route: true }
            }
        }
    });

    assert.equal(result, 'vision routing response');
    assert.equal(calls.length, 1);
    assertRoute(calls[0], {
        endpoint: 'https://override.example.invalid/v1/chat/completions',
        model: 'override-vision-model',
        apiKey: 'override-key',
        routeHeader: 'override',
        includesPayload: ['main_route', 'override_route'],
        excludesPayload: ['multimodal_route']
    });
});

test('a false model override restores multimodal routing, then overrides that routing configuration', { concurrency: false }, async () => {
    const { result, calls } = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: true }),
        metadataLabel: 'vision_override_disabled',
        aiModelOverrides: {
            textProfile: {
                prompts: ['vision_override_disabled'],
                has_vision: false,
                endpoint: 'https://override.example.invalid/v1/chat/completions',
                apiKey: 'override-key',
                model: 'override-text-model',
                headers: { 'X-Route': 'override' },
                custom_args: { override_route: true }
            }
        }
    });

    assert.equal(result, 'vision routing response');
    assert.equal(calls.length, 1);
    assertRoute(calls[0], {
        endpoint: 'https://override.example.invalid/v1/chat/completions',
        model: 'override-text-model',
        apiKey: 'override-key',
        routeHeader: 'override',
        includesPayload: ['multimodal_route', 'override_route'],
        excludesPayload: ['main_route']
    });
});

test('preferred dedicated multimodal routing ignores a false-vision override transport', { concurrency: false }, async () => {
    const { result, calls } = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: true }),
        metadataLabel: 'generate_seasonal_image_vision',
        preferDedicatedMultimodalConfiguration: true,
        aiModelOverrides: {
            textProfile: {
                prompts: ['generate_seasonal_image_vision'],
                has_vision: false,
                endpoint: 'https://override.example.invalid/v1/chat/completions',
                apiKey: 'override-key',
                model: 'override-text-model',
                headers: { 'X-Route': 'override' },
                custom_args: { override_route: true }
            }
        }
    });

    assert.equal(result, 'vision routing response');
    assert.equal(calls.length, 1);
    assertRoute(calls[0], {
        endpoint: 'https://multimodal.example.invalid/v1/chat/completions',
        model: 'multimodal-model',
        apiKey: 'multimodal-key',
        routeHeader: 'multimodal',
        includesPayload: ['multimodal_route'],
        excludesPayload: ['main_route', 'override_route']
    });
});

test('a partial dedicated vision profile keeps root connection settings and ignores false-vision override transport', { concurrency: false }, async () => {
    const { result, calls } = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: true }),
        aiMultimodal: { enabled: true, model: 'vision-model' },
        metadataLabel: 'generate_seasonal_image_vision',
        preferDedicatedMultimodalConfiguration: true,
        aiModelOverrides: {
            nonVisionProfile: {
                prompts: ['generate_seasonal_image_vision'],
                has_vision: false,
                backend: 'codex_cli_bridge',
                endpoint: 'https://override.example.invalid/v1/chat/completions',
                apiKey: 'override-key',
                model: 'override-text-model',
                headers: { 'X-Route': 'override' },
                custom_args: { override_route: true }
            }
        }
    });

    assert.equal(result, 'vision routing response');
    assert.equal(calls.length, 1);
    assertRoute(calls[0], {
        endpoint: 'https://main.example.invalid/v1/chat/completions',
        model: 'vision-model',
        apiKey: 'main-key',
        routeHeader: 'main',
        includesPayload: ['main_route'],
        excludesPayload: ['override_route']
    });
});

test('disabled and missing ai_multimodal configurations remain unavailable when effective has_vision is not true', { concurrency: false }, async () => {
    const disabled = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: false }),
        aiMultimodal: buildMultimodalConfig({ enabled: false })
    });
    assert.equal(disabled.result, '');
    assert.equal(disabled.calls.length, 0);

    const missing = await captureMultimodalRequest({
        ai: buildAiConfig({ has_vision: false }),
        aiMultimodal: null
    });
    assert.equal(missing.result, '');
    assert.equal(missing.calls.length, 0);
});

test('multimodal cassette replay rejects a changed root has_vision routing value', { concurrency: false }, async () => {
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRecordFile = process.env.LLM_RECORD_OUTPUTS_FILE;
    const originalForceFile = process.env.LLM_FORCE_OUTPUTS_FILE;
    const baseDir = makeTempBaseDir();
    const cassettePath = path.join(baseDir, 'vision-routing-cassette.json');
    let networkCalls = 0;

    Globals.baseDir = baseDir;
    Globals.config = {
        ai: buildAiConfig({ has_vision: false }),
        ai_multimodal: buildMultimodalConfig()
    };
    delete process.env.LLM_FORCE_OUTPUTS_FILE;
    process.env.LLM_RECORD_OUTPUTS_FILE = cassettePath;
    LLMClient.resetForcedOutputState();
    axios.post = async (_endpoint, payload) => {
        networkCalls += 1;
        return {
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {},
            data: {
                id: 'vision-cassette-response',
                object: 'chat.completion',
                model: payload.model,
                choices: [{
                    index: 0,
                    finish_reason: 'stop',
                    message: { role: 'assistant', content: 'recorded vision response' }
                }]
            }
        };
    };
    const requestOptions = {
        messages: [{ role: 'user', content: 'Record this multimodal request.' }],
        metadataLabel: 'vision_cassette_test',
        multimodal: true,
        validateXML: false,
        output: 'silent',
        retryAttempts: 0
    };

    try {
        assert.equal(await LLMClient.chatCompletion(requestOptions), 'recorded vision response');
        assert.equal(networkCalls, 1);
        LLMClient.completeCompletionCassetteRecording();

        delete process.env.LLM_RECORD_OUTPUTS_FILE;
        process.env.LLM_FORCE_OUTPUTS_FILE = cassettePath;
        Globals.config.ai.has_vision = true;
        LLMClient.resetForcedOutputState();
        axios.post = async () => {
            throw new Error('Cassette mismatch must prevent network transport.');
        };

        await assert.rejects(
            () => LLMClient.chatCompletion(requestOptions),
            /Completion cassette mismatch at ordinal 1/
        );
        assert.equal(networkCalls, 1);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        if (originalRecordFile === undefined) {
            delete process.env.LLM_RECORD_OUTPUTS_FILE;
        } else {
            process.env.LLM_RECORD_OUTPUTS_FILE = originalRecordFile;
        }
        if (originalForceFile === undefined) {
            delete process.env.LLM_FORCE_OUTPUTS_FILE;
        } else {
            process.env.LLM_FORCE_OUTPUTS_FILE = originalForceFile;
        }
        LLMClient.resetForcedOutputState();
    }
});
