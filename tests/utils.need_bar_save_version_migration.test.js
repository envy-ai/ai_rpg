const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Utils = require('../Utils.js');

function resetWorldState() {
    Player.clearRuntimeRegistries();
    Region.clear();
}

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

function createSerializedSave(saveFileSaveVersion) {
    const metadata = {};
    if (saveFileSaveVersion !== undefined) {
        metadata.saveFileSaveVersion = saveFileSaveVersion;
    }

    return {
        gameWorld: {
            locations: {},
            locationExits: {},
            regions: {}
        },
        chatHistory: [],
        generatedImages: {},
        things: {},
        players: {
            'legacy-save-player': {
                id: 'legacy-save-player',
                name: 'Baato',
                isNPC: false,
                currentLocation: null,
                needBars: [
                    { id: 'food', value: 7 },
                    { id: 'rest', value: 42 }
                ],
                needBarApplicability: {
                    food: true,
                    rest: true
                }
            },
            'legacy-save-npc': {
                id: 'legacy-save-npc',
                name: 'Cabnia Slatherbottom',
                isNPC: true,
                currentLocation: null,
                needBars: [
                    { id: 'stamina', value: 33 }
                ],
                needBarApplicability: {
                    stamina: true
                }
            }
        },
        factions: {},
        skills: [],
        metadata,
        setting: null,
        chatSummaries: {},
        sceneSummaries: {},
        pendingRegionStubs: {},
        worldTime: null,
        calendarDefinition: null,
        gameConfigOverrideYaml: ''
    };
}

test('Utils.hydrateGameState multiplies pre-1.1 save need bar values by 10 and bumps metadata version', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousSceneSummaries = Globals.sceneSummaries;

    resetWorldState();
    Globals.baseDir = path.resolve(__dirname, '..');
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
    Globals.sceneSummaries = {
        serialize() {
            return {};
        },
        load() {}
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const serialized = createSerializedSave(1);
        const context = createHydrationContext();

        const hydrationResult = Utils.hydrateGameState(serialized, context);
        const player = context.players.get('legacy-save-player');
        const npc = context.players.get('legacy-save-npc');

        assert.equal(hydrationResult.metadata.saveFileSaveVersion, 1.1);
        assert.equal(player.getNeedBarValue('food'), 70);
        assert.equal(player.getNeedBarValue('rest'), 420);
        assert.equal(npc.getNeedBarValue('stamina'), 330);
    } finally {
        resetWorldState();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Globals.sceneSummaries = previousSceneSummaries;
        Player.reloadDefinitionCaches({ refreshInstances: false });
    }
});

test('Utils.hydrateGameState leaves 1.1 save need bar values unchanged', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousSceneSummaries = Globals.sceneSummaries;

    resetWorldState();
    Globals.baseDir = path.resolve(__dirname, '..');
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
    Globals.sceneSummaries = {
        serialize() {
            return {};
        },
        load() {}
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const serialized = createSerializedSave(1.1);
        const context = createHydrationContext();

        const hydrationResult = Utils.hydrateGameState(serialized, context);
        const player = context.players.get('legacy-save-player');
        const npc = context.players.get('legacy-save-npc');

        assert.equal(hydrationResult.metadata.saveFileSaveVersion, 1.1);
        assert.equal(player.getNeedBarValue('food'), 7);
        assert.equal(player.getNeedBarValue('rest'), 42);
        assert.equal(npc.getNeedBarValue('stamina'), 33);
    } finally {
        resetWorldState();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Globals.sceneSummaries = previousSceneSummaries;
        Player.reloadDefinitionCaches({ refreshInstances: false });
    }
});
