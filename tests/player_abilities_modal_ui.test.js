const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('player abilities modal is modeless and renders abilities in the view-modal ability-card format', () => {
    assert.match(viewSource, /id="chatPlayerAbilitiesButton"/);
    assert.match(viewSource, /id="playerAbilitiesModal"[^>]*aria-modal="false"/);
    assert.doesNotMatch(
        extractBlock(viewSource, 'id="playerAbilitiesModal"', 'id="playerSkillsModal"'),
        /npcModalBackdrop|modal-backdrop/
    );
    assert.match(viewSource, /id="playerAbilitiesGrid"[^>]*class="npc-view-ability-cards player-abilities-grid"/);
    assert.match(viewSource, /function renderPlayerAbilitiesModalAbilities\(player/);
    assert.match(viewSource, /card\.className = 'npc-view-ability-card player-abilities-card';/);
    assert.match(viewSource, /header\.className = 'npc-view-ability-card-header';/);
    assert.match(viewSource, /nameEl\.className = 'npc-view-ability-card-name ability-type-text';/);
    assert.match(viewSource, /meta\.className = 'npc-view-ability-card-meta';/);
    assert.match(viewSource, /description\.className = 'npc-view-ability-card-description';/);
});

test('clicking a player ability inserts the bracketed ability name at the chat cursor', () => {
    assert.match(viewSource, /function insertTextIntoChatInputAtCursor\(text\)/);
    assert.match(viewSource, /messageInput\.setRangeText\(insertText, start, end, 'end'\)/);
    assert.match(viewSource, /insertTextIntoChatInputAtCursor\(`\[\$\{abilityName\}\]`\)/);
});

test('A hotkey opens the abilities modal without firing while typing', () => {
    assert.match(viewSource, /event\.key\.toLowerCase\(\) !== 'a'/);
    assert.match(viewSource, /activeElement\.closest\('input, textarea, select, \[contenteditable="true"\]'\)/);
    assert.match(viewSource, /chatSidebarElements\.abilitiesButton\.click\(\)/);
});

test('player abilities modal has dedicated non-blurring styles', () => {
    assert.match(scssSource, /\.player-abilities-modal\s+\.modal__dialog\s*\{/);
    assert.match(scssSource, /\.player-abilities-grid\s*\{/);
    assert.match(scssSource, /\.player-abilities-card\s*\{/);
    assert.doesNotMatch(
        extractBlock(scssSource, '.player-abilities-modal .modal__dialog', '.player-skills-modal .modal__dialog'),
        /backdrop-filter/
    );
});
