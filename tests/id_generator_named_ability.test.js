'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const IdGenerator = require('../IdGenerator.js');
const Player = require('../Player.js');
const { withTempPlayerEnvironment } = require('./helpers/needBarFixtures.js');

test('named IDs use three source words, preserve Unicode, and persist suffix high water', () => {
    IdGenerator.reset();
    try {
        IdGenerator.register('ability', 'ability_salvage_scan_fast_2');
        assert.equal(IdGenerator.next('ability', 'Salvage Scan Fast and Quiet'), 'ability_salvage_scan_fast');
        assert.equal(IdGenerator.nextUniqueNamed('ability', 'SALVAGE scan fast again'), 'ability_salvage_scan_fast_3');
        assert.equal(IdGenerator.next('thing', 'Élan—2! Beyond tomorrow'), 'thing_élan_2_beyond');
        assert.throws(() => IdGenerator.next('ability', '---'), /alphanumeric/);
        const saved = IdGenerator.snapshotNamedCounters();
        IdGenerator.reset();
        IdGenerator.seedNamedCounters(saved);
        assert.equal(IdGenerator.next('ability', 'Salvage Scan Fast elsewhere'), 'ability_salvage_scan_fast_4');
        assert.equal(IdGenerator.next('thing', 'Élan 2 Beyond'), 'thing_élan_2_beyond_2');
    } finally { IdGenerator.reset(); }
});

test('persisted reservations prevent numeric suffixes colliding with other stems', () => {
    IdGenerator.reset();
    try {
        assert.equal(IdGenerator.next('thing', 'Red 2'), 'thing_red_2');
        const saved = IdGenerator.snapshotNamedCounters();
        IdGenerator.reset();
        IdGenerator.seedNamedCounters(saved);
        assert.equal(IdGenerator.next('thing', 'Red'), 'thing_red');
        assert.equal(IdGenerator.next('thing', 'Red'), 'thing_red_3');
    } finally { IdGenerator.reset(); }
});

test('suffix counters reject allocation beyond safe integer precision', () => {
    IdGenerator.reset();
    try {
        IdGenerator.seedNamedCounters({ thing: { stem: Number.MAX_SAFE_INTEGER } });
        assert.throws(() => IdGenerator.next('thing', 'stem'), /safe|overflow|exhaust/i);
    } finally { IdGenerator.reset(); }
});

test('discipline canonical full titles reuse IDs while distinct titles sharing three words do not', () => {
    IdGenerator.reset();
    try {
        assert.equal(IdGenerator.nextNamed('discipline', 'Way of the Crane'), 'discipline_way_of_the');
        assert.equal(IdGenerator.nextNamed('discipline', 'WAY of the crane'), 'discipline_way_of_the');
        assert.equal(IdGenerator.nextNamed('discipline', 'Way of the Tiger'), 'discipline_way_of_the_2');
        assert.equal(IdGenerator.nextNamed('discipline', 'Way of the Tiger'), 'discipline_way_of_the_2');
    } finally { IdGenerator.reset(); }
});

test('ability IDs reserve owned, declined and pending supplied identities and survive rename and save', () => {
    IdGenerator.reset();
    try {
        withTempPlayerEnvironment({ prefix: 'ability-named-ids-' }, () => {
            const card = name => ({ name, description: 'A talent.', type: 'Passive', level: 1 });
            const uuid = '7ea39ee9-b4ce-493a-a193-9a9c34000001';
            const player = new Player({ name: 'Identity Fixture',
                abilities: [card('Salvage Scan'), { ...card('Existing'), id: uuid }],
                declinedAbilities: [{ ...card('Declined'), id: 'ability_salvage_scan' }],
                pendingAbilityOptionsByLevel: { 1: [{ ...card('Pending'), id: 'ability_salvage_scan_2' }] }
            });
            const [generated, existing] = player.getAbilities();
            assert.equal(generated.id, 'ability_salvage_scan_3');
            assert.equal(existing.id, uuid);
            player.setAbilities([{ ...generated, name: 'Renamed Scan' }, existing]);
            player.setPendingAbilityAttachmentDraftsForLevel(1, [{ abilityId: 'ability_salvage_scan_2', draft: { statusEffects: [] } }]);
            const saved = JSON.parse(JSON.stringify(player.toJSON()));
            IdGenerator.reset();
            const restored = Player.fromJSON(saved);
            assert.equal(restored.getAbilities()[0].id, generated.id);
            assert.equal(restored.getAbilities()[0].name, 'Renamed Scan');
            assert.equal(restored.getAbilities()[1].id, uuid);
            assert.equal(restored.getPendingAbilityAttachmentDraftsForLevel(1)[0].abilityId, 'ability_salvage_scan_2');
            assert.equal(IdGenerator.nextUniqueNamed('ability', 'Salvage Scan'), 'ability_salvage_scan_4');
        });
    } finally { IdGenerator.reset(); }
});
