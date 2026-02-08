const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

class ClearSecretsCommand extends SlashCommandBase {
  static get name() {
    return 'clear_secrets';
  }

  static get description() {
    return 'Remove hidden supplemental/offscreen NPC story info entries from chat history.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const chatHistory = typeof interaction?.getChatHistory === 'function'
      ? interaction.getChatHistory()
      : interaction?.chatHistory;

    if (!Array.isArray(chatHistory)) {
      await interaction.reply({
        content: 'Chat history is unavailable in the current command context.',
        ephemeral: true
      });
      return;
    }

    if (chatHistory.length === 0) {
      await interaction.reply({
        content: 'No chat history available to clean.',
        ephemeral: true
      });
      return;
    }

    const removedEntryIds = [];
    let removedCount = 0;
    const removableTypes = new Set([
      'supplemental-story-info',
      'offscreen-npc-activity-daily',
      'offscreen-npc-activity-weekly'
    ]);

    for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
      const entry = chatHistory[index];
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const entryType = typeof entry.type === 'string' ? entry.type.trim() : '';
      if (!removableTypes.has(entryType)) {
        continue;
      }
      if (entry.id) {
        removedEntryIds.push(entry.id);
      }
      chatHistory.splice(index, 1);
      removedCount += 1;
    }

    if (removedCount === 0) {
      await interaction.reply({
        content: 'No secret entries were found in chat history.',
        ephemeral: false
      });
      return;
    }

    const performGameSave = interaction?.performGameSave;
    if (typeof performGameSave !== 'function') {
      throw new Error('performGameSave is unavailable; cannot persist secret entry removal.');
    }
    await performGameSave();

    const realtimeHub = Globals?.realtimeHub;
    if (!realtimeHub || typeof realtimeHub.emit !== 'function') {
      throw new Error('Realtime hub is unavailable; cannot refresh chat history.');
    }
    realtimeHub.emit(null, 'chat_history_updated', {
      removedEntryIds,
      removedEntries: removedCount
    });

    const entryLabel = removedCount === 1 ? 'entry' : 'entries';
    await interaction.reply({
      content: `Removed ${removedCount} secret ${entryLabel} from chat history.`,
      ephemeral: false
    });
  }
}

module.exports = ClearSecretsCommand;
