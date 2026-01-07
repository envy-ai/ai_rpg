const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

class ReloadLorebooksCommand extends SlashCommandBase {
  static get name() {
    return 'reload_lorebooks';
  }

  static get aliases() {
    return ['reloadlorebooks', 'rlb'];
  }

  static get description() {
    return 'Reload all lorebooks from the lorebooks directory.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const reloadFn = Globals.reloadLorebooks;
    if (typeof reloadFn !== 'function') {
      await interaction.reply({
        content: 'Lorebook reload is unavailable on this server.',
        ephemeral: true
      });
      return;
    }

    let result;
    try {
      result = await reloadFn();
    } catch (error) {
      await interaction.reply({
        content: `Lorebook reload failed: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    const details = [];
    if (result?.count !== undefined) {
      details.push(`${result.count} lorebook(s)`);
    }
    if (result?.enabledCount !== undefined) {
      details.push(`${result.enabledCount} enabled`);
    }
    if (result?.totalEntries !== undefined) {
      details.push(`${result.totalEntries} active entries`);
    }

    await interaction.reply({
      content: `Lorebooks reloaded: ${details.join(', ') || 'done'}.`,
      ephemeral: false
    });
  }
}

module.exports = ReloadLorebooksCommand;
