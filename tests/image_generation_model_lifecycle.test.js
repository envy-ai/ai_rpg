const test = require('node:test');
const assert = require('node:assert/strict');
const ImageGenerationModelLifecycle = require('../ImageGenerationModelLifecycle.js');

function createHarness({
    renderError = null,
    comfyError = null,
    comfyFallbackUsed = false,
    unloadError = null,
    restartError = null
} = {}) {
    const events = [];
    const warnings = [];
    const fallbackNotifications = [];
    let comfyReleaseCount = 0;
    const localStartOptions = [];
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
        start: async options => {
            localStartOptions.push(options);
            events.push('comfy-release-vram-before-script');
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
            releaseVram: async () => {
                comfyReleaseCount += 1;
                events.push('comfy-release-vram');
                if (comfyError) {
                    throw comfyError;
                }
                return comfyFallbackUsed
                    ? {
                        fallbackUsed: true,
                        cacheMonitorError: 'Cache Monitor returned 404.'
                    }
                    : { fallbackUsed: false };
            }
        }),
        getLocalServerProcess: () => localServerProcess,
        createRouterClient: () => router,
        onComfyCacheMonitorFallback: async payload => fallbackNotifications.push(payload),
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
    return {
        lifecycle,
        renderBatch,
        events,
        warnings,
        fallbackNotifications,
        getComfyReleaseCount: () => comfyReleaseCount,
        localStartOptions
    };
}

test('image lifecycle unloads LLM, renders the full batch, preserves the ComfyUI host cache, and reloads LLM', async () => {
    const harness = createHarness();

    const result = await harness.lifecycle.run({ mode: 'unload', renderBatch: harness.renderBatch });

    assert.equal(result, 'rendered');
    assert.deepEqual(harness.events, [
        'exclusive-enter',
        'resolve-router',
        'llm-unload',
        'render-batch',
        'comfy-release-vram',
        'llm-load',
        'exclusive-exit'
    ]);
    assert.equal(harness.getComfyReleaseCount(), 1);
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
    const harness = createHarness({ comfyError: new Error('cache endpoint missing') });

    await harness.lifecycle.run({ mode: 'unload', renderBatch: harness.renderBatch });

    assert.equal(harness.events.includes('llm-load'), true);
    assert.match(harness.warnings.join('\n'), /cache endpoint missing/);
});

test('Cache Monitor fallback reloads the LLM and broadcasts a browser warning', async () => {
    const harness = createHarness({ comfyFallbackUsed: true });

    await harness.lifecycle.run({ mode: 'unload', renderBatch: harness.renderBatch });

    assert.equal(harness.events.includes('llm-load'), true);
    assert.match(harness.warnings.join('\n'), /used full \/free cleanup/);
    assert.deepEqual(harness.fallbackNotifications, [{
        cacheMonitorError: 'Cache Monitor returned 404.'
    }]);
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

test('terminate lifecycle stops the saved local PID, renders, preserves the ComfyUI host cache, and runs the startup script', async () => {
    const harness = createHarness();

    const result = await harness.lifecycle.run({ mode: 'terminate', renderBatch: harness.renderBatch });

    assert.equal(result, 'rendered');
    assert.deepEqual(harness.events, [
        'exclusive-enter',
        'llm-terminate',
        'render-batch',
        'comfy-release-vram-before-script',
        'llm-script-start',
        'exclusive-exit'
    ]);
    assert.deepEqual(harness.localStartOptions, [{
        beforeStartOptions: { preserveComfySystemCache: true }
    }]);
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
