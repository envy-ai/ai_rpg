const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const LLMClient = require('../LLMClient.js');
const { resolveImageGenerationHandoff } = require('../ImageGenerationHandoff.js');

function loadModeResolver() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function resolveImageGenerationModelLifecycleMode(configuration = config) {');
    const end = source.indexOf('\nfunction shouldCoordinateAiModelDuringImageGeneration()', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate resolveImageGenerationModelLifecycleMode() in server.js');
    }
    const context = { LLMClient, resolveImageGenerationHandoff, String, Error };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.resolveMode = resolveImageGenerationModelLifecycleMode;`, context);
    return context.resolveMode;
}

const resolveMode = loadModeResolver();

function config(ai, overrides = {}) {
    return {
        ai,
        imagegen: { engine: 'comfyui' },
        ...overrides
    };
}

test('server image lifecycle selects Strata for the effective image-prompt override', () => {
    const settings = config({
        backend: 'openai_compatible',
        endpoint: 'http://strata.example/v1',
        apiKey: 'key',
        model: 'base-model'
    }, {
        ai_model_overrides: {
            image_prompt: {
                prompts: ['image_prompt_generation'],
                model: 'image-prompt-model',
                image_generation_handoff: { provider: 'strata', min_free_vram_mib: 9000 }
            }
        }
    });

    assert.equal(resolveMode(settings), 'strata_vram');
});

test('server image lifecycle preserves none, router-unload, and managed-termination modes', () => {
    const base = {
        backend: 'openai_compatible', endpoint: 'http://router.example/v1', apiKey: 'key', model: 'model'
    };
    assert.equal(resolveMode(config(base)), 'none');
    assert.equal(resolveMode(config({ ...base, unload_during_image_generation: true })), 'unload');
    assert.equal(resolveMode(config({ ...base, terminate_during_image_generation: true,
        local_startup_script_path: '/tmp/start-model.sh' })), 'terminate');
});

test('server image lifecycle refuses incompatible engine, backend, and mutually enabled modes', () => {
    const strata = {
        backend: 'openai_compatible', endpoint: 'http://strata.example/v1', apiKey: 'key', model: 'model',
        image_generation_handoff: { provider: 'strata' }
    };
    assert.throws(() => resolveMode(config(strata, { imagegen: { engine: 'nanogpt' } })), /imagegen.engine/);
    assert.throws(() => resolveMode(config({ ...strata, backend: 'codex' })), /openai_compatible/);
    assert.throws(() => resolveMode(config({
        backend: 'openai_compatible', endpoint: 'http://router.example/v1', apiKey: 'key', model: 'model',
        unload_during_image_generation: true, terminate_during_image_generation: true
    })), /cannot both be true/);
});

test('image lifecycle error event carries every AggregateError child stack to the realtime client', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    assert.match(source, /function formatImageModelLifecycleError\(error\)\s*\{/);
    const formatterStart = source.indexOf('function formatImageModelLifecycleError(error) {');
    const formatterEnd = source.indexOf('\n}', formatterStart) + 2;
    const formatter = source.slice(formatterStart, formatterEnd);
    assert.match(formatter, /AggregateError/);
    assert.match(formatter, /error\.errors/);
    assert.match(formatter, /Underlying errors/);
    const emission = source.slice(source.indexOf("realtimeHub.emit(null, 'image_model_lifecycle_error'"));
    assert.match(emission, /stack:\s*formatImageModelLifecycleError\(error\)/);
});

test('system config POST isolates nested overrides before applying candidate form fields', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const routeStart = source.indexOf("app.post('/config'");
    assert.notEqual(routeStart, -1, 'system config POST route exists');
    const cloneIndex = source.indexOf('const updatedConfig = structuredClone(config);', routeStart);
    const firstNestedMutation = source.indexOf('let current = updatedConfig;', routeStart);
    const validationIndex = source.indexOf('await persistSystemConfig(updatedConfig);', routeStart);
    assert.ok(cloneIndex >= routeStart && cloneIndex < firstNestedMutation,
        'candidate deep clone occurs before mutating dotted nested configuration paths');
    assert.ok(firstNestedMutation < validationIndex,
        'candidate validation/persistence follows isolated nested mutation');
});
