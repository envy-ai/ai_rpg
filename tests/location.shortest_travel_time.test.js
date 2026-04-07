const test = require('node:test');
const assert = require('node:assert/strict');

const Location = require('../Location.js');
const LocationExit = require('../LocationExit.js');
const Region = require('../Region.js');

function cleanupLocations(locations) {
    for (const location of locations) {
        if (location) {
            Location.removeFromIndex(location);
        }
    }
}

test('Location.findShortestTravelTimeMinutes returns 0 for the same location', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const region = new Region({
            id: 'test-shortest-path-same-region',
            name: 'Anchorpoint',
            description: 'A region for same-location path tests.'
        });

        const location = new Location({
            id: 'test-shortest-path-same-location',
            name: 'Central Platform',
            description: 'A central platform.',
            regionId: region.id
        });
        createdLocations.push(location);

        assert.equal(Location.findShortestTravelTimeMinutes(location, location.id), 0);
    } finally {
        cleanupLocations(createdLocations);
        Region.clear();
    }
});

test('Location.findShortestTravelTimeMinutes uses Dijkstra weighting across multi-hop cross-region routes', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const sourceRegion = new Region({
            id: 'test-shortest-path-source-region',
            name: 'Dockside',
            description: 'Source region.'
        });
        const destinationRegion = new Region({
            id: 'test-shortest-path-destination-region',
            name: 'Far Reach',
            description: 'Destination region.'
        });

        const start = new Location({
            id: 'test-shortest-path-start',
            name: 'Start',
            description: 'Starting point.',
            regionId: sourceRegion.id
        });
        const hopOne = new Location({
            id: 'test-shortest-path-hop-one',
            name: 'Hop One',
            description: 'First hop.',
            regionId: sourceRegion.id
        });
        const hopTwo = new Location({
            id: 'test-shortest-path-hop-two',
            name: 'Hop Two',
            description: 'Second hop.',
            regionId: destinationRegion.id
        });
        const destination = new Location({
            id: 'test-shortest-path-destination',
            name: 'Destination',
            description: 'Final destination.',
            regionId: destinationRegion.id
        });
        createdLocations.push(start, hopOne, hopTwo, destination);

        start.addExit('east', new LocationExit({
            description: 'Direct but slow route.',
            destination: destination.id,
            travelTimeMinutes: 10
        }));
        start.addExit('north', new LocationExit({
            description: 'Fast first hop.',
            destination: hopOne.id,
            travelTimeMinutes: 1
        }));
        hopOne.addExit('east', new LocationExit({
            description: 'Fast second hop.',
            destination: hopTwo.id,
            travelTimeMinutes: 1
        }));
        hopTwo.addExit('south', new LocationExit({
            description: 'Fast third hop.',
            destination: destination.id,
            travelTimeMinutes: 1
        }));

        assert.equal(Location.findShortestTravelTimeMinutes(start.id, destination), 3);
    } finally {
        cleanupLocations(createdLocations);
        Region.clear();
    }
});

test('Location.findShortestTravelTimeMinutes returns null when no path exists', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const region = new Region({
            id: 'test-shortest-path-disconnected-region',
            name: 'The Empty Quarter',
            description: 'A region for disconnected path tests.'
        });

        const start = new Location({
            id: 'test-shortest-path-disconnected-start',
            name: 'Start',
            description: 'A disconnected start location.',
            regionId: region.id
        });
        const destination = new Location({
            id: 'test-shortest-path-disconnected-destination',
            name: 'Destination',
            description: 'A disconnected destination location.',
            regionId: region.id
        });
        createdLocations.push(start, destination);

        assert.equal(Location.findShortestTravelTimeMinutes(start.id, destination.id), null);
    } finally {
        cleanupLocations(createdLocations);
        Region.clear();
    }
});

test('Location.findShortestTravelTimeMinutesByRegionAndLocationNames resolves exact region/location names', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const sourceRegion = new Region({
            id: 'test-shortest-path-by-name-source-region',
            name: 'Dockside',
            description: 'Source region.'
        });
        const destinationRegion = new Region({
            id: 'test-shortest-path-by-name-destination-region',
            name: 'Far Reach',
            description: 'Destination region.'
        });

        const start = new Location({
            id: 'test-shortest-path-by-name-start',
            name: 'West Gate',
            description: 'Starting point.',
            regionId: sourceRegion.id
        });
        const hop = new Location({
            id: 'test-shortest-path-by-name-hop',
            name: 'River Road',
            description: 'Middle route.',
            regionId: sourceRegion.id
        });
        const destination = new Location({
            id: 'test-shortest-path-by-name-destination',
            name: 'Signal Tower',
            description: 'Final destination.',
            regionId: destinationRegion.id
        });
        createdLocations.push(start, hop, destination);

        start.addExit('east', new LocationExit({
            description: 'To road',
            destination: hop.id,
            travelTimeMinutes: 4
        }));
        hop.addExit('east', new LocationExit({
            description: 'To tower',
            destination: destination.id,
            travelTimeMinutes: 6
        }));

        assert.equal(
            Location.findShortestTravelTimeMinutesByRegionAndLocationNames(
                'Dockside',
                'West Gate',
                'Far Reach',
                'Signal Tower'
            ),
            10
        );
    } finally {
        cleanupLocations(createdLocations);
        Region.clear();
    }
});

test('Location.findShortestTravelTimeMinutesByRegionAndLocationNames throws when a region-scoped location is missing', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const region = new Region({
            id: 'test-shortest-path-by-name-missing-region',
            name: 'Anchorpoint',
            description: 'A region for missing-name tests.'
        });
        const location = new Location({
            id: 'test-shortest-path-by-name-existing-location',
            name: 'Central Platform',
            description: 'An existing location.',
            regionId: region.id
        });
        createdLocations.push(location);

        assert.throws(
            () => Location.findShortestTravelTimeMinutesByRegionAndLocationNames(
                'Anchorpoint',
                'Missing Platform',
                'Anchorpoint',
                'Central Platform'
            ),
            /startLocation location "Missing Platform" was not found in region "Anchorpoint"\./
        );
    } finally {
        cleanupLocations(createdLocations);
        Region.clear();
    }
});
