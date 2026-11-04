const test = require('node:test');
const assert = require('node:assert/strict');
const { ManagedLocalLlmController, registerLocalLlmControlRoutes } = require('../ManagedLocalLlmController.js');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness(kind = 'strata') {
    const events = []; let running = true, config = kind ? { kind } : null, gate = null;
    const controller = new ManagedLocalLlmController({ resolveConfiguration: () => config, inspect: async () => running, start: async () => { events.push('start'); running = true; }, stop: async () => { events.push('stop'); running = false; }, withExclusiveModelLifecycle: async task => { events.push('waiting'); if (gate) await gate.promise; events.push('exclusive'); return task(); } });
    return { controller, events, setRunning: value => { running = value; }, setConfig: value => { config = value; }, block: () => { gate = deferred(); return gate; } };
}

test('unconfigured controls stay hidden; off blocks prompts and explicit on reuses controller for both runtimes', async () => {
    const none = harness(null);
    assert.equal((await none.controller.getStatus()).configured, false);
    await assert.rejects(none.controller.setEnabled(true), /not configured/i);
    for (const kind of ['strata', 'llama']) {
        const h = harness(kind);
        assert.equal((await h.controller.getStatus()).state, 'running');
        const off = await h.controller.setEnabled(false);
        assert.equal(off.state, 'off'); assert.equal(off.desiredOn, false);
        assert.throws(() => h.controller.assertPromptAllowed(), /switched off/i);
        assert.deepEqual(h.events, ['waiting', 'exclusive', 'stop']);
        const on = await h.controller.setEnabled(true);
        assert.equal(on.state, 'running'); assert.equal(on.desiredOn, true);
        assert.doesNotThrow(() => h.controller.assertPromptAllowed());
        assert.deepEqual(h.events.slice(-3), ['waiting', 'exclusive', 'start']);
    }
});

test('exclusive gate reports waiting for active work and errors or exits never report green', async () => {
    const h = harness();
    const blocker = h.block();
    const stopping = h.controller.setEnabled(false);
    assert.equal((await h.controller.getStatus()).state, 'waiting');
    assert.throws(() => h.controller.assertPromptAllowed(), /switched off/i);
    blocker.resolve(); await stopping;
    h.controller.start = async () => { throw new Error('start failed'); };
    await assert.rejects(h.controller.setEnabled(true), /start failed/);
    const error = await h.controller.getStatus();
    assert.equal(error.state, 'error'); assert.match(error.error.stack, /start failed/);
    h.setRunning(false);
    assert.equal((await h.controller.getStatus()).state, 'error');
    const image = deferred();
    const active = h.controller.withActivity(() => image.promise);
    assert.equal((await h.controller.getStatus()).state, 'error');
    image.resolve(); await active;
});

test('local LLM control routes validate input and return error stack and snapshot', async () => {
    const h = harness(), handlers = {};
    registerLocalLlmControlRoutes({ get: (path, handler) => { handlers[`GET ${path}`] = handler; }, post: (path, handler) => { handlers[`POST ${path}`] = handler; } }, h.controller);
    const invoke = async (method, body) => {
        const out = { code: 200 }; const res = { status(code) { out.code = code; return this; }, json(value) { out.body = value; return this; } };
        await handlers[`${method} /api/local-llm`]({ body }, res); return out;
    };
    assert.equal((await invoke('GET')).body.state, 'running');
    for (const body of [{}, { enabled: 'false' }, { enabled: false, extra: true }]) assert.equal((await invoke('POST', body)).code, 400);
    h.controller.stop = async () => { throw new Error('stop failed'); };
    const failed = await invoke('POST', { enabled: false });
    assert.equal(failed.code, 500); assert.match(failed.body.stack, /stop failed/); assert.equal(failed.body.status.state, 'error');
});

test('a stale in-flight inspection cannot report green over a newly requested stop', async () => {
    const h = harness();
    const inspection = deferred();
    h.controller.inspect = () => inspection.promise;
    const status = h.controller.getStatus();
    const gate = h.block();
    const stopping = h.controller.setEnabled(false);
    inspection.resolve(true);
    const observed = await status;
    assert.notEqual(observed.state, 'running');
    assert.equal(observed.desiredOn, false);
    gate.resolve();
    h.controller.inspect = async () => false;
    await stopping;
});

test('manual off lets image jobs run without restarting either managed backend', async () => {
    const ImageGenerationModelLifecycle = require('../ImageGenerationModelLifecycle.js');
    for (const [kind, mode] of [['llama', 'terminate'], ['strata', 'strata_vram'], ['strata', 'strata_ram_standby']]) {
        const h = harness(kind);
        await h.controller.setEnabled(false);
        const events = [];
        const lifecycle = new ImageGenerationModelLifecycle({ resolveRouterTarget: async () => { throw new Error('router should not be contacted'); }, withExclusiveModelLifecycle: async task => { events.push('gate'); return task(); }, getComfyClient: () => { throw new Error('cleanup should not be needed'); }, getLocalServerProcess: () => { throw new Error('stopped backend must not restart'); }, getManagedLocalLlmController: () => h.controller, resolveStrataTarget: async () => { throw new Error('stopped Strata must not be contacted'); } });
        const render = deferred();
        const job = lifecycle.run({ mode, renderBatch: () => { events.push('render'); return render.promise; } });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal((await h.controller.getStatus()).state, 'off');
        render.resolve('image');
        assert.equal(await job, 'image');
        assert.equal((await h.controller.getStatus()).state, 'off');
        assert.deepEqual(events, ['gate', 'render']);
        assert.equal(h.events.filter(item => item === 'start').length, 0);
    }
});

test('effective remote override bypasses off guard while managed targets are blocked', () => {
    const fs = require('node:fs'), vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('LLMClient.setManagedLocalLlmGuard(');
    const end = source.indexOf('\n\nconst imageGenerationModelLifecycle', start);
    assert.ok(start >= 0 && end > start);
    let guard, blocks = 0;
    const context = { LLMClient: { setManagedLocalLlmGuard: callback => { guard = callback; }, resolveChatEndpoint: endpoint => endpoint }, managedLocalLlmController: { isConfigured: () => true, assertPromptAllowed: () => { blocks++; throw new Error('switched off'); } }, managedLocalLlamaAiConfig: { endpoint: 'http://local/v1' }, resolveInitialManagedLocalLlamaAiConfig: () => null };
    vm.createContext(context); vm.runInContext(source.slice(start, end), context);
    assert.throws(() => guard({ attemptRuntime: { aiConfig: { strata_runtime: { profile: 'owned' } }, backend: 'openai_compatible', resolvedEndpoint: 'http://local/v1' } }), /switched off/);
    assert.throws(() => guard({ attemptRuntime: { aiConfig: { local_startup_script_path: '/fake/llama' }, backend: 'openai_compatible', resolvedEndpoint: 'http://local/v1' } }), /switched off/);
    assert.doesNotThrow(() => guard({ attemptRuntime: { aiConfig: { strata_runtime: null, local_startup_script_path: '' }, backend: 'openai_compatible', resolvedEndpoint: 'http://remote/v1' } }));
    assert.doesNotThrow(() => guard({ attemptRuntime: { aiConfig: {}, backend: 'remote_cli', resolvedEndpoint: '' } }));
    assert.equal(blocks, 2);
});

test('error retry action distinguishes absent runtime from failed stop with live runtime', async () => {
    const h = harness();
    h.setRunning(false);
    const exited = await h.controller.getStatus();
    assert.equal(exited.state, 'error'); assert.equal(exited.nextEnabled, true);
    const live = new ManagedLocalLlmController({ resolveConfiguration: () => ({ kind: 'llama' }), inspect: async () => true, start: async () => {}, stop: async () => { throw new Error('stop failed'); }, isPresent: () => true, withExclusiveModelLifecycle: task => task() });
    await assert.rejects(live.setEnabled(false), /stop failed/);
    const failed = await live.getStatus();
    assert.equal(failed.state, 'error'); assert.equal(failed.nextEnabled, false); assert.match(failed.error.stack, /stop failed/);
});

test('image queued before manual off releases a still-running model before rendering', async () => {
    const ImageGenerationModelLifecycle = require('../ImageGenerationModelLifecycle.js');
    for (const [kind, mode] of [['llama', 'terminate'], ['strata', 'strata_vram'], ['strata', 'strata_ram_standby']]) {
        let tail = Promise.resolve(), running = true;
        const events = [], text = deferred();
        const gate = task => { const result = tail.then(task); tail = result.catch(() => {}); return result; };
        const controller = new ManagedLocalLlmController({ resolveConfiguration: () => ({ kind }), inspect: async () => running, isPresent: () => running, start: async () => { events.push('manual-start'); running = true; }, stop: async () => { events.push('manual-stop'); running = false; }, withExclusiveModelLifecycle: gate });
        const process = { isRunning: () => running, stop: async () => { events.push('model-release'); running = false; return { pid: 1 }; }, start: async () => { events.push('model-restart'); running = true; return { pid: 2 }; } };
        const lifecycle = new ImageGenerationModelLifecycle({ resolveRouterTarget: async () => ({}), withExclusiveModelLifecycle: gate, getComfyClient: () => ({ releaseVram: async () => ({ fallbackUsed: false }) }), getLocalServerProcess: () => process, getManagedLocalLlmController: () => controller, resolveStrataTarget: async () => ({}), createStrataClient: () => ({ releaseForImages: async () => { events.push('model-release'); return { vram_free_mib: 13000 }; }, standbyForImages: async () => { events.push('model-release'); return { vram_free_mib: 13000 }; }, restore: async () => {} }), logger: { log() {} } });
        const textJob = gate(() => text.promise);
        const image = lifecycle.run({ mode, renderBatch: async () => { events.push('render'); } });
        const off = controller.setEnabled(false);
        await new Promise(resolve => setImmediate(resolve));
        text.resolve();
        await Promise.all([textJob, image, off]);
        assert.ok(events.indexOf('model-release') >= 0 && events.indexOf('model-release') < events.indexOf('render'), `${kind}/${mode}: ${events}`);
        assert.ok(events.indexOf('manual-stop') > events.indexOf('render'), `${kind}/${mode}: ${events}`);
        assert.equal(controller.desiredOn, false);
    }
});

test('image queued while confirmed off renders without handoff before pending manual on', async () => {
    const ImageGenerationModelLifecycle = require('../ImageGenerationModelLifecycle.js');
    let tail = Promise.resolve(), running = true;
    const gate = task => { const result = tail.then(task); tail = result.catch(() => {}); return result; };
    const events = [], text = deferred();
    const controller = new ManagedLocalLlmController({ resolveConfiguration: () => ({ kind: 'strata' }), inspect: async () => running, isPresent: () => running, start: async () => { events.push('start'); running = true; }, stop: async () => { events.push('stop'); running = false; }, withExclusiveModelLifecycle: gate });
    await controller.setEnabled(false);
    events.length = 0;
    const lifecycle = new ImageGenerationModelLifecycle({ resolveRouterTarget: async () => ({}), withExclusiveModelLifecycle: gate, getComfyClient: () => { throw new Error('unexpected cleanup'); }, getManagedLocalLlmController: () => controller, resolveStrataTarget: async () => { throw new Error('off runtime contacted'); } });
    const textJob = gate(() => text.promise);
    const image = lifecycle.run({ mode: 'strata_vram', renderBatch: async () => { events.push('render'); } });
    const on = controller.setEnabled(true);
    await new Promise(resolve => setImmediate(resolve));
    text.resolve();
    await Promise.all([textJob, image, on]);
    assert.deepEqual(events, ['render', 'start']);
});

test('inspection started before a completed stop cannot return stale running', async () => {
    const h = harness();
    const inspection = deferred();
    h.controller.inspect = () => inspection.promise;
    const oldStatus = h.controller.getStatus();
    h.controller.inspect = async () => false;
    await h.controller.setEnabled(false);
    inspection.resolve(true);
    const status = await oldStatus;
    assert.equal(status.state, 'off');
    assert.equal(status.desiredOn, false);
});

test('startup-off controller starts neither backend until explicit on', async () => {
    for (const kind of ['strata', 'llama']) {
        const calls = []; let running = false;
        const controller = new ManagedLocalLlmController({ desiredOn: false, resolveConfiguration: () => ({ kind }), inspect: async () => { calls.push('inspect'); return running; }, start: async () => { calls.push('start'); running = true; }, stop: async () => { calls.push('stop'); running = false; }, withExclusiveModelLifecycle: async fn => fn() });
        const off = await controller.getStatus();
        assert.equal(off.state, 'off'); assert.equal(off.desiredOn, false); assert.equal(off.nextEnabled, true);
        assert.deepEqual(calls, []);
        assert.throws(() => controller.assertPromptAllowed(), /switched off/i);
        const on = await controller.setEnabled(true);
        assert.equal(on.state, 'running'); assert.equal(on.desiredOn, true);
        assert.deepEqual(calls, ['start', 'inspect']);
    }
});
