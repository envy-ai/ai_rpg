const SlashCommandBase = require('../SlashCommandBase.js');
const Region = require('../Region.js');
const Location = require('../Location.js');

class WorldOutlineCommand extends SlashCommandBase {
  static get name() {
    return 'world_outline';
  }

  static get description() {
    return 'Show every region and its locations in outline format.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const regions = Region.getAll();
    if (!Array.isArray(regions)) {
      throw new Error('Region list is unavailable.');
    }

    const sortedRegions = regions
      .filter(region => region && typeof region.name === 'string' && region.name.trim())
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const lines = ['World Outline:'];

    if (sortedRegions.length === 0) {
      lines.push('- (no regions)');
    } else {
      for (const region of sortedRegions) {
        const regionLabel = region.name.trim();
        lines.push(`- ${regionLabel}`);

        const locations = Array.isArray(region.locations) ? region.locations : [];
        const locationNames = locations
          .map(location => {
            if (!location) {
              return '';
            }
            if (typeof location.name === 'string' && location.name.trim()) {
              return location.name.trim();
            }
            if (typeof location.id === 'string' && location.id.trim()) {
              return location.id.trim();
            }
            return '';
          })
          .filter(Boolean);

        if (locationNames.length === 0) {
          lines.push('  (no locations)');
          continue;
        }

        for (const locationName of locationNames) {
          lines.push(`  - ${locationName}`);
        }
      }
    }

    let pendingRegionStubs;
    try {
      const serverExports = require('../server');
      pendingRegionStubs = serverExports?.pendingRegionStubs;
    } catch (error) {
      throw new Error(`Failed to load pending region stubs: ${error.message}`);
    }

    if (!(pendingRegionStubs instanceof Map)) {
      throw new Error('Pending region stubs are unavailable.');
    }

    lines.push('');
    lines.push('Pending Region Stubs:');

    if (pendingRegionStubs.size === 0) {
      lines.push('- (none)');
    } else {
      const stubs = Array.from(pendingRegionStubs.values())
        .filter(stub => stub && typeof stub === 'object')
        .sort((a, b) => {
          const left = (a.name || a.originalName || a.targetRegionName || a.id || '').toString();
          const right = (b.name || b.originalName || b.targetRegionName || b.id || '').toString();
          return left.localeCompare(right, undefined, { sensitivity: 'base' });
        });

      for (const stub of stubs) {
        const stubLabel = typeof stub.name === 'string' && stub.name.trim()
          ? stub.name.trim()
          : (typeof stub.originalName === 'string' && stub.originalName.trim()
            ? stub.originalName.trim()
            : (typeof stub.targetRegionName === 'string' && stub.targetRegionName.trim()
              ? stub.targetRegionName.trim()
              : (typeof stub.id === 'string' ? stub.id.trim() : '')));

        if (!stubLabel) {
          throw new Error('Pending region stub is missing a name and id.');
        }

        const stubId = typeof stub.id === 'string' && stub.id.trim() ? stub.id.trim() : null;
        const idSuffix = stubId && stubId !== stubLabel ? ` (${stubId})` : '';
        lines.push(`- ${stubLabel}${idSuffix}`);

        if (typeof stub.entranceStubId === 'string' && stub.entranceStubId.trim()) {
          const entranceLocation = Location.get(stub.entranceStubId.trim());
          const entranceLabel = entranceLocation?.name
            || entranceLocation?.id
            || stub.entranceStubId.trim();
          lines.push(`  - entrance: ${entranceLabel}`);
        }
      }
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = WorldOutlineCommand;
