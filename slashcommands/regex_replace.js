const SlashCommandBase = require('../SlashCommandBase.js');
const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const {
  SPECIAL_REGEX_REPLACE_SCOPES,
  applyRegexReplace
} = require('../regex_replace_runtime.js');

class RegexReplaceCommand extends SlashCommandBase {
  static get name() {
    return 'regex_replace';
  }

  static get description() {
    return 'Replace text across the story log, memories, NPCs, locations, and items using regular expressions.';
  }

  static get args() {
    return [
      { name: 'pattern', type: 'string', required: true },
      { name: 'replacement', type: 'string', required: true },
      { name: 'flags', type: 'string', required: false, default: 'g' },
      { name: 'scope', type: 'string', required: false }
    ];
  }

  static validateArgs(providedArgs = {}) {
    const errors = [];
    const hasOwn = (name) => Object.prototype.hasOwnProperty.call(providedArgs, name);

    const pattern = providedArgs.pattern;
    if (pattern === undefined || pattern === null) {
      errors.push('Missing required argument: pattern');
    } else if (typeof pattern !== 'string') {
      errors.push('Argument "pattern" must be a string.');
    }

    const replacement = providedArgs.replacement;
    if (!hasOwn('replacement') || replacement === undefined) {
      errors.push('Missing required argument: replacement');
    } else if (replacement !== null && typeof replacement !== 'string') {
      errors.push('Argument "replacement" must be a string or null.');
    }

    const flags = providedArgs.flags;
    if (flags !== undefined && flags !== null && typeof flags !== 'string') {
      errors.push('Argument "flags" must be a string.');
    }

    const scope = providedArgs.scope;
    if (scope !== undefined && scope !== null && typeof scope !== 'string') {
      errors.push('Argument "scope" must be a string.');
    }

    return errors;
  }

  static async execute(interaction, args = {}) {
    const pattern = args.pattern?.trim();
    const replacement = args.replacement === null ? '' : args.replacement?.trim();
    const flags = args.flags?.trim() || 'g';
    const scope = args.scope?.trim() || '';

    if (!pattern) {
      await interaction.reply({
        content: 'Pattern is required.',
        ephemeral: true
      });
      return;
    }

    if (replacement === undefined) {
      await interaction.reply({
        content: 'Replacement is required.',
        ephemeral: true
      });
      return;
    }

    const chatHistory = interaction?.chatHistory;
    const scopeTargetsOnlyStory = Boolean(scope)
      && scope !== 'story'
      && !SPECIAL_REGEX_REPLACE_SCOPES.has(scope);
    if (scopeTargetsOnlyStory && (!Array.isArray(chatHistory) || chatHistory.length === 0)) {
      await interaction.reply({
        content: 'No chat history available to modify.',
        ephemeral: true
      });
      return;
    }

    let result;
    try {
      result = applyRegexReplace({
        pattern,
        replacement,
        flags,
        scope,
        chatHistory: Array.isArray(chatHistory) ? chatHistory : [],
        players: Player.getAll(),
        locations: Location.getAll(),
        things: Thing.getAll()
      });
    } catch (error) {
      await interaction.reply({
        content: error.message,
        ephemeral: true
      });
      return;
    }

    if (result.modifiedTextValues === 0) {
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
        console.log(
          `Game saved after regex_replace: ${result.totalReplacements} replacements across `
          + `${result.modifiedTextValues} text values`
        );
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
          modifiedEntryIds: result.modifiedChatEntryIds,
          totalReplacements: result.totalReplacements,
          modifiedEntries: result.modifiedChatEntries,
          ...result
        });
      }
    } catch (error) {
      console.warn('Failed to emit chat history refresh after /regex_replace:', error.message);
    }

    const changedOnlyChatHistory = result.modifiedChatEntries > 0
      && result.modifiedMemories === 0
      && result.modifiedNpcFields === 0
      && result.modifiedLocationFields === 0
      && result.modifiedItemFields === 0;
    if (changedOnlyChatHistory) {
      await interaction.reply({
        content: `Replaced ${result.totalReplacements} occurrence(s) in ${result.modifiedChatEntries} message(s). Changes have been saved.`,
        ephemeral: false
      });
      return;
    }

    const targetCounts = [
      [result.modifiedChatEntries, 'message'],
      [result.modifiedMemories, 'memory'],
      [result.modifiedNpcFields, 'NPC field'],
      [result.modifiedLocationFields, 'location field'],
      [result.modifiedItemFields, 'item field']
    ]
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}${count === 1 ? '' : 's'}`);

    await interaction.reply({
      content: `Replaced ${result.totalReplacements} occurrence(s) in ${targetCounts.join(', ')}. Changes have been saved.`,
      ephemeral: false
    });
  }
}

module.exports = RegexReplaceCommand;
