const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

test('Story Tools exposes a Scene Summaries inner tab and editor panel', () => {
    assert.match(viewSource, /id="storyToolsSceneSummariesTab"/);
    assert.match(viewSource, /aria-controls="storyToolsSceneSummariesPanel"/);
    assert.match(viewSource, /id="storyToolsSceneSummariesPanel"/);
    assert.match(viewSource, /id="sceneSummariesList"/);
    assert.match(viewSource, /id="sceneSummariesEmpty"/);
    assert.match(viewSource, /id="sceneSummaryDetailEmpty"/);
    assert.match(viewSource, /id="sceneSummaryForm"/);
    assert.match(viewSource, /id="sceneSummaryMeta"/);
    assert.match(viewSource, /id="sceneSummaryTextInput"/);
    assert.match(viewSource, /id="sceneSummaryDetailsInput"/);
    assert.match(viewSource, /id="sceneSummaryQuotesInput"/);
    assert.match(viewSource, /id="sceneSummarySaveButton"/);
    assert.match(viewSource, /id="sceneSummaryStatus"/);
});

test('Scene Summaries UI fetches list data and saves edits through JSON API routes', () => {
    assert.match(viewSource, /refreshSceneSummaries\s*=\s*async/);
    assert.match(viewSource, /fetch\('\/api\/scene-summaries'/);
    assert.match(viewSource, /fetch\(`\/api\/scene-summaries\/\$\{encodeURIComponent\(selectedSceneNumber\)\}`/);
    assert.match(viewSource, /method:\s*'PUT'/);
    assert.match(viewSource, /parseSceneSummaryQuoteLines/);
    assert.match(viewSource, /JSON\.stringify\(\{\s*summary,/);
    assert.match(viewSource, /window\.refreshSceneSummaries\s*=\s*refreshSceneSummaries/);
});

test('Scene Summary API routes support list and update with current-save persistence', () => {
    assert.match(apiSource, /app\.get\('\/api\/scene-summaries'/);
    assert.match(apiSource, /app\.put\('\/api\/scene-summaries\/:index'/);
    assert.match(apiSource, /updateSceneAtDisplayIndex\(/);
    assert.match(apiSource, /persistSceneSummariesToCurrentSave/);
    assert.match(apiSource, /sceneSummaries\.json/);
});

test('Scene Summaries panel has scoped styling hooks', () => {
    assert.match(scssSource, /\.scene-summaries-layout/);
    assert.match(scssSource, /\.scene-summaries-list-pane/);
    assert.match(scssSource, /\.scene-summaries-list/);
    assert.match(scssSource, /\.scene-summary-list-button/);
    assert.match(scssSource, /\.scene-summary-detail-pane/);
    assert.match(scssSource, /\.scene-summary-form/);
    assert.match(scssSource, /\.scene-summary-form-row/);
    assert.match(scssSource, /\.scene-summary-status/);
});
