const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test.afterEach(() => {
    Events.initialize({});
});

test('transfer_item generates a missing transferred item and gives it to the receiver', async () => {
    const generatedItems = [];
    const receivedItems = [];
    const things = new Map();
    const giver = {
        id: 'npc-mikki',
        name: 'Mikki Flashpaw',
        removeInventoryItem() {
            return true;
        }
    };
    const receiver = {
        id: 'player-baato',
        name: 'Baato',
        addInventoryItem(thing) {
            receivedItems.push(thing);
            return true;
        }
    };
    const location = {
        id: 'market',
        name: 'Side Street Market'
    };

    Events.initialize({
        things,
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            if (normalized === 'mikki flashpaw') {
                return giver;
            }
            if (normalized === 'baato') {
                return receiver;
            }
            return null;
        },
        generateItemsByNames: async ({ itemNames, owner }) => {
            assert.equal(owner, giver);
            generatedItems.push(...itemNames);
            return itemNames.map((name, index) => {
                const thing = {
                    id: `generated-${index}`,
                    name,
                    count: 1,
                    metadata: { ownerId: giver.id }
                };
                things.set(thing.id, thing);
                return thing;
            });
        }
    });
    Events._resetTrackingSets();

    await Events.applyEventOutcomes({
        parsed: {
            transfer_item: [{
                giver: 'Mikki Flashpaw',
                item: 'Battered Signal Processor',
                quantity: 1,
                receiver: 'Baato'
            }]
        },
        rawEntries: {}
    }, { location });

    assert.deepEqual(generatedItems, ['Battered Signal Processor']);
    assert.equal(receivedItems.length, 1);
    assert.equal(receivedItems[0].name, 'Battered Signal Processor');
    assert.equal(receivedItems[0].metadata.ownerId, receiver.id);
    assert.equal(Events.obtainedItems.has('Battered Signal Processor'), true);
});

test('transfer_item uses an existing unowned location item before generating a replacement', async () => {
    const generatedItems = [];
    const receivedItems = [];
    const looseProcessor = {
        id: 'loose-processor',
        name: 'Battered Signal Processor',
        count: 1,
        metadata: { locationId: 'market' }
    };
    const things = new Map([[looseProcessor.id, looseProcessor]]);
    const giver = {
        id: 'npc-mikki',
        name: 'Mikki Flashpaw',
        removeInventoryItem() {
            return false;
        }
    };
    const receiver = {
        id: 'player-baato',
        name: 'Baato',
        addInventoryItem(thing) {
            receivedItems.push(thing);
            return true;
        }
    };
    const location = {
        id: 'market',
        name: 'Side Street Market'
    };

    Events.initialize({
        things,
        getConfig: () => ({ omit_npc_generation: true }),
        findActorByName: (name) => {
            const normalized = String(name || '').trim().toLowerCase();
            if (normalized === 'mikki flashpaw') {
                return giver;
            }
            if (normalized === 'baato') {
                return receiver;
            }
            return null;
        },
        generateItemsByNames: async ({ itemNames }) => {
            generatedItems.push(...itemNames);
            return [];
        }
    });
    Events._resetTrackingSets();

    await Events.applyEventOutcomes({
        parsed: {
            transfer_item: [{
                giver: 'Mikki Flashpaw',
                item: 'Battered Signal Processor',
                quantity: 1,
                receiver: 'Baato'
            }]
        },
        rawEntries: {}
    }, { location });

    assert.deepEqual(generatedItems, []);
    assert.deepEqual(receivedItems, [looseProcessor]);
    assert.equal(looseProcessor.metadata.ownerId, receiver.id);
    assert.equal(Events.obtainedItems.has('Battered Signal Processor'), true);
});
