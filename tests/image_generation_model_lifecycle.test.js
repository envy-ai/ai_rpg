const test = require('node:test');
const assert = require('node:assert/strict');
const ImageGenerationModelLifecycle = require('../ImageGenerationModelLifecycle.js');

function createHarness({ renderError = null, comfyError = null, unloadError = null, restartError = null } = {}) {
    const events = [];
    const warnings = [];
    const router = {
        unloadModelIfLoaded: async () => {
            events.push('llm-unload');
            if (unloadError) {
                throw unloadError;
            }
            return { unloadedByClient: true };
        },
        loadModel: async () => {
            events.push('llm-load');
        }
    };
    const localServerProcess = {
        stop: async () => {
            events.push('llm-terminate');
            return { pid: 4100 };
        },
        start: async () => {
            events.push('comfy-unload-before-script');
            events.push('llm-script-start');
            if (restartError) {
                throw restartError;
            }
            return { pid: 4200 };
        }
    };
    const lifecycle = new ImageGenerationModelLifecycle({
        resolveRouterTarget: async () => {
            events.push('resolve-router');
            return { endpoint: 'http://router/v1', model: 'story-model' };
        },
        withExclusiveModelLifecycle: async callback => {
            events.push('exclusive-enter');
            try {
                return await callback();
            } finally {
                events.push('exclusive-exit');
            }
        },
        getComfyClient: () => ({
            unloadModels: async () => {
                events.push('comfy-unload');
                if (comfyError) {
                    throw comfyError;
                }
            }
        }),
        getLocalServerProcess: () => localServerProcess,
        createRouterClient: () => router,
        logger: {
            log: () => {},
            warn: message => warnings.push(message)
        }
    });
    const renderBatch = async () => {
        events.push('render-batch');
        if (renderError) {
            throw renderError;
        }
        return 'rendered';
    };
    return { lifecycle, renderBatch, events, warnings };
}

test('image lifecycle unloads LLM, renders the full batch, frees ComfyUI, and reloads LLM', async () => {
    const harness = createHarness();

    const result = await harness.lifecycle.run({ mode: 'unload', renderBatch: harness.renderBatch });

    assert.equal(result, 'rendered');
    assert.deepEqual(harness.events, [
        'exclusive-enter',
        'resolve-router',
        'llm-unload',
        'render-batch',
        'comfy-unload',
        'llm-load',
        'exclusive-exit'
    ]);
});

test('image lifecycle reloads the LLM after a render batch failure', async () => {
    const renderError = new Error('render failed');
    const harness = createHarness({ renderError });

    await assert.rejects(
        () => harness.lifecycle.run({ mode: 'unload', renderBatch: harness.renderBatch }),
        error => error === renderError
    );
    assert.ok(harness.events.indexOf('llm-load') > harness.events.indexOf('render-batch'));
    assert.equal(harness.events.at(-1), 'exclusive-exit');
});

test('optional ComfyUI cleanup failure is visible and does not prevent LLM reload', async () => {
    const harness = createHarness({ comfyError: new Error('free endpoint missing') });

    await harness.lifecycle.run({ mode: 'unload', renderBatch: harness.renderBatch });

    assert.equal(harness.events.includes('llm-load'), true);
    assert.match(harness.warnings.join('\n'), /free endpoint missing/);
});

test('image lifecycle does not render if llama.cpp unload fails before starting', async () => {
    const harness = createHarness({ unloadError: new Error('router unavailable') });

    await assert.rejects(
        () => harness.lifecycle.run({ mode: 'unload', renderBatch: harness.renderBatch }),
        /router unavailable/
    );
    assert.equal(harness.events.includes('render-batch'), false);
    assert.equal(harness.events.at(-1), 'exclusive-exit');
});

test('disabled image lifecycle renders without acquiring exclusive model access', async () => {
    const harness = createHarness();

    const result = await harness.lifecycle.run({ mode: 'none', renderBatch: harness.renderBatch });

    assert.equal(result, 'rendered');
    assert.deepEqual(harness.events, ['render-batch']);
});

test('terminate lifecycle stops the saved local PID, renders, clears ComfyUI, and runs the startup script', async () => {
    const harness = createHarness();

    const result = await harness.lifecycle.run({ mode: 'terminate', renderBatch: harness.renderBatch });

    assert.equal(result, 'rendered');
    assert.deepEqual(harness.events, [
        'exclusive-enter',
        'llm-terminate',
        'render-batch',
        'comfy-unload-before-script',
        'llm-script-start',
        'exclusive-exit'
    ]);
});

test('terminate lifecycle restarts the local server after a render failure', async () => {
    const renderError = new Error('render failed');
    const harness = createHarness({ renderError });

    await assert.rejects(
        () => harness.lifecycle.run({ mode: 'terminate', renderBatch: harness.renderBatch }),
        error => error === renderError
    );
    assert.ok(harness.events.indexOf('llm-script-start') > harness.events.indexOf('render-batch'));
    assert.equal(harness.events.at(-1), 'exclusive-exit');
});

test('terminate lifecycle preserves both render and local restart failures', async () => {
    const renderError = new Error('render failed');
    const restartError = new Error('restart failed');
    const harness = createHarness({ renderError, restartError });

    await assert.rejects(
        () => harness.lifecycle.run({ mode: 'terminate', renderBatch: harness.renderBatch }),
        error => (
            error instanceof AggregateError
            && error.errors.includes(renderError)
            && error.errors.includes(restartError)
        )
    );
    assert.equal(harness.events.at(-1), 'exclusive-exit');
});
