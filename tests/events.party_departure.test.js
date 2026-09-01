const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Globals = require('../Globals.js');

function createLocation(id, name) {
    const npcIds = new Set();
    return {
        id,
        name,
        addNpcId(npcId) {
            npcIds.add(npcId);
        },
        removeNpcId(npcId) {
            npcIds.delete(npcId);
        },
        hasNpc(npcId) {
            return npcIds.has(npcId);
        }
    };
}

test('npc_arrival_departure makes an explicitly visible arriving NPC visible again', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousProcessedMove = Globals.processedMove;

    const origin = createLocation('loc_origin', 'Sleeping Nook');
    const destination = createLocation('loc_destination', 'Lift Head Platform');
    const locations = new Map([
        [origin.id, origin],
        [destination.id, destination]
    ]);
    const npc = {
        id: 'npc_slip',
        name: 'Slip of the Under-track',
        currentLocation: origin.id,
        hiddenFromPlayer: true,
        get location() {
            return locations.get(this.currentLocation) || null;
        },
        setLocation(location) {
            this.currentLocation = typeof location === 'object' ? location.id : location;
        }
    };
    origin.addNpcId(npc.id);

    const player = {
        id: 'player_exis',
        name: 'Exis',
        currentLocation: destination.id,
        getPartyMembers() {
            return [];
        }
    };
    const actors = new Map([
        [player.id, player],
        [npc.id, npc]
    ]);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: false }),
        getCurrentPlayer: () => player,
        players: actors,
        ensureNpcByName: async () => npc,
        findActorById: (id) => actors.get(id) || null,
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(actors.values()).find(actor => actor.name.toLowerCase() === normalized) || null;
        },
        Location: {
            get: (id) => locations.get(id) || null
        },
        gameLocations: locations
    });
    Events._resetTrackingSets();
    Globals.processedMove = false;

    const context = { player, location: destination };

    try {
        await Events.applyEventOutcomes({
            parsed: {
                npc_arrival_departure: [{
                    name: npc.name,
                    action: 'arrived',
                    hideFromPlayer: false
                }]
            },
            rawEntries: {
                npc_arrival_departure: [`${npc.name} -> arrived -> false`]
            }
        }, context);

        assert.equal(npc.currentLocation, destination.id);
        assert.equal(origin.hasNpc(npc.id), false);
        assert.equal(destination.hasNpc(npc.id), true);
        assert.equal(npc.hiddenFromPlayer, false);
        assert.equal(context.locationRefreshRequested, true);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Globals.processedMove = previousProcessedMove;
        Events._resetTrackingSets();
    }
});

test('npc_arrival_departure lets a party member leave the party and move to the destination', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousProcessedMove = Globals.processedMove;

    const origin = createLocation('loc_origin', 'Farmhouse Exterior');
    const destination = createLocation('loc_destination', 'Front Porch');
    const locations = new Map([
        [origin.id, origin],
        [destination.id, destination]
    ]);

    const partyMember = {
        id: 'npc_lina',
        name: 'Lina',
        currentLocation: null,
        get location() {
            return locations.get(this.currentLocation) || null;
        },
        setLocation(location) {
            const locationId = typeof location === 'object' ? location.id : location;
            this.currentLocation = locationId || null;
        }
    };

    const partyMembers = new Set([partyMember.id]);
    const player = {
        id: 'player_baato',
        name: 'Baato',
        currentLocation: origin.id,
        getPartyMembers() {
            return Array.from(partyMembers);
        },
        removePartyMember(memberId) {
            const removed = partyMembers.delete(memberId);
            if (removed) {
                partyMember.setLocation(origin);
                origin.addNpcId(memberId);
            }
            return removed;
        }
    };

    const actors = new Map([
        [player.id, player],
        [partyMember.id, partyMember]
    ]);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: false }),
        getCurrentPlayer: () => player,
        players: actors,
        ensureNpcByName: async (name) => actors.get(partyMember.id) || { id: partyMember.id, name },
        findActorById: (id) => actors.get(id) || null,
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(actors.values()).find(actor => actor.name.toLowerCase() === normalized) || null;
        },
        findLocationByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
        },
        findRegionByNameLoose: () => null,
        Location: {
            get: (id) => locations.get(id) || null,
            findByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
            },
            getByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
            }
        },
        regions: new Map(),
        gameLocations: locations
    });
    Events._resetTrackingSets();
    Globals.processedMove = false;

    try {
        await Events.applyEventOutcomes({
            parsed: {
                npc_arrival_departure: [{
                    name: 'Lina',
                    action: 'left',
                    destinationRegion: '',
                    destinationLocation: 'Front Porch'
                }]
            },
            rawEntries: {
                npc_arrival_departure: ['Lina -> left ->  -> Front Porch']
            }
        }, {
            player,
            location: origin
        });

        assert.deepEqual(player.getPartyMembers(), []);
        assert.equal(partyMember.currentLocation, destination.id);
        assert.equal(origin.hasNpc(partyMember.id), false);
        assert.equal(destination.hasNpc(partyMember.id), true);
        assert.equal(Events.departedCharacters.has('Lina'), true);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Globals.processedMove = previousProcessedMove;
        Events._resetTrackingSets();
    }
});

test('npc_arrival_departure keeps a party member when the player is already at the same destination', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousProcessedMove = Globals.processedMove;

    const origin = createLocation('loc_origin', 'Farmhouse Exterior');
    const destination = createLocation('loc_destination', 'Front Porch');
    const locations = new Map([
        [origin.id, origin],
        [destination.id, destination]
    ]);

    const partyMember = {
        id: 'npc_lina',
        name: 'Lina',
        currentLocation: null,
        get location() {
            return locations.get(this.currentLocation) || null;
        },
        setLocation(location) {
            const locationId = typeof location === 'object' ? location.id : location;
            this.currentLocation = locationId || null;
        }
    };

    const partyMembers = new Set([partyMember.id]);
    const player = {
        id: 'player_baato',
        name: 'Baato',
        currentLocation: destination.id,
        getPartyMembers() {
            return Array.from(partyMembers);
        },
        removePartyMember(memberId) {
            const removed = partyMembers.delete(memberId);
            if (removed) {
                partyMember.setLocation(origin);
                origin.addNpcId(memberId);
            }
            return removed;
        }
    };

    const actors = new Map([
        [player.id, player],
        [partyMember.id, partyMember]
    ]);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: false }),
        getCurrentPlayer: () => player,
        players: actors,
        ensureNpcByName: async (name) => actors.get(partyMember.id) || { id: partyMember.id, name },
        findActorById: (id) => actors.get(id) || null,
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(actors.values()).find(actor => actor.name.toLowerCase() === normalized) || null;
        },
        findLocationByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
        },
        findRegionByNameLoose: () => null,
        Location: {
            get: (id) => locations.get(id) || null,
            findByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
            },
            getByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
            }
        },
        regions: new Map(),
        gameLocations: locations
    });
    Events._resetTrackingSets();
    Globals.processedMove = false;

    const eventPayload = {
        parsed: {
            npc_arrival_departure: [{
                name: 'Lina',
                action: 'left',
                destinationRegion: '',
                destinationLocation: 'Front Porch'
            }]
        },
        rawEntries: {
            npc_arrival_departure: ['Lina -> left ->  -> Front Porch']
        }
    };

    try {
        await Events.applyEventOutcomes(eventPayload, {
            player,
            location: destination
        });

        assert.deepEqual(player.getPartyMembers(), [partyMember.id]);
        assert.equal(partyMember.currentLocation, null);
        assert.equal(origin.hasNpc(partyMember.id), false);
        assert.equal(destination.hasNpc(partyMember.id), false);
        assert.equal(Events.departedCharacters.has('Lina'), false);
        assert.deepEqual(eventPayload.parsed.npc_arrival_departure, []);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Globals.processedMove = previousProcessedMove;
        Events._resetTrackingSets();
    }
});

test('npc_arrival_departure creates an offscreen location stub in a known region for unresolved departures', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousProcessedMove = Globals.processedMove;

    const origin = createLocation('loc_origin', 'Factory Floor');
    const locations = new Map([[origin.id, origin]]);
    const regions = new Map();
    const knownRegion = {
        id: 'region_scrapyard',
        name: 'Scrapyard Expanse',
        locationIds: [],
        addLocationId(locationId) {
            if (!this.locationIds.includes(locationId)) {
                this.locationIds.push(locationId);
            }
        }
    };
    regions.set(knownRegion.id, knownRegion);

    const fleeingNpc = {
        id: 'npc_raider',
        name: 'Crimson Raider',
        currentLocation: origin.id,
        get location() {
            return locations.get(this.currentLocation) || null;
        },
        setLocation(location) {
            const locationId = typeof location === 'object' ? location.id : location;
            this.currentLocation = locationId || null;
        }
    };
    origin.addNpcId(fleeingNpc.id);

    const player = {
        id: 'player_baato',
        name: 'Baato',
        currentLocation: origin.id,
        getPartyMembers() {
            return [];
        }
    };
    const actors = new Map([
        [player.id, player],
        [fleeingNpc.id, fleeingNpc]
    ]);
    const createdLocationCalls = [];

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: false }),
        getCurrentPlayer: () => player,
        players: actors,
        ensureNpcByName: async (name) => actors.get(fleeingNpc.id) || { id: fleeingNpc.id, name },
        findActorById: (id) => actors.get(id) || null,
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(actors.values()).find(actor => actor.name.toLowerCase() === normalized) || null;
        },
        findLocationByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
        },
        findRegionByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(regions.values()).find(region => region.name.toLowerCase() === normalized) || null;
        },
        findRegionByLocationId: (locationId) => {
            return Array.from(regions.values()).find(region => region.locationIds.includes(locationId)) || null;
        },
        createLocationFromEvent: async (options) => {
            createdLocationCalls.push(options);
            const created = createLocation('loc_scrapyard_safehouse', options.name);
            created.regionId = options.targetRegionId;
            created.isStub = true;
            created.stubMetadata = {
                regionId: options.targetRegionId,
                createOriginExit: options.createOriginExit !== false
            };
            locations.set(created.id, created);
            knownRegion.addLocationId(created.id);
            return created;
        },
        Location: {
            get: (id) => locations.get(id) || null,
            findByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
            },
            getByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
            }
        },
        regions,
        gameLocations: locations
    });
    Events._resetTrackingSets();
    Globals.processedMove = false;

    try {
        await Events.applyEventOutcomes({
            parsed: {
                npc_arrival_departure: [{
                    name: 'Crimson Raider',
                    action: 'left',
                    destinationRegion: 'Scrapyard Expanse',
                    destinationLocation: 'Scrap-Bunker Safehouse'
                }]
            },
            rawEntries: {
                npc_arrival_departure: ['Crimson Raider -> left -> Scrapyard Expanse -> Scrap-Bunker Safehouse']
            }
        }, {
            player,
            location: origin
        });

        assert.equal(createdLocationCalls.length, 1);
        assert.equal(createdLocationCalls[0].name, 'Scrap-Bunker Safehouse');
        assert.equal(createdLocationCalls[0].targetRegionId, knownRegion.id);
        assert.equal(createdLocationCalls[0].createOriginExit, false);
        assert.equal(fleeingNpc.currentLocation, 'loc_scrapyard_safehouse');
        assert.equal(origin.hasNpc(fleeingNpc.id), false);
        assert.equal(locations.get('loc_scrapyard_safehouse').hasNpc(fleeingNpc.id), true);
        assert.deepEqual(knownRegion.locationIds, ['loc_scrapyard_safehouse']);
        assert.equal(Events.departedCharacters.has('Crimson Raider'), true);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Globals.processedMove = previousProcessedMove;
        Events._resetTrackingSets();
    }
});

test('npc_arrival_departure creates an offscreen pending region and child location stub for unresolved destination regions', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousProcessedMove = Globals.processedMove;

    const origin = createLocation('loc_origin', 'Market Alley');
    const locations = new Map([[origin.id, origin]]);
    const regions = new Map();
    const pendingRegionStubs = new Map();
    const regionStubCalls = [];
    const locationStubCalls = [];

    const fleeingNpc = {
        id: 'npc_runner',
        name: 'Cartel Runner',
        currentLocation: origin.id,
        get location() {
            return locations.get(this.currentLocation) || null;
        },
        setLocation(location) {
            const locationId = typeof location === 'object' ? location.id : location;
            this.currentLocation = locationId || null;
        }
    };
    origin.addNpcId(fleeingNpc.id);

    const player = {
        id: 'player_baato',
        name: 'Baato',
        currentLocation: origin.id,
        getPartyMembers() {
            return [];
        }
    };
    const actors = new Map([
        [player.id, player],
        [fleeingNpc.id, fleeingNpc]
    ]);

    Events.initialize({
        getConfig: () => ({ omit_npc_generation: false }),
        getCurrentPlayer: () => player,
        players: actors,
        ensureNpcByName: async (name) => actors.get(fleeingNpc.id) || { id: fleeingNpc.id, name },
        findActorById: (id) => actors.get(id) || null,
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(actors.values()).find(actor => actor.name.toLowerCase() === normalized) || null;
        },
        findLocationByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
        },
        findRegionByNameLoose: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return Array.from(regions.values()).find(region => region.name.toLowerCase() === normalized) ||
                Array.from(pendingRegionStubs.values()).find(region => String(region.name || region.originalName || '').toLowerCase() === normalized) ||
                null;
        },
        findRegionByLocationId: () => null,
        createRegionStubFromEvent: async (options) => {
            regionStubCalls.push(options);
            const regionId = 'region_ash_yards';
            const entryStub = createLocation('loc_ash_yards_entry', options.name);
            entryStub.isStub = true;
            entryStub.regionId = regionId;
            entryStub.stubMetadata = {
                isRegionEntryStub: true,
                targetRegionId: regionId,
                targetRegionName: options.name,
                createOriginExit: options.createOriginExit !== false
            };
            locations.set(entryStub.id, entryStub);
            pendingRegionStubs.set(regionId, {
                id: regionId,
                name: options.name,
                originalName: options.name,
                entranceStubId: entryStub.id,
                locationIds: []
            });
            return entryStub;
        },
        createLocationFromEvent: async (options) => {
            locationStubCalls.push(options);
            const created = createLocation('loc_drainage_tunnel', options.name);
            created.regionId = options.targetRegionId;
            created.isStub = true;
            created.stubMetadata = {
                regionId: options.targetRegionId,
                createOriginExit: options.createOriginExit !== false
            };
            locations.set(created.id, created);
            const pending = pendingRegionStubs.get(options.targetRegionId);
            pending.locationIds.push(created.id);
            return created;
        },
        Location: {
            get: (id) => locations.get(id) || null,
            findByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
            },
            getByName: (name) => {
                const normalized = String(name || '').trim().toLowerCase();
                return Array.from(locations.values()).find(location => location.name.toLowerCase() === normalized) || null;
            }
        },
        regions,
        gameLocations: locations,
        pendingRegionStubs
    });
    Events._resetTrackingSets();
    Globals.processedMove = false;

    try {
        await Events.applyEventOutcomes({
            parsed: {
                npc_arrival_departure: [{
                    name: 'Cartel Runner',
                    action: 'left',
                    destinationRegion: 'Ash Yards',
                    destinationLocation: 'Drainage Tunnel'
                }]
            },
            rawEntries: {
                npc_arrival_departure: ['Cartel Runner -> left -> Ash Yards -> Drainage Tunnel']
            }
        }, {
            player,
            location: origin
        });

        assert.equal(regionStubCalls.length, 1);
        assert.equal(regionStubCalls[0].name, 'Ash Yards');
        assert.equal(regionStubCalls[0].createOriginExit, false);
        assert.equal(locationStubCalls.length, 1);
        assert.equal(locationStubCalls[0].name, 'Drainage Tunnel');
        assert.equal(locationStubCalls[0].targetRegionId, 'region_ash_yards');
        assert.equal(locationStubCalls[0].createOriginExit, false);
        assert.equal(fleeingNpc.currentLocation, 'loc_drainage_tunnel');
        assert.equal(origin.hasNpc(fleeingNpc.id), false);
        assert.equal(locations.get('loc_drainage_tunnel').hasNpc(fleeingNpc.id), true);
        assert.deepEqual(pendingRegionStubs.get('region_ash_yards').locationIds, ['loc_drainage_tunnel']);
        assert.equal(Events.departedCharacters.has('Cartel Runner'), true);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Globals.processedMove = previousProcessedMove;
        Events._resetTrackingSets();
    }
});
