'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    usesLocalLlamaCppEndpoint,
    listAdvertisedLocalLlamaModels
} = require('../LocalLlamaModelOptions.js');

test('recognizes local OpenAI-compatible llama endpoints only', () => {
    assert.equal(usesLocalLlamaCppEndpoint({ backend: 'openai_compatible', endpoint: 'http://127.0.0.1:5005/v1' }), true);
    assert.equal(usesLocalLlamaCppEndpoint({ backend: 'openai_compatible', endpoint: 'http://localhost:8080/v1/chat/completions' }), true);
    assert.equal(usesLocalLlamaCppEndpoint({ backend: 'openai_compatible', endpoint: 'https://nano-gpt.com/api/v1' }), false);
    assert.equal(usesLocalLlamaCppEndpoint({
        backend: 'openai_compatible',
        endpoint: 'http://192.168.50.8:5005/v1',
        local_startup_script_path: './scripts/start-router.sh'
    }), true);
    assert.equal(usesLocalLlamaCppEndpoint({ backend: 'codex_cli_bridge', endpoint: 'http://127.0.0.1:5005/v1' }), false);
});

test('returns unique nonblank model ids advertised by local llama.cpp', async () => {
    const calls = [];
    const models = await listAdvertisedLocalLlamaModels({
        backend: 'openai_compatible',
        endpoint: 'http://127.0.0.1:5005/v1/chat/completions',
        model: 'configured',
        apiKey: 'test-key',
        headers: { Authorization: 'Bearer test' }
    }, {
        httpClient: {
            async get(url, options) {
                calls.push({ url, options });
                return { data: { data: [{ id: 'alpha' }, { id: 'beta' }, { id: 'alpha' }, { id: ' ' }, {}] } };
            },
            async post() {
                throw new Error('not used');
            }
        },
        logger: { warn() {} }
    });

    assert.deepEqual(models, ['alpha', 'beta']);
    assert.equal(calls[0].url, 'http://127.0.0.1:5005/models');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test');
});

test('uses the configured API key when custom headers omit authorization', async () => {
    let requestHeaders = null;
    await listAdvertisedLocalLlamaModels({
        backend: 'openai_compatible',
        endpoint: 'http://localhost:5005/v1',
        model: 'configured',
        apiKey: 'local-secret'
    }, {
        httpClient: {
            async get(_url, options) {
                requestHeaders = options.headers;
                return { data: { data: [] } };
            },
            async post() {
                throw new Error('not used');
            }
        },
        logger: { warn() {} }
    });
    assert.equal(requestHeaders.Authorization, 'Bearer local-secret');
});

test('refuses to query remote model catalogs through the local-only helper', async () => {
    await assert.rejects(
        listAdvertisedLocalLlamaModels({
            backend: 'openai_compatible',
            endpoint: 'https://example.com/v1',
            model: 'remote'
        }),
        /only be queried from a local/
    );
});
