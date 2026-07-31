const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
    createTempDefsDir,
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function writeTempNeedBarDefs({ needBarsYaml }) {
    return createTempDefsDir({
        prefix: 'ai-rpg-need-sentences-',
        needBarsYaml
    });
}

function withTempNeedBarEnvironment(tempBaseDir, run) {
    return withTempPlayerEnvironmentBase({
        tempBaseDir,
        configStyle: 'health-only'
    }, run);
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
