'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runDomainIdMigration } = require('../DomainIdMigrationRuntime.js');

function harness(overrides = {}) {
    const calls = [];
    const original = { player: { id: 'char_1', pending: [{ abilityId: 'ability_1' }] } };
    const migrated = { player: { id: 'char_mira', pending: [{ abilityId: 'ability_focus' }] } };
    let state = structuredClone(original);
    const options = {
        assertSupported: () => calls.push('supported'),
        acquireBarrier: () => { calls.push('barrier'); return () => calls.push('release'); },
        cancelAndDrain: async () => calls.push('cancel'),
        capture: () => { calls.push('capture'); return structuredClone(state); },
        prepare: () => { calls.push('prepare'); return { serialized: migrated, counts: { char: 1 } }; },
        writeBackup: async snapshot => { calls.push('backup'); assert.deepEqual(snapshot, original); return '/backup'; },
        install: async snapshot => { calls.push('install'); state = structuredClone(snapshot); },
        notify: async () => calls.push('notify'),
        ...overrides
    };
    return { options, calls, original, migrated, state: () => state, setState: value => { state = value; } };
}

test('migration backs up before install and retains pending data under one barrier', async () => {
    const h = harness();
    const result = await runDomainIdMigration(h.options);
    assert.deepEqual(h.state(), h.migrated);
    assert.deepEqual(result, { counts: { char: 1 }, backupPath: '/backup' });
    assert.deepEqual(h.calls, ['supported', 'barrier', 'cancel', 'supported', 'capture', 'prepare', 'backup', 'install', 'capture', 'notify', 'release']);
});

test('preflight and backup failure do not install and always release the barrier', async () => {
    for (const failurePoint of ['prepare', 'writeBackup']) {
        const h = harness({ [failurePoint]: () => { throw new Error(`${failurePoint} failed`); } });
        await assert.rejects(runDomainIdMigration(h.options), new RegExp(`${failurePoint} failed`));
        assert.deepEqual(h.state(), h.original);
        assert.ok(!h.calls.includes('install'));
        assert.equal(h.calls.at(-1), 'release');
    }
});

test('installation failure restores original, and rollback failure retains both causes', async () => {
    const h = harness();
    let attempts = 0;
    h.options.install = async snapshot => {
        h.calls.push('install');
        if (++attempts === 1) { h.setState({ damaged: true }); throw new Error('install failed'); }
        h.setState(snapshot);
    };
    await assert.rejects(runDomainIdMigration(h.options), error => error.cause?.message === 'install failed' && error.backupPath === '/backup');
    assert.deepEqual(h.state(), h.original);
    assert.equal(h.calls.at(-1), 'release');
    const failed = harness({ install: async () => { throw new Error('install or rollback failed'); } });
    await assert.rejects(runDomainIdMigration(failed.options), error => error instanceof AggregateError && error.errors.length === 2 && error.backupPath === '/backup');
    assert.equal(failed.calls.at(-1), 'release');
});

test('notification failure reports committed migration without rolling back', async () => {
    const h = harness({ notify: async () => { throw new Error('socket failed'); } });
    await assert.rejects(runDomainIdMigration(h.options), error => error.migrationCommitted === true && error.cause?.message === 'socket failed' && error.backupPath === '/backup');
    assert.deepEqual(h.state(), h.migrated);
    assert.equal(h.calls.filter(call => call === 'install').length, 1);
    assert.equal(h.calls.at(-1), 'release');
});

test('migration slash command invokes runtime and returns reload action with backup', async () => {
    const command = require('../slashcommands/migrate_ids.js');
    assert.deepEqual(command.aliases, ['migrate_domain_ids']);
    await assert.rejects(command.execute({ argsText: 'unexpected', migrateDomainIds: () => { throw new Error('must not run'); } }), /argument/i);
    let reply;
    await command.execute({ migrateDomainIds: async () => ({ counts: { char: 2 }, backupPath: '/backup' }), reply: async value => { reply = value; } });
    assert.match(reply.content, /char: 2/);
    assert.match(reply.content, /\/backup/);
    assert.deepEqual(reply.action, { type: 'reload_page', delayMs: 500 });
});

test('live gear items are checked as their serialized representation on install and rollback', async () => {
    class GearItem {
        #id;
        constructor(id) { this.#id = id; }
        get id() { return this.#id; }
        toJSON() { return { id: this.#id, name: 'Lens' }; }
    }
    const h = harness();
    let state = { player: { gear: { 'Right hand': { item: new GearItem('thing_old') } } } };
    h.options.capture = () => state;
    h.options.prepare = snapshot => ({ serialized: { player: { gear: { 'Right hand': { item: { ...snapshot.player.gear['Right hand'].item, id: 'thing_lens' } } } } }, counts: { thing: 1 } });
    h.options.writeBackup = async () => '/backup';
    h.options.install = async snapshot => { state = { player: { gear: { 'Right hand': { item: new GearItem(snapshot.player.gear['Right hand'].item.id) } } } }; };
    await runDomainIdMigration(h.options);
    assert.equal(state.player.gear['Right hand'].item.id, 'thing_lens');

    state = { player: { gear: { 'Right hand': { item: new GearItem('thing_old') } } } };
    let attempt = 0;
    const install = h.options.install;
    h.options.install = async snapshot => { await install(snapshot); if (++attempt === 1) throw new Error('install failed'); };
    await assert.rejects(runDomainIdMigration(h.options), /original runtime was restored/);
    assert.equal(state.player.gear['Right hand'].item.id, 'thing_old');
});

test('snapshot verification still rejects a genuinely dropped serialized field', async () => {
    const h = harness();
    h.options.install = async snapshot => { delete snapshot.player.pending; h.setState(snapshot); };
    await assert.rejects(runDomainIdMigration(h.options), error => error instanceof AggregateError && error.errors.every(item => /pending/.test(item.message)));
});

test('native setting timestamp restoration preserves the captured migration snapshot', () => {
    const SettingInfo = require('../SettingInfo.js');
    const saved = new SettingInfo({ name: 'Archive' }).toJSON();
    saved.createdAt = '2020-01-02T03:04:05.000Z';
    saved.lastUpdated = '2021-02-03T04:05:06.000Z';
    const rehydrated = SettingInfo.fromJSON(saved);
    rehydrated.restoreSavedTimestamps(saved);
    assert.equal(rehydrated.toJSON().createdAt, saved.createdAt);
    assert.equal(rehydrated.toJSON().lastUpdated, saved.lastUpdated);
});
