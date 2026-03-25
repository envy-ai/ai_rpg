const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const Globals = require('../Globals.js');
const VehicleInfo = require('../VehicleInfo.js');

function loadVehicleExitAvailabilityHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf("function getVehicleExitAvailabilityState(vehicleInfo, { contextLabel = 'Vehicle' } = {}) {");
    const end = source.indexOf("\n        function buildVehicleTravelDisplayDetails(vehicleInfo, { contextLabel = 'Vehicle' } = {}) {", start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate vehicle-exit availability helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        VehicleInfo,
        regions: new Map()
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.getVehicleExitAvailabilityState = getVehicleExitAvailabilityState;
this.resolveVehicleExitTransitBlock = resolveVehicleExitTransitBlock;
this.shouldHideVehicleExitFromList = shouldHideVehicleExitFromList;`,
        context
    );

    return {
        getVehicleExitAvailabilityState: context.getVehicleExitAvailabilityState,
        resolveVehicleExitTransitBlock: context.resolveVehicleExitTransitBlock,
        shouldHideVehicleExitFromList: context.shouldHideVehicleExitFromList
    };
}

test('getVehicleExitAvailabilityState treats ETA-elapsed pending arrivals as blocked', () => {
    const previousElapsedTime = Globals.elapsedTime;
    Globals.elapsedTime = 150;

    try {
        const { getVehicleExitAvailabilityState } = loadVehicleExitAvailabilityHelpers();
        const state = getVehicleExitAvailabilityState({
            pendingDestination: {
                rawText: 'Derelict Sector|',
                regionName: 'Derelict Sector'
            },
            ETA: 150,
            departureTime: 100,
            vehicleExitId: 'vehicle-exit-id'
        });

        assert.equal(state.blocked, true);
        assert.equal(state.reason, 'arrival_pending');
    } finally {
        Globals.elapsedTime = previousElapsedTime;
    }
});

test('resolveVehicleExitTransitBlock hides tracked source vehicle exits while arrival finalization is pending', () => {
    const previousElapsedTime = Globals.elapsedTime;
    Globals.elapsedTime = 150;

    try {
        const { resolveVehicleExitTransitBlock, shouldHideVehicleExitFromList } = loadVehicleExitAvailabilityHelpers();
        const sourceLocation = {
            id: 'mourning-star-location',
            isVehicle: true,
            vehicleInfo: {
                pendingDestination: {
                    rawText: 'Derelict Sector|The Bone Orchard',
                    regionName: 'Derelict Sector',
                    locationName: 'The Bone Orchard'
                },
                ETA: 150,
                departureTime: 100,
                vehicleExitId: 'vehicle-exit-id'
            }
        };
        const trackedExitWithStaleMetadata = {
            id: 'vehicle-exit-id',
            isVehicle: false,
            destination: 'old-destination-location'
        };

        const transitBlock = resolveVehicleExitTransitBlock({
            exit: trackedExitWithStaleMetadata,
            sourceLocation,
            destinationLocation: null,
            contextLabel: 'debug vehicle exit'
        });

        assert.equal(transitBlock.blocked, true);
        assert.equal(transitBlock.reason, 'source_arrival_pending');
        assert.equal(shouldHideVehicleExitFromList({
            exit: trackedExitWithStaleMetadata,
            sourceLocation,
            destinationLocation: null,
            contextLabel: 'debug vehicle exit'
        }), true);
    } finally {
        Globals.elapsedTime = previousElapsedTime;
    }
});
