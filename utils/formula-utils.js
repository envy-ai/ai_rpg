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

const evaluateFormulasAtLevelOne = (formulas, formulaEvaluator) => {
  const values = {};
  for (const [key, formula] of Object.entries(formulas)) {
    const evaluator = formulaEvaluator.compile(formula);
    values[key] = evaluator({ level: 1 });
  }
  return values;
};

module.exports = {
  normalizeFormula,
  evaluateFormulasAtLevelOne
};
