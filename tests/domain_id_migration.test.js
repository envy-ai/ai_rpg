'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const IdGenerator = require('../IdGenerator.js');
const DomainIdMigration = require('../DomainIdMigration.js');

function fixture() {
    return {
        metadata: { saveFileSaveVersion: 1.2, playerId: 'legacy_char_1' },
        gameWorld: {
            regions: { legacy_region_1: { id: 'legacy_region_1', name: 'North March', locationIds: ['legacy_loc_1'], entranceLocationId: 'legacy_loc_1' } },
            locations: { legacy_loc_1: { id: 'legacy_loc_1', name: 'Old Gate', regionId: 'legacy_region_1', thingIds: ['legacy_thing_1'], npcIds: ['legacy_char_1'], description: 'The literal legacy_char_1 is written here.' } },
            locationExits: {}
        },
        things: { legacy_thing_1: { id: 'legacy_thing_1', name: 'Copper Key', description: 'A key.', thingType: 'item' } },
        players: { legacy_char_1: { id: 'legacy_char_1', name: 'Mira Vale', currentLocation: 'legacy_loc_1', inventory: ['legacy_thing_1'], quests: [
            { id: 'legacy_quest_1', name: 'Find the Key', description: 'Find it.', objectives: [{ id: 'legacy_obj_1', description: 'Find the key' }] }
        ], abilities: [{ id: 'legacy_ability_1', name: 'Keen Eye', description: 'Watch closely.', type: 'Passive', level: 1 }],
        pendingAbilityOptionsByLevel: { 2: [{ id: 'legacy_ability_2', name: 'Quick Step', description: 'Move quickly.', type: 'Passive', level: 2 }] },
        pendingAbilityAttachmentDraftsByLevel: { 2: [{ abilityId: 'legacy_ability_2', draft: { statusEffects: [] } }] }
        } },
        factions: {}, pendingRegionStubs: {}, chatHistory: [{ role: 'assistant', content: 'legacy_char_1', metadata: { locationId: 'legacy_loc_1' } }]
    };
}

test('migration preserves already-conforming numeric domain IDs and their references', () => {
    const source = { metadata: { saveFileSaveVersion: 1.2, playerId: 'char_1' },
        gameWorld: { regions: {}, locations: {}, locationExits: {} },
        players: { char_1: { id: 'char_1', name: 'Mira', inventory: ['thing_1'] } },
        things: { thing_1: { id: 'thing_1', name: 'Key', description: 'A key.', thingType: 'item' } },
        factions: {}, pendingRegionStubs: {}, chatHistory: [] };
    const { serialized } = DomainIdMigration.prepare(source);
    assert.equal(serialized.metadata.playerId, 'char_1');
    assert.deepEqual(serialized.players.char_1.inventory, ['thing_1']);
    assert.equal(serialized.things.thing_1.id, 'thing_1');
    assert.deepEqual(DomainIdMigration.prepare(serialized).serialized, serialized);
});

test('migration rewrites structured references and pending drafts without mutating input or allocator', () => {
    IdGenerator.reset();
    try {
        IdGenerator.next('thing', 'Already Reserved');
        const counters = IdGenerator.snapshotNamedCounters();
        const original = fixture();
        const copy = structuredClone(original);
        const { serialized, counts } = DomainIdMigration.prepare(original);
        assert.deepEqual(original, copy);
        assert.deepEqual(IdGenerator.snapshotNamedCounters(), counters);
        assert.equal(serialized.metadata.playerId, 'char_mira_vale');
        const player = serialized.players.char_mira_vale;
        assert.equal(player.currentLocation, 'loc_old_gate');
        assert.deepEqual(player.inventory, ['thing_copper_key']);
        assert.equal(player.quests[0].id, 'quest_find_the_key');
        assert.equal(player.quests[0].objectives[0].id, 'obj_find_the_key');
        assert.equal(player.pendingAbilityOptionsByLevel[2][0].id, 'ability_quick_step');
        assert.equal(player.pendingAbilityAttachmentDraftsByLevel[2][0].abilityId, 'ability_quick_step');
        assert.equal(serialized.gameWorld.locations.loc_old_gate.regionId, 'region_north_march');
        assert.equal(serialized.gameWorld.locations.loc_old_gate.description, 'The literal legacy_char_1 is written here.');
        assert.equal(serialized.chatHistory[0].content, 'legacy_char_1');
        assert.equal(serialized.chatHistory[0].metadata.locationId, 'loc_old_gate');
        assert.ok(Object.values(counts).some(value => value > 0));
        assert.deepEqual(DomainIdMigration.prepare(serialized).serialized, serialized, 'running twice is idempotent');
    } finally { IdGenerator.reset(); }
});

test('migration rewrites derived route and party reward identities with their applied references', () => {
    const source = fixture();
    source.gameWorld.locationExits.legacy_exit_1 = { id: 'legacy_exit_1', description: 'Hidden Stair', destination: 'legacy_loc_1' };
    const quest = source.players.legacy_char_1.quests[0];
    quest.rewardBenefits = [
        { id: 'party-member:legacy_char_1', type: 'party-member', targetId: 'legacy_char_1' },
        { id: 'knowledge-route:legacy_loc_1:legacy_exit_1', type: 'knowledge', subtype: 'route', sourceLocationId: 'legacy_loc_1', targetId: 'legacy_exit_1', destinationLocationId: 'legacy_loc_1' }
    ];
    quest.appliedRewardBenefitIds = quest.rewardBenefits.map(item => item.id);
    const result = DomainIdMigration.prepare(source).serialized.players.char_mira_vale.quests[0];
    assert.equal(result.rewardBenefits[0].id, 'party-member:char_mira_vale');
    assert.equal(result.rewardBenefits[1].id, 'knowledge-route:loc_old_gate:exit_hidden_stair');
    assert.deepEqual(result.appliedRewardBenefitIds, result.rewardBenefits.map(item => item.id));
    assert.equal(result.rewardBenefits[1].sourceLocationId, 'loc_old_gate');
    assert.equal(result.rewardBenefits[1].targetId, 'exit_hidden_stair');
});

test('arrival cache keys migrate without rewriting an operational arrival ID that matches an old ID', () => {
    const source = fixture();
    source.runtimeIdMigrationState = { playerArrivalVisitStates: { legacy_loc_1: { arrivalId: 'legacy_loc_1', wasVisited: false, lastVisitedTime: 7 } }, processedMove: true };
    const result = DomainIdMigration.prepare(source).serialized.runtimeIdMigrationState;
    assert.deepEqual(result.playerArrivalVisitStates.loc_old_gate, { arrivalId: 'legacy_loc_1', wasVisited: false, lastVisitedTime: 7 });
    assert.equal(result.processedMove, true);
});

test('migration rewrites charge receipt references while preserving operation identity', () => {
    const source = fixture();
    source.things.legacy_thing_2 = { id: 'legacy_thing_2', name: 'Rounds', description: 'Ammunition.', thingType: 'item', ammoType: 'round', count: 2 };
    source.things.legacy_thing_1.chargePool = { mode: 'discrete', amount: 1, capacity: 5, unit: 'rounds', ammoType: 'round' };
    source.itemCharges = { version: 1, operations: [{ operationId: 'reload-1', request: { kind: 'reload', actorId: 'legacy_char_1', itemId: 'legacy_thing_1', ammoItemId: 'legacy_thing_2' }, result: { operationId: 'reload-1', kind: 'reload', actorId: 'legacy_char_1', itemId: 'legacy_thing_1', ammoItemId: 'legacy_thing_2', amount: 1, before: 0, after: 1, remainingAmmo: 1, unit: 'rounds' } }] };
    const record = DomainIdMigration.prepare(source).serialized.itemCharges.operations[0];
    assert.equal(record.operationId, 'reload-1');
    assert.equal(record.request.actorId, 'char_mira_vale');
    assert.equal(record.request.itemId, 'thing_copper_key');
    assert.equal(record.request.ammoItemId, 'thing_rounds');
    assert.equal(record.result.itemId, 'thing_copper_key');
    assert.equal(record.result.ammoItemId, 'thing_rounds');
});

test('migration rewrites charge cost keys and ordinary attack payment mutation IDs', () => {
    const source = fixture();
    source.itemCharges = { version: 1, operations: [{ operationId: 'attack-1', request: { kind: 'ordinaryAttack', actorId: 'legacy_char_1', itemId: 'legacy_thing_1' }, result: { chargePayment: { operationId: 'attack-1', itemId: 'legacy_thing_1', mutationId: 'attack-1:charge:legacy_thing_1', amount: 1, before: 2, after: 1 } } }] };
    source.extraStructured = { key: 'charge:legacy_thing_1' };
    const result = DomainIdMigration.prepare(source).serialized;
    assert.equal(result.extraStructured.key, 'charge:thing_copper_key');
    assert.equal(result.itemCharges.operations[0].result.chargePayment.mutationId, 'attack-1:charge:thing_copper_key');
});

test('migration rewrites NPC ordinary attack operation and payment identities', () => {
    const source = fixture();
    const op = 'npc-action-1:ordinaryAttack:npc:legacy_char_1';
    source.itemCharges = { version: 1, operations: [{ operationId: op, request: { kind: 'ordinaryAttack', actorId: 'legacy_char_1', itemId: 'legacy_thing_1', entry: { attacker: 'legacy_char_1', defender: 'enemy', weapon: 'legacy_thing_1', chargeUse: 'powered' }, dieRollOverride: null }, result: { chargePayment: { operationId: op, itemId: 'legacy_thing_1', mutationId: `${op}:charge:legacy_thing_1`, amount: 1, before: 2, after: 1 } } }] };
    const record = DomainIdMigration.prepare(source).serialized.itemCharges.operations[0];
    const migratedOp = 'npc-action-1:ordinaryAttack:npc:char_mira_vale';
    assert.equal(record.operationId, migratedOp);
    assert.equal(record.result.chargePayment.operationId, migratedOp);
    assert.equal(record.result.chargePayment.mutationId, `${migratedOp}:charge:thing_copper_key`);
});
