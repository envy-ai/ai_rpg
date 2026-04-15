const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadInstantiateThingFromBlueprint() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('                const instantiateThingFromBlueprint = (itemBlueprint, {');
    const end = source.indexOf('\n                // Level formula:', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate instantiateThingFromBlueprint in api.js');
    }

    const functionSource = source.slice(start, end);
    class MockThing {
        constructor(options) {
            this.options = options;
        }
    }

    const context = {
        Number,
        Array,
        currentPlayer: { id: 'player-1', level: 7 },
        stationName: 'Fine Enchanting Workstation',
        normalizeAttributeBonusesForItem: (value) => value,
        scaleAttributeBonusesForItem: () => [],
        sanitizeMetadataObject: (value) => value,
        Thing: MockThing
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.instantiateThingFromBlueprint = instantiateThingFromBlueprint;`,
        context
    );

    return context.instantiateThingFromBlueprint;
}

test('crafting blueprint instantiation preserves distinct on-target and on-equipper effects', () => {
    const instantiateThingFromBlueprint = loadInstantiateThingFromBlueprint();

    const created = instantiateThingFromBlueprint({
        name: 'Sovereign\'s Depth-Spear',
        description: 'A masterwork spear.',
        thingType: 'item',
        causeStatusEffectOnTarget: {
            name: 'Thermal Cataclysm',
            description: 'Burning frost damage.'
        },
        causeStatusEffectOnEquipper: {
            name: 'Sovereign\'s Mercy',
            description: 'Water breathing.'
        }
    });

    assert.ok(created);
    assert.deepEqual(JSON.parse(JSON.stringify(created.options.causeStatusEffect)), [
        {
            name: 'Thermal Cataclysm',
            description: 'Burning frost damage.',
            applyToTarget: true
        },
        {
            name: 'Sovereign\'s Mercy',
            description: 'Water breathing.',
            applyToEquipper: true
        }
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(created.options.metadata)), {
        rarity: null,
        itemType: null,
        value: null,
        weight: null,
        properties: null,
        causeStatusEffectOnTarget: {
            name: 'Thermal Cataclysm',
            description: 'Burning frost damage.'
        },
        causeStatusEffectOnEquipper: {
            name: 'Sovereign\'s Mercy',
            description: 'Water breathing.'
        },
        ownerId: 'player-1'
    });
});

test('crafting blueprint instantiation keeps legacy combined cause status effect when split effects are absent', () => {
    const instantiateThingFromBlueprint = loadInstantiateThingFromBlueprint();

    const created = instantiateThingFromBlueprint({
        name: 'Legacy Spear',
        description: 'A spear.',
        thingType: 'item',
        causeStatusEffect: {
            name: 'Legacy Chill',
            description: 'A lingering cold.',
            applyToTarget: true
        }
    });

    assert.ok(created);
    assert.deepEqual(JSON.parse(JSON.stringify(created.options.causeStatusEffect)), [
        {
            name: 'Legacy Chill',
            description: 'A lingering cold.',
            applyToTarget: true
        }
    ]);
});
