const test = require('node:test');
const assert = require('node:assert/strict');
const Thing = require('../Thing.js');
const ItemCatalogue = require('../ItemCatalogue.js');
const ThingMutationService = require('../ThingMutationService.js');

const makeItem = (overrides = {}) => new Thing({
    name: 'Iron Ingot', description: 'A bar of iron.', thingType: 'item',
    rarity: 'common', level: 2, ...overrides
});

test.beforeEach(() => { Thing.clear(); ItemCatalogue.clear(); });
test.afterEach(() => { Thing.clear(); ItemCatalogue.clear(); });

test('consuming the final copy retains a definition through catalogue save and load', () => {
    const item = makeItem({ count: 1, metadata: { ownerId: 'player_1', locationId: 'loc_1', weight: 3 } });
    const instances = new Map([[item.id, item]]);
    item.consumeOne({ things: instances });
    assert.equal(instances.size, 0);
    const records = ItemCatalogue.getByName('Iron Ingot');
    assert.equal(records.length, 1);
    assert.equal(records[0].reusable, false);
    const saved = JSON.parse(JSON.stringify(ItemCatalogue.toJSON()));
    ItemCatalogue.clear();
    ItemCatalogue.hydrate(saved);
    assert.deepEqual(ItemCatalogue.getByName('Iron Ingot'), records);
    assert.equal(ItemCatalogue.getAll()[0].blueprint.id, undefined);
    assert.equal(ItemCatalogue.getAll()[0].blueprint.count, undefined);
    assert.notEqual(ItemCatalogue.getAll()[0].blueprint.metadata?.ownerId, 'player_1');
});

test('distinct rarity and mechanics remain distinct definitions', () => {
    const common = makeItem();
    const rare = makeItem({ rarity: 'rare' });
    common.delete();
    rare.delete();
    const records = ItemCatalogue.getByName('Iron Ingot');
    assert.equal(records.length, 2);
    assert.notEqual(records[0].id, records[1].id);
});

test('unregistered prepared candidates never enter the catalogue', () => {
    const service = new ThingMutationService();
    service.prepareCreate({ name: 'Candidate', description: 'Not committed.', thingType: 'item' });
    assert.deepEqual(ItemCatalogue.getByName('Candidate'), []);
});

test('invalid saved catalogue data is rejected and clear isolates games', () => {
    const item = makeItem();
    item.delete();
    assert.throws(() => ItemCatalogue.hydrate({ version: 1, definitions: 'invalid' }));
    ItemCatalogue.clear();
    assert.deepEqual(ItemCatalogue.getAll(), []);
});

test('native save files retain extinct definitions and reject corrupt catalogue JSON', async () => {
    require('../LLMClient.js');
    const Utils = require('../Utils.js');
    const fs = require('node:fs');
    const path = require('node:path');
    const saveDir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'item-catalogue-test-'));
    const item = makeItem();
    item.delete();
    const catalogue = ItemCatalogue.toJSON();
    await Utils.writeSerializedGameState(saveDir, { itemCatalogue: catalogue });
    const loaded = Utils.loadSerializedGameState(saveDir);
    assert.deepEqual(loaded.itemCatalogue, catalogue);
    fs.writeFileSync(path.join(saveDir, 'itemCatalogue.json'), '{invalid');
    assert.throws(() => Utils.loadSerializedGameState(saveDir), SyntaxError);
});

test('rollback deletion does not preserve a provisional item', () => {
    const item = makeItem({ name: 'Rolled Back' });
    item.delete({ remember: false });
    assert.deepEqual(ItemCatalogue.getByName('Rolled Back'), []);
});

test('changing an item preserves its original and updated definitions', () => {
    const item = makeItem();
    ItemCatalogue.capture([item]);
    item.description = 'A polished bar of iron.';
    item.delete();
    const descriptions = ItemCatalogue.getByName('Iron Ingot').map(record => record.blueprint.description);
    assert.ok(descriptions.includes('A bar of iron.'));
    assert.ok(descriptions.includes('A polished bar of iron.'));
});

test('native hydration restores extinct definitions and seeds old saves from surviving items', () => {
    require('../LLMClient.js');
    const Utils = require('../Utils.js');
    const { createHydrationContext, createSceneSummariesStub } = require('./helpers/locationFixtures.js');
    const Globals = require('../Globals.js');
    const previousSceneSummaries = Globals.sceneSummaries;
    Globals.sceneSummaries = createSceneSummariesStub();
    const extinct = makeItem({ name: 'Extinct Potion' });
    extinct.delete();
    const survivor = makeItem({ name: 'Saved Ingot' });
    const serialized = Utils.serializeGameState({
        gameLocations: new Map(), gameLocationExits: new Map(), regions: new Map(),
        chatHistory: [], generatedImages: new Map(), things: new Map([[survivor.id, survivor]]),
        players: new Map(), skills: new Map(), factions: new Map(), pendingRegionStubs: new Map()
    });
    Utils.hydrateGameState(serialized, createHydrationContext());
    assert.equal(ItemCatalogue.getByName('Extinct Potion').length, 1);
    assert.equal(ItemCatalogue.getByName('Saved Ingot').length, 1);
    const oldSave = { ...serialized, itemCatalogue: undefined };
    Utils.hydrateGameState(oldSave, createHydrationContext());
    assert.equal(ItemCatalogue.getByName('Extinct Potion').length, 0);
    assert.equal(ItemCatalogue.getByName('Saved Ingot').length, 1);
    Globals.sceneSummaries = previousSceneSummaries;
});

test('legacy item metadata survives native hydration while the seeded catalogue uses usable numeric values', () => {
    require('../LLMClient.js');
    const Utils = require('../Utils.js');
    const Globals = require('../Globals.js');
    const { createHydrationContext, createSceneSummariesStub } = require('./helpers/locationFixtures.js');
    const previousSceneSummaries = Globals.sceneSummaries;
    Globals.sceneSummaries = createSceneSummariesStub();
    const items = [
        { id: 'thing_visor', name: 'Diagnostic Visor', metadata: { value: '1,200', weight: '1,234.5', properties: 'Optical filter', ownerId: 'char_owner' } },
        { id: 'thing_free', name: 'Free Token', metadata: { value: 0, weight: '0,000', properties: '' } }
    ].map(item => ({ ...item, description: 'A saved item.', thingType: 'item', count: 1 }));
    const serialized = {
        metadata: { saveFileSaveVersion: 1.2 },
        things: Object.fromEntries(items.map(item => [item.id, item]))
    };
    const context = createHydrationContext();
    try {
        Utils.hydrateGameState(serialized, context);
        assert.deepEqual([...context.things.keys()].sort(), items.map(item => item.id).sort());
        for (const item of items) {
            assert.equal(context.things.get(item.id).id, item.id);
            for (const [key, value] of Object.entries(item.metadata)) {
                assert.deepEqual(context.things.get(item.id).metadata[key], value);
            }
        }
        const visor = ItemCatalogue.getByName('Diagnostic Visor')[0].blueprint;
        assert.equal(Number(visor.value), 1200);
        assert.equal(Number(visor.weight), 1234.5);
        assert.equal(visor.properties, 'Optical filter');
        const free = ItemCatalogue.getByName('Free Token')[0].blueprint;
        assert.equal(Number(free.value), 0);
        assert.equal(Number(free.weight), 0);
        const catalogue = JSON.parse(JSON.stringify(ItemCatalogue.toJSON()));
        ItemCatalogue.clear();
        ItemCatalogue.hydrate(catalogue);
        assert.deepEqual(ItemCatalogue.toJSON(), catalogue);
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
    }
});

test('definitions retain permanent item effects without transient effects or instance IDs', () => {
    const item = makeItem();
    item.setStatusEffects([
        { name: 'Blessed', description: 'Permanently blessed.', duration: -1 },
        { name: 'Wet', description: 'Temporarily wet.', duration: 10 }
    ]);
    item.delete();
    const record = ItemCatalogue.getByName('Iron Ingot').find(entry => entry.blueprint.statusEffects?.length);
    assert.ok(record);
    assert.deepEqual(record.blueprint.statusEffects.map(effect => effect.name), ['Blessed']);
    assert.equal(record.blueprint.statusEffects[0].id, undefined);
});

test('corrupt saved definitions fail hydration before clearing the existing world', () => {
    require('../LLMClient.js');
    const Utils = require('../Utils.js');
    const { createHydrationContext } = require('./helpers/locationFixtures.js');
    const current = makeItem({ name: 'Current World Item' });
    current.delete();
    const keep = makeItem({ name: 'Keep In World' });
    const valid = ItemCatalogue.toJSON();
    for (const alter of [
        blueprint => { blueprint.level = -2; },
        blueprint => { blueprint.name = 42; },
        blueprint => { blueprint.value = '1,200'; },
        blueprint => { blueprint.weight = '1,20'; },
        blueprint => { blueprint.statusEffects = [{ name: 'Blessed', description: 'Blessed', duration: -1, id: 'status_existing' }]; }
    ]) {
        const invalid = structuredClone(valid);
        alter(invalid.definitions[0].blueprint);
        assert.throws(() => Utils.hydrateGameState({ itemCatalogue: invalid }, createHydrationContext()));
        assert.equal(Thing.getById(keep.id), keep);
    }
});

test('invalid replacement leaves the original item and catalogue untouched', () => {
    const original = makeItem();
    const before = original.toJSON();
    const catalogueBefore = ItemCatalogue.toJSON();
    const candidate = makeItem({ name: 'Invalid replacement', register: false, metadata: { properties: 42 } });
    assert.throws(() => original.replaceStateFrom(candidate), /properties/);
    assert.deepEqual(original.toJSON(), before);
    assert.deepEqual(ItemCatalogue.toJSON(), catalogueBefore);
    assert.equal(Thing.getById(original.id), original);
});

test('malformed grouped numbers remain invalid in new item definitions', () => {
    for (const metadata of [{ value: '12,34' }, { weight: '1,20' }]) {
        const candidate = makeItem({ register: false, metadata });
        assert.throws(() => ItemCatalogue.validateThing(candidate), /must be number/);
    }
});
