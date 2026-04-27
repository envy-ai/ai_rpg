const OUTCOME_MARGIN_FORMULA_KEYS = Object.freeze([
  'critical_success',
  'major_success',
  'success',
  'barely_succeeded',
  'critical_failure',
  'major_failure',
  'failure'
]);

const DEFAULT_OUTCOME_MARGIN_FORMULAS = Object.freeze({
  critical_success: '10',
  major_success: '6',
  success: '3',
  barely_succeeded: '0',
  critical_failure: '-10',
  major_failure: '-6',
  failure: '-3'
});

const normalizeFormula = (value, label) => {
  if (value === undefined || value === null) {
    throw new Error(`Config ${label} is required.`);
  }
  if (typeof value !== 'string') {
    throw new Error(`Config ${label} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Config ${label} must be a non-empty string.`);
  }
  return trimmed;
};

const resolveOutcomeMarginFormulas = (config = {}) => {
  const section = config.formulas?.outcome_margins;
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error('Config formulas.outcome_margins section is required.');
  }

  const formulas = {};
  for (const key of OUTCOME_MARGIN_FORMULA_KEYS) {
    formulas[key] = normalizeFormula(section[key], `formulas.outcome_margins.${key}`);
  }
  return formulas;
};

const validateOutcomeMarginValues = (values, { label = 'Outcome margin formulas' } = {}) => {
  if (!values || typeof values !== 'object') {
    throw new Error(`${label} must evaluate to an object.`);
  }
  for (const key of OUTCOME_MARGIN_FORMULA_KEYS) {
    if (!Number.isFinite(values[key])) {
      throw new Error(`${label}: ${key} must evaluate to a finite number.`);
    }
  }

  if (!(
    values.critical_success >= values.major_success
    && values.major_success >= values.success
    && values.success >= values.barely_succeeded
  )) {
    throw new Error(`${label}: success thresholds must be ordered critical_success >= major_success >= success >= barely_succeeded.`);
  }

  if (!(
    values.critical_failure <= values.major_failure
    && values.major_failure <= values.failure
    && values.failure < values.barely_succeeded
  )) {
    throw new Error(`${label}: failure thresholds must be ordered critical_failure <= major_failure <= failure < barely_succeeded.`);
  }

  return values;
};

const validateOutcomeMarginFormulas = (config = {}, { formulaEvaluator = null } = {}) => {
  if (!formulaEvaluator || typeof formulaEvaluator.compile !== 'function') {
    throw new Error('FormulaEvaluator.compile is required to validate outcome margin formulas.');
  }

  const formulas = resolveOutcomeMarginFormulas(config);
  const values = {};
  for (const [key, formula] of Object.entries(formulas)) {
    const evaluator = formulaEvaluator.compile(formula);
    values[key] = evaluator({ level: 1 });
  }
  validateOutcomeMarginValues(values);
  return formulas;
};

module.exports = {
  OUTCOME_MARGIN_FORMULA_KEYS,
  DEFAULT_OUTCOME_MARGIN_FORMULAS,
  resolveOutcomeMarginFormulas,
  validateOutcomeMarginFormulas,
  validateOutcomeMarginValues
};
