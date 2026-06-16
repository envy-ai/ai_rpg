const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolvePendingRegionEntryStubForTravelDestination
} = require('../api.js');

test('vehicle arrival destination inside pending region resolves its region-entry stub', () => {
    const regionEntryStub = {
        id: 'loc-region-entry',
        name: 'Northern Mountain Range',
        isStub: true,
        stubMetadata: {
            isRegionEntryStub: true,
            targetRegionId: 'region-northern-mountain-range'
        }
    };
    const destinationStub = {
        id: 'loc-installation-alpha',
        name: 'Installation Alpha',
        isStub: true,
        regionId: 'region-northern-mountain-range',
        stubMetadata: {
            regionId: 'region-northern-mountain-range'
        }
    };
    const pendingRegionStubs = new Map([
        ['region-northern-mountain-range', {
            id: 'region-northern-mountain-range',
            name: 'Northern Mountain Range',
            entranceStubId: regionEntryStub.id,
            locationIds: [destinationStub.id]
        }]
    ]);
    const gameLocations = new Map([
        [regionEntryStub.id, regionEntryStub],
        [destinationStub.id, destinationStub]
    ]);

    const resolved = resolvePendingRegionEntryStubForTravelDestination({
        destinationLocation: destinationStub,
        pendingRegionStubs,
        gameLocations
    });

    assert.equal(resolved, regionEntryStub);
});

test('vehicle arrival pending-region resolution honors explicit region entry context', () => {
    const explicitEntryStub = {
        id: 'loc-explicit-entry',
        isStub: true,
        stubMetadata: {
            isRegionEntryStub: true,
            targetRegionId: 'region-explicit'
        }
    };
    const destinationStub = {
        id: 'loc-child',
        isStub: true,
        stubMetadata: {
            regionId: 'region-explicit'
        }
    };

    const resolved = resolvePendingRegionEntryStubForTravelDestination({
        destinationLocation: destinationStub,
        regionEntryStub: explicitEntryStub,
        pendingRegionStubs: new Map(),
        gameLocations: new Map()
    });

    assert.equal(resolved, explicitEntryStub);
});
