const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

test('Story Tools exposes inner tabs for history and mystery boxes', () => {
    assert.match(viewSource, /class="story-tools-tab-list"/);
    assert.match(viewSource, /id="storyToolsHistoryTab"/);
    assert.match(viewSource, /aria-controls="storyToolsHistoryPanel"/);
    assert.match(viewSource, /id="storyToolsMysteryBoxesTab"/);
    assert.match(viewSource, /aria-controls="storyToolsMysteryBoxesPanel"/);
    assert.match(viewSource, /id="storyToolsHistoryPanel"/);
    assert.match(viewSource, /id="storyToolsMysteryBoxesPanel"/);
});

test('Mystery Boxes panel has a selectable list and editable detail form', () => {
    assert.match(viewSource, /id="mysteryThreadsList"/);
    assert.match(viewSource, /id="mysteryThreadForm"/);
    assert.match(viewSource, /id="mysteryThreadNameInput"/);
    assert.match(viewSource, /id="mysteryThreadStatusSelect"/);
    assert.match(viewSource, /id="mysteryThreadSummaryInput"/);
    assert.match(viewSource, /id="mysteryThreadConstraintsInput"/);
    assert.match(viewSource, /id="mysteryThreadBoxesList"/);
    assert.match(viewSource, /id="mysteryBoxesList"/);
    assert.match(viewSource, /id="mysteryBoxesEmpty"/);
    assert.match(viewSource, /id="mysteryBoxDetailEmpty"/);
    assert.match(viewSource, /id="mysteryBoxForm"/);
    assert.match(viewSource, /class="mystery-box-edit-column"/);
    assert.match(viewSource, /class="mystery-box-mentions-column"/);
    assert.match(viewSource, /id="mysteryBoxNameInput"/);
    assert.match(viewSource, /id="mysteryBoxKeysInput"/);
    assert.match(viewSource, /id="mysteryBoxTextInput"/);
    assert.match(viewSource, /id="mysteryBoxSaveButton"/);
    assert.match(viewSource, /id="mysteryBoxStatus"/);
});

test('Mystery Boxes UI fetches list/detail data and saves edits through JSON API routes', () => {
    assert.match(viewSource, /refreshMysteryThreads\s*=\s*async/);
    assert.match(viewSource, /fetch\('\/api\/mystery-threads'/);
    assert.match(viewSource, /fetch\(`\/api\/mystery-threads\/\$\{encodeURIComponent\(threadId\)\}`/);
    assert.match(viewSource, /fetch\(`\/api\/mystery-threads\/\$\{encodeURIComponent\(selectedThreadId\)\}`/);
    assert.match(viewSource, /refreshMysteryBoxes\s*=\s*async/);
    assert.match(viewSource, /fetch\('\/api\/mystery-boxes'/);
    assert.match(viewSource, /fetch\(`\/api\/mystery-boxes\/\$\{encodeURIComponent\(boxId\)\}`/);
    assert.match(viewSource, /method:\s*'PUT'/);
    assert.match(viewSource, /JSON\.stringify\(\{\s*name,/);
    assert.match(viewSource, /window\.refreshMysteryBoxes\s*=\s*refreshMysteryBoxes/);
});

test('Mystery box API routes support sorted list, exact fetch, and updates', () => {
    assert.match(apiSource, /app\.get\('\/api\/mystery-threads'/);
    assert.match(apiSource, /app\.get\('\/api\/mystery-threads\/:id'/);
    assert.match(apiSource, /app\.put\('\/api\/mystery-threads\/:id'/);
    assert.match(apiSource, /app\.put\('\/api\/mystery-threads\/:id\/boxes'/);
    assert.match(apiSource, /app\.get\('\/api\/mystery-boxes'/);
    assert.match(apiSource, /app\.get\('\/api\/mystery-boxes\/:id'/);
    assert.match(apiSource, /app\.put\('\/api\/mystery-boxes\/:id'/);
    assert.match(apiSource, /localeCompare\(.*sensitivity:\s*'base'/s);
    assert.match(apiSource, /MysteryBox\.getById\(mysteryBoxId\)/);
    assert.match(apiSource, /box\.applyManualEdit\(\{/);
});

test('Mystery Boxes panel has scoped styling hooks', () => {
    assert.match(scssSource, /\.story-tools-tab-list/);
    assert.match(scssSource, /\.story-tools-tab-button/);
    assert.match(scssSource, /\.mystery-boxes-layout/);
    assert.match(scssSource, /\.mystery-threads-list/);
    assert.match(scssSource, /\.mystery-thread-form/);
    assert.match(scssSource, /\.mystery-thread-boxes/);
    assert.match(scssSource, /\.mystery-box-detail-layout\s*\{[^}]*display:\s*grid/s);
    assert.match(scssSource, /\.mystery-box-edit-column/);
    assert.match(scssSource, /\.mystery-box-mentions-column/);
    assert.doesNotMatch(scssSource, /\.mystery-box-detail-layout\s*\{[^}]*display:\s*flex/s);
    assert.match(scssSource, /\.mystery-boxes-list/);
    assert.match(scssSource, /\.mystery-box-list-button/);
    assert.match(scssSource, /\.mystery-box-form/);
});
