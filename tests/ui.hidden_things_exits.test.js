const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('location UI includes matching hidden toggles and filters hidden records by default', () => {
    const source = fs.readFileSync(path.join(root, 'views/index.njk'), 'utf8');
    assert.match(source, /id="toggleHiddenExitsButton"[^>]+aria-pressed="false"/);
    assert.match(source, /id="toggleHiddenThingsButton"[^>]+aria-pressed="false"/);
    assert.match(source, /exit\?\.hiddenFromPlayer !== true \|\| locationExitsShowHidden/);
    assert.match(source, /thing\.hiddenFromPlayer !== true \|\| locationThingsShowHidden/);
    assert.match(source, /travelButton\.disabled = exit\.hiddenFromPlayer === true/);
    assert.match(source, /card\.draggable = thing\.hiddenFromPlayer !== true/);
});

test('show-hidden Thing and exit rows use exactly 90 percent opacity', () => {
    const source = fs.readFileSync(path.join(root, 'public/css/main.scss'), 'utf8');
    assert.match(source, /\.exit-item\.is-hidden-from-player,\s*\.location-entity-card\.is-hidden-from-player,\s*\.thing-collection-entry\.is-hidden-from-player\s*\{\s*opacity:\s*0\.9;/);
});
