const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const viewSource = fs.readFileSync(path.join(repoRoot, 'views/index.njk'), 'utf8');
const chatSource = fs.readFileSync(path.join(repoRoot, 'public/js/chat.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(repoRoot, 'public/css/main.scss'), 'utf8');
const apiSource = fs.readFileSync(path.join(repoRoot, 'api.js'), 'utf8');

test('player prompt guidance book button is left of the existing chat controls', () => {
    const guidanceButtonIndex = viewSource.indexOf('id="playerPromptGuidanceButton"');
    const terminalButtonIndex = viewSource.indexOf('id="terminalOutputButton"');
    const stopButtonIndex = viewSource.indexOf('id="abortTurnButton"');
    const filterButtonIndex = viewSource.indexOf('id="chatBubbleFilterToggle"');

    assert.ok(guidanceButtonIndex >= 0);
    assert.ok(terminalButtonIndex > guidanceButtonIndex);
    assert.ok(stopButtonIndex > terminalButtonIndex);
    assert.ok(filterButtonIndex > stopButtonIndex);
    assert.match(
        viewSource,
        /playerPromptGuidanceButton[\s\S]*assets\/material-icons\/game-tab-icons\/book\.svg/
    );
    assert.match(scssSource, /\.player-prompt-guidance-button\s*\{[\s\S]*right:\s*136px/);
    assert.match(scssSource, /\.terminal-output-button\s*\{[\s\S]*right:\s*94px/);
    assert.match(scssSource, /\.abort-turn-button\s*\{[\s\S]*right:\s*52px/);
    assert.match(scssSource, /\.chat-bubble-filter-toggle\s*\{[\s\S]*right:\s*10px/);
});

test('player prompt guidance modal has accessible labeling and the requested empty-state example', () => {
    assert.match(
        viewSource,
        /id="playerPromptGuidanceModal"[\s\S]*role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby="playerPromptGuidanceTitle"/
    );
    assert.match(viewSource, /id="playerPromptGuidanceTitle">Player Prompt Guidance<\/h2>/);
    assert.match(
        viewSource,
        /id="playerPromptGuidanceInput"[\s\S]*placeholder="I would like dungeons to contain more hostile creatures\."/
    );
    assert.match(viewSource, /id="playerPromptGuidanceStatus"[\s\S]*role="status"[\s\S]*aria-live="polite"/);
    assert.match(viewSource, /id="playerPromptGuidanceCancelBtn">Cancel<\/button>/);
    assert.match(viewSource, /id="playerPromptGuidanceSaveBtn">Save<\/button>/);
});

test('player prompt guidance controller loads fresh data, saves updates, and supports modal dismissal', () => {
    assert.match(chatSource, /fetch\('\/api\/player\/prompt-guidance', \{ cache: 'no-store' \}\)/);
    assert.match(chatSource, /fetch\('\/api\/player\/prompt-guidance', \{[\s\S]*method: 'PUT'/);
    assert.match(chatSource, /guidance: this\.playerPromptGuidanceInput\.value/);
    assert.match(chatSource, /this\.playerPromptGuidanceCloseButton\.addEventListener\('click', close\)/);
    assert.match(chatSource, /this\.playerPromptGuidanceCancelButton\.addEventListener\('click', close\)/);
    assert.match(chatSource, /event\.target === this\.playerPromptGuidanceModal/);
    assert.match(chatSource, /event\.key === 'Escape'/);
    assert.match(chatSource, /this\.trapPlayerPromptGuidanceFocus\(event\)/);
    assert.match(chatSource, /document\.body\.classList\.add\('modal-open'\)/);
    assert.match(chatSource, /this\.syncBodyModalOpenClass\(\)/);
    assert.match(chatSource, /await this\.refreshChatHistory\(\)/);
});

test('guidance update notices render as System, remain literal, and have a readable filter label', () => {
    assert.match(viewSource, /message\.type == 'player-prompt-guidance'[\s\S]*📝 System/);
    assert.match(chatSource, /'player-prompt-guidance': 'Player Prompt Guidance'/);
    assert.match(chatSource, /const shouldBypassMarkdown = entry\.type === 'player-prompt-guidance'/);
});

test('player prompt guidance API requires a loaded location and broadcasts its persisted notice', () => {
    assert.match(apiSource, /app\.get\('\/api\/player\/prompt-guidance'/);
    assert.match(apiSource, /app\.put\('\/api\/player\/prompt-guidance'/);
    assert.match(apiSource, /Globals\.gameLoaded !== true/);
    assert.match(apiSource, /gameLocations\.get\(locationId\)/);
    assert.match(apiSource, /Globals\.emitToClient\(null, 'chat_history_updated'/);
    assert.match(apiSource, /player:\s*serializeNpcForClient\(currentPlayer\)/);
    assert.match(apiSource, /entry:\s*result\.entry/);
});
