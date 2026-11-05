const test = require('node:test');
const assert = require('node:assert/strict');
const Quest = require('../Quest.js');
const Player = require('../Player.js');
const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const { buildManualQuestCompletionEntries } = require('../api.js');

test('quest level remains anchored through serialization and validates offsets', () => {
    const quest = new Quest({ name: 'Anchored', originLocationLevel: 8, relativeLevel: -3, rewardXp: 50 });
    assert.equal(quest.level, 5);
    const restored = Quest.fromJSON(JSON.parse(JSON.stringify(quest)));
    assert.equal(restored.originLocationLevel, 8);
    assert.equal(restored.relativeLevel, -3);
    assert.equal(restored.level, 5);
    restored.relativeLevel = 2;
    assert.equal(restored.level, 10);
    for (const invalid of [1.5, '1.5', '3abc', Infinity, true]) {
        assert.throws(() => { restored.relativeLevel = invalid; }, /relativeLevel/i);
    }
    assert.throws(() => { restored.relativeLevel = -8; }, /level/i);
    assert.equal(restored.level, 10);
});

test('generated quest XML requires strict relative level and XP scalars', () => {
    const xml = (relative, xp) => `<quest><name>Strict</name><objectives><objective><description>Done</description></objective></objectives>${relative}<rewards>${xp}</rewards></quest>`;
    const valid = Events._parseQuestXml(xml('<relativeLevel>-2</relativeLevel>', '<xp>0</xp>'));
    assert.equal(valid.relativeLevel, -2);
    assert.equal(valid.rewardXp, 0);
    for (const value of ['', '<relativeLevel/>', '<relativeLevel>1.5</relativeLevel>', '<relativeLevel>2abc</relativeLevel>']) {
        assert.throws(() => Events._parseQuestXml(xml(value, '<xp>0</xp>')), /relativeLevel/i);
    }
    for (const value of ['', '<xp/>', '<xp>-1</xp>', '<xp>1.5</xp>', '<xp>2abc</xp>']) {
        assert.throws(() => Events._parseQuestXml(xml('<relativeLevel>0</relativeLevel>', value)), /xp/i);
    }
});

test('legacy quests migrate to level one and a deterministic base XP value', () => {
    const base = { name: 'Old quest', objectives: [
        { description: 'Required' }, { description: 'Another' },
        { description: 'Optional', optional: true }
    ] };
    for (const rewardXp of [undefined, 0]) {
        const restored = Quest.fromJSON({ ...base, rewardXp });
        assert.equal(restored.level, 1);
        assert.equal(restored.originLocationLevel, 1);
        assert.equal(restored.relativeLevel, 0);
        assert.equal(restored.rewardXp, 50);
        const secondLoad = Quest.fromJSON(JSON.parse(JSON.stringify(restored)));
        assert.equal(secondLoad.rewardXp, 50);
        assert.equal(secondLoad.level, 1);
    }
    assert.equal(Quest.fromJSON({ ...base, rewardXp: 37 }).rewardXp, 37);
    assert.equal(Quest.fromJSON({ name: 'Empty legacy quest', objectives: [] }).rewardXp, 25);
});

test('manual quest completion scales XP once and reports the actual player award', async () => {
    const previous = { deps: Events._deps, config: Globals.config, chat: LLMClient.chatCompletion, log: LLMClient.logPrompt };
    Player.clearRuntimeRegistries();
    try {
        Globals.config = { ...(previous.config || {}), baseHealthPerLevel: 10, ai: { tinybrain: false }, slop_buster: false };
        LLMClient.chatCompletion = async () => 'The reward is received.';
        LLMClient.logPrompt = () => {};
        Events._deps = { ...(previous.deps || {}), promptEnv: { render: () => '<prompt/>' },
            parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }),
            prepareBasePromptContext: async () => ({}) };
        const player = new Player({ id: 'quest-xp-player', name: 'Veteran', level: 4 });
        const quest = new Quest({ name: 'Scaled award', originLocationLevel: 6, relativeLevel: 0,
            objectives: ['Finish'], rewardXp: 41 });
        player.addQuest(quest);
        const context = { player, completedQuestObjectives: [], questCompletionRewards: [], questCompletionErrors: [],
            questRewardBenefitResults: [], experienceAwards: [], currencyChanges: [], factionStandingChanges: [],
            dispositionChanges: [], followupQueue: [], followupResults: [] };
        const entries = buildManualQuestCompletionEntries(quest, 0);
        await Events.processQuestObjectiveCompletionEntries(entries, context);
        // ceil(41 * 6 / 4) = 62, then the ordinary level-4 divisor of 2.
        assert.equal(player.experience, 31);
        assert.equal(quest.rewardXp, 41);
        assert.equal(quest.rewardClaimed, true);
        assert.equal(context.questCompletionErrors.length, 0);
        assert.equal(context.experienceAwards[0].amount, 31);
        assert.ok(context.questCompletionRewards[0].rewards.includes('31 XP'));
        assert.deepEqual(context.questCompletionRewards[0].rewardSummaryEntries.find(entry => entry.kind === 'xp'),
            { kind: 'xp', text: '31 XP' });
        const structured = {};
        Events.mergeQuestOutcomesIntoStructured(structured, { questRewards: context.questCompletionRewards });
        const mergedReward = structured.parsed.quest_rewards[0];
        const originalReward = context.questCompletionRewards[0];
        assert.deepEqual(mergedReward.rewards, originalReward.rewards);
        assert.notStrictEqual(mergedReward.rewards, originalReward.rewards);
        assert.deepEqual(mergedReward.rewardSummaryEntries, originalReward.rewardSummaryEntries);
        assert.notStrictEqual(mergedReward.rewardSummaryEntries, originalReward.rewardSummaryEntries);
        assert.deepEqual(mergedReward.rewardSummaryEntries.map(entry => entry.text), mergedReward.rewards);
        mergedReward.rewards.push('Added after merge');
        mergedReward.rewardSummaryEntries[0].text = 'Changed after merge';
        assert.deepEqual(originalReward.rewards, ['31 XP']);
        assert.equal(originalReward.rewardSummaryEntries[0].text, '31 XP');
        await Events.processQuestObjectiveCompletionEntries(entries, context);
        assert.equal(player.experience, 31);
        assert.equal(context.experienceAwards.length, 1);
    } finally {
        Events._deps = previous.deps;
        Globals.config = previous.config;
        LLMClient.chatCompletion = previous.chat;
        LLMClient.logPrompt = previous.log;
        Player.clearRuntimeRegistries();
        Quest.clear();
    }
});
