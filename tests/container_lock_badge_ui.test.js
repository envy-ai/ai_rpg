const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function extractCssRule(source, selector) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, `expected ${selector} style rule`);
    return match[0];
}

test('locked container badge lock overlay is large enough to read', () => {
    const scssRule = extractCssRule(read('public/css/main.scss'), '.entity-image-badge__lock');
    const cssRule = extractCssRule(read('public/css/main.css'), '.entity-image-badge__lock');

    for (const rule of [scssRule, cssRule]) {
        assert.match(rule, /width:\s*62\.5%/);
        assert.match(rule, /height:\s*62\.5%/);
    }
});
