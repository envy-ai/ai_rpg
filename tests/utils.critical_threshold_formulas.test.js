const test = require('node:test');
const assert = require('node:assert/strict');

const FormulaEvaluator = require('../public/js/formula-evaluator.js');
const {
    DEFAULT_CRITICAL_THRESHOLD_FORMULAS,
    resolveCriticalThresholdFormulas,
    validateCriticalThresholdFormulas,
    validateCriticalThresholdValues
} = require('../utils/critical-threshold-formulas.js');

test('resolveCriticalThresholdFormulas reads numeric and string thresholds', () => {
    const formulas = resolveCriticalThresholdFormulas({
        formulas: {
            critical_thresholds: {
                normal: {
                    success: 16,
                    failure: 4
                },
                crafting: {
                    success: 'level + 18',
                    failure: '2'
                }
            }
        }
    });

    assert.deepEqual(formulas, {
        normal: {
            success: '16',
            failure: '4'
        },
        crafting: {
            success: 'level + 18',
            failure: '2'
        }
    });
});

test('default critical threshold formulas preserve the former hardcoded values', () => {
    const values = {};
    for (const [mode, modeFormulas] of Object.entries(DEFAULT_CRITICAL_THRESHOLD_FORMULAS)) {
        values[mode] = {};
        for (const [direction, formula] of Object.entries(modeFormulas)) {
            values[mode][direction] = FormulaEvaluator.compile(formula)({ level: 7 });
        }
    }

    assert.deepEqual(values, {
        normal: {
            success: 16,
            failure: 4
        },
        crafting: {
            success: 19,
            failure: 2
        }
    });
});

test('validateCriticalThresholdValues rejects non-finite values', () => {
    assert.throws(
        () => validateCriticalThresholdValues({
            success: 16,
            failure: Infinity
        }),
        /failure must evaluate to a finite number/
    );
});

test('validateCriticalThresholdFormulas evaluates formulas with level', () => {
    const formulas = validateCriticalThresholdFormulas({
        formulas: {
            critical_thresholds: {
                normal: {
                    success: 'level + 15',
                    failure: 4
                },
                crafting: {
                    success: 19,
                    failure: 2
                }
            }
        }
    }, { formulaEvaluator: FormulaEvaluator });

    assert.equal(formulas.normal.success, 'level + 15');
});
