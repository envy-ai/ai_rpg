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
