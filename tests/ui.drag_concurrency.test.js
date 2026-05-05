const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const chatDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');
const modalDocSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'modals_overlays.md'), 'utf8');
const readmeSource = fs.readFileSync(path.join(rootDir, 'docs', 'README.md'), 'utf8');

test('modal inventory drops track in-flight work per dragged thing', () => {
    assert.match(viewSource, /const modalInventoryDropInFlightThingIds = new Set\(\);/);
    assert.match(viewSource, /function clearModalInventoryDragState\(expectedThingId = null\)/);
    assert.match(viewSource, /clearModalInventoryDragState\(dragState\.thingId\);/);
    assert.match(viewSource, /modalInventoryDropInFlightThingIds\.has\(dragState\.thingId\)/);
    assert.match(viewSource, /modalInventoryDropInFlightThingIds\.add\(dragState\.thingId\)/);
    assert.match(viewSource, /modalInventoryDropInFlightThingIds\.delete\(dragState\.thingId\)/);
    assert.doesNotMatch(viewSource, /modalInventoryDropInFlight\s*=\s*true/);
});

test('container single-item moves can overlap while same-item and bulk moves stay guarded', () => {
    assert.match(viewSource, /const thingContainerMoveInFlightIds = new Set\(\);/);
    assert.match(viewSource, /let thingContainerBulkMoveInFlight = false;/);
    assert.match(viewSource, /function hasThingContainerMoveWorkInFlight\(\)/);
    assert.match(viewSource, /thingContainerBulkMoveInFlight \|\| thingContainerMoveInFlightIds\.has\(thingId\)/);
    assert.match(viewSource, /thingContainerMoveInFlightIds\.add\(thingId\)/);
    assert.match(viewSource, /thingContainerMoveInFlightIds\.delete\(thingId\)/);
    assert.match(viewSource, /if \(hasThingContainerBulkWorkInFlight\(\)\) \{\s*return null;\s*\}/);
    assert.doesNotMatch(viewSource, /thingContainerMoveInFlight\s*=\s*true/);
});

test('container move responses are applied only to the active modal session', () => {
    assert.match(viewSource, /let thingContainerSessionToken = 0;/);
    assert.match(viewSource, /function isThingContainerOpenForSession\(containerId, sessionToken\)/);
    assert.match(viewSource, /function applyThingContainerPayloadForSession\(payload,/);
    assert.match(viewSource, /function refreshThingContainerForSession\(containerId, sessionToken\)/);
    assert.match(viewSource, /requestThingContainerMove\(thingId, source, \{ containerId \}\)/);
    assert.match(viewSource, /refreshThingContainerForSession\(containerId, sessionToken\)/);
});

test('location drag handlers snapshot the dragged thing before async work starts', () => {
    assert.match(viewSource, /const locationThingDropInFlightIds = new Set\(\);/);
    assert.match(viewSource, /const resetThingDragState = \(expectedThingId = null\) =>/);
    assert.match(viewSource, /async function handleGiveThingToOwner\(\{ ownerId, ownerType, dragState = draggedLocationThing \}\)/);
    assert.match(viewSource, /async function handleConvertThingType\(\{ targetType, dragState = draggedLocationThing \}\)/);
    assert.match(viewSource, /const dragState = draggedLocationThing;\s*await handleGiveThingToOwner\(\{ ownerId, ownerType, dragState \}\);/);
    assert.match(viewSource, /const dragState = draggedLocationThing;\s*await handleConvertThingType\(\{ targetType: normalizedTargetType, dragState \}\);/);
});

test('docs describe concurrent drag processing rules', () => {
    assert.match(chatDocSource, /Distinct item drag\/drop operations can process concurrently/i);
    assert.match(chatDocSource, /same item is already being processed/i);
    assert.match(modalDocSource, /distinct dragged item moves can process concurrently/i);
    assert.match(readmeSource, /concurrent distinct dragged-item operations/i);
});
