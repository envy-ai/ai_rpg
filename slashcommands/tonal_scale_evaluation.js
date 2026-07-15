const SlashCommandBase = require('../SlashCommandBase.js');

class TonalScaleEvaluationCommand extends SlashCommandBase {
  static get name() {
    return 'tonal_scale_evaluation';
  }

  static get description() {
    return 'Run the tonal scale evaluation prompt immediately.';
  }

  static get args() {
    return [];
  }

  static get usage() {
    return '/tonal_scale_evaluation';
  }

  static async execute(interaction) {
    const runTonalScaleEvaluation = interaction?.runTonalScaleEvaluationPrompt;
    if (typeof runTonalScaleEvaluation !== 'function') {
      throw new Error('Tonal scale evaluation is unavailable in this command context.');
    }

    const result = await runTonalScaleEvaluation({ storeChatEntry: true });
    const evaluation = typeof result?.evaluation === 'string' ? result.evaluation.trim() : '';
    if (!evaluation) {
      throw new Error('Tonal scale evaluation prompt did not return an evaluation.');
    }
    if (!result?.storedEntry?.id) {
      throw new Error('Tonal scale evaluation prompt did not store a chat entry.');
    }

    await interaction.reply({
      content: '',
      ephemeral: false
    });
  }
}

module.exports = TonalScaleEvaluationCommand;
