const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');

class RegexReplaceCommand extends SlashCommandBase {
  static get name() {
    return 'regex_replace';
  }

  static get description() {
    return 'Replace strings throughout the story log using regular expressions.';
  }

  static get args() {
    return [
      { name: 'pattern', type: 'string', required: true },
      { name: 'replacement', type: 'string', required: true }
    ];
  }

  static async execute(interaction, args = {}) {
    const pattern = args.pattern?.trim();
    const replacement = args.replacement?.trim();

    if (!pattern) {
      await interaction.reply({
        content: 'Pattern is required.',
        ephemeral: true
      });
      return;
    }

    if (!replacement) {
      await interaction.reply({
        content: 'Replacement is required.',
        ephemeral: true
      });
      return;
    }

    let regex;
    try {
      regex = new RegExp(pattern, 'g');
    } catch (error) {
      await interaction.reply({
        content: `Invalid regex pattern: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    // Access chatHistory from the global scope (available in api.js context)
    const chatHistory = global.chatHistory || [];

    if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
      await interaction.reply({
        content: 'No chat history available to modify.',
        ephemeral: true
      });
      return;
    }

    let totalReplacements = 0;
    let modifiedEntries = 0;

    // Apply regex replacement to each chat entry
    for (const entry of chatHistory) {
      if (entry && typeof entry.content === 'string') {
        const originalContent = entry.content;
        const newContent = originalContent.replace(regex, replacement);

        if (newContent !== originalContent) {
          entry.content = newContent;
          modifiedEntries++;
          const entryReplacements = (originalContent.match(regex) || []).length;
          totalReplacements += entryReplacements;
        }
      }
    }

    if (modifiedEntries === 0) {
      await interaction.reply({
        content: 'No matches found for the given pattern.',
        ephemeral: false
      });
      return;
    }

    // Emit chat history update event
    try {
      const realtimeHub = Globals?.realtimeHub;
      if (realtimeHub && typeof realtimeHub.emit === 'function') {
        realtimeHub.emit(null, 'chat_history_updated', {});
      }
    } catch (error) {
      console.warn('Failed to emit chat history refresh after /regex_replace:', error.message);
    }

    await interaction.reply({
      content: `Replaced ${totalReplacements} occurrence(s) in ${modifiedEntries} message(s).`,
      ephemeral: false
    });
  }
}

module.exports = RegexReplaceCommand;