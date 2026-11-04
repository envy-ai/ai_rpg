const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
function extract(start, end) { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return source.slice(a, b); }

test('CLI flag defaults on for normal startup and rejects invalid or duplicate arguments', () => {
    const context = {}; vm.createContext(context);
    vm.runInContext(`${extract('function parseCliBooleanOption(', '\nfunction resolveCliRegionExitDebugFlag(')}\nthis.resolve = resolveCliNoLlmAutostartFlag;`, context);
    for (const [args, expected] of [[[], false], [['--no-llm-autostart'], true], [['--no-llm-autostart=true'], true], [['--no-llm-autostart=false'], false], [['--no-llm-autostart=off'], false]]) assert.equal(context.resolve(['node', 'server.js', ...args]), expected);
    assert.throws(() => context.resolve(['node', 'server.js', '--no-llm-autostart=maybe']), /boolean|must be/i);
    assert.throws(() => context.resolve(['node', 'server.js', '--no-llm-autostart', '--no-llm-autostart=false']), /once/i);
});

test('both managed initializers construct their controllable instance without starting it when disabled', async () => {
    for (const autostart of [false, true]) {
        const calls = [];
        class Runtime { constructor() { calls.push('strata-construct'); } async start() { calls.push('strata-start'); } }
        class Llama { constructor() { calls.push('llama-construct'); } async start() { calls.push('llama-start'); } }
        const target = { executable: '/mock', profile: 'test' };
        const ctx = { config: { target }, managedStrataRuntime: null, managedStrataRuntimeTarget: undefined, localLlamaServerProcess: null, managedLocalLlamaAiConfig: null, validateStrataRuntimeConfigurations: c => c.target, fs: { statSync: () => ({ isFile: () => true }), accessSync() {}, constants: { X_OK: 1 } }, StrataRuntime: Runtime, LocalLlamaServerProcess: Llama, LLMClient: { resolveEffectiveAiConfiguration() {}, setManagedStrataRuntimeHandler: h => { if (h) calls.push('strata-handler'); }, setManagedLocalModelStartupHandler: () => calls.push('llama-handler') }, clearComfyVramForManagedLocalLlamaStartup() {}, resolveInitialManagedLocalLlamaAiConfig: () => ({ configured: true }), resolveLocalLlamaStartupScriptPathFromAiConfig: () => '/mock', resolveImageGenerationModelLifecycleMode: () => 'none', console };
        vm.createContext(ctx);
        vm.runInContext(`${extract('function validateManagedStrataRuntimeConfiguration(', '\nfunction enqueueImageJob(')}\nthis.strata = initializeManagedStrataRuntime; this.llama = initializeManagedLocalLlamaServer;`, ctx);
        await ctx.strata({ autostart }); await ctx.llama({ autostart });
        assert.deepEqual(calls, autostart ? ['strata-construct', 'strata-start', 'strata-handler', 'llama-construct', 'llama-start', 'llama-handler'] : ['strata-construct', 'strata-handler', 'llama-construct', 'llama-handler']);
    }
});

test('server startup skips managed preloading and default inventory only when intentionally off', async () => {
    for (const [flag, managed] of [[true, true], [false, true], [true, false]]) {
        const calls = [], stop = new Error('mock listen reached');
        class Player { constructor() { this.id = 'player'; } }
        const ctx = { console: { log() {}, warn() {}, error() {} }, cliNoLlmAutostart: flag, cliStartupGamePath: null, managedLocalLlmController: { isConfigured: () => managed, desiredOn: !flag }, Player, players: new Map(), currentPlayer: null, generateInventoryForCharacter: async () => calls.push('inventory'), validateConfiguration: async () => true, initializeImageEngine: async () => {}, configureComfyModelCleanupBeforePrompts() {}, initializeManagedStrataRuntime: async ({autostart}) => calls.push(`strata:${autostart}`), initializeManagedLocalLlamaServer: async ({autostart}) => calls.push(`llama:${autostart}`), LLMClient: { preloadRouterModel: async () => calls.push('preload') }, config: {}, initializeLorebookManager: async () => {}, getLorebookManager: () => ({ lorebooks: new Map(), allEntries: [] }), realtimeHub: { attach() {} }, server: {}, listenWithPortRetry: async () => { throw stop; }, PORT: 1234, HOST: 'mock', resolveSelfRestartPortRetrySeconds: () => 0 };
        vm.createContext(ctx);
        vm.runInContext(`${extract('function createDefaultPlayer()', '\nif (require.main === module)')}\nthis.start = startServer;`, ctx);
        await assert.rejects(ctx.start(), error => error === stop);
        assert.ok(ctx.players.has('player'));
        assert.deepEqual(calls, [`strata:${!flag}`, `llama:${!flag}`, ...((flag && managed) ? [] : ['preload', 'inventory'])]);
    }
});
