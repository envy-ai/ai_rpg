const test = require('node:test');
const assert = require('node:assert/strict');
const Events = require('../Events.js');

test.afterEach(() => Events.initialize({}));

function setup(preferredId = 'source') {
    const source = { id: 'source', name: 'Berry Bush', count: 3 };
    const duplicate = { id: 'duplicate', name: 'Berry Bush', count: 2 };
    const snack = { id: 'snack', name: 'Snack', count: 3 };
    const things = new Map([source, duplicate, snack].map(thing => [thing.id, thing]));
    Events.initialize({
        things,
        config: { omit_npc_generation: true },
        findThingByName(name) {
            return (name === 'Berry Bush' && things.get(preferredId)) || [...things.values()].find(thing => thing.name === name);
        },
    });
    Events._resetTrackingSets();
    return { source, duplicate, snack };
}

async function apply(rows, protectedConsumptionThingIds = []) {
    const events = { parsed: { consume_item: rows }, rawEntries: {} };
    await Events.applyEventOutcomes(events, { protectedConsumptionThingIds });
    return events;
}

test('protected harvest source consumption is omitted while unrelated consumption still applies', async () => {
    const { source, duplicate, snack } = setup();
    const events = await apply([
        { item: 'Berry Bush', quantity: 1 },
        { item: 'Snack', quantity: 1 },
    ], ['source']);
    assert.equal(source.count, 3);
    assert.equal(duplicate.count, 2, 'the ignored source event must not be redirected');
    assert.equal(snack.count, 2);
    assert.deepEqual(events.parsed.consume_item.map(entry => entry.item), ['Snack']);
    assert.equal(Events.destroyedItems.has('Berry Bush'), false);
    assert.equal(Events.destroyedItems.has('Snack'), true);
});

test('same-name event consumes an unprotected first stack only if its quantity does not reach the protected source', async () => {
    const { source, duplicate } = setup('duplicate');
    let events = await apply([{ item: 'Berry Bush', quantity: 1 }], ['source']);
    assert.equal(duplicate.count, 1);
    assert.equal(source.count, 3);
    assert.equal(events.parsed.consume_item.length, 1);
    Events._resetTrackingSets();
    events = await apply([{ item: 'Berry Bush', quantity: 2 }], ['source']);
    assert.equal(duplicate.count, 1, 'the whole event is ignored if it would reach the protected source');
    assert.equal(source.count, 3);
    assert.equal(events.parsed.consume_item.length, 0);
    assert.equal(Events.destroyedItems.has('Berry Bush'), false);
});

test('protection is scoped to one event execution', async () => {
    const { source } = setup();
    await apply([{ item: 'Berry Bush', quantity: 1 }], ['source']);
    const events = await apply([{ item: 'Berry Bush', quantity: 1 }]);
    assert.equal(source.count, 2);
    assert.equal(events.parsed.consume_item.length, 1);
    assert.equal(Events.destroyedItems.has('Berry Bush'), true);
});

test('consecutive same-name events cannot consume the source after exhausting an unprotected stack', async () => {
    const { source, duplicate } = setup('duplicate');
    duplicate.count = 1;
    const events = await apply([
        { item: 'Berry Bush', quantity: 1 },
        { item: 'Berry Bush', quantity: 1 },
    ], ['source']);
    assert.equal(source.count, 3);
    assert.equal(events.parsed.consume_item.length, 1);
    assert.equal(events.parsed.consume_item[0].itemSnapshots[0].itemId, 'duplicate');
});

test('XML event checks carry source protection through parsing and return only applied events', async () => {
    const Globals = require('../Globals.js');
    const LLMClient = require('../LLMClient.js');
    const previous = { config: Globals.config, player: Globals.currentPlayer, completion: LLMClient.chatCompletion, log: LLMClient.logPrompt };
    const { source, duplicate, snack } = setup('duplicate');
    const originalConsume = Events._consumeThingQuantity;
    Events._consumeThingQuantity = function (thing, quantity, context) {
        const result = originalConsume.call(this, thing, quantity, context);
        if (thing === snack) duplicate.count = 1; // Stock changed after parsing but before the later event.
        return result;
    };
    const player = { name: 'Harvester', isNPC: false, currency: 0, adjustCurrency(amount) { this.currency += amount; } };
    Globals.config = { ai: {}, event_checks: { enabled: true }, quests: { enabled: false }, omit_npc_generation: true };
    Globals.currentPlayer = player;
    LLMClient.logPrompt = () => {};
    LLMClient.chatCompletion = async () => `<events>
        <consumeItem><fullItemName>Snack</fullItemName><quantity>1</quantity><reason>Eaten</reason></consumeItem>
        <consumeItem><fullItemName>Berry Bush</fullItemName><quantity>2</quantity><reason>Used up</reason></consumeItem>
        <currency><amount>7</amount></currency>
        <inCombat><value>false</value></inCombat>
        <anyQuestObjectivesCompleted><value>false</value></anyQuestObjectivesCompleted>
    </events>`;
    Object.assign(Events._deps, {
        promptEnv: { render: () => 'prompt' },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'prompt' }),
        prepareBasePromptContext: async () => ({ needBarDefinitions: [], npcs: [], party: [] }),
        Location: { get: () => null },
        findRegionByLocationId: () => null,
        getCurrentPlayer: () => player,
        getConfig: () => Globals.config,
    });
    try {
        const result = await Events.runEventChecks({ textToCheck: 'The bush and snack are consumed.', protectedConsumptionThingIds: ['source'], ignoredEventKeys: ['technique_change'], suppressNeedBarEventChecks: true, suppressHousekeeping: true });
        assert.equal(source.count, 3);
        assert.equal(snack.count, 2);
        assert.equal(duplicate.count, 1);
        assert.equal(player.currency, 7);
        assert.deepEqual(result.structured.parsed.consume_item.map(entry => entry.item), ['Snack']);
        assert.equal(Events.destroyedItems.has('Berry Bush'), false);
    } finally {
        Events._consumeThingQuantity = originalConsume;
        Globals.config = previous.config;
        Globals.currentPlayer = previous.player;
        LLMClient.chatCompletion = previous.completion;
        LLMClient.logPrompt = previous.log;
    }
});

test('consecutive same-name events follow native lookup order after a preferred stack is exhausted', async () => {
    const first = { id: 'first', name: 'Berry Bush', count: 1 };
    const second = { id: 'second', name: 'Berry Bush', count: 1 };
    const source = { id: 'source', name: 'Berry Bush', count: 10 };
    const things = new Map([first, second, source].map(thing => [thing.id, thing]));
    Events.initialize({
        things,
        config: { omit_npc_generation: true },
        findThingByName: name => [...things.values()].find(thing => thing.name === name),
    });
    Events._resetTrackingSets();
    const events = await apply([
        { item: 'Berry Bush', quantity: 1 },
        { item: 'Berry Bush', quantity: 1 },
    ], ['source']);
    assert.equal(things.has('first'), false);
    assert.equal(things.has('second'), false);
    assert.equal(source.count, 10);
    assert.deepEqual(events.parsed.consume_item.map(entry => entry.itemSnapshots[0].itemId), ['first', 'second']);
});
