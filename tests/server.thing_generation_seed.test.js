const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadNormalizeThingGenerationSeed() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function normalizeThingGenerationSeed');
    const end = source.indexOf('\nasync function generateItemsByNames', start);
    assert.notEqual(start, -1, 'Could not locate normalizeThingGenerationSeed');
    assert.notEqual(end, -1, 'Could not locate generateItemsByNames');

    const generatorFields = [{ fieldName: 'implantSlot' }];
    const context = {
        Array,
        Error,
        Number,
        Object,
        String,
        extractThingBooleanFlags(seed) {
            return Object.prototype.hasOwnProperty.call(seed, 'isContainer')
                ? { isContainer: Boolean(seed.isContainer) }
                : {};
        },
        getThingGeneratorPromptFields: () => generatorFields,
        getThingExtensionFieldInputsFromSource(seed) {
            return Object.prototype.hasOwnProperty.call(seed, 'implantSlot')
                ? { implantSlot: seed.implantSlot }
                : {};
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.normalizeThingGenerationSeed = normalizeThingGenerationSeed;`,
        context
    );
    return context.normalizeThingGenerationSeed;
}

test('thing generation seed normalization preserves all createThing item fields', () => {
    const normalizeThingGenerationSeed = loadNormalizeThingGenerationSeed();
    const normalized = JSON.parse(JSON.stringify(normalizeThingGenerationSeed({
        name: '  Locked Oak Chest  ',
        shortDescription: '  locked chest of marked keys  ',
        description: '  A scarred oak chest.  ',
        itemOrScenery: 'SCENERY',
        type: 'container',
        slot: 'N/A',
        rarity: 'Uncommon',
        value: 20,
        weight: 40,
        relativeLevel: 1,
        count: 2,
        isContainer: true,
        containerContents: [{ name: ' Brass Key ', count: 1 }],
        attributeBonuses: [{ attribute: 'luck', bonus: 2 }],
        causeStatusEffectOnTarget: {
            name: ' Marked ',
            description: ' The target glows. ',
            duration: ' 5 minutes ',
            attributes: [{ attribute: 'dexterity', modifier: -1 }],
            skills: [{ skill: 'Stealth', modifier: -2 }],
            needBars: [{ name: 'energy', delta: -5 }]
        },
        causeStatusEffectOnEquipper: {
            name: 'Keyed In',
            duration: 'permanent'
        },
        properties: ' The lock remembers failed keys. ',
        implantSlot: 'arcane'
    })));

    assert.equal(normalized.name, 'Locked Oak Chest');
    assert.equal(normalized.shortDescription, 'locked chest of marked keys');
    assert.equal(normalized.description, 'A scarred oak chest.');
    assert.equal(normalized.itemOrScenery, 'scenery');
    assert.equal(normalized.count, 2);
    assert.equal(normalized.isContainer, true);
    assert.deepEqual(normalized.containerContents, [{ name: 'Brass Key', count: 1 }]);
    assert.deepEqual(normalized.attributeBonuses, [{ attribute: 'luck', bonus: 2 }]);
    assert.deepEqual(normalized.causeStatusEffectOnTarget, {
        name: 'Marked',
        description: 'The target glows.',
        duration: '5 minutes',
        attributes: [{ name: 'dexterity', modifier: -1 }],
        skills: [{ name: 'Stealth', modifier: -2 }],
        needBars: [{ name: 'energy', delta: -5 }]
    });
    assert.deepEqual(normalized.causeStatusEffectOnEquipper, {
        name: 'Keyed In',
        duration: 'permanent'
    });
    assert.equal(normalized.properties, 'The lock remembers failed keys.');
    assert.equal(normalized.implantSlot, 'arcane');
});

test('thing generation seed normalization rejects invalid stack and container counts', () => {
    const normalizeThingGenerationSeed = loadNormalizeThingGenerationSeed();

    assert.throws(
        () => normalizeThingGenerationSeed({ count: -1 }),
        /count must be an integer zero or greater/
    );
    assert.throws(
        () => normalizeThingGenerationSeed({
            containerContents: [{ name: 'Key', count: 1.5 }]
        }),
        /containerContents\[0\]\.count must be an integer zero or greater/
    );
});
