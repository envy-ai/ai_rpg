const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Location = require('../Location.js');

test('Player.currentVehicle exposes computed trip-state fields for prompts', () => {
    const previousPlayer = Globals.currentPlayer;
    const previousConfig = Globals.config;
    const createdLocations = [];

    Player.clearRuntimeRegistries();
    Region.clear();
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const region = new Region({
            id: 'test-region-current-vehicle',
            name: 'Mourning Star',
            description: 'A compact drift-capable starship.',
            vehicleInfo: {
                pendingDestination: {
                    rawText: 'Derelict Sector|',
                    regionName: 'Derelict Sector',
                    locationId: 'test-destination-location'
                },
                ETA: 135,
                departureTime: 110,
                vehicleExitId: 'test-vehicle-exit'
            }
        });

        const currentLocation = new Location({
            id: 'test-current-vehicle-location',
            name: 'Cockpit',
            description: 'A cramped cockpit wrapped in instrument glow.',
            regionId: region.id
        });
        createdLocations.push(currentLocation);

        const destinationLocation = new Location({
            id: 'test-destination-location',
            name: 'Derelict Sector Approach',
            description: 'A debris-lined approach corridor.',
            regionId: region.id
        });
        createdLocations.push(destinationLocation);

        const player = new Player({
            id: 'test-player-current-vehicle',
            name: 'Exis',
            location: currentLocation.id,
            elapsedTime: 100
        });
        Globals.currentPlayer = player;

        let currentVehicle = player.currentVehicle;
        assert.ok(currentVehicle);
        assert.equal(currentVehicle.destination, 'Derelict Sector');
        assert.equal(currentVehicle.destinationResolved, false);
        assert.deepEqual(currentVehicle.pendingDestination, {
            rawText: 'Derelict Sector|',
            regionName: 'Derelict Sector',
            locationName: null,
            regionId: null,
            locationId: 'test-destination-location'
        });
        assert.equal(currentVehicle.minutesToDestination, 35);
        assert.equal(currentVehicle.timeToDestination, '35 minutes');
        assert.equal(currentVehicle.isUnderway, false);
        assert.equal(currentVehicle.hasArrived, false);
        assert.equal(currentVehicle.isArriving, false);
        assert.equal(currentVehicle.vehicleInfo.isUnderway, false);
        assert.equal(currentVehicle.vehicleInfo.hasArrived, false);
        assert.equal(currentVehicle.vehicleInfo.isArriving, false);
        assert.equal(currentVehicle.vehicleInfo.destinationResolved, false);

        region.vehicleInfo = {
            currentDestination: 'test-destination-location',
            ETA: 135,
            departureTime: 100,
            vehicleExitId: 'test-vehicle-exit'
        };

        currentVehicle = player.currentVehicle;
        assert.ok(currentVehicle);
        assert.equal(currentVehicle.destination, 'Derelict Sector Approach');
        assert.equal(currentVehicle.destinationResolved, true);
        assert.equal(currentVehicle.pendingDestination, null);
        assert.equal(currentVehicle.minutesToDestination, 35);
        assert.equal(currentVehicle.timeToDestination, '35 minutes');
        assert.equal(currentVehicle.isUnderway, true);
        assert.equal(currentVehicle.hasArrived, false);
        assert.equal(currentVehicle.isArriving, false);
        assert.equal(currentVehicle.vehicleInfo.isUnderway, true);
        assert.equal(currentVehicle.vehicleInfo.hasArrived, false);
        assert.equal(currentVehicle.vehicleInfo.isArriving, false);

        Globals.elapsedTime = 135;
        currentVehicle = player.currentVehicle;
        assert.ok(currentVehicle);
        assert.equal(currentVehicle.minutesToDestination, 0);
        assert.equal(currentVehicle.timeToDestination, '0 minutes');
        assert.equal(currentVehicle.isUnderway, false);
        assert.equal(currentVehicle.hasArrived, true);
        assert.equal(currentVehicle.isArriving, true);
        assert.equal(currentVehicle.vehicleInfo.isUnderway, false);
        assert.equal(currentVehicle.vehicleInfo.hasArrived, true);
        assert.equal(currentVehicle.vehicleInfo.isArriving, true);
    } finally {
        Globals.currentPlayer = previousPlayer;
        Globals.config = previousConfig;
        Player.clearRuntimeRegistries();
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});
