const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const LLMClient = require('../LLMClient.js');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('async function runNpcInventoryTasks(');
const end = source.indexOf('\nasync function generateOwnedInventoryForCharacter(', start);
assert.ok(start >= 0 && end > start, 'NPC inventory task helper must be available');
const context = { LLMClient, Promise };
vm.createContext(context);
vm.runInContext(`${source.slice(start, end)}\nthis.run = runNpcInventoryTasks;`, context);

test('sibling inventory programs retain their shared parent through all stages', { timeout: 5000 }, async () => {
    const events = [];
    const task = name => async () => {
        for (const stage of ['roster', 'family', 'expansion', 'correction']) {
            events.push(`${name} ${stage}`);
            await Promise.resolve();
        }
        return name;
    };
    await LLMClient.withPromptQueueReservation(reservation => LLMClient.withPromptQueueReservationNested(reservation, async () => {
        const prerequisite = Promise.resolve().then(() => events.push('prerequisite'));
        const results = await context.run([task('first'), task('second')], [prerequisite]);
        assert.deepEqual(Array.from(results), ['first', 'second']);
    }));
    assert.deepEqual(events, ['prerequisite', 'first roster', 'first family', 'first expansion', 'first correction', 'second roster', 'second family', 'second expansion', 'second correction']);
});

test('independent inventory programs start concurrently and parent ownership survives failure', { timeout: 5000 }, async () => {
    const started = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const running = context.run(['first', 'second'].map(name => async () => { started.push(name); await gate; }));
    await Promise.resolve();
    assert.deepEqual(started, ['first', 'second']);
    release();
    await running;
    await LLMClient.withPromptQueueReservation(reservation => LLMClient.withPromptQueueReservationNested(reservation, async () => {
        await assert.rejects(context.run([async () => { throw new Error('cancel inventory'); }]), /cancel inventory/);
        assert.equal(LLMClient.hasPromptQueueReservation(), true);
        assert.deepEqual(Array.from(await context.run([async () => 'next'])), ['next']);
    }));
    assert.equal(LLMClient.hasPromptQueueReservation(), false);
});

test('complete inventory operation retains the native queue until its final stage and releases on failure', { concurrency: false, timeout: 10000 }, async () => {
    const axios = require('axios');
    const Globals = require('../Globals.js');
    const oldConfig = Globals.config, oldPost = axios.post;
    const labels = [];
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { started = resolve; });
    Globals.config = { max_concurrent_requests_all_models: 1, ai: { backend: 'openai_compatible', endpoint: 'https://example.invalid/v1/chat/completions', apiKey: 'test', model: 'inventory-ownership-test', stream: false, retryAttempts: 0, max_concurrent_requests: 1 } };
    axios.post = async (_url, payload) => {
        const label = payload.messages[0].content;
        labels.push(label);
        return { status: 200, data: { model: payload.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: label } }] } };
    };
    const request = label => LLMClient.chatCompletion({ messages: [{ role: 'user', content: label }], metadataLabel: 'inventory_ownership_test', validateXML: false, output: 'silent', retryAttempts: 0, throwOnError: true });
    const wrapperStart = source.indexOf('async function generateInventoryForCharacter(');
    const wrapperEnd = source.indexOf('\nasync function runNpcInventoryTasks(', wrapperStart);
    const wrapperContext = { LLMClient, generateOwnedInventoryForCharacter: async options => {
        await request('roster'); started(); await gate;
        if (options.fail) throw new Error('cancel inventory');
        await request('family'); await request('expansion');
    } };
    vm.runInNewContext(`${source.slice(wrapperStart, wrapperEnd)}\nthis.generate = generateInventoryForCharacter;`, wrapperContext);
    try {
        const inventory = wrapperContext.generate({});
        await ready;
        const competitor = request('competitor');
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(labels, ['roster']);
        release();
        await Promise.all([inventory, competitor]);
        assert.deepEqual(labels, ['roster', 'family', 'expansion', 'competitor']);
        await assert.rejects(wrapperContext.generate({ fail: true }), /cancel inventory/);
        await request('after failure');
        assert.equal(labels.at(-1), 'after failure');
    } finally { release(); Globals.config = oldConfig; axios.post = oldPost; }
});
