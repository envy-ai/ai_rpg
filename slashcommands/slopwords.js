const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

class SlopwordsCommand extends SlashCommandBase {
  static get name() {
    return 'slopwords';
  }

  static get description() {
    return 'Report slop words exceeding their configured ppm thresholds.';
  }

  static get args() {
    return [
      { name: 'default', type: 'integer', required: false }
    ];
  }

  static async execute(interaction, args = {}) {
    const analyzeFn = Globals.analyzeChatSlopwords;
    if (typeof analyzeFn !== 'function') {
      throw new Error('Slopword analysis is unavailable on this server.');
    }

    let flagged;
    try {
      const overrideDefault = Object.prototype.hasOwnProperty.call(args, 'default')
        ? args.default
        : null;
      flagged = await analyzeFn({ defaultPpmOverride: overrideDefault });
    } catch (error) {
      await interaction.reply({
        content: `Slopword analysis failed: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    if (!Array.isArray(flagged)) {
      throw new Error('Slopword analysis returned an invalid result.');
    }

    const content = flagged.length
      ? flagged.join(', ')
      : 'No slopwords exceed the configured thresholds.';

    await interaction.reply({
      content,
      ephemeral: false
    });
  }
}

module.exports = SlopwordsCommand;
