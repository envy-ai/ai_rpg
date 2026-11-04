const test = require('node:test');
const assert = require('node:assert/strict');
const { StrataRuntime: RealStrataRuntime } = require('../StrataRuntime.js');
const resources = { memory_max_mib: 90112, memlock_mib: 98304, shm_size_mib: 61440 };
class StrataRuntime extends RealStrataRuntime {
    constructor(options) { super({ ...options, resources, runtimeService: { startCommand: options.runCommand, verifyRuntime: async () => {}, stop: async () => { if (options.onServiceStop) await options.onServiceStop(); } } }); }
}

const ready = (overrides = {}) => ({ state: 'ready', owner_id: 'owner1', instance_id: 'instance1', host_pid: 123, api_url: 'http://127.0.0.1:8080', api_identity_verified: true, launch_attested: true, generation_ready: true, ...overrides });
function harness({ status = { state: 'stopped' }, startResult = ready(), http = { service: 'strata', model: 'model-1', loaded: true, started: 12345 }, attested = true } = {}) {
    let current = status;
    const calls = [];
    const runtime = new StrataRuntime({ executable: '/fake/strata', profile: 'test-profile', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1', ownerPid: 456, ownerToken: 'l:789', timeoutMs: 5000,
        beforeStart: async () => { calls.push({ op: 'cleanup' }); },
        onServiceStop: async () => { calls.push({ op: 'unit-stop' }); },
        attestHost: async options => { calls.push({ op: 'attest', options }); return attested; },
        httpClient: { get: async (url, options) => { calls.push({ op: 'http', url, options }); return { data: http }; } },
        runCommand: async options => {
            const op = options.args[1];
            calls.push({ op, options });
            if (op === 'start') { current = startResult; return { exitCode: 0, stdout: JSON.stringify(startResult), stderr: '' }; }
            if (op === 'status') return { exitCode: 0, stdout: JSON.stringify(current), stderr: '' };
            if (op === 'stop') { current = { state: 'stopped' }; return { exitCode: 0, stdout: JSON.stringify(current), stderr: '' }; }
            throw new Error(`Unexpected mock command ${op}`);
        }, logger: { log() {}, warn() {}, error() {} }
    });
    return { runtime, calls, setStatus: value => { current = value; } };
}

test('stopped runtime cleans GPU before owned start, binds owner PID, checks status and exact model', async () => {
    const h = harness();
    const ownership = await h.runtime.start();
    assert.deepEqual({ ownerId: ownership.ownerId, instanceId: ownership.instanceId, hostPid: ownership.hostPid }, { ownerId: 'owner1', instanceId: 'instance1', hostPid: 123 });
    const operations = h.calls.map(call => call.op);
    assert.ok(operations.indexOf('status') < operations.indexOf('cleanup'));
    assert.ok(operations.indexOf('cleanup') < operations.indexOf('start'));
    const start = h.calls.find(call => call.op === 'start').options;
    assert.equal(start.executable, '/fake/strata');
    assert.ok(start.args.includes('--die-with-pid'));
    assert.equal(start.args[start.args.indexOf('--die-with-pid') + 1], '456');
    assert.deepEqual(h.calls.find(call => call.op === 'attest').options, { hostPid: 123, profile: 'test-profile', ownerPid: 456, ownerToken: 'l:789' });
    assert.match(h.calls.find(call => call.op === 'http').url, /\/v1\/status$/);
    await h.runtime.ensureReady({ endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1' });
    await assert.rejects(h.runtime.ensureReady({ endpoint: 'http://elsewhere:8080/v1', model: 'model-1' }), /endpoint|mismatch/i);
    await assert.rejects(h.runtime.ensureReady({ endpoint: 'http://127.0.0.1:8080/v1', model: 'other' }), /model|mismatch/i);
    await h.runtime.stop();
    assert.equal(h.calls.filter(call => call.op === 'unit-stop').length, 1);
    assert.equal(h.calls.some(call => call.op === 'stop'), false);
    assert.equal(h.runtime.getOwnership(), null);
});

test('running external runtime is refused without starting, cleaning, or stopping it', async () => {
    const h = harness({ status: ready() });
    await assert.rejects(h.runtime.start(), /running|owned|already/i);
    assert.equal(h.calls.some(call => ['cleanup', 'start', 'stop'].includes(call.op)), false);
});

test('readiness failure only cleans up verified own instance and never a replacement', async () => {
    const h = harness({ http: { service: 'strata', model: 'wrong', loaded: true, started: 12345 } });
    await assert.rejects(h.runtime.start(), /model|ready|mismatch/i);
    assert.equal(h.calls.filter(call => call.op === 'unit-stop').length, 1);
    assert.equal(h.calls.some(call => call.op === 'stop'), false);
    const replacement = harness();
    await replacement.runtime.start();
    replacement.setStatus(ready({ owner_id: 'external', instance_id: 'replacement', host_pid: 987 }));
    await assert.rejects(replacement.runtime.ensureReady({}), /changed|ownership|instance|mismatch/i);
    await assert.rejects(replacement.runtime.stop(), /changed|ownership|instance|mismatch/i);
    assert.equal(replacement.calls.some(call => call.op === 'stop'), false);
    assert.equal(replacement.calls.filter(call => call.op === 'unit-stop').length, 1);
});

test('timed-out startup recovers and stops only a host attested to this owner', async () => {
    for (const trusted of [true, false]) {
        const calls = [];
        let first = true;
        const runtime = new StrataRuntime({ executable: '/fake/strata', profile: 'test-profile', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1', ownerPid: 456, ownerToken: 'l:789', timeoutMs: 5000,
            onServiceStop: async () => calls.push(['unit-stop']),
            attestHost: async () => trusted, beforeStart: async () => {}, httpClient: { get: async () => { throw new Error('must not call HTTP'); } }, logger: { log() {} },
            runCommand: async ({ args }) => {
                const op = args[1]; calls.push(args);
                if (op === 'start') return { exitCode: 8, stdout: JSON.stringify({ state: 'starting', phase: 'timeout' }), stderr: '' };
                if (op === 'status' && first) { first = false; return { exitCode: 0, stdout: '{"state":"stopped"}', stderr: '' }; }
                if (op === 'status') return { exitCode: 0, stdout: JSON.stringify(ready({ state: 'starting' })), stderr: '' };
                if (op === 'stop') return { exitCode: 0, stdout: '{"state":"stopped"}', stderr: '' };
                throw new Error('Unexpected mock command');
            } });
        await assert.rejects(runtime.start(), /failed|cleanup/i);
        assert.equal(calls.some(args => args[1] === 'stop'), false);
        assert.equal(calls.filter(args => args[0] === 'unit-stop').length, 1);
    }
});

test('startup with unpublished identity never sends an unguarded stop', async () => {
    let first = true;
    const calls = [];
    const runtime = new StrataRuntime({ executable: '/fake/strata', profile: 'test-profile', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1', ownerPid: 456, ownerToken: 'l:789', beforeStart: async () => {}, attestHost: async () => true, httpClient: { get: async () => { throw new Error('unexpected'); } }, logger: { log() {} },
        runCommand: async ({ args }) => {
            calls.push(args);
            if (args[1] === 'start') return { exitCode: 8, stdout: '{"state":"starting","phase":"timeout"}', stderr: '' };
            if (first) { first = false; return { exitCode: 0, stdout: '{"state":"stopped"}', stderr: '' }; }
            return { exitCode: 0, stdout: '{"state":"starting","host_pid":123}', stderr: '' };
        } });
    await assert.rejects(runtime.start(), /timeout|cleanup|identity/i);
    assert.equal(calls.some(args => args[1] === 'stop'), false);
});

test('owned RAM standby is accepted only when explicitly allowed and API identity remains stable', async () => {
    const h = harness();
    await h.runtime.start();
    h.runtime.httpClient.get = async () => ({ data: { service: 'strata', model: 'model-1', loaded: false, started: 12345, gpu_residency: { state: 'ram_resident' } } });
    await h.runtime.ensureReady({ allowRamStandby: true });
    await assert.rejects(h.runtime.ensureReady({}), /loaded|standby/i);
    h.runtime.httpClient.get = async () => ({ data: { service: 'strata', model: 'model-1', loaded: true, started: 12346 } });
    await assert.rejects(h.runtime.ensureReady({}), /identity changed/i);
});

test('runtime configuration validates isolated managed target while allowing Strata image handoff', () => {
    const { resolveStrataRuntimeConfiguration, validateStrataRuntimeConfigurations } = require('../StrataRuntime.js');
    const ai = { backend: 'openai_compatible', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1', strata_runtime: { executable: '/fake/strata', profile: 'test-profile', resources }, image_generation_handoff: { provider: 'strata', mode: 'ram_standby' } };
    assert.equal(resolveStrataRuntimeConfiguration(ai).profile, 'test-profile');
    for (const change of [{ strata_runtime: { executable: 'relative', profile: 'p' } }, { strata_runtime: { executable: '/x', profile: '' } }, { backend: 'other' }, { local_startup_script_path: '/other' }, { unload_during_image_generation: true }, { terminate_during_image_generation: true }]) {
        assert.throws(() => resolveStrataRuntimeConfiguration({ ...ai, ...change }));
    }
    const config = { ai, ai_model_overrides: { other: { prompts: ['other'] } } };
    assert.throws(() => validateStrataRuntimeConfigurations(config, () => ({ aiConfig: { ...ai, model: 'other' } })), /match|ownership/i);
    assert.throws(() => validateStrataRuntimeConfigurations({ ai, unload_model_on_switch: true }, () => ({ aiConfig: ai })), /unload_model_on_switch/i);
    assert.doesNotThrow(() => validateStrataRuntimeConfigurations({ ai }, () => ({ aiConfig: ai })));
});

test('shutdown waits for in-flight owned start, blocks readiness and stops before returning', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let current = { state: 'stopped' };
    const calls = [];
    const runtime = new StrataRuntime({ executable: '/fake/strata', profile: 'test-profile', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1', ownerPid: 456, ownerToken: 'l:789', onServiceStop: async () => { calls.push('unit-stop'); }, beforeStart: async () => { calls.push('cleanup'); await gate; }, attestHost: async () => true, httpClient: { get: async () => ({ data: { service: 'strata', model: 'model-1', loaded: true, started: 12345 } }) }, logger: { log() {} },
        runCommand: async ({ args }) => {
            calls.push(args[1]);
            if (args[1] === 'start') current = ready();
            if (args[1] === 'stop') current = { state: 'stopped' };
            return { exitCode: 0, stdout: JSON.stringify(current), stderr: '' };
        } });
    const start = runtime.start();
    await new Promise(resolve => setImmediate(resolve));
    const stop = runtime.stop();
    await assert.rejects(runtime.ensureReady({}), /shutting down/i);
    assert.equal(calls.includes('unit-stop'), false);
    release();
    await start;
    await stop;
    assert.ok(calls.indexOf('start') < calls.indexOf('unit-stop'));
    assert.equal(calls.includes('stop'), false);
    assert.equal(runtime.getOwnership(), null);
});

test('multimodal inheritance validates owned target while explicit opt-out permits a different provider', () => {
    const { validateStrataRuntimeConfigurations } = require('../StrataRuntime.js');
    const ai = { backend: 'openai_compatible', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1', strata_runtime: { executable: '/fake/strata', profile: 'p', resources } };
    const resolve = (_label, configuration) => ({ aiConfig: configuration.ai });
    assert.throws(() => validateStrataRuntimeConfigurations({ ai, ai_multimodal: { enabled: true, model: 'vision-other' } }, resolve), /multimodal.*match/i);
    assert.doesNotThrow(() => validateStrataRuntimeConfigurations({ ai, ai_multimodal: { enabled: false, model: 'vision-other' } }, resolve));
    assert.doesNotThrow(() => validateStrataRuntimeConfigurations({ ai, ai_multimodal: { enabled: true, model: 'vision-other', strata_runtime: null } }, resolve));
    assert.doesNotThrow(() => validateStrataRuntimeConfigurations({ ai, ai_multimodal: { enabled: true } }, resolve));
});

test('managed runtime rejects missing, malformed and unsafe containment resources', () => {
    const { resolveStrataRuntimeConfiguration } = require('../StrataRuntime.js');
    const ai = { backend: 'openai_compatible', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1' };
    for (const bad of [undefined, {}, { ...resources, memory_max_mib: 0 }, { ...resources, shm_size_mib: -1 }, { ...resources, memlock_mib: 1.5 }, { ...resources, memory_max_mib: Number.MAX_SAFE_INTEGER }, { ...resources, unknown: 1 }]) {
        assert.throws(() => resolveStrataRuntimeConfiguration({ ...ai, strata_runtime: { executable: '/fake/strata', profile: 'p', resources: bad } }));
    }
    assert.throws(() => resolveStrataRuntimeConfiguration({ ...ai, strata_runtime: { executable: '/fake/strata', profile: 'p', resources, termination_trace_path: 'relative' } }), /absolute/i);
});

test('explicit off then on creates a fresh contained service without adopting another runtime', async () => {
    let current = { state: 'stopped' }, count = 0;
    const calls = [];
    const createRuntimeService = () => {
        const id = ++count;
        return { startCommand: async () => { calls.push(`start:${id}`); current = ready({ owner_id: `owner${id}`, instance_id: `instance${id}`, host_pid: 122 + id }); return { exitCode: 0, stdout: JSON.stringify(current), stderr: '' }; }, verifyRuntime: async () => {}, stop: async () => { calls.push(`stop:${id}`); current = { state: 'stopped' }; } };
    };
    const runtime = new RealStrataRuntime({ executable: '/fake/strata', profile: 'test-profile', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1', resources, ownerPid: 456, ownerToken: 'l:789', createRuntimeService, beforeStart: async () => {}, attestHost: async () => true, httpClient: { get: async () => ({ data: { service: 'strata', model: 'model-1', loaded: true, started: 12345 } }) }, logger: { log() {} }, runCommand: async ({ args }) => { assert.equal(args[1], 'status'); return { exitCode: 0, stdout: JSON.stringify(current), stderr: '' }; } });
    assert.equal((await runtime.start()).ownerId, 'owner1');
    await runtime.stop();
    assert.equal((await runtime.start()).ownerId, 'owner2');
    await runtime.stop();
    assert.deepEqual(calls, ['start:1', 'stop:1', 'start:2', 'stop:2']);
});

test('failed service cleanup retains ownership and never replaces adapter until cleanup succeeds', async () => {
    let current = { state: 'stopped' }, count = 0, failStop = true;
    const createRuntimeService = () => {
        count++;
        return { startCommand: async () => { current = ready(); return { exitCode: 0, stdout: JSON.stringify(current), stderr: '' }; }, verifyRuntime: async () => {}, stop: async () => { if (failStop) throw new Error('cleanup failed'); current = { state: 'stopped' }; } };
    };
    const runtime = new RealStrataRuntime({ executable: '/fake/strata', profile: 'test-profile', endpoint: 'http://127.0.0.1:8080/v1', model: 'model-1', resources, ownerPid: 456, ownerToken: 'l:789', createRuntimeService, beforeStart: async () => {}, attestHost: async () => true, httpClient: { get: async () => ({ data: { service: 'strata', model: 'model-1', loaded: true, started: 12345 } }) }, logger: { log() {} }, runCommand: async () => ({ exitCode: 0, stdout: JSON.stringify(current), stderr: '' }) });
    await runtime.start();
    await assert.rejects(runtime.stop(), /cleanup failed/);
    assert.equal(runtime.getOwnership().ownerId, 'owner1');
    await runtime.start();
    assert.equal(count, 1);
    failStop = false;
    await runtime.stop();
    await runtime.start();
    assert.equal(count, 2);
    await runtime.stop();
});
