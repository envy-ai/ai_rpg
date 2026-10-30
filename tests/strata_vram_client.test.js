const test = require('node:test');
const assert = require('node:assert/strict');
const StrataVramClient = require('../StrataVramClient.js');

const model = 'qwen3.8-flash-next-davidau-turbo-brilliance-iq3_s-plain';

function status(started = 12345, overrides = {}) {
    return {
        service: 'strata',
        model,
        loaded: true,
        started,
        vram: { elastic: true },
        machine: { gpu: { total_mib: 24564 } },
        ...overrides
    };
}

function resized(overrides = {}) {
    return {
        status: 'ok',
        reserve_mib: 24564,
        vram_free_mib: 13000,
        expert_cache_mib: 1024,
        expert_cache_full_mib: 14000,
        expert_slots: 500,
        expert_slots_full: 7000,
        ...overrides
    };
}

function ramStatus(state = 'gpu_ready', overrides = {}) {
    return status(12345, {
        gpu_residency: { capable: true, state, engine_pid: state === 'gpu_ready' ? 100 : null,
            vision_pid: state === 'gpu_ready' ? 101 : null, locked_mib: 2, instance_id: 'fixture-instance' },
        loaded: state === 'gpu_ready',
        ...overrides
    });
}

function ramStandbyResponse(overrides = {}) {
    return {
        status: 'ram_resident',
        vram_free_mib: 13000,
        gpu_residency: { state: 'ram_resident', engine_pid: null, vision_pid: null,
            locked_mib: 2, instance_id: 'fixture-instance' },
        ...overrides
    };
}

function makeClient({ statuses = [status(), status()], resizeResponse = resized(), standbyResponse = ramStandbyResponse(),
    postError = null, signal = null, minFreeVramMiB = 12288,
    handoffMode = 'elastic', endpoint = 'http://strata.example/v1/chat/completions' } = {}) {
    const calls = [];
    let statusIndex = 0;
    const httpClient = {
        get: async (url, options) => {
            calls.push({ method: 'get', url, options });
            const value = statuses[Math.min(statusIndex++, statuses.length - 1)];
            if (value instanceof Error) throw value;
            return { data: value };
        },
        post: async (url, body, options) => {
            calls.push({ method: 'post', url, body, options });
            if (postError) throw postError;
            return { data: url.endsWith('/standby') ? standbyResponse : resizeResponse };
        }
    };
    return {
        client: new StrataVramClient({ endpoint, model, minFreeVramMiB, headers: {
            Authorization: 'Bearer test-key', 'X-Route': 'strata-test'
        }, timeoutMs: 45000, httpClient, signal, handoffMode }),
        calls
    };
}

test('release validates loaded elastic Strata identity and sends authenticated resize to canonical endpoint', async () => {
    const { client, calls } = makeClient();
    const result = await client.releaseForImages();

    assert.equal(result.status, 'ok');
    assert.deepEqual(calls.map(call => [call.method, call.url]), [
        ['get', 'http://strata.example/v1/status'],
        ['post', 'http://strata.example/v1/vram'],
        ['get', 'http://strata.example/v1/status']
    ]);
    assert.deepEqual(calls[1].body, { reserve_mib: 24564 });
    assert.equal(calls[1].options.headers.Authorization, 'Bearer test-key');
    assert.equal(calls[1].options.headers['X-Route'], 'strata-test');
    assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
    assert.equal(calls[1].options.timeout, 45000);
    assert.equal(client.identity, 12345);
    assert.equal(client.releaseMayHaveStarted, true);
});

test('release rejects status responses that do not prove the expected loaded elastic model', async () => {
    const bad = [
        { service: 'other', model, loaded: true, started: 1, vram: { elastic: true } },
        status(1, { model: 'wrong-model' }),
        status(1, { loaded: false }),
        status(1, { vram: { elastic: false } }),
        { ...status(), started: undefined }
    ];
    for (const value of bad) {
        const { client, calls } = makeClient({ statuses: [value] });
        await assert.rejects(client.releaseForImages(), /Strata status|elastic VRAM|start identity/);
        assert.equal(client.releaseMayHaveStarted, false);
        assert.equal(calls.some(call => call.method === 'post'), false);
    }
});

test('HTTP 200 with insufficient actual free VRAM rejects without treating status ok as enough', async () => {
    const { client, calls } = makeClient({ resizeResponse: resized({ vram_free_mib: 10000 }) });
    await assert.rejects(client.releaseForImages(), /freed 10000 MiB.*requires 12288 MiB/);
    assert.equal(client.releaseMayHaveStarted, true);
    assert.equal(calls.filter(call => call.method === 'post').length, 1);
    assert.deepEqual(calls.filter(call => call.method === 'post').map(call => call.url), [
        'http://strata.example/v1/vram'
    ]); // No /free or unload fallback.
});

test('minimum-free target larger than reported GPU total fails before changing Strata reserve', async () => {
    const { client, calls } = makeClient({
        statuses: [status(12345, { machine: { gpu: { total_mib: 10000 } } })],
        minFreeVramMiB: 12000
    });
    await assert.rejects(client.releaseForImages(), /exceeds GPU total/);
    assert.equal(client.releaseMayHaveStarted, false);
    assert.equal(calls.some(call => call.method === 'post'), false);
});

test('release rejects invalid VRAM response schemas and echoed reserve mismatches', async () => {
    const invalidResponses = [
        resized({ status: 'not loaded' }),
        resized({ reserve_mib: 12287 }),
        resized({ expert_cache_mib: -1 }),
        resized({ expert_slots: Number.MAX_SAFE_INTEGER + 1 }),
        resized({ expert_cache_mib: 14001 }),
        resized({ expert_slots: 7001 })
    ];
    for (const response of invalidResponses) {
        const { client } = makeClient({ resizeResponse: response });
        await assert.rejects(client.releaseForImages(), /Strata VRAM|Strata did not confirm|freed/);
        assert.equal(client.releaseMayHaveStarted, true);
    }
});

test('server identity change after a successful resize is surfaced as a possibly-started release', async () => {
    const { client, calls } = makeClient({ statuses: [status(12345), status(12346)] });
    await assert.rejects(client.releaseForImages(), /identity changed/);
    assert.equal(client.releaseMayHaveStarted, true);
    assert.equal(calls.filter(call => call.method === 'post').length, 1);
});

test('transport failure after issuing resize is marked as possibly started for caller recovery', async () => {
    const error = new Error('connection timed out after request write');
    const { client, calls } = makeClient({ postError: error });
    await assert.rejects(client.releaseForImages(), thrown => thrown === error);
    assert.equal(client.releaseMayHaveStarted, true);
    assert.equal(calls.filter(call => call.method === 'post').length, 1);
    assert.equal(calls.find(call => call.method === 'post').url, 'http://strata.example/v1/vram');
});

test('null restore uses independent recovery requests even after the image signal aborts', async () => {
    const controller = new AbortController();
    controller.abort(new Error('render cancelled'));
    const { client, calls } = makeClient({
        statuses: [status(), status()],
        resizeResponse: resized({ reserve_mib: 700, vram_free_mib: 868, expert_cache_mib: 13312 }),
        signal: controller.signal
    });

    const result = await client.restore();
    assert.equal(result.reserve_mib, 700);
    assert.deepEqual(calls.map(call => [call.method, call.url]), [
        ['get', 'http://strata.example/v1/status'],
        ['post', 'http://strata.example/v1/vram'],
        ['get', 'http://strata.example/v1/status']
    ]);
    assert.deepEqual(calls[1].body, { reserve_mib: null });
    assert.equal('signal' in calls[1].options, false);
    assert.equal('signal' in calls[0].options, false);
    assert.equal(client.releaseMayHaveStarted, false);
});

test('RAM standby posts only the model, verifies GPU workers stopped, and checks the same server identity', async () => {
    const { client, calls } = makeClient({
        handoffMode: 'ram_standby',
        statuses: [ramStatus(), ramStatus('ram_resident', { loaded: false })]
    });
    const result = await client.standbyForImages();

    assert.deepEqual(calls.map(call => [call.method, call.url]), [
        ['get', 'http://strata.example/v1/status'],
        ['post', 'http://strata.example/v1/standby'],
        ['get', 'http://strata.example/v1/status']
    ]);
    assert.deepEqual(calls[1].body, { model });
    assert.equal(calls[1].options.headers.Authorization, 'Bearer test-key');
    assert.equal(calls[1].options.headers['X-Route'], 'strata-test');
    assert.equal(calls[1].options.timeout, 45000);
    assert.equal(result.status, 'ram_resident');
    assert.equal(result.vram_free_mib, 13000);
    assert.equal(client.identity, 12345);
    assert.equal(client.releaseMayHaveStarted, false);
});

test('RAM standby rejects capability, identity, worker, and free-memory mismatches', async () => {
    const invalidStarts = [
        ramStatus('gpu_ready', { gpu_residency: { capable: false, state: 'gpu_ready' } })
    ];
    for (const start of invalidStarts) {
        const { client, calls } = makeClient({ handoffMode: 'ram_standby', statuses: [start] });
        await assert.rejects(client.standbyForImages(), /RAM standby|GPU ready/);
        assert.equal(calls.some(call => call.method === 'post'), false);
        assert.equal(client.releaseMayHaveStarted, false);
    }

    const invalidResponses = [
        ramStandbyResponse({ status: 'ok' }),
        ramStandbyResponse({ vram_free_mib: 10000 }),
        ramStandbyResponse({ gpu_residency: { state: 'ram_resident', engine_pid: 42, vision_pid: null } })
    ];
    for (const response of invalidResponses) {
        const { client, calls } = makeClient({ handoffMode: 'ram_standby', statuses: [ramStatus()], standbyResponse: response });
        await assert.rejects(client.standbyForImages(), /RAM standby|complete RAM standby/);
        assert.equal(client.releaseMayHaveStarted, true);
        assert.equal(calls.filter(call => call.method === 'post').length, 1);
    }

    const { client, calls } = makeClient({ handoffMode: 'ram_standby', statuses: [
        ramStatus(), ramStatus('ram_resident', { loaded: false, started: 12346 })
    ] });
    await assert.rejects(client.standbyForImages(), /identity changed/);
    assert.equal(client.releaseMayHaveStarted, true);
    assert.equal(calls.filter(call => call.method === 'post').length, 1);
});

test('RAM standby accepts an already-resident model for consecutive image batches', async () => {
    const resident = ramStatus('ram_resident', { loaded: false });
    const { client, calls } = makeClient({ handoffMode: 'ram_standby', statuses: [resident, resident] });
    const result = await client.standbyForImages();
    assert.equal(result.status, 'ram_resident');
    assert.equal(calls.filter(call => call.method === 'post').length, 1);
});

test('standby is an explicit mode; elastic release and restore are not silently substituted', async () => {
    const { client } = makeClient({ handoffMode: 'elastic' });
    await assert.rejects(client.standbyForImages(), /requires handoffMode/);

    const { client: standbyClient } = makeClient({ handoffMode: 'ram_standby', statuses: [ramStatus()] });
    await assert.rejects(standbyClient.releaseForImages(), /requires handoffMode/);
    await assert.rejects(standbyClient.restore(), /requires handoffMode/);
});

test('Strata endpoint and constructor options reject invalid values', () => {
    assert.throws(() => new StrataVramClient({ endpoint: '', model }), /endpoint/);
    assert.throws(() => new StrataVramClient({ endpoint: 'ftp://strata.example/v1', model }), /HTTP or HTTPS/);
    assert.throws(() => new StrataVramClient({ endpoint: 'http://strata.example/v1', model: '' }), /model/);
    assert.throws(() => new StrataVramClient({ endpoint: 'http://strata.example/v1', model, minFreeVramMiB: 0 }), /minFreeVramMiB/);
    assert.throws(() => new StrataVramClient({ endpoint: 'http://strata.example/v1', model, timeoutMs: 0 }), /timeoutMs/);
});
