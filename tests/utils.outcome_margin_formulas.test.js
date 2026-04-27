const test = require('node:test');
const assert = require('node:assert/strict');

const FormulaEvaluator = require('../public/js/formula-evaluator.js');
const {
    DEFAULT_OUTCOME_MARGIN_FORMULAS,
    resolveOutcomeMarginFormulas,
    validateOutcomeMarginFormulas,
    validateOutcomeMarginValues
} = require('../utils/outcome-margin-formulas.js');

test('resolveOutcomeMarginFormulas reads all configured outcome margin formulas', () => {
    const formulas = resolveOutcomeMarginFormulas({
        formulas: {
            outcome_margins: {
                critical_success: 'level + 10',
                major_success: 'level + 6',
                success: 'level + 3',
                barely_succeeded: '0',
                critical_failure: '-10',
                major_failure: '-6',
                failure: '-3'
            }
        }
    });

    assert.deepEqual(formulas, {
        critical_success: 'level + 10',
        major_success: 'level + 6',
        success: 'level + 3',
        barely_succeeded: '0',
        critical_failure: '-10',
        major_failure: '-6',
        failure: '-3'
    });
});

test('default outcome margin formulas preserve the former hardcoded values', () => {
    const values = Object.fromEntries(
        Object.entries(DEFAULT_OUTCOME_MARGIN_FORMULAS).map(([key, formula]) => [
            key,
            FormulaEvaluator.compile(formula)({ level: 7 })
        ])
    );

    assert.deepEqual(values, {
        critical_success: 10,
        major_success: 6,
        success: 3,
        barely_succeeded: 0,
        critical_failure: -10,
        major_failure: -6,
        failure: -3
    });
});

test('validateOutcomeMarginValues rejects overlapping threshold order', () => {
    assert.throws(
        () => validateOutcomeMarginValues({
            critical_success: 10,
            major_success: 12,
            success: 3,
            barely_succeeded: 0,
            critical_failure: -10,
            major_failure: -6,
            failure: -3
        }),
        /success thresholds must be ordered/
    );

    assert.throws(
        () => validateOutcomeMarginValues({
            critical_success: 10,
            major_success: 6,
            success: 3,
            barely_succeeded: 0,
            critical_failure: -4,
            major_failure: -6,
            failure: -3
        }),
        /failure thresholds must be ordered/
    );
});

test('validateOutcomeMarginFormulas evaluates formulas with level', () => {
    const formulas = validateOutcomeMarginFormulas({
        formulas: {
            outcome_margins: {
                critical_success: 'level + 10',
                major_success: 'level + 6',
                success: 'level + 3',
                barely_succeeded: '0',
                critical_failure: '-10',
                major_failure: '-6',
                failure: '-3'
            }
        }
    }, { formulaEvaluator: FormulaEvaluator });

    assert.equal(formulas.critical_success, 'level + 10');
});
