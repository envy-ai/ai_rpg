const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Utils = require('../Utils.js');
const { withTempPlayerEnvironment } = require('./helpers/needBarFixtures.js');

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
        // Domain ID migration is an explicit separate operation; need scale migration preserves IDs.
        const player = context.players.get('legacy-save-player');
        const npc = context.players.get('legacy-save-npc');

        assert.equal(hydrationResult.metadata.saveFileSaveVersion, 1.1);
        assert.equal(player.id, 'legacy-save-player');
        assert.equal(npc.id, 'legacy-save-npc');
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
        assert.equal(player.id, 'legacy-save-player');
        assert.equal(npc.id, 'legacy-save-npc');
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

test('legacy scaled reference maximum preserves stamina fill when restored capacity changes', () => {
    const needBarsYaml = `
need_bars:
  rest:
    name: Rest
    player: true
    party: true
    non_party: true
    min: 0
    max: 1000
    initial: 1000
    effect_thresholds:
      1000:
        name: Fully Rested
        sentence: "%CHARACTER% is fully rested."
        status_effects:
          rested:
            name: Rested
            description: Rest expands stamina.
            need_bar_maximums:
              stamina:
                percent_modifier: 5
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 1000
    initial: 1000
`;
    withTempPlayerEnvironment({ prefix: 'need-save-scale-', needBarsYaml, manageWorldTime: true, currentPlayer: 'null' }, () => {
        const previousSummaries = Globals.sceneSummaries;
        Globals.sceneSummaries = { serialize: () => ({}), load() {} };
        try {
            const serialized = createSerializedSave(1);
            delete serialized.players['legacy-save-npc'];
            Object.assign(serialized.players['legacy-save-player'], { health: 10, maxHealth: 20,
                needBars: [{ id: 'rest', value: 100, min: 0, max: 100, baseMin: 0, baseMax: 100, baseCapacity: 100 },
                    { id: 'stamina', value: 50, min: 0, max: 100, baseMin: 0, baseMax: 100, baseCapacity: 100 }],
                needBarApplicability: { rest: true, stamina: true } });
            const context = createHydrationContext();
            Utils.hydrateGameState(serialized, context);
            const player = [...context.players.values()][0];
            Globals.currentPlayer = player;
            Player.finalizeNeedBarStateAfterWorldRestore();
            const stamina = player.getNeedBars().find(bar => bar.id === 'stamina');
            assert.equal(stamina.max, 1050);
            assert.equal(stamina.value, 525);
        } finally {
            Globals.sceneSummaries = previousSummaries;
        }
    });
});
