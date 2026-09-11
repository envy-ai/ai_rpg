const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const Player = require('../Player.js');
const Quest = require('../Quest.js');
const QuestConfirmationManager = require('../QuestConfirmationManager.js');
const Utils = require('../Utils.js');

const rootDir = path.join(__dirname, '..');

function withPlayerRegistryStub(run) {
    const previousGetById = Player.getById;
    const acceptedQuests = [];
    const player = {
        id: 'player-quest-test',
        addQuest(quest) {
            acceptedQuests.push(quest);
        },
        getQuestByName(name) {
            return acceptedQuests.find(quest => quest.name === name) || null;
        }
    };
    Player.getById = id => id === player.id ? player : null;
    Quest.clear();
    return Promise.resolve()
        .then(() => run({ player, acceptedQuests }))
        .finally(() => {
            Quest.clear();
            Player.getById = previousGetById;
        });
}

test('pending quest offers serialize, hydrate, and can be accepted from another client', async () => {
    await withPlayerRegistryStub(async ({ player, acceptedQuests }) => {
        const manager = new QuestConfirmationManager({ timeoutMs: 1 });
        const offer = manager.requestConfirmation({
            playerId: player.id,
            requestId: 'turn-request-1',
            locationId: 'location-1',
            quest: {
                name: 'Repair the Beacon',
                description: 'Restore the mountaintop beacon.',
                secretNotes: 'The lens is cursed.',
                objectives: [{ description: 'Replace the lens.', optional: false, completed: false }],
                rewardItems: [{ name: 'Signal Lens', description: 'A polished spare lens.' }],
                rewardCurrency: 12,
                rewardXp: 30
            },
            preview: {
                name: 'Repair the Beacon',
                description: 'Restore the mountaintop beacon.',
                objectives: [{ description: 'Replace the lens.', optional: false }],
                rewardItems: [{ name: 'Signal Lens', description: 'A polished spare lens.' }],
                rewardCurrency: 12,
                rewardXp: 30
            }
        });
        manager.attachChatEntry(offer.confirmationId, { chatEntryId: 'chat-offer-1' });

        await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(manager.hasPending(), true, 'the legacy timeout option must not expire an offer');

        const restored = new QuestConfirmationManager();
        restored.hydratePending(manager.serializePending());
        assert.equal(restored.getPendingConfirmations()[0].chatEntryId, 'chat-offer-1');

        const result = restored.resolveConfirmation({
            confirmationId: offer.confirmationId,
            clientId: 'different-client',
            accepted: true
        });
        assert.equal(result.accepted, true);
        assert.equal(acceptedQuests.length, 1);
        assert.equal(acceptedQuests[0].name, 'Repair the Beacon');
        assert.equal(acceptedQuests[0].secretNotes, 'The lens is cursed.');
        assert.equal(restored.hasPending(), false);
        assert.throws(
            () => restored.resolveConfirmation({ confirmationId: offer.confirmationId, clientId: 'first-client', accepted: false }),
            error => error?.code === 'QUEST_CONFIRMATION_RESOLVED'
        );
    });
});

test('declining a pending quest removes it without adding a quest', async () => {
    await withPlayerRegistryStub(({ player, acceptedQuests }) => {
        const manager = new QuestConfirmationManager();
        const offer = manager.requestConfirmation({
            playerId: player.id,
            quest: { name: 'Optional Errand' }
        });
        const result = manager.resolveConfirmation({
            confirmationId: offer.confirmationId,
            clientId: 'client-2',
            accepted: false
        });
        assert.equal(result.accepted, false);
        assert.equal(acceptedQuests.length, 0);
        assert.equal(manager.hasPending(), false);
    });
});

test('save directories persist pendingQuestConfirmations as a separate file', async () => {
    const saveDir = path.join(rootDir, 'tmp', `quest-confirmation-save-${process.pid}`);
    await fs.promises.rm(saveDir, { recursive: true, force: true });
    try {
        await Utils.writeSerializedGameState(saveDir, {
            pendingQuestConfirmations: [{
                confirmationId: 'confirmation-save-1',
                playerId: 'player-1',
                quest: { name: 'Saved Offer' },
                preview: { name: 'Saved Offer' },
                createdAt: '2026-09-09T12:00:00.000Z'
            }]
        });
        const pendingFile = path.join(saveDir, 'pendingQuestConfirmations.json');
        assert.equal(fs.existsSync(pendingFile), true);
        const loaded = Utils.loadSerializedGameState(saveDir);
        assert.equal(loaded.pendingQuestConfirmations[0].confirmationId, 'confirmation-save-1');
    } finally {
        await fs.promises.rm(saveDir, { recursive: true, force: true });
    }
});

test('chat and API source enforce inline offers, global refresh, and a pre-turn gate', () => {
    const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const chatSource = fs.readFileSync(path.join(rootDir, 'public', 'js', 'chat.js'), 'utf8');
    const viewSource = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
    assert.match(apiSource, /type: 'quest-offer'/);
    assert.match(apiSource, /code: 'QUEST_CONFIRMATION_REQUIRED'/);
    assert.match(apiSource, /Globals\.emitToClient\(null, 'chat_history_updated'/);
    assert.match(chatSource, /createQuestOfferElement\(entry\)/);
    assert.match(chatSource, /openQuestDecisionReminderModal\(\)/);
    assert.match(viewSource, /id="questDecisionReminderModal" class="modal quest-decision-reminder-modal"/);
    assert.doesNotMatch(chatSource, /quest_confirmation_request/);
});
