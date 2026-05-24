const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Globals = require('../Globals.js');
const IdGenerator = require('../IdGenerator.js');
const Utils = require('../Utils.js');
const ScheduledEvent = require('../ScheduledEvent.js');

function makeTempSaveDir() {
    const tmpRoot = path.join(process.cwd(), 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    return fs.mkdtempSync(path.join(tmpRoot, 'scheduled-event-save-'));
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

function makeScheduledEvent(overrides = {}) {
    return new ScheduledEvent({
        event: overrides.event || 'A signal flare launches over the harbor.',
        regionId: overrides.regionId || 'region-harbor',
        regionName: overrides.regionName || 'Harbor District',
        locationId: overrides.locationId || 'loc-crane-yard',
        locationName: overrides.locationName || 'Crane Yard',
        targetWorldMinute: overrides.targetWorldMinute ?? 120,
        targetWorldTime: overrides.targetWorldTime || { dayIndex: 0, timeMinutes: 120 },
        createdAtWorldMinute: overrides.createdAtWorldMinute ?? 10,
        createdAtWorldTime: overrides.createdAtWorldTime || { dayIndex: 0, timeMinutes: 10 },
        createdAt: overrides.createdAt || '2026-05-24T12:00:00.000Z',
        updatedAt: overrides.updatedAt || '2026-05-24T12:00:00.000Z'
    });
}

test('ScheduledEvent stores pending events, returns due events chronologically, and round-trips terminal states', () => {
    IdGenerator.reset();
    ScheduledEvent.clear();

    try {
        const late = makeScheduledEvent({
            event: 'The crane alarm starts ringing.',
            targetWorldMinute: 180,
            targetWorldTime: { dayIndex: 0, timeMinutes: 180 }
        });
        const early = makeScheduledEvent({
            event: 'The foghorn gives three short blasts.',
            targetWorldMinute: 60,
            targetWorldTime: { dayIndex: 0, timeMinutes: 60 }
        });

        assert.deepEqual(ScheduledEvent.getPendingDue(59), []);
        assert.deepEqual(ScheduledEvent.getPendingDue(180).map(event => event.id), [early.id, late.id]);

        early.markResolved({
            summary: 'The foghorn warned the harbor crews.',
            playerProse: 'Three short foghorn blasts roll across the crane yard.',
            worldMinute: 90,
            worldTime: { dayIndex: 0, timeMinutes: 90 }
        });
        late.markSkipped({
            worldMinute: 190,
            worldTime: { dayIndex: 0, timeMinutes: 190 }
        });

        assert.equal(early.status, 'resolved');
        assert.equal(late.status, 'skipped');
        assert.deepEqual(ScheduledEvent.getPendingDue(240), []);

        const serialized = ScheduledEvent.serializeAll();
        ScheduledEvent.clear();
        ScheduledEvent.loadAll(serialized);

        const loadedEarly = ScheduledEvent.getById(early.id);
        const loadedLate = ScheduledEvent.getById(late.id);
        assert.equal(loadedEarly.resolutionSummary, 'The foghorn warned the harbor crews.');
        assert.equal(loadedEarly.playerProse, 'Three short foghorn blasts roll across the crane yard.');
        assert.equal(loadedEarly.resolvedAtWorldMinute, 90);
        assert.deepEqual(loadedEarly.resolvedAtWorldTime, { dayIndex: 0, timeMinutes: 90 });
        assert.equal(loadedLate.status, 'skipped');
        assert.equal(loadedLate.resolvedAtWorldMinute, 190);
    } finally {
        ScheduledEvent.clear();
        IdGenerator.reset();
    }
});

test('serialized game state writes, loads, and hydrates scheduled events', () => {
    IdGenerator.reset();
    ScheduledEvent.clear();
    const saveDir = makeTempSaveDir();
    const previousSceneSummaries = Globals.sceneSummaries;

    try {
        Globals.sceneSummaries = {
            serialize: () => ({}),
            load: () => {}
        };
        const event = makeScheduledEvent({
            event: 'The crane alarm starts ringing.',
            targetWorldMinute: 180,
            targetWorldTime: { dayIndex: 0, timeMinutes: 180 }
        });

        Utils.writeSerializedGameState(saveDir, Utils.serializeGameState(emptySerializedContext()));

        ScheduledEvent.clear();
        const reloaded = Utils.loadSerializedGameState(saveDir);
        assert.ok(reloaded.scheduledEvents);
        Utils.hydrateGameState(reloaded, emptyHydrationContext());

        const restored = ScheduledEvent.getById(event.id);
        assert.ok(restored);
        assert.equal(restored.event, 'The crane alarm starts ringing.');
        assert.equal(restored.status, 'pending');
        assert.equal(restored.targetWorldMinute, 180);
        assert.deepEqual(restored.targetWorldTime, { dayIndex: 0, timeMinutes: 180 });
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
        fs.rmSync(saveDir, { recursive: true, force: true });
        ScheduledEvent.clear();
        IdGenerator.reset();
    }
});
