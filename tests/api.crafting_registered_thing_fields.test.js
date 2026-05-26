const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Globals = require('../Globals.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const Thing = require('../Thing.js');
const api = require('../api.js');

function registerImplantField(registry) {
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        exposeToXmlParser: true,
        clearThingSlotWhenPresent: true,
        xmlPrompt: {
            placeholder: 'N/A unless this item can be installed as an implant.'
        }
    });
}

test('crafting Thing construction preserves registered parsed fields and clears normal slot', () => {
    assert.equal(typeof api.extractRegisteredThingBlueprintFields, 'function');

    const registry = new ModExtensionRegistry();
    registerImplantField(registry);
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    try {
        const blueprint = {
            implantSlot: 'dermal',
            slot: 'gloves'
        };
        const extracted = api.extractRegisteredThingBlueprintFields(blueprint);

        assert.deepEqual(extracted.values, { implantSlot: 'dermal' });
        assert.equal(extracted.shouldClearSlot, true);

        const thing = new Thing({
            name: 'Colony-Threaded Twitch Implant',
            description: 'A palm-sized subcutaneous implant.',
            thingType: 'item',
            slot: extracted.shouldClearSlot ? null : blueprint.slot,
            ...extracted.values,
            enrichStatusEffects: false
        });
        assert.equal(thing.implantSlot, 'dermal');
        assert.equal(thing.slot, null);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
        Thing.clear();
    }
});

test('crafting instantiateThingFromBlueprint forwards registered blueprint values', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

    assert.match(
        apiSource,
        /const registeredBlueprintFields = extractRegisteredThingBlueprintFields\(itemBlueprint\);/
    );
    assert.match(
        apiSource,
        /slot: registeredBlueprintFields\.shouldClearSlot\s*\?\s*null\s*:\s*\(itemBlueprint\.slot \|\| null\)/
    );
    assert.match(
        apiSource,
        /\.\.\.registeredBlueprintFields\.values/
    );
});
