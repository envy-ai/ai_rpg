const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');

test('Adventure tab exposes horizontal resize handles for location and party panels', () => {
    assert.match(viewSource, /id="adventureLocationResizeHandle"/);
    assert.match(viewSource, /id="adventurePartyResizeHandle"/);
    assert.match(viewSource, /role="separator"/);
    assert.match(viewSource, /aria-orientation="vertical"/);
    assert.match(viewSource, /data-adventure-resize-target="location"/);
    assert.match(viewSource, /data-adventure-resize-target="party"/);
});

test('Adventure panel resizing has persisted width variables and desktop-only handles', () => {
    assert.match(viewSource, /initializeAdventurePanelResizing/);
    assert.match(viewSource, /aiRpg\.adventurePanelWidths/);
    assert.match(viewSource, /--adventure-location-width/);
    assert.match(viewSource, /--adventure-party-width/);
    assert.match(scssSource, /\.adventure-resize-handle/);
    assert.match(scssSource, /cursor:\s*col-resize/);
    assert.match(scssSource, /max-width:\s*900px[\s\S]*\.adventure-resize-handle[\s\S]*display:\s*none/);
});
