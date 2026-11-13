const test = require('node:test');
const assert = require('node:assert/strict');
const ImageGenerationModelLifecycle = require('../ImageGenerationModelLifecycle.js');
const { createAbortError } = require('../image_client_utils.js');

function makeHarness({
    releaseError = null,
    standbyError = null,
    renderError = null,
    comfyError = null,
    restoreError = null,
    onRelease = null,
    onRender = null,
    target = { endpoint: 'http://strata.test/v1/chat/completions', model: 'image-model', minFreeVramMiB: 12288 },
    signal = null
} = {}) {
    const events = [];
    const errors = [];
    let resolveTargetCount = 0;
    let createClientCount = 0;
    let clientOptions;
    const client = {
        releaseMayHaveStarted: false,
        releaseForImages: async () => {
            events.push('strata-shrink');
            if (onRelease) await onRelease();
            if (releaseError) throw releaseError;
            return { reserve_mib: 24564, vram_free_mib: 13000, expert_cache_mib: 1000 };
        },
        standbyForImages: async () => {
            events.push('strata-standby');
            if (onRelease) await onRelease();
            if (standbyError) throw standbyError;
            return { status: 'ram_resident', vram_free_mib: 24564 };
        },
        restore: async () => {
            events.push('strata-restore-startup-reserve');
            if (restoreError) throw restoreError;
            return { reserve_mib: 700, expert_cache_mib: 12000 };
        }
    };
    const lifecycle = new ImageGenerationModelLifecycle({
        resolveRouterTarget: async () => ({ endpoint: 'http://router.test/v1', model: 'legacy-model' }),
        resolveStrataTarget: async () => {
            events.push('resolve-strata-target');
            resolveTargetCount += 1;
            return target;
        },
        withExclusiveModelLifecycle: async callback => {
            events.push('exclusive-enter');
            try {
                return await callback();
            } finally {
                events.push('exclusive-release');
            }
        },
        getComfyClient: () => ({
            releaseVram: async () => {
                events.push('comfy-cache-cleanup');
                if (comfyError) throw comfyError;
                return { fallbackUsed: false };
            }
        }),
        createStrataClient: options => {
            events.push('create-strata-client');
            createClientCount += 1;
            clientOptions = options;
            return client;
        },
        logger: {
            log: () => {},
            warn: message => errors.push(message)
        }
    });
    const renderBatch = async () => {
        events.push('render-batch');
        if (onRender) await onRender();
        if (renderError) throw renderError;
        return 'rendered';
    };
    return {
        lifecycle, renderBatch, events, errors, client, clientOptions: () => clientOptions,
        resolveTargetCount: () => resolveTargetCount,
        createClientCount: () => createClientCount,
        signal
    };
}

test('Strata lifecycle holds the exclusive gate through shrink, render, Comfy cleanup, restore, then release', async () => {
    const harness = makeHarness();
    const result = await harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch });

    assert.equal(result, 'rendered');
    assert.deepEqual(harness.events, [
        'exclusive-enter', 'resolve-strata-target', 'create-strata-client', 'strata-shrink',
        'render-batch', 'comfy-cache-cleanup', 'strata-restore-startup-reserve', 'exclusive-release'
    ]);
    assert.equal(harness.resolveTargetCount(), 1);
    assert.equal(harness.createClientCount(), 1);
});

test('Strata lifecycle snapshots the target once and restores through the captured client', async () => {
    const target = {
        endpoint: 'http://strata.test/v1/chat/completions', model: 'effective-image-model',
        headers: { Authorization: 'Bearer snapshot-key' }, minFreeVramMiB: 10000
    };
    const harness = makeHarness({ target, onRender: async () => { target.model = 'reloaded-other-model'; } });
    await harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch });

    assert.equal(harness.resolveTargetCount(), 1);
    assert.equal(harness.createClientCount(), 1);
    assert.equal(harness.clientOptions().model, 'effective-image-model');
    assert.deepEqual(harness.clientOptions().headers, { Authorization: 'Bearer snapshot-key' });
    assert.deepEqual(harness.events.slice(-3), [
        'comfy-cache-cleanup', 'strata-restore-startup-reserve', 'exclusive-release'
    ]);
});

test('preflight shrink failure known not to have started skips cleanup and restore', async () => {
    const error = new Error('Strata model is not loaded.');
    error.releaseMayHaveStarted = false;
    const harness = makeHarness({ releaseError: error });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch }),
        thrown => thrown === error
    );
    assert.deepEqual(harness.events, [
        'exclusive-enter', 'resolve-strata-target', 'create-strata-client', 'strata-shrink', 'exclusive-release'
    ]);
    assert.equal(harness.client.releaseMayHaveStarted, false);
});

test('ambiguous shrink failure cleans ComfyUI and restores once before propagating the shrink error', async () => {
    const error = new Error('resize timed out after command may have reached Strata');
    error.releaseMayHaveStarted = true;
    const harness = makeHarness({ releaseError: error });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch }),
        thrown => thrown === error
    );
    assert.deepEqual(harness.events, [
        'exclusive-enter', 'resolve-strata-target', 'create-strata-client', 'strata-shrink',
        'comfy-cache-cleanup', 'strata-restore-startup-reserve', 'exclusive-release'
    ]);
});

test('render failure still cleans ComfyUI and restores Strata before releasing the gate', async () => {
    const error = new Error('Comfy render failed');
    const harness = makeHarness({ renderError: error });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch }),
        thrown => thrown === error
    );
    assert.deepEqual(harness.events.slice(-4), [
        'render-batch', 'comfy-cache-cleanup', 'strata-restore-startup-reserve', 'exclusive-release'
    ]);
});

test('cancellation after shrink skips rendering but restores independent of the aborted signal', async () => {
    const controller = new AbortController();
    const harness = makeHarness({
        signal: controller.signal,
        onRelease: async () => controller.abort(createAbortError('image generation canceled'))
    });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch, signal: controller.signal }),
        error => error.name === 'AbortError' && /image generation canceled/.test(error.message)
    );
    assert.deepEqual(harness.events, [
        'exclusive-enter', 'resolve-strata-target', 'create-strata-client', 'strata-shrink',
        'comfy-cache-cleanup', 'strata-restore-startup-reserve', 'exclusive-release'
    ]);
});

test('render, Comfy cleanup, and restore failures are all preserved in an AggregateError', async () => {
    const renderError = new Error('render failed');
    const cleanupError = new Error('Comfy cleanup failed');
    const restoreError = new Error('Strata restore failed');
    const harness = makeHarness({ renderError, comfyError: cleanupError, restoreError });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch }),
        error => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [renderError, cleanupError, restoreError]);
            return true;
        }
    );
    assert.deepEqual(harness.events.slice(-4), [
        'render-batch', 'comfy-cache-cleanup', 'strata-restore-startup-reserve', 'exclusive-release'
    ]);
});

test('successful render with restore failure surfaces the restore error after cleanup', async () => {
    const restoreError = new Error('restore failed');
    const harness = makeHarness({ restoreError });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch }),
        error => error === restoreError
    );
    assert.deepEqual(harness.events.slice(-3), [
        'comfy-cache-cleanup', 'strata-restore-startup-reserve', 'exclusive-release'
    ]);
});

test('empty render queue does not hide a post-render restore failure from lifecycle callers', async () => {
    const restoreError = new Error('Strata cache restoration failed after an empty queue drained');
    const harness = makeHarness({ restoreError });
    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_vram', renderBatch: harness.renderBatch }),
        error => error === restoreError
    );
    assert.deepEqual(harness.events.slice(-3), [
        'comfy-cache-cleanup', 'strata-restore-startup-reserve', 'exclusive-release'
    ]);
});

test('RAM standby holds the exclusive gate through render and Comfy cleanup without eager model restoration', async () => {
    const harness = makeHarness();
    const result = await harness.lifecycle.run({ mode: 'strata_ram_standby', renderBatch: harness.renderBatch });

    assert.equal(result, 'rendered');
    assert.deepEqual(harness.events, [
        'exclusive-enter', 'resolve-strata-target', 'create-strata-client', 'strata-standby',
        'render-batch', 'comfy-cache-cleanup', 'exclusive-release'
    ]);
    assert.equal(harness.events.includes('strata-shrink'), false);
    assert.equal(harness.events.includes('strata-restore-startup-reserve'), false);
    assert.equal(harness.resolveTargetCount(), 1);
    assert.equal(harness.createClientCount(), 1);
});

test('ambiguous standby failure cleans ComfyUI but leaves automatic wake to the next inference', async () => {
    const error = new Error('standby timed out after the service may have stopped its workers');
    error.releaseMayHaveStarted = true;
    const harness = makeHarness({ standbyError: error });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_ram_standby', renderBatch: harness.renderBatch }),
        thrown => thrown === error
    );
    assert.deepEqual(harness.events, [
        'exclusive-enter', 'resolve-strata-target', 'create-strata-client', 'strata-standby',
        'comfy-cache-cleanup', 'exclusive-release'
    ]);
    assert.equal(harness.events.includes('strata-restore-startup-reserve'), false);
    assert.equal(harness.events.includes('render-batch'), false);
});

test('RAM standby cleanup failure still leaves the model in standby and retains the error', async () => {
    const cleanupError = new Error('Comfy cleanup failed');
    const harness = makeHarness({ comfyError: cleanupError });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_ram_standby', renderBatch: harness.renderBatch }),
        thrown => thrown === cleanupError
    );
    assert.deepEqual(harness.events.slice(-3), [
        'render-batch', 'comfy-cache-cleanup', 'exclusive-release'
    ]);
    assert.equal(harness.events.includes('strata-restore-startup-reserve'), false);
});

test('render and Comfy cleanup failures remain visible together during RAM standby', async () => {
    const renderError = new Error('render failed');
    const cleanupError = new Error('Comfy cleanup failed');
    const harness = makeHarness({ renderError, comfyError: cleanupError });

    await assert.rejects(
        harness.lifecycle.run({ mode: 'strata_ram_standby', renderBatch: harness.renderBatch }),
        error => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [renderError, cleanupError]);
            return true;
        }
    );
    assert.equal(harness.events.includes('strata-restore-startup-reserve'), false);
    assert.deepEqual(harness.events.slice(-3), [
        'render-batch', 'comfy-cache-cleanup', 'exclusive-release'
    ]);
});

test('disk snapshot stays inside exclusive gate across the complete image handoff', async () => {
    const events = [], filenames = [];
    const lifecycle = new ImageGenerationModelLifecycle({
        resolveRouterTarget: async () => ({}), resolveStrataTarget: async () => ({ contextCacheDirectory: '/private' }),
        withExclusiveModelLifecycle: async callback => { events.push('enter'); try { return await callback(); } finally { events.push('exit'); } },
        getComfyClient: () => ({ releaseVram: async () => { events.push('cleanup'); } }),
        createStrataClient: () => ({ releaseForImages: async () => { events.push('shrink'); return { vram_free_mib: 1 }; }, restore: async () => { events.push('reserve'); } }),
        createStrataContextCache: options => { filenames.push(options.filename); return { hasSavedSnapshot: true, save: async () => { events.push('save'); return { saved: true, tokens: 1, bytes: 1 }; }, restore: async () => { events.push('restore'); } }; },
        logger: { log() {}, warn() {} }
    });
    const run = () => lifecycle.run({ mode: 'strata_vram', renderBatch: async () => { events.push('render'); return 'result'; } });
    assert.equal(await run(), 'result');
    assert.deepEqual(events, ['enter', 'save', 'shrink', 'render', 'cleanup', 'reserve', 'restore', 'exit']);
    await run();
    assert.equal(filenames[0], filenames[1]);
    assert.match(filenames[0], /^strata_image_cache_\d+\.bin$/);
});

test('disk handoff restores saved snapshot after cancellation and preserves recovery failures', async () => {
    const events = [], controller = new AbortController();
    const cleanupError = new Error('cleanup failed'), restoreError = new Error('snapshot restore failed');
    const lifecycle = new ImageGenerationModelLifecycle({
        resolveRouterTarget: async () => ({}), resolveStrataTarget: async () => ({ contextCacheDirectory: '/private' }),
        withExclusiveModelLifecycle: async callback => { events.push('enter'); try { return await callback(); } finally { events.push('exit'); } },
        getComfyClient: () => ({ releaseVram: async () => { events.push('cleanup'); throw cleanupError; } }),
        createStrataClient: () => ({ releaseForImages: async () => { events.push('shrink'); controller.abort(new Error('cancel')); return { vram_free_mib: 1 }; }, restore: async () => { events.push('reserve'); } }),
        createStrataContextCache: () => ({ hasSavedSnapshot: true, save: async () => { events.push('save'); return { saved: true, tokens: 1, bytes: 1 }; }, restore: async () => { events.push('restore'); throw restoreError; } }),
        logger: { log() {}, warn() {} }
    });
    await assert.rejects(lifecycle.run({ mode: 'strata_vram', signal: controller.signal, renderBatch: async () => { events.push('render'); } }), error => {
        assert.ok(error instanceof AggregateError);
        assert.ok(error.errors.includes(cleanupError));
        assert.ok(error.errors.includes(restoreError));
        return true;
    });
    assert.deepEqual(events, ['enter', 'save', 'shrink', 'cleanup', 'reserve', 'restore', 'exit']);
});

test('no held session is logged and image handoff proceeds without restore', async () => {
    const events = [], messages = [];
    const lifecycle = new ImageGenerationModelLifecycle({
        resolveRouterTarget: async () => ({}), resolveStrataTarget: async () => ({ contextCacheDirectory: '/private' }),
        withExclusiveModelLifecycle: async callback => callback(),
        getComfyClient: () => ({ releaseVram: async () => { events.push('cleanup'); } }),
        createStrataClient: () => ({ releaseForImages: async () => { events.push('shrink'); return { vram_free_mib: 1 }; }, restore: async () => { events.push('reserve'); } }),
        createStrataContextCache: () => ({ hasSavedSnapshot: false, save: async () => ({ saved: false, reason: 'no_complete_session' }), restore: async () => { events.push('disk restore'); } }),
        logger: { log: message => messages.push(message), warn() {} }
    });
    await lifecycle.run({ mode: 'strata_vram', renderBatch: async () => { events.push('render'); } });
    assert.deepEqual(events, ['shrink', 'render', 'cleanup', 'reserve']);
    assert.ok(messages.some(message => /no complete held session/i.test(message)));
});
