const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');

function loadQuestRewardSummaryHelper() {
    const start = apiSource.indexOf('        const getQuestRewardSummaryLines = (rewardEntry) => {');
    const end = apiSource.indexOf('\n\n        const normalizeTravelMetadata', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate the quest reward summary helper in api.js.');
    }

    const context = { Array, Error, TypeError };
    vm.createContext(context);
    vm.runInContext(
        `${apiSource.slice(start, end)}\nthis.getQuestRewardSummaryLines = getQuestRewardSummaryLines;`,
        context
    );
    return context.getQuestRewardSummaryLines;
}

test('quest completion summaries use authoritative reward lines instead of generated prose', () => {
    const getQuestRewardSummaryLines = loadQuestRewardSummaryHelper();
    const lines = getQuestRewardSummaryLines({
        questId: 'quest-river-watch',
        questName: 'River Watch',
        message: 'The reeve smiles and presses a weathered purse into your hand.',
        rewards: [' 60 gold ', 'Reputation with the River Wardens: +2']
    });

    assert.deepEqual(Array.from(lines), [
        '60 gold',
        'Reputation with the River Wardens: +2'
    ]);
});

test('quest completion summaries fail loudly when authoritative reward data is malformed', () => {
    const getQuestRewardSummaryLines = loadQuestRewardSummaryHelper();

    assert.throws(
        () => getQuestRewardSummaryLines({ questName: 'Missing Rewards', message: 'Narrative only.' }),
        /has no authoritative reward lines/
    );
    assert.throws(
        () => getQuestRewardSummaryLines({ questName: 'Bad Rewards', rewards: ['Gold', ''] }),
        /invalid reward line at index 1/
    );
});

test('all quest reward chat paths use authoritative summaries', () => {
    assert.doesNotMatch(apiSource, /parseQuestRewardMessage/);
    assert.equal(
        (apiSource.match(/getQuestRewardSummaryLines\(rewardEntry\)/g) || []).length,
        3
    );
});

test('external quest checks hand objectives to the API and only add a separate travel summary', () => {
    assert.match(
        apiSource,
        /appendArray\('questObjectivesCompleted', questProcessingContext\.completedQuestObjectives\);/
    );
    assert.match(
        apiSource,
        /if \(\(originEventResult \|\| destinationEventResult\)\s*&& Array\.isArray\(eventResult\?\.questObjectivesCompleted\)/
    );
});
