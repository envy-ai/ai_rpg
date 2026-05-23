const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const globalsSource = fs.readFileSync(path.join(rootDir, 'public', 'css', '_globals.scss'), 'utf8');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

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

test('prompt progress action buttons use white SVG icons on transparent chrome', () => {
    assert.match(chatSource, /view:\s*'\/assets\/material-icons\/misc\/view_prompt\.svg'/);
    assert.match(chatSource, /cancel:\s*'\/assets\/material-icons\/misc\/cancel\.svg'/);
    assert.match(chatSource, /restart:\s*'\/assets\/material-icons\/misc\/restart\.svg'/);
    assert.match(chatSource, /createPromptProgressActionIcon/);
    assert.match(chatSource, /prompt-progress-action__icon/);
    assert.doesNotMatch(chatSource, /viewButton\.textContent = '👁'/);
    assert.doesNotMatch(chatSource, /cancelButton\.textContent = '🗙'/);
    assert.doesNotMatch(chatSource, /retryButton\.textContent = '⟳'/);
    assert.match(scssSource, /\.prompt-progress-action\s*\{[\s\S]*border:\s*0/);
    assert.match(scssSource, /\.prompt-progress-action\s*\{[\s\S]*background:\s*transparent/);
    assert.match(scssSource, /\.prompt-progress-actions\s*\{[\s\S]*gap:\s*2px/);
    assert.match(scssSource, /\.prompt-progress-action\s*\{[\s\S]*&:hover,[\s\S]*&\.is-active\s*\{[\s\S]*opacity:\s*1/);
    assert.match(scssSource, /\.prompt-progress-action__icon\s*\{[\s\S]*filter:\s*brightness\(0\) invert\(1\)/);
    assert.match(scssSource, /&:hover:not\(:disabled\) \.prompt-progress-action__icon,[\s\S]*&\.is-active \.prompt-progress-action__icon\s*\{[\s\S]*drop-shadow\(0 0 4px rgba\(255, 255, 255, 0\.85\)\)/);
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

test('one-line prompt tracker puts prompt actions before the prompt label and shows additional prompt count', () => {
    assert.match(chatSource, /createPromptProgressOneLine\(entry,\s*\{\s*runningCount = 0\s*\} = \{\}\)/);
    assert.match(chatSource, /formatPromptProgressOneLineLabel\(entry,\s*runningCount\)/);
    assert.match(chatSource, /\(and \$\{extraCount\} more\)/);
    assert.ok(
        chatSource.indexOf('content.appendChild(this.createPromptProgressActions(entry || {}, null));')
            < chatSource.indexOf('content.appendChild(label);'),
        'one-line prompt action buttons should render before the prompt label'
    );
});

test('one-line prompt label uses a fixed 60 percent desktop width with medium-bold weight', () => {
    assert.match(scssSource, /\.prompt-progress-dock\s*\{[\s\S]*min-width:\s*0/);
    assert.match(scssSource, /\.prompt-progress-dock\s*\{[\s\S]*max-width:\s*100%/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-content\s*\{[\s\S]*max-width:\s*100%/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-content\s*\{[\s\S]*overflow:\s*hidden/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-label\s*\{[\s\S]*flex:\s*0 0 60%/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-label\s*\{[\s\S]*width:\s*60%/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-label\s*\{[\s\S]*max-width:\s*60%/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-label\s*\{[\s\S]*font-weight:\s*600/);
    assert.match(scssSource, /@media \(max-width: 900px\)[\s\S]*\.prompt-progress-dock__one-line-label\s*\{[\s\S]*flex:\s*1 1 auto/);
    assert.match(scssSource, /@media \(max-width: 900px\)[\s\S]*\.prompt-progress-dock__one-line-label\s*\{[\s\S]*width:\s*auto/);
});

test('main styles import Roboto and use it as the default font at normal width and weight', () => {
    assert.match(scssSource, /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto:ital,wdth,wght@0,75\.\.100,100\.\.900;1,75\.\.100,100\.\.900&display=swap'\);/);
    assert.match(globalsSource, /\$font-family:\s*"Roboto",/);
    assert.match(scssSource, /body\s*\{[\s\S]*font-family:\s*\$font-family/);
    assert.match(scssSource, /body\s*\{[\s\S]*font-weight:\s*400/);
    assert.match(scssSource, /body\s*\{[\s\S]*font-variation-settings:\s*"wdth" 100/);
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

test('multi-row prompt progress table omits target, average-output, run-count, and rate columns', () => {
    assert.doesNotMatch(chatSource, /<th>Target<\/th>/);
    assert.doesNotMatch(chatSource, /<th>Avg Out<\/th>/);
    assert.doesNotMatch(chatSource, /<th>Runs<\/th>/);
    assert.doesNotMatch(chatSource, /<th>Avg\/s<\/th>/);

    const rowStart = chatSource.indexOf('createPromptProgressTableRow(entry');
    const rowEnd = chatSource.indexOf('\n    createPromptProgressHeader', rowStart);
    assert.notEqual(rowStart, -1, 'table row renderer should exist');
    assert.notEqual(rowEnd, -1, 'table row renderer end should be locatable');
    const rowSource = chatSource.slice(rowStart, rowEnd);

    assert.doesNotMatch(rowSource, /formatPromptProgressTarget/);
    assert.doesNotMatch(rowSource, /formatPromptProgressOutputAverage/);
    assert.doesNotMatch(rowSource, /formatPromptProgressRunCount/);
    assert.doesNotMatch(rowSource, /formatPromptProgressAverage/);
});

test('prompt view action spawns persistent modeless prompt viewers', () => {
    const createActionsBlock = extractBlock(
        chatSource,
        'createPromptProgressActions(entry, row = null) {',
        'createPromptProgressTableRow(entry'
    );
    const syncViewerWindowBlock = extractBlock(
        chatSource,
        'syncPromptProgressViewerWindow(viewerState) {',
        'openPromptProgressViewer(promptId) {'
    );
    const createViewerBlock = extractBlock(
        chatSource,
        'createPromptProgressViewerWindow(viewerState) {',
        'syncPromptProgressViewerWindow(viewerState)'
    );

    assert.match(chatSource, /this\.promptProgressViewerWindows = new Map\(\)/);
    assert.match(chatSource, /this\.promptProgressViewerCounter = 0/);
    assert.match(createActionsBlock, /this\.openPromptProgressViewer\(entry\.id\)/);
    assert.doesNotMatch(createActionsBlock, /togglePromptProgressViewer/);
    assert.match(createViewerBlock, /viewer\.setAttribute\('role', 'dialog'\)/);
    assert.match(createViewerBlock, /viewer\.setAttribute\('aria-modal', 'false'\)/);
    assert.match(createViewerBlock, /closeButton\.addEventListener\('click', \(\) => this\.closePromptProgressViewer\(viewerState\.id\)\)/);
    assert.match(syncViewerWindowBlock, /viewerState\.lastEntry/);
    assert.doesNotMatch(syncViewerWindowBlock, /closePromptProgressViewer/);
    assert.match(scssSource, /\.prompt-progress-viewer\s*\{[\s\S]*pointer-events:\s*auto/);
});
