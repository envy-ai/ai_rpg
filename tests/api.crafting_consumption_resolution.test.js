const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadResolveCraftConsumedThings() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function resolveCraftConsumedThings({');
    const end = source.indexOf('\n        function consumeThingById(thingId) {', start);
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
