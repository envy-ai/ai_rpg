const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

function createMoveFixture({ shortestTravelTimeMinutes, sourceRegion = null } = {}) {
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
                assert.equal(source, originLocation.id);
                assert.equal(destination, destinationLocation.id);
                return shortestTravelTimeMinutes;
            }
        },
        findLocationByNameLoose: () => destinationLocation,
        findRegionByLocationId: () => sourceRegion,
        createLocationFromEvent: async () => destinationLocation
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
