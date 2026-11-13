const FormulaEvaluator = require('../public/js/formula-evaluator.js');
const { normalizeFormula } = require('./formula-utils.js');

const FORMULA_PATH = 'formulas.barter.currency_multiplier';

const resolveBarterCurrencyFormula = (config = {}) =>
    normalizeFormula(config.formulas?.barter?.currency_multiplier, FORMULA_PATH);

const evaluateBarterCurrencyMultiplier = (config, level, { formulaEvaluator = FormulaEvaluator } = {}) => {
    const formula = resolveBarterCurrencyFormula(config);
    if (!Number.isFinite(level) || level < 1) {
        throw new Error(`Config ${FORMULA_PATH} requires a finite NPC.level of at least 1; received ${level}.`);
    }
    if (typeof formulaEvaluator?.compile !== 'function'
        || typeof formulaEvaluator?.collectVariables !== 'function') {
        throw new Error(`FormulaEvaluator.compile and collectVariables are required for ${FORMULA_PATH}.`);
    }
    let multiplier;
    try {
        const unknownVariables = formulaEvaluator.collectVariables(formula).filter(name => name !== 'level');
        if (unknownVariables.length) {
            throw new Error(`Unknown variable(s): ${unknownVariables.join(', ')}. The only supported variable is level (the NPC's own level).`);
        }
        multiplier = formulaEvaluator.compile(formula)({ level });
    } catch (error) {
        throw new Error(`Config ${FORMULA_PATH} could not be evaluated: ${error.message} Use a valid arithmetic formula with level and supported FormulaEvaluator functions.`, { cause: error });
    }
    if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new Error(`Config ${FORMULA_PATH} must produce a finite non-negative multiplier at NPC level ${level}; received ${multiplier}. Correct the formula for this level.`);
    }
    return multiplier;
};

const validateBarterCurrencyFormula = (config = {}, options = {}) => {
    evaluateBarterCurrencyMultiplier(config, 1, options);
    return resolveBarterCurrencyFormula(config);
};

const scaleBarterCurrency = (baseCurrency, multiplier) => {
    if (!Number.isSafeInteger(baseCurrency) || baseCurrency < 0) {
        throw new Error('merchantCurrency must be an unscaled non-negative safe integer baseline for refreshed stock.');
    }
    if (!Number.isFinite(multiplier) || multiplier < 0) {
        throw new Error(`Config ${FORMULA_PATH} must produce a finite non-negative multiplier.`);
    }
    const currency = baseCurrency * multiplier;
    if (!Number.isFinite(currency) || currency < 0 || !Number.isSafeInteger(Math.floor(currency))) {
        throw new Error(`merchantCurrency multiplied by ${FORMULA_PATH} must remain finite and within the non-negative safe integer currency range. Correct the configured multiplier for the NPC's level.`);
    }
    return currency;
};

module.exports = {
    resolveBarterCurrencyFormula,
    validateBarterCurrencyFormula,
    evaluateBarterCurrencyMultiplier,
    scaleBarterCurrency
};
