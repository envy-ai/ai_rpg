const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadTravelProseDestinationResolver({ locations = [], regions = [] } = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('const resolveLocationByIdOrName = (value) => {');
    const end = source.indexOf('\n        const normalizeTravelDestinationComparisonKey', start);
    assert.notEqual(start, -1, 'Unable to locate resolveLocationByIdOrName.');
    assert.notEqual(end, -1, 'Unable to locate travel destination resolver end.');

    const locationMap = new Map(locations.map(location => [location.id, location]));
    const regionMap = new Map(regions.map(region => [region.id, region]));
    const context = {
        gameLocations: locationMap,
        regions: regionMap,
        Location: {
            get: id => locationMap.get(id) || null,
            findByName: name => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locationMap.values()).find(location => (
                    String(location?.name || '').trim().toLowerCase() === normalized
                )) || null;
            }
        },
        Region: {
            getByName: name => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(regionMap.values()).find(region => (
                    String(region?.name || '').trim().toLowerCase() === normalized
                )) || null;
            }
        },
        createLocationCalls: [],
        createRegionStubCalls: [],
        createLocationFromEvent: async args => {
            context.createLocationCalls.push(args);
            return { id: 'created-location', name: args.name };
        },
        createRegionStubFromEvent: async args => {
            context.createRegionStubCalls.push(args);
            return {
                id: 'created-region-stub',
                name: args.name,
                isStub: true,
                stubMetadata: { targetRegionId: 'created-region' }
            };
        }
    };

    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.resolveTravelProseDestination = resolveTravelProseDestination;`,
        context
    );

    return context;
}

test('travelProse same-name region/location resolves existing location inside region', async () => {
    const location = { id: 'loc-player-farm', name: 'Player Farm' };
    const region = {
        id: 'region-player-farm',
        name: 'Player Farm',
        locationIds: [location.id],
        entranceLocationId: null
    };
    const context = loadTravelProseDestinationResolver({
        locations: [location],
        regions: [region]
    });

    const result = await context.resolveTravelProseDestination('Player Farm|Player Farm', {
        allowCreate: false
    });

    assert.equal(result.location, location);
    assert.equal(result.region, region);
});

test('travelProse same-name region/location falls back to region entrance when location is absent', async () => {
    const entrance = { id: 'loc-entrance', name: 'Farm Gate' };
    const region = {
        id: 'region-player-farm',
        name: 'Player Farm',
        locationIds: [entrance.id],
        entranceLocationId: entrance.id
    };
    const context = loadTravelProseDestinationResolver({
        locations: [entrance],
        regions: [region]
    });

    const result = await context.resolveTravelProseDestination('Player Farm|Player Farm', {
        allowCreate: false
    });

    assert.equal(result.location, entrance);
    assert.equal(result.region, region);
});

test('travelProse same-name unknown region does not create duplicate same-name location', async () => {
    const context = loadTravelProseDestinationResolver();

    const result = await context.resolveTravelProseDestination('New Farm|New Farm', {
        allowCreate: true,
        originLocation: { id: 'origin', name: 'Origin' }
    });

    assert.equal(result.location.id, 'created-region-stub');
    assert.equal(context.createRegionStubCalls.length, 1);
    assert.equal(context.createLocationCalls.length, 0);
});
