const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempPlayerDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-party-history-'));

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

test('party history flag defaults false when missing from saved data and persists when present', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'party-history-save-npc',
            name: 'Cabnia',
            isNPC: true
        });

        assert.equal(npc.wasEverInPlayerParty, false);

        npc.wasEverInPlayerParty = true;
        const saved = npc.toJSON();
        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.wasEverInPlayerParty, true);

        const legacySaved = { ...saved };
        delete legacySaved.wasEverInPlayerParty;

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const legacyLoaded = Player.fromJSON(legacySaved);
        assert.equal(legacyLoaded.wasEverInPlayerParty, false);
    });
});

test('adding a party member permanently marks that actor as having been in the party', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'party-history-owner',
            name: 'Baato'
        });
        const member = new Player({
            id: 'party-history-member',
            name: 'Cabnia',
            isNPC: true
        });

        assert.equal(member.wasEverInPlayerParty, false);
        assert.equal(player.addPartyMember(member.id), true);
        assert.equal(member.wasEverInPlayerParty, true);
        assert.equal(member.isInPlayerParty, true);

        const fakeLocation = {
            id: 'party_history_departure',
            name: 'Anchorpoint Station',
            addNpcId() {}
        };
        Object.defineProperty(player, 'currentLocationObject', {
            value: fakeLocation,
            configurable: true
        });

        assert.equal(player.removePartyMember(member.id), true);
        assert.equal(member.wasEverInPlayerParty, true);
        assert.equal(member.isInPlayerParty, false);
    });
});

test('loading an actor already marked as in the party sets the historical party flag', () => {
    withTempPlayerEnvironment(() => {
        const loaded = Player.fromJSON({
            id: 'party-history-load-member',
            name: 'Kess',
            isNPC: true,
            isInPlayerParty: true
        });

        assert.equal(loaded.isInPlayerParty, true);
        assert.equal(loaded.wasEverInPlayerParty, true);
    });
});

test('constructing a player with existing party members marks already-loaded members as historical party members', () => {
    withTempPlayerEnvironment(() => {
        const member = new Player({
            id: 'party-history-existing-member',
            name: 'Slag',
            isNPC: true
        });

        assert.equal(member.wasEverInPlayerParty, false);

        const owner = new Player({
            id: 'party-history-existing-owner',
            name: 'Baato',
            partyMembers: [member.id]
        });

        assert.equal(owner.getPartyMembers().includes(member.id), true);
        assert.equal(member.wasEverInPlayerParty, true);
        assert.equal(member.isInPlayerParty, true);
    });
});
