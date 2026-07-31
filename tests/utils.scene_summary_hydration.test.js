const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');
const SceneSummaries = require('../SceneSummaies.js');

function createHydrationContext() {
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
        jobQueue: [],
        imageJobs: new Map(),
        pendingLocationImages: new Map(),
        npcGenerationPromises: new Map(),
        pendingRegionStubs: new Map()
    };
}

function createSerializedSave(sceneSummaries) {
    return {
        gameWorld: {
            locations: {},
            locationExits: {},
            regions: {}
        },
        chatHistory: [],
        generatedImages: {},
        things: {},
        players: {},
        factions: {},
        skills: [],
        mysteryBoxes: {},
        mysteryThreads: {},
        scheduledEvents: {},
        metadata: { saveFileSaveVersion: 1.2 },
        setting: null,
        chatSummaries: {},
        sceneSummaries,
        pendingRegionStubs: {},
        worldTime: null,
        calendarDefinition: null,
        gameConfigOverrideYaml: ''
    };
}

test('Utils hydration warns, clears incomplete scene summaries, and continues loading', () => {
    const previousSceneSummaries = Globals.sceneSummaries;
    const sceneSummaries = new SceneSummaries();
    const warnings = [];
    const originalWarn = console.warn;
    Globals.sceneSummaries = sceneSummaries;
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
        const result = Utils.hydrateGameState(
            createSerializedSave({
                scenes: [],
                entryIndexMap: [{ entryId: 'stale-entry', index: 1 }]
            }),
            createHydrationContext()
        );

        assert.ok(result);
        assert.deepEqual(sceneSummaries.serialize().scenes, []);
        assert.deepEqual(sceneSummaries.serialize().entryIndexMap, []);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /Ignoring invalid scene summary save data/);
        assert.match(warnings[0], /Scene summaries data is incomplete/);
    } finally {
        console.warn = originalWarn;
        Globals.sceneSummaries = previousSceneSummaries;
    }
});
