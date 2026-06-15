const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('container modal shift-click captures item-card clicks before image lightbox handlers', () => {
    const source = read('views/index.njk');
    const decoratorBlock = extractBlock(
        source,
        "const makeDecorator = (source) => ({ card, thing }) => {",
        'currentThingContainerPlayerInventory.forEach(cacheThingData);'
    );

    assert.match(decoratorBlock, /card\.addEventListener\('click', async \(event\) => \{[\s\S]*?event\.shiftKey[\s\S]*?moveThingBetweenContainerColumns\(thing, source\);[\s\S]*?\}, true\);/);
    assert.match(decoratorBlock, /event\.stopImmediatePropagation\(\);/);
});

test('container transfer docs specify whole-stack shift-click movement', () => {
    assert.match(read('docs/ui/chat_interface.md'), /Container transfers move whole stacks[\s\S]*shift-clicking/i);
    assert.match(read('docs/ui/modals_overlays.md'), /#thingContainerModal[\s\S]*shift-click[\s\S]*moves whole stacks/i);
});
