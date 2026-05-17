const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');

test('prompt progress dock host is placed between chat log and input area', () => {
    const chatLogIndex = viewSource.indexOf('id="chatLog"');
    const dockIndex = viewSource.indexOf('id="promptProgressDock"');
    const inputAreaIndex = viewSource.indexOf('class="input-area"');

    assert.notEqual(chatLogIndex, -1, 'chat log should exist');
    assert.notEqual(dockIndex, -1, 'prompt progress dock should exist');
    assert.notEqual(inputAreaIndex, -1, 'input area should exist');
    assert.ok(chatLogIndex < dockIndex, 'dock should render after the chat log');
    assert.ok(dockIndex < inputAreaIndex, 'dock should render before the input area');
    assert.doesNotMatch(
        viewSource.slice(dockIndex, viewSource.indexOf('>', dockIndex)),
        /\shidden\b/,
        'prompt progress dock should remain visible even when no prompts are running'
    );
});

test('prompt progress dock supports persisted collapsed, one-line, and table states', () => {
    assert.match(chatSource, /airpg:promptProgressDockState/);
    assert.match(chatSource, /prompt-progress-dock--collapsed/);
    assert.match(chatSource, /prompt-progress-dock--one-line/);
    assert.match(chatSource, /prompt-progress-dock--table/);
    assert.match(chatSource, /getLongestRunningPromptProgressEntry/);
    assert.match(chatSource, /progressFraction/);
});

test('prompt progress dock mode controls use compress and expand icons without abort reload', () => {
    assert.match(chatSource, /assets\/material-icons\/misc\/compress\.svg/);
    assert.match(chatSource, /assets\/material-icons\/misc\/expand\.svg/);
    assert.match(chatSource, /createPromptProgressModeButton/);
    assert.doesNotMatch(chatSource, /Abort \+ Reload/);
    assert.doesNotMatch(chatSource, /cancelAllPromptsAndLoadLatestAutosave\(\{ triggerButton/);
});

test('one-line prompt tracker uses the progress fill as row background with compact stats', () => {
    assert.match(chatSource, /prompt-progress-dock__one-line-fill/);
    assert.match(chatSource, /formatPromptProgressApproxPercent/);
    assert.match(chatSource, /`~\$\{Math\.floor\(progressFraction \* 100\)\}%`/);
    assert.match(chatSource, /Math\.floor\(progressFraction \* 1000\) \/ 10/);
    assert.doesNotMatch(chatSource, /Math\.round\(progressFraction \* 100\)/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-fill/);
    assert.match(scssSource, /position:\s*absolute/);
    assert.match(scssSource, /inset:\s*0/);
});

test('one-line prompt tracker right-aligns white mode icons and softens idle state', () => {
    assert.match(chatSource, /const isIdle = !entry\?\.id/);
    assert.match(chatSource, /prompt-progress-dock__one-line-row--idle/);
    assert.match(chatSource, /if \(!isIdle\) \{/);
    assert.match(chatSource, /content\.appendChild\(modeControls\);/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-content > \.prompt-progress-dock__mode-controls/);
    assert.match(scssSource, /margin-left:\s*auto/);
    assert.match(scssSource, /filter:\s*brightness\(0\) invert\(1\)/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-row--idle \.prompt-progress-dock__one-line-label/);
    assert.match(scssSource, /font-style:\s*italic/);
});

test('prompt progress dock styles completed entries with a single pulse', () => {
    assert.match(chatSource, /entry\?\.isComplete === true/);
    assert.match(chatSource, /prompt-progress-dock__one-line-row--complete/);
    assert.match(chatSource, /prompt-progress-row-complete/);
    assert.match(chatSource, /prompt-progress-bar--complete/);
    assert.match(scssSource, /@keyframes prompt-progress-complete-pulse/);
    assert.match(scssSource, /animation:\s*prompt-progress-complete-pulse 250ms ease-out/);
});

test('prompt progress dock styles include 4px collapsed bar and 3-row table cap', () => {
    assert.match(scssSource, /\.prompt-progress-dock/);
    assert.match(scssSource, /\.prompt-progress-dock--collapsed/);
    assert.match(scssSource, /height:\s*4px/);
    assert.match(scssSource, /\.prompt-progress-dock--one-line/);
    assert.match(scssSource, /\.prompt-progress-dock--table/);
    assert.match(scssSource, /--prompt-progress-table-body-rows:\s*3/);
    assert.match(scssSource, /position:\s*sticky/);
});
