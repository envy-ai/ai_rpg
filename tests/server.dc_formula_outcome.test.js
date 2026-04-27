const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const FormulaEvaluator = require('../public/js/formula-evaluator.js');
const {
    normalizeDifficultyKey,
    resolveDifficultyDcFormulas
} = require('../utils/dc-formulas.js');
const {
    resolveOutcomeMarginFormulas,
    validateOutcomeMarginValues
} = require('../utils/outcome-margin-formulas.js');
const {
    resolveCriticalThresholdFormulas,
    validateCriticalThresholdValues
} = require('../utils/critical-threshold-formulas.js');

function loadActionOutcomeHelpers({ config, locationLevel, dieRoll }) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function getDifficultyDcFormulaRuntime()');
    const end = source.indexOf('\nasync function runPlausibilityCheck', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate action outcome helpers in server.js');
    }

    const context = {
        Number,
        Set,
        Map,
        JSON,
        console,
        config,
        cachedDifficultyDcFormulaRuntime: null,
        cachedOutcomeMarginFormulaRuntime: null,
        cachedCriticalThresholdFormulaRuntime: null,
        FormulaEvaluator,
        normalizeDifficultyKey,
        resolveDifficultyDcFormulas,
        resolveOutcomeMarginFormulas,
        validateOutcomeMarginValues,
        resolveCriticalThresholdFormulas,
        validateCriticalThresholdValues,
        currentPlayer: null,
        Location: {
            get: () => ({ baseLevel: locationLevel })
        },
        Player: {
            availableSkills: new Map()
        },
        diceModule: {
            rollDice: () => ({ total: dieRoll, detail: `1d20 (test: ${dieRoll})` })
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.resolveActionOutcome = resolveActionOutcome;
this.difficultyToDC = difficultyToDC;`,
        context
    );
    return context;
}

function makePlayer() {
    return {
        currentLocation: 'location-1',
        getAttributeNames: () => ['Dexterity'],
        getAttributeBonus: () => 0,
        getSkillValue: () => 0
    };
}

function makeConfig(overrides = {}) {
    return {
        formulas: {
            dc: {
                trivial: '0',
                easy: '10',
                medium: '15',
                hard: '20',
                very_hard: '25',
                legendary: '30',
                ...overrides
            },
            outcome_margins: {
                critical_success: '10',
                major_success: '6',
                success: '3',
                barely_succeeded: '0',
                critical_failure: '-10',
                major_failure: '-6',
                failure: '-3'
            },
            critical_thresholds: {
                normal: {
                    success: 16,
                    failure: 4
                },
                crafting: {
                    success: 19,
                    failure: 2
                }
            }
        }
    };
}

test('resolveActionOutcome treats a zero trivial DC as a real configured DC', () => {
    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config: makeConfig(),
        locationLevel: 4,
        dieRoll: 1
    });

    const outcome = resolveActionOutcome({
        player: makePlayer(),
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'trivial'
            }
        }
    });

    assert.equal(outcome.difficulty.dc, 0);
    assert.equal(outcome.roll.die, 1);
    assert.equal(outcome.degree, 'success');
});

test('resolveActionOutcome passes current location level into DC formulas', () => {
    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config: makeConfig({ easy: 'level + 10' }),
        locationLevel: 4,
        dieRoll: 10
    });

    const outcome = resolveActionOutcome({
        player: makePlayer(),
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'easy'
            }
        }
    });

    assert.equal(outcome.difficulty.dc, 14);
    assert.equal(outcome.margin, -4);
    assert.equal(outcome.degree, 'failure');
});

test('resolveActionOutcome uses configured outcome margins with current location level', () => {
    const config = makeConfig({ easy: '6' });
    config.formulas.outcome_margins.critical_success = 'level + 20';
    config.formulas.outcome_margins.major_success = 'level + 5';

    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config,
        locationLevel: 4,
        dieRoll: 16
    });

    const outcome = resolveActionOutcome({
        player: makePlayer(),
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'easy'
            }
        }
    });

    assert.equal(outcome.margin, 10);
    assert.equal(outcome.degree, 'major_success');
});

test('resolveActionOutcome uses configured inclusive normal critical roll thresholds', () => {
    const config = makeConfig({ easy: '0' });
    config.formulas.critical_thresholds.normal.success = 17;

    const { resolveActionOutcome } = loadActionOutcomeHelpers({
        config,
        locationLevel: 4,
        dieRoll: 16
    });

    const outcome = resolveActionOutcome({
        player: makePlayer(),
        plausibility: {
            type: 'plausible',
            skillCheck: {
                skill: 'Stealth',
                attribute: 'Dexterity',
                difficulty: 'easy'
            }
        }
    });

    assert.equal(outcome.margin, 16);
    assert.equal(outcome.degree, 'major_success');
});
