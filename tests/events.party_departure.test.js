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
