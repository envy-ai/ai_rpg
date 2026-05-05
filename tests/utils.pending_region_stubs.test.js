const test = require('node:test');
const assert = require('node:assert/strict');

const Utils = require('../Utils.js');

test('rebuildPendingRegionStubs preserves member location ids for pending regions', () => {
    const pendingRegionStubs = new Map([
        ['pending_hedge', {
            id: 'pending_hedge',
            name: 'Hedge Maze',
            locationIds: ['loc_existing'],
        }],
    ]);
    const gameLocations = new Map([
        ['loc_hidden', {
            id: 'loc_hidden',
            name: 'Hidden Garden',
            isStub: true,
            regionId: 'pending_hedge',
            stubMetadata: {
                regionId: 'pending_hedge',
                regionName: 'Hedge Maze',
            },
        }],
    ]);

    Utils.rebuildPendingRegionStubs({
        pendingRegionStubs,
        regions: new Map(),
        gameLocations,
        gameLocationExits: new Map(),
    });

    assert.deepEqual(
        pendingRegionStubs.get('pending_hedge').locationIds.sort(),
        ['loc_existing', 'loc_hidden'].sort(),
    );
});

test('mergeDuplicatePendingRegionStubs carries member locations onto canonical pending region', () => {
    const pendingRegionStubs = new Map([
        ['pending_a', {
            id: 'pending_a',
            name: 'Hedge Maze',
            originalName: 'Hedge Maze',
            entranceStubId: 'entry_a',
            locationIds: ['loc_a'],
            createdAt: '2026-01-01T00:00:00.000Z',
        }],
        ['pending_b', {
            id: 'pending_b',
            name: 'Hedge Maze',
            originalName: 'Hedge Maze',
            entranceStubId: 'entry_b',
            locationIds: ['loc_b'],
            createdAt: '2026-01-02T00:00:00.000Z',
        }],
    ]);
    const locB = {
        id: 'loc_b',
        name: 'Hidden Garden',
        isStub: true,
        regionId: 'pending_b',
        stubMetadata: { regionId: 'pending_b', regionName: 'Hedge Maze' },
    };
    const gameLocations = new Map([
        ['entry_a', {
            id: 'entry_a',
            name: 'Hedge Maze',
            isStub: true,
            stubMetadata: { isRegionEntryStub: true, targetRegionId: 'pending_a' },
        }],
        ['entry_b', {
            id: 'entry_b',
            name: 'Hedge Maze',
            isStub: true,
            stubMetadata: { isRegionEntryStub: true, targetRegionId: 'pending_b' },
        }],
        ['loc_a', {
            id: 'loc_a',
            name: 'Garden Gate',
            isStub: true,
            regionId: 'pending_a',
            stubMetadata: { regionId: 'pending_a', regionName: 'Hedge Maze' },
        }],
        ['loc_b', locB],
    ]);

    Utils.mergeDuplicatePendingRegionStubs({
        pendingRegionStubs,
        regions: new Map(),
        gameLocations,
        gameLocationExits: new Map(),
    });

    assert.equal(pendingRegionStubs.has('pending_b'), false);
    assert.deepEqual(
        pendingRegionStubs.get('pending_a').locationIds.sort(),
        ['loc_a', 'loc_b'].sort(),
    );
    assert.equal(locB.regionId, 'pending_a');
    assert.equal(locB.stubMetadata.regionId, 'pending_a');
});
