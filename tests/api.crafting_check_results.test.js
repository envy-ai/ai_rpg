const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
const craftingDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'crafting.md'), 'utf8');
const locationsDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'locations.md'), 'utf8');
const commonDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'common.md'), 'utf8');
const chatDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ui', 'chat_interface.md'), 'utf8');

function getRouteSource(startNeedle, endNeedle) {
    const start = apiSource.indexOf(startNeedle);
    const end = apiSource.indexOf(endNeedle, start);

    assert.notEqual(start, -1, `Could not locate ${startNeedle}`);
    assert.notEqual(end, -1, `Could not locate route following ${startNeedle}`);

    return apiSource.slice(start, end);
}

test('craft-style action outcomes are recorded through check-results entries', () => {
    assert.match(apiSource, /function recordActionOutcomeCheckResultsEntry\(\{/);
    assert.match(apiSource, /createCheckResultsRecorder\(\{[\s\S]*parentId[\s\S]*\}\);/);
    assert.match(apiSource, /name: 'resolveSkillCheck'[\s\S]*phase: 'completed'/);

    const craftRoute = getRouteSource(
        "        app.post('/api/craft'",
        "        app.post('/api/locations/:id/modify'"
    );
    assert.match(craftRoute, /recordActionOutcomeCheckResultsEntry\(\{[\s\S]*promptLabel: craftCheckLabel/);
    assert.doesNotMatch(craftRoute, /recordSkillCheckEntry\(/);

    const locationModifyRoute = getRouteSource(
        "        app.post('/api/locations/:id/modify'",
        '        // ==================== LOCATION GENERATION FUNCTIONALITY'
    );
    assert.match(locationModifyRoute, /recordActionOutcomeCheckResultsEntry\(\{[\s\S]*promptLabel: 'Location Modification'/);
    assert.doesNotMatch(locationModifyRoute, /recordSkillCheckEntry\(/);
});

test('docs describe craft and location modification check-results output', () => {
    assert.match(commonDocs, /Craft\/process\/salvage\/harvest and location-modification success-degree outcomes also use this shape/);
    assert.match(craftingDocs, /success-degree outcomes are recorded as visible prompt-excluded `check-results` chat entries/);
    assert.match(locationsDocs, /prompt-excluded `check-results` success-degree entry/);
    assert.match(chatDocs, /Craft\/process\/salvage\/harvest and location-modification success-degree outcomes are also recorded as `check-results`/);
});
