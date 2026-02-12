const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

const DEFAULT_FILE_TYPES = new Set(['common', 'rare']);
const RESERVED_FREQUENCY_KEYS = new Set([
  'enabled',
  'location',
  'region',
  'locationspecific',
  'regionspecific'
]);

function normalizeRandomEventType(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    return '';
  }
  return normalized;
}

function getValidTypes() {
  const validTypes = new Set(['location', 'region']);
  for (const type of DEFAULT_FILE_TYPES) {
    validTypes.add(type);
  }

  const frequencyConfig = Globals?.config?.random_event_frequency;
  if (!frequencyConfig || typeof frequencyConfig !== 'object') {
    return validTypes;
  }

  for (const rawKey of Object.keys(frequencyConfig)) {
    const key = normalizeRandomEventType(rawKey);
    if (!key || RESERVED_FREQUENCY_KEYS.has(key) || DEFAULT_FILE_TYPES.has(key)) {
      continue;
    }
    validTypes.add(key);
  }

  return validTypes;
}

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
    const rawInput = typeof args.type === 'string' ? args.type.trim() : '';
    const normalizedType = normalizeRandomEventType(rawInput);
    const validTypes = getValidTypes();
    if (!normalizedType || !validTypes.has(normalizedType)) {
      const validTypeList = Array.from(validTypes).sort().join(', ');
      await interaction.reply({
        content: `Invalid event type. Use one of: ${validTypeList}.`,
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
      const { result: summary } = await triggerFn({ type: normalizedType, entryCollector });
      result = summary;
    } catch (error) {
      await interaction.reply({
        content: `Failed to trigger ${normalizedType} random event: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    if (!result) {
      await interaction.reply({
        content: `No ${normalizedType} random event was available to trigger.`,
        ephemeral: true
      });
      return;
    }

    const latestEntry = entryCollector.length ? entryCollector[entryCollector.length - 1] : null;
    const eventText = latestEntry?.content || result.summary || result.response || '(event generated)';

    await interaction.reply({
      content: `Triggered ${normalizedType} random event:\n\n${eventText}`,
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
