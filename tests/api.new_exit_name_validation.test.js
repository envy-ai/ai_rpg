const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadNewExitNameValidationHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('function normalizeWorldEntityNameForConflict(value) {');
    const end = source.indexOf('\nmodule.exports = function registerApiRoutes', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate new-exit name validation helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = { Map, Set };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.validateNewExitWorldEntityName = validateNewExitWorldEntityName;`,
        context
    );
    return {
        validateNewExitWorldEntityName: context.validateNewExitWorldEntityName
    };
}

test('new exit name validation rejects duplicate location names with region context', () => {
    const { validateNewExitWorldEntityName } = loadNewExitNameValidationHelpers();
    const rejection = validateNewExitWorldEntityName({
        type: 'location',
        name: '  Clocktower Plaza  ',
        gameLocations: new Map([
            ['loc-clocktower', {
                id: 'loc-clocktower',
                name: 'Clocktower Plaza',
                regionId: 'region-old-town'
            }]
        ]),
        regions: new Map([
            ['region-old-town', { id: 'region-old-town', name: 'Old Town' }]
        ]),
        pendingRegionStubs: new Map(),
        bannedLocationNames: new Set(),
        slopWords: []
    });

    assert.equal(rejection?.reason, 'duplicate_location');
    assert.match(rejection.message, /Location name "Clocktower Plaza" conflicts with existing location "Clocktower Plaza"/);
    assert.match(rejection.message, /Old Town/);
    assert.match(rejection.message, /loc-clocktower/);
});

test('new exit name validation rejects cross-type region conflicts', () => {
    const { validateNewExitWorldEntityName } = loadNewExitNameValidationHelpers();
    const rejection = validateNewExitWorldEntityName({
        type: 'location',
        name: 'Ashen Coast',
        gameLocations: new Map(),
        regions: new Map([
            ['region-ashen-coast', { id: 'region-ashen-coast', name: 'Ashen Coast' }]
        ]),
        pendingRegionStubs: new Map(),
        bannedLocationNames: new Set(),
        slopWords: []
    });

    assert.equal(rejection?.reason, 'duplicate_region');
    assert.match(rejection.message, /Location name "Ashen Coast" conflicts with existing region "Ashen Coast"/);
    assert.match(rejection.message, /region-ashen-coast/);
});

test('new exit name validation rejects pending region stub conflicts', () => {
    const { validateNewExitWorldEntityName } = loadNewExitNameValidationHelpers();
    const rejection = validateNewExitWorldEntityName({
        type: 'region',
        name: 'Mirrorglass Fen',
        gameLocations: new Map(),
        regions: new Map(),
        pendingRegionStubs: new Map([
            ['pending-region-1', {
                id: 'pending-region-1',
                name: 'Mirrorglass Fen',
                entranceStubId: 'loc-region-entry'
            }]
        ]),
        bannedLocationNames: new Set(),
        slopWords: []
    });

    assert.equal(rejection?.reason, 'duplicate_pending_region');
    assert.match(rejection.message, /Region name "Mirrorglass Fen" conflicts with pending region "Mirrorglass Fen"/);
    assert.match(rejection.message, /pending-region-1/);
});

test('new exit name validation reports banned name fragments', () => {
    const { validateNewExitWorldEntityName } = loadNewExitNameValidationHelpers();
    const rejection = validateNewExitWorldEntityName({
        type: 'region',
        name: 'The Adventurer Hub Annex',
        gameLocations: new Map(),
        regions: new Map(),
        pendingRegionStubs: new Map(),
        bannedLocationNames: new Set(['adventurer hub']),
        slopWords: []
    });

    assert.equal(rejection?.reason, 'banned_name');
    assert.match(rejection.message, /Region name "The Adventurer Hub Annex" is not allowed/);
    assert.match(rejection.message, /banned name fragment "adventurer hub"/);
});

test('new exit name validation reports slop words as exact tokens', () => {
    const { validateNewExitWorldEntityName } = loadNewExitNameValidationHelpers();
    const rejection = validateNewExitWorldEntityName({
        type: 'location',
        name: 'Glimmering Tollgate',
        gameLocations: new Map(),
        regions: new Map(),
        pendingRegionStubs: new Map(),
        bannedLocationNames: new Set(),
        slopWords: ['glimmering']
    });

    assert.equal(rejection?.reason, 'slop_word');
    assert.match(rejection.message, /Location name "Glimmering Tollgate" is not allowed/);
    assert.match(rejection.message, /slop word "glimmering"/);
});

test('new exit route validates user-entered names before creating stubs', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const routeStart = source.indexOf("app.post('/api/locations/:id/exits'");
    const routeEnd = source.indexOf("app.delete('/api/locations/:id/exits/:exitId", routeStart);
    assert.notEqual(routeStart, -1);
    assert.notEqual(routeEnd, -1);
    const routeSource = source.slice(routeStart, routeEnd);

    const validationIndex = routeSource.indexOf('validateNewExitWorldEntityName({');
    const regionCreateIndex = routeSource.indexOf('createRegionStubFromEvent({');
    const locationCreateIndex = routeSource.indexOf('createLocationFromEvent({');

    assert(validationIndex > -1, 'route should call validateNewExitWorldEntityName');
    assert(regionCreateIndex > -1, 'route should create region stubs');
    assert(locationCreateIndex > -1, 'route should create location stubs');
    assert(validationIndex < regionCreateIndex, 'route should validate before region creation');
    assert(validationIndex < locationCreateIndex, 'route should validate before location creation');
    assert.match(routeSource, /code:\s*'invalid_world_entity_name'/);
});

test('server exposes banned and slop name lists to api routes', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const scopeStart = source.indexOf('const apiScope = {');
    const scopeEnd = source.indexOf('\n};', scopeStart);
    assert.notEqual(scopeStart, -1);
    assert.notEqual(scopeEnd, -1);
    const scopeSource = source.slice(scopeStart, scopeEnd);

    assert.match(scopeSource, /\bgetBannedLocationNameSet\b/);
    assert.match(scopeSource, /\bgetSlopWordList\b/);
});
