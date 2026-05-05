const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

test('new_exit_discovered parser captures optional travel time', () => {
    const parser = Events._buildParsers().new_exit_discovered;

    const parsed = parser('Hidden Cellar -> location -> none -> A hidden cellar beneath the tavern. -> 1 hour, 5 minutes');

    assert.deepEqual(parsed, [
        {
            name: 'Hidden Cellar',
            kind: 'location',
            vehicleType: null,
            description: 'A hidden cellar beneath the tavern.',
            travelTimeMinutes: 65,
        },
    ]);
});

test('new_exit_discovered parser still accepts legacy four-field entries', () => {
    const parser = Events._buildParsers().new_exit_discovered;

    const parsed = parser('Hidden Cellar -> location -> none -> A hidden cellar beneath the tavern.');

    assert.deepEqual(parsed, [
        {
            name: 'Hidden Cellar',
            kind: 'location',
            vehicleType: null,
            description: 'A hidden cellar beneath the tavern.',
            travelTimeMinutes: null,
        },
    ]);
});

test('new_exit_discovered parser captures source location and destination region fields', () => {
    const parser = Events._buildParsers().new_exit_discovered;

    const parsed = parser('Hidden Garden -> location -> none -> A concealed path through the hedge. -> 5 minutes -> Old Gatehouse -> Castle Grounds -> Hedge Maze');

    assert.deepEqual(parsed, [
        {
            name: 'Hidden Garden',
            kind: 'location',
            vehicleType: null,
            description: 'A concealed path through the hedge.',
            travelTimeMinutes: 5,
            exitLocationName: 'Old Gatehouse',
            exitRegionName: 'Castle Grounds',
            destinationRegionName: 'Hedge Maze',
        },
    ]);
});

test('new_exit_discovered parser captures explicit destination location in extended entries', () => {
    const parser = Events._buildParsers().new_exit_discovered;

    const parsed = parser('Copperwheel Gorge -> region -> none -> A switchback trail leads down into the copper gorge. -> 12 minutes -> Old Gatehouse -> Castle Grounds -> Copperwheel Gorge -> Gorge Trailhead');

    assert.deepEqual(parsed, [
        {
            name: 'Copperwheel Gorge',
            kind: 'region',
            vehicleType: null,
            description: 'A switchback trail leads down into the copper gorge.',
            travelTimeMinutes: 12,
            exitLocationName: 'Old Gatehouse',
            exitRegionName: 'Castle Grounds',
            destinationRegionName: 'Copperwheel Gorge',
            destinationLocationName: 'Gorge Trailhead',
        },
    ]);
});

test('new_exit_discovered parser preserves arrows in legacy descriptions', () => {
    const parser = Events._buildParsers().new_exit_discovered;

    const parsed = parser('Hidden Cellar -> location -> none -> A trapdoor opens -> then stairs descend. -> 5 minutes');

    assert.deepEqual(parsed, [
        {
            name: 'Hidden Cellar',
            kind: 'location',
            vehicleType: null,
            description: 'A trapdoor opens → then stairs descend.',
            travelTimeMinutes: 5,
        },
    ]);
});

test('new_exit_discovered parser fails loudly on malformed travel time', () => {
    const parser = Events._buildParsers().new_exit_discovered;

    assert.throws(
        () => parser('Hidden Cellar -> location -> none -> A hidden cellar beneath the tavern. -> later maybe'),
        /new_exit_discovered travel time/i
    );
});

test('new_exit_discovered handler threads travel time through location exit creation', async () => {
    const handlers = Events._buildHandlers();
    const previousCurrentPlayer = Globals.currentPlayer;
    Globals.currentPlayer = {
        getCurrentLocationName: () => 'Taproom',
    };

    try {
        const ensureCalls = [];
        const createdLocationCalls = [];
        const destination = {
            id: 'loc_hidden_cellar',
            name: 'Hidden Cellar',
            regionId: 'region_tavern',
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const originLocation = {
            id: 'loc_taproom',
            name: 'Taproom',
            regionId: 'region_tavern',
            isVehicle: false,
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const entries = [
            {
                name: 'Hidden Cellar',
                kind: 'location',
                vehicleType: null,
                description: 'A hidden cellar beneath the tavern.',
                travelTimeMinutes: 65,
            },
        ];

        await handlers.new_exit_discovered.call(
            {
                _deps: {
                    Location: {
                        get: () => null,
                        findByName: () => null,
                    },
                    findLocationByNameLoose: () => null,
                    findRegionByNameLoose: () => null,
                    findRegionByLocationId: () => ({ id: 'region_tavern', isVehicle: false }),
                    createLocationFromEvent: async (options) => {
                        createdLocationCalls.push(options);
                        return destination;
                    },
                    createRegionStubFromEvent: async () => null,
                    ensureExitConnection: (...args) => {
                        ensureCalls.push(args);
                        return { id: ensureCalls.length === 1 ? 'exit_hidden_cellar' : 'exit_taproom' };
                    },
                    regenerateLocationName: async () => ({ name: 'unused' }),
                    gameLocations: new Map(),
                },
            },
            entries,
            {
                location: originLocation,
                region: { id: 'region_tavern', isVehicle: false },
            }
        );

        assert.equal(createdLocationCalls.length, 1);
        assert.equal(createdLocationCalls[0].travelTimeMinutes, 65);
        assert.equal(ensureCalls.length, 2);
        assert.equal(ensureCalls[0][2].travelTimeMinutes, 65);
        assert.equal(ensureCalls[1][2].travelTimeMinutes, 65);
        assert.equal(entries[0].originLocationId, 'loc_taproom');
        assert.equal(entries[0].originRegionId, 'region_tavern');
        assert.equal(entries[0].destinationId, 'loc_hidden_cellar');
        assert.equal(entries[0].destinationRegionId, 'region_tavern');
        assert.equal(entries[0].destinationKind, 'location');
        assert.equal(entries[0].exitId, 'exit_hidden_cellar');
    } finally {
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('new_exit_discovered handler creates exits from explicit source locations', async () => {
    const handlers = Events._buildHandlers();
    const parser = Events._buildParsers().new_exit_discovered;
    const previousCurrentPlayer = Globals.currentPlayer;
    Globals.currentPlayer = {
        getCurrentLocationName: () => 'Taproom',
    };

    try {
        const ensureCalls = [];
        const createdLocationCalls = [];
        const sourceLocation = {
            id: 'loc_gatehouse',
            name: 'Old Gatehouse',
            regionId: 'region_castle',
            isVehicle: false,
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const contextLocation = {
            id: 'loc_taproom',
            name: 'Taproom',
            regionId: 'region_tavern',
            isVehicle: false,
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const destination = {
            id: 'loc_hidden_garden',
            name: 'Hidden Garden',
            regionId: 'region_hedge',
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const castleRegion = {
            id: 'region_castle',
            name: 'Castle Grounds',
            isVehicle: false,
            locationIds: ['loc_gatehouse'],
        };
        const hedgeRegion = {
            id: 'region_hedge',
            name: 'Hedge Maze',
            isVehicle: false,
            locationIds: [],
        };
        const regions = new Map([
            ['region_castle', castleRegion],
            ['region_hedge', hedgeRegion],
        ]);
        const locations = new Map([
            ['loc_gatehouse', sourceLocation],
            ['loc_taproom', contextLocation],
        ]);
        const entries = parser('Hidden Garden -> location -> none -> A concealed path through the hedge. -> 5 minutes -> Old Gatehouse -> Castle Grounds -> Hedge Maze');

        await handlers.new_exit_discovered.call(
            {
                _deps: {
                    Location: {
                        get: (id) => locations.get(id) || null,
                        findByName: () => null,
                    },
                    findLocationByNameLoose: () => null,
                    findRegionByNameLoose: (name) => {
                        const normalized = String(name || '').trim().toLowerCase();
                        return Array.from(regions.values()).find(
                            (region) => region.name.toLowerCase() === normalized,
                        ) || null;
                    },
                    findRegionByLocationId: (locationId) => {
                        if (locationId === 'loc_gatehouse') {
                            return castleRegion;
                        }
                        if (locationId === 'loc_taproom') {
                            return { id: 'region_tavern', name: 'Tavern', isVehicle: false };
                        }
                        return null;
                    },
                    createLocationFromEvent: async (options) => {
                        createdLocationCalls.push(options);
                        return destination;
                    },
                    createRegionStubFromEvent: async () => null,
                    ensureExitConnection: (...args) => ensureCalls.push(args),
                    regenerateLocationName: async () => ({ name: 'unused' }),
                    gameLocations: locations,
                    regions,
                },
            },
            entries,
            {
                location: contextLocation,
                region: { id: 'region_tavern', name: 'Tavern', isVehicle: false },
            }
        );

        assert.equal(createdLocationCalls.length, 1);
        assert.equal(createdLocationCalls[0].originLocation, sourceLocation);
        assert.equal(createdLocationCalls[0].targetRegionId, 'region_hedge');
        assert.equal(createdLocationCalls[0].travelTimeMinutes, 5);
        assert.equal(ensureCalls.length, 2);
        assert.equal(ensureCalls[0][0], sourceLocation);
        assert.equal(ensureCalls[0][1], destination);
        assert.equal(ensureCalls[1][0], destination);
        assert.equal(ensureCalls[1][1], sourceLocation);
        assert.equal(ensureCalls[0][2].destinationRegion, 'region_hedge');
        assert.equal(ensureCalls[1][2].destinationRegion, 'region_castle');
    } finally {
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('new_exit_discovered handler creates missing explicit source locations and annotates map metadata', async () => {
    const handlers = Events._buildHandlers();
    const parser = Events._buildParsers().new_exit_discovered;
    const previousCurrentPlayer = Globals.currentPlayer;
    Globals.currentPlayer = {
        getCurrentLocationName: () => 'Maplebrook Common',
    };

    try {
        const ensureCalls = [];
        const createdLocationCalls = [];
        const contextLocation = {
            id: 'loc_maplebrook_common',
            name: 'Maplebrook Common',
            regionId: 'region_maplebrook',
            isVehicle: false,
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const createdSourceLocation = {
            id: 'loc_hamlet_south_gate',
            name: 'Hamlet South Gate',
            regionId: 'region_maplebrook',
            isVehicle: false,
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const createdDestinationLocation = {
            id: 'loc_combine_waystation_gorge_mouth',
            name: 'Combine Waystation at Gorge Mouth',
            regionId: 'region_copperwheel',
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const maplebrookRegion = {
            id: 'region_maplebrook',
            name: 'Maplebrook Hamlet',
            isVehicle: false,
            locationIds: ['loc_maplebrook_common'],
        };
        const copperwheelRegion = {
            id: 'region_copperwheel',
            name: 'Copperwheel Gorge',
            isVehicle: false,
            locationIds: [],
        };
        const regions = new Map([
            ['region_maplebrook', maplebrookRegion],
            ['region_copperwheel', copperwheelRegion],
        ]);
        const locations = new Map([
            ['loc_maplebrook_common', contextLocation],
        ]);
        const entries = parser(
            'Combine Waystation at Gorge Mouth -> location -> none -> A new waystation is visible where the road meets the gorge. -> 20 minutes -> Hamlet South Gate -> Maplebrook Hamlet -> Copperwheel Gorge',
        );

        await handlers.new_exit_discovered.call(
            {
                _deps: {
                    Location: {
                        get: (id) => locations.get(id) || null,
                        findByName: () => null,
                    },
                    findLocationByNameLoose: () => null,
                    findRegionByNameLoose: (name) => {
                        const normalized = String(name || '').trim().toLowerCase();
                        return Array.from(regions.values()).find(
                            (region) => region.name.toLowerCase() === normalized,
                        ) || null;
                    },
                    findRegionByLocationId: (locationId) => {
                        if (locationId === 'loc_maplebrook_common' || locationId === 'loc_hamlet_south_gate') {
                            return maplebrookRegion;
                        }
                        if (locationId === 'loc_combine_waystation_gorge_mouth') {
                            return copperwheelRegion;
                        }
                        return null;
                    },
                    createLocationFromEvent: async (options) => {
                        createdLocationCalls.push(options);
                        if (options.name === 'Hamlet South Gate') {
                            locations.set(createdSourceLocation.id, createdSourceLocation);
                            return createdSourceLocation;
                        }
                        if (options.name === 'Combine Waystation at Gorge Mouth') {
                            locations.set(createdDestinationLocation.id, createdDestinationLocation);
                            return createdDestinationLocation;
                        }
                        return null;
                    },
                    createRegionStubFromEvent: async () => null,
                    ensureExitConnection: (...args) => {
                        ensureCalls.push(args);
                        return { id: ensureCalls.length === 1 ? 'exit_waystation' : 'exit_hamlet_gate' };
                    },
                    regenerateLocationName: async () => ({ name: 'unused' }),
                    gameLocations: locations,
                    regions,
                },
            },
            entries,
            {
                location: contextLocation,
                region: maplebrookRegion,
            }
        );

        assert.equal(createdLocationCalls.length, 2);
        assert.equal(createdLocationCalls[0].name, 'Hamlet South Gate');
        assert.equal(createdLocationCalls[0].targetRegionId, 'region_maplebrook');
        assert.equal(createdLocationCalls[0].createOriginExit, false);
        assert.equal(createdLocationCalls[1].name, 'Combine Waystation at Gorge Mouth');
        assert.equal(createdLocationCalls[1].originLocation, createdSourceLocation);
        assert.equal(createdLocationCalls[1].targetRegionId, 'region_copperwheel');
        assert.equal(ensureCalls.length, 2);
        assert.equal(ensureCalls[0][0], createdSourceLocation);
        assert.equal(ensureCalls[0][1], createdDestinationLocation);
        assert.equal(ensureCalls[0][2].destinationRegion, 'region_copperwheel');
        assert.equal(entries[0].originLocationId, 'loc_hamlet_south_gate');
        assert.equal(entries[0].originRegionId, 'region_maplebrook');
        assert.equal(entries[0].destinationId, 'loc_combine_waystation_gorge_mouth');
        assert.equal(entries[0].destinationRegionId, 'region_copperwheel');
        assert.equal(entries[0].destinationKind, 'location');
        assert.equal(entries[0].exitId, 'exit_waystation');
    } finally {
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('new_exit_discovered handler can target a pending region stub by name', async () => {
    const handlers = Events._buildHandlers();
    const parser = Events._buildParsers().new_exit_discovered;
    const previousCurrentPlayer = Globals.currentPlayer;
    Globals.currentPlayer = {
        getCurrentLocationName: () => 'Taproom',
    };

    try {
        const ensureCalls = [];
        const createdLocationCalls = [];
        const originLocation = {
            id: 'loc_taproom',
            name: 'Taproom',
            regionId: 'region_tavern',
            isVehicle: false,
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const destination = {
            id: 'loc_hidden_garden',
            name: 'Hidden Garden',
            regionId: 'pending_hedge',
            getAvailableDirections: () => [],
            getExit: () => null,
        };
        const pendingRegionStubs = new Map([
            ['pending_hedge', {
                id: 'pending_hedge',
                name: 'Hedge Maze',
                originalName: 'Hedge Maze',
                locationIds: [],
            }],
        ]);
        const entries = parser('Hidden Garden -> location -> none -> A concealed path through the hedge. -> 5 minutes -> current location -> current region -> Hedge Maze');

        await handlers.new_exit_discovered.call(
            {
                _deps: {
                    Location: {
                        get: () => null,
                        findByName: () => null,
                    },
                    findLocationByNameLoose: () => null,
                    findRegionByNameLoose: () => null,
                    findRegionByLocationId: () => ({ id: 'region_tavern', name: 'Tavern', isVehicle: false }),
                    createLocationFromEvent: async (options) => {
                        createdLocationCalls.push(options);
                        return destination;
                    },
                    createRegionStubFromEvent: async () => null,
                    ensureExitConnection: (...args) => ensureCalls.push(args),
                    regenerateLocationName: async () => ({ name: 'unused' }),
                    gameLocations: new Map(),
                    regions: new Map(),
                    pendingRegionStubs,
                },
            },
            entries,
            {
                location: originLocation,
                region: { id: 'region_tavern', name: 'Tavern', isVehicle: false },
            }
        );

        assert.equal(createdLocationCalls.length, 1);
        assert.equal(createdLocationCalls[0].targetRegionId, 'pending_hedge');
        assert.equal(ensureCalls.length, 2);
        assert.equal(ensureCalls[0][2].destinationRegion, 'pending_hedge');
    } finally {
        Globals.currentPlayer = previousCurrentPlayer;
    }
});

test('new_exit_discovered handler threads travel time through region stub creation', async () => {
    const handlers = Events._buildHandlers();
    const previousCurrentPlayer = Globals.currentPlayer;
    Globals.currentPlayer = {
        getCurrentLocationName: () => 'Taproom',
    };

    try {
        const createdRegionCalls = [];
        const originLocation = {
            id: 'loc_taproom',
            name: 'Taproom',
            regionId: 'region_tavern',
            isVehicle: false,
            getAvailableDirections: () => [],
            getExit: () => null,
        };

        await handlers.new_exit_discovered.call(
            {
                _deps: {
                    Location: {
                        get: () => null,
                        findByName: () => null,
                    },
                    findLocationByNameLoose: () => null,
                    findRegionByNameLoose: () => null,
                    findRegionByLocationId: () => ({ id: 'region_tavern', isVehicle: false }),
                    createLocationFromEvent: async () => null,
                    createRegionStubFromEvent: async (options) => {
                        createdRegionCalls.push(options);
                        return {
                            id: 'loc_mines_entrance',
                            name: 'Forgotten Mine Entrance',
                            regionId: 'region_forgotten_mines',
                            stubMetadata: {
                                regionId: 'region_forgotten_mines',
                            },
                        };
                    },
                    ensureExitConnection: () => {
                        throw new Error('ensureExitConnection should not run for freshly created region stubs');
                    },
                    regenerateLocationName: async () => ({ name: 'unused' }),
                    gameLocations: new Map(),
                },
            },
            [
                {
                    name: 'Forgotten Mines',
                    kind: 'region',
                    vehicleType: null,
                    description: 'A collapsed mining complex beyond the cellar tunnel.',
                    travelTimeMinutes: 90,
                },
            ],
            {
                location: originLocation,
                region: { id: 'region_tavern', isVehicle: false },
            }
        );

        assert.equal(createdRegionCalls.length, 1);
        assert.equal(createdRegionCalls[0].travelTimeMinutes, 90);
    } finally {
        Globals.currentPlayer = previousCurrentPlayer;
    }
});
