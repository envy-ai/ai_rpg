const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(repoRoot, 'public', 'js', 'chat.js'), 'utf8');

function extractClassMethod(source, methodName) {
    const start = source.indexOf(`    ${methodName}(`) >= 0
        ? source.indexOf(`    ${methodName}(`)
        : source.indexOf(`    async ${methodName}(`);
    assert.notEqual(start, -1, `${methodName} should exist`);

    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `${methodName} should have parameters`);
    let parenDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(') {
            parenDepth += 1;
        } else if (char === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    assert.notEqual(paramsEnd, -1, `${methodName} should close parameters`);

    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `${methodName} should have body`);
    let braceDepth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            braceDepth += 1;
        } else if (char === '}') {
            braceDepth -= 1;
            if (braceDepth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to extract ${methodName}`);
}

test('chat request failures show an error popup instead of only adding a system entry', () => {
    const submitSource = extractClassMethod(chatSource, 'submitChatMessage');

    assert.match(chatSource, /showChatErrorPopup\(message\)\s*\{/);
    assert.match(chatSource, /alert\(`Chat error: \$\{text\}`\)/);
    assert.match(
        submitSource,
        /if\s*\(data\.error\)\s*\{[\s\S]*?const errorMessage\s*=\s*data\.error;[\s\S]*?this\.showChatErrorPopup\(errorMessage\);/,
        'server-returned chat errors should open the popup'
    );
    assert.match(
        submitSource,
        /catch\s*\(error\)\s*\{[\s\S]*?const errorMessage\s*=\s*`Connection error: \$\{error\.message\}`;[\s\S]*?this\.showChatErrorPopup\(errorMessage\);/,
        'network failures should open the popup'
    );
});
