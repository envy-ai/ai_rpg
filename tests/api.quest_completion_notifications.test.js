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

    assert.deepEqual(Array.from(lines, line => line.text), [
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
        4
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
        ItemSummaryPresentation: require('../public/js/item-summary-presentation.js'),
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

test('typed quest item snapshots survive the authoritative reward helper and saved summary', () => {
    const presentation = require('../public/js/item-summary-presentation.js');
    const item = presentation.compose([{ item: presentation.snapshot({ id: 'rare-key', name: 'Key', rarity: 'rare' }), quantity: 3 }]);
    const lines = loadQuestRewardSummaryHelper()({ questName: 'Prize', rewards: [item.text], rewardSummaryEntries: [{ kind: 'item', ...item }] });
    const { record, history } = makeSummaryRecorder();
    record({ label: 'Prize', events: Array.from(lines, line => ({ description: line.text, metadata: line.metadata, icon: '🎁', category: 'quest_reward' })), locationId: 'loc' });
    const row = JSON.parse(JSON.stringify(history))[0].summaryItems[0];
    const mention = row.metadata.itemMentions[0];
    assert.equal(row.text, '**3x** Key');
    assert.equal(row.text.slice(mention.start, mention.end), 'Key');
    assert.equal(mention.itemId, 'rare-key');
    assert.equal(mention.rarity, 'rare');
});

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
        events: Array.from(lines, line => ({ description: line.text, metadata: line.metadata, icon: '🎁', category: 'quest_reward' })),
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
    assert.deepEqual(quests.map(quest => Array.from(getLines(quest), line => line.text)), [['Map'], ['A favor']]);
});

function createManualQuestCheckHarness({ noChange = false, partialError = false } = {}) {
    const { record, history } = makeSummaryRecorder();
    const calls = { prompts: 0, process: 0, reset: 0, notifications: [] };
    const player = { currentLocation: 'loc', currentQuests: ['q1'] };
    const objective = { questId: 'q1', questName: 'River Watch', objectiveNumber: 1, objectiveDescription: 'Return the seal', reason: 'The seal was returned.', questJustCompleted: true };
    const reward = { questId: 'q1', questName: 'River Watch', message: 'The reeve thanks you.', rewards: ['11 XP', '60 gold coins', 'Silver key'], rewardSummaryEntries: [{ kind: 'xp', text: '11 XP' }, { kind: 'currency', text: '60 gold coins' }, { kind: 'item', text: 'Silver key' }] };
    const context = {
        Globals: { config: { quest_checks: { enabled: true } } }, currentPlayer: player,
        Quest: { filterActiveQuests: () => ['q1'] }, Location: { get: id => ({ id, regionId: 'region' }) }, Region: { get: id => ({ id }) },
        Events: {
            runQuestChecks: async options => { calls.prompts++; assert.equal(options.allowWithoutEventChecks, true); assert.equal(options.bypassInterval, true); return '<quests/>'; },
            resetQuestCheckTurnCounter: () => { calls.reset++; },
            parseQuestObjectiveStatusXml: () => noChange ? [] : [objective],
            processQuestObjectiveCompletionEntries: async (_entries, result) => {
                calls.process++; result.completedQuestObjectives.push(objective);
                if (partialError) { result.questCompletionErrors.push(new Error('reward generation failed')); return; }
                result.experienceAwards.push({ amount: 11, reason: 'Completed quest River Watch' });
                result.currencyChanges.push({ amount: 60 }); result.questCompletionRewards.push(reward);
            }
        },
        recordEventSummaryEntry: record, getQuestRewardSummaryLines: loadQuestRewardSummaryHelper(),
        pushChatEntry: (entry, _collector, locationId) => { const saved = { ...entry, locationId, id: `entry-${history.length + 1}` }; history.push(saved); return saved; },
        requireLocationId: id => id,
        notifyVisibleProseEntryStored: (entry, options) => calls.notifications.push({ entry, options }),
        logQuestRewardStorageTrace: () => {}, console
    };
    const start = apiSource.indexOf('async function runSlashCommandQuestCheckPrompt(');
    const end = apiSource.indexOf('\n        async function reprocessLatestTurnEvents(', start);
    assert.ok(start >= 0 && end > start);
    vm.createContext(context);
    vm.runInContext(`${apiSource.slice(start, end)}\nthis.run = runSlashCommandQuestCheckPrompt;`, context);
    return { run: context.run, history, calls };
}

test('manual quest check stores native objective and typed rewards plus reward prose once', async () => {
    const { run, history, calls } = createManualQuestCheckHarness();
    const result = await run({ clientId: 'client-1' });
    assert.equal(calls.prompts, 1); assert.equal(calls.process, 1); assert.equal(calls.reset, 1);
    const restored = JSON.parse(JSON.stringify(history));
    const rows = restored.flatMap(entry => entry.summaryItems || []);
    assert.ok(rows.some(row => /Return the seal/.test(row.text)));
    assert.ok(rows.some(row => row.sourceType === 'experience_award' && /11 XP/.test(row.text)));
    assert.ok(rows.some(row => row.sourceType === 'currency_change' && /60/.test(row.text)));
    assert.equal(rows.filter(row => row.icon === '🎁').length, 1);
    assert.ok(rows.some(row => row.icon === '🎁' && row.text === 'Silver key'));
    assert.equal(restored.filter(entry => entry.type === 'quest-reward').length, 1);
    assert.equal(restored.find(entry => entry.type === 'quest-reward').content, 'The reeve thanks you.');
    assert.ok(restored.every(entry => !entry.parentId), 'summary and prose remain standalone visible cards');
    assert.ok(restored.every(entry => entry.locationId === 'loc'));
    assert.equal(calls.notifications.length, history.length);
    assert.ok(calls.notifications.every(notification => notification.options.clientId === 'client-1'));
    assert.equal(result.storedEntries.length, history.length);
});

test('manual quest check stores no-change result and preserves objective on partial reward error', async () => {
    const empty = createManualQuestCheckHarness({ noChange: true });
    const emptyResult = await empty.run();
    assert.equal(empty.calls.prompts, 1); assert.equal(empty.calls.process, 0);
    assert.equal(emptyResult.storedEntries.length, 1);
    assert.match(empty.history[0].content, /no|0/i);
    const partial = createManualQuestCheckHarness({ partialError: true });
    const partialResult = await partial.run();
    assert.equal(partial.calls.prompts, 1); assert.equal(partial.calls.process, 1);
    assert.equal(partialResult.errors.length, 1);
    assert.ok(partial.history.flatMap(entry => entry.summaryItems || []).some(row => /Return the seal/.test(row.text)));
    assert.equal(partial.history.filter(entry => entry.type === 'quest-reward').length, 0);
});
