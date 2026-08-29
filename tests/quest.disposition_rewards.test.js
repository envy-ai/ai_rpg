const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Quest = require('../Quest.js');
const Events = require('../Events.js');
const Globals = require('../Globals.js');
const Player = require('../Player.js');
const LLMClient = require('../LLMClient.js');

const rootDir = path.join(__dirname, '..');

test('Quest stores reward item names separately from descriptions and upgrades legacy strings', () => {
    const quest = new Quest({
        name: 'Separate Rewards',
        rewardItems: [
            'Legacy Token',
            {
                name: 'Moonlit Compass',
                description: 'Its needle points toward the bearer\'s sworn destination.'
            },
            '   '
        ]
    });

    assert.deepEqual(quest.rewardItems, [
        { name: 'Legacy Token', description: '' },
        {
            name: 'Moonlit Compass',
            description: "Its needle points toward the bearer's sworn destination."
        }
    ]);
    assert.deepEqual(Quest.fromJSON(quest.toJSON()).rewardItems, quest.rewardItems);
});

test('Quest serializes NPC disposition rewards', () => {
    const quest = new Quest({
        name: 'Win Mira Over',
        objectives: ['Help Mira'],
        rewardNpcDispositions: [{
            npcId: 'char_mira',
            npcName: 'Mira',
            dispositions: [{
                type: 'platonic',
                intensity: '+2',
                reason: 'Mira trusts the player more after the rescue.'
            }]
        }]
    });

    assert.deepEqual(quest.rewardNpcDispositions, [{
        npcId: 'char_mira',
        npcName: 'Mira',
        dispositions: [{
            type: 'platonic',
            intensity: 2,
            reason: 'Mira trusts the player more after the rescue.'
        }]
    }]);

    const json = quest.toJSON();
    assert.deepEqual(json.rewardNpcDispositions, quest.rewardNpcDispositions);

    const restored = Quest.fromJSON(json);
    assert.deepEqual(restored.rewardNpcDispositions, quest.rewardNpcDispositions);
});

test('quest XML parser reads structured item and npcDispositions rewards', () => {
    const previousConfig = Globals.config;
    try {
        Globals.config = previousConfig || {};
        const parsed = Events._parseQuestXml(`
<quest>
  <name>Win Mira Over</name>
  <description>Help Mira settle the debt.</description>
  <giver>Mira</giver>
  <objectives>
    <objective><description>Pay Mira's debt.</description></objective>
  </objectives>
  <rewards>
    <item>
      <name>Debtkeeper's Signet</name>
      <description>A silver signet engraved with Mira's restored house mark.</description>
    </item>
    <npcDispositions>
      <npc>
        <name>Mira</name>
        <dispositionsTowardsPlayer>
          <disposition>
            <type>platonic</type>
            <reason>Mira trusts the player more after the rescue.</reason>
            <intensity>+2</intensity>
          </disposition>
        </dispositionsTowardsPlayer>
      </npc>
    </npcDispositions>
  </rewards>
</quest>`);

        assert.deepEqual(parsed.rewardItems, [{
            name: "Debtkeeper's Signet",
            description: "A silver signet engraved with Mira's restored house mark."
        }]);
        assert.deepEqual(parsed.rewardNpcDispositions, [{
            npcName: 'Mira',
            dispositions: [{
                type: 'platonic',
                intensity: 2,
                reason: 'Mira trusts the player more after the rescue.'
            }]
        }]);
    } finally {
        Globals.config = previousConfig;
    }
});

test('quest XML parser rejects reward items that conflate description with name', () => {
    const previousWarn = console.warn;
    try {
        console.warn = () => {};
        const parsed = Events._parseQuestXml(`
<quest>
  <name>Malformed Reward</name>
  <description>Verify reward item structure.</description>
  <objectives><objective><description>Finish the task.</description></objective></objectives>
  <rewards>
    <item><description>An ornate token with an overly detailed label.</description></item>
  </rewards>
</quest>`);
        assert.equal(parsed, null);
    } finally {
        console.warn = previousWarn;
    }
});

test('completed quest awards NPC dispositions and skips unknown NPCs with warning', async () => {
    const previousDeps = Events._deps;
    const previousConfig = Globals.config;
    const previousBaseDir = Globals.baseDir;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousWarn = console.warn;

    const warnings = [];
    let miraDisposition = 0;
    const mira = {
        id: 'char_mira',
        name: 'Mira',
        getDisposition() {
            return miraDisposition;
        },
        setDisposition(_targetId, _type, value) {
            miraDisposition = value;
            return miraDisposition;
        },
        getDispositionTowardsCurrentPlayer() {
            return miraDisposition;
        },
        setDispositionTowardsCurrentPlayer(_type, value) {
            miraDisposition = value;
            return miraDisposition;
        }
    };

    try {
        Globals.baseDir = rootDir;
        Globals.config = {
            baseHealthPerLevel: 10,
            dispositions: {
                first_impression_multiplier: 1
            }
        };
        Player.reloadDefinitionCaches({ refreshInstances: false });

        console.warn = (...args) => {
            warnings.push(args.map(value => String(value)).join(' '));
        };
        LLMClient.chatCompletion = async () => 'Rewards granted.';
        LLMClient.logPrompt = () => {};

        Events._deps = {
            ...(previousDeps || {}),
            getConfig: () => Globals.config,
            findActorByName(name) {
                return name === 'Mira' ? mira : null;
            },
            promptEnv: {
                render() {
                    return '<prompt/>';
                }
            },
            parseXMLTemplate() {
                return {
                    systemPrompt: 'system',
                    generationPrompt: 'generation'
                };
            },
            prepareBasePromptContext: async () => ({})
        };

        const quest = new Quest({
            name: 'Win Mira Over',
            objectives: ['Help Mira'],
            rewardNpcDispositions: [
                {
                    npcName: 'Unknown Friend',
                    dispositions: [{
                        type: 'platonic',
                        intensity: 3,
                        reason: 'This NPC does not exist.'
                    }]
                },
                {
                    npcName: 'Mira',
                    dispositions: [{
                        type: 'platonic',
                        intensity: 2,
                        reason: 'Mira trusts the player more after the rescue.'
                    }]
                }
            ]
        });

        const player = {
            id: 'player_1',
            name: 'Player',
            getQuestByName(name) {
                return name === quest.name ? quest : null;
            },
            getQuestByIndex(index) {
                return index === 0 ? quest : null;
            },
            addExperience() {}
        };

        const context = {
            player,
            completedQuestObjectives: [],
            questCompletionRewards: [],
            experienceAwards: [],
            currencyChanges: [],
            factionStandingChanges: [],
            dispositionChanges: [],
            followupQueue: [],
            followupResults: []
        };

        await Events.processQuestObjectiveCompletionEntries([{
            questIndex: 1,
            objectiveIndex: 1,
            statusReason: 'The debt was settled.'
        }], context);

        assert.equal(miraDisposition, 8);
        assert.equal(context.dispositionChanges.length, 1);
        assert.equal(context.dispositionChanges[0].npcId, 'char_mira');
        assert.equal(context.dispositionChanges[0].npcName, 'Mira');
        assert.equal(context.dispositionChanges[0].typeKey, 'platonic');
        assert.equal(context.dispositionChanges[0].delta, 8);
        assert.equal(
            context.dispositionChanges[0].reason,
            'Mira trusts the player more after the rescue.'
        );
        assert.match(warnings.join('\n'), /Unknown Friend/);
    } finally {
        console.warn = previousWarn;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Events._deps = previousDeps;
        Globals.config = previousConfig;
        Globals.baseDir = previousBaseDir;
        Player.reloadDefinitionCaches({ refreshInstances: false });
    }
});

test('completed quest directly grants item and currency rewards without event-checking reward prose', async () => {
    const previousDeps = Events._deps;
    const previousConfig = Globals.config;
    const previousBaseDir = Globals.baseDir;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousRunEventChecks = Events.runEventChecks;
    const previousError = console.error;
    const previousInfo = console.info;
    const previousApplySlopRemoval = Globals.applySlopRemoval;

    const inventory = [];
    const experienceAwards = [];
    const questRewardTraceLines = [];
    let currency = 7;
    let eventCheckCalls = 0;
    let archiveSealAttempts = 0;

    try {
        Globals.baseDir = rootDir;
        Globals.config = {
            baseHealthPerLevel: 10,
            slop_buster: true,
            ai: { tinybrain: false }
        };
        Player.reloadDefinitionCaches({ refreshInstances: false });
        LLMClient.chatCompletion = async () => 'The configured quest rewards were granted.';
        LLMClient.logPrompt = () => {};
        console.error = () => {};
        console.info = (...args) => {
            questRewardTraceLines.push(args.map(value => String(value)).join(' '));
        };
        Globals.applySlopRemoval = async prose => prose;
        Events.runEventChecks = async () => {
            eventCheckCalls += 1;
            throw new Error('Quest reward prose must not be event-checked.');
        };

        Events._deps = {
            ...(previousDeps || {}),
            getConfig: () => Globals.config,
            generateItemsByNames: async ({ itemNames, seeds, options }) => {
                assert.equal(itemNames.length, 1);
                assert.equal(options.mergeStacks, false);
                assert.equal(options.creationMetadata.questRewardQuestId, 'quest_reward_test');
                const rewardIndex = options.creationMetadata.questRewardIndex;
                assert.ok(rewardIndex === 0 || rewardIndex === 1);
                const expectedName = rewardIndex === 0 ? 'Archivist Token' : 'Archive Seal';
                assert.deepEqual(itemNames, [expectedName]);
                const expectedDescription = rewardIndex === 0
                    ? 'A brass token stamped with the archive crest.'
                    : 'A wax seal carrying the chief archivist\'s mark.';
                assert.deepEqual(seeds, [{
                    name: expectedName,
                    description: expectedDescription,
                    itemOrScenery: 'item'
                }]);
                if (rewardIndex === 1) {
                    archiveSealAttempts += 1;
                    if (archiveSealAttempts === 1) {
                        throw new Error('Temporary Archive Seal generation failure.');
                    }
                }
                const item = {
                    id: `thing_reward_${rewardIndex}`,
                    name: expectedName,
                    metadata: { ...options.creationMetadata }
                };
                inventory.push(item);
                return [item];
            },
            promptEnv: {
                render() {
                    return '<prompt/>';
                }
            },
            parseXMLTemplate() {
                return {
                    systemPrompt: 'system',
                    generationPrompt: 'generation'
                };
            },
            prepareBasePromptContext: async () => ({})
        };

        const quest = new Quest({
            id: 'quest_reward_test',
            name: 'Archive Delivery',
            objectives: ['Report completion'],
            rewardItems: [
                {
                    name: 'Archivist Token',
                    description: 'A brass token stamped with the archive crest.'
                },
                {
                    name: 'Archive Seal',
                    description: "A wax seal carrying the chief archivist's mark."
                }
            ],
            rewardCurrency: 10,
            rewardXp: 25
        });
        const player = {
            id: 'player_1',
            name: 'Player',
            getQuestByName(name) {
                return name === quest.name ? quest : null;
            },
            getQuestByIndex(index) {
                return index === 0 ? quest : null;
            },
            getInventoryItems() {
                return inventory;
            },
            getCurrency() {
                return currency;
            },
            adjustCurrency(delta) {
                currency += delta;
                return currency;
            },
            addExperience(amount) {
                experienceAwards.push(amount);
            }
        };
        const context = {
            player,
            completedQuestObjectives: [],
            questCompletionRewards: [],
            questCompletionErrors: [],
            experienceAwards: [],
            currencyChanges: [],
            factionStandingChanges: [],
            dispositionChanges: [],
            followupQueue: [],
            followupResults: []
        };

        const completionEntry = {
            questIndex: 1,
            objectiveIndex: 1,
            statusReason: 'The delivery was reported.'
        };

        await Events.processQuestObjectiveCompletionEntries([completionEntry], context);
        assert.equal(quest.completed, true);
        assert.equal(quest.rewardClaimed, false);
        assert.equal(currency, 7);
        assert.deepEqual(experienceAwards, []);
        assert.deepEqual(inventory.map(item => item.name), ['Archivist Token']);
        assert.equal(context.completedQuestObjectives.length, 1);
        assert.equal(context.questCompletionErrors.length, 1);
        assert.equal(context.questCompletionErrors[0].code, 'QUEST_REWARD_APPLICATION_FAILED');
        assert.equal(context.questCompletionErrors[0].questId, 'quest_reward_test');
        assert.match(context.questCompletionErrors[0].message, /rewards remain pending/);
        assert.match(context.questCompletionErrors[0].cause, /Temporary Archive Seal generation failure/);
        assert.match(context.questCompletionErrors[0].stack, /Temporary Archive Seal generation failure/);

        await Events.processQuestObjectiveCompletionEntries([completionEntry], context);

        assert.equal(quest.completed, true);
        assert.equal(quest.rewardClaimed, true);
        assert.equal(currency, 17);
        assert.deepEqual(experienceAwards, [25]);
        assert.equal(inventory.length, 2);
        assert.deepEqual(inventory.map(item => item.name), ['Archivist Token', 'Archive Seal']);
        assert.equal(context.completedQuestObjectives.length, 1);
        assert.deepEqual(context.currencyChanges, [{
            amount: 10,
            before: 7,
            after: 17,
            reason: 'Completed quest: Archive Delivery'
        }]);
        assert.deepEqual(context.questCompletionRewards[0].items, ['Archivist Token', 'Archive Seal']);
        assert.equal(eventCheckCalls, 0);
        const questRewardTrace = questRewardTraceLines.join('\n');
        assert.match(questRewardTrace, /"stage":"application:start"/);
        assert.match(questRewardTrace, /"stage":"application:complete"/);
        assert.match(questRewardTrace, /"stage":"presentation:generation:complete"/);
        assert.match(questRewardTrace, /"stage":"presentation:slop-removal:start"/);
        assert.match(questRewardTrace, /"stage":"presentation:slop-removal:complete"/);
        assert.match(questRewardTrace, /"stage":"presentation:accumulator:complete"/);
        assert.match(questRewardTrace, /"stage":"batch:complete"/);
        assert.match(questRewardTrace, /"errorCode":"QUEST_REWARD_APPLICATION_FAILED"/);

        await Events.processQuestObjectiveCompletionEntries([{
            questIndex: 1,
            objectiveIndex: 1,
            statusReason: 'Duplicate completion attempt.'
        }], context);
        assert.equal(currency, 17);
        assert.deepEqual(experienceAwards, [25]);
        assert.equal(inventory.length, 2);
    } finally {
        Events.runEventChecks = previousRunEventChecks;
        console.error = previousError;
        console.info = previousInfo;
        Globals.applySlopRemoval = previousApplySlopRemoval;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        Events._deps = previousDeps;
        Globals.config = previousConfig;
        Globals.baseDir = previousBaseDir;
        Player.reloadDefinitionCaches({ refreshInstances: false });
    }
});

test('quest disposition rewards are exposed through editor and API source hooks', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
    const chatToolSource = fs.readFileSync(path.join(rootDir, 'chat_tool_calls.js'), 'utf8');
    const promptSource = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'quest-generate.njk'), 'utf8');

    assert.match(promptSource, /<npcDispositions>/);
    assert.match(promptSource, /<reason>/);
    assert.match(promptSource, /<item>\s*<name>/);
    assert.match(apiSource, /rewardNpcDispositions/);
    assert.match(apiSource, /parseQuestNpcDispositionRewardsInput/);
    assert.match(viewSource, /questEditRewardNpcDispositionRows/);
    assert.match(viewSource, /questEditAddNpcDispositionReward/);
    assert.match(viewSource, /NPC Disposition Rewards/);
    assert.match(viewSource, /normalizeQuestNpcDispositionRewards/);
    assert.match(viewSource, /gatherQuestNpcDispositionRewards/);
    assert.match(chatToolSource, /rewardNpcDispositions/);
});
