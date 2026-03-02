const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const Thing = require('../Thing.js');

const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const stripQuotes = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const first = trimmed.charAt(0);
  const last = trimmed.charAt(trimmed.length - 1);
  if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const escapeMarkdownCell = (value) => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
};

const collectPartyMemberIds = (player) => {
  if (!player || typeof player.getPartyMembers !== 'function') {
    return new Set();
  }
  const members = player.getPartyMembers();
  if (!Array.isArray(members)) {
    return new Set();
  }
  return new Set(
    members
      .map(memberId => toTrimmedString(memberId))
      .filter(Boolean)
  );
};

const toAliasList = (npc) => {
  if (!npc) {
    return [];
  }
  if (typeof npc.getAliases === 'function') {
    const aliases = npc.getAliases();
    if (Array.isArray(aliases)) {
      return aliases.map(alias => toTrimmedString(alias)).filter(Boolean);
    }
  }
  if (npc.aliases instanceof Set) {
    return Array.from(npc.aliases).map(alias => toTrimmedString(alias)).filter(Boolean);
  }
  if (Array.isArray(npc.aliases)) {
    return npc.aliases.map(alias => toTrimmedString(alias)).filter(Boolean);
  }
  return [];
};

class LocateCommand extends SlashCommandBase {
  static get name() {
    return 'locate';
  }

  static get description() {
    return 'Locate NPCs (name/alias) and things by substring.';
  }

  static get args() {
    return [
      { name: 'query', type: 'string', required: false }
    ];
  }

  static async execute(interaction, args = {}) {
    const rawArgsText = typeof interaction?.argsText === 'string' ? interaction.argsText.trim() : '';
    const fallbackArgQuery = typeof args.query === 'string' ? args.query : '';
    const rawQuery = rawArgsText || fallbackArgQuery;
    const query = stripQuotes(rawQuery);
    if (!query) {
      throw new Error('Query is required. Usage: /locate <substring>');
    }

    const queryLower = query.toLowerCase();
    const allPlayers = Player.getAll();
    if (!Array.isArray(allPlayers)) {
      throw new Error('Player list is unavailable.');
    }
    const allThings = Thing.getAll();
    if (!Array.isArray(allThings)) {
      throw new Error('Thing list is unavailable.');
    }
    const allLocations = Location.getAll();
    if (!Array.isArray(allLocations)) {
      throw new Error('Location list is unavailable.');
    }
    const allRegions = Region.getAll();
    if (!Array.isArray(allRegions)) {
      throw new Error('Region list is unavailable.');
    }

    const locationById = new Map();
    for (const location of allLocations) {
      const locationId = toTrimmedString(location?.id);
      if (locationId) {
        locationById.set(locationId, location);
      }
    }

    const regionById = new Map();
    const regionByLocationId = new Map();
    for (const region of allRegions) {
      const regionId = toTrimmedString(region?.id);
      if (!regionId) {
        continue;
      }
      regionById.set(regionId, region);
      if (Array.isArray(region.locationIds)) {
        for (const locationIdRaw of region.locationIds) {
          const locationId = toTrimmedString(locationIdRaw);
          if (locationId && !regionByLocationId.has(locationId)) {
            regionByLocationId.set(locationId, region);
          }
        }
      }
    }

    const currentPlayer = Globals.currentPlayer || null;
    const currentPlayerLocationId = toTrimmedString(currentPlayer?.currentLocation || currentPlayer?.locationId) || null;
    const partyMemberIds = collectPartyMemberIds(currentPlayer);

    const resolveEffectiveCharacterLocationId = (character) => {
      const characterId = toTrimmedString(character?.id);
      if (characterId && partyMemberIds.has(characterId) && currentPlayerLocationId) {
        return currentPlayerLocationId;
      }
      return toTrimmedString(character?.currentLocation || character?.locationId) || null;
    };

    const resolveRegionForLocationId = (locationId) => {
      const normalizedLocationId = toTrimmedString(locationId);
      if (!normalizedLocationId) {
        return null;
      }
      const location = locationById.get(normalizedLocationId) || null;
      const locationRegionId = toTrimmedString(location?.regionId || location?.stubMetadata?.regionId || location?.stubMetadata?.targetRegionId);
      if (locationRegionId && regionById.has(locationRegionId)) {
        return regionById.get(locationRegionId);
      }
      if (regionByLocationId.has(normalizedLocationId)) {
        return regionByLocationId.get(normalizedLocationId);
      }
      return null;
    };

    const resolveLocationLabel = (locationId) => {
      const normalizedLocationId = toTrimmedString(locationId);
      if (!normalizedLocationId) {
        return 'Unknown';
      }
      const location = locationById.get(normalizedLocationId) || null;
      const locationName = toTrimmedString(location?.name);
      return locationName || normalizedLocationId;
    };

    const resolveRegionLabel = (locationId) => {
      const region = resolveRegionForLocationId(locationId);
      if (!region) {
        return 'Unknown';
      }
      return toTrimmedString(region.name) || toTrimmedString(region.id) || 'Unknown';
    };

    const rows = [];

    for (const npc of allPlayers) {
      if (!npc || npc.isNPC !== true) {
        continue;
      }
      const fullName = toTrimmedString(npc.name) || toTrimmedString(npc.id);
      if (!fullName) {
        continue;
      }

      const aliasList = toAliasList(npc).map(alias => alias.toLowerCase());
      const nameMatch = fullName.toLowerCase().includes(queryLower);
      const aliasMatch = aliasList.some(alias => alias.includes(queryLower));
      if (!nameMatch && !aliasMatch) {
        continue;
      }

      const effectiveLocationId = resolveEffectiveCharacterLocationId(npc);
      rows.push({
        fullName,
        location: resolveLocationLabel(effectiveLocationId),
        region: resolveRegionLabel(effectiveLocationId),
        type: 'npc'
      });
    }

    const findThingLocationIdFromIndex = (thingId) => {
      const normalizedThingId = toTrimmedString(thingId);
      if (!normalizedThingId) {
        return null;
      }
      for (const location of allLocations) {
        if (!location || !Array.isArray(location.thingIds)) {
          continue;
        }
        if (location.thingIds.includes(normalizedThingId)) {
          return toTrimmedString(location.id) || null;
        }
      }
      return null;
    };

    for (const thing of allThings) {
      if (!thing) {
        continue;
      }
      const thingName = toTrimmedString(thing.name) || toTrimmedString(thing.id);
      if (!thingName) {
        continue;
      }
      if (!thingName.toLowerCase().includes(queryLower)) {
        continue;
      }

      const owners = typeof thing.whoseInventory === 'function' ? thing.whoseInventory() : [];
      const owner = Array.isArray(owners) && owners.length ? owners[0] : null;

      let locationLabel = 'Unknown';
      let regionLabel = 'Unknown';
      if (owner) {
        const ownerName = toTrimmedString(owner.name) || toTrimmedString(owner.id) || 'Unknown';
        locationLabel = `${ownerName}'s inventory`;
        const ownerLocationId = resolveEffectiveCharacterLocationId(owner);
        regionLabel = resolveRegionLabel(ownerLocationId);
      } else {
        const metadata = thing.metadata && typeof thing.metadata === 'object' ? thing.metadata : {};
        const metadataLocationId = toTrimmedString(metadata.locationId || metadata.locationID) || null;
        const indexedLocationId = findThingLocationIdFromIndex(thing.id);
        const effectiveLocationId = metadataLocationId || indexedLocationId;
        locationLabel = resolveLocationLabel(effectiveLocationId);
        regionLabel = resolveRegionLabel(effectiveLocationId);
      }

      const normalizedType = toTrimmedString(thing.thingType).toLowerCase() === 'scenery'
        ? 'scenery'
        : 'item';

      rows.push({
        fullName: thingName,
        location: locationLabel,
        region: regionLabel,
        type: normalizedType
      });
    }

    rows.sort((a, b) => {
      const typeCmp = a.type.localeCompare(b.type, undefined, { sensitivity: 'base' });
      if (typeCmp !== 0) {
        return typeCmp;
      }
      return a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' });
    });

    if (!rows.length) {
      await interaction.reply({
        content: `No NPCs or things found for substring "${query}".`,
        ephemeral: false
      });
      return;
    }

    const lines = [
      `Locate results for "${query}":`,
      '',
      '| Full Name | Location | Region | Type |',
      '| --- | --- | --- | --- |'
    ];
    for (const row of rows) {
      lines.push(
        `| ${escapeMarkdownCell(row.fullName)} | ${escapeMarkdownCell(row.location)} | ${escapeMarkdownCell(row.region)} | ${escapeMarkdownCell(row.type)} |`
      );
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = LocateCommand;
