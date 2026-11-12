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

test('party joins reconcile raw and disposition hostility while friendly joins and departures remain unchanged', async () => {
    const old = { deps: Events._deps, handlers: Events._handlers, parsers: Events._parsers, aggregators: Events._aggregators };
    const changes = [];
    const player = { id: 'player', name: 'Hero', addPartyMember: id => { changes.push(['joined', id]); return id !== 'duplicate'; }, removePartyMember: id => changes.push(['left', id]) };
    const makeNpc = (id, raw, platonic) => {
        const values = { platonic, romantic: 12, lust: 0, respect: 0, comfort_fear: 0, trust: 0 };
        return { id, name: id, isNPC: true, isHostile: raw, values,
            getDisposition: (_targetId, type) => values[type] ?? 0,
            getDispositionTowardsCurrentPlayer: type => values[type] ?? 0,
            setDispositionTowardsCurrentPlayer: (type, value) => { values[type] = value; } };
    };
    const actors = [makeNpc('raw', true, 0), makeNpc('threshold', false, -31), makeNpc('friendly', false, 7), makeNpc('leaving', true, -31), makeNpc('duplicate', true, -31)];
    Player.setCurrentPlayerResolver(() => player);
    Events.initialize({ getConfig: () => ({}), ensureNpcByName: async () => null, findActorByName: name => actors.find(actor => actor.name === name) || null });
    Events._resetTrackingSets();
    try {
        await Events.applyEventOutcomes({ parsed: { party_change: actors.map((actor, index) => ({ name: actor.name, action: index === 3 ? 'left' : 'joined' })) }, rawEntries: {} }, { player });
        assert.deepEqual(changes, [['joined', 'raw'], ['joined', 'threshold'], ['joined', 'friendly'], ['left', 'leaving'], ['joined', 'duplicate']]);
        assert.equal(actors[0].isHostile, false);
        assert.equal(actors[1].values.platonic, 0);
        assert.equal(actors[1].values.romantic, 12, 'positive dispositions remain intact');
        assert.equal(actors[2].values.platonic, 7);
        assert.equal(actors[3].isHostile, true, 'departures do not change hostility');
        assert.equal(actors[3].values.platonic, -31);
        assert.equal(actors[4].isHostile, true, 'failed or duplicate joins do not change hostility');
    } finally {
        Player.setCurrentPlayerResolver(null); Events._deps = old.deps; Events._handlers = old.handlers; Events._parsers = old.parsers; Events._aggregators = old.aggregators; Events._resetTrackingSets();
    }
});

test('hostility event skips one failing actor and processes later actors', async () => {
    const old = { deps: Events._deps, handlers: Events._handlers, parsers: Events._parsers, aggregators: Events._aggregators, warn: Events._warnEventEntryFailures };
    const player = { id: 'player' }, failed = { id: 'bad', name: 'Bad', isHostile: true }, values = { platonic: -31, romantic: 9 };
    const good = { id: 'good', name: 'Good', isHostile: true, getDisposition: (_id, type) => values[type] ?? 0, getDispositionTowardsCurrentPlayer: type => values[type] ?? 0, setDispositionTowardsCurrentPlayer: (type, value) => { values[type] = value; } };
    let failures;
    Player.setCurrentPlayerResolver(() => player);
    Events.initialize({ getConfig: () => ({}), ensureNpcByName: async () => null, findActorByName: name => name === 'Bad' ? failed : good });
    Events._warnEventEntryFailures = (_key, entries) => { failures = entries; };
    try {
        const entries = [{ name: 'Bad' }, { name: 'Good' }];
        await Events._handlers.hostile_to_friendly.call(Events, entries, { player });
        assert.equal(failures.length, 1); assert.match(failures[0].error.message, /getDisposition/i);
        assert.deepEqual(entries, [{ name: 'Good' }]); assert.equal(good.isHostile, false); assert.equal(values.platonic, 0); assert.equal(values.romantic, 9);
    } finally { Player.setCurrentPlayerResolver(null); Events._deps = old.deps; Events._handlers = old.handlers; Events._parsers = old.parsers; Events._aggregators = old.aggregators; Events._warnEventEntryFailures = old.warn; }
});
