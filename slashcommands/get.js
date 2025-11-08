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

function getNestedValue(target, pathSegments) {
  let cursor = target;
  for (const segment of pathSegments) {
    if (!segment || typeof cursor !== 'object' || cursor === null) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

class GetConfigCommand extends SlashCommandBase {
  static get name() {
    return 'get';
  }

  static get description() {
    return 'Retrieve the current value of a configuration setting.';
  }

  static get args() {
    return [
      { name: 'path', type: 'string', required: true }
    ];
  }

  static async execute(interaction, args = {}) {
    let rawPath = args.path;
    rawPath = stripQuotes(typeof rawPath === 'string' ? rawPath : '');

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

    const value = getNestedValue(config, segments);
    if (value === undefined) {
      await interaction.reply({
        content: `No configuration value found at \`${segments.join('.')}\`.`,
        ephemeral: true
      });
      return;
    }

    let formatted;
    if (typeof value === 'object') {
      try {
        formatted = `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
      } catch (_) {
        formatted = String(value);
      }
    } else {
      formatted = `\`${String(value)}\``;
    }

    await interaction.reply({
      content: `Configuration value for \`${segments.join('.')}\`:\n${formatted}`,
      ephemeral: false
    });
  }
}

module.exports = GetConfigCommand;
