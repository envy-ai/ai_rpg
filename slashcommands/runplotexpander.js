const SlashCommandBase = require('../SlashCommandBase.js');

class RunPlotExpanderCommand extends SlashCommandBase {
  static get name() {
    return 'runplotexpander';
  }

  static get description() {
    return 'Run the plot-expander prompt immediately and store the result.';
  }

  static get args() {
    return [
      { name: 'show', type: 'boolean', required: false },
      { name: 'specificPlot', type: 'string', required: true }
    ];
  }

  static async execute(interaction, args = {}) {
    const runPlotExpander = interaction?.runPlotExpanderPrompt;
    if (typeof runPlotExpander !== 'function') {
      throw new Error('Plot expander execution is unavailable in this command context.');
    }

    const specificPlot = typeof args.specificPlot === 'string' ? args.specificPlot.trim() : '';
    if (!specificPlot) {
      throw new Error('specificPlot is required and must be a non-empty string.');
    }

    const createdEntry = await runPlotExpander({ specificPlot });
    if (!createdEntry || typeof createdEntry !== 'object') {
      throw new Error('Plot expander did not produce a stored entry (it may already be running).');
    }

    const showOutput = args.show === true;
    if (showOutput) {
      const content = typeof createdEntry.content === 'string' ? createdEntry.content.trim() : '';
      if (!content) {
        throw new Error('Plot expander entry was created without content.');
      }
      await interaction.reply({
        content,
        ephemeral: false
      });
      return;
    }

    await interaction.reply({
      content: 'Plot expander generated and stored.',
      ephemeral: false
    });
  }
}

module.exports = RunPlotExpanderCommand;
