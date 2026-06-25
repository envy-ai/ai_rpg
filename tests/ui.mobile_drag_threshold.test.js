const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const chatDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');
const modalDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'modals_overlays.md'), 'utf8');

function assertIncludes(source, expected) {
    assert.ok(source.includes(expected), `Expected source to include: ${expected}`);
}

function assertNotIncludes(source, unexpected) {
    assert.ok(!source.includes(unexpected), `Expected source not to include: ${unexpected}`);
}

test('thing touch dragging starts when movement crosses the slop distance', () => {
    assertIncludes(viewSource, 'const touchDragSlopDistance = 12;');
    assertNotIncludes(viewSource, 'longPressTimer: window.setTimeout');
    assertNotIncludes(viewSource, 'const longPressMs =');
    assertIncludes(viewSource, 'if (!state.dragStarted && getTouchDragDistance(dx, dy) > touchDragSlopDistance) {');
    assertIncludes(viewSource, 'beginModalInventoryTouchDrag(state);');
});

test('container and crafting modals complete item touch drops on their own targets', () => {
    assertIncludes(viewSource, "element?.closest?.('#containerPlayerInventoryPanel, #containerContentsPanel')");
    assertIncludes(viewSource, 'function resolveCraftingTouchDropSlot(state)');
    assertIncludes(viewSource, 'function updateCraftingTouchDropHighlight(state)');
    assertIncludes(viewSource, 'async function handleCraftingInventoryTouchDrop(state)');
    assertIncludes(viewSource, 'onTouchDragMove: updateCraftingTouchDropHighlight');
    assertIncludes(viewSource, 'onTouchDrop: handleCraftingInventoryTouchDrop');
    assertIncludes(viewSource, 'await assignDraggedItemToCraftingSlot(slotIndex, state.thing.id);');
});

test('NPC party touch dragging uses the same movement threshold gesture', () => {
    assertIncludes(viewSource, 'let partyNpcTouchDragState = null;');
    assertIncludes(viewSource, 'function wireNpcPartyTouchDrag(card, npc, source) {');
    assertIncludes(viewSource, 'beginNpcPartyTouchDrag(state);');
    assertIncludes(viewSource, 'finishNpcPartyTouchDrag(dropState).catch(error => {');
    assertIncludes(viewSource, 'wireNpcPartyTouchDrag(card, npc, source);');
});

test('mobile drag docs describe threshold movement instead of long press', () => {
    assertIncludes(chatDocs, 'movement-threshold touch dragging');
    assertIncludes(chatDocs, 'Crafting and container modal touch drags resolve drops against their modal-specific panels or slots');
    assertIncludes(modalDocs, 'movement-threshold touch dragging');
    assertIncludes(modalDocs, 'touch release over a crafting slot assigns the dragged input through the same validation path as desktop drag/drop');
    assertNotIncludes(chatDocs, 'long-press touch-dragging');
    assertNotIncludes(modalDocs, 'touch long-press drag');
});
