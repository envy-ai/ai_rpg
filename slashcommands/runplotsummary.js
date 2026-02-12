const SlashCommandBase = require('../SlashCommandBase.js');

class RunPlotSummaryCommand extends SlashCommandBase {
  static get name() {
    return 'runplotsummary';
  }

  static get description() {
    return 'Run the plot-summary prompt immediately and store the result.';
  }

  static get args() {
    return [
      { name: 'show', type: 'boolean', required: false }
    ];
  }

  static async execute(interaction, args = {}) {
    const runPlotSummary = interaction?.runPlotSummaryPrompt;
    if (typeof runPlotSummary !== 'function') {
      throw new Error('Plot summary execution is unavailable in this command context.');
    }

    const createdEntry = await runPlotSummary();
    if (!createdEntry || typeof createdEntry !== 'object') {
      throw new Error('Plot summary did not produce a stored entry (it may already be running).');
    }

    const showOutput = args.show === true;
    if (showOutput) {
      const content = typeof createdEntry.content === 'string' ? createdEntry.content.trim() : '';
      if (!content) {
        throw new Error('Plot summary entry was created without content.');
      }
      await interaction.reply({
        content,
        ephemeral: false
      });
      return;
    }

    await interaction.reply({
      content: 'Plot summary generated and stored.',
      ephemeral: false
    });
  }
}

module.exports = RunPlotSummaryCommand;
