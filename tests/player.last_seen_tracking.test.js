const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-last-seen-',
        currentPlayer: 'restore'
    }, run);
}

test('NPC last-seen fields update only for NPCs sharing the player location', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'last-seen-player',
            name: 'Baato',
            location: 'town-square'
        });
        const presentNpc = new Player({
            id: 'last-seen-present',
            name: 'Mira',
            isNPC: true,
            location: 'town-square'
        });
        const absentNpc = new Player({
            id: 'last-seen-absent',
            name: 'Orrin',
            isNPC: true,
            location: 'old-road'
        });

        const updated = Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 135,
            locationId: 'town-square'
        });

        assert.deepEqual(updated.map(actor => actor.id), ['last-seen-present']);
        assert.equal(presentNpc.last_seen_time, 135);
        assert.equal(presentNpc.last_seen_location, 'town-square');
        assert.equal(presentNpc.was_in_player_location_previous_round, true);
        assert.equal(absentNpc.last_seen_time, null);
        assert.equal(absentNpc.last_seen_location, null);
        assert.equal(absentNpc.was_in_player_location_previous_round, false);

        presentNpc.setLocation(null);
        const secondUpdate = Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 180,
            locationId: 'town-square'
        });

        assert.deepEqual(secondUpdate, []);
        assert.equal(presentNpc.last_seen_time, 135);
        assert.equal(presentNpc.last_seen_location, 'town-square');
        assert.equal(presentNpc.was_in_player_location_previous_round, false);
    });
});

test('NPC last-seen previous-round flag stays false for newly encountered NPCs', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'last-seen-moving-player',
            name: 'Baato',
            location: 'old-road'
        });
        const originNpc = new Player({
            id: 'last-seen-origin',
            name: 'Orrin',
            isNPC: true,
            location: 'old-road'
        });
        const destinationNpc = new Player({
            id: 'last-seen-destination',
            name: 'Mira',
            isNPC: true,
            location: 'town-square',
            last_seen_time: 60,
            last_seen_location: 'market'
        });

        const sharedAtTurnStart = Player.getNpcIdsSharingPlayerLocation({
            player,
            locationId: 'old-road'
        });
        assert.deepEqual(sharedAtTurnStart, ['last-seen-origin']);

        Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 135,
            locationId: 'town-square',
            previouslySharedNpcIds: sharedAtTurnStart
        });

        assert.equal(originNpc.was_in_player_location_previous_round, false);
        assert.equal(destinationNpc.last_seen_time, 135);
        assert.equal(destinationNpc.last_seen_location, 'town-square');
        assert.equal(destinationNpc.was_in_player_location_previous_round, false);

        const sharedAtNextTurnStart = Player.getNpcIdsSharingPlayerLocation({
            player,
            locationId: 'town-square'
        });
        assert.deepEqual(sharedAtNextTurnStart, ['last-seen-destination']);

        Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 180,
            locationId: 'town-square',
            previouslySharedNpcIds: sharedAtNextTurnStart
        });

        assert.equal(destinationNpc.last_seen_time, 180);
        assert.equal(destinationNpc.last_seen_location, 'town-square');
        assert.equal(destinationNpc.was_in_player_location_previous_round, true);
    });
});

test('NPC last-seen fields persist through Player JSON', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'last-seen-save',
            name: 'Kess',
            isNPC: true,
            last_seen_time: 240,
            last_seen_location: 'dockside',
            was_in_player_location_previous_round: true
        });

        const saved = npc.toJSON();
        assert.equal(saved.last_seen_time, 240);
        assert.equal(saved.last_seen_location, 'dockside');
        assert.equal(saved.was_in_player_location_previous_round, true);

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.last_seen_time, 240);
        assert.equal(loaded.last_seen_location, 'dockside');
        assert.equal(loaded.was_in_player_location_previous_round, true);

        const legacyLoaded = Player.fromJSON({
            id: 'last-seen-legacy',
            name: 'Legacy NPC',
            isNPC: true
        });
        assert.equal(legacyLoaded.last_seen_time, null);
        assert.equal(legacyLoaded.last_seen_location, null);
        assert.equal(legacyLoaded.was_in_player_location_previous_round, false);
    });
});

test('hidden NPC state persists and hidden NPCs are not recorded as seen', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'hidden-state-player',
            name: 'Baato',
            location: 'atrium'
        });
        const hiddenNpc = new Player({
            id: 'hidden-state-npc',
            name: 'Mira',
            isNPC: true,
            location: 'atrium',
            hiddenFromPlayer: true
        });

        assert.equal(hiddenNpc.hiddenFromPlayer, true);

        const updated = Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 300,
            locationId: 'atrium'
        });

        assert.deepEqual(updated, []);
        assert.equal(hiddenNpc.last_seen_time, null);
        assert.equal(hiddenNpc.last_seen_location, null);

        hiddenNpc.hiddenFromPlayer = false;
        assert.equal(hiddenNpc.hiddenFromPlayer, false);

        const visibleUpdated = Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 305,
            locationId: 'atrium'
        });

        assert.deepEqual(visibleUpdated.map(actor => actor.id), ['hidden-state-npc']);
        assert.equal(hiddenNpc.last_seen_time, 305);
        assert.equal(hiddenNpc.last_seen_location, 'atrium');

        hiddenNpc.hiddenFromPlayer = true;
        const saved = hiddenNpc.toJSON();
        assert.equal(saved.hiddenFromPlayer, true);

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.hiddenFromPlayer, true);
    });
});

test('hidden corpses are treated as visible for NPC sighting records', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'hidden-corpse-player',
            name: 'Baato',
            location: 'crypt'
        });
        const hiddenCorpse = new Player({
            id: 'hidden-corpse-npc',
            name: 'Fallen Scout',
            isNPC: true,
            location: 'crypt',
            hiddenFromPlayer: true,
            isDead: true
        });

        assert.equal(hiddenCorpse.hiddenFromPlayer, false);

        const updated = Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 410,
            locationId: 'crypt'
        });

        assert.deepEqual(updated.map(actor => actor.id), ['hidden-corpse-npc']);
        assert.equal(hiddenCorpse.last_seen_time, 410);
        assert.equal(hiddenCorpse.last_seen_location, 'crypt');

        hiddenCorpse.hiddenFromPlayer = true;
        assert.equal(hiddenCorpse.hiddenFromPlayer, false);
    });
});

test('dying clears hidden NPC state', () => {
    withTempPlayerEnvironment(() => {
        const hiddenNpc = new Player({
            id: 'hidden-dies-npc',
            name: 'Mira',
            isNPC: true,
            location: 'atrium',
            hiddenFromPlayer: true
        });

        assert.equal(hiddenNpc.hiddenFromPlayer, true);
        hiddenNpc.isDead = true;
        assert.equal(hiddenNpc.hiddenFromPlayer, false);
    });
});
