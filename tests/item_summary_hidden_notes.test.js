'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ItemSummaryPresentation = require('../public/js/item-summary-presentation.js');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('function shouldShowHiddenNotes(');
const end = source.indexOf('\nGlobals.stripHiddenNotesFromText =', start);
assert.ok(start >= 0 && end > start);
const filters = vm.runInNewContext(`${source.slice(start, end)}\n({ entry: filterHiddenNotesFromChatEntryForClient, payload: filterHiddenNotesFromClientPayload });`, { ItemSummaryPresentation, config: {} });
function row(text, name) {
    const start = text.indexOf(name);
    return { text, metadata: { itemMentions: [{ start, end: start + name.length, name, itemId: 'thing_1', rarity: 'rare' }] } };
}
function assertMention(item, name) {
    assert.equal(item.metadata.itemMentions.length, 1);
    const [mention] = item.metadata.itemMentions;
    assert.equal(item.text.slice(mention.start, mention.end), name);
}

test('hidden-note filtering rebases exact saved mention ranges through nested payloads and leaves stored history untouched', () => {
    const original = row('  <hidden>secret</hidden>\n\n\nFound Iron Ingot.   ', 'Iron Ingot');
    const entry = { type: 'event-summary', summaryItems: [original] };
    const saved = JSON.parse(JSON.stringify(entry));
    const filtered = filters.entry(entry, {});
    assert.equal(filtered.summaryItems[0].text, 'Found Iron Ingot.');
    assertMention(filtered.summaryItems[0], 'Iron Ingot');
    const nested = filters.payload({ history: [entry], entry }, {});
    assertMention(nested.history[0].summaryItems[0], 'Iron Ingot');
    assertMention(nested.entry.summaryItems[0], 'Iron Ingot');
    assert.deepEqual(entry, saved);
});

test('hidden content intersecting an item or an unclosed hidden suffix never leaves a stale mention', () => {
    const overlap = row('Found <hidden>Iron Ingot</hidden>.', 'Iron Ingot');
    const after = row('Found Iron Ingot. <hidden>secret', 'Iron Ingot');
    const result = filters.payload({ summaryItems: [overlap, after] }, {});
    assert.equal(result.summaryItems[0].metadata.itemMentions.length, 0);
    assertMention(result.summaryItems[1], 'Iron Ingot');
    const unchanged = filters.payload({ summaryItems: [overlap] }, { show_hidden_notes: true });
    assert.equal(unchanged.summaryItems[0].text, overlap.text);
});
