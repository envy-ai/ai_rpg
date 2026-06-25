const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
const modalDocsSource = fs.readFileSync(path.join(rootDir, 'docs', 'ui', 'modals_overlays.md'), 'utf8');

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

test('prompt progress ticks do not close the load/save modal', () => {
    const renderSource = extractMethod(chatSource, '\n    renderPromptProgress(entries = [])');

    assert.doesNotMatch(renderSource, /closeLoadGameModalIfOpen/);
    assert.doesNotMatch(renderSource, /closeLoadGameModal/);
    assert.doesNotMatch(renderSource, /loadGameModal/);
    assert.doesNotMatch(chatSource, /closeLoadGameModalIfOpen/);
});

test('prompt progress modal behavior is documented', () => {
    assert.doesNotMatch(modalDocsSource, /Auto-closes `#loadGameModal`/);
    assert.match(modalDocsSource, /does not close `#loadGameModal` while prompt progress updates render/i);
});
