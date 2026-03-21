const Location = require('../Location.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveLocationRegionId(location) {
  if (!location || typeof location !== 'object') {
    return null;
  }

  const directRegionId = normalizeString(location.regionId);
  if (directRegionId) {
    return directRegionId;
  }

  const metadata = location.stubMetadata && typeof location.stubMetadata === 'object'
    ? location.stubMetadata
    : {};
  const metadataRegionId = normalizeString(metadata.regionId) || normalizeString(metadata.targetRegionId);
  return metadataRegionId || null;
}

function findReverseExit(destinationLocation, sourceLocationId) {
  if (!destinationLocation) {
    return null;
  }
  if (typeof destinationLocation.getAvailableDirections !== 'function'
    || typeof destinationLocation.getExit !== 'function') {
    return null;
  }

  const directions = destinationLocation.getAvailableDirections();
  if (!Array.isArray(directions)) {
    return null;
  }

  for (const direction of directions) {
    const candidate = destinationLocation.getExit(direction);
    if (!candidate) {
      continue;
    }
    const candidateDestinationId = normalizeString(candidate.destination);
    if (candidateDestinationId && candidateDestinationId === sourceLocationId) {
      return { direction, exit: candidate };
    }
  }

  return null;
}

class FixExitsCommand extends SlashCommandBase {
  static get name() {
    return 'fix_exits';
  }

  static get description() {
    return 'Create missing reverse exits so one-way connections become two-way.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const serverExports = require('../server.js');
    const ensureExitConnection = serverExports?.ensureExitConnection;
    if (typeof ensureExitConnection !== 'function') {
      throw new Error('fix_exits cannot run because ensureExitConnection is unavailable.');
    }

    const locations = Location.getAll();
    if (!Array.isArray(locations)) {
      throw new Error('fix_exits cannot run because the location list is unavailable.');
    }

    const locationById = new Map();
    for (const location of locations) {
      const locationId = normalizeString(location?.id);
      if (!locationId) {
        continue;
      }
      locationById.set(locationId, location);
    }

    let scannedExits = 0;
    let repairedConnections = 0;
    let missingDestinationCount = 0;
    let selfReferentialCount = 0;
    const repairedSamples = [];

    for (const sourceLocation of locations) {
      if (!sourceLocation) {
        continue;
      }
      if (typeof sourceLocation.getAvailableDirections !== 'function'
        || typeof sourceLocation.getExit !== 'function') {
        continue;
      }

      const directions = sourceLocation.getAvailableDirections();
      if (!Array.isArray(directions)) {
        continue;
      }

      for (const direction of directions) {
        const exit = sourceLocation.getExit(direction);
        if (!exit) {
          continue;
        }

        scannedExits += 1;

        const destinationId = normalizeString(exit.destination);
        if (!destinationId) {
          missingDestinationCount += 1;
          continue;
        }

        const destinationLocation = locationById.get(destinationId);
        if (!destinationLocation) {
          missingDestinationCount += 1;
          continue;
        }

        if (destinationLocation.id === sourceLocation.id) {
          selfReferentialCount += 1;
          continue;
        }

        const reverseExit = findReverseExit(destinationLocation, sourceLocation.id);
        if (reverseExit) {
          continue;
        }

        if (exit.bidirectional !== true) {
          try {
            exit.bidirectional = true;
          } catch (_) {
            exit.update({ bidirectional: true });
          }
        }

        const sourceRegionId = resolveLocationRegionId(sourceLocation);
        const destinationRegionId = resolveLocationRegionId(destinationLocation);
        const normalizedExitDestinationRegion = normalizeString(exit.destinationRegion);
        const destinationRegionForExit = normalizedExitDestinationRegion
          || (destinationRegionId && destinationRegionId !== sourceRegionId ? destinationRegionId : null);
        const normalizedVehicleType = normalizeString(exit.vehicleType);
        const resolvedIsVehicle = Boolean(exit.isVehicle) || Boolean(normalizedVehicleType);
        const description = normalizeString(exit.description) || `${destinationLocation.name || destinationLocation.id}`;

        ensureExitConnection(sourceLocation, destinationLocation, {
          description,
          bidirectional: true,
          destinationRegion: destinationRegionForExit,
          isVehicle: resolvedIsVehicle,
          vehicleType: normalizedVehicleType || null
        });

        repairedConnections += 1;
        if (repairedSamples.length < 20) {
          repairedSamples.push(`${sourceLocation.name || sourceLocation.id} -> ${destinationLocation.name || destinationLocation.id}`);
        }
      }
    }

    const lines = [
      'fix_exits complete.',
      `Scanned exits: ${scannedExits}`,
      `Repaired one-way connections: ${repairedConnections}`,
      `Skipped exits with missing destinations: ${missingDestinationCount}`,
      `Skipped self-referential exits: ${selfReferentialCount}`
    ];

    if (repairedSamples.length) {
      lines.push('');
      lines.push('Repaired samples:');
      for (const sample of repairedSamples) {
        lines.push(`- ${sample}`);
      }
      if (repairedConnections > repairedSamples.length) {
        lines.push(`- ...and ${repairedConnections - repairedSamples.length} more`);
      }
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = FixExitsCommand;
