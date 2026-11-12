'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const presentation = require('../public/js/item-summary-presentation.js');

test('item summary composition records exact independent snapshots and leaves quantity outside the name', () => {
    const first = { id: 'iron_1', name: 'Iron Ingot', rarity: 'rare' };
    const second = { id: 'iron_2', name: 'Iron Ingot', rarity: 'common' };
    const row = presentation.compose(['Created:\n\n- ', { item: presentation.snapshot(first), quantity: 3 }, '\n- ', { item: presentation.snapshot(second) }, '\nIron Ingot was mentioned in prose.']);
    const mentions = row.metadata.itemMentions;
    assert.equal(mentions.length, 2);
    assert.match(row.text, /\*\*3x\*\* Iron Ingot/);
    assert.deepEqual(mentions.map(({ itemId, rarity }) => ({ itemId, rarity })), [
        { itemId: 'iron_1', rarity: 'rare' }, { itemId: 'iron_2', rarity: 'common' }
    ]);
    assert.ok(mentions.every(mention => row.text.slice(mention.start, mention.end) === 'Iron Ingot'));
    first.name = 'Renamed'; first.rarity = 'legendary';
    const restored = JSON.parse(JSON.stringify(row));
    assert.equal(restored.metadata.itemMentions[0].name, 'Iron Ingot');
    assert.equal(restored.metadata.itemMentions[0].rarity, 'rare');
});

test('item summary snapshots treat literal markup as names and invalid legacy ranges stay neutral', () => {
    const name = '<img src=x onerror=alert(1)> *literal*';
    const row = presentation.compose(['Found ', { item: presentation.snapshot({ id: 'unsafe', name, rarity: 'rare' }) }, '.']);
    const [mention] = row.metadata.itemMentions;
    assert.equal(row.text.slice(mention.start, mention.end), name);
    assert.deepEqual(presentation.normalizeMentions(row.text, undefined), []);
    assert.deepEqual(presentation.normalizeMentions(row.text, [{ ...mention, start: mention.start + 1 }]), []);
});

test('entity mentions use bounded longest literal matches and preserve exact item snapshot precedence', () => {
    const text = 'Mara Voss gave Mara Iron and Iron at North Gate in North; Maritime and Iron prose stay ordinary.';
    const first = text.indexOf('Iron'), second = text.indexOf('Iron', first + 4);
    const itemMentions = [
        { start: first, end: first + 4, name: 'Iron', itemId: 'old', rarity: 'rare' },
        { start: second, end: second + 4, name: 'Iron', itemId: 'new', rarity: 'common' }
    ];
    const refs = [{ type: 'npc', id: 'long', name: 'Mara Voss' }, { type: 'npc', id: 'short', name: 'Mara' },
        { type: 'location', id: 'gate', name: 'North Gate' }, { type: 'region', id: 'north', name: 'North' },
        { type: 'thing', id: 'old', name: 'Iron', rarity: 'rare' }, { type: 'thing', id: 'new', name: 'Iron', rarity: 'common' }];
    const names = presentation.normalizeEntityMentions(text, refs, itemMentions);
    assert.deepEqual(names.map(entry => text.slice(entry.start, entry.end)), ['Mara Voss', 'Mara', 'Iron', 'Iron', 'North Gate', 'North']);
    assert.deepEqual(names.filter(entry => entry.type === 'thing').map(entry => [entry.itemId, entry.rarity]), [['old', 'rare'], ['new', 'common']]);
    const unsafe = '<img src=x> *literal*';
    const literal = presentation.normalizeEntityMentions(`Saw ${unsafe}.`, [{ type: 'npc', id: 'npc', name: unsafe }], []);
    assert.equal(literal.length, 1); assert.equal(literal[0].name, unsafe);
});

test('new-exit entity references retain canonical destination IDs from native metadata', () => {
    const refs = presentation.newExitEntityRefs({ originLocationId: 'loc_origin', originLocationName: 'Origin', originRegionId: 'region_origin', originRegionName: 'Old Region', destinationLocationName: 'Harbor', destinationId: 'loc_harbor', destinationRegionId: 'region_coast', destinationRegionName: 'Coast' });
    assert.deepEqual(refs, [
        { type: 'location', id: 'loc_origin', name: 'Origin' },
        { type: 'region', id: 'region_origin', name: 'Old Region' },
        { type: 'location', id: 'loc_harbor', name: 'Harbor' },
        { type: 'region', id: 'region_coast', name: 'Coast' }
    ]);
    assert.deepEqual(presentation.newExitEntityRefs({ destinationKind: 'region', destinationRegionName: 'Coast', destinationId: 'region_coast' }), [{ type: 'region', id: 'region_coast', name: 'Coast' }]);
});
