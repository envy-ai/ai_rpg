const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempNeedBarDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-need-audience-'));

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
  constitution:
    label: Constitution
    default: 5
`);
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', `
need_values:
  small: 10
need_bars:
  player_focus:
    name: Player Focus
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 80
    change_per_turn: -1
  morale:
    name: Morale
    player: false
    party: true
    non_party: false
    min: 0
    max: 100
    initial: 60
    change_per_turn: -2
  suspicion:
    name: Suspicion
    player: false
    party: false
    non_party: true
    min: 0
    max: 100
    initial: 40
    change_per_turn: 3
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 100
    change_per_turn: -1
`);

    return tempBaseDir;
}

test('NPC need bars track active audience by party membership while preserving stored hidden bars', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = createTempNeedBarDefs();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const npc = new Player({
            id: 'need-audience-npc',
            name: 'Dockhand Pell',
            isNPC: true
        });

        assert.deepEqual(
            npc.getNeedBars({ scope: 'stored' }).map(bar => bar.id).sort(),
            ['morale', 'stamina', 'suspicion']
        );
        assert.deepEqual(
            npc.getNeedBars({ scope: 'active' }).map(bar => bar.id).sort(),
            ['stamina', 'suspicion']
        );

        npc.applyNeedBarTurnChange();
        assert.equal(npc.getNeedBarValue('morale'), 60);
        assert.equal(npc.getNeedBarValue('suspicion'), 43);
        assert.equal(npc.getNeedBarValue('stamina'), 99);

        npc.setInPlayerParty(true);
        assert.deepEqual(
            npc.getNeedBars({ scope: 'active' }).map(bar => bar.id).sort(),
            ['morale', 'stamina']
        );

        npc.setNeedBarValue('morale', 55);
        assert.throws(
            () => npc.setNeedBarValue('suspicion', 50),
            /not active/
        );

        npc.applyNeedBarTurnChange();
        assert.equal(npc.getNeedBarValue('morale'), 53);
        assert.equal(npc.getNeedBarValue('suspicion'), 43);
        assert.equal(npc.getNeedBarValue('stamina'), 98);

        npc.setInPlayerParty(false);
        assert.deepEqual(
            npc.getNeedBars({ scope: 'active' }).map(bar => bar.id).sort(),
            ['stamina', 'suspicion']
        );
        assert.equal(
            npc.getNeedBars({ scope: 'stored' }).find(bar => bar.id === 'morale')?.value,
            53
        );
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});

test('player actors only store and expose player-audience plus shared need bars', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = createTempNeedBarDefs();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const player = new Player({
            id: 'need-audience-player',
            name: 'Baato'
        });

        const storedIds = player.getNeedBars({ scope: 'stored' }).map(bar => bar.id).sort();
        const activeIds = player.getNeedBars({ scope: 'active' }).map(bar => bar.id).sort();

        assert.deepEqual(storedIds, ['player_focus', 'stamina']);
        assert.deepEqual(activeIds, ['player_focus', 'stamina']);
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});
