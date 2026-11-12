'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');
function part(start, end) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Missing crafting helper ${start}`);
    return source.slice(from, to);
}
function harness(mode = 'craft') {
    const thing = { id: 'iron_1', name: 'Iron', count: 5 };
    let answer;
    const errors = [];
    const context = {
        craftingInventoryLookup: new Map([[thing.id, thing]]), thingDataCache: new Map([[thing.id, thing]]),
        craftingSlotAssignments: new Map(), craftingQuantitySelections: new Map(),
        craftingQuantitySelectionEnabled: true, currentCraftingMode: mode, currentCraftingTargetType: 'item',
        currentCraftingSlotCount: 2, craftingSourceThing: null, craftingNotesInput: null,
        craftingSlotSession: {}, craftingIsOpen: true, indexedSlotViewsDisposed: false,
        craftingSlotsContainer: null, barterQuantityDialogState: null,
        isItemIdAssignedToAnySlot: id => [...context.craftingSlotAssignments.values()].some(item => item.id === id),
        isCraftingNonEmptyContainer: () => false, cloneThingRecord: value => ({ ...value }),
        markCraftingInventoryItemUsed: () => {}, updateCraftingActionState: () => {},
        requestBarterQuantity: () => new Promise(resolve => { answer = resolve; }),
        window: { AIRPG_PAGE_FEEDBACK: { showError: error => errors.push(error) } },
    };
    vm.createContext(context);
    vm.runInContext(`${part('        function normalizeThingDisplayCount(', '        function getThingCountBadgeText(')}
${part('        function assignItemToCraftingSlot(', '        async function assignDraggedItemToCraftingSlot(')}
${part('        function buildCraftingPayload(', '        async function refreshCraftingRelatedViews(')}
this.assign = assignItemToCraftingSlot; this.payload = buildCraftingPayload; this.key = buildCraftingRequestKey;`, context);
    return { context, thing, errors, answer: value => answer(value) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('unique items without count select one unit without opening a dialog', () => {
    const { context, thing } = harness();
    delete thing.count;
    assert.equal(context.assign(0, thing.id), true);
    assert.equal(context.craftingSlotAssignments.get(0).selectedQuantity, 1);
    assert.equal(context.payload().slots[0].quantity, 1);
});

for (const mode of ['craft', 'process']) test(`${mode} selects stack units without splitting and distinguishes quantity in the request key`, async () => {
    const { context, thing, answer } = harness(mode);
    assert.equal(context.assign(0, thing.id), true);
    assert.equal(context.craftingSlotAssignments.size, 0);
    assert.throws(() => context.payload(), /Finish or cancel/);
    answer(3);
    await settle();
    assert.equal(thing.count, 5);
    const payload = JSON.parse(JSON.stringify(context.payload()));
    assert.equal(payload.slots[0].quantity, 3);
    assert.equal(payload.slots[0].thingId, thing.id);
    const other = { ...payload, slots: [{ ...payload.slots[0], quantity: 2 }] };
    assert.notEqual(context.key(payload), context.key(other));
});

test('cancelled, stale-session, replaced-slot and stale-count quantity choices do not assign stacks', async () => {
    for (const outcome of ['cancel', 'session', 'replaced', 'count']) {
        const { context, thing, answer, errors } = harness();
        assert.equal(context.assign(0, thing.id), true);
        if (outcome === 'session') context.craftingSlotSession = {};
        if (outcome === 'replaced') context.craftingSlotAssignments.set(0, { id: 'replacement' });
        if (outcome === 'count') thing.count = 1;
        answer(outcome === 'cancel' ? null : 3);
        await settle();
        assert.equal(context.craftingSlotAssignments.size, outcome === 'replaced' ? 1 : 0, outcome);
        if (outcome === 'replaced') assert.equal(context.craftingSlotAssignments.get(0).id, 'replacement');
        assert.equal(errors.length, outcome === 'count' ? 1 : 0, outcome);
    }
});
