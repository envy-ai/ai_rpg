const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Player = require('../Player.js');
const SlashCommandBase = require('../SlashCommandBase.js');

const toTrimmedString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeId = (value) => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value && typeof value === 'object') {
    return toTrimmedString(value.id);
  }
  return '';
};

const normalizeSummaryText = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).replace(/\s+/g, ' ').trim();
};

const firstSentence = (value) => {
  const text = normalizeSummaryText(value);
  if (!text) {
    return '';
  }
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : text).trim();
};

const escapeMarkdownCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
};

const isNpcCharacter = (actor) => {
  if (!actor || typeof actor !== 'object') {
    return false;
  }
  if (typeof actor.isNPC === 'function') {
    return actor.isNPC() === true;
  }
  return actor.isNPC === true;
};

const collectPartyMemberIds = (player) => {
  if (!player || typeof player.getPartyMembers !== 'function') {
    return new Set();
  }
  const members = player.getPartyMembers();
  if (!Array.isArray(members)) {
    return new Set();
  }
  return new Set(members.map(member => normalizeId(member)).filter(Boolean));
};

const getActorLocationId = (actor) => {
  if (!actor || typeof actor !== 'object') {
    return '';
  }
  return normalizeId(actor.currentLocation)
    || normalizeId(actor.locationId)
    || normalizeId(actor.location);
};

class ListNpcsCommand extends SlashCommandBase {
  static get name() {
    return 'list_npcs';
  }

  static get description() {
    return 'List NPCs with location and short description.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const allPlayers = Player.getAll();
    if (!Array.isArray(allPlayers)) {
      throw new Error('Player list is unavailable.');
    }
    const allLocations = Location.getAll();
    if (!Array.isArray(allLocations)) {
      throw new Error('Location list is unavailable.');
    }

    const locationById = new Map();
    for (const location of allLocations) {
      const locationId = normalizeId(location);
      if (locationId) {
        locationById.set(locationId, location);
      }
    }

    const currentPlayer = Globals.currentPlayer || null;
    const currentPlayerLocationId = getActorLocationId(currentPlayer);
    const partyMemberIds = collectPartyMemberIds(currentPlayer);
    const resolveEffectiveLocationId = (actor) => {
      const actorId = normalizeId(actor);
      if (actorId && partyMemberIds.has(actorId) && currentPlayerLocationId) {
        return currentPlayerLocationId;
      }
      return getActorLocationId(actor);
    };
    const resolveLocationLabel = (actor) => {
      const locationId = resolveEffectiveLocationId(actor);
      if (!locationId) {
        return 'Unknown';
      }
      const location = locationById.get(locationId) || null;
      return toTrimmedString(location?.name) || locationId;
    };
    const getShortDescription = (actor) => {
      return firstSentence(actor?.shortDescription || actor?.description || '');
    };

    const rows = allPlayers
      .filter(isNpcCharacter)
      .map(npc => ({
        name: toTrimmedString(npc.name) || normalizeId(npc),
        location: resolveLocationLabel(npc),
        shortDescription: getShortDescription(npc)
      }))
      .filter(row => row.name)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const lines = [
      '| NPC | Location | Short Description |',
      '| --- | --- | --- |'
    ];
    for (const row of rows) {
      lines.push(`| ${escapeMarkdownCell(row.name)} | ${escapeMarkdownCell(row.location)} | ${escapeMarkdownCell(row.shortDescription)} |`);
    }

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = ListNpcsCommand;
