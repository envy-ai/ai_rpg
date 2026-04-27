const DC_FORMULA_KEYS = Object.freeze([
  'trivial',
  'easy',
  'medium',
  'hard',
  'very_hard',
  'legendary'
]);

const DEFAULT_DC_FORMULAS = Object.freeze({
  trivial: '0',
  easy: '10',
  medium: '15',
  hard: '20',
  very_hard: '25',
  legendary: '30'
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

const normalizeDifficultyKey = (label) => {
  if (!label || typeof label !== 'string') {
    return null;
  }
  const normalized = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return DC_FORMULA_KEYS.includes(normalized) ? normalized : null;
};

const resolveDifficultyDcFormulas = (config = {}) => {
  const section = config.formulas?.dc;
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new Error('Config formulas.dc section is required.');
  }

  const formulas = {};
  for (const key of DC_FORMULA_KEYS) {
    formulas[key] = normalizeFormula(section[key], `formulas.dc.${key}`);
  }
  return formulas;
};

const validateDifficultyDcFormulas = (config = {}, { formulaEvaluator = null } = {}) => {
  if (!formulaEvaluator || typeof formulaEvaluator.compile !== 'function') {
    throw new Error('FormulaEvaluator.compile is required to validate DC formulas.');
  }

  const formulas = resolveDifficultyDcFormulas(config);
  for (const [key, formula] of Object.entries(formulas)) {
    const evaluator = formulaEvaluator.compile(formula);
    evaluator({ level: 1 });
  }
  return formulas;
};

module.exports = {
  DC_FORMULA_KEYS,
  DEFAULT_DC_FORMULAS,
  normalizeDifficultyKey,
  resolveDifficultyDcFormulas,
  validateDifficultyDcFormulas
};
