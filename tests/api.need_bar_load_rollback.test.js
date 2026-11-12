'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
const start = source.indexOf('        async function performGameLoad(');
const end = source.indexOf('\n        function assertDomainIdMigrationSupported()', start);
assert.ok(start >= 0 && end > start, 'native load function must be available');

for (const loaded of [true, false]) test(`failed need-bar hydration restores the ${loaded ? 'loaded world' : 'initial empty world'}`, async () => {
    const original = { world: loaded ? 'existing world' : null, gameConfigOverrideYaml: 'old-config' };
    const state = { current: structuredClone(original), released: false, installs: [], configs: [] };
    const failure = Object.assign(new Error('Invalid need-bar state in incoming save'), { code: 'NEED_BAR_STATE_INVALID' });
    const mapNames = ['imageJobs', 'activeImageJobs', 'entityImageJobs', 'pendingLocationImages', 'generatedImages', 'stubExpansionPromises', 'regionEntryExpansionPromises', 'npcGenerationPromises', 'playerAbilitySelectionPromises', 'playerImageGenerationPromises', 'locationImageGenerationPromises', 'factionImageGenerationPromises', 'levelUpAbilityPromises', 'shortDescriptionBackfillByClient', 'gameLocations', 'gameLocationExits', 'regions', 'things', 'players', 'skills', 'factions', 'pendingRegionStubs'];
    const context = {
        path, console, jobQueue: [], chatHistory: [], isProcessingJob: false,
        acquireRuntimeReplacement: () => () => { state.released = true; },
        cancelRuntimeForReplacement: async () => ({}),
        resolveSaveDirForRequest: () => ({ baseDir: '/fixture', normalizedName: 'bad-save', saveDir: '/fixture/bad-save', saveRootPath: '/fixture' }),
        assertSaveEnabledModsCompatible: () => {},
        captureDomainIdMigrationSnapshot: () => structuredClone(state.current),
        installDomainIdMigrationSnapshot: (snapshot, options) => { state.installs.push(options); state.current = structuredClone(snapshot); context.Globals.gameLoaded = options.gameLoaded; },
        Globals: { gameLoaded: loaded, reloadConfigAndDefs: options => state.configs.push(options) },
        Utils: { loadSerializedGameState: () => ({ metadata: {}, gameConfigOverrideYaml: 'incoming-config' }), hydrateGameState: () => { state.current = { world: 'partially loaded' }; throw failure; } }
    };
    for (const name of mapNames) context[name] = new Map();
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.load = performGameLoad;`, context);
    await assert.rejects(context.load('bad-save'), error => error === failure);
    assert.deepEqual(state.current, original);
    assert.equal(context.Globals.gameLoaded, loaded);
    assert.equal(state.installs.length, 1);
    assert.equal(state.installs[0].gameLoaded, loaded);
    assert.deepEqual(state.configs.map(entry => entry.gameConfigOverrideYaml), ['incoming-config', 'old-config']);
    assert.equal(state.released, true);
});
