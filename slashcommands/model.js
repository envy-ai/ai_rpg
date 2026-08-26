const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function normalizeModelName(value) {
  let model = typeof value === 'string' ? value.trim() : '';
  if ((model.startsWith('"') && model.endsWith('"')) || (model.startsWith("'") && model.endsWith("'"))) {
    model = model.slice(1, -1).trim();
  }
  return model;
}

class ModelCommand extends SlashCommandBase {
  static get name() {
    return 'model';
  }

  static get description() {
    return 'Set the main AI model for subsequent root-routed prompts.';
  }

  static get args() {
    return [
      { name: 'model', type: 'string', required: false }
    ];
  }

  static async execute(interaction, args = {}) {
    const config = Globals.config;
    if (!config || typeof config !== 'object' || !config.ai || typeof config.ai !== 'object' || Array.isArray(config.ai)) {
      throw new Error('Main AI configuration is not initialized.');
    }

    if (args.model === undefined || args.model === null) {
      const currentModel = normalizeModelName(config.ai.model);
      await interaction.reply({
        content: currentModel
          ? `Main AI model: \`${currentModel}\``
          : 'No main AI model is currently configured.',
        ephemeral: false
      });
      return;
    }

    const model = normalizeModelName(args.model);
    if (!model) {
      throw new Error('A non-empty model name is required.');
    }

    config.ai.model = model;
    await interaction.reply({
      content: `Main AI model set to \`${model}\` for subsequent root-routed prompts.`,
      ephemeral: false
    });
  }
}

module.exports = ModelCommand;
