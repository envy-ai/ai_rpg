const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function stripQuotes(value) {
  if (typeof value !== 'string') {
    return value;
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseValue(raw) {
  if (typeof raw !== 'string') {
    return raw;
  }
  const trimmed = stripQuotes(raw);
  const lower = trimmed.toLowerCase();
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  return trimmed;
}

function setNestedValue(target, pathSegments, value) {
  let cursor = target;
  for (let index = 0; index < pathSegments.length; index += 1) {
    const segment = pathSegments[index];
    if (!segment) {
      throw new Error('Configuration path contains an empty segment.');
    }
    const isLast = index === pathSegments.length - 1;
    if (isLast) {
      cursor[segment] = value;
      return;
    }
    if (typeof cursor[segment] !== 'object' || cursor[segment] === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
}

class SetConfigCommand extends SlashCommandBase {
  static get name() {
    return 'set';
  }

  static get description() {
    return 'Set a configuration value at runtime.';
  }

  static get args() {
    return [
      { name: 'path', type: 'string', required: true },
      { name: 'value', type: 'string', required: true }
    ];
  }

  static async execute(interaction, args = {}) {
    let rawPath = args.path;
    let rawValue = args.value;

    rawPath = stripQuotes(typeof rawPath === 'string' ? rawPath : '');
    rawValue = typeof rawValue === 'string' ? rawValue : '';

    if (!rawPath) {
      await interaction.reply({
        content: 'You must provide a configuration path (e.g., `random_events.frequency`).',
        ephemeral: true
      });
      return;
    }

    const config = Globals.config;
    if (!config || typeof config !== 'object') {
      await interaction.reply({
        content: 'Configuration has not been initialized yet.',
        ephemeral: true
      });
      return;
    }

    const segments = rawPath.split('.').map(part => part.trim()).filter(Boolean);
    if (!segments.length) {
      await interaction.reply({
        content: 'Invalid configuration path provided.',
        ephemeral: true
      });
      return;
    }

    const value = parseValue(rawValue);
    try {
      setNestedValue(config, segments, value);
    } catch (error) {
      await interaction.reply({
        content: `Failed to set configuration value: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    await interaction.reply({
      content: `Configuration updated: \`${segments.join('.')}\` = \`${value}\``,
      ephemeral: false
    });
  }
}

module.exports = SetConfigCommand;
