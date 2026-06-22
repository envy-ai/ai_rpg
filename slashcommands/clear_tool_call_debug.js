const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

class ClearToolCallDebugCommand extends SlashCommandBase {
  static get name() {
    return 'clear_tool_call_debug';
  }

  static get aliases() {
    return ['clear_tool_calls', 'clear_tool_debug'];
  }

  static get description() {
    return 'Remove tool-call debug entries from chat history and reload the page.';
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

    const removedEntryIds = [];
    let removedCount = 0;

    for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
      const entry = chatHistory[index];
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const entryType = typeof entry.type === 'string' ? entry.type.trim() : '';
      if (entryType !== 'tool-call-debug') {
        continue;
      }
      if (entry.id) {
        removedEntryIds.push(entry.id);
      }
      chatHistory.splice(index, 1);
      removedCount += 1;
    }

    if (removedCount > 0) {
      const performGameSave = interaction?.performGameSave;
      if (typeof performGameSave !== 'function') {
        throw new Error('performGameSave is unavailable; cannot persist tool-call debug removal.');
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
    }

    const entryLabel = removedCount === 1 ? 'entry' : 'entries';
    await interaction.reply({
      content: `Removed ${removedCount} tool-call debug ${entryLabel} from chat history. Reloading page...`,
      ephemeral: false,
      action: {
        type: 'reload_page',
        delayMs: 250
      }
    });
  }
}

module.exports = ClearToolCallDebugCommand;
