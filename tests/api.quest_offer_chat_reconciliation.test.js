const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.join(__dirname, '..');
const apiSource = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');

function createOffer(confirmationId, overrides = {}) {
    return {
        confirmationId,
        quest: { name: `Quest ${confirmationId}` },
        requestId: null,
        parentId: null,
        locationId: 'loc-1',
        chatEntryId: null,
        createdAt: '2026-09-10T12:00:00.000Z',
        ...overrides
    };
}

function loadQuestOfferHelpers({ offers = [], initialChatHistory = [], currentLocation = 'loc-current' } = {}) {
    const start = apiSource.indexOf('        function appendPendingQuestOffersToChat({');
    const end = apiSource.indexOf('\n        const mergeEventArrays =', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate quest-offer chat helpers in api.js.');
    }

    const pendingOffers = offers.map(offer => ({ ...offer }));
    const chatHistory = initialChatHistory.map(entry => ({ ...entry }));
    const attachments = [];
    let nextEntryId = 1;
    const questConfirmationManager = {
        getPendingConfirmations() {
            return pendingOffers.map(offer => ({ ...offer, quest: { ...offer.quest } }));
        },
        attachChatEntry(confirmationId, linkage) {
            const offer = pendingOffers.find(candidate => candidate.confirmationId === confirmationId);
            if (!offer) {
                throw new Error(`Unknown confirmation ${confirmationId}`);
            }
            offer.chatEntryId = linkage.chatEntryId;
            offer.parentId = linkage.parentId || offer.parentId;
            offer.locationId = linkage.locationId || offer.locationId;
            attachments.push({ confirmationId, ...linkage });
            return { ...offer };
        }
    };
    const pushChatEntry = (entry, collector, locationId) => {
        const stored = {
            ...entry,
            id: entry.id || `generated-offer-${nextEntryId++}`,
            locationId
        };
        chatHistory.push(stored);
        if (Array.isArray(collector)) collector.push(stored);
        return stored;
    };
    const context = {
        Array,
        Date,
        Error,
        Map,
        Set,
        TypeError,
        questConfirmationManager,
        chatHistory,
        currentPlayer: { currentLocation },
        pushChatEntry
    };
    vm.createContext(context);
    vm.runInContext(`${apiSource.slice(start, end)}
this.appendPendingQuestOffersToChat = appendPendingQuestOffersToChat;
this.reconcilePendingQuestOfferChatEntries = reconcilePendingQuestOfferChatEntries;`, context);

    return {
        appendPendingQuestOffersToChat: context.appendPendingQuestOffersToChat,
        reconcilePendingQuestOfferChatEntries: context.reconcilePendingQuestOfferChatEntries,
        pendingOffers,
        chatHistory,
        attachments
    };
}

test('confirmationIds limits append to the offers returned by one event pass', () => {
    const helpers = loadQuestOfferHelpers({
        offers: [createOffer('older-orphan'), createOffer('while-away-offer')]
    });
    const collector = [];

    const stored = helpers.appendPendingQuestOffersToChat({
        confirmationIds: ['while-away-offer'],
        parentId: 'while-away-visible-entry',
        locationId: 'loc-while-away'
    }, collector);

    assert.equal(stored.length, 1);
    assert.equal(stored[0].confirmationId, 'while-away-offer');
    assert.equal(stored[0].parentId, 'while-away-visible-entry');
    assert.equal(stored[0].locationId, 'loc-1');
    assert.equal(collector.length, 1);
    assert.equal(collector[0], stored[0]);
    assert.equal(helpers.pendingOffers[0].chatEntryId, null);
    assert.equal(helpers.pendingOffers[1].chatEntryId, stored[0].id);
    assert.equal(helpers.appendPendingQuestOffersToChat({
        confirmationIds: ['while-away-offer'],
        parentId: 'unrelated-parent'
    }).length, 0);
});

test('confirmationIds filter rejects malformed and unknown confirmation references', () => {
    const helpers = loadQuestOfferHelpers({ offers: [createOffer('known-offer')] });
    assert.throws(
        () => helpers.appendPendingQuestOffersToChat({ confirmationIds: [''] }),
        /must be a non-empty string/
    );
    assert.throws(
        () => helpers.appendPendingQuestOffersToChat({ confirmationIds: ['missing-offer'] }),
        /was not found/
    );
});

test('reconciliation attaches an existing row, creates only missing rows, and is idempotent', () => {
    const helpers = loadQuestOfferHelpers({
        offers: [createOffer('existing-offer'), createOffer('missing-offer')],
        initialChatHistory: [{
            id: 'existing-row',
            role: 'system',
            type: 'quest-offer',
            confirmationId: 'existing-offer',
            quest: { name: 'Existing quest' },
            status: 'pending',
            locationId: 'loc-1'
        }]
    });

    const created = helpers.reconcilePendingQuestOfferChatEntries();

    assert.equal(created.length, 1);
    assert.equal(created[0].confirmationId, 'missing-offer');
    assert.equal(helpers.chatHistory.length, 2);
    assert.equal(helpers.pendingOffers[0].chatEntryId, 'existing-row');
    assert.equal(helpers.pendingOffers[1].chatEntryId, created[0].id);
    assert.equal(helpers.reconcilePendingQuestOfferChatEntries().length, 0);
    assert.equal(helpers.chatHistory.length, 2);
});

test('reconciliation preserves explicit corruption failures', () => {
    const dangling = loadQuestOfferHelpers({
        initialChatHistory: [{
            id: 'dangling-row',
            type: 'quest-offer',
            confirmationId: 'no-record',
            status: 'pending'
        }]
    });
    assert.throws(
        () => dangling.reconcilePendingQuestOfferChatEntries(),
        /has no saved confirmation record/
    );

    const unrelatedLink = loadQuestOfferHelpers({
        offers: [createOffer('offer-1', { chatEntryId: 'ordinary-row' })],
        initialChatHistory: [{ id: 'ordinary-row', type: 'assistant', content: 'Not an offer' }]
    });
    assert.throws(
        () => unrelatedLink.reconcilePendingQuestOfferChatEntries(),
        /links to an unrelated chat entry/
    );

    const missingLink = loadQuestOfferHelpers({
        offers: [createOffer('offer-2', { chatEntryId: 'missing-row' })]
    });
    assert.throws(
        () => missingLink.reconcilePendingQuestOfferChatEntries(),
        /links to missing chat entry "missing-row"/
    );
});

test('while-you-were-away and the pre-turn gate wire reconciliation and global refreshes', () => {
    const whileAwayStart = apiSource.indexOf('        async function runWhileYouWereAwayPrompt({');
    const whileAwayEnd = apiSource.indexOf('\n        let scheduledEventResolutionInProgress', whileAwayStart);
    const whileAwaySource = apiSource.slice(whileAwayStart, whileAwayEnd);
    assert.match(whileAwaySource, /eventResult\.pendingQuestOffers/);
    assert.match(whileAwaySource, /appendPendingQuestOffersToChat\(\{[\s\S]*confirmationIds: pendingQuestOfferConfirmationIds[\s\S]*parentId: summaryParentEntry\?\.id[\s\S]*locationId: resolvedLocationId[\s\S]*\}, entryCollector\)/);
    assert.match(whileAwaySource, /Globals\.emitToClient\(null, 'chat_history_updated'/);

    const gateStart = apiSource.indexOf("        app.post('/api/chat', async (req, res) => {");
    const gateEnd = apiSource.indexOf('            trackActiveChatTurn(res);', gateStart);
    const gateSource = apiSource.slice(gateStart, gateEnd);
    const reconcileIndex = gateSource.indexOf('reconcilePendingQuestOfferChatEntries()');
    const refreshIndex = gateSource.lastIndexOf('questConfirmationManager.getPendingConfirmations()');
    const responseIndex = gateSource.indexOf("code: 'QUEST_CONFIRMATION_REQUIRED'");
    assert.ok(reconcileIndex >= 0, 'expected the pending-offer gate to reconcile chat rows');
    assert.ok(refreshIndex > reconcileIndex, 'expected the gate to refresh public records after reconciliation');
    assert.ok(responseIndex > refreshIndex, 'expected reconciliation before QUEST_CONFIRMATION_REQUIRED');
    assert.match(gateSource, /Globals\.emitToClient\(null, 'chat_history_updated'/);
});
