const Globals = require('../Globals.js');
const Location = require('../Location.js');
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

function formatEntityLabel(entity, { includeRegion = true } = {}) {
  if (!entity || typeof entity !== 'object') {
    return '-';
  }
  const name = typeof entity.name === 'string' && entity.name.trim()
    ? entity.name.trim()
    : (typeof entity.id === 'string' && entity.id.trim() ? entity.id.trim() : 'Unknown');
  if (!includeRegion) {
    return name;
  }
  const region = entity.region
    || (typeof entity.regionId === 'string' && entity.regionId.trim()
      ? Region.get(entity.regionId.trim()) || null
      : null);
  const regionName = typeof region?.name === 'string' && region.name.trim()
    ? region.name.trim()
    : '';
  return regionName ? `${regionName}:${name}` : name;
}

function resolveLocationLabel(locationId) {
  if (typeof locationId !== 'string' || !locationId.trim()) {
    return '-';
  }
  const location = Location.get(locationId.trim()) || null;
  if (!location) {
    return locationId.trim();
  }
  return formatEntityLabel(location);
}

function formatDestinationWithId(locationId, fallbackLabel = '') {
  const trimmedId = typeof locationId === 'string' ? locationId.trim() : '';
  const label = trimmedId
    ? resolveLocationLabel(trimmedId)
    : (typeof fallbackLabel === 'string' && fallbackLabel.trim() ? fallbackLabel.trim() : '-');
  if (!trimmedId) {
    return escapeMarkdown(label);
  }
  return `${escapeMarkdown(label)} (${formatCode(trimmedId)})`;
}

function formatRouteDestinations(destinations) {
  if (!Array.isArray(destinations) || destinations.length === 0) {
    return '-';
  }
  return destinations.map(destinationId => formatDestinationWithId(destinationId)).join(', ');
}

function formatTerrainTypes(value) {
  if (typeof value !== 'string') {
    return '-';
  }
  const trimmed = value.trim();
  return trimmed ? escapeMarkdown(trimmed) : '-';
}

function formatAbsoluteMinute(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) {
    return '-';
  }

  let suffix = '';
  try {
    const timeConfig = typeof Globals.getTimeConfig === 'function'
      ? Globals.getTimeConfig()
      : null;
    const cycleLengthMinutes = Number(timeConfig?.cycleLengthMinutes);
    if (Number.isFinite(cycleLengthMinutes) && cycleLengthMinutes > 0) {
      const dayIndex = Math.floor(numeric / cycleLengthMinutes);
      const timeMinutes = numeric - (dayIndex * cycleLengthMinutes);
      const worldTime = { dayIndex, timeMinutes };
      const dateLabel = typeof Globals.formatDate === 'function'
        ? Globals.formatDate(worldTime, { skipEnsure: true })
        : null;
      const timeLabel = typeof Globals.formatTime === 'function'
        ? Globals.formatTime(worldTime, { skipEnsure: true })
        : null;
      if (dateLabel && timeLabel) {
        suffix = ` (${escapeMarkdown(dateLabel)}, ${escapeMarkdown(timeLabel)})`;
      }
    }
  } catch (_) {
    suffix = '';
  }

  return `${numeric}${suffix}`;
}

function resolveActiveVehicleRecord(player) {
  if (!player) {
    return null;
  }

  const currentLocation = player.currentLocationObject
    || (typeof player.currentLocation === 'string' && player.currentLocation.trim()
      ? Location.get(player.currentLocation.trim()) || null
      : null);
  if (!currentLocation) {
    return null;
  }

  const currentRegion = currentLocation.region
    || (typeof currentLocation.regionId === 'string' && currentLocation.regionId.trim()
      ? Region.get(currentLocation.regionId.trim()) || null
      : null);
  if (currentRegion?.isVehicle === true) {
    return {
      kind: 'region',
      entity: currentRegion,
      currentLocation
    };
  }
  if (currentLocation?.isVehicle === true) {
    return {
      kind: 'location',
      entity: currentLocation,
      currentLocation
    };
  }
  return null;
}

class VehicleStatusCommand extends SlashCommandBase {
  static get name() {
    return 'vehicle_status';
  }

  static get description() {
    return 'Show detailed markdown status for the vehicle the current player is inside.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const player = Globals.currentPlayer;
    if (!player) {
      throw new Error('Current player is unavailable.');
    }

    const currentVehicle = player.currentVehicle;
    if (!currentVehicle || typeof currentVehicle !== 'object') {
      throw new Error('Current player is not inside a vehicle.');
    }

    const activeVehicleRecord = resolveActiveVehicleRecord(player);
    if (!activeVehicleRecord?.entity) {
      throw new Error('Active vehicle could not be resolved from the current player context.');
    }

    const vehicleInfo = currentVehicle.vehicleInfo && typeof currentVehicle.vehicleInfo === 'object'
      ? currentVehicle.vehicleInfo
      : {};
    const currentDestinationId = typeof vehicleInfo.currentDestination === 'string'
      ? vehicleInfo.currentDestination.trim()
      : '';
    const departureTime = Number.isInteger(vehicleInfo.departureTime) ? vehicleInfo.departureTime : null;
    const eta = Number.isInteger(vehicleInfo.ETA) ? vehicleInfo.ETA : null;

    const lines = [
      `## Vehicle Status: ${escapeMarkdown(currentVehicle.name || activeVehicleRecord.entity.name || activeVehicleRecord.entity.id || 'Unknown Vehicle')}`,
      '',
      `- Vehicle kind: **${activeVehicleRecord.kind === 'region' ? 'Region vehicle' : 'Location vehicle'}**`,
      `- Vehicle id: ${formatCode(activeVehicleRecord.entity.id)}`,
      `- Player location inside vehicle: **${escapeMarkdown(formatEntityLabel(activeVehicleRecord.currentLocation, { includeRegion: false }))}** (${formatCode(activeVehicleRecord.currentLocation.id)})`,
      `- Vehicle description: ${escapeMarkdown(currentVehicle.description || activeVehicleRecord.entity.description || '-')}`,
      `- Outside location: **${escapeMarkdown(currentVehicle.location || '-')}**`,
      `- Current destination: **${formatDestinationWithId(currentDestinationId, currentVehicle.destination || '')}**`,
      `- Fixed-route destinations: ${formatRouteDestinations(vehicleInfo.destinations)}`,
      `- Is underway: **${formatBoolean(currentVehicle.isUnderway)}**`,
      `- Has arrived: **${formatBoolean(currentVehicle.hasArrived)}**`,
      `- Is arriving: **${formatBoolean(currentVehicle.isArriving)}**`,
      `- Travel start time: **${formatAbsoluteMinute(departureTime)}**`,
      `- ETA: **${formatAbsoluteMinute(eta)}**`,
      `- Minutes to destination: **${currentVehicle.minutesToDestination == null ? '-' : escapeMarkdown(currentVehicle.minutesToDestination)}**`,
      `- Time to destination: **${escapeMarkdown(currentVehicle.timeToDestination || '-')}**`,
      `- Vehicle exit id: ${formatCode(vehicleInfo.vehicleExitId)}`,
      `- Icon: ${escapeMarkdown(vehicleInfo.icon || '-')}`,
      `- Terrain types: ${formatTerrainTypes(vehicleInfo.terrainTypes)}`
    ];

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = VehicleStatusCommand;
