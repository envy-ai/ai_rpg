const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadCraftingThingAvailabilityHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function collectCraftingThingIdsFromRootIds(rootThingIds, { thingLookup = null } = {})');
    const end = source.indexOf('\n        function isNonEmptyCraftingContainer(thing)', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate crafting availability helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = { Set, Array, Error };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.collectLocationCraftingThingIds = collectLocationCraftingThingIds;
this.collectPlayerInventoryCraftingThingIds = collectPlayerInventoryCraftingThingIds;`,
        context
    );

    return {
        collectLocationCraftingThingIds: context.collectLocationCraftingThingIds,
        collectPlayerInventoryCraftingThingIds: context.collectPlayerInventoryCraftingThingIds
    };
}

test('crafting location availability includes contents of room containers, including scenery containers', () => {
    const { collectLocationCraftingThingIds } = loadCraftingThingAvailabilityHelpers();
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

test('crafting location availability skips contents of locked room containers', () => {
    const { collectLocationCraftingThingIds } = loadCraftingThingAvailabilityHelpers();
    const unlockedContainer = {
        id: 'unlocked-cabinet',
        name: 'Unlocked Cabinet',
        thingType: 'scenery',
        isContainer: true,
        requiresCheckToOpen: false,
        containedThingIds: ['visible-wire', 'locked-box']
    };
    const lockedContainer = {
        id: 'locked-crate',
        name: 'Locked Crate',
        thingType: 'item',
        isContainer: true,
        requiresCheckToOpen: true,
        containedThingIds: ['hidden-gear']
    };
    const lockedNestedContainer = {
        id: 'locked-box',
        name: 'Locked Box',
        thingType: 'item',
        isContainer: true,
        metadata: {
            requiresCheckToOpen: 'true'
        },
        containedThingIds: ['hidden-spring']
    };
    const things = new Map([
        [unlockedContainer.id, unlockedContainer],
        [lockedContainer.id, lockedContainer],
        [lockedNestedContainer.id, lockedNestedContainer],
        ['visible-wire', { id: 'visible-wire', name: 'Visible Wire', thingType: 'item' }],
        ['hidden-gear', { id: 'hidden-gear', name: 'Hidden Gear', thingType: 'item' }],
        ['hidden-spring', { id: 'hidden-spring', name: 'Hidden Spring', thingType: 'item' }]
    ]);

    const ids = collectLocationCraftingThingIds({
        thingIds: [unlockedContainer.id, lockedContainer.id]
    }, {
        thingLookup: thingId => things.get(thingId) || null
    });

    assert.ok(ids.has('unlocked-cabinet'), 'direct unlocked room container remains local');
    assert.ok(ids.has('locked-crate'), 'direct locked room container remains local');
    assert.ok(ids.has('visible-wire'), 'contents of unlocked room containers are available');
    assert.ok(ids.has('locked-box'), 'locked nested container itself is visible when stored in an unlocked container');
    assert.equal(ids.has('hidden-gear'), false, 'contents of locked room containers are not available');
    assert.equal(ids.has('hidden-spring'), false, 'contents of locked nested containers are not available');
});

test('crafting player inventory availability includes contents of unlocked inventory containers', () => {
    const { collectPlayerInventoryCraftingThingIds } = loadCraftingThingAvailabilityHelpers();
    const backpack = {
        id: 'backpack',
        name: 'Backpack',
        thingType: 'item',
        isContainer: true,
        containedThingIds: ['thread', 'locked-pouch']
    };
    const lockedPouch = {
        id: 'locked-pouch',
        name: 'Locked Pouch',
        thingType: 'item',
        isContainer: true,
        requiresCheckToOpen: true,
        containedThingIds: ['sealed-needle']
    };
    const looseKnife = {
        id: 'knife',
        name: 'Knife',
        thingType: 'item'
    };
    const things = new Map([
        [backpack.id, backpack],
        [lockedPouch.id, lockedPouch],
        [looseKnife.id, looseKnife],
        ['thread', { id: 'thread', name: 'Thread', thingType: 'item' }],
        ['sealed-needle', { id: 'sealed-needle', name: 'Sealed Needle', thingType: 'item' }]
    ]);
    const player = {
        getInventoryItems() {
            return [backpack, looseKnife];
        }
    };

    const ids = collectPlayerInventoryCraftingThingIds(player, {
        thingLookup: thingId => things.get(thingId) || null
    });

    assert.ok(ids.has('backpack'), 'direct inventory container remains available');
    assert.ok(ids.has('knife'), 'direct inventory item remains available');
    assert.ok(ids.has('thread'), 'contents of unlocked inventory containers are available');
    assert.ok(ids.has('locked-pouch'), 'locked nested container itself is available when stored in an unlocked inventory container');
    assert.equal(ids.has('sealed-needle'), false, 'contents of locked nested inventory containers are not available');
});
