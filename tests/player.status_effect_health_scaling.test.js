const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempPlayerDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-status-health-'));

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

test('status-effect-driven constitution increases raise current health by the same max-health delta', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'status-health-buff',
            name: 'Baato',
            attributes: {
                constitution: 10,
                strength: 5
            }
        });

        assert.equal(player.maxHealth, 20);
        player.setHealth(10);

        player.addStatusEffect({
            name: 'Fortified',
            description: 'Constitution boosted.',
            duration: 5,
            attributes: [
                { attribute: 'constitution', modifier: 4 }
            ]
        });

        assert.equal(player.maxHealth, 24);
        assert.equal(player.health, 14);
    });
});

test('removing or expiring a max-health buff does not subtract the gained health back out', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'status-health-expire',
            name: 'Cabnia',
            attributes: {
                constitution: 10,
                strength: 5
            }
        });

        player.setHealth(10);
        player.addStatusEffect({
            name: 'Fortified',
            description: 'Constitution boosted.',
            duration: 1,
            attributes: [
                { attribute: 'constitution', modifier: 4 }
            ]
        });

        assert.equal(player.maxHealth, 24);
        assert.equal(player.health, 14);

        player.tickStatusEffects(1);
        player.clearExpiredStatusEffects();

        assert.equal(player.maxHealth, 20);
        assert.equal(player.health, 14);
    });
});

test('status-effect-driven max-health decreases only clamp instead of subtracting a matching delta', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'status-health-debuff',
            name: 'Kess',
            attributes: {
                constitution: 10,
                strength: 5
            }
        });

        player.setHealth(10);
        player.setStatusEffects([
            {
                name: 'Weakened',
                description: 'Constitution reduced.',
                duration: 5,
                attributes: [
                    { attribute: 'constitution', modifier: -4 }
                ]
            }
        ]);

        assert.equal(player.maxHealth, 16);
        assert.equal(player.health, 10);

        player.setHealth(24);
        assert.equal(player.health, 16);

        player.setStatusEffects([
            {
                name: 'Fortified',
                description: 'Constitution boosted.',
                duration: 5,
                attributes: [
                    { attribute: 'constitution', modifier: 4 }
                ]
            }
        ]);
        assert.equal(player.maxHealth, 24);
        assert.equal(player.health, 24);

        player.setStatusEffects([
            {
                name: 'Weakened',
                description: 'Constitution reduced.',
                duration: 5,
                attributes: [
                    { attribute: 'constitution', modifier: -4 }
                ]
            }
        ]);

        assert.equal(player.maxHealth, 16);
        assert.equal(player.health, 16);
    });
});
