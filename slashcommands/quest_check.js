const SlashCommandBase = require('../SlashCommandBase.js');

class QuestCheckCommand extends SlashCommandBase {
  static get name() {
    return 'quest_check';
  }

  static get description() {
    return 'Run the quest checker prompt immediately and apply its results.';
  }

  static get args() {
    return [];
  }

  static get usage() {
    return '/quest_check';
  }

  static async execute(interaction) {
    const runQuestCheck = interaction?.runQuestCheckPrompt;
    if (typeof runQuestCheck !== 'function') {
      throw new Error('Quest check execution is unavailable in this command context.');
    }

    const result = await runQuestCheck();
    if (!result || typeof result !== 'object') {
      throw new Error('Quest check prompt did not produce a result.');
    }

    if (!Array.isArray(result.storedEntries) || !result.storedEntries.length
      || result.storedEntries.some(entry => !entry?.id)) {
      throw new Error('Quest check prompt did not store its results in chat history.');
    }
    const errors = Array.isArray(result.errors) ? result.errors.filter(Boolean) : [];

    if (typeof interaction.requestClientRefresh === 'function') {
      interaction.requestClientRefresh({
        locationRefreshRequested: true,
        relationshipGraphRefreshRequested: true
      });
    }

    await interaction.reply({
      content: errors.length
        ? `Quest processing errors\n\n${errors.map(error => `- ${error?.message || String(error)}`).join('\n')}`
        : '',
      ephemeral: errors.length > 0
    });
  }
}

module.exports = QuestCheckCommand;
