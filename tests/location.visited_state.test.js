const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Utils = require('../Utils.js');

function resetWorldState() {
    Player.clearRuntimeRegistries();
    Region.clear();
}

function removeLocationsFromIndex(locations) {
    for (const location of locations) {
        if (location) {
            Location.removeFromIndex(location);
        }
    }
}

test('Player.setLocation marks player destinations visited and records lastVisitedTime, but NPC moves do not', () => {
    const previousElapsedTime = Globals.elapsedTime;
    const previousConfig = Globals.config;
    const createdLocations = [];

    resetWorldState();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const region = new Region({
            id: 'test-visited-region',
            name: 'Anchorpoint',
            description: 'A test region for visit tracking.'
        });

        const playerDestination = new Location({
            id: 'test-player-visited-location',
            name: 'Docking Bay 7',
            description: 'A bright docking bay.',
            regionId: region.id
        });
        createdLocations.push(playerDestination);

        const npcDestination = new Location({
            id: 'test-npc-unvisited-location',
            name: 'Maintenance Duct',
            description: 'A narrow maintenance duct.',
            regionId: region.id
        });
        createdLocations.push(npcDestination);

        const player = new Player({
            id: 'test-player-visitor',
            name: 'Exis',
            location: null
        });
        const npc = new Player({
            id: 'test-npc-visitor',
            name: 'Dock Drone',
            isNPC: true,
            location: null
        });

        Globals.elapsedTime = 245;
        player.setLocation(playerDestination);

        assert.equal(playerDestination.visited, true);
        assert.equal(playerDestination.lastVisitedTime, 245);
        assert.equal(playerDestination.toJSON().lastVisitedTime, 245);

        Globals.elapsedTime = 300;
        npc.setLocation(npcDestination);

        assert.equal(npcDestination.visited, false);
        assert.equal(npcDestination.lastVisitedTime, null);
    } finally {
        Globals.elapsedTime = previousElapsedTime;
        Globals.config = previousConfig;
        removeLocationsFromIndex(createdLocations);
        resetWorldState();
    }
});

test('Utils.hydrateGameState infers visited state for legacy saves without a visited flag', () => {
    const previousConfig = Globals.config;
    const previousSceneSummaries = Globals.sceneSummaries;
    const sourceLocations = [];
    const hydratedLocations = [];

    resetWorldState();
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

    try {
        const region = new Region({
            id: 'test-hydrate-visited-region',
            name: 'Derelict Sector',
            description: 'A region used to test legacy visit hydration.'
        });

        const legacyExpanded = new Location({
            id: 'test-legacy-expanded-location',
            name: 'Cargo Spine',
            description: 'An already-expanded legacy location.',
            regionId: region.id
        });
        sourceLocations.push(legacyExpanded);

        const explicitUnvisited = new Location({
            id: 'test-explicit-unvisited-location',
            name: 'Sealed Vault',
            description: 'A location with an explicit unvisited flag.',
            regionId: region.id
        });
        sourceLocations.push(explicitUnvisited);

        const legacyStub = new Location({
            id: 'test-legacy-stub-location',
            name: 'Unknown Airlock',
            regionId: region.id,
            isStub: true,
            stubMetadata: {
                blueprintDescription: 'A stub destination.'
            }
        });
        sourceLocations.push(legacyStub);

        const serialized = Utils.serializeGameState({
            gameLocations: new Map(sourceLocations.map(location => [location.id, location])),
            gameLocationExits: new Map(),
            regions: new Map([[region.id, region]]),
            chatHistory: [],
            generatedImages: new Map(),
            things: new Map(),
            players: new Map(),
            skills: new Map(),
            factions: new Map(),
            pendingRegionStubs: new Map()
        });

        delete serialized.gameWorld.locations[legacyExpanded.id].visited;
        delete serialized.gameWorld.locations[legacyStub.id].visited;
        serialized.gameWorld.locations[explicitUnvisited.id].visited = false;

        removeLocationsFromIndex(sourceLocations);
        resetWorldState();

        const gameLocations = new Map();
        const gameLocationExits = new Map();
        const regions = new Map();

        Utils.hydrateGameState(serialized, {
            gameLocations,
            gameLocationExits,
            regions,
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
        });

        hydratedLocations.push(...gameLocations.values());

        assert.equal(gameLocations.get(legacyExpanded.id).visited, true);
        assert.equal(gameLocations.get(explicitUnvisited.id).visited, false);
        assert.equal(gameLocations.get(legacyStub.id).visited, false);
    } finally {
        Globals.config = previousConfig;
        Globals.sceneSummaries = previousSceneSummaries;
        removeLocationsFromIndex(sourceLocations);
        removeLocationsFromIndex(hydratedLocations);
        resetWorldState();
    }
});
