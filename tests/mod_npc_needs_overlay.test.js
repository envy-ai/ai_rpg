const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const {
    clearFrozenEnabledModManifests,
    freezeEnabledModManifests
} = require('../ModDiscovery.js');

test('defs-only party-needs mod enables food and rest need bars for the player and party members only when explicitly enabled', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const repoBaseDir = path.resolve(__dirname, '..');

    Player.clearRuntimeRegistries();
    Globals.baseDir = repoBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        mods: {
            ...((previousConfig && typeof previousConfig === 'object' && previousConfig.mods && typeof previousConfig.mods === 'object' && !Array.isArray(previousConfig.mods))
                ? previousConfig.mods
                : {}),
            'party-needs': {
                enabled: true
            }
        },
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
    clearFrozenEnabledModManifests(repoBaseDir);
    freezeEnabledModManifests(repoBaseDir, { config: Globals.config });
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const player = new Player({
            id: 'npc-needs-demo-player-test',
            name: 'Baato'
        });
        const npc = new Player({
            id: 'npc-needs-demo-test',
            name: 'Quartermaster Sola',
            isNPC: true
        });

        const playerNeedBarIds = player.getNeedBars({ scope: 'active' }).map(bar => bar.id);
        assert.ok(playerNeedBarIds.includes('food'));
        assert.ok(playerNeedBarIds.includes('rest'));

        const nonPartyNeedBarIds = npc.getNeedBars({ scope: 'active' }).map(bar => bar.id);
        assert.ok(!nonPartyNeedBarIds.includes('food'));
        assert.ok(!nonPartyNeedBarIds.includes('rest'));

        npc.setInPlayerParty(true);
        const partyNeedBarIds = npc.getNeedBars({ scope: 'active' }).map(bar => bar.id);
        assert.ok(partyNeedBarIds.includes('food'));
        assert.ok(partyNeedBarIds.includes('rest'));
    } finally {
        Player.clearRuntimeRegistries();
        clearFrozenEnabledModManifests(repoBaseDir);
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
    }
});

test('Player.reloadDefinitionCaches reapplies merged need-bar defs to already loaded party NPCs', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-npc-needs-'));

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
    writeFile('defs/need_bars.yaml', `
need_values:
  small: 10
need_bars:
  food:
    name: Food
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 100
  rest:
    name: Rest
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 100
`);

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
    clearFrozenEnabledModManifests(tempBaseDir);
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const npc = new Player({
            id: 'npc-merged-needs-test',
            name: 'Dockworker Bren',
            isNPC: true
        });

        const beforeIds = npc.getNeedBars({ scope: 'active' }).map(bar => bar.id);
        assert.ok(!beforeIds.includes('food'));
        assert.ok(!beforeIds.includes('rest'));

        writeFile('mods/npc-needs/defs/need_bars.yaml', `
need_bars:
  food:
    player: true
    party: true
    non_party: false
  rest:
    player: true
    party: true
    non_party: false
`);

        Player.reloadDefinitionCaches({ refreshInstances: true });

        const nonPartyAfterIds = npc.getNeedBars({ scope: 'active' }).map(bar => bar.id);
        assert.ok(!nonPartyAfterIds.includes('food'));
        assert.ok(!nonPartyAfterIds.includes('rest'));

        npc.setInPlayerParty(true);
        const partyAfterIds = npc.getNeedBars({ scope: 'active' }).map(bar => bar.id);
        assert.ok(partyAfterIds.includes('food'));
        assert.ok(partyAfterIds.includes('rest'));
    } finally {
        Player.clearRuntimeRegistries();
        clearFrozenEnabledModManifests(tempBaseDir);
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});
