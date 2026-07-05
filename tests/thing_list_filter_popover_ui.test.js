const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

const scssSource = read('public/css/main.scss');
const viewSource = read('views/index.njk');
const chatDocs = read('docs/ui/chat_interface.md');
const readmeDocs = read('docs/README.md');

function extractScssBlock(source, selector) {
    const start = source.indexOf(selector);
    assert.notEqual(start, -1, `${selector} should exist`);
    const open = source.indexOf('{', start);
    assert.notEqual(open, -1, `${selector} should have an opening brace`);

    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    assert.fail(`${selector} should have a closing brace`);
}

test('compact inventory filter popover aligns to the modal body under the inventory title', () => {
    const compactPanelBlock = extractScssBlock(scssSource, '.thing-list-panel--compact');
    const filtersShellStart = compactPanelBlock.indexOf('.thing-list-filters-shell');
    assert.notEqual(filtersShellStart, -1, 'compact panel should style its filter shell');
    const filtersShellBlock = extractScssBlock(compactPanelBlock.slice(filtersShellStart), '.thing-list-filters-shell');
    const inventoryBodyBlock = extractScssBlock(scssSource, '.npc-inventory-body');
    const inventoryCompactPanelBlock = extractScssBlock(scssSource, '.npc-inventory-panel.thing-list-panel--compact');
    const updateLayoutSource = extractScssBlock(viewSource, 'function updateThingListFilterPopoverLayout(state)');

    assert.match(filtersShellBlock, /top:\s*0/);
    assert.match(filtersShellBlock, /left:\s*0/);
    assert.match(filtersShellBlock, /right:\s*0/);
    assert.match(filtersShellBlock, /width:\s*auto/);
    assert.doesNotMatch(filtersShellBlock, /width:\s*min\(360px,\s*100%,\s*calc\(100vw - 48px\)\)/);
    assert.match(updateLayoutSource, /state\.filtersShell\.style\.top = '0px'/);
    assert.match(updateLayoutSource, /state\.filtersShell\.style\.left = '0px'/);
    assert.match(updateLayoutSource, /state\.filtersShell\.style\.right = '0px'/);
    assert.doesNotMatch(updateLayoutSource, /computedRight/);
    assert.match(inventoryBodyBlock, /position:\s*relative/);
    assert.match(inventoryCompactPanelBlock, /position:\s*static/);
});

test('inventory render explicitly refreshes its compact filter popover state', () => {
    const refreshSource = extractScssBlock(viewSource, 'function refreshThingListFilterPopoverForPanel(panel)');
    const renderInventorySource = extractScssBlock(viewSource, 'function renderNpcInventory(items = [])');

    assert.match(refreshSource, /thingListFilterPopoverStates\.forEach/);
    assert.match(refreshSource, /state\?\.panel === panel/);
    assert.match(refreshSource, /updateThingListFilterPopoverLayout\(state\)/);
    assert.match(renderInventorySource, /refreshThingListFilterPopoverForPanel\(npcInventoryPanel\)/);
});

test('mobile-safe shared thing-list filter popovers are documented', () => {
    assert.match(chatDocs, /inventory filter popup matches the modal body directly under the inventory title/);
    assert.match(readmeDocs, /mobile-safe shared item filters/);
});
