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
            hasWeather: 'sheltered'
        }
    });

    const serialized = location.toJSON();

    assert.deepEqual(serialized.generationHints, {
        numItems: 2,
        numScenery: 3,
        numNpcs: 1,
        numHostiles: 0,
        hasWeather: 'sheltered'
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
        hasWeather: 'sheltered'
    });
});

test('Utils.hydrateGameState converts legacy outside and boolean hasWeather fields', () => {
    const previousSceneSummaries = Globals.sceneSummaries;
    let hydratedRegionForCleanup = null;
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
                            hasWeather: 'outside',
                            locationHasWeather: false
                        },
                        generationHints: {
                            hasWeather: 'outside'
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
                        locationBlueprints: [{
                            name: 'Legacy Weather Stub',
                            description: 'A saved blueprint using the legacy weather value.',
                            shortDescription: 'A legacy weather blueprint.',
                            hasWeather: 'outside'
                        }],
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
        const regions = new Map();

        Utils.hydrateGameState(serialized, {
            gameLocations,
            gameLocationExits: new Map(),
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

        assert.equal(gameLocations.size, 1);
        const hydrated = Array.from(gameLocations.values())[0];
        assert.ok(hydrated);
        assert.equal(hydrated.generationHints.hasWeather, 'sheltered');
        assert.equal(hydrated.stubMetadata.hasWeather, 'sheltered');
        assert.equal(hydrated.stubMetadata.locationHasWeather, 'no');
        assert.equal(hydrated.toJSON().generationHints.hasWeather, 'sheltered');
        assert.equal(hydrated.toJSON().stubMetadata.hasWeather, 'sheltered');

        assert.equal(regions.size, 1);
        hydratedRegionForCleanup = Array.from(regions.values())[0];
        assert.ok(hydratedRegionForCleanup);
        assert.equal(hydratedRegionForCleanup.locationBlueprints[0].hasWeather, 'sheltered');
        assert.equal(hydratedRegionForCleanup.toJSON().locationBlueprints[0].hasWeather, 'sheltered');
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
        Location.clear();
        if (hydratedRegionForCleanup) {
            Region.removeFromIndex(hydratedRegionForCleanup);
        }
    }
});
