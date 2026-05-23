const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
const npcApiDocs = fs.readFileSync(path.join(rootDir, 'docs', 'api', 'npcs.md'), 'utf8');
const chatUiDocs = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'chat_interface.md'), 'utf8');

test('NPC context menu exposes a living-NPC hidden-state toggle', () => {
    assert.match(viewSource, /toggleHiddenButton\.textContent = 'Toggle Hidden'/);
    assert.match(viewSource, /toggleHiddenButton\.disabled = Boolean\(npc\.isDead\)/);
    assert.match(viewSource, /async function toggleNpcHiddenFromPlayer\(npc, \{ card = null \} = \{\}\)/);
    assert.match(viewSource, /hiddenFromPlayer:\s*nextHidden/);
    assert.match(viewSource, /npcDataCache\.set\(npc\.id, cloneActorRecord\(updatedNpc\) \|\| \{ \.\.\.updatedNpc \}\)/);
    assert.match(viewSource, /await window\.loadCurrentLocation\(\)/);
});

test('NPC update API accepts persisted hiddenFromPlayer changes', () => {
    assert.match(apiSource, /const hasHiddenFromPlayer = Object\.prototype\.hasOwnProperty\.call\(body, 'hiddenFromPlayer'\)/);
    assert.match(apiSource, /hiddenFromPlayer must be a boolean\./);
    assert.match(apiSource, /npc\.hiddenFromPlayer = hiddenFromPlayer/);
});

test('NPC hidden toggle is documented', () => {
    assert.match(npcApiDocs, /hiddenFromPlayer/);
    assert.match(chatUiDocs, /Toggle Hidden/);
});
