const SlashCommandBase = require('../SlashCommandBase.js');
const Region = require('../Region.js');
const Location = require('../Location.js');
const Thing = require('../Thing.js');
const Player = require('../Player.js');

const isMissingShortDescription = (value) => !value || !String(value).trim();

const resolveLabel = (entity, fallbackPrefix) => {
  if (entity && typeof entity.name === 'string' && entity.name.trim()) {
    return entity.name.trim();
  }
  if (entity && typeof entity.id === 'string' && entity.id.trim()) {
    return `${fallbackPrefix} ${entity.id.trim()}`;
  }
  return `${fallbackPrefix} <missing id>`;
};

class ShortDescriptionCheckCommand extends SlashCommandBase {
  static get name() {
    return 'short_description_check';
  }

  static get description() {
    return 'List regions, locations, things, and abilities missing short descriptions.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const regions = Region.getAll();
    if (!Array.isArray(regions)) {
      throw new Error('Region list is unavailable.');
    }
    const locations = Location.getAll();
    if (!Array.isArray(locations)) {
      throw new Error('Location list is unavailable.');
    }
    const things = Thing.getAll();
    if (!Array.isArray(things)) {
      throw new Error('Thing list is unavailable.');
    }
    const players = Player.getAll();
    if (!Array.isArray(players)) {
      throw new Error('Player list is unavailable.');
    }

    const missingRegionLabels = [];
    const missingLocationLabels = [];
    const missingThingLabels = [];
    const missingAbilityLabels = [];
    const warnings = [];

    for (const region of regions) {
      if (!region) {
        warnings.push('Encountered null region entry.');
        continue;
      }
      if (isMissingShortDescription(region.shortDescription)) {
        const label = resolveLabel(region, 'Region');
        const stubSuffix = region.isStub ? ' (stub)' : '';
        missingRegionLabels.push(`${label}${stubSuffix}`);
      }
    }

    for (const location of locations) {
      if (!location) {
        warnings.push('Encountered null location entry.');
        continue;
      }
      const stubShortDescription = location.stubMetadata?.shortDescription;
      if (isMissingShortDescription(location.shortDescription) && isMissingShortDescription(stubShortDescription)) {
        const label = resolveLabel(location, 'Location');
        const stubSuffix = location.isStub ? ' (stub)' : '';
        missingLocationLabels.push(`${label}${stubSuffix}`);
      }
    }

    for (const thing of things) {
      if (!thing) {
        warnings.push('Encountered null thing entry.');
        continue;
      }
      if (isMissingShortDescription(thing.shortDescription)) {
        const label = resolveLabel(thing, 'Thing');
        missingThingLabels.push(label);
      }
    }

    for (const player of players) {
      if (!player || typeof player.getAbilities !== 'function') {
        continue;
      }
      const abilityList = player.getAbilities();
      if (!Array.isArray(abilityList)) {
        warnings.push(`Abilities list missing for ${resolveLabel(player, 'Player')}.`);
        continue;
      }
      for (const ability of abilityList) {
        if (!ability) {
          warnings.push(`Null ability entry on ${resolveLabel(player, 'Player')}.`);
          continue;
        }
        if (isMissingShortDescription(ability.shortDescription)) {
          const abilityName = typeof ability.name === 'string' && ability.name.trim()
            ? ability.name.trim()
            : null;
          const ownerName = resolveLabel(player, 'Player');
          if (!abilityName) {
            warnings.push(`Ability missing name on ${ownerName}.`);
            missingAbilityLabels.push(`${ownerName} -> <missing ability name>`);
          } else {
            missingAbilityLabels.push(`${ownerName} -> ${abilityName}`);
          }
        }
      }
    }

    const sortInsensitive = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    missingRegionLabels.sort(sortInsensitive);
    missingLocationLabels.sort(sortInsensitive);
    missingThingLabels.sort(sortInsensitive);
    missingAbilityLabels.sort(sortInsensitive);
    warnings.sort(sortInsensitive);

    const lines = [
      'Short Description Check',
      '',
      `Regions missing shortDescription (${missingRegionLabels.length}):`
    ];
    if (missingRegionLabels.length) {
      missingRegionLabels.forEach(label => lines.push(`- ${label}`));
    } else {
      lines.push('- (none)');
    }

    lines.push('');
    lines.push(`Locations missing shortDescription (${missingLocationLabels.length}):`);
    if (missingLocationLabels.length) {
      missingLocationLabels.forEach(label => lines.push(`- ${label}`));
    } else {
      lines.push('- (none)');
    }

    lines.push('');
    lines.push(`Things missing shortDescription (${missingThingLabels.length}):`);
    if (missingThingLabels.length) {
      missingThingLabels.forEach(label => lines.push(`- ${label}`));
    } else {
      lines.push('- (none)');
    }

    lines.push('');
    lines.push(`Abilities missing shortDescription (${missingAbilityLabels.length}):`);
    if (missingAbilityLabels.length) {
      missingAbilityLabels.forEach(label => lines.push(`- ${label}`));
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

module.exports = ShortDescriptionCheckCommand;
