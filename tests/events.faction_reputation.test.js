const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Faction = require('../Faction.js');

function createPlayer() {
    const standings = {};
    return {
        id: 'player_baato',
        name: 'Baato',
        factionId: null,
        getPartyMembers() {
            return [];
        },
        getFactionStanding(factionId) {
            return standings[factionId] ?? 0;
        },
        setFactionStanding(factionId, value) {
            standings[factionId] = value;
        },
        get standings() {
            return { ...standings };
        }
    };
}

async function applyReputationEvent({ witnesses }) {
    const player = createPlayer();
    const location = {
        id: 'loc_marker',
        name: 'March Start Marker',
        getNPCs() {
            return witnesses;
        }
    };
    const result = await Events.applyEventOutcomes({
        parsed: {
            faction_reputation_change: [{
                factionId: 'faction_lantern',
                factionName: 'QA Lantern Guild',
                rawFaction: 'QA Lantern Guild',
                amount: 1,
                reason: 'Completed a useful route-safety report.'
            }]
        },
        rawEntries: {
            faction_reputation_change: [
                'QA Lantern Guild -> increased a little -> Completed a useful route-safety report.'
            ]
        }
    }, {
        player,
        location,
        factionReputationChanges: []
    });
    return { player, result };
}

test('faction reputation applies once when a member of that faction witnesses the event', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    Faction.clear();
    Faction.create({ id: 'faction_lantern', name: 'QA Lantern Guild' });
    Events.initialize({
        getConfig: () => ({}),
        ensureNpcByName: async () => null,
        findActorByName: () => null
    });
    Events._resetTrackingSets();

    try {
        const { player, result } = await applyReputationEvent({
            witnesses: [{ id: 'npc_lantern', name: 'Lantern', factionId: 'faction_lantern' }]
        });
        assert.deepEqual(player.standings, { faction_lantern: 1 });
        assert.deepEqual(result.factionReputationChanges, [{
            factionId: 'faction_lantern',
            factionName: 'QA Lantern Guild',
            amount: 1,
            before: 0,
            after: 1,
            reason: 'Completed a useful route-safety report.'
        }]);
    } finally {
        Faction.clear();
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._resetTrackingSets();
    }
});

test('faction reputation is ignored when no player, party member, or local NPC carries that faction', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    Faction.clear();
    Faction.create({ id: 'faction_lantern', name: 'QA Lantern Guild' });
    Events.initialize({
        getConfig: () => ({}),
        ensureNpcByName: async () => null,
        findActorByName: () => null
    });
    Events._resetTrackingSets();

    try {
        const { player, result } = await applyReputationEvent({
            witnesses: [{ id: 'npc_cinder', name: 'Cinder', factionId: 'faction_cinder' }]
        });
        assert.deepEqual(player.standings, {});
        assert.deepEqual(result.factionReputationChanges, []);
    } finally {
        Faction.clear();
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._resetTrackingSets();
    }
});
