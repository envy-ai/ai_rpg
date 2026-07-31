const { normalizeFormula } = require('./formula-utils.js');

const DEFAULT_ATTRIBUTE_POOL_FORMULA = 'level * (number_of_attributes / 2)';
const DEFAULT_SKILL_POOL_FORMULA = 'level * ceil(number_of_skills / 5)';

const resolvePointPoolFormulas = (config = {}) => {
  const section = config.formulas?.character_creation;
  if (!section || typeof section !== 'object') {
    throw new Error('Config formulas.character_creation section is required.');
  }
  return {
    attribute: normalizeFormula(
      section.attribute_pool_formula,
      'formulas.character_creation.attribute_pool_formula'
    ),
    skill: normalizeFormula(
      section.skill_pool_formula,
      'formulas.character_creation.skill_pool_formula'
    ),
    maxAttribute: normalizeFormula(
      section.max_attribute,
      'formulas.character_creation.max_attribute'
    ),
    maxSkill: normalizeFormula(
      section.max_skill,
      'formulas.character_creation.max_skill'
    )
  };
};

module.exports = {
  DEFAULT_ATTRIBUTE_POOL_FORMULA,
  DEFAULT_SKILL_POOL_FORMULA,
  resolvePointPoolFormulas
};
