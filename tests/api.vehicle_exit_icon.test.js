const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadVehicleExitIconHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('function normalizeVehicleRegionIdForIconSuppression(value) {');
    const end = source.indexOf("\n        function getVehicleExitAvailabilityState(vehicleInfo, { contextLabel = 'Vehicle' } = {}) {", start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate vehicle-exit icon helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {};
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.shouldSuppressCurrentRegionVehicleIconCandidate = shouldSuppressCurrentRegionVehicleIconCandidate;
this.shouldSuppressCurrentRegionVehicleDestinationIcon = shouldSuppressCurrentRegionVehicleDestinationIcon;`,
        context
    );

    return {
        shouldSuppressCurrentRegionVehicleIconCandidate: context.shouldSuppressCurrentRegionVehicleIconCandidate,
        shouldSuppressCurrentRegionVehicleDestinationIcon: context.shouldSuppressCurrentRegionVehicleDestinationIcon
    };
}

test('vehicle exit icons are suppressed for ordinary exits inside the current vehicle region', () => {
    const { shouldSuppressCurrentRegionVehicleDestinationIcon } = loadVehicleExitIconHelpers();

    const shouldSuppress = shouldSuppressCurrentRegionVehicleDestinationIcon({
        sourceRegionId: 'train-region',
        sourceRegionRepresentsVehicle: true,
        destinationRegionId: 'train-region',
        destinationLocationRepresentsVehicle: false,
        pendingRegionRepresentsVehicle: false,
        destinationStubRepresentsVehicle: false
    });

    assert.equal(shouldSuppress, true);
});

test('vehicle exit icons remain available for actual vehicle destinations inside vehicle regions', () => {
    const { shouldSuppressCurrentRegionVehicleDestinationIcon } = loadVehicleExitIconHelpers();

    const shouldSuppress = shouldSuppressCurrentRegionVehicleDestinationIcon({
        sourceRegionId: 'train-region',
        sourceRegionRepresentsVehicle: true,
        destinationRegionId: 'train-region',
        destinationLocationRepresentsVehicle: true,
        pendingRegionRepresentsVehicle: false,
        destinationStubRepresentsVehicle: false
    });

    assert.equal(shouldSuppress, false);
});

test('current vehicle region icon candidates are suppressed even when an actual vehicle destination can still fall back to a generic icon', () => {
    const { shouldSuppressCurrentRegionVehicleIconCandidate } = loadVehicleExitIconHelpers();

    const shouldSuppressRegionIcon = shouldSuppressCurrentRegionVehicleIconCandidate({
        sourceRegionId: 'train-region',
        sourceRegionRepresentsVehicle: true,
        destinationRegionId: 'train-region'
    });

    assert.equal(shouldSuppressRegionIcon, true);
});

test('vehicle exit icons remain available when boarding a vehicle region from outside', () => {
    const { shouldSuppressCurrentRegionVehicleDestinationIcon } = loadVehicleExitIconHelpers();

    const shouldSuppress = shouldSuppressCurrentRegionVehicleDestinationIcon({
        sourceRegionId: 'station-platform',
        sourceRegionRepresentsVehicle: false,
        destinationRegionId: 'train-region',
        destinationLocationRepresentsVehicle: false,
        pendingRegionRepresentsVehicle: false,
        destinationStubRepresentsVehicle: false
    });

    assert.equal(shouldSuppress, false);
});
