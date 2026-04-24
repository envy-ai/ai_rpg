const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');

test('direct player moves refresh chat history so arrival-only reunion prose appears immediately', () => {
    assert.match(
        viewSource,
        /fetch\('\/api\/player\/move'[\s\S]*?await window\.updateLocationDisplay\(result\.location\);[\s\S]*?await window\.AIRPG_CHAT\?\.refreshChatHistory\?\.\(\);[\s\S]*?await window\.refreshStoryTools\?\.\(\{ preserveSelection: true \}\);/
    );
});

test('player teleports refresh chat history after location updates', () => {
    assert.match(
        viewSource,
        /if \(updatedNpc && !updatedNpc\.isNPC\) \{[\s\S]*?await window\.AIRPG_CHAT\?\.refreshChatHistory\?\.\(\);[\s\S]*?await window\.refreshStoryTools\?\.\(\{ preserveSelection: true \}\);[\s\S]*?\}/
    );
});
