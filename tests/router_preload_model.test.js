const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const yaml = require('js-yaml');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function buildConfig(overrides = {}) {
    return {
        unload_model_on_switch: false,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'http://router.example:8080/v1',
            apiKey: 'test-key',
            model: 'main-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true
        },
        ...overrides
    };
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

test('router_preload_model defaults to null and falls back to ai.model', () => {
    const defaultConfig = yaml.load(fs.readFileSync(
        path.join(__dirname, '..', 'config.default.yaml'),
        'utf8'
    ));

    assert.equal(defaultConfig.router_preload_model, null);
    assert.equal(LLMClient.resolveRouterPreloadModel(buildConfig()), 'main-model');
    assert.equal(
        LLMClient.resolveRouterPreloadModel(buildConfig({ router_preload_model: ' preload-model ' })),
        'preload-model'
    );
    assert.throws(
        () => LLMClient.resolveRouterPreloadModel(buildConfig({ router_preload_model: 42 })),
        /router_preload_model must be a string/
    );
});

test('router preload activation follows explicit configuration and router lifecycle settings', () => {
    assert.equal(LLMClient.shouldPreloadRouterModel(buildConfig()), false);
    assert.equal(
        LLMClient.shouldPreloadRouterModel(buildConfig({ router_preload_model: 'preload-model' })),
        true
    );
    assert.equal(
        LLMClient.shouldPreloadRouterModel(buildConfig({ unload_model_on_switch: true })),
        true
    );
    assert.equal(
        LLMClient.shouldPreloadRouterModel(buildConfig({
            ai: {
                ...buildConfig().ai,
                unload_during_image_generation: true
            }
        })),
        true
    );
});

test('preloaded router model becomes the initial model-switch target', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalGet = axios.get;
    const originalPost = axios.post;
    const events = [];
    const statuses = new Map([
        ['preload-model', 'loaded'],
        ['main-model', 'unloaded']
    ]);
    const config = buildConfig({
        unload_model_on_switch: true,
        router_preload_model: 'preload-model'
    });

    Globals.config = config;
    LLMClient.resetModelSwitchTracking();
    axios.get = async () => {
        events.push('status');
        return {
            data: {
                data: Array.from(statuses, ([id, value]) => ({
                    id,
                    status: { value }
                }))
            }
        };
    };
    axios.post = async (url, payload) => {
        if (url.endsWith('/models/unload')) {
            events.push(`unload:${payload.model}`);
            statuses.set(payload.model, 'unloaded');
            return { data: { success: true } };
        }
        events.push(`prompt:${payload.model}`);
        statuses.set(payload.model, 'loaded');
        return responseFor(payload);
    };

    try {
        const preloadResult = await LLMClient.preloadRouterModel({
            configOverride: config,
            createRouterClient: target => ({
                loadModelIfNeeded: async () => {
                    events.push(`preload:${target.model}`);
                    return { loadedByClient: false, initialStatus: 'loaded' };
                }
            }),
            logger: { log: () => {} }
        });
        assert.equal(preloadResult.target.model, 'preload-model');

        await LLMClient.chatCompletion({
            messages: [{ role: 'user', content: 'start' }],
            metadataLabel: 'router_preload_first_prompt',
            validateXML: false,
            output: 'silent'
        });

        assert.deepEqual(events, [
            'preload:preload-model',
            'status',
            'unload:preload-model',
            'status',
            'prompt:main-model'
        ]);
    } finally {
        LLMClient.resetModelSwitchTracking();
        axios.get = originalGet;
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('server preloads the router before default-player prompt generation', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const startupSource = source.slice(source.indexOf('async function startServer()'));
    const preloadIndex = startupSource.indexOf('await LLMClient.preloadRouterModel');
    const defaultPlayerIndex = startupSource.indexOf('createDefaultPlayer();');

    assert.ok(preloadIndex >= 0, 'startServer must preload the router');
    assert.ok(defaultPlayerIndex > preloadIndex, 'default-player generation must start after router preload');
});

test('qwen combo router startup keeps configured Qwen and Gemma workers text-only', () => {
    const wrapper = fs.readFileSync(
        path.join(__dirname, '..', 'scripts', 'start-qwen-combo-router.sh'),
        'utf8'
    );
    const preset = fs.readFileSync(
        path.join(__dirname, '..', 'config', 'llama-qwen-combo-text-only.ini'),
        'utf8'
    );

    assert.match(wrapper, /--no-mmproj/);
    assert.match(wrapper, /router_context_size="\$\{LLAMA_CTX_SIZE:-96000\}"/);
    assert.doesNotMatch(wrapper, /--n-gpu-layers\s+99/);
    assert.match(wrapper, /--models-preset \/home\/bart\/ai_rpg\/config\/llama-qwen-combo-text-only\.ini/);
    assert.match(preset, /\[\*\]\s+n-gpu-layers\s*=\s*99(?:\r?\n|$)/);
    assert.match(
        preset,
        /\[Qwen3\.6-27B-Fable-Fusion-711-Uncensored-Heretic-NM-DAU-NEO-MAX-MTP-GGUF\]\s+mmproj\s*=\s*(?:\r?\n|$)/
    );
    assert.match(
        preset,
        /\[Qwen3\.6-35B-A3B-uncensored-heretic-Native-MTP-Preserved-GGUF\]\s+mmproj\s*=\s*(?:\r?\n|$)/
    );
    for (const model of [
        'G4-MeroMero-31B-uncensored-heretic-GGUF',
        'Gemma-4-Garnet-31B-it-uncensored-heretic-GGUF',
        'gemma-4-31B-it-Mystery-Fine-Tune-HERETIC-UNCENSORED-Thinking-Instruct-GGUF',
        'gemma-4-31B-it-qat-q4_0-uncensored-heretic-GGUF',
        'gemma-4-Ortenzya-The-Creative-Wordsmith-31B-it-uncensored-heretic-GGUF'
    ]) {
        const escapedModel = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(
            preset,
            new RegExp(`\\[${escapedModel}\\]\\s+mmproj\\s*=\\s*(?:\\r?\\n|$)`)
        );
    }
    assert.match(
        preset,
        /\[Gemma-4-Garnet-31B-it-uncensored-heretic-GGUF\]\s+mmproj\s*=\s*\r?\n+n-gpu-layers\s*=\s*40(?:\r?\n|$)/
    );
});
