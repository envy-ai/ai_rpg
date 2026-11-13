const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');

test.afterEach(() => Events.clearFavorGrantGuard());

const player = { name: 'Baato' };

test('matching item events for the player are pruned; other items and other recipients are kept', () => {
    Events.setFavorGrantGuard({ favorId: 'favor_x', favorName: 'Writ', factionName: 'Ashen Guild', itemNames: ['Guild Writ'] });
    const events = {
        parsed: {
            item_appear: [{ name: 'guild writ', quantity: 1 }, { name: 'Lantern', quantity: 1 }],
            pick_up_item: [{ name: 'player', item: 'Guild Writ', quantity: 1 }, { name: 'Vey', item: 'Guild Writ', quantity: 1 }],
            transfer_item: [{ giver: 'Quartermaster', item: 'Guild Writ', quantity: 1, receiver: 'Baato' }]
        },
        rawEntries: { item_appear: 'raw', pick_up_item: 'raw', transfer_item: 'raw' }
    };
    Events._applyFavorGrantGuard(events, { player });
    assert.deepEqual(events.parsed.item_appear.map(entry => entry.name), ['Lantern']);
    assert.deepEqual(events.parsed.pick_up_item.map(entry => entry.name), ['Vey']);
    assert.deepEqual(events.parsed.transfer_item, []);
    assert.equal(events.rawEntries.item_appear, undefined);
});

test('exactly one equal currency gain is pruned per turn; other amounts are kept', () => {
    Events.setFavorGrantGuard({ favorId: 'favor_x', currencyAmount: 50 });
    const first = { parsed: { currency: 50 }, rawEntries: { currency: '50' } };
    Events._applyFavorGrantGuard(first, { player });
    assert.equal(first.parsed.currency, 0);
    const second = { parsed: { currency: 50 }, rawEntries: { currency: '50' } };
    Events._applyFavorGrantGuard(second, { player });
    assert.equal(second.parsed.currency, 50, 'a second matching gain in the same turn still applies');

    Events.setFavorGrantGuard({ favorId: 'favor_x', currencyAmount: 50 });
    const different = { parsed: { currency: 30 } };
    Events._applyFavorGrantGuard(different, { player });
    assert.equal(different.parsed.currency, 30);
    const listed = { parsed: { currency: [20, 50, 50] } };
    Events._applyFavorGrantGuard(listed, { player });
    assert.deepEqual(listed.parsed.currency, [20, 50]);
});

test('the guard adds an event-check note and does nothing once cleared', () => {
    Events.setFavorGrantGuard({ favorId: 'favor_x', favorName: 'War Chest', factionName: 'Ashen Guild', currencyAmount: 50, itemNames: ['Writ'] });
    assert.equal(Events._favorGrantGuardInstructions(),
        'The player already received Writ and 50 currency from War Chest from Ashen Guild before this text was written; do not report receiving them again.');
    Events.clearFavorGrantGuard();
    assert.equal(Events._favorGrantGuardInstructions(), '');
    const events = { parsed: { currency: 50, item_appear: [{ name: 'Writ', quantity: 1 }] } };
    Events._applyFavorGrantGuard(events, { player });
    assert.equal(events.parsed.currency, 50);
    assert.equal(events.parsed.item_appear.length, 1);
});

test('invalid guard input is rejected', () => {
    assert.throws(() => Events.setFavorGrantGuard({ currencyAmount: -5 }), /positive whole number/);
    assert.throws(() => Events.setFavorGrantGuard('x'), /object or null/);
});
