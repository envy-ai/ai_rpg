const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadTravelProseTimeHelper({ shortestTravelTimeMinutes = null, findRegionByLocationId = () => null } = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('function locationContextRepresentsVehicle(location) {');
    const end = source.indexOf('\n        function buildFastTravelSummaryItem', start);
    assert.notEqual(start, -1, 'Unable to locate locationContextRepresentsVehicle.');
    assert.notEqual(end, -1, 'Unable to locate travel time helper block end.');

    const context = {
        findRegionByLocationId,
        Location: {
            findShortestTravelTimeMinutes(origin, destination) {
                context.shortestTravelTimeCalls.push({ origin, destination });
                return shortestTravelTimeMinutes;
            }
        },
        shortestTravelTimeCalls: []
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.resolvemoveTurnResultPlayerMoveTimeMinutes = resolvemoveTurnResultPlayerMoveTimeMinutes;`,
        context
    );
    return context;
}

test('travel prose player movement uses stored graph travel time', () => {
    const context = loadTravelProseTimeHelper({ shortestTravelTimeMinutes: 25 });
    const origin = { id: 'origin', name: 'Origin' };
    const destination = { id: 'destination', name: 'Destination' };

    const minutes = context.resolvemoveTurnResultPlayerMoveTimeMinutes({
        originLocation: origin,
        destinationLocation: destination,
        promptTravelTimeMinutes: 10
    });

    assert.equal(minutes, 25);
    assert.equal(context.shortestTravelTimeCalls.length, 1);
    assert.equal(context.shortestTravelTimeCalls[0].origin, origin);
    assert.equal(context.shortestTravelTimeCalls[0].destination, destination);
});

test('travel prose player movement falls back to prompt travel time', () => {
    const context = loadTravelProseTimeHelper({ shortestTravelTimeMinutes: null });

    const minutes = context.resolvemoveTurnResultPlayerMoveTimeMinutes({
        originLocation: { id: 'origin', name: 'Origin' },
        destinationLocation: { id: 'destination', name: 'Destination' },
        promptTravelTimeMinutes: 10
    });

    assert.equal(minutes, 10);
});

test('travel prose player movement suppresses explicit time advancement', () => {
    const context = loadTravelProseTimeHelper({ shortestTravelTimeMinutes: 25 });

    const minutes = context.resolvemoveTurnResultPlayerMoveTimeMinutes({
        originLocation: { id: 'origin', name: 'Origin' },
        destinationLocation: { id: 'destination', name: 'Destination' },
        promptTravelTimeMinutes: 10,
        suppressTimeAdvance: true
    });

    assert.equal(minutes, 0);
});

test('travel prose player movement suppresses vehicle-origin time advancement', () => {
    const context = loadTravelProseTimeHelper({ shortestTravelTimeMinutes: 25 });

    const minutes = context.resolvemoveTurnResultPlayerMoveTimeMinutes({
        originLocation: {
            id: 'vehicle',
            name: 'Vehicle Interior',
            isVehicle: true,
            vehicleInfo: { vehicleExitId: 'exit_1' }
        },
        destinationLocation: { id: 'destination', name: 'Destination' },
        promptTravelTimeMinutes: 10
    });

    assert.equal(minutes, 0);
});
