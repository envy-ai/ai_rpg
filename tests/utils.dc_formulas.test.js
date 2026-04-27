const test = require('node:test');
const assert = require('node:assert/strict');

const FormulaEvaluator = require('../public/js/formula-evaluator.js');
const {
    DEFAULT_DC_FORMULAS,
    normalizeDifficultyKey,
    resolveDifficultyDcFormulas,
    validateDifficultyDcFormulas
} = require('../utils/dc-formulas.js');

test('resolveDifficultyDcFormulas reads all configured difficulty formulas', () => {
    const formulas = resolveDifficultyDcFormulas({
        formulas: {
            dc: {
                trivial: '0',
                easy: 'level + 8',
                medium: 'level + 13',
                hard: 'level + 18',
                very_hard: 'level + 23',
                legendary: 'level + 28'
            }
        }
    });

    assert.deepEqual(formulas, {
        trivial: '0',
        easy: 'level + 8',
        medium: 'level + 13',
        hard: 'level + 18',
        very_hard: 'level + 23',
        legendary: 'level + 28'
    });
});

test('default DC formulas preserve the former hardcoded values', () => {
    const values = Object.fromEntries(
        Object.entries(DEFAULT_DC_FORMULAS).map(([key, formula]) => [
            key,
            FormulaEvaluator.compile(formula)({ level: 7 })
        ])
    );

    assert.deepEqual(values, {
        trivial: 0,
        easy: 10,
        medium: 15,
        hard: 20,
        very_hard: 25,
        legendary: 30
    });
});

test('normalizeDifficultyKey maps prose labels to formula keys', () => {
    assert.equal(normalizeDifficultyKey('Very Hard'), 'very_hard');
    assert.equal(normalizeDifficultyKey('very-hard'), 'very_hard');
    assert.equal(normalizeDifficultyKey('legendary'), 'legendary');
    assert.equal(normalizeDifficultyKey('unknown'), null);
});

test('validateDifficultyDcFormulas requires formulas to evaluate with level', () => {
    assert.throws(
        () => validateDifficultyDcFormulas({
            formulas: {
                dc: {
                    trivial: '0',
                    easy: 'rank + 8',
                    medium: '15',
                    hard: '20',
                    very_hard: '25',
                    legendary: '30'
                }
            }
        }, { formulaEvaluator: FormulaEvaluator }),
        /Unknown variable 'rank'/
    );
});
