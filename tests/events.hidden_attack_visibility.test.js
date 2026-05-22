const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test('attack_damage reveals a hidden attacker', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;

    const attacker = {
        id: 'npc-shade',
        name: 'Shade',
        isNPC: true,
        hiddenFromPlayer: true
    };
    const defender = {
        id: 'player-baato',
        name: 'Baato',
        isNPC: false,
        hiddenFromPlayer: false
    };

    Events.initialize({
        getConfig: () => ({}),
        players: new Map([
            [attacker.id, attacker],
            [defender.id, defender]
        ]),
        ensureNpcByName: async (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return [attacker, defender].find(actor => actor.name.toLowerCase() === normalized) || null;
        },
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            return [attacker, defender].find(actor => actor.name.toLowerCase() === normalized) || null;
        }
    });
    Events._resetTrackingSets();

    try {
        const result = await Events.applyEventOutcomes({
            parsed: {
                attack_damage: [{
                    attacker: 'Shade',
                    target: 'Baato'
                }]
            },
            rawEntries: {
                attack_damage: ['Shade -> Baato']
            }
        }, {});

        assert.equal(attacker.hiddenFromPlayer, false);
        assert.equal(result.locationRefreshRequested, true);
    } finally {
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._resetTrackingSets();
    }
});
