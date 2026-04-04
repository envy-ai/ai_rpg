const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function writeTempNeedBarDefs({ needBarsYaml }) {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-need-sentences-'));

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
            : 10
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

test('Player.validateNeedBarPromptSentences throws on strict validation but only warns in warn mode', () => {
    const tempBaseDir = writeTempNeedBarDefs({
        needBarsYaml: `
need_bars:
  food:
    name: Food
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 50
    effect_thresholds:
      0:
        name: Hungry
        effect: Distracted by hunger.
`
    });

    withTempNeedBarEnvironment(tempBaseDir, () => {
        assert.throws(
            () => Player.validateNeedBarPromptSentences({ onError: 'throw' }),
            /missing a prompt sentence/
        );

        const originalWarn = console.warn;
        const warnings = [];
        console.warn = (...args) => warnings.push(args.join(' '));
        try {
            const issues = Player.validateNeedBarPromptSentences({ onError: 'warn' });
            assert.equal(Array.isArray(issues), true);
            assert.equal(issues.length, 1);
        } finally {
            console.warn = originalWarn;
        }

        assert.equal(warnings.length > 0, true);
    });
});

test('Player.getNeedSentencePromptContext substitutes the actor name into active need sentences', () => {
    const tempBaseDir = writeTempNeedBarDefs({
        needBarsYaml: `
need_bars:
  food:
    name: Food
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 30
    effect_thresholds:
      0:
        name: Hungry
        effect: Distracted by hunger.
        sentence: "%CHARACTER% is hungry."
  rest:
    name: Rest
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 10
    effect_thresholds:
      0:
        name: Exhausted
        effect: Barely awake.
        sentence: "%CHARACTER% is exhausted."
`
    });

    withTempNeedBarEnvironment(tempBaseDir, () => {
        const player = new Player({
            id: 'need-sentence-player',
            name: 'Baato'
        });

        assert.deepEqual(player.getNeedSentencePromptContext(), [
            'Baato is hungry.',
            'Baato is exhausted.'
        ]);
    });
});
