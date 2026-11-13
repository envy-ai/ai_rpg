const test = require('node:test');
const assert = require('node:assert/strict');

const Registry = require('../FactionFavorEffectRegistry.js');

const faction = { id: 'faction_guild', name: 'Ashen Guild' };
const favor = { id: 'favor_x', name: 'Test Favor' };

test('normalize rejects unknown params and canonicalizes values', () => {
    assert.equal(Registry.normalize(null), null);
    assert.equal(Registry.normalize({ type: 'none' }), null);
    assert.deepEqual(Registry.normalize({ type: 'grant-currency', params: { amount: '40' } }), { type: 'grant-currency', params: { amount: 40 } });
    assert.throws(() => Registry.normalize({ type: 'reveal-route', params: { where: 'x' } }), /unknown field "where"/);
    assert.throws(() => Registry.normalize({ type: 'restore-needs', params: { bars: [] } }), /non-empty list/);
    assert.throws(() => Registry.normalize({ type: 'restore-needs', params: { bars: [{ needBar: 'Rest', percentage: 120 }] } }), /from 0 to 100/);
    assert.throws(() => Registry.normalize({ type: 'grant-item', params: { name: 'Key' } }), /description must be a non-empty string/);
});

test('reveal-route picks a hidden exit in faction territory, preferring the current region, and errors before mutation when none exist', () => {
    const handler = Registry.get('reveal-route');
    const exit = (id, hidden) => ({ id, destination: `dest_${id}`, hiddenFromPlayer: hidden });
    const makeLocation = (id, regionId, exits, controllingFactionId = 'faction_guild') => ({
        id, name: id, regionId, controllingFactionId, isStub: false,
        getAvailableDirections: () => Object.keys(exits),
        getExit: direction => exits[direction]
    });
    const far = makeLocation('loc_far', 'region_far', { north: exit('exit_far', true) });
    const near = makeLocation('loc_near', 'region_here', { east: exit('exit_near', true), west: exit('exit_open', false) });
    const other = makeLocation('loc_other', 'region_here', { south: exit('exit_other', true) }, 'faction_other');
    const plan = handler.prepare({ type: 'reveal-route', params: {} }, {
        faction, favor, location: { regionId: 'region_here' },
        deps: { getAllLocations: () => [far, other, near], findRegionById: () => null }
    });
    assert.equal(plan.exit.id, 'exit_near');
    assert.throws(() => handler.prepare({ type: 'reveal-route', params: {} }, {
        faction, favor, location: null,
        deps: { getAllLocations: () => [other], findRegionById: () => null }
    }), /knows of no hidden routes/);
});

test('restore-needs resolves bars by name or id and rejects inactive bars before mutation', () => {
    const handler = Registry.get('restore-needs');
    const calls = [];
    const player = {
        getNeedBars: () => [{ id: 'rest', name: 'Rest' }, { id: 'food', name: 'Food' }],
        setNeedBarPercentages: entries => calls.push(entries)
    };
    const effect = { type: 'restore-needs', params: { bars: [{ needBar: 'rest', percentage: 100 }, { needBar: 'Food', percentage: 80 }] } };
    const plan = handler.prepare(effect, { player, faction, favor });
    const result = handler.apply(effect, plan, { player, faction, favor });
    assert.deepEqual(calls, [[{ id: 'rest', percentage: 100 }, { id: 'food', percentage: 80 }]]);
    assert.match(result.summary, /Rest 100%, Food 80%/);
    assert.throws(() => handler.prepare({ type: 'restore-needs', params: { bars: [{ needBar: 'Mana', percentage: 50 }] } }, { player, faction, favor }),
        /"Mana" is not active for the player\. Active need bars: Rest, Food/);
});

test('grant-item generates exactly one unmerged item and guards both requested and canonical names', async () => {
    const handler = Registry.get('grant-item');
    let request = null;
    const effect = { type: 'grant-item', params: { name: 'Guild Writ', description: 'A sealed pass.' } };
    const context = {
        faction, favor, player: { id: 'player' },
        deps: { generateItemsByNames: async options => { request = options; return [{ id: 'thing_1', name: 'Guild Writ of Passage' }]; } }
    };
    const result = await handler.apply(effect, handler.prepare(effect, context), context);
    assert.equal(request.options.mergeStacks, false);
    assert.equal(request.options.creationMetadata.factionFavorId, 'favor_x');
    assert.deepEqual(result.grantGuard.itemNames.sort(), ['Guild Writ', 'Guild Writ of Passage']);
});

test('grant-item contents source validates and blank values preserve fixed grants', () => {
    const params = { name: 'Parcel', description: 'A sealed parcel.' };
    const fixed = Registry.normalize({ type: 'grant-item', params });
    for (const value of ['', '   ', null]) {
        assert.deepEqual(Registry.normalize({ type: 'grant-item', params: { ...params, contentsSource: value } }), fixed);
    }
    assert.equal(Registry.normalize({ type: 'grant-item', params: { ...params, contentsSource: 'target' } }).params.contentsSource, 'target');
    assert.throws(() => Registry.normalize({ type: 'grant-item', params: { ...params, contentsSource: 'inventory' } }), /contentsSource/);
});
