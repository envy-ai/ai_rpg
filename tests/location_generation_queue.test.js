'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const axios = require('axios');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function extract(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Missing location helper ${start}`);
    return source.slice(from, to);
}
const population = new Function('LLMClient', `${extract('async function runLocationPopulationTasks(', '\nasync function generateOwnedLocationThingsForLocation(')}; return runLocationPopulationTasks;`)(LLMClient);

test('unowned location population starts both independent branches without serializing', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const order = [];
    const pending = population(async () => { order.push('things-start'); await gate; order.push('things-end'); return 'things'; },
        async () => { order.push('npc-start'); return 'npc'; });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['things-start', 'npc-start']);
    release();
    assert.deepEqual(await pending, ['things', 'npc']);
});

for (const failure of [false, true]) test(`native standard location wrapper retains roster, retry, family, expansion and naming through ${failure ? 'failure' : 'completion'}`, { concurrency: false, timeout: 15000 }, async () => {
    const oldConfig = Globals.config, oldPost = axios.post;
    const order = [];
    let start, release;
    const started = new Promise(resolve => { start = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const terminal = new Error('fixture cancelled'); terminal.code = 'PROMPT_CANCELLED';
    Globals.config = { ...(oldConfig || {}), max_concurrent_requests_all_models: 1,
        ai: { ...(oldConfig?.ai || {}), backend: 'openai_compatible', endpoint: 'https://example.invalid', apiKey: 'fixture', model: `standard-location-${failure}`, max_concurrent_requests: 1, stream: false, retryAttempts: 0, supress_seed: true } };
    axios.post = async (_url, payload) => {
        const stage = payload.messages.at(-1).content;
        order.push(stage);
        if (stage === 'roster') { start(); await gate; }
        return { status: 200, data: { model: payload.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: stage } }] } };
    };
    const complete = stage => LLMClient.chatCompletion({ messages: [{ role: 'user', content: stage }], metadataLabel: 'location_things_generation', validateXML: false, throwOnError: true, retryAttempts: 0, output: 'silent' });
    const wrapper = new Function('LLMClient', 'generateOwnedLocationThingsForLocation', `${extract('async function generateLocationThingsForLocation(', '\nasync function runLocationPopulationTasks(')}; return generateLocationThingsForLocation;`)(LLMClient, async () => {
        await complete('roster');
        await complete('roster-retry');
        await complete('family');
        if (failure) throw terminal;
        await complete('expansion');
        await complete('canonicalization');
    });
    try {
        const generation = wrapper({ location: { id: 'fixture' } });
        const outcome = generation.then(() => null, error => error);
        await started;
        const competitor = complete('competitor');
        await new Promise(resolve => setImmediate(resolve));
        release();
        assert.equal(await outcome, failure ? terminal : null);
        await competitor;
        assert.deepEqual(order, failure ? ['roster', 'roster-retry', 'family', 'competitor'] : ['roster', 'roster-retry', 'family', 'expansion', 'canonicalization', 'competitor']);
    } finally { release(); Globals.config = oldConfig; axios.post = oldPost; }
});
