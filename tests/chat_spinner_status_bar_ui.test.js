const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(rootDir, 'public', 'css', 'main.scss'), 'utf8');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');

function extractMethod(source, signature) {
    const start = source.indexOf(signature);
    assert.notEqual(start, -1, `${signature} should exist`);
    const bodyOpenMarker = source.indexOf(') {', start);
    assert.notEqual(bodyOpenMarker, -1, `${signature} should have a body`);
    const bodyStart = bodyOpenMarker + 2;

    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    assert.fail(`${signature} body should close`);
}

test('chat spinner status bar is placed between prompt progress dock and input area', () => {
    const dockIndex = viewSource.indexOf('id="promptProgressDock"');
    const statusIndex = viewSource.indexOf('id="chatSpinnerStatusBar"');
    const inputAreaIndex = viewSource.indexOf('class="input-area"');

    assert.notEqual(dockIndex, -1, 'prompt progress dock should exist');
    assert.notEqual(statusIndex, -1, 'chat spinner status bar should exist');
    assert.notEqual(inputAreaIndex, -1, 'input area should exist');
    assert.ok(dockIndex < statusIndex, 'status bar should render after the prompt progress dock');
    assert.ok(statusIndex < inputAreaIndex, 'status bar should render before the input area');
    assert.match(viewSource, /id="chatSpinnerStatusBar"[^>]*hidden/);
    assert.match(viewSource, /id="chatSpinnerStatusBar"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(viewSource, /id="chatSpinnerStatusSpinner"/);
    assert.match(viewSource, /id="chatSpinnerStatusText"/);
});

test('spinner status API updates the inline non-modal status bar instead of the overlay backdrop', () => {
    assert.doesNotMatch(viewSource, /id="locationOverlay"/);
    assert.match(viewSource, /const chatSpinnerStatusBar = document\.getElementById\('chatSpinnerStatusBar'\)/);
    assert.match(viewSource, /function showLocationOverlay\(message = 'Loading location\.\.\.'\)/);
    assert.match(viewSource, /chatSpinnerStatusBar\.hidden = false/);
    assert.match(viewSource, /chatSpinnerStatusBar\.classList\.add\('is-visible'\)/);
    assert.match(viewSource, /function hideLocationOverlay\(\)/);
    assert.match(viewSource, /chatSpinnerStatusBar\.hidden = true/);
    assert.doesNotMatch(viewSource, /locationOverlay\.classList\.add\('show'\)/);
    assert.doesNotMatch(viewSource, /locationOverlay\.classList\.remove\('show'\)/);
});

test('spinner status bar styling is compact and non-blocking', () => {
    assert.match(scssSource, /\.chat-spinner-status-bar\s*\{/);
    assert.match(scssSource, /display:\s*none/);
    assert.match(scssSource, /\.chat-spinner-status-bar\.is-visible\s*\{/);
    assert.match(scssSource, /display:\s*flex/);
    assert.match(scssSource, /pointer-events:\s*none/);
    assert.match(scssSource, /font-style:\s*italic/);
    assert.match(scssSource, /\.chat-spinner-status-bar__spinner\s*\{/);
    assert.match(scssSource, /animation:\s*spin 0\.8s linear infinite/);
});

test('request-scoped chat status messages render in the spinner status bar', () => {
    const updateStatusMessageSource = extractMethod(chatSource, 'updateStatusMessage(requestId, message');
    const showLoadingSource = extractMethod(chatSource, 'showLoading(requestId, message');
    const removeStatusMessageSource = extractMethod(chatSource, 'removeStatusMessage(requestId)');

    assert.match(chatSource, /showRequestStatusSpinner\(requestId, message/);
    assert.match(updateStatusMessageSource, /this\.showRequestStatusSpinner\(requestId, message, \{\s*stage,\s*scope\s*\}\)/);
    assert.doesNotMatch(updateStatusMessageSource, /createStatusElement/);
    assert.doesNotMatch(chatSource, /status-update/);
    assert.doesNotMatch(chatSource, /streamingStatusElements/);
    assert.match(showLoadingSource, /this\.updateStatusMessage\(requestId, message, \{ stage: 'loading' \}\)/);
    assert.match(removeStatusMessageSource, /this\.hideRequestStatusSpinner\(requestId\)/);
});
