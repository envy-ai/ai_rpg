const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const {
  containsNamedArgSyntax,
  sanitizeLookupKey
} = require('../slashcommand_utils/characterTargeting.js');

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
    return 'Locate NPCs by exact name or alias.';
  }

  static get args() {
    return [
      { name: 'query', type: 'string', required: false }
    ];
  }

  static async execute(interaction, args = {}) {
    const rawArgsText = typeof interaction?.argsText === 'string' ? interaction.argsText.trim() : '';
    const fallbackArgQuery = typeof args.query === 'string' ? args.query : '';
    const rawQuery = rawArgsText && !containsNamedArgSyntax(rawArgsText)
      ? rawArgsText
      : fallbackArgQuery;
    const query = stripQuotes(rawQuery);
    if (!query) {
      throw new Error('Query is required. Usage: /locate <npc name or alias>');
    }

    const queryKey = sanitizeLookupKey(query);
    if (!queryKey) {
      throw new Error('Query must contain at least one searchable character.');
    }

    const allPlayers = Player.getAll();
    if (!Array.isArray(allPlayers)) {
      throw new Error('Player list is unavailable.');
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

      const fullNameKey = sanitizeLookupKey(fullName);
      const aliases = toAliasList(npc);
      const matchedAlias = aliases.find(alias => sanitizeLookupKey(alias) === queryKey) || null;
      const matchedName = fullNameKey === queryKey;
      if (!matchedName && !matchedAlias) {
        continue;
      }

      const effectiveLocationId = resolveEffectiveCharacterLocationId(npc);
      rows.push({
        fullName,
        location: resolveLocationLabel(effectiveLocationId),
        region: resolveRegionLabel(effectiveLocationId),
        matched: matchedName ? `name: ${fullName}` : `alias: ${matchedAlias}`
      });
    }

    rows.sort((a, b) => {
      return a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' });
    });

    if (!rows.length) {
      await interaction.reply({
        content: `No NPCs found for name or alias "${query}".`,
        ephemeral: false
      });
      return;
    }

    const lines = [
      `Locate results for "${query}":`,
      '',
      '| NPC | Location | Region | Matched |',
      '| --- | --- | --- | --- |'
    ];
    for (const row of rows) {
      lines.push(
        `| ${escapeMarkdownCell(row.fullName)} | ${escapeMarkdownCell(row.location)} | ${escapeMarkdownCell(row.region)} | ${escapeMarkdownCell(row.matched)} |`
      );
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = LocateCommand;
