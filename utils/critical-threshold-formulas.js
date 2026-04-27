const CRITICAL_THRESHOLD_MODES = Object.freeze(['normal', 'crafting']);
const CRITICAL_THRESHOLD_DIRECTIONS = Object.freeze(['success', 'failure']);

const DEFAULT_CRITICAL_THRESHOLD_FORMULAS = Object.freeze({
  normal: Object.freeze({
    success: '16',
    failure: '4'
  }),
  crafting: Object.freeze({
    success: '19',
    failure: '2'
  })
});

const normalizeFormula = (value, label) => {
  if (value === undefined || value === null) {
    throw new Error(`Config ${label} is required.`);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`Config ${label} must be a finite number or formula string.`);
    }
    return String(value);
  }
  if (typeof value !== 'string') {
    throw new Error(`Config ${label} must be a string or finite number.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Config ${label} must be a non-empty string.`);
  }
  return trimmed;
};

const resolveCriticalThresholdFormulas = (config = {}) => {
  const section = config.formulas?.critical_thresholds;
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error('Config formulas.critical_thresholds section is required.');
  }

  const formulas = {};
  for (const mode of CRITICAL_THRESHOLD_MODES) {
    const modeSection = section[mode];
    if (!modeSection || typeof modeSection !== 'object' || Array.isArray(modeSection)) {
      throw new Error(`Config formulas.critical_thresholds.${mode} section is required.`);
    }
    formulas[mode] = {};
    for (const direction of CRITICAL_THRESHOLD_DIRECTIONS) {
      formulas[mode][direction] = normalizeFormula(
        modeSection[direction],
        `formulas.critical_thresholds.${mode}.${direction}`
      );
    }
  }
  return formulas;
};

const validateCriticalThresholdValues = (values, { label = 'Critical threshold formulas' } = {}) => {
  if (!values || typeof values !== 'object') {
    throw new Error(`${label} must evaluate to an object.`);
  }
  for (const direction of CRITICAL_THRESHOLD_DIRECTIONS) {
    if (!Number.isFinite(values[direction])) {
      throw new Error(`${label}: ${direction} must evaluate to a finite number.`);
    }
  }
  return values;
};

const validateCriticalThresholdFormulas = (config = {}, { formulaEvaluator = null } = {}) => {
  if (!formulaEvaluator || typeof formulaEvaluator.compile !== 'function') {
    throw new Error('FormulaEvaluator.compile is required to validate critical threshold formulas.');
  }

  const formulas = resolveCriticalThresholdFormulas(config);
  for (const mode of CRITICAL_THRESHOLD_MODES) {
    const values = {};
    for (const direction of CRITICAL_THRESHOLD_DIRECTIONS) {
      const evaluator = formulaEvaluator.compile(formulas[mode][direction]);
      values[direction] = evaluator({ level: 1 });
    }
    validateCriticalThresholdValues(values, { label: `Critical threshold formulas.${mode}` });
  }
  return formulas;
};

module.exports = {
  CRITICAL_THRESHOLD_MODES,
  CRITICAL_THRESHOLD_DIRECTIONS,
  DEFAULT_CRITICAL_THRESHOLD_FORMULAS,
  resolveCriticalThresholdFormulas,
  validateCriticalThresholdFormulas,
  validateCriticalThresholdValues
};
