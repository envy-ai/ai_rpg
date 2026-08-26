const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function normalizeValue(value) {
  let normalized = typeof value === 'string' ? value.trim() : '';
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function resolveOverrideCategory(overrides, requestedCategory) {
  const normalizedCategory = normalizeValue(requestedCategory);
  if (!normalizedCategory) {
    throw new Error('An AI model override category is required.');
  }
  const requestedKey = normalizedCategory.toLocaleLowerCase();
  const category = Object.keys(overrides).find(key => key.toLocaleLowerCase() === requestedKey) || null;
  if (!category) {
    const available = Object.keys(overrides).sort((a, b) => a.localeCompare(b));
    throw new Error(
      available.length
        ? `Unknown AI model override category "${normalizedCategory}". Available categories: ${available.join(', ')}.`
        : `Unknown AI model override category "${normalizedCategory}"; no override categories are configured.`
    );
  }
  const profile = overrides[category];
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error(`AI model override category "${category}" is not a configuration object.`);
  }
  return { category, profile };
}

class ModelOverrideCommand extends SlashCommandBase {
  static get name() {
    return 'model_override';
  }

  static get description() {
    return 'Set the model for one configured AI override category.';
  }

  static get args() {
    return [
      { name: 'category', type: 'string', required: false },
      { name: 'model', type: 'string', required: false }
    ];
  }

  static async execute(interaction, args = {}) {
    const config = Globals.config;
    const overrides = config?.ai_model_overrides;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      throw new Error('AI model overrides are not configured.');
    }

    const categoryProvided = args.category !== undefined && args.category !== null;
    const modelProvided = args.model !== undefined && args.model !== null;
    if (!categoryProvided && !modelProvided) {
      const categories = Object.entries(overrides)
        .map(([category, profile]) => ({
          category,
          model: normalizeValue(profile?.model) || '(no model configured)'
        }))
        .sort((left, right) => left.category.localeCompare(right.category));
      const lines = categories.length
        ? categories.map(({ category, model }) => `- \`${category}\`: \`${model}\``)
        : ['- No AI model overrides are configured.'];
      await interaction.reply({
        content: `**AI model overrides:**\n${lines.join('\n')}`,
        ephemeral: false
      });
      return;
    }
    if (!categoryProvided || !modelProvided) {
      throw new Error('Specify both an AI model override category and a model name, or neither to list overrides.');
    }

    const model = normalizeValue(args.model);
    if (!model) {
      throw new Error('A non-empty model name is required.');
    }
    const { category, profile } = resolveOverrideCategory(overrides, args.category);
    profile.model = model;

    await interaction.reply({
      content: `AI model override \`${category}\` set to \`${model}\` for subsequent matching prompts.`,
      ephemeral: false
    });
  }
}

module.exports = ModelOverrideCommand;
