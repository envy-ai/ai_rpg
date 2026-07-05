const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

const viewSource = read('views/index.njk');
const scssSource = read('public/css/main.scss');
const chatDocs = read('docs/ui/chat_interface.md');
const readmeDocs = read('docs/README.md');

function extractBlock(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `${signature} should exist`);
    const open = source.indexOf('{', start);
    assert.notEqual(open, -1, `${signature} should have an opening brace`);

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

    assert.fail(`${signature} should have a closing brace`);
}

test('crafting and module workbench multi-slot containers mark themselves for mobile two-column layout', () => {
    const craftingSlotsSource = extractBlock(viewSource, 'function renderCraftingSlots(slotCount)');
    const moduleSlotsSource = extractBlock(viewSource, 'function renderModuleWorkbenchSlots()');

    assert.match(craftingSlotsSource, /craftingSlotsContainer\.classList\.toggle\('crafting-modal__slots--multiple',\s*slotCount > 1\)/);
    assert.match(moduleSlotsSource, /moduleWorkbenchSlots\.classList\.toggle\('crafting-modal__slots--multiple',\s*entries\.length > 1\)/);
});

test('mobile multi-slot modal grids use two columns instead of collapsing to one', () => {
    const mobileSlotCellBlock = extractBlock(scssSource, '.crafting-modal__slots--multiple > .crafting-slot,');

    assert.match(scssSource, /@media \(max-width:\s*768px\)\s*\{[\s\S]*?\.crafting-modal__slots--multiple\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    assert.match(scssSource, /\.crafting-modal__slots--multiple\s*\{[\s\S]*?gap:\s*12px/);
    assert.match(mobileSlotCellBlock, /min-width:\s*0/);
    assert.match(mobileSlotCellBlock, /min-height:\s*0/);
});

test('mobile two-column crafting slot layout is documented', () => {
    assert.match(chatDocs, /multiple crafting or module-workbench slots stay in two columns on mobile/);
    assert.match(readmeDocs, /mobile two-column modal slot grids/);
});
