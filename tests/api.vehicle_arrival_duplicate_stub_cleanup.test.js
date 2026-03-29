const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadVehicleArrivalDuplicateStubHelpers(contextOverrides = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf("        const normalizeVehicleArrivalDuplicateStubName = (value) => {");
    const end = source.indexOf("\n        const moveVehicleForTravelProse = async ({", start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate vehicle-arrival duplicate-stub helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Map,
        Set,
        Array,
        gameLocations: new Map(),
        regions: new Map(),
        resolveRegionIdForLocation: (locationRecord) => {
            if (!locationRecord || typeof locationRecord !== 'object') {
                return null;
            }
            return typeof locationRecord.regionId === 'string' && locationRecord.regionId.trim()
                ? locationRecord.regionId.trim()
                : null;
        },
        removeExitStrict: (locationRecord, direction) => {
            const removed = locationRecord.removeExit(direction);
            if (!removed) {
                throw new Error(`Failed to remove exit ${direction}`);
            }
        },
        deleteStubLocation: (stubLocation) => {
            const stubId = stubLocation.id;
            const regionId = stubLocation.regionId;
            if (context.regions.has(regionId)) {
                const region = context.regions.get(regionId);
                region.locationIds = region.locationIds.filter(id => id !== stubId);
            }
            context.gameLocations.delete(stubId);
            return { stubId };
        },
        console,
        ...contextOverrides
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.extractVehicleArrivalDuplicateStubCanonicalName = extractVehicleArrivalDuplicateStubCanonicalName;
this.reconcileGeneratedVehicleStubForArrival = reconcileGeneratedVehicleStubForArrival;`,
        context
    );

    return {
        extractVehicleArrivalDuplicateStubCanonicalName: context.extractVehicleArrivalDuplicateStubCanonicalName,
        reconcileGeneratedVehicleStubForArrival: context.reconcileGeneratedVehicleStubForArrival,
        context
    };
}

function createLocationRecord({
    id,
    name,
    regionId,
    isStub = false,
    stubMetadata = null,
    exits = {}
}) {
    const exitMap = new Map(Object.entries(exits));
    return {
        id,
        name,
        regionId,
        isStub,
        stubMetadata,
        getAvailableDirections() {
            return Array.from(exitMap.keys());
        },
        getExit(direction) {
            return exitMap.get(direction) || null;
        },
        removeExit(direction) {
            return exitMap.delete(direction);
        }
    };
}

test('reconcileGeneratedVehicleStubForArrival removes duplicate generated vehicle stubs and rewires inbound exits', () => {
    const { reconcileGeneratedVehicleStubForArrival, context } = loadVehicleArrivalDuplicateStubHelpers();

    const region = {
        id: 'region-black-lotus',
        locationIds: [
            'entrance-location',
            'dock-approach',
            'actual-vehicle',
            'duplicate-vehicle-stub'
        ]
    };
    context.regions.set(region.id, region);

    const entranceLocation = createLocationRecord({
        id: 'entrance-location',
        name: 'Black Lotus Airlock',
        regionId: region.id,
        exits: {
            correct_vehicle: {
                id: 'exit-correct',
                destination: 'actual-vehicle',
                destinationRegion: null,
                isVehicle: true
            },
            duplicate_vehicle: {
                id: 'exit-duplicate',
                destination: 'duplicate-vehicle-stub',
                destinationRegion: region.id,
                isVehicle: true
            }
        }
    });
    const dockApproach = createLocationRecord({
        id: 'dock-approach',
        name: 'Dock Approach',
        regionId: region.id,
        exits: {
            duplicate_vehicle_only: {
                id: 'exit-dock-duplicate',
                destination: 'duplicate-vehicle-stub',
                destinationRegion: region.id,
                isVehicle: true
            }
        }
    });
    const actualVehicle = createLocationRecord({
        id: 'actual-vehicle',
        name: 'The "Cautionary Tale"',
        regionId: region.id
    });
    const duplicateStub = createLocationRecord({
        id: 'duplicate-vehicle-stub',
        name: 'The "Cautionary Tale" 2',
        regionId: region.id,
        isStub: true,
        stubMetadata: {
            isVehicleStub: true,
            locationPurpose: 'Interior of the vehicle "The "Cautionary Tale"".'
        }
    });

    context.gameLocations.set(entranceLocation.id, entranceLocation);
    context.gameLocations.set(dockApproach.id, dockApproach);
    context.gameLocations.set(actualVehicle.id, actualVehicle);
    context.gameLocations.set(duplicateStub.id, duplicateStub);

    const result = reconcileGeneratedVehicleStubForArrival({
        vehicleTarget: {
            kind: 'location',
            label: 'The "Cautionary Tale"'
        },
        actualVehicleLocation: actualVehicle,
        destinationLocation: entranceLocation
    });

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
        removedStubIds: ['duplicate-vehicle-stub'],
        rewiredExitCount: 1,
        removedExitCount: 1
    });
    assert.equal(entranceLocation.getExit('duplicate_vehicle'), null);
    assert.equal(dockApproach.getExit('duplicate_vehicle_only').destination, 'actual-vehicle');
    assert.equal(dockApproach.getExit('duplicate_vehicle_only').destinationRegion, null);
    assert.equal(context.gameLocations.has('duplicate-vehicle-stub'), false);
    assert.deepEqual(region.locationIds, [
        'entrance-location',
        'dock-approach',
        'actual-vehicle'
    ]);
});
