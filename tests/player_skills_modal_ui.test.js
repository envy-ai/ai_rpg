const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('player skills modal is modeless and renders skills in the view-modal skill-card format', () => {
    assert.match(viewSource, /id="chatPlayerSkillsButton"/);
    assert.match(viewSource, /id="playerSkillsModal"[^>]*aria-modal="false"/);
    assert.doesNotMatch(
        extractBlock(viewSource, 'id="playerSkillsModal"', 'id="npcViewModal"'),
        /npcModalBackdrop|modal-backdrop/
    );
    assert.match(viewSource, /id="playerSkillsGrid"[^>]*class="skills-grid player-skills-grid"/);
    assert.match(viewSource, /function renderPlayerSkillsModalSkills\(player/);
    assert.match(viewSource, /card\.className = 'skill-card player-skills-card';/);
    assert.match(viewSource, /nameEl\.className = 'skill-name';/);
    assert.match(viewSource, /valueRow\.className = 'skill-value';/);
    assert.match(viewSource, /valueSpan\.className = 'skill-rank';/);
});

test('clicking a player skill inserts the bracketed skill name at the chat cursor', () => {
    assert.match(viewSource, /function insertTextIntoChatInputAtCursor\(text\)/);
    assert.match(viewSource, /messageInput\.selectionStart/);
    assert.match(viewSource, /messageInput\.selectionEnd/);
    assert.match(viewSource, /messageInput\.setRangeText\(insertText, start, end, 'end'\)/);
    assert.match(viewSource, /insertTextIntoChatInputAtCursor\(`\[\$\{name\}\]`\)/);
    assert.match(viewSource, /messageInput\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
});

test('player skills modal orders skills by rank, then alphabetically', () => {
    const skillEntriesBlock = extractBlock(
        viewSource,
        'function getPlayerSkillEntriesForModal(player = {})',
        'function insertTextIntoChatInputAtCursor(text)'
    );
    assert.match(skillEntriesBlock, /const rankDelta = left\.rank - right\.rank;/);
    assert.match(skillEntriesBlock, /if \(rankDelta !== 0\) \{\s*return rankDelta;\s*\}/);
    assert.match(skillEntriesBlock, /return left\.name\.localeCompare\(right\.name\);/);
});

test('S hotkey opens the skills modal without firing while typing', () => {
    assert.match(chatSource, /event\.key\.toLowerCase\(\) !== 'i'/);
    assert.match(viewSource, /event\.key\.toLowerCase\(\) !== 's'/);
    assert.match(viewSource, /activeElement\.closest\('input, textarea, select, \[contenteditable="true"\]'\)/);
    assert.match(viewSource, /chatSidebarElements\.skillsButton\.click\(\)/);
});

test('player skills modal has dedicated non-blurring styles', () => {
    assert.match(scssSource, /\.player-skills-modal\s+\.modal__dialog\s*\{/);
    assert.match(scssSource, /\.player-skills-grid\s*\{/);
    assert.match(scssSource, /\.player-skills-card\s*\{/);
    assert.doesNotMatch(
        extractBlock(scssSource, '.player-skills-modal .modal__dialog', '.npc-view-modal .modal__dialog'),
        /backdrop-filter/
    );
});
