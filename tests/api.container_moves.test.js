const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadContainerMoveHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function createContainerMoveError(message, status = 400) {');
    const end = source.indexOf('\n        async function buildContainerInventoryPayload', start);
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

function loadDropPlacementHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function detachThingFromContainingContainers(thing) {');
    const end = source.indexOf('\n        app.post(\'/api/things/:id/drop\'', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate drop placement helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Error,
        Array,
        Thing: {
            getAll: () => []
        }
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.detachThingFromContainingContainers = detachThingFromContainingContainers;`,
        context
    );

    return context;
}

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
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

test('container move-in validation accepts current-location loose items when requested', () => {
    const context = loadContainerMoveHelpers();
    context.currentPlayer = {
        hasInventoryItem: () => false
    };
    const container = {
        id: 'container-id',
        name: 'Crate',
        hasInventoryItem: () => false
    };
    const location = {
        id: 'loc-1',
        thingIds: ['loose-id', 'container-id']
    };
    const looseItem = {
        id: 'loose-id',
        name: 'Loose Gear',
        thingType: 'item',
        isEquipped: false,
        isContainer: false,
        metadata: { locationId: 'loc-1' }
    };

    assert.doesNotThrow(() => context.validateContainerMoveInItems(container, [looseItem], {
        source: 'location',
        location
    }));
    assert.throws(() => context.validateContainerMoveInItems(container, [{ ...looseItem, id: 'elsewhere-id', metadata: { locationId: 'other-loc' } }], {
        source: 'location',
        location
    }), /not in the current location/);
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

test('drop placement helper removes items from containing containers', () => {
    const context = loadDropPlacementHelpers();
    const calls = [];
    const item = { id: 'coin-id', name: 'Coin' };
    const chest = {
        id: 'chest-id',
        hasInventoryItem: thingId => thingId === item.id,
        removeInventoryItem: thingId => {
            calls.push(thingId);
            return true;
        }
    };
    const otherContainer = {
        id: 'other-id',
        hasInventoryItem: () => false,
        removeInventoryItem: () => {
            throw new Error('non-containing container should not be changed');
        }
    };
    context.Thing = {
        getAll: () => [item, chest, otherContainer]
    };

    const touchedContainers = context.detachThingFromContainingContainers(item);

    assert.deepEqual(calls, [item.id]);
    assert.deepEqual(JSON.parse(JSON.stringify(touchedContainers.map(container => container.id))), [chest.id]);
});

test('drop route detaches containing containers before adding item to the location', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const routeSource = extractBlock(
        source,
        "        app.post('/api/things/:id/drop'",
        '\n        // Delete a thing'
    );

    assert.match(routeSource, /const touchedContainers = detachThingFromContainingContainers\(thing\);/);
    assert.match(routeSource, /for \(const container of touchedContainers\) \{[\s\S]*things\.set\(container\.id, container\);[\s\S]*\}/);
});
