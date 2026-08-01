const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const Player = require('../Player.js');
const api = require('../api.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-npc-edit-fields-',
        manageModRegistry: true
    }, run);
}

function registerEditModalField(registry) {
    registry.registerEntityField({
        modName: 'nsfw-boost',
        entityType: 'player',
        fieldName: 'sexualTraits',
        type: 'string',
        description: 'Traits and boundaries.',
        exposeToEditModal: true,
        edit: {
            label: 'Sexual traits',
            inputType: 'textarea',
            order: 10
        }
    });
}

function registerHiddenField(registry) {
    registry.registerEntityField({
        modName: 'nsfw-boost',
        entityType: 'player',
        fieldName: 'lustScore',
        type: 'integer',
        description: 'Internal tracking value.'
    });
}

test('getRegisteredPlayerPayloadFields only returns edit-modal-exposed player fields', () => {
    const registry = new ModExtensionRegistry();
    registerEditModalField(registry);
    registerHiddenField(registry);
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    try {
        const fields = api.getRegisteredPlayerPayloadFields({ edit: true });
        assert.deepEqual(fields.map(field => field.fieldName), ['sexualTraits']);

        const createFields = api.getRegisteredPlayerPayloadFields({ create: true });
        assert.deepEqual(createFields, []);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('parseRegisteredPlayerPayloadFieldValue normalizes types and rejects bad input', () => {
    assert.equal(api.parseRegisteredPlayerPayloadFieldValue('  hello  ', { fieldName: 'f', type: 'string' }), 'hello');
    assert.equal(api.parseRegisteredPlayerPayloadFieldValue('', { fieldName: 'f', type: 'string' }), null);
    assert.equal(api.parseRegisteredPlayerPayloadFieldValue(null, { fieldName: 'f', type: 'string' }), null);
    assert.equal(api.parseRegisteredPlayerPayloadFieldValue('3.5', { fieldName: 'f', type: 'number' }), 3.5);
    assert.equal(api.parseRegisteredPlayerPayloadFieldValue('7', { fieldName: 'f', type: 'integer' }), 7);
    assert.equal(api.parseRegisteredPlayerPayloadFieldValue('yes', { fieldName: 'f', type: 'boolean' }), true);
    assert.equal(api.parseRegisteredPlayerPayloadFieldValue(0, { fieldName: 'f', type: 'boolean' }), false);
    assert.deepEqual(api.parseRegisteredPlayerPayloadFieldValue('["a","b"]', { fieldName: 'f', type: 'array' }), ['a', 'b']);
    assert.deepEqual(api.parseRegisteredPlayerPayloadFieldValue({ a: 1 }, { fieldName: 'f', type: 'object' }), { a: 1 });

    assert.throws(() => api.parseRegisteredPlayerPayloadFieldValue('abc', { fieldName: 'f', type: 'number' }), /finite number/);
    assert.throws(() => api.parseRegisteredPlayerPayloadFieldValue('1.5', { fieldName: 'f', type: 'integer' }), /integer/);
    assert.throws(() => api.parseRegisteredPlayerPayloadFieldValue('{"a":1}', { fieldName: 'f', type: 'array' }), /array/);
    assert.throws(() => api.parseRegisteredPlayerPayloadFieldValue('maybe', { fieldName: 'f', type: 'boolean' }), /boolean/);
});

test('player payload field values apply through setExtensionField and round-trip', () => {
    withTempPlayerEnvironment(() => {
        const registry = new ModExtensionRegistry();
        registerEditModalField(registry);
        Globals.modExtensionRegistry = registry;

        const npc = new Player({
            id: 'edit-field-npc',
            name: 'Mira',
            isNPC: true
        });
        assert.equal(npc.getExtensionField('sexualTraits'), undefined);

        const fields = api.getRegisteredPlayerPayloadFields({ edit: true });
        const values = api.extractRegisteredPlayerPayloadFieldValues(
            { sexualTraits: '  switch, romantic  ', lustScore: 5, unrelatedKey: 'ignored' },
            fields
        );
        assert.deepEqual(values, { sexualTraits: 'switch, romantic' });

        api.applyRegisteredPlayerPayloadFieldValues(npc, values);
        assert.equal(npc.getExtensionField('sexualTraits'), 'switch, romantic');
        assert.equal(npc.sexualTraits, 'switch, romantic');
        assert.equal(npc.toJSON().sexualTraits, 'switch, romantic');

        // Empty input clears the stored value.
        const cleared = api.extractRegisteredPlayerPayloadFieldValues({ sexualTraits: '' }, fields);
        api.applyRegisteredPlayerPayloadFieldValues(npc, cleared);
        assert.equal(npc.getExtensionField('sexualTraits'), undefined);
        assert.equal(npc.toJSON().sexualTraits, undefined);

        // Fields without exposeToEditModal are not writable through this path.
        const hiddenValues = api.extractRegisteredPlayerPayloadFieldValues({ lustScore: 5 }, fields);
        assert.deepEqual(hiddenValues, {});
    });
});
