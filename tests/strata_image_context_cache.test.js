const test = require('node:test');
const assert = require('node:assert/strict');
const StrataImageContextCache = require('../StrataImageContextCache.js');

function fixture() {
    const calls = [], state = { owner: { ownerId: 'owner', instanceId: 'instance', hostPid: 42, apiStarted: 8 }, inode: 3, size: 12, restoreTokens: 7, refusal: null, exists: false, dirUid: 100, dirMode: 0o700, fileUid: 100, fileMode: 0o600 };
    const fileSystem = {
        lstat: async path => path !== '/private' && !state.exists ? Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' })) : path === '/private' ? { isDirectory: () => true, isSymbolicLink: () => false, uid: state.dirUid, mode: state.dirMode } : { isFile: () => true, isSymbolicLink: () => false, uid: state.fileUid, mode: state.fileMode, size: state.size, dev: 1, ino: state.inode, mtimeMs: 1 },
        realpath: async path => path, access: async () => {}, unlink: async path => calls.push(`unlink ${path}`)
    };
    const httpClient = {
        get: async () => ({ data: { service: 'strata', model: 'model', loaded: true, started: 8 } }),
        post: async url => {
            const action = url.includes('action=save') ? 'save' : 'restore'; calls.push(action);
            if (action === 'save' && state.refusal) throw state.refusal;
            if (action === 'save') state.exists = true;
            return { data: action === 'save' ? { id_slot: 0, filename: 'strata_image_cache_1.bin', n_saved: 7, n_written: 12, timings: { save_ms: 1 } } : { id_slot: 0, filename: 'strata_image_cache_1.bin', n_restored: state.restoreTokens, n_read: 12, timings: { restore_ms: 1 } } };
        }
    };
    const options = { endpoint: 'http://127.0.0.1:8080/v1', model: 'model', contextCacheDirectory: '/private', filename: 'strata_image_cache_1.bin', ensureRuntimeReady: async () => state.owner, httpClient, fileSystem, uid: 100 };
    return { cache: new StrataImageContextCache(options), calls, state, options };
}

test('owned snapshot verifies identity and counts and deletes only after successful restore', async () => {
    const { cache, calls } = fixture();
    assert.deepEqual(await cache.save(), { saved: true, filename: 'strata_image_cache_1.bin', tokens: 7, bytes: 12 });
    assert.equal(cache.hasSavedSnapshot, true);
    await cache.restore();
    assert.equal(cache.hasSavedSnapshot, false);
    assert.deepEqual(calls, ['save', 'restore', 'unlink /private/strata_image_cache_1.bin']);
});

test('only exact unpublished no-session refusal is skipped', async () => {
    const { cache, state, calls } = fixture();
    state.refusal = { response: { status: 400, data: { error: { kind: 'invalid', message: 'no complete session to save' } } } };
    assert.deepEqual(await cache.save(), { saved: false, reason: 'no_complete_session' });
    assert.equal(cache.hasSavedSnapshot, false);
    state.refusal.response.data.error.published = true;
    await assert.rejects(cache.save(), /Failed to save/);
    assert.deepEqual(calls, ['save', 'save']);
});

test('changed runtime, file, and restore counts retain snapshot without deleting it', async () => {
    for (const mutation of [state => { state.owner = { ...state.owner, instanceId: 'other' }; }, state => { state.inode++; }, state => { state.restoreTokens++; }]) {
        const { cache, state, calls } = fixture();
        await cache.save(); mutation(state);
        await assert.rejects(cache.restore(), /identity changed|snapshot changed|counts do not match/);
        assert.equal(cache.hasSavedSnapshot, true);
        assert.equal(calls.some(call => call.startsWith('unlink')), false);
    }
});

test('rejects unsafe configuration and private snapshot byte mismatches', async () => {
    const { options, state, cache } = fixture();
    assert.throws(() => new StrataImageContextCache({ ...options, contextCacheDirectory: 'relative' }), /absolute/);
    assert.throws(() => new StrataImageContextCache({ ...options, filename: '../other.bin' }), /filename/);
    state.size = 11;
    await assert.rejects(cache.save(), /exactly 12 bytes/);
    assert.equal(cache.hasSavedSnapshot, false);
});

test('failed restore retains snapshot and prevents later overwrite', async () => {
    const { cache, state, calls } = fixture();
    await cache.save();
    state.restoreTokens++;
    await assert.rejects(cache.restore(), /counts do not match/);
    await assert.rejects(cache.save(), /earlier Strata image context snapshot remains/);
    assert.deepEqual(calls, ['save', 'restore']);
});

test('root-owned sticky shared directory is accepted while unsafe directories and files are rejected', async () => {
    const sticky = fixture();
    sticky.state.dirUid = 0;
    sticky.state.dirMode = 0o1777;
    await sticky.cache.save();
    await sticky.cache.restore();
    for (const change of [state => { state.dirMode = 0o777; }, state => { state.dirUid = 200; state.dirMode = 0o1777; }, state => { state.fileUid = 200; }, state => { state.fileMode = 0o644; }]) {
        const { cache, state } = fixture();
        change(state);
        await assert.rejects(cache.save(), /directory|private regular file/i);
    }
});

test('cache client defaults to /tmp when no directory is supplied', () => {
    const { options } = fixture();
    delete options.contextCacheDirectory;
    const cache = new StrataImageContextCache(options);
    assert.equal(cache.directory, '/tmp');
});

test('system /tmp passes directory validation with its actual ownership and mode', async () => {
    const cache = new StrataImageContextCache({ endpoint: 'http://127.0.0.1:8080/v1', model: 'model', filename: 'strata_image_cache_1.bin', ensureRuntimeReady: async () => ({}) });
    await cache.validateDirectory();
});
