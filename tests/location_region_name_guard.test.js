const test = require('node:test');
const assert = require('node:assert/strict');
const { findLocationRegionNameConflict, assertNewLocationNameAvailable } = require('../LocationCreationNameGuard.js');

test('new location names reject normalized live and pending region names with useful alternatives', () => {
    const regions = new Map([['r1', { id: 'r1', name: 'The Northern  Reach' }]]);
    const pendingRegionStubs = new Map([['p1', { id: 'p1', name: 'West March', originalName: 'Old March', targetRegionName: 'Far March' }]]);
    for (const name of [' northern reach ', 'WEST   MARCH', ' old march ', 'far march']) {
        const options = { regions, pendingRegionStubs };
        assert.ok(findLocationRegionNameConflict(name, options), name);
        assert.throws(() => assertNewLocationNameAvailable(name, options), error => {
            assert.equal(error.code, 'location_region_name_conflict');
            assert.match(error.message, /region/i);
            assert.match(error.message, /travel.*region/i);
            assert.match(error.message, /different location/i);
            assert.match(error.message, /stay/i);
            return true;
        });
    }
    assert.equal(findLocationRegionNameConflict('Northern Reach Gate', { regions, pendingRegionStubs }), null);
    assert.doesNotThrow(() => assertNewLocationNameAvailable('Northern Reach Gate', { regions, pendingRegionStubs }));
});

const fs = require('node:fs');
const vm = require('node:vm');

function loadEventLocationCreator({ existing = null } = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function createLocationFromEvent({');
    const end = source.indexOf('\nasync function createRegionStubFromEvent(', start);
    assert.ok(start >= 0 && end > start);
    const counts = { allocated: 0, exits: 0, registered: 0, expanded: 0 };
    const region = { id: 'region_1', name: 'Old Harbor', addLocationId() { counts.registered++; } };
    const context = {
        console, assertNewLocationNameAvailable, regions: new Map([[region.id, region]]),
        pendingRegionStubs: new Map([['pending_1', { id: 'pending_1', name: 'Far March' }]]),
        gameLocations: new Map(), currentPlayer: null,
        findRegionByLocationId: () => region,
        findLocationByNameInRegionLoose: name => existing && require('../DuplicateNameUtils.js').normalizeDuplicateName(name) === require('../DuplicateNameUtils.js').normalizeDuplicateName(existing.name) ? existing : null,
        findLocationByNameLoose: name => existing && require('../DuplicateNameUtils.js').normalizeDuplicateName(name) === require('../DuplicateNameUtils.js').normalizeDuplicateName(existing.name) ? existing : null,
        resolveEventLocationStubLevelData: () => ({}),
        ensureExitConnection: () => { counts.exits++; },
        registerPendingRegionLocationId: () => { counts.registered++; },
        getActiveSettingSnapshot: () => ({}), normalizeDirection: value => value,
        directionKeyFromName: value => value, buildLocationEventStubMetadata: () => ({}),
        ensureLocationNameAllowed: async () => {},
        scheduleStubExpansion: async location => { counts.expanded++; return { location }; },
        Location: class { constructor(data) { counts.allocated++; Object.assign(this, data, { id: 'created' }); } }
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.createLocationFromEvent = createLocationFromEvent;`, context);
    return { context, counts, region };
}

test('event-created locations reject live and pending collisions before allocation, registration, or exits', async () => {
    const { context, counts } = loadEventLocationCreator();
    for (const name of [' OLD   harbor ', ' far march ']) {
        await assert.rejects(context.createLocationFromEvent({ name, originLocation: { id: 'origin' }, expandStub: false }), /already a region/i);
    }
    assert.deepEqual(counts, { allocated: 0, exits: 0, registered: 0, expanded: 0 });
    assert.equal(context.gameLocations.size, 0);
    const created = await context.createLocationFromEvent({ name: 'Harbor Gate', originLocation: { id: 'origin' }, expandStub: false });
    assert.equal(created.name, 'Harbor Gate');
    assert.deepEqual(counts, { allocated: 1, exits: 1, registered: 1, expanded: 0 });
});

test('existing same-name location is reused even when a region has that legacy name', async () => {
    const existing = { id: 'legacy', name: 'The Old  Harbor', isStub: false };
    const { context, counts } = loadEventLocationCreator({ existing });
    const result = await context.createLocationFromEvent({ name: '  old   HARBOR ', originLocation: { id: 'origin' }, expandStub: false });
    assert.equal(result, existing);
    assert.equal(counts.allocated, 0);
    assert.equal(counts.registered, 1);
});

test('generated location validation preserves legacy hydration and stub expansion', () => {
    const Region = require('../Region.js');
    const Location = require('../Location.js');
    Region.clear();
    Location.clear();
    try {
        const region = new Region({ id: 'region_legacy', name: 'Old Harbor', description: 'A harbor.' });
        const legacy = new Location({ id: 'loc_legacy', name: 'Old Harbor', regionId: region.id, description: 'Old description.', isStub: true, stubMetadata: {} });
        const saved = legacy.toJSON();
        Location.clear();
        const hydrated = new Location(saved);
        assert.equal(hydrated.name, 'Old Harbor');
        assert.equal(hydrated.id, 'loc_legacy');
        assert.equal(hydrated.toJSON().name, 'Old Harbor');
        const xml = '<location><name>Old Harbor</name><description>An expanded harbor.</description><shortDescription>harbor</shortDescription><baseLevel>1</baseLevel><dangerLevel>1</dangerLevel><hasWeather>yes</hasWeather></location>';
        assert.throws(() => Location.parseXMLSnippet(xml, { regionId: region.id }), /already a region/i);
        assert.equal(Location.getAll().length, 1);
        const parsed = Location.parseXMLSnippet(xml, { regionId: region.id, existingLocation: hydrated });
        assert.equal(Location.commitParsedSnippet(parsed), hydrated);
        assert.equal(hydrated.isStub, false);
        assert.equal(hydrated.name, 'Old Harbor');
    } finally {
        Location.clear();
        Region.clear();
    }
});
