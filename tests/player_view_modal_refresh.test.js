const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('player view and inventory modals refresh player data before opening', () => {
    assert.match(viewSource, /async function fetchLatestPlayerDataForModal\(\)/);
    assert.match(viewSource, /fetch\('\/api\/player',\s*\{\s*cache:\s*'no-store'\s*\}\)/);
    assert.match(viewSource, /updateChatPlayerPanel\(data\.player\)/);
    assert.match(viewSource, /chatSidebarElements\.viewButton\.addEventListener\('click',\s*async \(\) =>/);
    assert.match(viewSource, /const playerData = await fetchLatestPlayerDataForModal\(\);[\s\S]*showNpcViewModal\(playerData\)/);
    assert.match(viewSource, /chatSidebarElements\.inventoryButton\.addEventListener\('click',\s*async \(\) =>/);
    assert.match(viewSource, /const playerData = await fetchLatestPlayerDataForModal\(\);[\s\S]*showNpcInventoryModal\(playerData\)/);
});

test('character view detail refresh preserves incoming mod status sections', () => {
    const showBlock = extractBlock(
        viewSource,
        'async function showNpcViewModal(npc)',
        'function initTabs()'
    );

    assert.match(showBlock, /incomingModStatusSections/);
    assert.match(showBlock, /Array\.isArray\(latestNpc\?\.modStatusSections\)/);
    assert.match(showBlock, /latestNpc\s*=\s*\{\s*\.\.\.latestNpc,\s*\.\.\.result\.npc,\s*modStatusSections:\s*incomingModStatusSections\s*\}/);
});
