const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const Thing = require('../Thing.js');
const Globals = require('../Globals.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-barter-state-',
        attributes: [
            { id: 'strength', label: 'Strength', default: 10 }
        ],
        clearThings: true
    }, run);
}

function resetRuntimeState() {
    Player.clearRuntimeRegistries();
    Thing.clear();
}

test('NPC barter inventory persists separately from normal inventory', () => {
    withTempPlayerEnvironment(() => {
        const normalItem = new Thing({
            id: 'normal-item',
            name: 'Normal Item',
            description: 'A normal inventory item.',
            thingType: 'item'
        });
        const barterItem = new Thing({
            id: 'barter-item',
            name: 'Barter Item',
            description: 'A barter stock item.',
            thingType: 'item'
        });
        const merchant = new Player({
            id: 'merchant',
            name: 'Merchant',
            isNPC: true,
            inventory: [normalItem.id],
            barterInventory: [barterItem.id],
            barterStockUpdatedAt: 123,
            barterProfile: { specialty: 'tools' }
        });

        assert.deepEqual(merchant.getInventoryItems().map(item => item.id), ['normal-item']);
        assert.deepEqual(merchant.getBarterInventoryItems().map(item => item.id), ['barter-item']);
        assert.equal(barterItem.metadata.barterOwnerId, 'merchant');
        assert.equal(normalItem.metadata.ownerId, undefined);

        const saved = merchant.toJSON();
        assert.deepEqual(saved.barterInventory, ['barter-item']);
        assert.equal(saved.barterStockUpdatedAt, 123);
        assert.deepEqual(saved.barterProfile, { specialty: 'tools' });

        resetRuntimeState();
        new Thing({
            id: 'barter-item',
            name: 'Barter Item',
            description: 'A barter stock item.',
            thingType: 'item'
        });
        const loaded = Player.fromJSON(saved);

        assert.deepEqual(loaded.getBarterInventoryItems().map(item => item.id), ['barter-item']);
        assert.equal(loaded.barterStockUpdatedAt, 123);
        assert.deepEqual(loaded.barterProfile, { specialty: 'tools' });
    });
});

test('trade refusal expires at the configured world minute', () => {
    const previousGetter = Globals.getTotalWorldMinutes;
    try {
        withTempPlayerEnvironment(() => {
            let currentMinute = 500;
            Globals.getTotalWorldMinutes = () => currentMinute;
            const merchant = new Player({
                id: 'refusing-merchant',
                name: 'Refusing Merchant',
                isNPC: true
            });

            merchant.setWillingToTrade(false, { refusalExpiresAt: 510 });

            assert.equal(merchant.willingToTrade, false);
            assert.equal(merchant.tradeRefusalExpiresAt, 510);

            currentMinute = 510;

            assert.equal(merchant.willingToTrade, true);
            assert.equal(merchant.tradeRefusalExpiresAt, null);
        });
    } finally {
        Globals.getTotalWorldMinutes = previousGetter;
    }
});
