const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const yaml = require('js-yaml');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const LlamaCppRouterClient = require('../LlamaCppRouterClient.js');

const SLOT_CACHE_TEST_DIRECTORY = path.join(__dirname, '..', 'tmp', 'llama-slot-cache-tests');

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

function buildConfig({ enabled = true, local = false } = {}) {
    const config = {
        unload_model_on_switch: enabled,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'http://router.example:8080/v1',
            apiKey: 'test-key',
            model: 'base-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 2,
            supress_seed: true
        },
        ai_model_overrides: {
            alternate: {
                prompts: ['alternate_prompt'],
                model: 'alternate-model'
            }
        }
    };
    if (local) {
        config.ai.local_startup_script_path = '/fake/start-router.sh';
        config.ai.router_slot_cache_directory = SLOT_CACHE_TEST_DIRECTORY;
    }
    return config;
}

function slotCachePath(model) {
    return path.join(
        SLOT_CACHE_TEST_DIRECTORY,
        LlamaCppRouterClient.buildSlotCacheFilename(model)
    );
}

function removeSlotCacheIfPresent(model) {
    const cachePath = slotCachePath(model);
    if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
    }
}

async function runPrompt(metadataLabel, text = metadataLabel) {
    return LLMClient.chatCompletion({
        messages: [{ role: 'user', content: text }],
        metadataLabel,
        validateXML: false,
        output: 'silent'
    });
}

test('unload_model_on_switch defaults off and rejects non-boolean values', () => {
    const defaultConfig = yaml.load(fs.readFileSync(
        path.join(__dirname, '..', 'config.default.yaml'),
        'utf8'
    ));
    assert.equal(defaultConfig.unload_model_on_switch, false);
    assert.equal(defaultConfig.ai.router_slot_cache_directory, '/dev/shm');
    assert.equal(LLMClient.resolveUnloadModelOnSwitch({}), false);
    assert.equal(LLMClient.resolveRouterSlotCacheDirectory({}), '/dev/shm');
    assert.throws(
        () => LLMClient.resolveUnloadModelOnSwitch({ unload_model_on_switch: 'yes' }),
        /unload_model_on_switch must be a boolean/
    );
    assert.throws(
        () => LLMClient.resolveRouterSlotCacheDirectory({ router_slot_cache_directory: 'relative' }),
        /must be a nonblank absolute path/
    );
});

test('managed local router switches save, unload, load, restore, and delete in order', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalGet = axios.get;
    const originalPost = axios.post;
    const events = [];
    const statuses = new Map([
        ['base-model', 'unloaded'],
        ['alternate-model', 'unloaded']
    ]);
    fs.mkdirSync(SLOT_CACHE_TEST_DIRECTORY, { recursive: true });
    removeSlotCacheIfPresent('base-model');
    removeSlotCacheIfPresent('alternate-model');

    Globals.config = buildConfig({ local: true });
    LLMClient.resetModelSwitchTracking();
    axios.get = async () => ({
        data: {
            data: Array.from(statuses, ([id, value]) => ({ id, status: { value } }))
        }
    });
    axios.post = async (url, payload) => {
        if (url.includes('/slots/0?action=save')) {
            events.push(`save:${payload.model}`);
            fs.writeFileSync(slotCachePath(payload.model), `cache:${payload.model}`);
            return { data: { id_slot: 0, filename: payload.filename, n_saved: 1 } };
        }
        if (url.endsWith('/models/unload')) {
            events.push(`unload:${payload.model}`);
            statuses.set(payload.model, 'unloaded');
            return { data: { success: true } };
        }
        if (url.endsWith('/models/load')) {
            events.push(`load:${payload.model}`);
            statuses.set(payload.model, 'loaded');
            return { data: { success: true } };
        }
        if (url.includes('/slots/0?action=restore')) {
            events.push(`restore:${payload.model}`);
            return { data: { id_slot: 0, filename: payload.filename, n_restored: 1 } };
        }
        events.push(`prompt:${payload.model}`);
        statuses.set(payload.model, 'loaded');
        return responseFor(payload);
    };

    try {
        await runPrompt('base_prompt');
        await runPrompt('alternate_prompt');
        assert.equal(fs.existsSync(slotCachePath('base-model')), true);

        await runPrompt('base_prompt');

        assert.deepEqual(events, [
            'prompt:base-model',
            'save:base-model',
            'unload:base-model',
            'load:alternate-model',
            'prompt:alternate-model',
            'save:alternate-model',
            'unload:alternate-model',
            'load:base-model',
            'restore:base-model',
            'prompt:base-model'
        ]);
        assert.equal(fs.existsSync(slotCachePath('base-model')), false);
        assert.equal(fs.existsSync(slotCachePath('alternate-model')), true);
    } finally {
        removeSlotCacheIfPresent('base-model');
        removeSlotCacheIfPresent('alternate-model');
        LLMClient.resetModelSwitchTracking();
        axios.get = originalGet;
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('managed local router cache save and restore failures warn without blocking the prompt', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalWarn = console.warn;
    const warnings = [];
    const events = [];
    const statuses = new Map([
        ['base-model', 'unloaded'],
        ['alternate-model', 'unloaded']
    ]);
    fs.mkdirSync(SLOT_CACHE_TEST_DIRECTORY, { recursive: true });
    removeSlotCacheIfPresent('base-model');
    removeSlotCacheIfPresent('alternate-model');
    fs.writeFileSync(slotCachePath('alternate-model'), 'previous alternate cache');

    Globals.config = buildConfig({ local: true });
    LLMClient.resetModelSwitchTracking();
    console.warn = message => warnings.push(message);
    axios.get = async () => ({
        data: {
            data: Array.from(statuses, ([id, value]) => ({ id, status: { value } }))
        }
    });
    axios.post = async (url, payload) => {
        if (url.includes('/slots/0?action=save')) {
            events.push(`save-failed:${payload.model}`);
            const error = new Error('save rejected');
            error.response = { status: 500, data: { error: 'save rejected' } };
            throw error;
        }
        if (url.endsWith('/models/unload')) {
            events.push(`unload:${payload.model}`);
            statuses.set(payload.model, 'unloaded');
            return { data: { success: true } };
        }
        if (url.endsWith('/models/load')) {
            events.push(`load:${payload.model}`);
            statuses.set(payload.model, 'loaded');
            return { data: { success: true } };
        }
        if (url.includes('/slots/0?action=restore')) {
            events.push(`restore-failed:${payload.model}`);
            const error = new Error('restore rejected');
            error.response = { status: 500, data: { error: 'restore rejected' } };
            throw error;
        }
        events.push(`prompt:${payload.model}`);
        statuses.set(payload.model, 'loaded');
        return responseFor(payload);
    };

    try {
        await runPrompt('base_prompt');
        await runPrompt('alternate_prompt');

        assert.deepEqual(events, [
            'prompt:base-model',
            'save-failed:base-model',
            'unload:base-model',
            'load:alternate-model',
            'restore-failed:alternate-model',
            'prompt:alternate-model'
        ]);
        assert.equal(warnings.length, 2);
        assert.match(warnings[0], /Failed to save llama\.cpp context cache.*continuing model switch/);
        assert.match(warnings[1], /Failed to restore llama\.cpp context cache.*continuing without it/);
        assert.equal(fs.existsSync(slotCachePath('alternate-model')), true);
    } finally {
        removeSlotCacheIfPresent('base-model');
        removeSlotCacheIfPresent('alternate-model');
        console.warn = originalWarn;
        LLMClient.resetModelSwitchTracking();
        axios.get = originalGet;
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('a switched prompt unloads the previous effective model before transport', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalGet = axios.get;
    const originalPost = axios.post;
    const events = [];
    const statuses = new Map([
        ['base-model', 'loaded'],
        ['alternate-model', 'unloaded']
    ]);

    Globals.config = buildConfig();
    LLMClient.resetModelSwitchTracking();
    axios.get = async (url) => {
        events.push(`status:${url}`);
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
        await runPrompt('base_prompt_1');
        await runPrompt('base_prompt_2');
        await runPrompt('alternate_prompt');

        assert.deepEqual(events, [
            'prompt:base-model',
            'prompt:base-model',
            'status:http://router.example:8080/models',
            'unload:base-model',
            'status:http://router.example:8080/models',
            'prompt:alternate-model'
        ]);
    } finally {
        LLMClient.resetModelSwitchTracking();
        axios.get = originalGet;
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('model switching waits for the previous prompt transport to finish', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalGet = axios.get;
    const originalPost = axios.post;
    const firstTransport = deferred();
    const events = [];
    const statuses = new Map([
        ['base-model', 'loaded'],
        ['alternate-model', 'unloaded']
    ]);

    Globals.config = buildConfig();
    LLMClient.resetModelSwitchTracking();
    axios.get = async () => {
        events.push('status');
        return {
            data: {
                data: Array.from(statuses, ([id, value]) => ({ id, status: { value } }))
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
        if (payload.model === 'base-model') {
            await firstTransport.promise;
        }
        statuses.set(payload.model, 'loaded');
        return responseFor(payload);
    };

    try {
        const first = runPrompt('base_prompt');
        await flushTurn();
        assert.deepEqual(events, ['prompt:base-model']);

        const second = runPrompt('alternate_prompt');
        await flushTurn();
        assert.deepEqual(events, ['prompt:base-model']);

        firstTransport.resolve();
        await Promise.all([first, second]);
        assert.deepEqual(events, [
            'prompt:base-model',
            'status',
            'unload:base-model',
            'status',
            'prompt:alternate-model'
        ]);
    } finally {
        firstTransport.resolve();
        LLMClient.resetModelSwitchTracking();
        axios.get = originalGet;
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('model-switch unload failure prevents the replacement prompt', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalGet = axios.get;
    const originalPost = axios.post;
    const promptModels = [];

    Globals.config = buildConfig();
    LLMClient.resetModelSwitchTracking();
    axios.get = async () => ({
        data: {
            data: [
                { id: 'base-model', status: { value: 'loaded' } },
                { id: 'alternate-model', status: { value: 'unloaded' } }
            ]
        }
    });
    axios.post = async (url, payload) => {
        if (url.endsWith('/models/unload')) {
            const error = new Error('router rejected unload');
            error.response = { status: 500, data: { error: 'busy' } };
            throw error;
        }
        promptModels.push(payload.model);
        return responseFor(payload);
    };

    try {
        await runPrompt('base_prompt');
        await assert.rejects(
            () => runPrompt('alternate_prompt'),
            /Failed to unload previous llama\.cpp model "base-model".*busy/
        );
        assert.deepEqual(promptModels, ['base-model']);
    } finally {
        LLMClient.resetModelSwitchTracking();
        axios.get = originalGet;
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});
