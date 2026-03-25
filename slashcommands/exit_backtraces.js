const Globals = require('../Globals.js');
const Region = require('../Region.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function escapeMarkdown(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  const text = String(value).trim();
  if (!text) {
    return '-';
  }
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatCode(value) {
  if (value === null || value === undefined) {
    return '-';
  }
  const text = String(value).trim();
  return text ? `\`${text.replace(/`/g, '\\`')}\`` : '-';
}

function formatBoolean(value) {
  return value ? 'Yes' : 'No';
}

function formatLocationLabel(location) {
  if (!location || typeof location !== 'object') {
    return 'Unknown Location';
  }

  const locationName = typeof location.name === 'string' && location.name.trim()
    ? location.name.trim()
    : (typeof location.id === 'string' && location.id.trim() ? location.id.trim() : 'Unknown Location');
  const region = location.region
    || (typeof location.regionId === 'string' && location.regionId.trim()
      ? Region.get(location.regionId.trim()) || null
      : null);
  const regionName = typeof region?.name === 'string' && region.name.trim()
    ? region.name.trim()
    : '';

  return regionName ? `${regionName}:${locationName}` : locationName;
}

function formatDestinationLabel(exit) {
  if (!exit || typeof exit !== 'object') {
    return '-';
  }

  const destinationLocation = exit.location || null;
  if (destinationLocation && typeof destinationLocation === 'object') {
    return escapeMarkdown(formatLocationLabel(destinationLocation));
  }

  const fallbackName = typeof exit.name === 'string' && exit.name.trim()
    ? exit.name.trim()
    : (typeof exit.destination === 'string' && exit.destination.trim() ? exit.destination.trim() : '-');
  return escapeMarkdown(fallbackName);
}

class ExitBacktracesCommand extends SlashCommandBase {
  static get name() {
    return 'exit_backtraces';
  }

  static get description() {
    return 'List every exit in the current location along with the captured creation backtrace.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const player = Globals.currentPlayer;
    if (!player) {
      throw new Error('Current player is unavailable.');
    }

    const location = player.currentLocationObject || null;
    if (!location) {
      throw new Error('Current location is unavailable.');
    }

    if (typeof location.getAvailableDirections !== 'function' || typeof location.getExit !== 'function') {
      throw new Error('Current location does not expose exit helpers.');
    }

    const directions = location.getAvailableDirections().slice().sort((a, b) => a.localeCompare(b));
    const lines = [
      `## Exit Backtraces: ${escapeMarkdown(formatLocationLabel(location))} (${formatCode(location.id)})`,
      ''
    ];

    if (directions.length === 0) {
      lines.push('(no exits)');
    } else {
      for (const direction of directions) {
        const exit = location.getExit(direction);
        if (!exit) {
          continue;
        }
        const exitDetails = typeof exit.getDetails === 'function'
          ? exit.getDetails()
          : null;

        lines.push(`### ${escapeMarkdown(direction)}`);
        lines.push(`- Exit id: ${formatCode(exit.id)}`);
        lines.push(`- Description: ${escapeMarkdown(exit.description || '-')}`);
        lines.push(`- Destination: ${formatDestinationLabel(exit)} (${formatCode(exit.destination)})`);
        lines.push(`- Destination region: ${formatCode(exitDetails?.destinationRegion)}`);
        lines.push(`- Vehicle exit: **${formatBoolean(exit.isVehicle)}**`);
        lines.push(`- Vehicle type: ${escapeMarkdown(exit.vehicleType || '-')}`);
        lines.push('- Backtrace:');
        lines.push('```text');
        lines.push(typeof exit.backtrace === 'string' && exit.backtrace.trim()
          ? exit.backtrace.trim()
          : 'Backtrace unavailable');
        lines.push('```');
        lines.push('');
      }
    }

    await interaction.reply({
      content: lines.join('\n').trimEnd(),
      ephemeral: false
    });
  }
}

module.exports = ExitBacktracesCommand;
