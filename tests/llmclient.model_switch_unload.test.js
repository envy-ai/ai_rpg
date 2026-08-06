const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const yaml = require('js-yaml');
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

function buildConfig({ enabled = true } = {}) {
    return {
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
    assert.equal(LLMClient.resolveUnloadModelOnSwitch({}), false);
    assert.throws(
        () => LLMClient.resolveUnloadModelOnSwitch({ unload_model_on_switch: 'yes' }),
        /unload_model_on_switch must be a boolean/
    );
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
