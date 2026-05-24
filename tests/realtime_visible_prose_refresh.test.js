const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
const chatDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'chat.md'), 'utf8');
const serverDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'server_llm_notes.md'), 'utf8');
const uiDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui', 'chat_interface.md'), 'utf8');

function sourceBetween(startMarker, endMarker) {
    const start = apiSource.indexOf(startMarker);
    assert.notEqual(start, -1, `Unable to locate start marker: ${startMarker}`);
    const end = apiSource.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Unable to locate end marker after ${startMarker}: ${endMarker}`);
    return apiSource.slice(start, end);
}

test('server has a shared visible prose refresh helper', () => {
    assert.match(apiSource, /function notifyVisibleProseEntryStored\s*\(/);
    assert.match(apiSource, /reason:\s*'visible_prose'/);
    assert.match(apiSource, /entryId:\s*entry\.id\s*\|\|\s*null/);
});

test('while-you-were-away visible prose refreshes before scoped event checks', () => {
    const source = sourceBetween(
        'storedVisibleEntry = pushChatEntry(visibleEntry',
        'eventResult = await Events.runEventChecks'
    );
    assert.match(source, /notifyVisibleProseEntryStored\s*\(\s*storedVisibleEntry/);
    assert.match(source, /proseType:\s*'while-you-were-away-player'/);
});

test('NPC turn final prose refreshes before NPC event checks', () => {
    const source = sourceBetween(
        'const npcTurnEntry = pushChatEntry({',
        'npcEventResult = await Events.runEventChecks'
    );
    assert.match(source, /notifyVisibleProseEntryStored\s*\(\s*npcTurnEntry/);
    assert.match(source, /proseType:\s*'npc-turn'/);
});

test('random-event prose refreshes before random-event event checks', () => {
    const source = sourceBetween(
        'const randomEventEntry = pushChatEntry({',
        'eventChecks = await Events.runEventChecks'
    );
    assert.match(source, /notifyVisibleProseEntryStored\s*\(\s*randomEventEntry/);
    assert.match(source, /proseType:\s*'random-event'/);
});

test('craft and location modification prose refreshes before result summaries', () => {
    const craftingSource = sourceBetween(
        'chatEntry = pushChatEntry({\n                        role: \'assistant\',\n                        type: \'player-action\',',
        'recordActionOutcomeCheckResultsEntry({'
    );
    assert.match(craftingSource, /notifyVisibleProseEntryStored\s*\(\s*chatEntry/);
    assert.match(craftingSource, /proseType:\s*'crafting-action'/);

    const locationModifySource = sourceBetween(
        'chatEntry = pushChatEntry({\n                        role: \'assistant\',\n                        type: \'player-action\',\n                        content: narrativeContent,\n                        metadata: {\n                            actionType: \'modify_location\'',
        'recordActionOutcomeCheckResultsEntry({'
    );
    assert.match(locationModifySource, /notifyVisibleProseEntryStored\s*\(\s*chatEntry/);
    assert.match(locationModifySource, /proseType:\s*'location-modification'/);
});

test('docs describe immediate visible prose refreshes', () => {
    assert.match(chatDocs, /Visible prose entries are pushed to the active client as soon as they are stored after slop removal/);
    assert.match(serverDocs, /NPC final prose, random-event prose, and visible while-you-were-away prose emit a `chat_history_updated` refresh immediately after storage/);
    assert.match(uiDocs, /`chat_history_updated` can arrive as an early visible-prose refresh/);
});
