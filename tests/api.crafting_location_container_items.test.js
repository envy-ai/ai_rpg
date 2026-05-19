const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadCollectLocationCraftingThingIds() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function collectLocationCraftingThingIds(location, { thingLookup = null } = {})');
    const end = source.indexOf('\n        function isNonEmptyCraftingContainer(thing)', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate collectLocationCraftingThingIds in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = { Set, Array, Error };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.collectLocationCraftingThingIds = collectLocationCraftingThingIds;`,
        context
    );

    return context.collectLocationCraftingThingIds;
}

test('crafting location availability includes contents of room containers, including scenery containers', () => {
    const collectLocationCraftingThingIds = loadCollectLocationCraftingThingIds();
    const sceneryContainer = {
        id: 'cabinet',
        name: 'Wall Cabinet',
        thingType: 'scenery',
        isContainer: true,
        containedThingIds: ['wire', 'small-box']
    };
    const nestedContainer = {
        id: 'small-box',
        name: 'Small Box',
        thingType: 'item',
        isContainer: true,
        containedThingIds: ['screw']
    };
    const looseItem = {
        id: 'loose-wrench',
        name: 'Loose Wrench',
        thingType: 'item'
    };
    const things = new Map([
        [sceneryContainer.id, sceneryContainer],
        [nestedContainer.id, nestedContainer],
        [looseItem.id, looseItem],
        ['wire', { id: 'wire', name: 'Copper Wire', thingType: 'item' }],
        ['screw', { id: 'screw', name: 'Brass Screw', thingType: 'item' }]
    ]);

    const ids = collectLocationCraftingThingIds({
        thingIds: [sceneryContainer.id, looseItem.id]
    }, {
        thingLookup: thingId => things.get(thingId) || null
    });

    assert.ok(ids.has('cabinet'), 'direct room container remains part of the location availability set');
    assert.ok(ids.has('loose-wrench'), 'direct loose room item remains available');
    assert.ok(ids.has('wire'), 'direct contents of a scenery room container are available');
    assert.ok(ids.has('small-box'), 'nested room container item is available');
    assert.ok(ids.has('screw'), 'contents of nested room containers are available');
});
