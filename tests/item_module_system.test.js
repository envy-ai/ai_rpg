const test = require('node:test');
const assert = require('node:assert/strict');

const ItemModuleSystem = require('../mods/modules/ItemModuleSystem.js');

function actorWith(items) {
    return {
        id: 'actor_1',
        name: 'Tester',
        inventory: items,
        getInventoryItems() {
            return this.inventory;
        },
        hasInventoryItem(id) {
            return this.inventory.some(entry => entry?.id === id);
        },
        addInventoryItem(thing) {
            if (!thing?.id || this.hasInventoryItem(thing.id)) {
                return false;
            }
            this.inventory.push(thing);
            return true;
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

    assert.throws(() => system.validateItemModuleFields(item({
        name: 'Broken Visor',
        slot: 'head',
        moduleSlots: [{ type: 'core' }],
        installedModuleIds: [1201]
    }), { slotTypes }), /installedModuleIds\[0\].*non-empty string/i);
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

test('installing a stacked module splits and installs one item from the stack', () => {
    const system = createSystem();
    const slotTypes = system.normalizeSlotTypes([{ id: 'core', label: 'Core' }]);
    const sword = item({
        id: 'sword_1',
        name: 'Resonant Sword',
        slot: 'weapon',
        moduleSlots: [{ type: 'core' }]
    });
    const crystalStack = item({
        id: 'crystal_stack_1',
        name: 'Stacked Core Crystal',
        moduleType: 'core',
        count: 3
    });
    const actor = actorWith([sword, crystalStack]);

    const installed = system.install({ actor, baseItem: sword, moduleItem: crystalStack, slotTypes });

    assert.equal(crystalStack.count, 2);
    assert.notEqual(installed.moduleItem, crystalStack);
    assert.notEqual(installed.moduleItem.id, crystalStack.id);
    assert.equal(installed.moduleItem.name, crystalStack.name);
    assert.equal(installed.moduleItem.moduleType, 'core');
    assert.equal(installed.moduleItem.count, 1);
    assert.equal(installed.moduleItem.moduleInstalledOnItemId, sword.id);
    assert.deepEqual(sword.installedModuleIds, [installed.moduleItem.id]);
    assert.ok(actor.hasInventoryItem(crystalStack.id));
    assert.ok(actor.hasInventoryItem(installed.moduleItem.id));
});

test('installing stacked modules into stacked base items splits and links one instance of each', () => {
    const system = createSystem();
    const slotTypes = system.normalizeSlotTypes([{ id: 'core', label: 'Core' }]);
    const underwrapStack = item({
        id: 'underwrap_stack_1',
        name: 'Heat-Shedding Underwrap',
        slot: 'body',
        count: 3,
        moduleSlots: [{ type: 'core' }]
    });
    const crystalStack = item({
        id: 'crystal_stack_1',
        name: 'Cooling Core',
        moduleType: 'core',
        count: 4
    });
    const actor = actorWith([underwrapStack, crystalStack]);

    const installed = system.install({
        actor,
        baseItem: underwrapStack,
        moduleItem: crystalStack,
        slotTypes
    });

    assert.equal(underwrapStack.count, 2);
    assert.equal(crystalStack.count, 3);
    assert.notEqual(installed.baseItem, underwrapStack);
    assert.notEqual(installed.baseItem.id, underwrapStack.id);
    assert.equal(installed.baseItem.count, 1);
    assert.notEqual(installed.moduleItem, crystalStack);
    assert.notEqual(installed.moduleItem.id, crystalStack.id);
    assert.equal(installed.moduleItem.count, 1);
    assert.deepEqual(underwrapStack.installedModuleIds, []);
    assert.equal(crystalStack.moduleInstalledOnItemId, null);
    assert.deepEqual(installed.baseItem.installedModuleIds, [installed.moduleItem.id]);
    assert.equal(installed.moduleItem.moduleInstalledOnItemId, installed.baseItem.id);
    assert.ok(actor.hasInventoryItem(underwrapStack.id));
    assert.ok(actor.hasInventoryItem(crystalStack.id));
    assert.ok(actor.hasInventoryItem(installed.baseItem.id));
    assert.ok(actor.hasInventoryItem(installed.moduleItem.id));
});

test('installing a single module into a stacked base item only splits the base stack', () => {
    const system = createSystem();
    const slotTypes = system.normalizeSlotTypes([{ id: 'core', label: 'Core' }]);
    const coatStack = item({
        id: 'coat_stack_1',
        name: 'Socketed Coat',
        slot: 'body',
        count: 2,
        moduleSlots: [{ type: 'core' }]
    });
    const crystal = item({
        id: 'crystal_1',
        name: 'Cooling Core',
        moduleType: 'core',
        count: 1
    });
    const actor = actorWith([coatStack, crystal]);

    const installed = system.install({ actor, baseItem: coatStack, moduleItem: crystal, slotTypes });

    assert.equal(coatStack.count, 1);
    assert.equal(installed.baseItem.count, 1);
    assert.notEqual(installed.baseItem.id, coatStack.id);
    assert.equal(installed.moduleItem, crystal);
    assert.deepEqual(coatStack.installedModuleIds, []);
    assert.deepEqual(installed.baseItem.installedModuleIds, [crystal.id]);
    assert.equal(crystal.moduleInstalledOnItemId, installed.baseItem.id);
});

test('install rejects a legacy stacked base item that already references a module', () => {
    const system = createSystem();
    const slotTypes = system.normalizeSlotTypes([{ id: 'core', label: 'Core' }]);
    const corruptedStack = item({
        id: 'corrupted_stack_1',
        name: 'Corrupted Socketed Coat',
        slot: 'body',
        count: 2,
        moduleSlots: [{ type: 'core' }, { type: 'core' }],
        installedModuleIds: ['old_module_1']
    });
    const oldModule = item({
        id: 'old_module_1',
        name: 'Old Core',
        moduleType: 'core',
        moduleInstalledOnItemId: corruptedStack.id
    });
    const newModule = item({
        id: 'new_module_1',
        name: 'New Core',
        moduleType: 'core'
    });
    const actor = actorWith([corruptedStack, oldModule, newModule]);

    assert.throws(
        () => system.install({ actor, baseItem: corruptedStack, moduleItem: newModule, slotTypes }),
        /already references installed modules and cannot be split safely/i
    );
    assert.equal(corruptedStack.count, 2);
    assert.equal(actor.inventory.length, 3);
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

test('install rejects wrong slot type and missing inventory ownership', () => {
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
    assert.doesNotThrow(() => system.install({ actor, baseItem: sword, moduleItem: stacked, slotTypes }));

    actor.inventory.push(edgeModule);
    assert.throws(() => system.install({ actor, baseItem: sword, moduleItem: edgeModule, slotTypes }), /unknown module type/i);
});
