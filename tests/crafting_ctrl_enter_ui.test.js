const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');

test('crafting modal notes submit primary actions with ctrl-enter', () => {
    assert.match(
        viewSource,
        /function isCtrlEnterSubmitShortcut\(event\)/,
        'shared Ctrl/Cmd+Enter submit shortcut predicate should exist'
    );
    assert.match(
        viewSource,
        /craftingNotesInput\.addEventListener\('keydown', handleCraftingNotesCtrlEnter\)/,
        'main crafting notes field should have an explicit Ctrl/Cmd+Enter submit handler'
    );
    assert.match(
        viewSource,
        /salvageIntentInput\.addEventListener\('keydown', handleSalvageIntentCtrlEnter\)/,
        'salvage and harvest intent field should have an explicit Ctrl/Cmd+Enter submit handler'
    );
    assert.match(
        viewSource,
        /clickPrimaryButtonForShortcut\(event, craftingActionButton\)/,
        'main crafting shortcut should trigger the primary crafting action'
    );
    assert.match(
        viewSource,
        /clickPrimaryButtonForShortcut\(event, salvageIntentSubmitBtn\)/,
        'salvage and harvest shortcut should trigger the primary intent action'
    );
});
