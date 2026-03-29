const test = require('node:test');
const assert = require('node:assert/strict');

const Region = require('../Region.js');
const Location = require('../Location.js');

test('Location.regionId reassigns region membership and repairs the old entrance', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const sourceRegion = new Region({
            id: 'test-source-region',
            name: 'Anchorpoint Station',
            description: 'A ramshackle orbital station.'
        });
        const destinationRegion = new Region({
            id: 'test-destination-region',
            name: 'Derelict Sector',
            description: 'A drifting wreck field.'
        });

        const fallbackLocation = new Location({
            id: 'test-source-fallback-location',
            name: 'Docking Bay 7',
            description: 'A noisy salvage dock.',
            regionId: sourceRegion.id
        });
        createdLocations.push(fallbackLocation);

        const vehicleLocation = new Location({
            id: 'test-vehicle-location',
            name: 'Drift-Hopper "Mourning Star"',
            description: 'A compact salvage shuttle.',
            regionId: sourceRegion.id,
            vehicleInfo: {
                currentDestination: null,
                vehicleExitId: 'test-vehicle-exit'
            }
        });
        createdLocations.push(vehicleLocation);

        sourceRegion.entranceLocationId = vehicleLocation.id;

        vehicleLocation.regionId = destinationRegion.id;

        assert.equal(vehicleLocation.regionId, destinationRegion.id);
        assert.equal(sourceRegion.locationIds.includes(vehicleLocation.id), false);
        assert.equal(destinationRegion.locationIds.includes(vehicleLocation.id), true);
        assert.equal(sourceRegion.entranceLocationId, fallbackLocation.id);
    } finally {
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});

test('Location.regionId can recover from a stale missing previous region during reassignment', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const destinationRegion = new Region({
            id: 'test-stale-destination-region',
            name: 'The Mirror Wake',
            description: 'A ghost-lit drift corridor.'
        });

        const location = new Location({
            id: 'test-stale-region-location',
            name: 'Wayward Skiff',
            description: 'A vehicle location carrying stale region state.',
            regionId: 'missing-prior-region',
            checkRegionId: false
        });
        createdLocations.push(location);

        location.regionId = destinationRegion.id;

        assert.equal(location.regionId, destinationRegion.id);
        assert.equal(destinationRegion.locationIds.includes(location.id), true);
    } finally {
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});

test('Location.regionId reapplies the declared region to restore missing membership', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const region = new Region({
            id: 'test-membership-repair-region',
            name: 'Broken Compass Reach',
            description: 'A region used to validate membership repair.'
        });

        const location = new Location({
            id: 'test-membership-repair-location',
            name: 'Stormglass Dock',
            description: 'A location with manually damaged region membership.',
            regionId: region.id
        });
        createdLocations.push(location);

        region.removeLocationId(location.id);
        assert.equal(region.locationIds.includes(location.id), false);

        location.regionId = region.id;

        assert.equal(location.regionId, region.id);
        assert.equal(region.locationIds.includes(location.id), true);
    } finally {
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});
