const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const Utils = require('../Utils.js');
const {
    withBaseHealthOnly
} = require('./helpers/needBarFixtures.js');
const {
    resetWorldState,
    removeLocationsFromIndex,
    createSceneSummariesStub,
    createSerializationContext,
    createHydrationContext
} = require('./helpers/locationFixtures.js');

test('Location favorites persist through toJSON and constructor hydration', () => {
    const region = new Region({
        id: `test-favorite-region-${Date.now()}`,
        name: 'Favorite Test Region',
        description: 'A region used to test favorite location persistence.'
    });
    const location = new Location({
        id: `test-favorite-location-${Date.now()}`,
        name: 'Marked Plaza',
        description: 'A location with a favorite marker.',
        regionId: region.id,
        favorite: true
    });

    try {
        assert.equal(location.favorite, true);
        assert.equal(location.toJSON().favorite, true);

        const hydrated = new Location({
            ...location.toJSON(),
            id: `test-favorite-location-hydrated-${Date.now()}`,
            regionId: region.id
        });

        try {
            assert.equal(hydrated.favorite, true);
            assert.equal(hydrated.getSummary().favorite, true);
        } finally {
            removeLocationsFromIndex([hydrated]);
        }
    } finally {
        removeLocationsFromIndex([location]);
        resetWorldState();
    }
});

test('Utils.hydrateGameState restores saved location favorites and defaults old saves to false', () => {
    const previousConfig = Globals.config;
    const previousSceneSummaries = Globals.sceneSummaries;
    const sourceLocations = [];
    const hydratedLocations = [];

    resetWorldState();
    Globals.config = withBaseHealthOnly(previousConfig);
    Globals.sceneSummaries = createSceneSummariesStub();

    try {
        const region = new Region({
            id: 'test-hydrate-favorite-region',
            name: 'Favorite Hydration Region',
            description: 'A region used to test save hydration for favorites.'
        });

        const marked = new Location({
            id: 'test-hydrate-favorite-location',
            name: 'Remembered Market',
            description: 'A marked location.',
            regionId: region.id,
            favorite: true
        });
        const legacy = new Location({
            id: 'test-hydrate-legacy-favorite-location',
            name: 'Old Save Alley',
            description: 'A location serialized before favorites existed.',
            regionId: region.id
        });
        sourceLocations.push(marked, legacy);

        const serialized = Utils.serializeGameState(createSerializationContext({
            gameLocations: new Map(sourceLocations.map(location => [location.id, location])),
            regions: new Map([[region.id, region]])
        }));

        delete serialized.gameWorld.locations[legacy.id].favorite;

        removeLocationsFromIndex(sourceLocations);
        resetWorldState();

        const gameLocations = new Map();
        Utils.hydrateGameState(serialized, createHydrationContext({ gameLocations }));
        hydratedLocations.push(...gameLocations.values());

        const restoredMarked = Array.from(gameLocations.values()).find(location => location.name === marked.name);
        const restoredLegacy = Array.from(gameLocations.values()).find(location => location.name === legacy.name);

        assert.ok(restoredMarked, 'marked location should hydrate');
        assert.ok(restoredLegacy, 'legacy location should hydrate');
        assert.equal(restoredMarked.favorite, true);
        assert.equal(restoredLegacy.favorite, false);
    } finally {
        Globals.config = previousConfig;
        Globals.sceneSummaries = previousSceneSummaries;
        removeLocationsFromIndex(sourceLocations);
        removeLocationsFromIndex(hydratedLocations);
        resetWorldState();
    }
});
