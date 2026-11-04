'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const IdGenerator = require('../IdGenerator.js');
const DomainIdMigration = require('../DomainIdMigration.js');

function fixture() {
    return {
        metadata: { saveFileSaveVersion: 1.2, playerId: 'char_1' },
        gameWorld: {
            regions: { region_1: { id: 'region_1', name: 'North March', locationIds: ['loc_1'], entranceLocationId: 'loc_1' } },
            locations: { loc_1: { id: 'loc_1', name: 'Old Gate', regionId: 'region_1', thingIds: ['thing_1'], npcIds: ['char_1'], description: 'The literal char_1 is written here.' } },
            locationExits: {}
        },
        things: { thing_1: { id: 'thing_1', name: 'Copper Key', description: 'A key.', thingType: 'item' } },
        players: { char_1: { id: 'char_1', name: 'Mira Vale', currentLocation: 'loc_1', inventory: ['thing_1'], quests: [
            { id: 'quest_1', name: 'Find the Key', description: 'Find it.', objectives: [{ id: 'obj_1', description: 'Find the key' }] }
        ], abilities: [{ id: 'ability_1', name: 'Keen Eye', description: 'Watch closely.', type: 'Passive', level: 1 }],
        pendingAbilityOptionsByLevel: { 2: [{ id: 'ability_2', name: 'Quick Step', description: 'Move quickly.', type: 'Passive', level: 2 }] },
        pendingAbilityAttachmentDraftsByLevel: { 2: [{ abilityId: 'ability_2', draft: { statusEffects: [] } }] }
        } },
        factions: {}, pendingRegionStubs: {}, chatHistory: [{ role: 'assistant', content: 'char_1', metadata: { locationId: 'loc_1' } }]
    };
}

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
        assert.equal(serialized.gameWorld.locations.loc_old_gate.description, 'The literal char_1 is written here.');
        assert.equal(serialized.chatHistory[0].content, 'char_1');
        assert.equal(serialized.chatHistory[0].metadata.locationId, 'loc_old_gate');
        assert.ok(Object.values(counts).some(value => value > 0));
        assert.deepEqual(DomainIdMigration.prepare(serialized).serialized, serialized, 'running twice is idempotent');
    } finally { IdGenerator.reset(); }
});

test('migration rewrites derived route and party reward identities with their applied references', () => {
    const source = fixture();
    source.gameWorld.locationExits.exit_1 = { id: 'exit_1', description: 'Hidden Stair', destination: 'loc_1' };
    const quest = source.players.char_1.quests[0];
    quest.rewardBenefits = [
        { id: 'party-member:char_1', type: 'party-member', targetId: 'char_1' },
        { id: 'knowledge-route:loc_1:exit_1', type: 'knowledge', subtype: 'route', sourceLocationId: 'loc_1', targetId: 'exit_1', destinationLocationId: 'loc_1' }
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
    source.runtimeIdMigrationState = { playerArrivalVisitStates: { loc_1: { arrivalId: 'loc_1', wasVisited: false, lastVisitedTime: 7 } }, processedMove: true };
    const result = DomainIdMigration.prepare(source).serialized.runtimeIdMigrationState;
    assert.deepEqual(result.playerArrivalVisitStates.loc_old_gate, { arrivalId: 'loc_1', wasVisited: false, lastVisitedTime: 7 });
    assert.equal(result.processedMove, true);
});
