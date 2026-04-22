const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const Utils = require('../Utils.js');

function createRegion() {
    return new Region({
        id: `region_generation_hints_${Date.now()}_${Math.random()}`,
        name: 'Generation Hint Test Region',
        description: 'A region for testing location generation hints.'
    });
}

test('Location generationHints persist through toJSON and constructor hydration', () => {
    const region = createRegion();
    const location = new Location({
        id: `location_generation_hints_${Date.now()}_${Math.random()}`,
        name: 'Covered Arcade',
        description: 'A roofed arcade protected from rain.',
        regionId: region.id,
        generationHints: {
            numItems: 2,
            numScenery: 3,
            numNpcs: 1,
            numHostiles: 0,
            hasWeather: false
        }
    });

    const serialized = location.toJSON();

    assert.deepEqual(serialized.generationHints, {
        numItems: 2,
        numScenery: 3,
        numNpcs: 1,
        numHostiles: 0,
        hasWeather: 'no'
    });

    const hydrated = new Location({
        ...serialized,
        id: `location_generation_hints_hydrated_${Date.now()}_${Math.random()}`,
        regionId: region.id,
        checkRegionId: true
    });

    assert.deepEqual(hydrated.generationHints, {
        numItems: 2,
        numScenery: 3,
        numNpcs: 1,
        numHostiles: 0,
        hasWeather: 'no'
    });
});

test('Utils.hydrateGameState normalizes legacy boolean hasWeather fields on saved location stubs', () => {
    const previousSceneSummaries = Globals.sceneSummaries;
    Globals.sceneSummaries = {
        serialize() {
            return {};
        },
        load() {}
    };

    try {
        const serialized = {
            gameWorld: {
                locations: {
                    'legacy-weather-stub': {
                        id: 'legacy-weather-stub',
                        name: 'Legacy Weather Stub',
                        regionId: 'legacy-weather-region',
                        isStub: true,
                        stubMetadata: {
                            blueprintDescription: 'A legacy stub with boolean weather metadata.',
                            hasWeather: true,
                            locationHasWeather: false
                        },
                        generationHints: {
                            hasWeather: true
                        },
                        exits: {}
                    }
                },
                locationExits: {},
                regions: {
                    'legacy-weather-region': {
                        id: 'legacy-weather-region',
                        name: 'Legacy Weather Region',
                        description: 'A region for legacy weather hydration.',
                        locations: [],
                        locationIds: ['legacy-weather-stub']
                    }
                }
            },
            chatHistory: [],
            generatedImages: {},
            things: {},
            players: {},
            factions: {},
            skills: [],
            metadata: {
                saveFileSaveVersion: 1.1
            },
            setting: null,
            chatSummaries: {},
            sceneSummaries: {},
            pendingRegionStubs: {},
            worldTime: null,
            calendarDefinition: null,
            gameConfigOverrideYaml: ''
        };
        const gameLocations = new Map();

        Utils.hydrateGameState(serialized, {
            gameLocations,
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
        });

        const hydrated = gameLocations.get('legacy-weather-stub');
        assert.equal(hydrated.generationHints.hasWeather, 'yes');
        assert.equal(hydrated.stubMetadata.hasWeather, 'yes');
        assert.equal(hydrated.stubMetadata.locationHasWeather, 'no');
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
        Location.removeFromIndex('legacy-weather-stub');
        Region.removeFromIndex('legacy-weather-region');
    }
});
