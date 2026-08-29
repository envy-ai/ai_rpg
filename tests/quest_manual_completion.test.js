const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    buildManualQuestCompletionEntries
} = require('../api.js');
const Events = require('../Events.js');
const Quest = require('../Quest.js');

const rootDir = path.join(__dirname, '..');

test('manual quest completion targets every incomplete objective and delays required completion until last', () => {
    const quest = {
        id: 'quest-manual-test',
        name: 'Manual Test',
        objectives: [
            { description: 'Required first', completed: false, optional: false },
            { description: 'Already done', completed: true, optional: false },
            { description: 'Optional detail', completed: false, optional: true },
            { description: 'Required last', completed: false, optional: false }
        ]
    };

    assert.deepEqual(buildManualQuestCompletionEntries(quest, 2), [
        {
            questIndex: 3,
            objectiveIndex: 3,
            statusReason: 'Marked complete manually from the quest list.'
        },
        {
            questIndex: 3,
            objectiveIndex: 1,
            statusReason: 'Marked complete manually from the quest list.'
        },
        {
            questIndex: 3,
            objectiveIndex: 4,
            statusReason: 'Marked complete manually from the quest list.'
        }
    ]);
});

test('manual completion entries drive the shared processor to complete every objective exactly once', async () => {
    const quest = new Quest({
        id: 'quest-manual-processing-test',
        name: 'Manual Processing Test',
        objectives: [
            { description: 'Required objective', optional: false },
            { description: 'Optional objective', optional: true }
        ]
    });
    const player = {
        getQuestByName: name => (name === quest.name ? quest : null),
        getQuestByIndex: index => (index === 0 ? quest : null)
    };
    const context = {
        player,
        completedQuestObjectives: [],
        questCompletionRewards: [],
        questCompletionErrors: [],
        questRewardBenefitResults: [],
        experienceAwards: [],
        currencyChanges: [],
        factionStandingChanges: [],
        dispositionChanges: [],
        followupQueue: [],
        followupResults: [],
        questRewardTraceOrigin: 'quest-manual-completion-test'
    };

    await Events.processQuestObjectiveCompletionEntries(
        buildManualQuestCompletionEntries(quest, 0),
        context
    );

    assert.equal(quest.completed, true);
    assert.equal(quest.objectives.every(objective => objective.completed), true);
    assert.equal(quest.rewardClaimed, true);
    assert.equal(context.completedQuestObjectives.length, 2);
    assert.equal(context.questCompletionErrors.length, 0);
});

test('manual quest completion route uses objective and reward processing before success', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const routeStart = apiSource.indexOf("app.post('/api/quests/:questId/complete'");
    const routeEnd = apiSource.indexOf("app.post('/api/quests/:questId/retry-rewards'", routeStart);

    assert.notEqual(routeStart, -1, 'manual quest completion route not found');
    assert.notEqual(routeEnd, -1, 'manual quest completion route boundary not found');

    const routeSource = apiSource.slice(routeStart, routeEnd);
    const buildEntriesIndex = routeSource.indexOf('buildManualQuestCompletionEntries(quest, questIndex)');
    const processIndex = routeSource.indexOf('await Events.processQuestObjectiveCompletionEntries(');
    const rewardStorageIndex = routeSource.indexOf("type: 'quest-reward'");
    const successIndex = routeSource.indexOf('success: true');

    assert(buildEntriesIndex >= 0);
    assert(processIndex > buildEntriesIndex);
    assert(rewardStorageIndex > processIndex);
    assert(successIndex > rewardStorageIndex);
    assert.match(routeSource, /objectivesCompleted: true/);
    assert.match(routeSource, /questCompletionErrors/);
});
