const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function withBaseHealthAndFormulas(previousConfig = {}) {
    return {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        formulas: {
            ...(previousConfig?.formulas && typeof previousConfig.formulas === 'object' ? previousConfig.formulas : {}),
            character_creation: {
                ...(previousConfig?.formulas?.character_creation && typeof previousConfig.formulas.character_creation === 'object'
                    ? previousConfig.formulas.character_creation
                    : {}),
                attribute_pool_formula: previousConfig?.formulas?.character_creation?.attribute_pool_formula ?? '0',
                skill_pool_formula: previousConfig?.formulas?.character_creation?.skill_pool_formula ?? '0',
                max_attribute: previousConfig?.formulas?.character_creation?.max_attribute ?? '999',
                max_skill: previousConfig?.formulas?.character_creation?.max_skill ?? '999'
            }
        }
    };
}

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
    change_per_minute: -1
  morale:
    name: Morale
    player: false
    party: true
    non_party: false
    min: 0
    max: 100
    initial: 60
    change_per_minute: -2
  suspicion:
    name: Suspicion
    player: false
    party: false
    non_party: true
    min: 0
    max: 100
    initial: 40
    change_per_minute: 3
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 100
    change_per_minute: -1
`);

    return tempBaseDir;
}

function applyNeedBarsAtMinute(minute) {
    Globals.worldTime = { dayIndex: 0, timeMinutes: minute };
    return Player.applyStatusEffectNeedBarsToAll();
}

test('NPC need bars keep party-audience bars active after leaving the party when the actor has party history', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
    const tempBaseDir = createTempNeedBarDefs();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = withBaseHealthAndFormulas(previousConfig);
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

        applyNeedBarsAtMinute(100);
        applyNeedBarsAtMinute(101);
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

        applyNeedBarsAtMinute(102);
        assert.equal(npc.getNeedBarValue('morale'), 53);
        assert.equal(npc.getNeedBarValue('suspicion'), 43);
        assert.equal(npc.getNeedBarValue('stamina'), 98);

        npc.setInPlayerParty(false);
        assert.deepEqual(
            npc.getNeedBars({ scope: 'active' }).map(bar => bar.id).sort(),
            ['morale', 'stamina', 'suspicion']
        );
        assert.equal(
            npc.getNeedBars({ scope: 'stored' }).find(bar => bar.id === 'morale')?.value,
            53
        );

        applyNeedBarsAtMinute(103);
        assert.equal(npc.getNeedBarValue('morale'), 51);
        assert.equal(npc.getNeedBarValue('suspicion'), 46);
        assert.equal(npc.getNeedBarValue('stamina'), 97);
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
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
    Globals.config = withBaseHealthAndFormulas(previousConfig);
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

test('per-need need_values override global magnitudes and fall back for missing entries', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-need-values-'));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', `
attributes:
  wisdom:
    label: Wisdom
    default: 5
`);
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', `
need_values:
  small: 10
  medium: 25.5
  large: 70
need_bars:
  sanity:
    name: Sanity
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 100
    relative_to_level: false
    need_values:
      small: 4.5
      large: 50
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 100
    relative_to_level: false
    need_values:
      small: 0.5
`);

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = withBaseHealthAndFormulas(previousConfig);
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const player = new Player({
            id: 'need-value-player',
            name: 'Baato'
        });

        let change = player.applyNeedBarChange('sanity', { direction: 'decrease', magnitude: 'small' });
        assert.equal(change.newValue, 95.5);

        change = player.applyNeedBarChange('sanity', { direction: 'decrease', magnitude: 'medium' });
        assert.equal(change.newValue, 70);

        change = player.applyNeedBarChange('sanity', { direction: 'decrease', magnitude: 'large' });
        assert.equal(change.newValue, 20);

        change = player.applyNeedBarChange('stamina', { direction: 'decrease', magnitude: 'small' });
        assert.equal(change.newValue, 99.5);
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});

test('persisted need-bar minute timestamps prevent replaying old elapsed time after reload', () => {
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;
    const tempBaseDir = createTempNeedBarDefs();

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = withBaseHealthAndFormulas(previousConfig);
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        const npc = new Player({
            id: 'need-audience-persisted-npc',
            name: 'Rill',
            isNPC: true
        });

        applyNeedBarsAtMinute(100);
        applyNeedBarsAtMinute(102);

        assert.equal(npc.getNeedBarValue('suspicion'), 46);
        assert.equal(npc.getNeedBarValue('stamina'), 98);

        const saved = npc.toJSON();

        Player.clearRuntimeRegistries();
        const restored = Player.fromJSON(saved);

        applyNeedBarsAtMinute(104);
        assert.equal(restored.getNeedBarValue('suspicion'), 52);
        assert.equal(restored.getNeedBarValue('stamina'), 96);
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});
