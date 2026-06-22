const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const craftingDocs = fs.readFileSync(path.join(rootDir, 'docs', 'api', 'crafting.md'), 'utf8');
const chatDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');
const craftPrompt = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'plausibility-check-craft.njk'), 'utf8');

function assertIncludes(source, expected) {
    assert.ok(source.includes(expected), `Expected source to include: ${expected}`);
}

function loadCraftingContainerHelpers({ cachedThings = [] } = {}) {
    const start = viewSource.indexOf('        function getCraftingContainedThingIds(thing) {');
    const end = viewSource.indexOf('\n        function getCurrentLocationCraftingItems()', start);
    assert.notEqual(start, -1, 'Could not locate getCraftingContainedThingIds in views/index.njk');
    assert.notEqual(end, -1, 'Could not locate end of crafting container helper block in views/index.njk');

    const context = {
        Array,
        Set,
        Map,
        thingDataCache: new Map(cachedThings),
        resolveThingBooleanFlag(thing, fieldName) {
            const value = thing?.[fieldName] ?? thing?.metadata?.[fieldName];
            if (typeof value === 'string') {
                return ['true', '1', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
            }
            return Boolean(value);
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${viewSource.slice(start, end)}
this.getCraftingContainedThingIds = getCraftingContainedThingIds;
this.isCraftingNonEmptyContainer = isCraftingNonEmptyContainer;`,
        context
    );
    return {
        getCraftingContainedThingIds: context.getCraftingContainedThingIds,
        isCraftingNonEmptyContainer: context.isCraftingNonEmptyContainer
    };
}

function loadApiCraftingContainerHelpers() {
    const start = apiSource.indexOf('        function getCraftingContainedThingIds(thing) {');
    const end = apiSource.indexOf('\n        function consumeThingById(thingId)', start);
    assert.notEqual(start, -1, 'Could not locate getCraftingContainedThingIds in api.js');
    assert.notEqual(end, -1, 'Could not locate end of API crafting container helper block in api.js');

    const context = { Array };
    vm.createContext(context);
    vm.runInContext(
        `${apiSource.slice(start, end)}
this.getCraftingContainedThingIds = getCraftingContainedThingIds;
this.isNonEmptyCraftingContainer = isNonEmptyCraftingContainer;`,
        context
    );
    return {
        getCraftingContainedThingIds: context.getCraftingContainedThingIds,
        isNonEmptyCraftingContainer: context.isNonEmptyCraftingContainer
    };
}

function loadFetchContainedThingDetailsForContainers({ things = new Map() } = {}) {
    const start = viewSource.indexOf('        async function fetchContainedThingDetailsForContainers(rootThings = [])');
    const end = viewSource.indexOf('\n        const thingMenuState = {', start);
    assert.notEqual(start, -1, 'Could not locate fetchContainedThingDetailsForContainers in views/index.njk');
    assert.notEqual(end, -1, 'Could not locate end of fetchContainedThingDetailsForContainers in views/index.njk');

    const context = {
        Array,
        Boolean,
        Map,
        Promise,
        Set,
        async fetchThingDetails(thingId) {
            return things.get(thingId) || null;
        },
        cloneThingRecord(thing) {
            return thing && typeof thing === 'object'
                ? JSON.parse(JSON.stringify(thing))
                : thing;
        },
        resolveThingBooleanFlag(thing, fieldName) {
            const value = thing?.[fieldName] ?? thing?.metadata?.[fieldName];
            if (typeof value === 'string') {
                return ['true', '1', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
            }
            return Boolean(value);
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${viewSource.slice(start, end)}
this.fetchContainedThingDetailsForContainers = fetchContainedThingDetailsForContainers;`,
        context
    );
    return context.fetchContainedThingDetailsForContainers;
}

test('crafting UI greys out non-empty containers and blocks assignment', () => {
    assertIncludes(viewSource, 'function isCraftingNonEmptyContainer(thing)');
    assertIncludes(viewSource, "card.classList.add('is-non-empty-container');");
    assertIncludes(viewSource, 'Empty this container before using it for crafting.');
    assertIncludes(viewSource, 'if (isCraftingNonEmptyContainer(sourceThing))');
    assertIncludes(viewSource, 'if (isCraftingNonEmptyContainer(thing))');
    assertIncludes(scssSource, '.crafting-inventory-card.is-non-empty-container');
});

test('crafting UI treats containers with no real contained ids as empty', () => {
    const { getCraftingContainedThingIds, isCraftingNonEmptyContainer } = loadCraftingContainerHelpers();

    assert.deepEqual(getCraftingContainedThingIds({
        isContainer: true,
        containedThingIds: []
    }), []);
    assert.equal(isCraftingNonEmptyContainer({
        isContainer: true,
        containedThingIds: []
    }), false);

    assert.deepEqual(getCraftingContainedThingIds({
        isContainer: true,
        containedThingIds: ['  ', '', 'item-1', ' item-2 ']
    }), ['item-1', 'item-2']);
    assert.equal(isCraftingNonEmptyContainer({
        isContainer: true,
        containedThingIds: [' item-1 ']
    }), true);
    assert.equal(isCraftingNonEmptyContainer({
        isContainer: false,
        containedThingIds: ['item-1']
    }), false);
});

test('crafting UI uses fresh cached container data when a craft picker copy is stale', () => {
    const { isCraftingNonEmptyContainer } = loadCraftingContainerHelpers({
        cachedThings: [[
            'container-1',
            {
                id: 'container-1',
                isContainer: true,
                containedThingIds: []
            }
        ]]
    });

    assert.equal(isCraftingNonEmptyContainer({
        id: 'container-1',
        isContainer: true,
        containedThingIds: ['old-contained-item']
    }), false);
});

test('location container cards override item/scenery drag drops', () => {
    assertIncludes(viewSource, 'function registerThingContainerDropTarget(card, thing, { locationId = null } = {})');
    assertIncludes(viewSource, 'function handleMoveThingIntoContainer({ containerThing, dragState = null, modalDragState = null, locationId = null } = {})');
    assertIncludes(viewSource, "event.stopPropagation();");
    assertIncludes(viewSource, "source: 'location'");
    assertIncludes(viewSource, "source: 'player'");
    assertIncludes(viewSource, "card.classList.add('thing-container-drop-target');");
    assertIncludes(scssSource, '.thing-container-drop-target.is-drop-hover');
    assertIncludes(chatDocs, 'Dropping an item card onto a container card');
});

test('crafting UI includes current-location items and scenery in the available picker', () => {
    assertIncludes(viewSource, '<h3>Available Items &amp; Scenery</h3>');
    assertIncludes(viewSource, 'function getCurrentLocationCraftingItems()');
    assertIncludes(viewSource, 'function getCurrentLocationCraftingScenery()');
    assertIncludes(viewSource, 'function getCurrentLocationContainerCraftingItems()');
    assertIncludes(viewSource, 'async function fetchContainedThingDetailsForContainers(rootThings = [])');
    assertIncludes(viewSource, 'function buildCraftingAvailableItems(playerInventoryItems = [], { includeLocationSources = true } = {})');
    assertIncludes(viewSource, 'const inventoryContainerContents = await fetchContainedThingDetailsForContainers(inventoryItems);');
    assertIncludes(viewSource, 'const availablePlayerItems = inventoryContainerContents.length');
    assertIncludes(viewSource, 'const refreshedInventoryContainerContents = await fetchContainedThingDetailsForContainers(updatedInventory);');
    assertIncludes(viewSource, 'const refreshedPlayerItems = refreshedInventoryContainerContents.length');
    assertIncludes(viewSource, "appendItems(playerInventoryItems, 'player');");
    assertIncludes(viewSource, "appendItems(getCurrentLocationCraftingItems(), 'location');");
    assertIncludes(viewSource, "appendItems(getCurrentLocationCraftingScenery(), 'location');");
    assertIncludes(viewSource, "appendItems(getCurrentLocationContainerCraftingItems(), 'location');");
    assertIncludes(viewSource, 'includeLocationSources: currentCraftingMode !== \'modify-location\'');
    assertIncludes(viewSource, 'renderCraftingInventory(availableCraftingItems);');
    assertIncludes(viewSource, "craftingSourceType !== 'location'");
});

test('crafting UI fetches only unlocked container contents for crafting pickers without generating pending contents', async () => {
    const unlockedContainer = {
        id: 'unlocked-cabinet',
        name: 'Unlocked Cabinet',
        thingType: 'scenery',
        isContainer: true,
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
        ['visible-wire', { id: 'visible-wire', name: 'Visible Wire', thingType: 'item' }],
        ['hidden-gear', { id: 'hidden-gear', name: 'Hidden Gear', thingType: 'item' }],
        ['locked-box', lockedNestedContainer],
        ['hidden-spring', { id: 'hidden-spring', name: 'Hidden Spring', thingType: 'item' }]
    ]);
    const fetchContainedThingDetailsForContainers = loadFetchContainedThingDetailsForContainers({ things });

    const contents = await fetchContainedThingDetailsForContainers([unlockedContainer, lockedContainer]);
    const ids = Array.from(contents, thing => thing.id);
    const helperStart = viewSource.indexOf('        async function fetchContainedThingDetailsForContainers(rootThings = [])');
    const helperEnd = viewSource.indexOf('\n        const thingMenuState = {', helperStart);
    const helperSource = viewSource.slice(helperStart, helperEnd);

    assert.deepEqual(ids.sort(), ['locked-box', 'visible-wire']);
    assert.equal(things.has('hidden-spring'), true, 'test fixture remains unchanged; no generated item is created');
    assert.doesNotMatch(helperSource, /\/api\/things\/\$\{encodeURIComponent\(containerId\)\}\/container/);
});

test('crafting API rejects non-empty containers submitted as inputs', () => {
    const { getCraftingContainedThingIds, isNonEmptyCraftingContainer } = loadApiCraftingContainerHelpers();

    assertIncludes(apiSource, 'function isNonEmptyCraftingContainer(thing)');
    assertIncludes(apiSource, 'Selected container');
    assertIncludes(apiSource, 'must be emptied before it can be used for crafting.');

    assert.deepEqual(getCraftingContainedThingIds({
        isContainer: true,
        containedThingIds: ['  ', '', 'item-1']
    }), ['item-1']);
    assert.equal(isNonEmptyCraftingContainer({
        isContainer: true,
        containedThingIds: []
    }), false);
    assert.equal(isNonEmptyCraftingContainer({
        isContainer: true,
        containedThingIds: [' item-1 ']
    }), true);
});

test('crafting API accepts only player-inventory or current-location inputs', () => {
    assertIncludes(apiSource, 'function collectPlayerInventoryCraftingThingIds(player, { thingLookup = null } = {})');
    assertIncludes(apiSource, 'function collectLocationCraftingThingIds(location, { thingLookup = null } = {})');
    assertIncludes(apiSource, 'const locationThingIds = collectLocationCraftingThingIds(locationRecord);');
    assertIncludes(apiSource, 'const playerInventoryThingIds = collectPlayerInventoryCraftingThingIds(currentPlayer);');
    assertIncludes(apiSource, 'const isThingInCurrentPlayerInventory = (thing) => (');
    assertIncludes(apiSource, 'const isThingInCurrentLocation = (thing) => {');
    assertIncludes(apiSource, "is not in the current player's inventory, a container in the current player's inventory, current location, or a container in the current location.");
    assertIncludes(apiSource, 'must be unequipped before it can be used for crafting.');
});

test('crafting docs describe non-empty container handling', () => {
    assertIncludes(craftingDocs, 'Non-empty containers cannot be selected as crafting inputs');
    assertIncludes(craftingDocs, 'Selected inputs may come from the active player inventory, existing item contents inside unlocked containers in that inventory, loose current-location items or scenery, or existing item contents inside unlocked containers in the current location');
    assertIncludes(chatDocs, 'crafting picker lists active player inventory items, existing item contents inside unlocked player-inventory containers, current-location items and scenery, and existing item contents inside unlocked current-location containers');
    assertIncludes(chatDocs, 'non-empty containers are greyed out');
});

test('crafting prompt describes selected scenery as input things', () => {
    assertIncludes(craftPrompt, 'If no input things are selected');
    assertIncludes(craftPrompt, 'out of the following selected inputs');
    assertIncludes(craftPrompt, 'with no selected input things');
});
