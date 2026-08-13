const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Player = require('../Player.js');

test('hostile_to_friendly reconciles disposition-derived hostility even when the raw flag is false', async () => {
    const previousDeps = Events._deps;
    const previousHandlers = Events._handlers;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const currentPlayer = { id: 'player_baato', name: 'Baato' };
    const values = {
        platonic: -31,
        romantic: 0,
        lust: 0,
        respect: 0,
        comfort_fear: 0,
        trust: 0
    };
    const npc = {
        id: 'npc_lantern',
        name: 'QA Lantern Witness',
        isHostile: false,
        getDisposition(targetId, type) {
            assert.equal(targetId, currentPlayer.id);
            return values[type] ?? 0;
        },
        getDispositionTowardsCurrentPlayer(type) {
            return values[type] ?? 0;
        },
        setDispositionTowardsCurrentPlayer(type, value) {
            values[type] = value;
        }
    };

    Player.setCurrentPlayerResolver(() => currentPlayer);
    Events.initialize({
        getConfig: () => ({}),
        ensureNpcByName: async () => null,
        findActorByName: name => name === npc.name ? npc : null
    });
    Events._resetTrackingSets();

    try {
        const eventPayload = {
            parsed: {
                hostile_to_friendly: [{
                    name: npc.name,
                    previousDisposition: 'hostile',
                    newDisposition: 'neutral',
                    reason: 'The dispute was resolved.'
                }]
            },
            rawEntries: {
                hostile_to_friendly: [
                    'QA Lantern Witness -> hostile -> neutral -> The dispute was resolved.'
                ]
            }
        };
        await Events.applyEventOutcomes(eventPayload, {});

        assert.equal(values.platonic, 0);
        assert.equal(npc.isHostile, false);
        assert.equal(eventPayload.parsed.hostile_to_friendly.length, 1);
    } finally {
        Player.setCurrentPlayerResolver(null);
        Events._deps = previousDeps;
        Events._handlers = previousHandlers;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._resetTrackingSets();
    }
});
