const test = require('node:test');
const assert = require('node:assert/strict');

const ItemModuleSystem = require('../modding/ItemModuleSystem.js');

function actorWith(items) {
    return {
        id: 'actor_1',
        name: 'Tester',
        inventory: items,
        getInventoryItems() {
            return this.inventory;
        },
        withHealthRatioPreserved(mutator) {
            mutator();
        }
    };
}

function item(overrides = {}) {
    return {
        id: overrides.id || `item_${Math.random().toString(36).slice(2)}`,
        name: overrides.name || 'Item',
        thingType: 'item',
        slot: null,
        count: 1,
        moduleSlots: [],
        installedModuleIds: [],
        moduleType: null,
        moduleInstalledOnItemId: null,
        attributeBonuses: [],
        ...overrides
    };
}

function createSystem() {
    return new ItemModuleSystem({
        namespace: 'modules',
        displayLabel: 'Modules'
    });
}

test('normalizes one or many slot types and rejects empty, duplicate, and malformed definitions', () => {
    const system = createSystem();

    assert.deepEqual(system.normalizeSlotTypes([
        { id: 'core', label: 'Core', description: 'Main slot.' },
        { id: 'edge', label: '', description: '' }
    ]), [
        { id: 'core', label: 'Core', description: 'Main slot.' },
        { id: 'edge', label: 'edge', description: '' }
    ]);

    assert.deepEqual(system.normalizeSlotTypes(null), [
        { id: 'module', label: 'Module', description: 'General-purpose module slot.' }
    ]);

    assert.throws(() => system.normalizeSlotTypes([]), /at least one slot type/i);
    assert.throws(() => system.normalizeSlotTypes([{ id: '' }]), /slotTypes\[0\]\.id/i);
    assert.throws(() => system.normalizeSlotTypes([{ id: 'core' }, { id: 'core' }]), /duplicate/i);
    assert.throws(() => system.normalizeSlotTypes([{ id: 'core', label: 7 }]), /slotTypes\[0\]\.label/i);
});

test('validates module fields only on compatible item shapes', () => {
    const system = createSystem();
    const slotTypes = system.normalizeSlotTypes([{ id: 'core', label: 'Core' }]);

    assert.throws(() => system.validateItemModuleFields(item({
        name: 'Decorative Bowl',
        slot: null,
        moduleSlots: [{ type: 'core' }]
    }), { slotTypes }), /equippable/i);

    assert.throws(() => system.validateItemModuleFields(item({
        name: 'Relic Shard',
        moduleType: 'edge'
    }), { slotTypes }), /unknown module type/i);

    assert.throws(() => system.validateItemModuleFields(item({
        name: 'Recursive Shard',
        slot: 'weapon',
        moduleSlots: [{ type: 'core' }],
        moduleType: 'core'
    }), { slotTypes }), /must not have module slots/i);
});

test('installing and removing a module updates both the base item and backlink', () => {
    const system = createSystem();
    const slotTypes = system.normalizeSlotTypes([{ id: 'core', label: 'Core' }]);
    const sword = item({
        id: 'sword_1',
        name: 'Resonant Sword',
        slot: 'weapon',
        moduleSlots: [{ type: 'core', label: 'Focus' }]
    });
    const crystal = item({
        id: 'crystal_1',
        name: 'Red Focus Crystal',
        moduleType: 'core'
    });
    const actor = actorWith([sword, crystal]);

    const installed = system.install({ actor, baseItem: sword, moduleItem: crystal, slotTypes });

    assert.equal(installed.baseItem, sword);
    assert.equal(installed.moduleItem, crystal);
    assert.equal(installed.slot.type, 'core');
    assert.deepEqual(sword.installedModuleIds, ['crystal_1']);
    assert.equal(crystal.moduleInstalledOnItemId, 'sword_1');
    assert.throws(() => system.install({ actor, baseItem: sword, moduleItem: crystal, slotTypes }), /already installed/i);

    const removed = system.remove({ actor, baseItem: sword, moduleItem: crystal });
    assert.equal(removed.moduleItem, crystal);
    assert.deepEqual(sword.installedModuleIds, []);
    assert.equal(crystal.moduleInstalledOnItemId, null);
});

test('effective mechanics add installed module bonuses and status effects to the base item', () => {
    const system = createSystem();
    const slotTypes = system.normalizeSlotTypes([{ id: 'core', label: 'Core' }]);
    const sword = item({
        id: 'sword_1',
        name: 'Resonant Sword',
        slot: 'weapon',
        isEquipped: true,
        moduleSlots: [{ type: 'core' }],
        attributeBonuses: [{ attribute: 'strength', bonus: 1 }],
        causeStatusEffectOnTarget: { name: 'Bleeding', description: 'Bleeds.', duration: 2 }
    });
    const crystal = item({
        id: 'crystal_1',
        name: 'Red Focus Crystal',
        moduleType: 'core',
        attributeBonuses: [{ attribute: 'strength', bonus: 2 }],
        causeStatusEffectOnTarget: { name: 'Burning', description: 'Burns.', duration: 1 },
        causeStatusEffectOnEquipper: { name: 'Focused', description: 'Sharper strikes.', duration: -1 }
    });
    const actor = actorWith([sword, crystal]);

    system.install({ actor, baseItem: sword, moduleItem: crystal, slotTypes });

    assert.equal(system.getEffectiveAttributeBonus(actor, sword, 'strength'), 3);
    assert.deepEqual(
        system.getTargetStatusEffectContributions(actor, sword).map(effect => effect.name),
        ['Burning']
    );
    assert.deepEqual(
        system.getStatusEffectContributions(actor).map(effect => effect.name),
        ['Focused']
    );
    assert.equal(system.getAttributeModifierContributions(actor, 'strength'), 2);
});

test('install rejects wrong slot type, stacked modules, and missing inventory ownership', () => {
    const system = createSystem();
    const slotTypes = system.normalizeSlotTypes([{ id: 'core', label: 'Core' }]);
    const sword = item({
        id: 'sword_1',
        name: 'Resonant Sword',
        slot: 'weapon',
        moduleSlots: [{ type: 'core' }]
    });
    const edgeModule = item({
        id: 'edge_1',
        name: 'Edge Module',
        moduleType: 'edge'
    });
    const stacked = item({
        id: 'stack_1',
        name: 'Stacked Core',
        moduleType: 'core',
        count: 2
    });
    const actor = actorWith([sword, stacked]);

    assert.throws(() => system.install({ actor, baseItem: sword, moduleItem: edgeModule, slotTypes }), /inventory/i);
    assert.throws(() => system.install({ actor, baseItem: sword, moduleItem: stacked, slotTypes }), /stacked/i);

    actor.inventory.push(edgeModule);
    assert.throws(() => system.install({ actor, baseItem: sword, moduleItem: edgeModule, slotTypes }), /unknown module type/i);
});
