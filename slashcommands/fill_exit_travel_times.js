const Globals = require('../Globals.js');
const Region = require('../Region.js');
const Location = require('../Location.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function regionHasUnpopulatedExitTravelTimes(region) {
  if (!region || typeof region !== 'object') {
    return false;
  }

  const locationIds = Array.isArray(region.locationIds)
    ? region.locationIds.map(id => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)
    : [];
  for (const locationId of locationIds) {
    const location = Location.get(locationId);
    if (!location) {
      throw new Error(`Region "${region.name || region.id}" references missing location "${locationId}".`);
    }
    if (typeof location.getAvailableDirections !== 'function' || typeof location.getExit !== 'function') {
      throw new Error(`Location "${location.id}" cannot enumerate exits for travel-time backfill.`);
    }

    for (const direction of location.getAvailableDirections()) {
      const exit = location.getExit(direction);
      if (!exit) {
        throw new Error(`Location "${location.id}" reported direction "${direction}" without an exit object.`);
      }
      if (Number(exit.travelTimeMinutes) === 0) {
        return true;
      }
    }
  }

  return false;
}

function regionHasAnyExits(region) {
  if (!region || typeof region !== 'object') {
    return false;
  }

  const locationIds = Array.isArray(region.locationIds)
    ? region.locationIds.map(id => (typeof id === 'string' ? id.trim() : '')).filter(Boolean)
    : [];
  for (const locationId of locationIds) {
    const location = Location.get(locationId);
    if (!location) {
      throw new Error(`Region "${region.name || region.id}" references missing location "${locationId}".`);
    }
    if (typeof location.getAvailableDirections !== 'function') {
      throw new Error(`Location "${location.id}" cannot enumerate exits for travel-time backfill.`);
    }
    if (location.getAvailableDirections().length > 0) {
      return true;
    }
  }

  return false;
}

class FillExitTravelTimesCommand extends SlashCommandBase {
  static get name() {
    return 'fill_exit_travel_times';
  }

  static get description() {
    return 'Generate missing exit travel times for every region that still has unpopulated exits.';
  }

  static get args() {
    return [
      { name: 'force', type: 'boolean', required: false }
    ];
  }

  static async execute(interaction, args = {}) {
    if (Globals.gameLoaded !== true) {
      throw new Error('Cannot use /fill_exit_travel_times when no game is loaded.');
    }

    const backfillRegionExitTravelTimes = typeof interaction?.backfillRegionExitTravelTimes === 'function'
      ? interaction.backfillRegionExitTravelTimes
      : null;
    if (typeof backfillRegionExitTravelTimes !== 'function') {
      throw new Error('Exit travel-time backfill helper is unavailable in this command context.');
    }

    const regions = Region.getAll();
    if (!Array.isArray(regions)) {
      throw new Error('Region list is unavailable.');
    }

    const force = args.force === true;
    const candidateRegions = regions.filter(force ? regionHasAnyExits : regionHasUnpopulatedExitTravelTimes);
    if (!candidateRegions.length) {
      await interaction.reply({
        content: force
          ? 'No regions with exits were found to regenerate.'
          : 'All regions already have populated exit travel times.',
        ephemeral: false
      });
      return;
    }

    const perRegionResults = [];
    let processedRegions = 0;
    try {
      for (const region of candidateRegions) {
        const result = await backfillRegionExitTravelTimes({ region, force });
        perRegionResults.push(result);
        processedRegions += 1;
      }
    } catch (error) {
      throw new Error(`Exit travel-time backfill failed after processing ${processedRegions} region(s): ${error?.message || error}`);
    }

    const totals = perRegionResults.reduce((accumulator, result) => {
      accumulator.promptedExitCount += Number(result?.promptedExitCount) || 0;
      accumulator.generatedExitCount += Number(result?.generatedExitCount) || 0;
      accumulator.mirroredReverseCount += Number(result?.mirroredReverseCount) || 0;
      accumulator.copiedFromReverseCount += Number(result?.copiedFromReverseCount) || 0;
      return accumulator;
    }, {
      promptedExitCount: 0,
      generatedExitCount: 0,
      mirroredReverseCount: 0,
      copiedFromReverseCount: 0
    });

    const lines = [
      force ? 'Exit travel-time regeneration complete.' : 'Exit travel-time backfill complete.',
      `Regions processed: ${perRegionResults.length}`,
      `Prompted exits: ${totals.promptedExitCount}`,
      `Generated exits: ${totals.generatedExitCount}`,
      `Mirrored reverse exits: ${totals.mirroredReverseCount}`,
      `Copied from existing reverse exits: ${totals.copiedFromReverseCount}`
    ];

    if (perRegionResults.length) {
      lines.push('');
      lines.push('Per-region results:');
      for (const result of perRegionResults) {
        lines.push(
          `- ${result.regionName || result.regionId}: prompted ${result.promptedExitCount || 0}, `
          + `generated ${result.generatedExitCount || 0}, mirrored ${result.mirroredReverseCount || 0}, `
          + `copied ${result.copiedFromReverseCount || 0}`
        );
      }
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = FillExitTravelTimesCommand;
