const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

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

test('crafting UI greys out non-empty containers and blocks assignment', () => {
    assertIncludes(viewSource, 'function isCraftingNonEmptyContainer(thing)');
    assertIncludes(viewSource, "card.classList.add('is-non-empty-container');");
    assertIncludes(viewSource, 'Empty this container before using it for crafting.');
    assertIncludes(viewSource, 'if (isCraftingNonEmptyContainer(sourceThing))');
    assertIncludes(viewSource, 'if (isCraftingNonEmptyContainer(thing))');
    assertIncludes(scssSource, '.crafting-inventory-card.is-non-empty-container');
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
    assertIncludes(viewSource, "appendItems(playerInventoryItems, 'player');");
    assertIncludes(viewSource, "appendItems(getCurrentLocationCraftingItems(), 'location');");
    assertIncludes(viewSource, "appendItems(getCurrentLocationCraftingScenery(), 'location');");
    assertIncludes(viewSource, "appendItems(getCurrentLocationContainerCraftingItems(), 'location');");
    assertIncludes(viewSource, 'includeLocationSources: currentCraftingMode !== \'modify-location\'');
    assertIncludes(viewSource, 'renderCraftingInventory(availableCraftingItems);');
    assertIncludes(viewSource, "craftingSourceType !== 'location'");
});

test('crafting API rejects non-empty containers submitted as inputs', () => {
    assertIncludes(apiSource, 'function isNonEmptyCraftingContainer(thing)');
    assertIncludes(apiSource, 'Selected container');
    assertIncludes(apiSource, 'must be emptied before it can be used for crafting.');
});

test('crafting API accepts only player-inventory or current-location inputs', () => {
    assertIncludes(apiSource, 'function collectLocationCraftingThingIds(location, { thingLookup = null } = {})');
    assertIncludes(apiSource, 'const locationThingIds = collectLocationCraftingThingIds(locationRecord);');
    assertIncludes(apiSource, 'const isThingInCurrentPlayerInventory = (thing) => (');
    assertIncludes(apiSource, 'const isThingInCurrentLocation = (thing) => {');
    assertIncludes(apiSource, "is not in the current player's inventory, current location, or a container in the current location.");
    assertIncludes(apiSource, 'must be unequipped before it can be used for crafting.');
});

test('crafting docs describe non-empty container handling', () => {
    assertIncludes(craftingDocs, 'Non-empty containers cannot be selected as crafting inputs');
    assertIncludes(craftingDocs, 'Selected inputs may come from the active player inventory, loose current-location items or scenery, or item contents inside containers in the current location');
    assertIncludes(chatDocs, 'crafting picker lists active player inventory items, current-location items and scenery, and item contents inside current-location containers');
    assertIncludes(chatDocs, 'non-empty containers are greyed out');
});

test('crafting prompt describes selected scenery as input things', () => {
    assertIncludes(craftPrompt, 'If no input things are selected');
    assertIncludes(craftPrompt, 'out of the following selected inputs');
    assertIncludes(craftPrompt, 'with no selected input things');
});
