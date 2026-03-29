const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Region = require('../Region.js');
const Location = require('../Location.js');
const VehicleInfo = require('../VehicleInfo.js');

test('VehicleInfo treats ETA as an absolute elapsed-time arrival minute', () => {
    const previousPlayer = Globals.currentPlayer;
    Globals.currentPlayer = { elapsedTime: 100 };

    try {
        const vehicleInfo = new VehicleInfo({
            currentDestination: 'destination-location',
            ETA: 135,
            departureTime: 100,
            vehicleExitId: 'vehicle-exit-id'
        });

        assert.equal(vehicleInfo.isUnderway, true);
        assert.equal(vehicleInfo.hasArrived, false);

        Globals.currentPlayer.elapsedTime = 135;
        assert.equal(vehicleInfo.isUnderway, false);
        assert.equal(vehicleInfo.hasArrived, true);
    } finally {
        Globals.currentPlayer = previousPlayer;
    }
});

test('VehicleInfo does not report arrival before departure time', () => {
    const previousPlayer = Globals.currentPlayer;
    Globals.currentPlayer = { elapsedTime: 100 };

    try {
        const vehicleInfo = new VehicleInfo({
            currentDestination: 'destination-location',
            ETA: 135,
            departureTime: 110,
            vehicleExitId: 'vehicle-exit-id'
        });

        assert.equal(vehicleInfo.isUnderway, false);
        assert.equal(vehicleInfo.hasArrived, false);
        assert.equal(vehicleInfo.isArriving, false);

        Globals.currentPlayer.elapsedTime = 120;
        assert.equal(vehicleInfo.isUnderway, true);
        assert.equal(vehicleInfo.hasArrived, false);
        assert.equal(vehicleInfo.isArriving, false);
    } finally {
        Globals.currentPlayer = previousPlayer;
    }
});

test('VehicleInfo rejects departureTime values after ETA', () => {
    assert.throws(
        () => new VehicleInfo({
            currentDestination: 'destination-location',
            ETA: 120,
            departureTime: 121,
            vehicleExitId: 'vehicle-exit-id'
        }),
        /departureTime cannot be after ETA/
    );
});

test('VehicleInfo allows timed trips with a pending destination before arrival finalization', () => {
    const previousPlayer = Globals.currentPlayer;
    Globals.currentPlayer = { elapsedTime: 100 };

    try {
        const vehicleInfo = new VehicleInfo({
            pendingDestination: {
                rawText: 'Derelict Sector|',
                regionName: 'Derelict Sector',
                locationId: 'destination-location'
            },
            ETA: 135,
            departureTime: 100,
            vehicleExitId: 'vehicle-exit-id'
        });

        assert.equal(vehicleInfo.currentDestination, null);
        assert.deepEqual(vehicleInfo.pendingDestination, {
            rawText: 'Derelict Sector|',
            regionName: 'Derelict Sector',
            locationName: null,
            regionId: null,
            locationId: 'destination-location'
        });
        assert.equal(vehicleInfo.isUnderway, true);
        assert.equal(vehicleInfo.hasArrived, false);
    } finally {
        Globals.currentPlayer = previousPlayer;
    }
});

test('VehicleInfo accepts an atomic pending-to-resolved arrival update', () => {
    const initialVehicleInfo = new VehicleInfo({
        pendingDestination: {
            rawText: 'Derelict Sector|Mourning Star Berth',
            regionName: 'Derelict Sector',
            locationId: 'destination-location'
        },
        ETA: 135,
        departureTime: 100,
        vehicleExitId: 'vehicle-exit-id'
    });

    const vehicleInfo = new VehicleInfo({
        ...initialVehicleInfo.toJSON(),
        pendingDestination: null,
        currentDestination: 'destination-location',
        ETA: null,
        departureTime: null
    });

    assert.equal(vehicleInfo.pendingDestination, null);
    assert.equal(vehicleInfo.currentDestination, 'destination-location');
    assert.equal(vehicleInfo.ETA, null);
    assert.equal(vehicleInfo.departureTime, null);
});

test('VehicleInfo accepts an atomic resolved-to-pending timed-trip start update', () => {
    const initialVehicleInfo = new VehicleInfo({
        currentDestination: 'anchorpoint-docking-bay-7',
        vehicleExitId: 'vehicle-exit-id'
    });

    const vehicleInfo = new VehicleInfo({
        ...initialVehicleInfo.toJSON(),
        currentDestination: null,
        pendingDestination: {
            rawText: 'Derelict Sector|Mourning Star Berth',
            regionName: 'Derelict Sector',
            locationId: 'destination-location'
        },
        ETA: 135,
        departureTime: 100
    });

    assert.equal(vehicleInfo.currentDestination, null);
    assert.deepEqual(vehicleInfo.pendingDestination, {
        rawText: 'Derelict Sector|Mourning Star Berth',
        regionName: 'Derelict Sector',
        locationName: null,
        regionId: null,
        locationId: 'destination-location'
    });
    assert.equal(vehicleInfo.ETA, 135);
    assert.equal(vehicleInfo.departureTime, 100);
});

test('VehicleInfo accepts pending-region route entries for region-only pending destinations', () => {
    const routeEntry = VehicleInfo.buildPendingRegionRouteEntry('Skyreach');
    const vehicleInfo = new VehicleInfo({
        pendingDestination: VehicleInfo.buildPendingRegionPendingDestination('Skyreach'),
        destinations: [routeEntry],
        ETA: 135,
        departureTime: 100,
        vehicleExitId: 'vehicle-exit-id'
    });

    assert.deepEqual(vehicleInfo.destinations, [routeEntry]);
    assert.deepEqual(vehicleInfo.pendingDestination, {
        rawText: 'Skyreach|',
        regionName: 'Skyreach',
        locationName: null,
        regionId: null,
        locationId: null
    });
});

test('VehicleInfo accepts currentDestination when fixed routes include a matching pending-region route entry', () => {
    const createdLocations = [];
    Region.clear();

    try {
        const region = new Region({
            id: 'test-pending-route-region',
            name: 'Skyreach',
            description: 'A route-matching test region.'
        });
        const destination = new Location({
            id: 'test-pending-route-destination',
            name: 'Skyreach Dock',
            description: 'A destination inside Skyreach.',
            regionId: region.id
        });
        createdLocations.push(destination);

        const routeEntry = VehicleInfo.buildPendingRegionRouteEntry('Skyreach');
        const vehicleInfo = new VehicleInfo({
            currentDestination: destination.id,
            destinations: [routeEntry],
            vehicleExitId: 'vehicle-exit-id'
        });

        assert.deepEqual(vehicleInfo.destinations, [routeEntry]);
        assert.equal(vehicleInfo.currentDestination, destination.id);
    } finally {
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});
