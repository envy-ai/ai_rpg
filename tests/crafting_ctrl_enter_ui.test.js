const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const headSource = fs.readFileSync(path.join(rootDir, 'views', '_includes', 'head-common.njk'), 'utf8');

test('crafting modal notes submit primary actions with ctrl-enter', () => {
    assert.match(
        headSource,
        /\/js\/modal-submit-shortcuts\.js/,
        'the shared modal Ctrl/Cmd+Enter helper should be loaded'
    );
    assert.match(
        viewSource,
        /id="craftingNotesInput"[^>]*data-ctrl-enter-submit="#craftingActionButton"/,
        'main crafting notes should map to the primary crafting action'
    );
    assert.match(
        viewSource,
        /id="salvageIntentInput"[^>]*data-ctrl-enter-submit="#salvageIntentSubmitBtn"/,
        'salvage and harvest intent should map to the primary intent action'
    );
    assert.doesNotMatch(viewSource, /handleCraftingNotesCtrlEnter|handleSalvageIntentCtrlEnter/);
});
