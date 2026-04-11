const Globals = require('../Globals.js');
const Location = require('../Location.js');
const Player = require('../Player.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const {
  formatAmbiguousCharacterMatches,
  getInteractionCurrentLocationId,
  resolveCharacterTarget,
  stripQuotes,
  tokenizePositionalArgs
} = require('../slashcommand_utils/characterTargeting.js');

function escapeMarkdownTableCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|');
}

function formatNameList(names = []) {
  const safeNames = Array.isArray(names)
    ? names.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim())
    : [];
  if (safeNames.length === 0) {
    return '';
  }
  if (safeNames.length === 1) {
    return safeNames[0];
  }
  if (safeNames.length === 2) {
    return `${safeNames[0]} and ${safeNames[1]}`;
  }
  return `${safeNames.slice(0, -1).join(', ')}, and ${safeNames[safeNames.length - 1]}`;
}

function getInvokingPlayer(interaction) {
  const invokingPlayerId = typeof interaction?.user?.id === 'string'
    ? interaction.user.id.trim()
    : '';
  if (!invokingPlayerId) {
    throw new Error('Cannot use /needbars without an invoking player.');
  }

  const player = Globals.playersById.get(invokingPlayerId) || null;
  if (!player) {
    throw new Error('Cannot use /needbars: invoking player was not found.');
  }

  return player;
}

function parseIntegerToken(rawValue, fieldLabel) {
  const text = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!/^[-+]?\d+$/.test(text)) {
    throw new Error(`${fieldLabel} must be an integer.`);
  }
  return Number.parseInt(text, 10);
}

function parseInvocation(argsText) {
  const tokens = tokenizePositionalArgs(argsText);
  if (tokens.length === 0) {
    throw new Error('Usage: /needbars list | /needbars <set|add|subtract> <key|all> <integer value> [character|party|location|all]');
  }

  const subcommand = String(tokens[0] || '').trim().toLowerCase();
  if (subcommand === 'list') {
    if (tokens.length !== 1) {
      throw new Error('Usage: /needbars list');
    }
    return { subcommand };
  }

  if (!['set', 'add', 'subtract'].includes(subcommand)) {
    throw new Error(`Unsupported /needbars subcommand "${tokens[0]}".`);
  }

  if (tokens.length < 3) {
    throw new Error(`Usage: /needbars ${subcommand} <key|all> <integer value> [character|party|location|all]`);
  }

  const key = stripQuotes(tokens[1]);
  if (!key) {
    throw new Error('Need bar key is required.');
  }

  const value = parseIntegerToken(tokens[2], 'Need bar value');
  const target = tokens.length > 3 ? stripQuotes(tokens.slice(3).join(' ')) : '';

  return {
    subcommand,
    key,
    value,
    target
  };
}

function normalizeNeedBarKey(rawKey) {
  const trimmed = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!trimmed) {
    throw new Error('Need bar key is required.');
  }

  if (trimmed.toLowerCase() === 'all') {
    return 'all';
  }

  const definitions = Player.needBarDefinitions || {};
  const exactMatch = Object.keys(definitions).find(id => id.toLowerCase() === trimmed.toLowerCase()) || null;
  if (!exactMatch) {
    throw new Error(`Need bar key "${trimmed}" was not found.`);
  }

  return exactMatch;
}

function resolveLocationTargets(currentLocationId) {
  if (!currentLocationId) {
    throw new Error('Cannot target location need bars: invoking player has no current location.');
  }

  const location = Location.get(currentLocationId);
  if (!location) {
    throw new Error(`Cannot target location need bars: location "${currentLocationId}" was not found.`);
  }

  const matches = [];
  const seenIds = new Set();
  for (const candidate of Globals.playersById.values()) {
    if (!candidate || typeof candidate.id !== 'string' || seenIds.has(candidate.id)) {
      continue;
    }
    const candidateLocationId = typeof candidate.currentLocation === 'string'
      ? candidate.currentLocation.trim()
      : '';
    if (candidateLocationId !== currentLocationId) {
      continue;
    }
    seenIds.add(candidate.id);
    matches.push(candidate);
  }

  if (matches.length === 0) {
    throw new Error(`No characters are currently at ${location.name || location.id}.`);
  }

  return matches;
}

function resolvePartyTargets(invokingPlayer, { allowEmpty = false } = {}) {
  const memberIds = typeof invokingPlayer?.getPartyMembers === 'function'
    ? invokingPlayer.getPartyMembers()
    : [];
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    if (allowEmpty) {
      return [];
    }
    throw new Error(`${invokingPlayer.name} has no party members.`);
  }

  const members = [];
  for (const memberId of memberIds) {
    const member = Globals.playersById.get(memberId) || null;
    if (!member) {
      throw new Error(`Party member "${memberId}" could not be resolved.`);
    }
    members.push(member);
  }
  return members;
}

function resolveNamedTarget(rawTarget, currentLocationId) {
  const { target, ambiguousMatches } = resolveCharacterTarget({
    rawName: rawTarget,
    playersByName: Globals.playersByName,
    playersById: Globals.playersById,
    currentLocationId,
    allowNPCs: true,
    allowPlayers: true
  });

  if (!target && ambiguousMatches.length > 1) {
    throw new Error(`"${rawTarget}" is ambiguous. Matches: ${formatAmbiguousCharacterMatches(ambiguousMatches)}.`);
  }

  if (!target) {
    throw new Error(`Character "${rawTarget}" not found.`);
  }

  return target;
}

function resolveTargets(interaction, rawTarget) {
  const invokingPlayer = getInvokingPlayer(interaction);
  const currentLocationId = getInteractionCurrentLocationId(interaction, Globals.playersById);
  const targetText = typeof rawTarget === 'string' ? rawTarget.trim() : '';

  if (!targetText) {
    return {
      label: invokingPlayer.name,
      actors: [invokingPlayer]
    };
  }

  const normalizedTarget = targetText.toLowerCase();
  if (normalizedTarget === 'party') {
    const partyMembers = resolvePartyTargets(invokingPlayer);
    return {
      label: 'party',
      actors: partyMembers
    };
  }

  if (normalizedTarget === 'location') {
    return {
      label: 'location',
      actors: resolveLocationTargets(currentLocationId)
    };
  }

  if (normalizedTarget === 'all') {
    const actors = [];
    const seenIds = new Set();
    const addActor = (actor) => {
      if (!actor || typeof actor.id !== 'string' || seenIds.has(actor.id)) {
        return;
      }
      seenIds.add(actor.id);
      actors.push(actor);
    };

    addActor(invokingPlayer);
    resolvePartyTargets(invokingPlayer, { allowEmpty: true }).forEach(addActor);
    resolveLocationTargets(currentLocationId).forEach(addActor);

    return {
      label: 'all',
      actors
    };
  }

  return {
    label: targetText,
    actors: [resolveNamedTarget(targetText, currentLocationId)]
  };
}

function getStoredNeedBarsForActor(actor) {
  if (!actor || typeof actor.getNeedBars !== 'function') {
    throw new Error('Need-bar target is missing getNeedBars().');
  }
  return actor.getNeedBars({ scope: 'stored' });
}

function resolveStoredBarForActor(actor, needBarKey) {
  const storedBars = getStoredNeedBarsForActor(actor);
  return storedBars.find(bar => typeof bar?.id === 'string' && bar.id.toLowerCase() === needBarKey.toLowerCase()) || null;
}

function buildListReply() {
  const definitions = Player.getNeedBarDefinitionsForContext();
  if (!Array.isArray(definitions) || definitions.length === 0) {
    return 'No need bars are currently defined.';
  }

  const lines = [
    '| Icon | Key | Name |',
    '| --- | --- | --- |'
  ];

  for (const definition of definitions) {
    const icon = typeof definition?.icon === 'string' && definition.icon.trim()
      ? definition.icon.trim()
      : '—';
    const key = typeof definition?.id === 'string' && definition.id.trim()
      ? definition.id.trim()
      : '—';
    const name = typeof definition?.name === 'string' && definition.name.trim()
      ? definition.name.trim()
      : key;
    lines.push(`| ${escapeMarkdownTableCell(icon)} | ${escapeMarkdownTableCell(key)} | ${escapeMarkdownTableCell(name)} |`);
  }

  return lines.join('\n');
}

function applyNeedBarMutation({ actor, operation, needBarKey, value }) {
  if (!actor || typeof actor.setNeedBarValue !== 'function') {
    throw new Error('Need-bar target is missing setNeedBarValue().');
  }

  const storedBars = getStoredNeedBarsForActor(actor);
  if (!Array.isArray(storedBars) || storedBars.length === 0) {
    return 0;
  }

  const targetBars = needBarKey === 'all'
    ? storedBars
    : storedBars.filter(bar => typeof bar?.id === 'string' && bar.id.toLowerCase() === needBarKey.toLowerCase());

  let changesApplied = 0;
  for (const bar of targetBars) {
    if (!bar || typeof bar.id !== 'string') {
      continue;
    }

    const currentValue = actor.getNeedBarValue(bar.id);
    if (!Number.isFinite(currentValue)) {
      throw new Error(`Need bar "${bar.id}" has an invalid current value for ${actor.name || actor.id}.`);
    }

    let nextValue;
    switch (operation) {
      case 'set':
        nextValue = value;
        break;
      case 'add':
        nextValue = currentValue + value;
        break;
      case 'subtract':
        nextValue = currentValue - value;
        break;
      default:
        throw new Error(`Unsupported need-bar operation "${operation}".`);
    }

    actor.setNeedBarValue(bar.id, nextValue, {
      allowInactive: true,
      allowPlayerOnly: false
    });
    changesApplied += 1;
  }

  return changesApplied;
}

class NeedBarsCommand extends SlashCommandBase {
  static get name() {
    return 'needbars';
  }

  static get description() {
    return 'List or modify character need bars by key.';
  }

  static get args() {
    return [];
  }

  static get usage() {
    return '/needbars list | /needbars <set|add|subtract> <key|all> <integer value> [character|party|location|all]';
  }

  static async execute(interaction) {
    if (Globals.gameLoaded !== true) {
      throw new Error('Cannot use /needbars when no game is loaded.');
    }

    const invocation = parseInvocation(interaction?.argsText || '');
    if (invocation.subcommand === 'list') {
      await interaction.reply({
        content: buildListReply(),
        ephemeral: false
      });
      return;
    }

    const needBarKey = normalizeNeedBarKey(invocation.key);
  const { actors } = resolveTargets(interaction, invocation.target);
    if (!Array.isArray(actors) || actors.length === 0) {
      throw new Error('No target characters resolved for /needbars.');
    }

    if (needBarKey !== 'all') {
      const missingActors = actors
        .filter(actor => !resolveStoredBarForActor(actor, needBarKey))
        .map(actor => actor?.name || actor?.id || 'Unknown');
      if (missingActors.length > 0) {
        throw new Error(`Need bar "${needBarKey}" is not stored for ${formatNameList(missingActors)}.`);
      }
    }

    let totalChangesApplied = 0;
    for (const actor of actors) {
      totalChangesApplied += applyNeedBarMutation({
        actor,
        operation: invocation.subcommand,
        needBarKey,
        value: invocation.value
      });
    }

    if (totalChangesApplied <= 0) {
      throw new Error(`No stored need bars were available to ${invocation.subcommand}.`);
    }

    const actorNames = actors.map(actor => actor?.name || actor?.id || 'Unknown');
    let message;
    if (invocation.subcommand === 'set') {
      message = needBarKey === 'all'
        ? `Set all stored need bars to ${invocation.value} for ${formatNameList(actorNames)}.`
        : `Set ${needBarKey} to ${invocation.value} for ${formatNameList(actorNames)}.`;
    } else if (invocation.subcommand === 'add') {
      message = needBarKey === 'all'
        ? `Added ${invocation.value} to all stored need bars for ${formatNameList(actorNames)}.`
        : `Added ${invocation.value} to ${needBarKey} for ${formatNameList(actorNames)}.`;
    } else {
      message = needBarKey === 'all'
        ? `Subtracted ${invocation.value} from all stored need bars for ${formatNameList(actorNames)}.`
        : `Subtracted ${invocation.value} from ${needBarKey} for ${formatNameList(actorNames)}.`;
    }

    await interaction.reply({
      content: message,
      ephemeral: false
    });

    if (typeof interaction.requestClientRefresh === 'function') {
      interaction.requestClientRefresh({ locationRefreshRequested: true });
    }
  }
}

module.exports = NeedBarsCommand;
