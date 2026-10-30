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
    return vm.runInNewContext(`${slice('function buildPreservedCraftIngredientEvents(', 'function resolveCraftConsumedThings(')}\nbuildPreservedCraftIngredientEvents;`, { Set, Number });
}
const plain = value => JSON.parse(JSON.stringify(value));

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
