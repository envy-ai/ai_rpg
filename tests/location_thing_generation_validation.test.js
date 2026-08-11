const test = require('node:test');
const assert = require('node:assert/strict');

const {
    validateGeneratedLocationThingBatch
} = require('../LocationThingGenerationValidation.js');

function entry(name, itemOrScenery, rarity, count = 1) {
    return { name, itemOrScenery, thingType: itemOrScenery, rarity, count };
}

const expected = {
    itemCount: 1,
    sceneryCount: 3,
    rarityList: {
        items: { common: 1 },
        scenery: { common: 1, uncommon: 2 }
    }
};

test('location thing batch validation accepts exact entry and rarity multisets independent of stack count', () => {
    const parsedItems = [
        entry('Crate Stack', 'item', 'Common', 3),
        entry('Bench', 'scenery', 'Common'),
        entry('Clock', 'scenery', 'Uncommon'),
        entry('Signal', 'scenery', 'Uncommon')
    ];

    assert.strictEqual(
        validateGeneratedLocationThingBatch(parsedItems, expected),
        parsedItems
    );
});

test('location thing batch validation rejects extra and missing structured entries', () => {
    assert.throws(
        () => validateGeneratedLocationThingBatch([
            entry('First', 'item', 'Common'),
            entry('Second', 'item', 'Common'),
            entry('Bench', 'scenery', 'Common'),
            entry('Clock', 'scenery', 'Uncommon'),
            entry('Signal', 'scenery', 'Uncommon')
        ], expected),
        /expected exactly 1 item entries, but received 2/
    );
});

test('location thing batch validation rejects a wrong rarity multiset', () => {
    assert.throws(
        () => validateGeneratedLocationThingBatch([
            entry('Crate', 'item', 'Common'),
            entry('Bench', 'scenery', 'Common'),
            entry('Clock', 'scenery', 'Common'),
            entry('Signal', 'scenery', 'Uncommon')
        ], expected),
        /scenery rarity multiset mismatch/
    );
});

test('location thing batch validation rejects invalid kinds and inconsistent expectations', () => {
    assert.throws(
        () => validateGeneratedLocationThingBatch([
            entry('Unknown', 'furniture', 'Common')
        ], {
            itemCount: 1,
            sceneryCount: 0,
            rarityList: { items: { common: 1 }, scenery: {} }
        }),
        /invalid item\/scenery kind/
    );
    assert.throws(
        () => validateGeneratedLocationThingBatch([], {
            itemCount: 2,
            sceneryCount: 0,
            rarityList: { items: { common: 1 }, scenery: {} }
        }),
        /rarity counts total 1, but itemCount is 2/
    );
});
