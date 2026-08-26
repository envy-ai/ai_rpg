const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const viewSource = fs.readFileSync(path.join(repoRoot, 'views/index.njk'), 'utf8');
const chatSource = fs.readFileSync(path.join(repoRoot, 'public/js/chat.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(repoRoot, 'public/css/main.scss'), 'utf8');
const serverSource = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(repoRoot, 'api.js'), 'utf8');

test('terminal button sits immediately before Stop and uses a terminal icon', () => {
    const terminalButtonIndex = viewSource.indexOf('id="terminalOutputButton"');
    const stopButtonIndex = viewSource.indexOf('id="abortTurnButton"');

    assert.ok(terminalButtonIndex >= 0);
    assert.ok(stopButtonIndex > terminalButtonIndex);
    assert.match(viewSource, /terminalOutputButton[\s\S]*material-icons\/misc\/terminal\.svg/);
    assert.match(scssSource, /\.terminal-output-button\s*\{[\s\S]*right:\s*94px/);
});

test('terminal viewer selects AI RPG or managed llama output and follows by default', () => {
    assert.match(chatSource, /this\.terminalOutputSource = 'llama'/);
    assert.match(chatSource, /airpgOption\.value = 'airpg'/);
    assert.match(chatSource, /llamaOption\.value = 'llama'/);
    assert.match(chatSource, /this\.terminalOutputFollow = true/);
    assert.match(chatSource, /Follow current terminal output/);
    assert.match(chatSource, /fetch\(`\/api\/terminal-output\?\$\{query\.toString\(\)\}`/);
    assert.match(chatSource, /this\.scrollPromptProgressViewerToBottom\(viewer\)/);
    assert.match(scssSource, /\.terminal-output-viewer\s*\{[\s\S]*width:\s*min\(920px, 70vw\)[\s\S]*height:\s*min\(620px, 72vh\)/);
});

test('terminal viewer preserves text selection across polling updates', () => {
    assert.match(chatSource, /if \(currentText === nextText\) \{\s*return false;/);
    assert.match(chatSource, /textNode\.appendData\(update\.appendedText\)/);
    assert.match(chatSource, /textNode\.deleteData\(0, removedPrefixLength\)/);
    assert.match(chatSource, /this\.terminalOutputSelectionPointerActive/);
    assert.match(chatSource, /!this\.selectableTextElementHasSelection\(output\)/);
    assert.match(chatSource, /scrollTerminalOutputViewerToBottom\(viewer, output\)/);
});

test('server keeps AI RPG and managed llama terminal capture paths separate', () => {
    assert.match(apiSource, /app\.get\('\/api\/terminal-output'/);
    assert.match(serverSource, /source === 'airpg'[\s\S]*airpgTerminalCapture\.outputBuffer\.read\(cursor\)/);
    assert.match(serverSource, /source === 'llama'[\s\S]*localLlamaServerProcess\.getOutputSnapshot\(cursor\)/);
    assert.match(serverSource, /writeStdout:\s*chunk =>[\s\S]*writeStdoutPassthrough\(chunk\)/);
    assert.match(serverSource, /writeStderr:\s*chunk =>[\s\S]*writeStderrPassthrough\(chunk\)/);
});
