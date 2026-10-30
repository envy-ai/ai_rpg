const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const chooserSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'widgets', 'modeless-chooser.js'), 'utf8');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('player abilities modal is modeless and uses the shared action-card chooser structure', () => {
    assert.match(viewSource, /id="chatPlayerAbilitiesButton"/);
    assert.match(viewSource, /id="playerAbilitiesModal"[^>]*aria-modal="false"/);
    assert.doesNotMatch(
        extractBlock(viewSource, 'id="playerAbilitiesModal"', 'id="playerSkillsModal"'),
        /npcModalBackdrop|modal-backdrop/
    );
    assert.match(viewSource, /id="playerAbilitiesGrid"[^>]*class="npc-view-ability-cards player-abilities-grid"/);
    assert.match(viewSource, /card\.className = 'npc-view-ability-card player-abilities-card action-card';/);
    assert.match(viewSource, /content\.className = 'action-card-content';/);
    assert.match(viewSource, /window\.ActionImages\.create\(\{ entityType: 'ability', entityId: `\$\{player\.id\}:\$\{id\}`/);
    assert.match(viewSource, /playerAbilitiesChooser\.choice\(content, abilityName\)/);
    assert.match(viewSource, /new window\.AIRPG_WIDGETS\.ModelessChooser\(\{ root: playerAbilitiesModal/);
});

test('clicking a player ability inserts the bracketed ability name at the chat cursor', () => {
    assert.match(viewSource, /function insertTextIntoChatInputAtCursor\(text\)/);
    assert.match(viewSource, /messageInput\.setRangeText\(insertText, start, end, 'end'\)/);
    assert.match(viewSource, /playerAbilitiesChooser = new window\.AIRPG_WIDGETS\.ModelessChooser\([\s\S]*?insert: insertTextIntoChatInputAtCursor/);
    assert.match(chooserSource, /this\.insert\(`\[\$\{name\}\]`\)/);
    assert.match(viewSource, /playerAbilitiesChooser\.choice\(content, abilityName\)/);
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
