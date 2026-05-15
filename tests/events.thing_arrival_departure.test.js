const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

function createLocation(id, name, things) {
    const thingIds = new Set();
    const npcIds = new Set();
    const location = {
        id,
        name,
        addThingId(thingId) {
            for (const candidate of locations.values()) {
                candidate._thingIds.delete(thingId);
            }
            thingIds.add(thingId);
            const thing = things.get(thingId);
            if (thing) {
                thing.metadata = { ...(thing.metadata || {}), locationId: id };
            }
        },
        removeThingId(thingId) {
            const removed = thingIds.delete(thingId);
            const thing = things.get(thingId);
            if (removed && thing?.metadata?.locationId === id) {
                const metadata = { ...thing.metadata };
                delete metadata.locationId;
                thing.metadata = metadata;
            }
            return removed;
        },
        hasThing(thingId) {
            return thingIds.has(thingId);
        },
        addNpcId(npcId) {
            npcIds.add(npcId);
        },
        removeNpcId(npcId) {
            return npcIds.delete(npcId);
        },
        hasNpc(npcId) {
            return npcIds.has(npcId);
        },
        get _thingIds() {
            return thingIds;
        },
        get _npcIds() {
            return npcIds;
        }
    };
    locations.set(id, location);
    locations.set(name, location);
    return location;
}

let locations;

function createThing(id, name) {
    return {
        id,
        name,
        metadata: {},
        removeFromWorld() {
            for (const location of locations.values()) {
                if (location && typeof location.removeThingId === 'function') {
                    location.removeThingId(id);
                }
            }
        }
    };
}

function createActor(id, name, currentLocation) {
    return {
        id,
        name,
        isNPC: true,
        currentLocation,
        setLocation(locationOrId) {
            const locationId = typeof locationOrId === 'string'
                ? locationOrId
                : locationOrId?.id;
            if (this.currentLocation && locations.has(this.currentLocation)) {
                const previousLocation = locations.get(this.currentLocation);
                if (previousLocation && typeof previousLocation.removeNpcId === 'function') {
                    previousLocation.removeNpcId(id);
                }
            }
            this.currentLocation = locationId;
            if (locationId && locations.has(locationId)) {
                const nextLocation = locations.get(locationId);
                if (nextLocation && typeof nextLocation.addNpcId === 'function') {
                    nextLocation.addNpcId(id);
                }
            }
        }
    };
}

test('thing_arrival_departure moves existing things into and out of locations', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;

    locations = new Map();
    const things = new Map();
    const origin = createLocation('loc_origin', 'Market Square', things);
    const storage = createLocation('loc_storage', 'Warehouse', things);
    const destination = createLocation('loc_destination', 'Watchtower', things);
    const wagon = createThing('thing_wagon', 'Supply Wagon');
    const beacon = createThing('thing_beacon', 'Signal Beacon');
    things.set(wagon.id, wagon);
    things.set(beacon.id, beacon);
    storage.addThingId(wagon.id);
    origin.addThingId(beacon.id);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        things,
        findThingByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(things.values()).find(thing => thing.name.toLowerCase() === normalized) || null;
        },
        findLocationByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(new Set(locations.values())).find(location => location.name.toLowerCase() === normalized) || null;
        },
        findRegionByNameLoose: () => null,
        Location: {
            get: (id) => locations.get(id) || null,
            findByName: (name) => locations.get(name) || null,
            getByName: (name) => locations.get(name) || null
        },
        regions: new Map(),
        gameLocations: locations
    });

    try {
        await Events.applyEventOutcomes({
            parsed: {
                thing_arrival_departure: [
                    { name: 'Supply Wagon', action: 'arrived' },
                    {
                        name: 'Signal Beacon',
                        action: 'left',
                        destinationRegion: 'Town',
                        destinationLocation: 'Watchtower'
                    }
                ]
            },
            rawEntries: {
                thing_arrival_departure: 'Supply Wagon -> arrived | Signal Beacon -> left -> Town -> Watchtower'
            }
        }, {
            location: origin
        });

        assert.equal(origin.hasThing(wagon.id), true);
        assert.equal(storage.hasThing(wagon.id), false);
        assert.equal(destination.hasThing(beacon.id), true);
        assert.equal(origin.hasThing(beacon.id), false);
        assert.equal(wagon.metadata.locationId, origin.id);
        assert.equal(beacon.metadata.locationId, destination.id);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._resetTrackingSets();
        locations = null;
    }
});

test('thing_move_with_character follows a departing NPC to their resolved destination', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;

    locations = new Map();
    const things = new Map();
    const actors = new Map();
    const origin = createLocation('loc_origin', 'Market Square', things);
    const destination = createLocation('loc_destination', 'Watchtower', things);
    const regions = new Map([
        ['region_town', { id: 'region_town', name: 'Town', locationIds: [destination.id] }]
    ]);
    const wagon = createThing('thing_wagon', 'Supply Wagon');
    const courier = createActor('npc_courier', 'Courier Mira', origin.id);
    things.set(wagon.id, wagon);
    actors.set(courier.id, courier);
    origin.addThingId(wagon.id);
    origin.addNpcId(courier.id);

    const findActorByName = (name) => {
        const normalized = String(name || '').trim().toLowerCase();
        return Array.from(actors.values()).find(actor => actor.name.toLowerCase() === normalized) || null;
    };

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: false }),
        players: actors,
        things,
        findThingByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(things.values()).find(thing => thing.name.toLowerCase() === normalized) || null;
        },
        findActorByName,
        findActorById: (id) => actors.get(id) || null,
        ensureNpcByName: (name) => findActorByName(name),
        findLocationByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(new Set(locations.values())).find(location => location.name.toLowerCase() === normalized) || null;
        },
        findRegionByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(regions.values()).find(region => region.name.toLowerCase() === normalized) || null;
        },
        Location: {
            get: (id) => locations.get(id) || null,
            findByName: (name) => locations.get(name) || null,
            getByName: (name) => locations.get(name) || null
        },
        regions,
        gameLocations: locations
    });

    try {
        await Events.applyEventOutcomes({
            parsed: {
                npc_arrival_departure: [
                    {
                        name: 'Courier Mira',
                        action: 'left',
                        destination: 'Watchtower',
                        destinationRegion: 'Town',
                        destinationLocation: 'Watchtower'
                    }
                ],
                thing_move_with_character: [
                    { thingName: 'Supply Wagon', characterName: 'Courier Mira' }
                ]
            },
            rawEntries: {
                npc_arrival_departure: 'Courier Mira -> left -> Town -> Watchtower',
                thing_move_with_character: 'Supply Wagon -> Courier Mira'
            }
        }, {
            location: origin
        });

        assert.equal(courier.currentLocation, destination.id);
        assert.equal(destination.hasNpc(courier.id), true);
        assert.equal(destination.hasThing(wagon.id), true);
        assert.equal(origin.hasThing(wagon.id), false);
        assert.equal(wagon.metadata.locationId, destination.id);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._resetTrackingSets();
        locations = null;
    }
});

test('thing_move_with_character follows the player to the current destination context', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousCurrentPlayer = Events.currentPlayer;

    locations = new Map();
    const things = new Map();
    const origin = createLocation('loc_origin', 'Market Square', things);
    const destination = createLocation('loc_destination', 'North Gate', things);
    const handcart = createThing('thing_handcart', 'Handcart');
    const player = {
        id: 'player_1',
        name: 'Wanderer',
        isNPC: false,
        currentLocation: destination.id
    };
    things.set(handcart.id, handcart);
    origin.addThingId(handcart.id);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: true }),
        currentPlayer: player,
        things,
        findThingByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(things.values()).find(thing => thing.name.toLowerCase() === normalized) || null;
        },
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return normalized === 'wanderer' || normalized === 'player' ? player : null;
        },
        findActorById: (id) => (id === player.id ? player : null),
        Location: {
            get: (id) => locations.get(id) || null,
            findByName: (name) => locations.get(name) || null,
            getByName: (name) => locations.get(name) || null
        },
        regions: new Map(),
        gameLocations: locations
    });

    try {
        await Events.applyEventOutcomes({
            parsed: {
                thing_move_with_character: [
                    { thingName: 'Handcart', characterName: 'player' }
                ]
            },
            rawEntries: {
                thing_move_with_character: 'Handcart -> player'
            }
        }, {
            player,
            location: destination
        });

        assert.equal(destination.hasThing(handcart.id), true);
        assert.equal(origin.hasThing(handcart.id), false);
        assert.equal(handcart.metadata.locationId, destination.id);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events.currentPlayer = previousCurrentPlayer;
        Events._resetTrackingSets();
        locations = null;
    }
});
