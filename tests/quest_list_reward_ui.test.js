const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');

function extractQuestCardSource() {
    const start = viewSource.indexOf('const createQuestCard =');
    const end = viewSource.indexOf('const renderQuestPanel =', start);
    assert.notEqual(start, -1, 'createQuestCard source not found');
    assert.notEqual(end, -1, 'renderQuestPanel source not found');
    return viewSource.slice(start, end);
}

test('quest list disposition rewards render chat-style icon pills without AI-only reasons', () => {
    const questCardSource = extractQuestCardSource();

    assert.match(viewSource, /function createQuestDispositionRewardPill\(/);
    assert.match(viewSource, /pill\.className = 'disposition-summary-row__pill quest-disposition-reward__pill';/);
    assert.match(viewSource, /pill\.textContent = `\$\{icon\}\$\{sign\}\$\{Math\.round\(delta\)\}`;/);
    assert.match(questCardSource, /createQuestDispositionRewardPill\(disposition\)/);
    assert.doesNotMatch(questCardSource, /disposition\.reason/);
});

test('quest list disposition rewards preview configured quest disposition deltas', () => {
    assert.match(viewSource, /function resolveQuestDispositionRewardDelta\(intensityValue\)/);
    assert.match(viewSource, /return -typicalBigStep;/);
    assert.match(viewSource, /const scaled = intensityValue \* typicalStep;/);
    assert.match(viewSource, /const scaled = \(intensityValue \/ 2\) \* typicalStep;/);
});

test('active quest cards expose manual completion and return to Adventure after success', () => {
    const questCardSource = extractQuestCardSource();

    assert.match(viewSource, /async function handleCompleteQuest\(quest, trigger\)/);
    assert.match(viewSource, /\/api\/quests\/\$\{encodeURIComponent\(quest\.id\)\}\/complete/);
    assert.match(viewSource, /await refreshAfterManualQuestCompletion\(\);/);
    assert.match(viewSource, /window\.activateTab\('adventure'\)/);
    assert.match(viewSource, /window\.location\.hash = '#tab-adventure'/);
    assert.match(questCardSource, /completeButton\.textContent = 'Mark Complete';/);
    assert.match(questCardSource, /actions\.appendChild\(completeButton\);/);
});
