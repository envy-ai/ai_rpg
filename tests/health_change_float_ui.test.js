const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');

test('health change float animation duration is five seconds in source styles', () => {
    assert.match(
        scssSource,
        /\.health-change-float\s*\{[\s\S]*animation:\s*health-change-float\s+5s\s+ease-out\s+forwards;/
    );
    assert.doesNotMatch(scssSource, /animation:\s*health-change-float\s+2\.5s\b/);
});

test('health change float lifetime follows the CSS animation end event', () => {
    assert.match(viewSource, /indicator\.className = 'health-change-float'/);
    assert.match(
        viewSource,
        /indicator\.addEventListener\('animationend',\s*\(\) => \{[\s\S]*indicator\.remove\(\);[\s\S]*\}, \{ once: true \}\);/
    );
});
