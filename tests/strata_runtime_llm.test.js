const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const path = require('node:path');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

function config() {
    return { unload_model_on_switch: false, max_concurrent_requests_all_models: 1, ai: { backend: 'openai_compatible', endpoint: 'http://strata.test:8080/v1', apiKey: 'none', model: 'model-1', stream: false, retryAttempts: 0, max_concurrent_requests: 1, suppress_seed: true, strata_runtime: { executable: '/fake/strata', profile: 'profile', resources: { memory_max_mib: 90112, memlock_mib: 98304, shm_size_mib: 61440 } } } };
}
const complete = () => LLMClient.chatCompletion({ messages: [{ role: 'user', content: 'Test' }], metadataLabel: 'fixture', validateXML: false, output: 'silent' });

test('LLM transport verifies managed Strata before sending and fails closed on readiness error', async () => {
    const old = { config: Globals.config, baseDir: Globals.baseDir, post: axios.post };
    Globals.baseDir = path.join(__dirname, '..', 'tmp', 'strata-runtime-llm');
    const events = [];
    Globals.config = config();
    axios.post = async (_url, payload) => { events.push('transport'); return { status: 200, data: { model: payload.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }] } }; };
    try {
        LLMClient.setManagedStrataRuntimeHandler(async ({ target, endpoint, model, allowRamStandby }) => {
            events.push('verify');
            assert.equal(target.profile, 'profile');
            assert.match(endpoint, /^http:\/\/strata\.test:8080\/v1/);
            assert.equal(model, 'model-1');
            assert.equal(allowRamStandby, false);
        });
        assert.equal(await complete(), 'ok');
        assert.deepEqual(events, ['verify', 'transport']);
        events.length = 0;
        LLMClient.setManagedStrataRuntimeHandler(async () => { events.push('verify'); throw new Error('owner mismatch'); });
        await assert.rejects(complete(), /owner mismatch/);
        assert.deepEqual(events, ['verify']);
    } finally {
        LLMClient.setManagedStrataRuntimeHandler(null);
        Globals.config = old.config;
        Globals.baseDir = old.baseDir;
        axios.post = old.post;
    }
});
