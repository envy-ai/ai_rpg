const test = require('node:test');
const assert = require('node:assert/strict');
const ItemCatalogue = require('../ItemCatalogue.js');
const ItemReuseService = require('../ItemReuseService.js');
const Thing = require('../Thing.js');

const rarities = [
    { key: 'common', label: 'Common', prevalence: 100 },
    { key: 'uncommon', label: 'Uncommon', prevalence: 50 },
    { key: 'rare', label: 'Rare', prevalence: 10 }
];
const family = (name = 'Iron Sword') => ({
    name, minimumRarity: 'common', maximumRarity: 'rare',
    variants: rarities.map(({ key }) => ({
        name, itemOrScenery: 'item', rarity: key,
        description: `${key} ${name}`, attributeBonuses: [{ attribute: 'strength', bonus: key === 'rare' ? 3 : 1 }],
        value: 12, weight: 2, properties: 'Forged iron'
    }))
});
const makeService = authorFamily => new ItemReuseService({ authorFamily, rarityDefinitions: rarities });
test.beforeEach(() => Thing.clear());
test.afterEach(() => Thing.clear());

test('one authoring call saves all variants and reuses a rare variant after all instances are gone and save/load', async () => {
    let calls = 0;
    const service = makeService(async () => { calls++; return family(); });
    const first = service.createSession();
    const common = await first.resolve({ name: 'Iron Sword', rarity: 'common', count: 2 });
    assert.equal(common.rarity, 'common');
    assert.equal(common.count, 2);
    first.commit();
    assert.equal(Thing.getAll().length, 0);
    const saved = JSON.parse(JSON.stringify(ItemCatalogue.toJSON()));
    ItemCatalogue.clear();
    ItemCatalogue.hydrate(saved);
    const second = service.createSession();
    const rare = await second.resolve({ name: 'Iron Sword', rarity: 'Rare', count: 1 });
    assert.equal(calls, 1);
    assert.equal(rare.rarity, 'rare');
    assert.equal(rare.description, 'rare Iron Sword');
    assert.deepEqual(rare.attributeBonuses, [{ attribute: 'strength', bonus: 3 }]);
    assert.equal(rare.value, 12);
    assert.equal(rare.weight, 2);
    assert.equal(rare.properties, 'Forged iron');
});

test('rejects missing rarity variants and reversed bounds without archiving the candidate', async () => {
    for (const bad of [
        { ...family(), variants: family().variants.slice(0, 2) },
        { ...family(), minimumRarity: 'rare', maximumRarity: 'common' }
    ]) {
        const session = makeService(async () => bad).createSession();
        await assert.rejects(session.resolve({ name: 'Iron Sword', rarity: 'common' }), /rarity|variants/i);
        assert.equal(ItemCatalogue.getFamilies().length, 0);
    }
});

test('explicit mismatched seeds and unique classifications do not reuse a standard item', async () => {
    let calls = 0;
    const service = makeService(async ({ name }) => { calls++; return name === 'Royal Sword' ? null : family(); });
    const first = service.createSession();
    await first.resolve({ name: 'Iron Sword', rarity: 'rare' });
    first.commit();
    const session = service.createSession();
    assert.equal(await session.resolve({ name: 'Iron Sword', rarity: 'rare', seed: { description: 'A royal heirloom.' } }), null);
    assert.equal(await session.resolve({ name: 'Iron Sword', rarity: 'rare', seed: { notes: 'One of a kind' } }), null);
    assert.equal(await session.resolve({ name: 'Royal Sword', rarity: 'rare' }), null);
    assert.equal(calls, 2);
});

test('multiple new families in one batch stay distinct and are committed together', async () => {
    let calls = 0;
    const service = makeService(async ({ name }) => { calls++; return family(name); });
    const session = service.createSession();
    const sword = await session.resolve({ name: 'Iron Sword', rarity: 'common' });
    const shield = await session.resolve({ name: 'Iron Shield', rarity: 'rare' });
    assert.equal(sword.description, 'common Iron Sword');
    assert.equal(shield.description, 'rare Iron Shield');
    assert.equal(calls, 2);
    assert.equal(ItemCatalogue.getFamilies().length, 0);
    session.commit();
    assert.equal(ItemCatalogue.getFamilies().length, 2);
});

test('rejects out-of-range requests and leaves staged families unarchived until commit', async () => {
    const limited = family();
    limited.maximumRarity = 'uncommon';
    limited.variants.pop();
    const session = makeService(async () => limited).createSession();
    await assert.rejects(session.resolve({ name: 'Iron Sword', rarity: 'rare' }), /rarity|choose/i);
    assert.equal(ItemCatalogue.getFamilies().length, 0);
});

test('rejects an invalid variant before committing any part of the family', async () => {
    const bad = family();
    bad.variants[2].description = '';
    const service = new ItemReuseService({
        rarityDefinitions: rarities,
        authorFamily: async () => bad,
        prepareVariant: item => { if (!item.description) throw new Error('description required'); }
    });
    const session = service.createSession();
    await assert.rejects(session.resolve({ name: 'Iron Sword', rarity: 'common' }), /description required/);
    assert.equal(ItemCatalogue.getFamilies().length, 0);
});

test('family validation rejects malformed numeric fields', () => {
    for (const value of ['12,34', '1,200']) {
        const invalid = family();
        invalid.variants[0].value = value;
        assert.throws(() => ItemCatalogue.validateFamilyData({
            ...invalid,
            rarities: rarities.map(entry => entry.key),
            variants: invalid.variants.map(variant => ({ ...variant, unscaledAttributeBonuses: variant.attributeBonuses }))
        }, { requireId: false }), /value.*number/i);
    }
    assert.deepEqual(ItemCatalogue.getFamilies(), []);
});

test('version 1 catalogue loads without inventing reusable families', () => {
    ItemCatalogue.hydrate({ version: 1, definitions: [] });
    assert.deepEqual(ItemCatalogue.getFamilies(), []);
    assert.equal(ItemCatalogue.toJSON().version, 2);
});

test('ambiguous saved names fail explicitly rather than selecting an arbitrary family', async () => {
    const original = family();
    const variants = original.variants.map(item => ({ ...item, unscaledAttributeBonuses: item.attributeBonuses }));
    const first = { ...original, id: 'itemfamily_one', rarities: rarities.map(entry => entry.key), variants };
    const second = structuredClone(first);
    second.id = 'itemfamily_two';
    second.variants[0].description = 'A different sword.';
    ItemCatalogue.hydrate({ version: 2, definitions: [], families: [first, second] });
    const session = makeService(async () => { throw new Error('unexpected author call'); }).createSession();
    await assert.rejects(session.resolve({ name: 'Iron Sword', rarity: 'common' }), /multiple|ambiguous/i);
});

test('clearing the world invalidates pending session commits', async () => {
    const session = makeService(async () => family()).createSession();
    await session.resolve({ name: 'Iron Sword', rarity: 'common' });
    Thing.clear();
    assert.throws(() => session.commit(), /game changed|cancelled/i);
    assert.equal(ItemCatalogue.getFamilies().length, 0);
});

test('saved reusable rarity ranges reject gaps and unknown rarities before world replacement; observed snapshots may remain unclassified', () => {
    require('../LLMClient.js');
    const Utils = require('../Utils.js');
    const { createHydrationContext } = require('./helpers/locationFixtures.js');
    const keep = new Thing({ name: 'Current Item', description: 'Current world.', thingType: 'item', rarity: 'common' });
    const baseline = ItemCatalogue.toJSON();
    const variant = rarity => ({ name: 'Saved Sword', description: 'A sword.', itemOrScenery: 'item', rarity, attributeBonuses: [], unscaledAttributeBonuses: [] });
    const makeFamily = (rarities, id) => ({ id, name: 'Saved Sword', minimumRarity: rarities[0], maximumRarity: rarities.at(-1), rarities, variants: rarities.map(variant) });
    for (const familyData of [
        makeFamily(['common', 'rare'], 'itemfamily_gap'),
        makeFamily(['unrecognized_rarity'], 'itemfamily_unknown')
    ]) {
        const invalid = { ...baseline, families: [familyData] };
        assert.throws(() => Utils.hydrateGameState({ itemCatalogue: invalid }, createHydrationContext()), /rarity|rarities|range/i);
        assert.equal(Thing.getById(keep.id), keep);
        assert.deepEqual(ItemCatalogue.toJSON(), baseline);
    }
    const observed = structuredClone(baseline);
    observed.definitions[0].blueprint.rarity = 'old_unrecognized_rarity';
    assert.doesNotThrow(() => ItemCatalogue.validateState(observed));
});

test('family authoring rejects temporary effects on the item but permits timed target effects', async () => {
    const invalid = family();
    invalid.variants[1].statusEffects = [{ name: 'Wet', description: 'Temporarily wet.', duration: 10 }];
    const rejected = makeService(async () => invalid).createSession();
    await assert.rejects(rejected.resolve({ name: 'Iron Sword', rarity: 'common' }), /statusEffects|permanent|duration/i);
    assert.deepEqual(ItemCatalogue.getFamilies(), []);

    const valid = family();
    valid.variants[1].causeStatusEffectOnTarget = { name: 'Burn', description: 'Burns the target.', duration: 10 };
    const accepted = makeService(async () => valid).createSession();
    await accepted.resolve({ name: 'Iron Sword', rarity: 'uncommon' });
    accepted.commit();
    assert.equal(ItemCatalogue.getFamilies()[0].variants[1].causeStatusEffectOnTarget.duration, 10);
});

test('saved family rejects temporary item effects before replacing the world while allowing timed target effects', () => {
    require('../LLMClient.js');
    const Utils = require('../Utils.js');
    const { createHydrationContext } = require('./helpers/locationFixtures.js');
    const keep = new Thing({ name: 'Current Item', description: 'Current world.', thingType: 'item', rarity: 'common' });
    const baseline = ItemCatalogue.toJSON();
    const variant = { name: 'Saved Sword', description: 'A sword.', itemOrScenery: 'item', rarity: 'common', attributeBonuses: [], unscaledAttributeBonuses: [] };
    const saved = { ...baseline, families: [{ id: 'itemfamily_saved', name: 'Saved Sword', minimumRarity: 'common', maximumRarity: 'common', rarities: ['common'], variants: [variant] }] };
    const invalid = structuredClone(saved);
    invalid.families[0].variants[0].statusEffects = [{ name: 'Wet', description: 'Temporarily wet.', duration: 10 }];
    assert.throws(() => Utils.hydrateGameState({ itemCatalogue: invalid }, createHydrationContext()), /statusEffects|permanent|duration/i);
    assert.equal(Thing.getById(keep.id), keep);
    assert.deepEqual(ItemCatalogue.toJSON(), baseline);
    saved.families[0].variants[0].causeStatusEffectOnTarget = { name: 'Burn', description: 'Burns the target.', duration: 10 };
    assert.doesNotThrow(() => ItemCatalogue.validateState(saved));
});

test('nested prompt reservation is yielded for authoring but not a staged family cache hit', async () => {
    let authors = 0;
    let yields = 0;
    const session = makeService(async () => { authors++; return family(); }).createSession();
    const withNestedPrompt = async callback => { yields++; return callback(); };
    await session.resolve({ name: 'Iron Sword', rarity: 'common', withNestedPrompt });
    await session.resolve({ name: 'Iron Sword', rarity: 'rare', withNestedPrompt });
    assert.equal(authors, 1);
    assert.equal(yields, 1);
});

test('a cancelled reservation yield propagates without launching or retrying family authoring', async () => {
    let authors = 0;
    let yields = 0;
    const cancelled = new Error('prompt cancelled');
    const session = makeService(async () => { authors++; return family(); }).createSession();
    await assert.rejects(session.resolve({ name: 'Iron Sword', rarity: 'common', withNestedPrompt: async () => { yields++; throw cancelled; } }), error => error === cancelled);
    assert.equal(yields, 1);
    assert.equal(authors, 0);
});

test('charged families require declared initial amount and fresh copies use it', async () => {
    const chargedFamily = family('Arc Lamp');
    for (const variant of chargedFamily.variants) variant.chargePool = { mode: 'continuous', amount: 1, capacity: 10, unit: 'energy', initialAmount: 4 };
    const session = makeService(async () => chargedFamily).createSession();
    const fresh = await session.resolve({ name: 'Arc Lamp', rarity: 'common' });
    assert.equal(fresh.chargePool.amount, 4);
    session.commit();
    const missing = family('Empty Lamp');
    for (const variant of missing.variants) variant.chargePool = { mode: 'continuous', amount: 1, capacity: 10, unit: 'energy' };
    await assert.rejects(makeService(async () => missing).createSession().resolve({ name: 'Empty Lamp', rarity: 'common' }), /initialAmount/);
});
