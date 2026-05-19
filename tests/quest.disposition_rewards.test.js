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

test('quest XML parser reads npcDispositions rewards with reasons', () => {
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

test('quest disposition rewards are exposed through editor and API source hooks', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
    const chatToolSource = fs.readFileSync(path.join(rootDir, 'chat_tool_calls.js'), 'utf8');
    const promptSource = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'quest-generate.njk'), 'utf8');

    assert.match(promptSource, /<npcDispositions>/);
    assert.match(promptSource, /<reason>/);
    assert.match(apiSource, /rewardNpcDispositions/);
    assert.match(apiSource, /parseQuestNpcDispositionRewardsInput/);
    assert.match(viewSource, /questEditRewardNpcDispositionRows/);
    assert.match(viewSource, /questEditAddNpcDispositionReward/);
    assert.match(viewSource, /NPC Disposition Rewards/);
    assert.match(viewSource, /normalizeQuestNpcDispositionRewards/);
    assert.match(viewSource, /gatherQuestNpcDispositionRewards/);
    assert.match(chatToolSource, /rewardNpcDispositions/);
});
