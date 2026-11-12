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

test('container move responses refresh chat when a story entry is returned', () => {
    const start = viewSource.indexOf('async function requestThingContainerMove(');
    assert.notEqual(start, -1, 'Unable to locate requestThingContainerMove.');
    const end = viewSource.indexOf('\n        async function moveThingBetweenContainerColumns', start);
    assert.notEqual(end, -1, 'Unable to locate end of requestThingContainerMove.');
    const block = viewSource.slice(start, end);

    assert.match(block, /if \(payload\?\.chatEntry\) \{[\s\S]*?await window\.AIRPG_CHAT\?\.refreshChatHistory\?\.\(\);[\s\S]*?\}/);
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

test('modal drag uses the visible panel boundary and touch targets keep priority', async () => {
    const vm = require('node:vm');
    const extract = (start, end) => { const a = viewSource.indexOf(start), b = viewSource.indexOf(end, a); assert.ok(a >= 0 && b > a); return viewSource.slice(a, b); };
    class FakeNode { constructor() { this.isConnected = true; } }
    class FakeElement extends FakeNode {
        constructor(parent = null) { super(); this.parentElement = parent; this.hidden = false; this.ariaHidden = false; }
        hasAttribute(name) { return name === 'hidden' && this.hidden; }
        getAttribute(name) { return name === 'aria-hidden' && this.ariaHidden ? 'true' : null; }
        contains(target) { return target === this || target.parentElement === this; }
    }
    const modal = new FakeElement(), panel = new FakeElement(modal), inside = new FakeElement(panel), backdrop = modal, detached = new FakeElement(); detached.isConnected = false;
    const state = { modal, panel, thing: { id: 'item' }, context: 'npc-inventory', npcId: 'npc', currentX: 2, currentY: 3 };
    let hit = backdrop; const drops = [];
    const context = { HTMLElement: FakeElement, Node: FakeNode, modalInventoryDragState: state, document: { elementFromPoint: () => hit }, thingDataCache: new Map(), modalInventoryDropInFlightThingIds: new Set(), dropThingToCurrentLocation: async (thing, options) => drops.push({ thing, options }) };
    vm.runInNewContext(`${extract('function getActiveModalInventoryDragPanel(', '\n        function clearModalInventoryDragState(')}\n${extract('async function finishModalInventoryTouchDrag(', '\n        function wireTouchDragGestureCard(')}\nthis.outside = isModalInventoryDragOutsideSourceModal; this.finish = finishModalInventoryTouchDrag;`, context);
    assert.equal(context.outside({ target: inside }), false); assert.equal(context.outside({ target: backdrop }), true);
    assert.equal(context.outside({ target: null }), false); assert.equal(context.outside({ target: detached }), false);
    modal.hidden = true; assert.equal(context.outside({ target: backdrop }), false); modal.hidden = false;
    state.onTouchDrop = async () => true;
    await context.finish(state); assert.equal(drops.length, 0, 'a target-specific drop wins');
    state.onTouchDrop = async () => false; hit = inside; await context.finish(state); assert.equal(drops.length, 0);
    hit = null; await context.finish(state); assert.equal(drops.length, 0);
    hit = backdrop; await context.finish(state); assert.equal(drops.length, 1);
    assert.equal(drops[0].options.npcId, 'npc'); assert.equal(drops[0].options.context, 'npc-inventory');
    modal.ariaHidden = true; await context.finish(state); assert.equal(drops.length, 1);
});
