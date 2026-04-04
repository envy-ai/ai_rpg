const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempPlayerDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-persist-when-dead-'));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', `
attributes:
  strength:
    label: Strength
    default: 5
`);
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', 'need_bars: {}\n');

    return tempBaseDir;
}

function withTempPlayerEnvironment(run) {
    const tempBaseDir = createTempPlayerDefs();
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        formulas: {
            character_creation: {
                attribute_pool_formula: '0',
                skill_pool_formula: '0',
                max_attribute: '18',
                max_skill: '10'
            }
        }
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        run();
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
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
        memberWhoDies.setInPlayerParty(true);
        memberWhoDies.isDead = true;

        assert.equal(memberWhoDies.persistWhenDead, true);
        assert.equal(memberWhoDies.corpseCountdown, null);
    });
});
