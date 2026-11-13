const test = require('node:test');
const assert = require('node:assert/strict');
const Globals = require('../Globals.js');
const { withTempPlayerEnvironment } = require('./helpers/needBarFixtures.js');

test('player fixture retains its environment through async work and restores it on success or failure', async () => {
    const originalBase = Globals.baseDir;
    const originalConfig = Globals.config;
    assert.equal(withTempPlayerEnvironment({}, () => 'sync value'), 'sync value');
    assert.equal(Globals.baseDir, originalBase);
    assert.throws(() => withTempPlayerEnvironment({}, () => { throw new Error('sync failure'); }), /sync failure/);
    assert.equal(Globals.baseDir, originalBase);
    await withTempPlayerEnvironment({}, async () => {
        const fixtureBase = Globals.baseDir;
        await Promise.resolve();
        assert.equal(Globals.baseDir, fixtureBase);
        assert.notEqual(fixtureBase, originalBase);
    });
    assert.equal(Globals.baseDir, originalBase);
    await assert.rejects(withTempPlayerEnvironment({}, async () => {
        await Promise.resolve();
        assert.notEqual(Globals.baseDir, originalBase);
        throw new Error('async failure');
    }), /async failure/);
    assert.equal(Globals.baseDir, originalBase);
    assert.equal(Globals.config, originalConfig);
});
