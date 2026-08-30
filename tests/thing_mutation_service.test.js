const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Thing = require('../Thing.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const ThingMutationService = require('../ThingMutationService.js');
const ItemModuleSystem = require('../mods/modules/ItemModuleSystem.js');

function makeRegistry() {
    const registry = new ModExtensionRegistry();
    const system = new ItemModuleSystem();
    registry.registerEntityField({
        modName: 'modules',
        entityType: 'thing',
        fieldName: 'moduleSlots',
        type: 'array',
        defaultValue: [],
        exposeToCreateTool: true,
        exposeToUpdateTool: true
    });
    registry.registerEntityField({
        modName: 'modules',
        entityType: 'thing',
        fieldName: 'moduleType',
        type: 'string',
        defaultValue: null,
        exposeToCreateTool: true,
        exposeToUpdateTool: true
    });
    registry.registerEntityField({
        modName: 'modules',
        entityType: 'thing',
        fieldName: 'installedModuleIds',
        type: 'array',
        defaultValue: [],
        exposeToCreateTool: true,
        exposeToUpdateTool: true
    });
    registry.registerEntityValidator({
        modName: 'modules',
        entityType: 'thing',
        name: 'module-invariants',
        validator: thing => system.validateItemModuleFields(thing, {
            slotTypes: [{ id: 'mod', label: 'Mod', description: '' }]
        })
    });
    return registry;
}

function makeThing(overrides = {}) {
    return new Thing({
        name: 'Arc Pistol',
        description: 'A compact electrical sidearm.',
        shortDescription: 'Compact electrical sidearm',
        thingType: 'item',
        itemTypeDetail: 'weapon',
        slot: 'hand',
        moduleSlots: [],
        moduleType: null,
        installedModuleIds: [],
        ...overrides
    });
}

test.beforeEach(() => {
    Thing.clear();
});

test.afterEach(() => {
    Thing.clear();
});

test('preparing a candidate does not register or mutate a Thing', () => {
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = makeRegistry();
    try {
        const original = makeThing();
        const before = original.toJSON();
        const service = new ThingMutationService();
        const prepared = service.prepareUpdate(original, {
            name: 'Rebuilt Arc Pistol',
            weight: 2.5,
            properties: 'Insulated frame'
        });

        assert.equal(Thing.getAll().length, 1);
        assert.deepEqual(original.toJSON(), before);
        assert.equal(prepared.candidate.id, original.id);
        assert.equal(prepared.candidate.name, 'Rebuilt Arc Pistol');
        assert.equal(prepared.candidate.metadata.weight, 2.5);
        assert.equal(prepared.candidate.metadata.properties, 'Insulated frame');
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('whole-entity validation rejects conflicting module fields before commit', () => {
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = makeRegistry();
    try {
        const original = makeThing();
        const before = original.toJSON();
        const service = new ThingMutationService();

        assert.throws(() => service.prepareUpdate(original, {
            moduleSlots: [{ type: 'mod' }],
            moduleType: 'mod'
        }), /must not have module slots/i);
        assert.deepEqual(original.toJSON(), before);
        assert.equal(Thing.getAll().length, 1);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('atomic commit replaces all validated fields while preserving id and object identity', () => {
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = makeRegistry();
    try {
        const original = makeThing();
        const originalId = original.id;
        const service = new ThingMutationService();
        const prepared = service.prepareUpdate(original, {
            name: 'Rebuilt Arc Pistol',
            description: 'The pistol has been rebuilt around a reinforced capacitor.',
            moduleSlots: [{ type: 'mod' }]
        });
        const result = service.commitUpdate(original, prepared);

        assert.equal(result.thing, original);
        assert.equal(original.id, originalId);
        assert.equal(Thing.getById(originalId), original);
        assert.equal(original.name, 'Rebuilt Arc Pistol');
        assert.deepEqual(original.getExtensionField('moduleSlots'), [{ type: 'mod' }]);
        assert.equal(result.receipt.committed, true);
        assert.equal(result.receipt.thingId, originalId);
        assert.ok(result.receipt.changedFields.includes('name'));
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('creation constraints are merged before validation and never register an invalid candidate', () => {
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = makeRegistry();
    try {
        const service = new ThingMutationService();
        assert.throws(() => service.prepareCreate({
            name: 'Recursive Mod',
            description: 'A generated mod with an invalid recursive socket.',
            thingType: 'item',
            itemTypeDetail: 'module',
            slot: 'hand',
            moduleSlots: [],
            moduleType: null,
            installedModuleIds: []
        }, {
            constraints: {
                moduleSlots: [{ type: 'mod' }],
                moduleType: 'mod'
            }
        }), /must not have module slots/i);
        assert.equal(Thing.getAll().length, 0);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('replacement preserves identity and placement metadata', () => {
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = makeRegistry();
    try {
        const original = makeThing({
            metadata: { ownerId: 'player_1', value: 10, provenance: 'fixture' }
        });
        const service = new ThingMutationService();
        const prepared = service.prepareReplacement(original, {
            name: 'Arc Carbine',
            description: 'A rebuilt electrical carbine.',
            shortDescription: 'Rebuilt electrical carbine',
            thingType: 'item',
            itemTypeDetail: 'weapon',
            slot: 'hand',
            metadata: { value: 25 },
            moduleSlots: [{ type: 'mod' }],
            moduleType: null,
            installedModuleIds: []
        });
        const result = service.commitReplacement(original, prepared);

        assert.equal(result.thing, original);
        assert.equal(original.name, 'Arc Carbine');
        assert.equal(original.metadata.ownerId, 'player_1');
        assert.equal(original.metadata.value, 25);
        assert.equal(Thing.getAll().length, 1);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('batch preparation validates every candidate before any Thing is registered', () => {
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = makeRegistry();
    try {
        const service = new ThingMutationService();
        assert.throws(() => service.prepareCreateBatch([
            {
                name: 'Valid Harness',
                description: 'A harness with one module socket.',
                thingType: 'item',
                slot: 'body',
                moduleSlots: [{ type: 'mod' }]
            },
            {
                name: 'Invalid Recursive Mod',
                description: 'A module that incorrectly has its own socket.',
                thingType: 'item',
                slot: 'body',
                moduleSlots: [{ type: 'mod' }],
                moduleType: 'mod'
            }
        ]), /batch candidate 2.*must not have module slots/i);
        assert.equal(Thing.getAll().length, 0);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('legacy-state audit warns precisely without repairing the invalid Thing', () => {
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = makeRegistry();
    try {
        const invalid = makeThing();
        invalid.setExtensionField('moduleSlots', [{ type: 'mod' }]);
        invalid.setExtensionField('moduleType', 'mod');
        const before = invalid.toJSON();
        const warnings = [];
        const service = new ThingMutationService();

        const failures = service.audit([invalid], { warn: message => warnings.push(message) });

        assert.equal(failures.length, 1);
        assert.match(failures[0].message, /must not have module slots/i);
        assert.match(warnings[0], new RegExp(invalid.id));
        assert.deepEqual(invalid.toJSON(), before);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});
