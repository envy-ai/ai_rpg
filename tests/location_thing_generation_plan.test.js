const test = require('node:test');
const assert = require('node:assert/strict');

const {
    parseLocationThingsDocument,
    parseLocationThingsPlan,
    normalizeLocationThingRarities,
    validateLocationThingsAgainstPlan
} = require('../LocationThingGenerationPlan.js');

const rarityDefinitions = [
    { key: 'common', label: 'Common' },
    { key: 'uncommon', label: 'Uncommon' },
    { key: 'rare', label: 'Rare' }
];

const requirements = {
    itemCount: 1,
    sceneryCount: 2,
    rarityList: {
        items: { common: 1 },
        scenery: { uncommon: 1, common: 1 }
    },
    rarityDefinitions
};

function planEntry(name, kind, rarity, description = `${name} in one sentence.`) {
    return `<item><name>${name}</name><itemOrScenery>${kind}</itemOrScenery><rarity>${rarity}</rarity><description>${description}</description></item>`;
}

const validPlan = `<thingsPlan>${planEntry('Copper Seal', 'item', 'common')}${planEntry('Bench', 'scenery', 'uncommon')}${planEntry('Clock', 'scenery', 'Common')}</thingsPlan>`;

test('location thing roster parser accepts a complete compact plan and canonicalizes configured rarity aliases', () => {
    const plan = parseLocationThingsPlan(validPlan, requirements);
    assert.deepEqual(plan, [
        { name: 'Copper Seal', itemOrScenery: 'item', rarity: 'common', description: 'Copper Seal in one sentence.' },
        { name: 'Bench', itemOrScenery: 'scenery', rarity: 'uncommon', description: 'Bench in one sentence.' },
        { name: 'Clock', itemOrScenery: 'scenery', rarity: 'common', description: 'Clock in one sentence.' }
    ]);
});

test('location thing roster parser returns precise XML, root, and required-field errors', () => {
    assert.throws(() => parseLocationThingsPlan('<thingsPlan><item>', requirements), /Failed to parse XML content strictly/i);
    assert.throws(() => parseLocationThingsPlan('<things/>', requirements), /requires one complete <thingsPlan>/i);
    assert.throws(
        () => parseLocationThingsPlan('<thingsPlan><item><name>Only Name</name></item></thingsPlan>', requirements),
        /missing <itemOrScenery>, <rarity>, <description>/
    );
});

test('location thing roster parser rejects duplicate names, unconfigured rarity, and non-text roster fields', () => {
    assert.throws(
        () => parseLocationThingsPlan(`<thingsPlan>${planEntry('Same', 'item', 'common')}${planEntry('same', 'scenery', 'common')}${planEntry('Bench', 'scenery', 'uncommon')}</thingsPlan>`, requirements),
        /duplicate name "same"/i
    );
    assert.throws(
        () => parseLocationThingsPlan(`<thingsPlan>${planEntry('Seal', 'item', 'mythic')}${planEntry('Bench', 'scenery', 'uncommon')}${planEntry('Clock', 'scenery', 'common')}</thingsPlan>`, requirements),
        /unknown rarity "mythic"/i
    );
    assert.throws(
        () => parseLocationThingsPlan(`<thingsPlan><item id="1"><name>Seal</name><itemOrScenery>item</itemOrScenery><rarity>common</rarity><description>Seal.</description></item></thingsPlan>`, requirements),
        /must use child elements, not attributes/
    );
});

test('location thing roster parser reports per-kind count and rarity minimum failures', () => {
    const tooFew = `<thingsPlan>${planEntry('Seal', 'item', 'common')}${planEntry('Bench', 'scenery', 'common')}</thingsPlan>`;
    assert.throws(() => parseLocationThingsPlan(tooFew, requirements), /expected at least 2 scenery entries, but received 1/);

    const wrongRarity = `<thingsPlan>${planEntry('Seal', 'item', 'common')}${planEntry('Bench', 'scenery', 'common')}${planEntry('Clock', 'scenery', 'common')}</thingsPlan>`;
    assert.throws(() => parseLocationThingsPlan(wrongRarity, requirements), /scenery rarity minimum not met/);
});

test('location thing rarity aliases normalize to configured keys before roster matching', () => {
    const customRarityDefinitions = [{ key: 'very_rare', label: 'Very Rare' }];
    const customRequirements = {
        itemCount: 1,
        sceneryCount: 0,
        rarityList: { items: { very_rare: 1 }, scenery: {} },
        rarityDefinitions: customRarityDefinitions
    };
    const roster = parseLocationThingsPlan(
        `<thingsPlan>${planEntry('Star Shard', 'item', 'Very Rare')}</thingsPlan>`,
        customRequirements
    );
    const normalizedFinal = normalizeLocationThingRarities([
        { name: 'Star Shard', itemOrScenery: 'item', rarity: 'Very Rare' }
    ], customRarityDefinitions);
    assert.equal(roster[0].rarity, 'very_rare');
    assert.equal(normalizedFinal[0].rarity, 'very_rare');
    assert.doesNotThrow(() => validateLocationThingsAgainstPlan(normalizedFinal, roster));
});

test('final location thing document requires a strict things root and direct item entries', () => {
    assert.throws(() => parseLocationThingsDocument('<things><item>'), /Failed to parse XML content strictly/i);
    assert.throws(() => parseLocationThingsDocument('<items><item/></items>'), /requires one complete <things>/i);
    assert.throws(() => parseLocationThingsDocument('<things><group><item/></group></things>'), /direct <item> entries, not <group>/i);
    assert.equal(parseLocationThingsDocument('<things><item/></things>').root.tagName, 'things');
});

test('final location thing batch must exactly match approved names, kinds, and rarities', () => {
    const plan = parseLocationThingsPlan(validPlan, requirements);
    const parsed = [
        { name: 'Copper Seal', itemOrScenery: 'item', rarity: 'Common', description: 'Expanded, complete detail.' },
        { name: 'Bench', itemOrScenery: 'scenery', rarity: 'Uncommon', description: 'Expanded bench details.' },
        { name: 'Clock', itemOrScenery: 'scenery', rarity: 'Common', description: 'Expanded clock details.' }
    ];
    assert.strictEqual(validateLocationThingsAgainstPlan(parsed, plan), parsed);

    for (const [candidate, expectedError] of [
        [parsed.slice(0, 2), /missing approved entries: Clock/],
        [[...parsed, { ...parsed[0], name: 'Extra' }], /unplanned name "Extra"/],
        [[{ ...parsed[0], name: 'Renamed' }, ...parsed.slice(1)], /unplanned name "Renamed"/],
        [[{ ...parsed[0], itemOrScenery: 'scenery' }, ...parsed.slice(1)], /keep approved itemOrScenery "item"/],
        [[{ ...parsed[0], rarity: 'Rare' }, ...parsed.slice(1)], /keep approved rarity "common"/]
    ]) {
        assert.throws(() => validateLocationThingsAgainstPlan(candidate, plan), expectedError);
    }
});
