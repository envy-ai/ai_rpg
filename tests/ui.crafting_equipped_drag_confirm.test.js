const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const chatDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');

function assertIncludes(source, expected) {
    assert.ok(source.includes(expected), `Expected source to include: ${expected}`);
}

test('crafting slot drag/drop confirms and unequips equipped inputs before assignment', () => {
    assertIncludes(viewSource, 'async function assignDraggedItemToCraftingSlot(slotIndex, thingId)');
    assertIncludes(viewSource, 'confirm(`${itemName} must be uneuquipped first. Unequip it now?`)');
    assertIncludes(viewSource, 'await setNpcItemEquipped(playerId, sourceThing, false)');
    assertIncludes(viewSource, 'return assignItemToCraftingSlot(slotIndex, thingId);');
    assertIncludes(viewSource, 'await assignDraggedItemToCraftingSlot(slotIndex, thingId);');
});

test('crafting docs describe equipped item drag/drop unequip confirmation', () => {
    assertIncludes(chatDocs, 'drag/drop asks to unequip the item before assigning it to a crafting slot');
});
