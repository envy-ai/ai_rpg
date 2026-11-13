const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadQuantityConsumption() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function validateCraftSelectedQuantity(');
    const end = source.indexOf('        function resolveCraftConsumedThings(', start);
    assert.ok(start >= 0 && end > start, 'quantity consumption helpers must exist');
    return vm.runInNewContext(`${source.slice(start, end)}\nresolveCraftConsumption;`, { Array, Map, Set, Number, Error, TypeError });
}

test('craft consumption uses selected quantities and exact IDs for same-named stacks', () => {
    const resolve = loadQuantityConsumption();
    const first = { id: 'iron_1', name: 'Iron', count: 8 };
    const second = { id: 'iron_2', name: 'Iron', count: 4 };
    const slotItems = [{ thing: first, quantity: 4 }, { thing: second, quantity: 2 }];
    const consumedItems = [{ thingId: 'iron_1', quantity: 3 }, { thingId: 'iron_2', quantity: 1 }];
    const result = resolve({ slotItems, consumedItems });
    assert.deepEqual(JSON.parse(JSON.stringify(result.consumedThings)), [first, second]);
    assert.deepEqual(JSON.parse(JSON.stringify(result.consumedItems)), consumedItems);
    assert.equal(first.count, 8, 'validation does not consume inventory');
    assert.deepEqual(JSON.parse(JSON.stringify(resolve({ slotItems, consumedItems: [] }).consumedThings)), []);
});

test('a real unique Thing without count is a valid single-unit crafting source', () => {
    const Thing = require('../Thing.js');
    const thing = new Thing({ id: 'unique_tool_test', name: 'Unique tool', description: 'A tool.', thingType: 'item' });
    // Simulate a legacy uncounted source while retaining a real Thing instance.
    Object.defineProperty(thing, 'count', { value: undefined, configurable: true });
    assert.equal(thing.count, undefined);
    const result = loadQuantityConsumption()({ slotItems: [{ thing, quantity: 1 }], consumedItems: [{ thingId: thing.id, quantity: 1 }] });
    assert.equal(result.consumedThings[0], thing);
    const zero = { id: 'zero', name: 'Zero-count unique', count: 0 };
    assert.equal(loadQuantityConsumption()({ slotItems: [{ thing: zero, quantity: 1 }], consumedItems: [] }).consumedThings.length, 0);
    assert.throws(() => loadQuantityConsumption()({ slotItems: [{ thing: zero, quantity: 2 }], consumedItems: [] }), /quantity.*available count/);
});

test('bulk consumption decrements a million units in one operation and retains normal deletion', () => {
    const Thing = require('../Thing.js');
    const thing = new Thing({ id: 'bulk_thing_test', name: 'Bulk', description: 'Bulk material.', thingType: 'item', count: 1000001 });
    const things = new Map([[thing.id, thing]]);
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function consumeThingById('), end = source.indexOf('        function deleteNpcById(', start);
    assert.ok(start >= 0 && end > start);
    let bulkCalls = 0;
    const bulk = thing.consumeQuantity.bind(thing);
    thing.consumeQuantity = (...args) => { bulkCalls++; return bulk(...args); };
    thing.consumeOne = () => { throw new Error('unexpected per-unit consumption'); };
    const consume = vm.runInNewContext(`${source.slice(start, end)}\nconsumeThingById;`, {
        things, Thing, assertThingVisibleToPlayerForInteraction() {}
    });
    const result = consume(thing.id, 1000000);
    assert.equal(bulkCalls, 1);
    assert.equal(thing.count, 1);
    assert.equal(result.remainingCount, 1);
    assert.equal(things.get(thing.id), thing);
    const deletion = bulk(1, { things });
    assert.equal(deletion.deleted, true);
    assert.equal(things.has(thing.id), false);
});

test('craft consumption rejects invalid quantities, duplicate IDs and unselected input with field guidance', () => {
    const resolve = loadQuantityConsumption();
    const thing = { id: 'iron_1', name: 'Iron', count: 4 };
    const slotItems = [{ thing, quantity: 2 }];
    for (const quantity of [0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1, 3]) {
        assert.throws(() => resolve({ slotItems, consumedItems: [{ thingId: thing.id, quantity }] }), /itemsConsumed\.item\[0\]\.quantity/);
    }
    assert.throws(() => resolve({ slotItems, consumedItems: [{ thingId: 'unknown', quantity: 1 }] }), /thingId.*not selected/);
    assert.throws(() => resolve({ slotItems, consumedItems: [{ thingId: thing.id, quantity: 1 }, { thingId: thing.id, quantity: 1 }] }), /thingId repeats/);
    assert.throws(() => resolve({ slotItems: [...slotItems, ...slotItems], consumedItems: [] }), /slots\[1\]\.thingId repeats/);
    assert.throws(() => resolve({ slotItems: [{ thing, quantity: 5 }], consumedItems: [] }), /slots\[0\]\.quantity.*available count/);
    assert.throws(() => resolve({ slotItems, consumedItems: [], consumedNames: ['Iron'] }), /itemName.*thingId/);
});

function loadResolveCraftConsumedThings() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function resolveCraftConsumedThings({');
    const end = source.indexOf('\n        function consumeThingById(', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate resolveCraftConsumedThings in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Array,
        TypeError,
        Error
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.resolveCraftConsumedThings = resolveCraftConsumedThings;`,
        context
    );

    return context.resolveCraftConsumedThings;
}

test('craft consumption resolution preserves unlisted tools and ingredients', () => {
    const resolveCraftConsumedThings = loadResolveCraftConsumedThings();

    const hoe = { id: 'hoe-1', name: 'Hoe' };
    const seeds = { id: 'seed-1', name: 'Turnip Seeds' };
    const resolved = resolveCraftConsumedThings({
        inputThings: [hoe, seeds],
        consumedNames: [],
        mode: 'craft',
        allowFallbackConsumeFirst: false
    });

    assert.deepEqual(JSON.parse(JSON.stringify(resolved.consumedThings)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(resolved.unmatchedConsumedNames)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(resolved.remainingPool)), [hoe, seeds]);
});

test('craft consumption resolution throws on unmatched consumed item names', () => {
    const resolveCraftConsumedThings = loadResolveCraftConsumedThings();

    assert.throws(() => {
        resolveCraftConsumedThings({
            inputThings: [{ id: 'hoe-1', name: 'Hoe' }],
            consumedNames: ['Garden Plot'],
            mode: 'craft',
            allowFallbackConsumeFirst: false
        });
    }, /did not match the provided inputs/i);
});

test('craft consumption resolution rejects duplicate names for one selected stack', () => {
    const resolveCraftConsumedThings = loadResolveCraftConsumedThings();

    assert.throws(() => {
        resolveCraftConsumedThings({
            inputThings: [{ id: 'wood-stack', name: 'QA Wood', count: 2 }],
            consumedNames: ['QA Wood', 'QA Wood'],
            mode: 'craft',
            allowFallbackConsumeFirst: false
        });
    }, /did not match the provided inputs/i);
});

test('salvage consumption resolution still falls back to the target item when unnamed', () => {
    const resolveCraftConsumedThings = loadResolveCraftConsumedThings();
    const target = { id: 'sword-1', name: 'Rusty Sword' };

    const resolved = resolveCraftConsumedThings({
        inputThings: [target],
        consumedNames: [],
        mode: 'salvage',
        allowFallbackConsumeFirst: true
    });

    assert.deepEqual(JSON.parse(JSON.stringify(resolved.consumedThings)), [target]);
    assert.deepEqual(JSON.parse(JSON.stringify(resolved.unmatchedConsumedNames)), []);
    assert.deepEqual(JSON.parse(JSON.stringify(resolved.remainingPool)), []);
});

test('harvest source protection applies to every result better than major failure only', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function shouldProtectHarvestSource(');
    const end = source.indexOf('\n        async function ', start);
    assert.ok(start >= 0 && end > start, 'harvest result protection helper must exist');
    const shouldProtect = vm.runInNewContext(`${source.slice(start, end)}\nshouldProtectHarvestSource;`, { Set });
    for (const level of ['barely_failed', 'failure', 'barely_succeeded', 'success', 'major_success', 'critical_success']) {
        assert.equal(shouldProtect(true, level), true, level);
        assert.equal(shouldProtect(false, level), false, `non-harvest ${level}`);
    }
    for (const level of ['major_failure', 'critical_failure']) {
        assert.equal(shouldProtect(true, level), false, level);
    }
});
