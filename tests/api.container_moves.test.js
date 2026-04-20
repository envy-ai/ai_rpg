const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadContainerMoveHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function createContainerMoveError(message, status = 400) {');
    const end = source.indexOf('\n        function buildContainerInventoryPayload(container) {', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate container move helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Error,
        Array,
        Set,
        currentPlayer: null
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.resolveContainerMoveThingIds = resolveContainerMoveThingIds;
this.validateContainerMoveInItems = validateContainerMoveInItems;
this.validateContainerMoveOutItems = validateContainerMoveOutItems;`,
        context
    );

    return context;
}

test('container move request helper accepts single and bulk item ids', () => {
    const { resolveContainerMoveThingIds } = loadContainerMoveHelpers();

    assert.deepEqual(JSON.parse(JSON.stringify(resolveContainerMoveThingIds({ thingId: ' item-1 ' }))), ['item-1']);
    assert.deepEqual(JSON.parse(JSON.stringify(resolveContainerMoveThingIds({ thingIds: [' item-1 ', 'item-2'] }))), ['item-1', 'item-2']);
});

test('container move request helper rejects invalid bulk item ids loudly', () => {
    const { resolveContainerMoveThingIds } = loadContainerMoveHelpers();

    assert.throws(() => resolveContainerMoveThingIds({}), /thingId is required/);
    assert.throws(() => resolveContainerMoveThingIds({ thingIds: [] }), /non-empty array/);
    assert.throws(() => resolveContainerMoveThingIds({ thingIds: ['item-1', ' '] }), /non-empty array/);
    assert.throws(() => resolveContainerMoveThingIds({ thingIds: ['item-1', 'item-1'] }), /Duplicate thingId/);
});

test('container move-in validation checks the full requested set before mutation', () => {
    const context = loadContainerMoveHelpers();
    context.currentPlayer = {
        hasInventoryItem: id => id === 'valid-id' || id === 'equipped-id' || id === 'container-id' || id === 'descendant-id'
    };
    const container = {
        id: 'container-id',
        name: 'Chest',
        hasInventoryItem: () => false
    };
    const validItem = {
        id: 'valid-id',
        name: 'Coin',
        thingType: 'item',
        isEquipped: false,
        isContainer: false
    };

    assert.doesNotThrow(() => context.validateContainerMoveInItems(container, [validItem]));
    assert.throws(() => context.validateContainerMoveInItems(container, [{ ...validItem, id: 'missing-id' }]), /not in the current player's inventory/);
    assert.throws(() => context.validateContainerMoveInItems(container, [{ ...validItem, id: 'equipped-id', isEquipped: true }]), /Equipped items/);
    assert.throws(() => context.validateContainerMoveInItems(container, [{ ...validItem, id: 'container-id' }]), /cannot contain itself/);
    assert.throws(() => context.validateContainerMoveInItems(container, [{
        ...validItem,
        id: 'descendant-id',
        isContainer: true,
        containsThingRecursive: () => true
    }]), /own descendants/);
});

test('container move-out validation rejects missing and duplicate player-owned contents', () => {
    const context = loadContainerMoveHelpers();
    const container = {
        id: 'container-id',
        name: 'Chest',
        hasInventoryItem: id => id === 'valid-id' || id === 'already-owned-id'
    };
    const validItem = {
        id: 'valid-id',
        name: 'Coin',
        thingType: 'item'
    };

    context.currentPlayer = { hasInventoryItem: () => false };
    assert.doesNotThrow(() => context.validateContainerMoveOutItems(container, [validItem]));
    assert.throws(() => context.validateContainerMoveOutItems(container, [{ ...validItem, id: 'missing-id' }]), /is not in Chest/);

    context.currentPlayer = { hasInventoryItem: id => id === 'already-owned-id' };
    assert.throws(() => context.validateContainerMoveOutItems(container, [{ ...validItem, id: 'already-owned-id' }]), /already in the current player's inventory/);
});
