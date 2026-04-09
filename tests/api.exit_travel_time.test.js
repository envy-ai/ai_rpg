const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadExitTravelTimeHelpers({ findRegionByLocationId = () => null, Location = null, Utils = null } = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('function locationContextRepresentsVehicle(location) {');
    const end = source.indexOf('\n        async function adjustWorldTimeByMinutes(minutes, {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate exit-travel-time helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        findRegionByLocationId,
        Location,
        Utils
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.locationContextRepresentsVehicle = locationContextRepresentsVehicle;
this.resolveExitTravelTimeForTraversal = resolveExitTravelTimeForTraversal;
this.resolveFastTravelTimeForTraversal = resolveFastTravelTimeForTraversal;
this.buildFastTravelSummaryItem = buildFastTravelSummaryItem;`,
        context
    );
    return {
        locationContextRepresentsVehicle: context.locationContextRepresentsVehicle,
        resolveExitTravelTimeForTraversal: context.resolveExitTravelTimeForTraversal,
        resolveFastTravelTimeForTraversal: context.resolveFastTravelTimeForTraversal,
        buildFastTravelSummaryItem: context.buildFastTravelSummaryItem
    };
}

test('resolveExitTravelTimeForTraversal returns stored minutes for non-vehicle sources', () => {
    const { resolveExitTravelTimeForTraversal } = loadExitTravelTimeHelpers();
    const minutes = resolveExitTravelTimeForTraversal({
        exit: { travelTimeMinutes: 45 },
        sourceLocation: { id: 'town-square', isVehicle: false, vehicleInfo: null }
    });
    assert.equal(minutes, 45);
});

test('resolveExitTravelTimeForTraversal suppresses travel time from location vehicles', () => {
    const { resolveExitTravelTimeForTraversal } = loadExitTravelTimeHelpers();
    const minutes = resolveExitTravelTimeForTraversal({
        exit: { travelTimeMinutes: 45 },
        sourceLocation: {
            id: 'shuttle-interior',
            isVehicle: true,
            vehicleInfo: { vehicleExitId: 'exit-1' }
        }
    });
    assert.equal(minutes, 0);
});

test('resolveExitTravelTimeForTraversal suppresses travel time from locations inside vehicle regions', () => {
    const { resolveExitTravelTimeForTraversal } = loadExitTravelTimeHelpers({
        findRegionByLocationId: () => ({
            id: 'region-vehicle',
            isVehicle: true,
            vehicleInfo: { vehicleExitId: 'exit-1' }
        })
    });
    const minutes = resolveExitTravelTimeForTraversal({
        exit: { travelTimeMinutes: 45 },
        sourceLocation: {
            id: 'bridge',
            isVehicle: false,
            vehicleInfo: null
        }
    });
    assert.equal(minutes, 0);
});

test('resolveFastTravelTimeForTraversal uses Location shortest-path minutes when connected', () => {
    const { resolveFastTravelTimeForTraversal } = loadExitTravelTimeHelpers({
        Location: {
            findShortestTravelTimeMinutes: () => 17
        }
    });
    const minutes = resolveFastTravelTimeForTraversal({
        sourceLocation: { id: 'start' },
        destinationLocation: { id: 'end' }
    });
    assert.equal(minutes, 17);
});

test('resolveFastTravelTimeForTraversal returns 0 when no route exists', () => {
    const { resolveFastTravelTimeForTraversal } = loadExitTravelTimeHelpers({
        Location: {
            findShortestTravelTimeMinutes: () => null
        }
    });
    const minutes = resolveFastTravelTimeForTraversal({
        sourceLocation: { id: 'start' },
        destinationLocation: { id: 'end' }
    });
    assert.equal(minutes, 0);
});

test('buildFastTravelSummaryItem formats the origin, destination, and natural duration', () => {
    const { buildFastTravelSummaryItem } = loadExitTravelTimeHelpers({
        Utils: {
            formatMinutesAsNaturalDuration: (minutes) => `${minutes} minutes`
        }
    });
    const summary = buildFastTravelSummaryItem({
        originLocation: { name: 'Dockside Market' },
        destinationLocation: { name: 'Clocktower Plaza' },
        travelTimeMinutes: 12
    });
    assert.equal(summary.icon, '🚶');
    assert.equal(summary.description, 'Traveled from Dockside Market to Clocktower Plaza. 12 minutes passed.');
});
