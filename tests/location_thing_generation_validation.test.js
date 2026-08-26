const test = require('node:test');
const assert = require('node:assert/strict');

const {
    validateGeneratedLocationThingBatch
} = require('../LocationThingGenerationValidation.js');

function entry(name, itemOrScenery, rarity, count = 1) {
    return {
        name,
        description: `Description of ${name}.`,
        itemOrScenery,
        thingType: itemOrScenery,
        rarity,
        count
    };
}

const expected = {
    itemCount: 1,
    sceneryCount: 3,
    rarityList: {
        items: { common: 1 },
        scenery: { common: 1, uncommon: 2 }
    }
};

test('location thing batch validation accepts the requested minimum entries and rarities independent of stack count', () => {
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

test('location thing batch validation accepts extra structured entries and rarities', () => {
    const parsedItems = [
        entry('Crate Stack', 'item', 'Common', 3),
        entry('Lantern', 'item', 'Rare'),
        entry('Bench', 'scenery', 'Common'),
        entry('Clock', 'scenery', 'Uncommon'),
        entry('Signal', 'scenery', 'Uncommon'),
        entry('Fountain', 'scenery', 'Rare')
    ];

    assert.strictEqual(
        validateGeneratedLocationThingBatch(parsedItems, expected),
        parsedItems
    );
});

test('location thing batch validation rejects missing required entries', () => {
    assert.throws(
        () => validateGeneratedLocationThingBatch([
            entry('Bench', 'scenery', 'Common'),
            entry('Clock', 'scenery', 'Uncommon'),
            entry('Signal', 'scenery', 'Uncommon')
        ], expected),
        /expected at least 1 item entries, but received 0/
    );
});

test('location thing batch validation rejects a missing required rarity minimum', () => {
    assert.throws(
        () => validateGeneratedLocationThingBatch([
            entry('Crate', 'item', 'Common'),
            entry('Bench', 'scenery', 'Common'),
            entry('Clock', 'scenery', 'Common'),
            entry('Signal', 'scenery', 'Uncommon')
        ], expected),
        /scenery rarity minimum not met/
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

test('location thing batch validation rejects blank names and descriptions', () => {
    const blankName = entry('Crate', 'item', 'Common');
    blankName.name = '   ';
    assert.throws(
        () => validateGeneratedLocationThingBatch([
            blankName,
            entry('Bench', 'scenery', 'Common'),
            entry('Clock', 'scenery', 'Uncommon'),
            entry('Signal', 'scenery', 'Uncommon')
        ], expected),
        /must have a non-empty name/
    );

    const blankDescription = entry('Crate', 'item', 'Common');
    blankDescription.description = '   ';
    assert.throws(
        () => validateGeneratedLocationThingBatch([
            blankDescription,
            entry('Bench', 'scenery', 'Common'),
            entry('Clock', 'scenery', 'Uncommon'),
            entry('Signal', 'scenery', 'Uncommon')
        ], expected),
        /must have a non-empty description/
    );
});
