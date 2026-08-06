const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const headCommonSource = fs.readFileSync(path.join(rootDir, 'views', '_includes', 'head-common.njk'), 'utf8');
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

test('prompt progress updates the favicon with a dark blue bottom-to-top active prompt fill', () => {
    assert.match(headCommonSource, /<link rel="icon" href="\/assets\/fluentui-emoji\/crossed_swords_color_classic\.svg" type="image\/svg\+xml">/);
    assert.match(chatSource, /this\.promptProgressFaviconOriginalHref/);
    assert.match(chatSource, /this\.promptProgressFaviconFillColor = '#0f3d7a'/);
    assert.match(chatSource, /updatePromptProgressFavicon\(this\.promptProgressEntries\)/);
    assert.match(chatSource, /restorePromptProgressFavicon\(\)/);
    assert.match(chatSource, /getLongestRunningPromptProgressEntry\(entries\)/);
    assert.match(chatSource, /const fillHeight = iconSize \* safeProgressFraction/);
    assert.match(chatSource, /context\.fillRect\(0, iconSize - fillHeight, iconSize, fillHeight\)/);
    assert.match(chatSource, /favicon\.href = canvas\.toDataURL\('image\/png'\)/);
});

test('chat controls expose stop-and-undo independently from prompt dock mode controls', () => {
    assert.match(chatSource, /assets\/material-icons\/misc\/compress\.svg/);
    assert.match(chatSource, /assets\/material-icons\/misc\/expand\.svg/);
    assert.match(chatSource, /createPromptProgressModeButton/);
    assert.match(viewSource, /id="abortTurnButton"/);
    assert.match(viewSource, /class="abort-turn-icon" aria-hidden="true">🛑<\/span>/);
    assert.match(viewSource, /id="abortTurnButton"[\s\S]*aria-label="Stop all prompts and restore the latest autosave"/);
    assert.ok(
        viewSource.indexOf('id="abortTurnButton"') < viewSource.indexOf('id="chatBubbleFilterToggle"'),
        'stop-and-undo should render immediately before the chat visibility control'
    );
    assert.match(chatSource, /cancelAllPromptsAndLoadLatestAutosave\(\{ triggerButton = this\.abortTurnButton \} = \{\}\)/);
    assert.match(chatSource, /fetch\('\/api\/turn\/cancel-and-rollback'/);
    assert.match(scssSource, /\.abort-turn-button\s*\{/);
    assert.match(scssSource, /\.abort-turn-button\s*\{[\s\S]*right:\s*52px[\s\S]*width:\s*34px[\s\S]*height:\s*34px/);
    assert.doesNotMatch(chatSource, /triggerButton\.textContent = 'Stopping…'/);
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
    assert.match(scssSource, /\.prompt-progress-dock__one-line-row--idle\s+\.prompt-progress-dock__one-line-label/);
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
    assert.match(scssSource, /@import url\(["']https:\/\/fonts\.googleapis\.com\/css2\?family=Roboto:ital,wdth,wght@0,75\.\.100,100\.\.900;1,75\.\.100,100\.\.900&display=swap["']\);/);
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

test('completed prompt progress bypasses render throttling before the clear update', () => {
    const progressHandlerBlock = extractBlock(
        chatSource,
        'handlePromptProgress(payload) {',
        'handlePromptProgressGroupFailure(payload) {'
    );

    assert.match(progressHandlerBlock, /entries\.some\(entry => entry\?\.isComplete === true\)/);
    assert.match(progressHandlerBlock, /schedulePromptProgressRender\(entries, \{ force: hasCompletedEntry \}\)/);
});

test('grouped tinybrain progress keeps one blue waiting bar between active stages', () => {
    assert.match(chatSource, /entry\?\.isGroupWaiting === true/);
    assert.match(chatSource, /prompt-progress-bar--group-waiting/);
    assert.match(chatSource, /prompt-progress-dock__one-line-row--group-waiting/);
    assert.match(chatSource, /prompt-progress-row-group-waiting/);
    assert.match(chatSource, /modal__prompt-progress--group-waiting/);
    assert.match(chatSource, /if \(isGroupWaiting\) \{[\s\S]*cancelButton\.disabled = true;[\s\S]*retryButton\.disabled = true;/);
    assert.match(scssSource, /\.prompt-progress-bar--group-waiting \.prompt-progress-bar__fill\s*\{[\s\S]*#3b82f6/);
    assert.match(scssSource, /\.prompt-progress-dock__one-line-row--group-waiting[\s\S]*rgba\(59, 130, 246/);
    assert.match(scssSource, /\.modal__prompt-progress--group-waiting \.modal__prompt-progress-fill\s*\{[\s\S]*#3b82f6/);
    const exactPercentBlock = extractBlock(
        chatSource,
        'formatPromptProgressPercent(entry) {',
        'formatPromptProgressApproxPercent(entry) {'
    );
    const approximatePercentBlock = extractBlock(
        chatSource,
        'formatPromptProgressApproxPercent(entry) {',
        'clearPendingPromptProgressRender() {'
    );
    assert.doesNotMatch(exactPercentBlock, /isGroupWaiting|waiting/);
    assert.doesNotMatch(approximatePercentBlock, /isGroupWaiting|waiting/);
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

test('running prompt model names use the shared ten-character display formatter', () => {
    const formatterBlock = extractBlock(
        chatSource,
        'formatPromptProgressModelName(modelName) {',
        'formatPromptProgressPercent(entry) {'
    );
    const rowBlock = extractBlock(
        chatSource,
        'createPromptProgressTableRow(entry',
        'createPromptProgressHeader'
    );
    const viewerBlock = extractBlock(
        chatSource,
        'syncPromptProgressViewerWindow(viewerState) {',
        'syncPromptProgressViewers() {'
    );

    assert.match(formatterBlock, /characters\.length > 10/);
    assert.match(formatterBlock, /characters\.slice\(0, 10\)\.join\(''\)/);
    assert.match(formatterBlock, /`\$\{characters\.slice\(0, 10\)\.join\(''\)\}\.\.\.`/);
    assert.match(rowBlock, /formatPromptProgressModelName\(fullModelName\)/);
    assert.match(rowBlock, /modelCell\.title = fullModelName/);
    assert.match(viewerBlock, /formatPromptProgressModelName\(fullModelName\)/);
    assert.match(viewerBlock, /subtitle\.title = fullModelName/);
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
    assert.match(chatSource, /followStream:\s*true/);
    assert.match(createViewerBlock, /closeButton\.addEventListener\('click', \(\) => this\.closePromptProgressViewer\(viewerState\.id\)\)/);
    assert.match(syncViewerWindowBlock, /viewerState\.lastEntry/);
    assert.match(syncViewerWindowBlock, /getPromptProgressEntryForGroup\(progressGroupId\)/);
    assert.match(syncViewerWindowBlock, /viewerState\.promptId = liveEntry\.id/);
    assert.match(syncViewerWindowBlock, /viewerState\.progressGroupId = liveEntry\.progressGroupId \|\| progressGroupId/);
    assert.doesNotMatch(syncViewerWindowBlock, /closePromptProgressViewer/);
    assert.match(scssSource, /\.prompt-progress-viewer\s*\{[\s\S]*pointer-events:\s*auto/);
    assert.match(scssSource, /\.prompt-progress-viewer__prompt-inline\s*\{[\s\S]*color:\s*#fcd34d/);
    assert.match(scssSource, /\.prompt-progress-viewer__response-inline\s*\{[\s\S]*color:\s*#67e8f9/);
    assert.match(chatSource, /failedResponses[\s\S]*\(empty response\)/);
    assert.match(chatSource, /entry\.responseFailed === true \? '' : renderedResponseText/);
    assert.match(chatSource, /case 'prompt_progress_group_failure':[\s\S]*handlePromptProgressGroupFailure\(payload\)/);
    assert.match(chatSource, /handlePromptProgressGroupFailure\(payload\)[\s\S]*failedResponses:\s*\[\.\.\.failedResponses\]/);
    assert.match(scssSource, /\.prompt-progress-viewer__failed-response-inline\s*\{[\s\S]*color:\s*#fca5a5/);
});

test('open modals mirror the prompt-progress aggregate as a thin bottom bar', () => {
    const updateBlock = extractBlock(
        chatSource,
        'updateModalPromptProgressBars() {',
        'setupModalPromptProgressObserver() {'
    );
    const observerBlock = extractBlock(
        chatSource,
        'setupModalPromptProgressObserver() {',
        'ensurePromptProgressFavicon() {'
    );

    // Bar reflects the same aggregate fraction used by the chat dock and only
    // shows while a prompt is active.
    assert.match(updateBlock, /getPromptProgressAggregateFraction\(entries\)/);
    assert.match(updateBlock, /\.modal\[aria-hidden="false"\] \.modal__dialog/);
    assert.match(updateBlock, /modal__prompt-progress-fill/);
    assert.match(updateBlock, /modal__prompt-progress--group-waiting/);
    assert.match(updateBlock, /bar\.remove\(\)/);

    // Rendering the dock also refreshes modal bars, and modal open/close is observed.
    assert.match(chatSource, /this\.updateModalPromptProgressBars\(\);/);
    assert.match(chatSource, /this\.setupModalPromptProgressObserver\(\);/);
    assert.match(observerBlock, /attributeFilter:\s*\['aria-hidden', 'hidden'\]/);

    // Styling exists for the injected bar.
    assert.match(scssSource, /\.modal__prompt-progress\s*\{[\s\S]*height:\s*4px/);
    assert.match(scssSource, /\.modal__prompt-progress-fill\s*\{/);
});
