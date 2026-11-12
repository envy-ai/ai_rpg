'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
function slice(startText, endText) {
    const start = source.indexOf(startText), end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start, `Missing craft seam: ${startText}`);
    return source.slice(start, end);
}
function makeHelper() {
    const presentation = require('../public/js/item-summary-presentation.js');
    return vm.runInNewContext(`${slice('function buildPreservedCraftIngredientEvents(', 'function resolveCraftConsumedThings(')}\nbuildPreservedCraftIngredientEvents;`, { Set, Number, ItemSummaryPresentation: presentation, composeItemSummary: presentation.composeRow });
}
const plain = value => JSON.parse(JSON.stringify(value));

test('craft result summaries show stack quantities and bullet separate item types', () => {
    const context = vm.runInNewContext(`${slice('function formatCraftSummaryItem(', 'function resolveCraftConsumption(')}
        ({ item: formatCraftSummaryItem, summary: formatCraftItemResultSummary });`);
    assert.equal(context.item({ name: 'Iron Ingot', count: 3 }), '**3x** Iron Ingot');
    assert.equal(context.item({ name: 'Hammer', count: 1 }), 'Hammer');
    const output = context.summary('Hero', 'crafted', ['**3x** Iron Ingot', 'Nails'], 'at the forge');
    assert.match(output, /\n- \*\*3x\*\* Iron Ingot\n- Nails/);
    const ingredients = context.summary('Hero', 'crafted', ['Blade'], 'at the forge', ['**3x** Iron Ingot', 'Wood']);
    assert.match(ingredients, /\n- \*\*3x\*\* Iron Ingot\n- Wood/);
});

test('native craft and process output, sources and preservation snapshots survive summary recording', () => {
    const presentation = require('../public/js/item-summary-presentation.js');
    const compose = vm.runInNewContext(`${slice('function formatCraftSummaryItem(', 'function resolveCraftConsumption(')}\ncomposeCraftItemResultSummary;`, { composeItemSummary: presentation.composeRow });
    const output = { id: 'output', name: 'Copper Blade', rarity: 'rare', count: 2 };
    const source = { id: 'source', name: 'Iron', rarity: 'common', count: 5 };
    const outputPart = { item: presentation.snapshot(output), quantity: 2 };
    const sourcePart = { item: presentation.snapshot(source), quantity: 3 };
    const crafted = compose('Hero', 'crafted', [outputPart], ['using ', sourcePart], [sourcePart]);
    const processed = compose('Hero', 'processed', [outputPart], ['using ', sourcePart]);
    const preserved = makeHelper()({ mode: 'craft', craftedThings: [output], inputThings: [source], consumedThingIds: ['source'], selectedQuantities: new Map([['source', 5]]), consumedItems: [{ thingId: 'source', quantity: 3 }] })[0];
    const { context, history } = makeSummaryRecorder();
    context.record({ events: [crafted, processed, preserved], locationId: 'loc' });
    output.name = 'Changed'; output.rarity = 'common'; source.name = 'Deleted'; source.rarity = 'rare';
    const rows = JSON.parse(JSON.stringify(history))[0].summaryItems;
    assert.equal(rows.length, 3);
    for (const row of rows.slice(0, 2)) {
        assert.deepEqual(row.metadata.itemMentions.map(item => [item.name, item.rarity]), [['Copper Blade', 'rare'], ['Iron', 'common']]);
        assert.match(row.text, /\*\*2x\*\* Copper Blade/);
    }
    assert.deepEqual(rows[2].metadata.itemMentions.map(item => [item.name, item.rarity]), [['Iron', 'common']]);
    assert.match(rows[2].text, /\*\*2x\*\* Iron/);
});

test('native barter producer carries transaction item quality into saved summary rows', () => {
    const presentation = require('../public/js/item-summary-presentation.js');
    const build = vm.runInNewContext(`${slice('function formatBarterSummaryItem(', 'function buildBarterNpcActionContext(')}\nbuildBarterTradeSummaryEvents;`, {
        currentPlayer: { id: 'p', name: 'Hero' }, currentSetting: null,
        summaryEntityRef: (_type, ref) => [{ type: 'npc', ...ref }],
        composeItemSummary: presentation.composeRow, ItemSummaryPresentation: presentation,
        getCurrencyLabel: () => 'coins'
    });
    const transaction = { receivedByMerchant: [{ id: 'sold', name: 'Iron', rarity: 'rare', count: 3 }], receivedByPlayer: [{ id: 'bought', name: 'Iron', rarity: 'common', count: 1 }] };
    const events = build({ npc: { id: 'm', name: 'Merchant' }, transaction });
    const { context, history } = makeSummaryRecorder();
    context.record({ events, locationId: 'loc' });
    transaction.receivedByMerchant[0].rarity = 'common';
    const rows = JSON.parse(JSON.stringify(history))[0].summaryItems;
    assert.deepEqual(rows.map(row => row.metadata.itemMentions[0].rarity), ['rare', 'common']);
    assert.deepEqual(rows.map(row => row.metadata.itemMentions[0].itemId), ['sold', 'bought']);
    assert.match(rows[0].text, /\*\*3x\*\* Iron/);
});

test('preserved bonus reports only selected units left after partial stack consumption', () => {
    const build = makeHelper();
    const inputThings = [{ id: 'iron', name: 'Iron Ingot', count: 8 }];
    const base = { mode: 'craft', craftedThings: [{ id: 'output' }], inputThings,
        selectedQuantities: new Map([['iron', 5]]), consumedThingIds: ['iron'] };
    const rows = plain(build({ ...base, consumedItems: [{ thingId: 'iron', quantity: 2 }] }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].description, 'Bonus: **3x** Iron Ingot were not consumed.');
    assert.equal(rows[0].entityRefs[0].id, 'iron');
    assert.deepEqual(plain(build({ ...base, consumedItems: [{ thingId: 'iron', quantity: 5 }] })), []);
    assert.deepEqual(plain(build({ ...base, mode: 'process', consumedItems: [{ thingId: 'iron', quantity: 2 }] })), []);
});

test('craft bonuses identify selected, actually unconsumed IDs and preserve distinct same-name ingredients', () => {
    const build = makeHelper();
    const station = { id: 'station', name: 'Workbench' };
    const inputs = [
        { id: 'consumed', name: 'Iron', count: 4 }, { id: 'same-name', name: 'Iron' },
        { id: 'stack', name: 'Seed <&>', count: 3 }, { id: 'same-name', name: 'Iron' }, station
    ];
    const options = { mode: 'craft', craftedThings: [{ id: 'output' }], inputThings: inputs, consumedThingIds: ['consumed'], stationThingId: station.id };
    const rows = plain(build(options));
    assert.deepEqual(rows.map(row => row.entityRefs[0].id), ['same-name', 'stack']);
    assert.equal(rows[0].description, 'Bonus: Iron was not consumed.');
    assert.equal(rows[1].description, 'Bonus: 1 unit of Seed <&> was not consumed.');
    assert.ok(rows.every(row => row.category === 'inventory' && row.sourceType === 'craft_ingredient_preserved'));
    assert.deepEqual(plain(build({ ...options, consumedThingIds: ['consumed', 'same-name', 'stack'] })), []);
    assert.deepEqual(plain(build({ ...options, craftedThings: [] })), []);
    for (const mode of ['process', 'salvage', 'harvest']) assert.deepEqual(plain(build({ ...options, mode })), []);
    // Even a failed roll can produce a real output; no tier-based exclusion is applied.
    assert.equal(build({ ...options, resultLevel: 'failure' }).length, 2);
});

function makeSummaryRecorder() {
    const history = [];
    const context = {
        chatHistory: history, console, Date, Map, Set, SanitizedStringSet: require('../SanitizedStringSet.js'),
        ItemSummaryPresentation: require('../public/js/item-summary-presentation.js'),
        Globals: { currentPlayer: null, region: null }, normalizeNewExitSummaryText: value => String(value || '').trim(),
        requireLocationId: id => id,
        pushChatEntry: (entry, _collector, locationId) => {
            const stored = { ...entry, id: `entry-${history.length + 1}`, locationId };
            history.push(stored); return stored;
        }
    };
    vm.createContext(context);
    const summarySource = slice('const EVENT_LOCATION_REFRESH_TYPES =', 'function recordStatusSummaryEntry(');
    vm.runInContext(`${summarySource}\nthis.record = recordEventSummaryEntry;`, context);
    return { context, history };
}

test('craft result parent and actual event-summary recorder persist bonus rows for prose and no-prose', () => {
    const build = makeHelper();
    const rows = plain(build({ mode: 'craft', craftedThings: [{ id: 'result' }],
        inputThings: [{ id: 'seed', name: 'Seed <&>' }], consumedThingIds: [] }));
    const noProseBlock = slice('if (isNoProseRequest) {\n                    playerActionDescription = primaryActionSummaryText;', '} else {\n                    let playerActionResponse');
    const noProseSummary = slice('if (isNoProseRequest && preservedIngredientEvents.length) {', '\n\n                const craftingTimeProgress');
    const prosePush = slice('eventItems.push(...preservedIngredientEvents);', '\n\n                    if (actionOutcome.success');
    for (const noProse of [false, true]) {
        const { context, history } = makeSummaryRecorder();
        Object.assign(context, { preservedIngredientEvents: rows, isNoProseRequest: noProse,
            primaryActionSummaryText: 'Hero crafted a potion.', craftingMode: 'craft', resolvedLocationId: 'loc1',
            playerActionDescription: '', playerOtherEffect: '', chatEntry: null, eventItems: [] });
        if (noProse) {
            vm.runInContext(`${noProseBlock}}\nthis.chatEntry = chatEntry;`, context);
            vm.runInContext(noProseSummary, context);
        } else {
            context.chatEntry = context.pushChatEntry({ role: 'assistant', type: 'player-action', content: 'Hero crafted a potion.' }, null, 'loc1');
            vm.runInContext(prosePush, context);
            context.record({ label: '🛠️ Crafting Results', events: context.eventItems, parentId: context.chatEntry.id, locationId: 'loc1' });
        }
        const restored = JSON.parse(JSON.stringify(history));
        assert.equal(restored.length, 2);
        assert.equal(restored[1].parentId, restored[0].id);
        assert.equal(restored[1].summaryItems[0].text, 'Bonus: Seed <&> was not consumed.');
        assert.equal(restored[1].summaryItems[0].category, 'inventory');
        assert.equal(restored[1].summaryItems[0].entityRefs[0].id, 'seed');
        if (noProse) {
            assert.equal(restored[0].type, 'crafting-result');
            assert.equal(restored[0].metadata.excludeFromBaseContextHistory, true);
        }
    }
});
