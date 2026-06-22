const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

function createMoveFixture({
    shortestTravelTimeMinutes,
    sourceRegion = null,
    destinationRegion = null,
    backfillRegionExitTravelTimes = null,
    onShortestTravelTimeLookup = null
} = {}) {
    const originLocation = {
        id: 'loc_origin',
        name: 'Origin',
        isVehicle: false,
        vehicleInfo: null
    };
    const destinationLocation = {
        id: 'loc_destination',
        name: 'Destination',
        isVehicle: false,
        vehicleInfo: null
    };
    const player = {
        isNPC: false,
        currentLocation: originLocation.id,
        setLocation(locationId) {
            this.currentLocation = typeof locationId === 'object' ? locationId.id : locationId;
        }
    };
    const advances = [];
    const previousAdvanceTime = Globals.advanceTime;
    const previousProcessedMove = Globals.processedMove;
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;

    Globals.advanceTime = (minutes, options = {}) => {
        advances.push({ minutes, options });
        return {
            source: options.source,
            advancedMinutes: minutes,
            transitions: []
        };
    };
    Globals.processedMove = false;

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        getCurrentPlayer: () => player,
        Location: {
            get(value) {
                if (value === originLocation.id || value === originLocation.name) {
                    return originLocation;
                }
                if (value === destinationLocation.id || value === destinationLocation.name) {
                    return destinationLocation;
                }
                return null;
            },
            findByName(value) {
                return value === destinationLocation.name ? destinationLocation : null;
            },
            findShortestTravelTimeMinutes(source, destination) {
                if (typeof onShortestTravelTimeLookup === 'function') {
                    onShortestTravelTimeLookup();
                }
                assert.equal(source, originLocation.id);
                assert.equal(destination, destinationLocation.id);
                return shortestTravelTimeMinutes;
            }
        },
        findLocationByNameLoose: () => destinationLocation,
        findRegionByLocationId: (locationId) => {
            if (locationId === originLocation.id) {
                return sourceRegion;
            }
            if (locationId === destinationLocation.id) {
                return destinationRegion || sourceRegion;
            }
            return null;
        },
        createLocationFromEvent: async () => destinationLocation,
        backfillRegionExitTravelTimes
    });

    return {
        advances,
        originLocation,
        destinationLocation,
        player,
        async moveWithOptionalTimePassed(timePassed = null) {
            const parsed = {
                parsed: {
                    move_location: [destinationLocation.name]
                },
                rawEntries: {
                    move_location: [destinationLocation.name]
                }
            };
            if (timePassed !== null) {
                parsed.parsed.time_passed = timePassed;
                parsed.rawEntries.time_passed = String(timePassed);
            }
            return Events.applyEventOutcomes(parsed, {
                player,
                location: originLocation
            });
        },
        cleanup() {
            Globals.advanceTime = previousAdvanceTime;
            Globals.processedMove = previousProcessedMove;
            Events._deps = previousDeps;
            Events._handlers = previousHandlers;
            Events._parsers = previousParsers;
            Events._aggregators = previousAggregators;
            Events._resetTrackingSets();
        }
    };
}

test('event-driven player movement advances time by shortest route and suppresses duplicate time_passed', async () => {
    const fixture = createMoveFixture({ shortestTravelTimeMinutes: 17 });
    try {
        const context = await fixture.moveWithOptionalTimePassed(45);

        assert.equal(fixture.player.currentLocation, fixture.destinationLocation.id);
        assert.deepEqual(fixture.advances, [
            { minutes: 17, options: { source: 'event_move_travel' } }
        ]);
        assert.equal(context.timeProgress.advancedMinutes, 17);
    } finally {
        fixture.cleanup();
    }
});

test('event-driven player movement backfills destination-region travel times before duration lookup', async () => {
    const callOrder = [];
    const destinationRegion = { id: 'region_destination', name: 'Destination Region' };
    const fixture = createMoveFixture({
        shortestTravelTimeMinutes: 23,
        sourceRegion: { id: 'region_origin', name: 'Origin Region' },
        destinationRegion,
        backfillRegionExitTravelTimes: async (payload) => {
            callOrder.push({ type: 'backfill', payload });
            return { promptUsed: true };
        },
        onShortestTravelTimeLookup: () => {
            callOrder.push({ type: 'duration_lookup' });
        }
    });
    try {
        await fixture.moveWithOptionalTimePassed();

        assert.equal(callOrder[0]?.type, 'backfill');
        assert.deepEqual(callOrder[0]?.payload, {
            region: destinationRegion,
            locationOverride: fixture.destinationLocation
        });
        assert.equal(callOrder[1]?.type, 'duration_lookup');
    } finally {
        fixture.cleanup();
    }
});

test('event-driven player movement ignores travel-time backfill failures before duration lookup', async () => {
    const callOrder = [];
    const destinationRegion = { id: 'region_destination', name: 'Destination Region' };
    const fixture = createMoveFixture({
        shortestTravelTimeMinutes: 23,
        sourceRegion: { id: 'region_origin', name: 'Origin Region' },
        destinationRegion,
        backfillRegionExitTravelTimes: async () => {
            callOrder.push({ type: 'backfill' });
            throw new Error('prompt parse failed');
        },
        onShortestTravelTimeLookup: () => {
            callOrder.push({ type: 'duration_lookup' });
        }
    });
    try {
        await fixture.moveWithOptionalTimePassed();

        assert.equal(callOrder[0]?.type, 'backfill');
        assert.equal(callOrder[1]?.type, 'duration_lookup');
        assert.equal(fixture.player.currentLocation, fixture.destinationLocation.id);
    } finally {
        fixture.cleanup();
    }
});

test('event-driven player movement assumes one minute when no route exists', async () => {
    const fixture = createMoveFixture({ shortestTravelTimeMinutes: null });
    try {
        const context = await fixture.moveWithOptionalTimePassed();

        assert.equal(fixture.player.currentLocation, fixture.destinationLocation.id);
        assert.deepEqual(fixture.advances, [
            { minutes: 1, options: { source: 'event_move_travel' } }
        ]);
        assert.equal(context.timeProgress.advancedMinutes, 1);
    } finally {
        fixture.cleanup();
    }
});

test('event-driven player movement with zero-minute route suppresses duplicate time_passed', async () => {
    const fixture = createMoveFixture({ shortestTravelTimeMinutes: 0 });
    try {
        const context = await fixture.moveWithOptionalTimePassed(45);

        assert.equal(fixture.player.currentLocation, fixture.destinationLocation.id);
        assert.deepEqual(fixture.advances, []);
        assert.equal(context.timeProgress, undefined);
        assert.equal(context.suppressTimeAdvance, true);
    } finally {
        fixture.cleanup();
    }
});

test('event-driven player movement inside a vehicle does not apply fast-travel time', async () => {
    const fixture = createMoveFixture({
        shortestTravelTimeMinutes: 17,
        sourceRegion: {
            id: 'vehicle_region',
            isVehicle: true,
            vehicleInfo: { vehicleExitId: 'exit_vehicle' }
        }
    });
    try {
        const context = await fixture.moveWithOptionalTimePassed(45);

        assert.equal(fixture.player.currentLocation, fixture.destinationLocation.id);
        assert.deepEqual(fixture.advances, []);
        assert.equal(context.timeProgress, undefined);
        assert.equal(context.suppressTimeAdvance, true);
    } finally {
        fixture.cleanup();
    }
});

test('event-driven player movement to an in-motion vehicle destination is suppressed while time_passed still applies', async () => {
    const previousElapsedTime = Globals.elapsedTime;
    Globals.elapsedTime = 75;
    const fixture = createMoveFixture({
        shortestTravelTimeMinutes: 17,
        sourceRegion: {
            id: 'vehicle_region',
            isVehicle: true,
            vehicleInfo: {
                pendingDestination: {
                    locationId: 'loc_destination',
                    locationName: 'Destination'
                },
                ETA: 100,
                departureTime: 50,
                vehicleExitId: 'exit_vehicle'
            }
        }
    });
    try {
        const context = await fixture.moveWithOptionalTimePassed(45);

        assert.equal(fixture.player.currentLocation, fixture.originLocation.id);
        assert.deepEqual(fixture.advances, [
            { minutes: 45, options: { source: 'event_check' } }
        ]);
        assert.equal(context.timeProgress.advancedMinutes, 45);
        assert.equal(context.suppressedActiveVehicleDestinationMove, true);
        assert.equal(context.suppressTimeAdvance, undefined);
    } finally {
        fixture.cleanup();
        Globals.elapsedTime = previousElapsedTime;
    }
});
