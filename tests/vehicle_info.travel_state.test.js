const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
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
