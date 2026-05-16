const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Utils = require('../Utils.js');
const Globals = require('../Globals.js');
const IdGenerator = require('../IdGenerator.js');
const MysteryBox = require('../MysteryBox.js');
const MysteryThread = require('../MysteryThread.js');

function makeTempSaveDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-mystery-thread-save-'));
}

function emptySerializedContext() {
    return {
        gameLocations: new Map(),
        gameLocationExits: new Map(),
        regions: new Map(),
        chatHistory: [],
        generatedImages: new Map(),
        things: new Map(),
        players: new Map(),
        skills: new Map(),
        factions: new Map(),
        pendingRegionStubs: new Map()
    };
}

function emptyHydrationContext() {
    return {
        gameLocations: new Map(),
        gameLocationExits: new Map(),
        regions: new Map(),
        chatHistoryRef: [],
        generatedImages: new Map(),
        things: new Map(),
        players: new Map(),
        skills: new Map(),
        factions: new Map(),
        pendingRegionStubs: new Map()
    };
}

test('MysteryThread creates searchable active continuity threads with contained boxes', () => {
    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();

    const box = new MysteryBox({
        name: 'Siphon Saboteur Identity',
        keys: ['Drask'],
        text: 'Kellen Drask is the siphoner.'
    });
    const thread = new MysteryThread({
        name: 'Skyhawk Furnace Siphoning',
        keys: ['furnace siphon', 'Drask'],
        status: 'active',
        summary: 'Drask is stealing vitality from the furnace.',
        constraints: ['Drask is the siphoner.', 'Vess is a separate Iron Lotus courier.'],
        boxIds: [box.id]
    });

    assert.equal(thread.id, 'mthread_1');
    assert.equal(MysteryThread.getByKey('furnace siphon'), thread);
    assert.equal(MysteryThread.getContainingBox(box.id), thread);
    assert.deepEqual(MysteryThread.getActive({ max: 2 }), [thread]);
    assert.deepEqual(thread.toJSON().boxIds, [box.id]);
});

test('MysteryThread manual edit replaces editable fields and box assignment', () => {
    IdGenerator.reset();
    MysteryThread.clear();

    const thread = new MysteryThread({
        name: 'Old Thread',
        keys: ['old key'],
        status: 'inactive',
        summary: 'Old summary.',
        constraints: ['Old constraint.'],
        boxIds: ['mystery_1']
    });

    thread.applyManualEdit({
        name: 'New Thread',
        keys: ['new key'],
        status: 'concluded',
        summary: 'New summary.',
        constraints: ['New constraint.'],
        boxIds: ['mystery_2', 'mystery_2', 'mystery_3']
    });

    assert.equal(thread.name, 'New Thread');
    assert.equal(thread.status, 'concluded');
    assert.deepEqual(thread.keys, ['New Thread', 'new key']);
    assert.equal(thread.summary, 'New summary.');
    assert.deepEqual(thread.constraints, ['New constraint.']);
    assert.deepEqual(thread.boxIds, ['mystery_2', 'mystery_3']);
    assert.equal(MysteryThread.getByKey('old key'), null);
    assert.equal(MysteryThread.getByKey('new key'), thread);
});

test('serialized game state writes and loads mystery threads', () => {
    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    const saveDir = makeTempSaveDir();
    const previousSceneSummaries = Globals.sceneSummaries;

    try {
        Globals.sceneSummaries = {
            serialize: () => ({}),
            load: () => {}
        };
        const box = new MysteryBox({
            name: 'Evidence Cache',
            text: 'The cache belongs to Drask.'
        });
        new MysteryThread({
            name: 'Skyhawk Furnace Siphoning',
            status: 'active',
            summary: 'Drask is stealing vitality.',
            constraints: ['The cache belongs to Drask.'],
            boxIds: [box.id]
        });

        Utils.writeSerializedGameState(saveDir, Utils.serializeGameState(emptySerializedContext()));

        MysteryBox.clear();
        MysteryThread.clear();
        const reloaded = Utils.loadSerializedGameState(saveDir);
        assert.ok(reloaded.mysteryThreads);
        Utils.hydrateGameState(reloaded, emptyHydrationContext());

        const restored = MysteryThread.getByKey('Skyhawk Furnace Siphoning');
        assert.ok(restored);
        assert.equal(restored.status, 'active');
        assert.deepEqual(restored.boxIds, [box.id]);
        assert.equal(MysteryThread.getContainingBox(box.id), restored);
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
        fs.rmSync(saveDir, { recursive: true, force: true });
        MysteryBox.clear();
        MysteryThread.clear();
    }
});

test('legacy saves with boxes and no threads hydrate into one inactive legacy thread', () => {
    IdGenerator.reset();
    MysteryBox.clear();
    MysteryThread.clear();
    const saveDir = makeTempSaveDir();
    const previousSceneSummaries = Globals.sceneSummaries;

    try {
        Globals.sceneSummaries = {
            serialize: () => ({}),
            load: () => {}
        };
        new MysteryBox({
            name: 'Legacy Mystery',
            text: 'Legacy hidden truth.'
        });

        const serialized = Utils.serializeGameState(emptySerializedContext());
        delete serialized.mysteryThreads;
        Utils.writeSerializedGameState(saveDir, serialized);
        fs.rmSync(path.join(saveDir, 'mysteryThreads.json'), { force: true });

        MysteryBox.clear();
        MysteryThread.clear();
        const reloaded = Utils.loadSerializedGameState(saveDir);
        assert.deepEqual(reloaded.mysteryThreads, {});
        Utils.hydrateGameState(reloaded, emptyHydrationContext());

        const legacy = MysteryThread.getByKey('Legacy Mystery Boxes');
        assert.ok(legacy);
        assert.equal(legacy.status, 'inactive');
        assert.deepEqual(legacy.boxIds, ['mystery_1']);
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
        fs.rmSync(saveDir, { recursive: true, force: true });
        MysteryBox.clear();
        MysteryThread.clear();
    }
});
