const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempPlayerDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-float-health-'));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', `
attributes:
  constitution:
    label: Constitution
    default: 10
`);
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', 'need_bars: {}\n');

    return tempBaseDir;
}

function withTempPlayerEnvironment(run, configOverrides = {}) {
    const tempBaseDir = createTempPlayerDefs();
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousWorldTime = Globals.worldTime;

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: 10,
        formulas: {
            character_creation: {
                attribute_pool_formula: '0',
                skill_pool_formula: '0',
                max_attribute: '18',
                max_skill: '10'
            }
        },
        ...configOverrides
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        run();
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Globals.worldTime = previousWorldTime;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
}

test('current health can be a persisted finite float', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'float-health',
            name: 'Float Health',
            health: 10.25
        });

        assert.equal(player.health, 10.25);
        assert.equal(player.getStatus().health, 10.25);
        assert.equal(player.toJSON().health, 10.25);

        const result = player.modifyHealth(-0.5, 'fractional damage');
        assert.equal(player.health, 9.75);
        assert.equal(result.change, -0.5);
    });
});

test('level changes preserve fractional health ratios without rounding', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'float-health-level',
            name: 'Float Health Level'
        });

        assert.equal(player.maxHealth, 20);
        player.setHealth(5.5);
        player.setLevel(2);

        assert.equal(player.maxHealth, 25);
        assert.ok(Math.abs(player.health - 6.875) < 1e-12);
    });
});

test('configured health regen restores a percentage of max health over elapsed minutes', () => {
    withTempPlayerEnvironment(() => {
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        const player = new Player({
            id: 'float-health-regen',
            name: 'Float Health Regen'
        });
        player.setHealth(10);

        const initialAdjustments = Player.applyStatusEffectNeedBarsToAll();
        assert.equal(player.health, 10);
        assert.deepEqual(initialAdjustments, []);

        Globals.worldTime = { dayIndex: 1, timeMinutes: 0 };
        const adjustments = Player.applyStatusEffectNeedBarsToAll();

        assert.equal(player.maxHealth, 20);
        assert.ok(Math.abs(player.health - 15) < 1e-9);
        assert.equal(adjustments.length, 1);
        assert.equal(adjustments[0].bar, 'Health');
        assert.equal(adjustments[0].needBarName, 'Health');
        assert.ok(Math.abs(adjustments[0].delta - 5) < 1e-9);
        assert.equal(adjustments[0].ticksApplied, 1440);
    }, {
        healthRegenPercentPerMinute: 0.01736111111
    });
});
