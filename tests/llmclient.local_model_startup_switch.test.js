const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function buildConfig() {
    return {
        unload_model_on_switch: false,
        max_concurrent_requests_all_models: 2,
        ai: {
            backend: 'openai_compatible',
            endpoint: 'http://local.example:5005/v1',
            apiKey: 'test-key',
            model: 'base-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 2,
            suppress_seed: true,
            terminate_during_image_generation: true,
            local_startup_script_path: '/tmp/start-base.sh'
        },
        ai_model_overrides: {
            prose: {
                prompts: ['player_action'],
                model: 'prose-model',
                local_startup_script_path: '/tmp/start-prose.sh'
            }
        }
    };
}

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

async function runPrompt(metadataLabel) {
    return LLMClient.chatCompletion({
        messages: [{ role: 'user', content: metadataLabel }],
        metadataLabel,
        validateXML: false,
        output: 'silent'
    });
}

test('managed local prompts switch startup scripts before transport and reuse an unchanged script', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    const events = [];
    let activeStartupScriptPath = '/tmp/start-base.sh';

    Globals.config = buildConfig();
    LLMClient.setManagedLocalModelStartupHandler(async ({ startupScriptPath }) => {
        if (startupScriptPath === activeStartupScriptPath) {
            return { switched: false, startupScriptPath };
        }
        events.push(`stop:${activeStartupScriptPath}`);
        activeStartupScriptPath = startupScriptPath;
        events.push(`start:${activeStartupScriptPath}`);
        return { switched: true, startupScriptPath };
    });
    axios.post = async (_url, payload) => {
        events.push(`prompt:${payload.model}`);
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
    };

    try {
        await runPrompt('base_prompt');
        await runPrompt('base_prompt');
        await runPrompt('player_action');
        await runPrompt('player_action');
        await runPrompt('base_prompt');

        assert.deepEqual(events, [
            'prompt:base-model',
            'prompt:base-model',
            'stop:/tmp/start-base.sh',
            'start:/tmp/start-prose.sh',
            'prompt:prose-model',
            'prompt:prose-model',
            'stop:/tmp/start-prose.sh',
            'start:/tmp/start-base.sh',
            'prompt:base-model'
        ]);
    } finally {
        LLMClient.setManagedLocalModelStartupHandler(null);
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('managed local startup-switch failure prevents prompt transport', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    let transportCalled = false;

    Globals.config = buildConfig();
    LLMClient.setManagedLocalModelStartupHandler(async () => {
        throw new Error('replacement process did not become ready');
    });
    axios.post = async () => {
        transportCalled = true;
        throw new Error('transport must not run');
    };

    try {
        await assert.rejects(
            () => runPrompt('player_action'),
            /Failed to prepare managed local llama\.cpp.*replacement process did not become ready/
        );
        assert.equal(transportCalled, false);
    } finally {
        LLMClient.setManagedLocalModelStartupHandler(null);
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});

test('managed local startup switching waits for the active old-model transport', { concurrency: false }, async () => {
    const originalConfig = Globals.config;
    const originalPost = axios.post;
    const firstTransport = deferred();
    const events = [];
    let activeStartupScriptPath = '/tmp/start-base.sh';

    Globals.config = buildConfig();
    LLMClient.setManagedLocalModelStartupHandler(async ({ startupScriptPath }) => {
        if (startupScriptPath !== activeStartupScriptPath) {
            events.push(`switch:${activeStartupScriptPath}->${startupScriptPath}`);
            activeStartupScriptPath = startupScriptPath;
        }
    });
    axios.post = async (_url, payload) => {
        events.push(`prompt-start:${payload.model}`);
        if (payload.model === 'base-model') {
            await firstTransport.promise;
        }
        events.push(`prompt-end:${payload.model}`);
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
    };

    try {
        const basePrompt = runPrompt('base_prompt');
        await flushTurn();
        const prosePrompt = runPrompt('player_action');
        await flushTurn();
        assert.deepEqual(events, ['prompt-start:base-model']);

        firstTransport.resolve();
        await Promise.all([basePrompt, prosePrompt]);
        assert.deepEqual(events, [
            'prompt-start:base-model',
            'prompt-end:base-model',
            'switch:/tmp/start-base.sh->/tmp/start-prose.sh',
            'prompt-start:prose-model',
            'prompt-end:prose-model'
        ]);
    } finally {
        firstTransport.resolve();
        LLMClient.setManagedLocalModelStartupHandler(null);
        axios.post = originalPost;
        Globals.config = originalConfig;
    }
});
