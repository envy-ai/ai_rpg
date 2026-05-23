const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('container modal shows a generated-contents spinner while pending contents hydrate', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const scss = fs.readFileSync(path.join(rootDir, 'public/css/main.scss'), 'utf8');
    const stateBlock = extractBlock(
        source,
        'let currentThingContainerVisiblePlayerInventory = []',
        'let modalInventoryDragState = null'
    );
    const loadingBlock = extractBlock(
        source,
        'function renderThingContainerContentsLoading',
        'function renderThingContainerModal'
    );
    const renderBlock = extractBlock(
        source,
        'function renderThingContainerModal',
        'function applyThingContainerPayload'
    );
    const openBlock = extractBlock(
        source,
        'async function openThingContainerModal',
        'async function openThingContainerModalFromElement'
    );

    assert.match(stateBlock, /let thingContainerContentsLoading = false/);
    assert.match(stateBlock, /let thingContainerContentsGenerating = false/);
    assert.match(loadingBlock, /barter-modal__loading thing-container-modal__loading/);
    assert.match(loadingBlock, /spinner barter-modal__spinner thing-container-modal__spinner/);
    assert.match(loadingBlock, /Container contents are being generated\.\.\./);
    assert.match(renderBlock, /thingContainerContentsLoading/);
    assert.match(renderBlock, /thingContainerModal\.setAttribute\('aria-busy', 'true'\)/);
    assert.match(openBlock, /thingHasPendingGeneratedContainerContents\(thing\)/);
    assert.match(openBlock, /thingContainerContentsLoading = true/);
    assert.match(scss, /\.thing-container-modal__loading/);
});
