const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('chat sidebar template renders tracker section and hidden toggle', () => {
    const source = readRepoFile('views/index.njk');

    assert.match(source, /id="chatTrackersSection"/);
    assert.match(source, /id="chatTrackersHiddenToggle"/);
    assert.match(source, /id="chatTrackersList"/);
    assert.match(source, /let chatTrackersShowHidden = false;/);
    assert.match(source, /function renderChatTrackersPanel\(trackers = \[\]\)/);
    assert.match(source, /renderChatTrackersPanel\(Array\.isArray\(data\?\.trackers\) \? data\.trackers : \[\]\);/);
    assert.match(source, /renderChatTrackersPanel\(Array\.isArray\(window\.currentPlayerData\?\.trackers\) \? window\.currentPlayerData\.trackers : \[\]\);/);
});

test('chat sidebar tracker rows omit secondary metadata lines', () => {
    const source = readRepoFile('views/index.njk');

    assert.doesNotMatch(source, /chat-tracker-card__meta/);
    assert.doesNotMatch(source, /formatTrackerTypeLabel\(tracker\.type\)/);
    assert.doesNotMatch(source, /tracker\.lastUpdated/);
});

test('server attaches serialized trackers only to the player payload', () => {
    const source = readRepoFile('server.js');

    assert.match(source, /function serializeTrackersForClient\(\)/);
    assert.match(source, /Tracker\.getAll\(\)\.map\(tracker => tracker\.toClientJSON/);
    assert.match(source, /serialized\.trackers = serializeTrackersForClient\(\);/);
});

test('tracker sidebar styles are maintained in SCSS source', () => {
    const source = readRepoFile('public/css/main.scss');

    assert.match(source, /\.chat-trackers-section/);
    assert.match(source, /\.chat-trackers-hidden-toggle/);
    assert.match(source, /\.chat-tracker-card/);
    assert.match(source, /\.chat-tracker-card\.is-hidden-from-player/);
    assert.doesNotMatch(source, /\.chat-tracker-card__meta/);
});
