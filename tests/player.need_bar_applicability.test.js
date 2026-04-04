const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempNeedBarDefs(needBarsYaml) {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-need-applicability-'));

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
    writeFile('defs/need_bars.yaml', needBarsYaml);

    return tempBaseDir;
}

function withTempNeedBarEnvironment(tempBaseDir, run) {
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

test('need bar applicability persists explicit true/false values across save and load', () => {
    const tempBaseDir = createTempNeedBarDefs(`
need_bars:
  hunger:
    name: Hunger
    player: false
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 25
  rest:
    name: Rest
    player: false
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 50
`);

    withTempNeedBarEnvironment(tempBaseDir, () => {
        const npc = new Player({
            id: 'need-applicability-npc',
            name: 'Quartermaster Vale',
            isNPC: true,
            needBars: [
                { id: 'rest', value: 35 }
            ],
            needBarApplicability: {
                hunger: false,
                rest: true
            }
        });

        assert.deepEqual(npc.getNeedBarApplicability(), {
            hunger: false,
            rest: true
        });
        assert.deepEqual(
            npc.getNeedBars({ scope: 'stored' }).map(bar => bar.id),
            ['rest']
        );
        assert.equal(npc.getNeedBarValue('rest'), 35);

        const saved = npc.toJSON();

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.deepEqual(loaded.getNeedBarApplicability(), {
            hunger: false,
            rest: true
        });
        assert.deepEqual(
            loaded.getNeedBars({ scope: 'stored' }).map(bar => bar.id),
            ['rest']
        );
        assert.equal(loaded.getNeedBarValue('rest'), 35);
        assert.equal(loaded.getNeedBarValue('hunger'), null);
    });
});

test('legacy saves missing need bar state load storable bars as 100 and applicable', () => {
    const tempBaseDir = createTempNeedBarDefs(`
need_bars:
  food:
    name: Food
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 20
  rest:
    name: Rest
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 35
`);

    withTempNeedBarEnvironment(tempBaseDir, () => {
        const player = new Player({
            id: 'legacy-need-player',
            name: 'Baato'
        });
        const legacySave = player.toJSON();
        delete legacySave.needBars;
        delete legacySave.needBarApplicability;

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(legacySave);
        assert.deepEqual(loaded.getNeedBarApplicability(), {
            food: true,
            rest: true
        });
        assert.equal(loaded.getNeedBarValue('food'), 100);
        assert.equal(loaded.getNeedBarValue('rest'), 100);
    });
});

test('setNeedBarApplicability preserves kept values, drops disabled bars, and restores re-enabled bars at 100', () => {
    const tempBaseDir = createTempNeedBarDefs(`
need_bars:
  hunger:
    name: Hunger
    player: false
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 20
  rest:
    name: Rest
    player: false
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 50
`);

    withTempNeedBarEnvironment(tempBaseDir, () => {
        const npc = new Player({
            id: 'need-applicability-edit-npc',
            name: 'Cabnia Slatherbottom',
            isNPC: true,
            needBars: [
                { id: 'hunger', value: 42 },
                { id: 'rest', value: 77 }
            ],
            needBarApplicability: {
                hunger: true,
                rest: true
            }
        });

        npc.setNeedBarApplicability({
            hunger: false,
            rest: true
        });

        assert.deepEqual(npc.getNeedBarApplicability(), {
            hunger: false,
            rest: true
        });
        assert.equal(npc.getNeedBarValue('hunger'), null);
        assert.equal(npc.getNeedBarValue('rest'), 77);

        npc.setNeedBarApplicability({
            hunger: true,
            rest: true
        });

        assert.deepEqual(npc.getNeedBarApplicability(), {
            hunger: true,
            rest: true
        });
        assert.equal(npc.getNeedBarValue('hunger'), 100);
        assert.equal(npc.getNeedBarValue('rest'), 77);
    });
});
