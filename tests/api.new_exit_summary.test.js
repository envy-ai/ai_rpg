const test = require('node:test');
const assert = require('node:assert/strict');

const {
    formatNewExitDiscoveredSummaryDetail,
    buildNewExitDiscoveredSummaryMetadata,
} = require('../api.js');

test('new exit summary preserves legacy string details', () => {
    assert.equal(
        formatNewExitDiscoveredSummaryDetail('Copperwheel Gorge'),
        'Copperwheel Gorge',
    );
});

test('new exit summary omits route prefix when the origin is the current location', () => {
    assert.equal(
        formatNewExitDiscoveredSummaryDetail({
            name: 'Hidden Garden',
            kind: 'location',
            exitLocationName: 'Taproom',
            exitRegionName: 'Castle Grounds',
            destinationRegionName: 'Castle Grounds',
        }, {
            currentLocationName: 'Taproom',
            currentRegionName: 'Castle Grounds',
        }),
        'Hidden Garden',
    );
});

test('new exit summary shows source route for non-current same-region exits', () => {
    assert.equal(
        formatNewExitDiscoveredSummaryDetail({
            name: 'Hidden Garden',
            kind: 'location',
            exitLocationName: 'Old Gatehouse',
            exitRegionName: 'Castle Grounds',
            destinationRegionName: 'Castle Grounds',
        }, {
            currentLocationName: 'Taproom',
            currentRegionName: 'Castle Grounds',
        }),
        'Old Gatehouse -> Hidden Garden',
    );
});

test('new exit summary adds region labels when endpoints differ from current region', () => {
    assert.equal(
        formatNewExitDiscoveredSummaryDetail({
            name: 'Hidden Garden',
            kind: 'location',
            exitLocationName: 'Old Gatehouse',
            exitRegionName: 'Castle Grounds',
            destinationRegionName: 'Hedge Maze',
        }, {
            currentLocationName: 'Market Square',
            currentRegionName: 'Market Ward',
        }),
        'Old Gatehouse (Castle Grounds) -> Hidden Garden (Hedge Maze)',
    );
});

test('new exit summary uses region name for region exits without a destination location', () => {
    assert.equal(
        formatNewExitDiscoveredSummaryDetail({
            name: 'Copperwheel Gorge',
            kind: 'region',
            exitLocationName: 'Old Gatehouse',
            exitRegionName: 'Castle Grounds',
        }, {
            currentLocationName: 'Taproom',
            currentRegionName: 'Castle Grounds',
        }),
        'Old Gatehouse -> Copperwheel Gorge',
    );
});

test('new exit summary preserves destination location for region exits when provided', () => {
    assert.equal(
        formatNewExitDiscoveredSummaryDetail({
            name: 'Copperwheel Gorge',
            kind: 'region',
            destinationLocationName: 'Gorge Trailhead',
            destinationRegionName: 'Copperwheel Gorge',
            exitLocationName: 'Old Gatehouse',
            exitRegionName: 'Castle Grounds',
        }, {
            currentLocationName: 'Taproom',
            currentRegionName: 'Castle Grounds',
        }),
        'Old Gatehouse -> Gorge Trailhead (Copperwheel Gorge)',
    );
});

test('new exit summary metadata preserves map navigation ids', () => {
    assert.deepEqual(
        buildNewExitDiscoveredSummaryMetadata({
            name: 'Copperwheel Gorge',
            kind: 'region',
            destinationLocationName: 'Gorge Trailhead',
            destinationRegionName: 'Copperwheel Gorge',
            originLocationId: 'loc_gatehouse',
            originRegionId: 'region_castle',
            destinationId: 'loc_gorge_entry_stub',
            destinationRegionId: 'region_copperwheel',
            exitId: 'exit_gorge',
        }, 'Old Gatehouse -> Gorge Trailhead (Copperwheel Gorge)'),
        {
            label: 'Old Gatehouse -> Gorge Trailhead (Copperwheel Gorge)',
            destinationKind: 'region',
            originLocationId: 'loc_gatehouse',
            originLocationName: null,
            originRegionId: 'region_castle',
            originRegionName: null,
            destinationId: 'loc_gorge_entry_stub',
            destinationName: 'Gorge Trailhead',
            destinationLocationName: 'Gorge Trailhead',
            destinationRegionId: 'region_copperwheel',
            destinationRegionName: 'Copperwheel Gorge',
            exitId: 'exit_gorge',
        },
    );
});
