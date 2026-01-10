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
      { name: 'replacement', type: 'string', required: true },
      { name: 'flags', type: 'string', required: false, default: 'g' }
    ];
  }

  static async execute(interaction, args = {}) {
    const pattern = args.pattern?.trim();
    const replacement = args.replacement?.trim();
    const flags = args.flags?.trim() || 'g';

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

    // Validate flags - only allow valid RegExp flags
    const validFlags = ['g', 'i', 'm', 's', 'u', 'y'];
    const flagChars = flags.split('');
    const invalidFlags = flagChars.filter(flag => !validFlags.includes(flag));
    if (invalidFlags.length > 0) {
      await interaction.reply({
        content: `Invalid regex flags: ${invalidFlags.join(', ')}. Valid flags are: ${validFlags.join(', ')}`,
        ephemeral: true
      });
      return;
    }

    let regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch (error) {
      await interaction.reply({
        content: `Invalid regex pattern: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    const chatHistory = interaction?.chatHistory;

    if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
      await interaction.reply({
        content: 'No chat history available to modify.',
        ephemeral: true
      });
      return;
    }

    let totalReplacements = 0;
    let modifiedEntries = 0;
    const modifiedEntryIds = [];

    // Apply regex replacement to each chat entry
    for (const entry of chatHistory) {
      if (entry && typeof entry.content === 'string') {
        const originalContent = entry.content;
        const newContent = originalContent.replace(regex, replacement);

        if (newContent !== originalContent) {
          entry.content = newContent;
          entry.lastEditedAt = new Date().toISOString();
          if (entry.id) {
            modifiedEntryIds.push(entry.id);
          }
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

    // Save the game state to persist changes
    try {
      const performGameSave = interaction?.performGameSave;
      if (typeof performGameSave === 'function') {
        await performGameSave();
        console.log(`Game saved after regex_replace: ${totalReplacements} replacements in ${modifiedEntries} messages`);
      } else {
        console.warn('performGameSave function not available for persisting regex_replace changes');
      }
    } catch (saveError) {
      console.warn('Failed to save game after regex_replace:', saveError.message);
    }

    // Emit chat history update event
    try {
      const realtimeHub = Globals?.realtimeHub;
      if (realtimeHub && typeof realtimeHub.emit === 'function') {
        realtimeHub.emit(null, 'chat_history_updated', {
          modifiedEntryIds,
          totalReplacements,
          modifiedEntries
        });
      }
    } catch (error) {
      console.warn('Failed to emit chat history refresh after /regex_replace:', error.message);
    }

    await interaction.reply({
      content: `Replaced ${totalReplacements} occurrence(s) in ${modifiedEntries} message(s). Changes have been saved.`,
      ephemeral: false
    });
  }
}

module.exports = RegexReplaceCommand;
