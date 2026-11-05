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
        rewards: [' 60 gold ', 'Reputation with the River Wardens: +2'],
        rewardSummaryEntries: [
            { kind: 'currency', text: ' 60 gold ' },
            { kind: 'faction_reputation', text: 'Reputation with the River Wardens: +2' }
        ]
    });

    assert.deepEqual(Array.from(lines), [
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
        () => getQuestRewardSummaryLines({ questName: 'Bad Rewards', rewards: ['Gold', ''], rewardSummaryEntries: [{ kind: 'item', text: 'Gold' }, { kind: 'item', text: '' }] }),
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

function makeSummaryRecorder() {
    const history = [];
    const context = {
        chatHistory: history, console, Date, Map, Set,
        SanitizedStringSet: require('../SanitizedStringSet.js'),
        Globals: { currentPlayer: null, region: null },
        normalizeNewExitSummaryText: value => String(value || '').trim(),
        getCurrencyLabel: amount => amount === 1 ? 'gold coin' : 'gold coins',
        currentSetting: null,
        requireLocationId: id => id,
        pushChatEntry: (entry, _collector, locationId) => {
            const stored = { ...entry, id: `entry-${history.length + 1}`, locationId };
            history.push(stored);
            return stored;
        }
    };
    const start = apiSource.indexOf('const EVENT_LOCATION_REFRESH_TYPES =');
    const end = apiSource.indexOf('function recordStatusSummaryEntry(', start);
    assert.ok(start >= 0 && end > start);
    vm.createContext(context);
    vm.runInContext(`${apiSource.slice(start, end)}\nthis.record = recordEventSummaryEntry;`, context);
    return { record: context.record, history };
}

test('persisted completion summaries retain canonical awards and non-monetary gifts', () => {
    const lines = loadQuestRewardSummaryHelper()({
        questId: 'q1', questName: 'River Watch', message: 'Reward prose.',
        rewards: ['11.33333 XP', '60 gold coins', '11.33333 XP', '60 gold coins', 'An ally offers shelter'],
        rewardSummaryEntries: [
            { kind: 'xp', text: '11.33333 XP' },
            { kind: 'currency', text: '60 gold coins' },
            { kind: 'item', text: '11.33333 XP' },
            { kind: 'note', text: '60 gold coins' },
            { kind: 'benefit', text: 'An ally offers shelter' }
        ]
    });
    const { record, history } = makeSummaryRecorder();
    record({
        events: { parsed: { completed_quest_objective: [{ questId: 'q1', questName: 'River Watch',
            objectiveDescription: 'Return', questJustCompleted: true }] } },
        experienceAwards: [{ amount: 11.33333, reason: 'Completed quest River Watch' },
            { amount: 3, reason: 'Found a clue' }],
        currencyChanges: [{ amount: 60.4 }, { amount: -2 }], locationId: 'loc'
    });
    record({ label: '🏆 Quest Completed – River Watch',
        events: Array.from(lines, description => ({ description, icon: '🎁', category: 'quest_reward' })),
        locationId: 'loc' });
    const restored = JSON.parse(JSON.stringify(history));
    const rows = restored.flatMap(entry => entry.summaryItems);
    assert.ok(rows.some(row => row.icon === '🏆' && row.text.includes('River Watch')));
    assert.deepEqual(rows.filter(row => row.sourceType === 'experience_award').map(row => row.text),
        ['+11 XP (Completed quest River Watch)', '+3 XP (Found a clue)']);
    assert.deepEqual(rows.filter(row => row.sourceType === 'currency_change').map(row => row.text),
        ['+60 gold coins', '-2 gold coins']);
    assert.deepEqual(rows.filter(row => row.icon === '🎁').map(row => row.text),
        ['11.33333 XP', '60 gold coins', 'An ally offers shelter']);
});

test('a quest with only XP and currency has no duplicate gift rows', () => {
    const lines = loadQuestRewardSummaryHelper()({ questName: 'Cash prize', message: 'Reward prose.',
        rewards: ['25 XP', '60 gold coins'], rewardSummaryEntries: [
            { kind: 'xp', text: '25 XP' }, { kind: 'currency', text: '60 gold coins' }
        ] });
    assert.deepEqual(Array.from(lines), []);
});

test('multiple quest rewards retain each quest’s distinct gifts', () => {
    const getLines = loadQuestRewardSummaryHelper();
    const quests = [
        { questName: 'First', rewards: ['12 XP', 'Map'], rewardSummaryEntries: [
            { kind: 'xp', text: '12 XP' }, { kind: 'item', text: 'Map' }
        ] },
        { questName: 'Second', rewards: ['7 coins', 'A favor'], rewardSummaryEntries: [
            { kind: 'currency', text: '7 coins' }, { kind: 'benefit', text: 'A favor' }
        ] }
    ];
    assert.deepEqual(quests.map(quest => Array.from(getLines(quest))), [['Map'], ['A favor']]);
});
