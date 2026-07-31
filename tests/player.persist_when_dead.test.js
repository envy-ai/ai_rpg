const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-persist-when-dead-',
        currentPlayer: 'null'
    }, run);
}

test('persistWhenDead saves, loads, and defaults to false when missing from saved data', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'persist-save-npc',
            name: 'Cabnia',
            isNPC: true,
            persistWhenDead: true
        });

        assert.equal(npc.persistWhenDead, true);

        const saved = npc.toJSON();
        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.persistWhenDead, true);

        const legacySaved = { ...saved };
        delete legacySaved.persistWhenDead;

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const legacyLoaded = Player.fromJSON(legacySaved);
        assert.equal(legacyLoaded.persistWhenDead, false);
    });
});

test('persistWhenDead suppresses corpse countdowns for dead actors', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'persist-corpse-npc',
            name: 'Felled Scout',
            isNPC: true
        });

        npc.isDead = true;
        assert.equal(npc.corpseCountdown, 5);

        npc.persistWhenDead = true;
        assert.equal(npc.corpseCountdown, null);

        npc.updateCorpseCountdown();
        npc.finalizeTurn();
        assert.equal(npc.corpseCountdown, null);

        const loadedDead = Player.fromJSON({
            ...npc.toJSON(),
            isDead: true,
            persistWhenDead: true,
            corpseCountdown: null
        });
        assert.equal(loadedDead.persistWhenDead, true);
        assert.equal(loadedDead.corpseCountdown, null);
    });
});

test('party joins, party leaves, and party-member deaths all enable persistWhenDead', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'persist-owner',
            name: 'Baato'
        });
        Globals.currentPlayer = player;
        const member = new Player({
            id: 'persist-member',
            name: 'Cabnia',
            isNPC: true
        });

        assert.equal(member.persistWhenDead, false);
        assert.equal(player.addPartyMember(member.id), true);
        assert.equal(member.persistWhenDead, true);

        member.persistWhenDead = false;
        const fakeLocation = {
            id: 'location_party_departure',
            name: 'Anchorpoint Station',
            addNpcId() {}
        };
        Object.defineProperty(player, 'currentLocationObject', {
            value: fakeLocation,
            configurable: true
        });

        assert.equal(player.removePartyMember(member.id), true);
        assert.equal(member.persistWhenDead, true);

        const memberWhoDies = new Player({
            id: 'persist-death-member',
            name: 'Kess',
            isNPC: true
        });
        assert.equal(player.addPartyMember(memberWhoDies.id), true);
        memberWhoDies.persistWhenDead = false;
        memberWhoDies.isDead = true;

        assert.equal(memberWhoDies.persistWhenDead, true);
        assert.equal(memberWhoDies.corpseCountdown, null);
    });
});
