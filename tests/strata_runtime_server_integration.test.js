const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function extract(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return source.slice(from, to);
}

test('server initializes owned runtime before handler and rejects ownership reload changes', async () => {
    const events = [];
    let installed;
    class FakeRuntime {
        constructor(options) { events.push('construct'); this.options = options; }
        async start() { events.push('start'); }
        async ensureReady(options) { events.push('ready'); return options; }
    }
    const target = { executable: '/fake/strata', profile: 'p', endpoint: 'http://x', model: 'm' };
    const context = { config: { target }, managedStrataRuntime: null, managedStrataRuntimeTarget: undefined, validateStrataRuntimeConfigurations: value => value.target, LLMClient: { resolveEffectiveAiConfiguration() {}, setManagedStrataRuntimeHandler: fn => { installed = fn; events.push('handler'); } }, fs: { statSync: () => ({ isFile: () => true }), accessSync() {}, constants: { X_OK: 1 } }, StrataRuntime: FakeRuntime, clearComfyVramForManagedLocalLlamaStartup: async () => {}, console };
    vm.createContext(context);
    vm.runInContext(`${extract('function validateManagedStrataRuntimeConfiguration(', '\nasync function initializeManagedLocalLlamaServer(')}\nthis.initialize = initializeManagedStrataRuntime; this.validate = validateManagedStrataRuntimeConfiguration;`, context);
    const instance = await context.initialize();
    assert.ok(instance instanceof FakeRuntime);
    assert.deepEqual(events, ['construct', 'start', 'handler']);
    await installed({ target, endpoint: 'http://x', model: 'm' });
    assert.equal(events.at(-1), 'ready');
    assert.throws(() => context.validate({ target: null }), /restart/i);
    assert.throws(() => context.validate({ target: { ...target, profile: 'other' } }), /restart/i);
    assert.doesNotThrow(() => context.validate({ target: { ...target } }));
});

test('self-restart waits for owned runtime stop and refuses to spawn on stop failure', async () => {
    async function run(fail) {
        const events = [];
        const context = { config: { server: { allowSelfRestart: true } }, selfRestartRequested: false, selfRestartChildProcessId: null, managedStrataRuntime: { stop: async () => { events.push('stop'); if (fail) throw new Error('not owner'); } }, localLlamaServerProcess: null, LLMClient: { deleteRouterContextCacheFiles: async () => events.push('cache') }, spawn: () => { events.push('spawn'); return { pid: 42, unref() {} }; }, process: { execPath: '/fake/node', argv: ['/fake/node', 'server.js'], cwd: () => '/fake', env: {} }, setTimeout: () => ({ unref() {} }), server: {}, console };
        vm.createContext(context);
        vm.runInContext(`${extract('async function requestServerRestart(', '\n// Configure Nunjucks for views')}\nthis.restart = requestServerRestart;`, context);
        if (fail) await assert.rejects(context.restart(), /owned Strata.*not owner/i);
        else assert.equal((await context.restart()).started, true);
        return events;
    }
    assert.deepEqual(await run(false), ['stop', 'cache', 'spawn']);
    assert.deepEqual(await run(true), ['stop']);
});
