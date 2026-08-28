const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Quest = require('../Quest.js');
const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const QuestConfirmationManager = require('../QuestConfirmationManager.js');
const {
    QuestRewardBenefitRegistry,
    questRewardBenefitRegistry
} = require('../QuestRewardBenefitRegistry.js');

const rootDir = path.join(__dirname, '..');

function createPartyOwner() {
    const memberIds = [];
    return {
        id: 'player_1',
        name: 'Player',
        getPartyMembers() {
            return memberIds.slice();
        },
        addPartyMember(memberId) {
            if (memberIds.includes(memberId)) {
                return false;
            }
            memberIds.push(memberId);
            return true;
        }
    };
}

test('benefit registry enforces the complete typed handler contract', () => {
    const registry = new QuestRewardBenefitRegistry();
    assert.throws(
        () => registry.register('incomplete', { normalize() {} }),
        /missing validate\(\)/
    );
    assert.throws(
        () => registry.normalize({ id: 'x', type: 'service' }),
        /Unsupported quest reward benefit type "service"/
    );
});

test('Quest persists benefits, narrative notes, and per-benefit application state', () => {
    const quest = new Quest({
        name: 'Raid Credentials',
        objectives: ['Finish the raid'],
        rewardBenefits: [{
            id: 'ragna_support',
            type: 'party-member',
            targetId: 'npc_ragna',
            label: 'Ragna Kaen',
            description: 'Ragna joins the party with her own equipment.',
            role: 'combat support'
        }],
        rewardNotes: ['The Bloodmoon lodge owes the player safe lodging.'],
        appliedRewardBenefitIds: ['ragna_support'],
        rewardNotesPresented: true
    });

    const restored = Quest.fromJSON(quest.toJSON());
    assert.deepEqual(restored.rewardBenefits, quest.rewardBenefits);
    assert.deepEqual(restored.rewardNotes, quest.rewardNotes);
    assert.deepEqual(restored.appliedRewardBenefitIds, ['ragna_support']);
    assert.equal(restored.rewardNotesPresented, true);
    assert.throws(
        () => new Quest({
            name: 'Invalid Benefit',
            rewardBenefits: [{ id: 'x', type: 'service', targetId: 'npc_ragna', label: 'Service' }]
        }),
        /Unsupported quest reward benefit type "service"/
    );
});

test('party-member benefits recruit once without transferring NPC equipment', () => {
    const player = createPartyOwner();
    const npc = {
        id: 'npc_ragna',
        name: 'Ragna Kaen',
        isNPC: true,
        isDead: false,
        inventory: ['Emberclaw Gauntlets']
    };
    const entry = {
        id: 'ragna_support',
        type: 'party-member',
        targetId: npc.id,
        label: npc.name,
        description: 'Ragna joins as raid-certified combat support.'
    };
    const context = { player, findActorById: id => (id === npc.id ? npc : null) };

    const first = questRewardBenefitRegistry.apply(entry, context);
    const second = questRewardBenefitRegistry.apply(entry, context);

    assert.deepEqual(player.getPartyMembers(), [npc.id]);
    assert.deepEqual(npc.inventory, ['Emberclaw Gauntlets']);
    assert.equal(first.alreadySatisfied, false);
    assert.equal(second.alreadySatisfied, true);
    assert.equal(second.summary.rewardLine, 'Ragna Kaen joins the party');
});

test('party-member benefit rejects missing and dead targets explicitly', () => {
    const player = createPartyOwner();
    const entry = {
        id: 'ragna_support',
        type: 'party-member',
        targetId: 'npc_ragna',
        label: 'Ragna Kaen'
    };
    assert.throws(
        () => questRewardBenefitRegistry.apply(entry, { player, findActorById: () => null }),
        /references missing NPC/
    );
    assert.throws(
        () => questRewardBenefitRegistry.apply(entry, {
            player,
            findActorById: () => ({
                id: 'npc_ragna',
                name: 'Ragna Kaen',
                isNPC: true,
                isDead: true
            })
        }),
        /cannot recruit dead NPC/
    );
});

test('mixed rewards resume after a partial benefit failure without duplicating successful benefits', async () => {
    const previousDeps = Events._deps;
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousError = console.error;
    const player = createPartyOwner();
    let currency = 5;
    player.getCurrency = () => currency;
    player.adjustCurrency = delta => (currency += delta);
    player.addExperience = () => {};

    const firstNpc = { id: 'npc_ragna', name: 'Ragna', isNPC: true, isDead: false };
    const secondNpc = { id: 'npc_mira', name: 'Mira', isNPC: true, isDead: true };
    const actors = new Map([[firstNpc.id, firstNpc], [secondNpc.id, secondNpc]]);

    const quest = new Quest({
        id: 'quest_benefit_retry',
        name: 'Recruit the Raiders',
        objectives: ['Report success'],
        rewardCurrency: 10,
        rewardBenefits: [
            { id: 'ragna', type: 'party-member', targetId: firstNpc.id, label: firstNpc.name },
            { id: 'mira', type: 'party-member', targetId: secondNpc.id, label: secondNpc.name }
        ],
        rewardNotes: ['The raiders recognize the player as an ally.']
    });
    player.getQuestByName = name => (name === quest.name ? quest : null);
    player.getQuestByIndex = index => (index === 0 ? quest : null);

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
        followupResults: []
    };

    try {
        Globals.config = { ai: { tinybrain: false }, slop_buster: false };
        console.error = () => {};
        LLMClient.chatCompletion = async () => 'Both allies join the party.';
        LLMClient.logPrompt = () => {};
        Events._deps = {
            ...(previousDeps || {}),
            findActorById: id => actors.get(id) || null,
            promptEnv: { render: () => '<prompt/>' },
            parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }),
            prepareBasePromptContext: async () => ({})
        };

        const entry = { questIndex: 1, objectiveIndex: 1, statusReason: 'Done.' };
        await Events.processQuestObjectiveCompletionEntries([entry], context);
        assert.deepEqual(player.getPartyMembers(), ['npc_ragna']);
        assert.deepEqual(quest.appliedRewardBenefitIds, ['ragna']);
        assert.equal(quest.rewardClaimed, false);
        assert.equal(currency, 5);
        assert.equal(context.questCompletionErrors.at(-1).code, 'QUEST_REWARD_APPLICATION_FAILED');

        secondNpc.isDead = false;
        await Events.processQuestObjectiveCompletionEntries([entry], context);
        assert.deepEqual(player.getPartyMembers(), ['npc_ragna', 'npc_mira']);
        assert.deepEqual(quest.appliedRewardBenefitIds, ['ragna', 'mira']);
        assert.equal(quest.rewardClaimed, true);
        assert.equal(quest.rewardNotesPresented, true);
        assert.equal(currency, 15);
        assert.deepEqual(context.currencyChanges, [{
            amount: 10,
            before: 5,
            after: 15,
            reason: 'Completed quest: Recruit the Raiders'
        }]);
        assert.deepEqual(context.questCompletionRewards.at(-1).benefits.map(entry => entry.id), ['ragna', 'mira']);
        assert.deepEqual(context.questCompletionRewards.at(-1).notes, ['The raiders recognize the player as an ally.']);
    } finally {
        Events._deps = previousDeps;
        Globals.config = previousConfig;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        console.error = previousError;
    }
});

test('quest XML and confirmation previews expose party benefits and reward notes', () => {
    const previousConfig = Globals.config;
    Globals.config = previousConfig || {};
    try {
        const parsed = Events._parseQuestXml(`
<quest>
  <name>Recruit Ragna</name>
  <description>Earn Ragna's support.</description>
  <giver>Ragna</giver>
  <objectives><objective><description>Win the raid.</description></objective></objectives>
  <rewards>
    <benefits><partyMember><npcName>Ragna</npcName><label>Ragna Kaen</label><description>Ragna joins.</description><role>Vanguard</role></partyMember></benefits>
    <notes><note>The lodge offers safe lodging.</note></notes>
  </rewards>
</quest>`);
        assert.deepEqual(parsed.rewardBenefits, [{
            type: 'party-member',
            targetName: 'Ragna',
            label: 'Ragna Kaen',
            description: 'Ragna joins.',
            role: 'Vanguard'
        }]);
        assert.deepEqual(parsed.rewardNotes, ['The lodge offers safe lodging.']);

        const manager = new QuestConfirmationManager();
        const normalize = manager.constructor.prototype.requestConfirmation;
        assert.equal(typeof normalize, 'function');
        const managerSource = fs.readFileSync(path.join(rootDir, 'QuestConfirmationManager.js'), 'utf8');
        const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
        assert.match(managerSource, /rewardBenefits/);
        assert.match(managerSource, /rewardNotes/);
        assert.match(chatSource, /Party member:/);
        assert.match(chatSource, /Promise:/);
    } finally {
        Globals.config = previousConfig;
    }
});

test('quest editor and API expose benefit editing and explicit pending-reward retry', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
    const promptSource = fs.readFileSync(path.join(rootDir, 'prompts', '_includes', 'quest-generate.njk'), 'utf8');
    assert.match(apiSource, /\/api\/quests\/:questId\/retry-rewards/);
    assert.match(apiSource, /questRewardBenefitRegistry\.validateAll/);
    assert.match(viewSource, /questEditRewardBenefitsRows/);
    assert.match(viewSource, /gatherQuestRewardBenefits/);
    assert.match(viewSource, /Retry Pending Rewards/);
    assert.match(promptSource, /<partyMember>/);
    assert.match(promptSource, /<notes>/);
});
