const SlashCommandBase = require('../SlashCommandBase.js');
const Location = require('../Location.js');
const Region = require('../Region.js');

const resolveLocationLabel = (location) => {
  if (location && typeof location.name === 'string' && location.name.trim()) {
    return location.name.trim();
  }
  if (location && typeof location.id === 'string' && location.id.trim()) {
    return `Location ${location.id.trim()}`;
  }
  return 'Location <missing id>';
};

const resolveRegionLabel = (region) => {
  if (region && typeof region.name === 'string' && region.name.trim()) {
    return region.name.trim();
  }
  if (region && typeof region.id === 'string' && region.id.trim()) {
    return `Region ${region.id.trim()}`;
  }
  return 'Region <missing id>';
};

class OrphanedLocationsCommand extends SlashCommandBase {
  static get name() {
    return 'orphaned_locations';
  }

  static get description() {
    return 'List locations missing valid region links and/or usable exits.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const locations = Location.getAll();
    if (!Array.isArray(locations)) {
      throw new Error('Location list is unavailable.');
    }
    const regions = Region.getAll();
    if (!Array.isArray(regions)) {
      throw new Error('Region list is unavailable.');
    }

    const regionById = new Map();
    regions.forEach(region => {
      if (region && typeof region.id === 'string' && region.id.trim()) {
        regionById.set(region.id.trim(), region);
      }
    });

    const missingRegion = [];
    const noExits = [];
    const both = [];
    const warnings = [];

    locations.forEach(location => {
      if (!location) {
        warnings.push('Encountered null location entry.');
        return;
      }

      const label = resolveLocationLabel(location);
      const regionId = typeof location.regionId === 'string' && location.regionId.trim()
        ? location.regionId.trim()
        : null;
      const region = regionId ? regionById.get(regionId) : null;
      const regionLocationIds = region && Array.isArray(region.locationIds) ? region.locationIds : [];
      const regionContainsLocation = regionLocationIds.includes(location.id);
      const hasValidRegion = Boolean(region) && Boolean(regionContainsLocation);

      const exitDirections = typeof location.getAvailableDirections === 'function'
        ? location.getAvailableDirections()
        : [];
      let hasValidExit = false;
      if (Array.isArray(exitDirections)) {
        for (const direction of exitDirections) {
          const exit = typeof location.getExit === 'function' ? location.getExit(direction) : null;
          if (!exit || !exit.destination) {
            continue;
          }
          const destinationLocation = Location.get(exit.destination);
          if (destinationLocation) {
            hasValidExit = true;
            break;
          }
        }
      }

      const missingRegionReason = !regionId
        ? 'missing regionId'
        : (!region ? `invalid regionId (${regionId})` : (!regionContainsLocation ? `region missing location (${resolveRegionLabel(region)})` : ''));

      const missingRegionEntry = missingRegionReason
        ? `${label} — ${missingRegionReason}`
        : label;

      if (!hasValidRegion && !hasValidExit) {
        both.push(missingRegionEntry);
        return;
      }
      if (!hasValidRegion) {
        missingRegion.push(missingRegionEntry);
      }
      if (!hasValidExit) {
        noExits.push(label);
      }
    });

    const sortInsensitive = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    missingRegion.sort(sortInsensitive);
    noExits.sort(sortInsensitive);
    both.sort(sortInsensitive);
    warnings.sort(sortInsensitive);

    const lines = [
      'Orphaned Locations Report',
      '',
      `Missing/Invalid Region Links (${missingRegion.length}):`
    ];
    if (missingRegion.length) {
      missingRegion.forEach(entry => lines.push(`- ${entry}`));
    } else {
      lines.push('- (none)');
    }

    lines.push('');
    lines.push(`No Valid Exits (${noExits.length}):`);
    if (noExits.length) {
      noExits.forEach(entry => lines.push(`- ${entry}`));
    } else {
      lines.push('- (none)');
    }

    lines.push('');
    lines.push(`Both Missing Region + Exits (${both.length}):`);
    if (both.length) {
      both.forEach(entry => lines.push(`- ${entry}`));
    } else {
      lines.push('- (none)');
    }

    if (warnings.length) {
      lines.push('');
      lines.push('Warnings:');
      warnings.forEach(message => lines.push(`- ${message}`));
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = OrphanedLocationsCommand;
