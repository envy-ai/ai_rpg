const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

class ReloadConfigCommand extends SlashCommandBase {
  static get name() {
    return 'reload_config';
  }

  static get aliases() {
    return ['reloadconfig', 'rcfg'];
  }

  static get description() {
    return 'Reload config.default.yaml, config.yaml, and definition caches.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const reloadFn = Globals.reloadConfigAndDefs;
    if (typeof reloadFn !== 'function') {
      throw new Error('Config reload is unavailable on this server.');
    }

    let result;
    try {
      result = reloadFn();
    } catch (error) {
      await interaction.reply({
        content: `Reload failed: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    const details = [];
    if (result?.timestamp) {
      details.push(`at ${result.timestamp}`);
    }
    if (result?.modEnableDiff?.changed) {
        const segments = [];
        if (result.modEnableDiff.added.length > 0) {
            segments.push(`newly enabled on disk: ${result.modEnableDiff.added.join(', ')}`);
        }
      if (result.modEnableDiff.removed.length > 0) {
        segments.push(`disabled on disk: ${result.modEnableDiff.removed.join(', ')}`);
        }
        details.push(`Mod enable/disable changes require a server restart to apply (${segments.join('; ')}).`);
    }
    if (Array.isArray(result?.warnings) && result.warnings.length > 0) {
        details.push(`Warnings: ${result.warnings.join(' ')}`);
    }

    await interaction.reply({
        content: `Configuration and defs reloaded ${details.join(' ')}`.trim(),
        ephemeral: false
    });
  }
}

module.exports = ReloadConfigCommand;
