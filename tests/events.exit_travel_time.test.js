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
                    ensureExitConnection: (...args) => ensureCalls.push(args),
                    regenerateLocationName: async () => ({ name: 'unused' }),
                    gameLocations: new Map(),
                },
            },
            [
                {
                    name: 'Hidden Cellar',
                    kind: 'location',
                    vehicleType: null,
                    description: 'A hidden cellar beneath the tavern.',
                    travelTimeMinutes: 65,
                },
            ],
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
