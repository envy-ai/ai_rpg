const SlashCommandBase = require('../SlashCommandBase.js');

function formatToolExecutionCount(count) {
  const normalizedCount = Number.isInteger(count) && count >= 0 ? count : 0;
  return `${normalizedCount} housekeeping tool execution${normalizedCount === 1 ? '' : 's'}`;
}

class HousekeepingCommand extends SlashCommandBase {
  static get name() {
    return 'housekeeping';
  }

  static get aliases() {
    return ['runhousekeeping'];
  }

  static get description() {
    return 'Run the housekeeping prompt immediately with optional instructions.';
  }

  static get args() {
    return [];
  }

  static get usage() {
    return '/housekeeping [instructions...]';
  }

  static async execute(interaction) {
    const runHousekeeping = interaction?.runHousekeepingPrompt;
    if (typeof runHousekeeping !== 'function') {
      throw new Error('Housekeeping execution is unavailable in this command context.');
    }
    if (typeof interaction?.clientId !== 'string' || !interaction.clientId.trim()) {
      throw new Error('Housekeeping slash command requires an active client connection.');
    }

    const instructions = typeof interaction.argsText === 'string'
      ? interaction.argsText.trim()
      : '';
    const result = await runHousekeeping({ instructions });
    if (!result || typeof result !== 'object') {
      throw new Error('Housekeeping prompt did not produce a result.');
    }

    if (typeof interaction.requestClientRefresh === 'function') {
      interaction.requestClientRefresh({
        locationRefreshRequested: true,
        relationshipGraphRefreshRequested: true
      });
    }

    const toolExecutionCount = Array.isArray(result.toolInvocations)
      ? result.toolInvocations.length
      : 0;
    await interaction.reply({
      content: `Housekeeping completed. Applied ${formatToolExecutionCount(toolExecutionCount)}.`,
      ephemeral: false
    });
  }
}

module.exports = HousekeepingCommand;
