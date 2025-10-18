const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

const VALID_TYPES = new Set(['common', 'rare', 'location', 'region']);

class RandomCommand extends SlashCommandBase {
  static get name() {
    return 'random';
  }

  static get description() {
    return 'Trigger a random event of the specified type.';
  }

  static get args() {
    return [
      { name: 'type', type: 'string', required: true }
    ];
  }

  static async execute(interaction, args = {}) {
    const rawType = typeof args.type === 'string' ? args.type.trim().toLowerCase() : '';
    if (rawType !== '' && !VALID_TYPES.has(rawType)) {
      await interaction.reply({
        content: 'Invalid event type. Use one of: common, rare, location, region.',
        ephemeral: true
      });
      return;
    }

    const triggerFn = Globals?.triggerRandomEvent;
    if (typeof triggerFn !== 'function') {
      throw new Error('Random event triggering is unavailable.');
    }

    const entryCollector = [];
    let result;
    try {
      const { result: summary } = await triggerFn({ type: rawType, entryCollector });
      result = summary;
    } catch (error) {
      await interaction.reply({
        content: `Failed to trigger ${rawType} random event: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    if (!result) {
      await interaction.reply({
        content: `No ${rawType} random event was available to trigger.`,
        ephemeral: true
      });
      return;
    }

    const latestEntry = entryCollector.length ? entryCollector[entryCollector.length - 1] : null;
    const eventText = latestEntry?.content || result.summary || result.response || '(event generated)';

    await interaction.reply({
      content: `Triggered ${rawType} random event:\n\n${eventText}`,
      ephemeral: false
    });

    try {
      const realtimeHub = Globals?.realtimeHub;
      if (realtimeHub && typeof realtimeHub.emit === 'function') {
        realtimeHub.emit(null, 'chat_history_updated', {});
      }
    } catch (error) {
      console.warn('Failed to emit chat history refresh after /random:', error.message);
    }
  }
}

module.exports = RandomCommand;
