const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Location = require('../Location.js');
const LocationExit = require('../LocationExit.js');
const VehicleStatusCommand = require('../slashcommands/vehicle_status.js');

test('vehicle_status command reports current vehicle details in markdown', async () => {
    const previousPlayer = Globals.currentPlayer;
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
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
        const vehicleRegion = new Region({
            id: 'vehicle-region-status-test',
            name: 'Mourning Star',
            description: 'A compact drift-capable starship.',
            vehicleInfo: {
                currentDestination: 'vehicle-destination-location',
                destinations: ['vehicle-destination-location', 'vehicle-alt-destination'],
                ETA: 135,
                departureTime: 100,
                vehicleExitId: 'vehicle-status-exit',
                icon: '🚀',
                terrainTypes: 'space, vacuum'
            }
        });

        const outsideRegion = new Region({
            id: 'outside-region-status-test',
            name: 'Derelict Sector',
            description: 'A field of drifting wreckage.'
        });

        const cockpit = new Location({
            id: 'vehicle-cockpit-location',
            name: 'Cockpit',
            description: 'A cramped cockpit wrapped in instrument glow.',
            regionId: vehicleRegion.id
        });
        createdLocations.push(cockpit);

        const destination = new Location({
            id: 'vehicle-destination-location',
            name: 'Derelict Sector Approach',
            description: 'A debris-lined approach corridor.',
            regionId: outsideRegion.id
        });
        createdLocations.push(destination);

        const altDestination = new Location({
            id: 'vehicle-alt-destination',
            name: 'Salvager\'s Anchorage',
            description: 'A rough salvage dock tucked into the wreck field.',
            regionId: outsideRegion.id
        });
        createdLocations.push(altDestination);

        cockpit.addExit('airlock', new LocationExit({
            id: 'vehicle-status-exit',
            description: 'Airlock',
            destination: destination.id,
            destinationRegion: outsideRegion.id,
            bidirectional: true,
            isVehicle: true
        }));

        const player = new Player({
            id: 'vehicle-status-player',
            name: 'Exis',
            location: cockpit.id,
            elapsedTime: 100
        });
        Globals.currentPlayer = player;
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };

        let replyPayload = null;
        await VehicleStatusCommand.execute({
            reply: async (payload) => {
                replyPayload = payload;
            }
        });

        assert.ok(replyPayload);
        assert.equal(replyPayload.ephemeral, false);
        assert.match(replyPayload.content, /## Vehicle Status: Mourning Star/);
        assert.match(replyPayload.content, /Vehicle kind: \*\*Region vehicle\*\*/);
        assert.match(replyPayload.content, /Player location inside vehicle: \*\*Cockpit\*\*/);
        assert.match(replyPayload.content, /Outside location: \*\*Derelict Sector:Derelict Sector Approach\*\*/);
        assert.match(replyPayload.content, /Current destination: \*\*Derelict Sector:Derelict Sector Approach \(`vehicle-destination-location`\)\*\*/);
        assert.match(replyPayload.content, /Pending destination: \*\*-\*\*/);
        assert.match(replyPayload.content, /Fixed-route destinations: Derelict Sector:Derelict Sector Approach \(`vehicle-destination-location`\), Derelict Sector:Salvager's Anchorage \(`vehicle-alt-destination`\)/);
        assert.match(replyPayload.content, /Is underway: \*\*Yes\*\*/);
        assert.match(replyPayload.content, /Has arrived: \*\*No\*\*/);
        assert.match(replyPayload.content, /Travel start time: \*\*100/);
        assert.match(replyPayload.content, /ETA: \*\*135/);
        assert.match(replyPayload.content, /Vehicle exit id: `vehicle-status-exit`/);
        assert.match(replyPayload.content, /Icon: 🚀/);
        assert.match(replyPayload.content, /Terrain types: space, vacuum/);
    } finally {
        Globals.currentPlayer = previousPlayer;
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
        Player.clearRuntimeRegistries();
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});

test('vehicle_status command reports pending destinations for underway trips', async () => {
    const previousPlayer = Globals.currentPlayer;
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
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
        const vehicleRegion = new Region({
            id: 'vehicle-region-status-pending-test',
            name: 'Mourning Star',
            description: 'A compact drift-capable starship.',
            vehicleInfo: {
                pendingDestination: {
                    rawText: 'Derelict Sector|',
                    regionName: 'Derelict Sector',
                    locationId: 'vehicle-pending-destination-location'
                },
                ETA: 135,
                departureTime: 100,
                vehicleExitId: 'vehicle-pending-status-exit',
                icon: '🚀'
            }
        });

        const outsideRegion = new Region({
            id: 'outside-region-status-pending-test',
            name: 'Anchorpoint Station',
            description: 'A patched-together salvage station.'
        });

        const cockpit = new Location({
            id: 'vehicle-pending-cockpit-location',
            name: 'Cockpit',
            description: 'A cramped cockpit wrapped in instrument glow.',
            regionId: vehicleRegion.id
        });
        createdLocations.push(cockpit);

        const outsideLocation = new Location({
            id: 'vehicle-pending-outside-location',
            name: 'Docking Bay 7',
            description: 'A noisy station berth.',
            regionId: outsideRegion.id
        });
        createdLocations.push(outsideLocation);

        const pendingDestination = new Location({
            id: 'vehicle-pending-destination-location',
            name: 'Mourning Star Berth',
            description: 'A berth on the far side of the wreck field.',
            regionId: outsideRegion.id
        });
        createdLocations.push(pendingDestination);

        cockpit.addExit('airlock', new LocationExit({
            id: 'vehicle-pending-status-exit',
            description: 'Airlock',
            destination: outsideLocation.id,
            destinationRegion: outsideRegion.id,
            bidirectional: true,
            isVehicle: true
        }));

        const player = new Player({
            id: 'vehicle-status-pending-player',
            name: 'Exis',
            location: cockpit.id,
            elapsedTime: 100
        });
        Globals.currentPlayer = player;
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };

        let replyPayload = null;
        await VehicleStatusCommand.execute({
            reply: async (payload) => {
                replyPayload = payload;
            }
        });

        assert.ok(replyPayload);
        assert.match(replyPayload.content, /Current destination: \*\*-\*\*/);
        assert.match(replyPayload.content, /Pending destination: \*\*Derelict Sector \(`vehicle-pending-destination-location`\)\*\*/);
        assert.match(replyPayload.content, /Outside location: \*\*Anchorpoint Station:Docking Bay 7\*\*/);
    } finally {
        Globals.currentPlayer = previousPlayer;
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
        Player.clearRuntimeRegistries();
        Region.clear();
        for (const location of createdLocations) {
            Location.removeFromIndex(location);
        }
    }
});

test('vehicle_status command rejects when the current player is not in a vehicle', async () => {
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
            id: 'plain-region-status-test',
            name: 'Anchorpoint Station',
            description: 'A patched-together salvage station.'
        });
        const location = new Location({
            id: 'plain-location-status-test',
            name: 'Berth 9',
            description: 'A utilitarian docking berth.',
            regionId: region.id
        });
        createdLocations.push(location);

        Globals.currentPlayer = new Player({
            id: 'plain-player-status-test',
            name: 'Exis',
            location: location.id,
            elapsedTime: 100
        });

        await assert.rejects(
            () => VehicleStatusCommand.execute({ reply: async () => {} }),
            /not inside a vehicle/i
        );
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
