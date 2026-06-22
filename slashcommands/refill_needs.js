const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const {
  formatAmbiguousCharacterMatches,
  getInteractionCurrentLocationId,
  getSingleCharacterArgValue,
  resolveCharacterTarget
} = require('../slashcommand_utils/characterTargeting.js');

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

function getAllNpcTargets() {
  if (!(Globals.playersById instanceof Map)) {
    throw new Error('Cannot refill NPC needs: player registry is unavailable.');
  }

  const npcs = [];
  const seenIds = new Set();
  for (const candidate of Globals.playersById.values()) {
    if (!candidate || candidate.isNPC !== true || typeof candidate.id !== 'string' || seenIds.has(candidate.id)) {
      continue;
    }
    seenIds.add(candidate.id);
    npcs.push(candidate);
  }

  if (npcs.length === 0) {
    throw new Error('No NPCs are available to refill.');
  }

  return npcs;
}

function resolveNpcTarget(interaction, rawTarget) {
  const currentLocationId = getInteractionCurrentLocationId(interaction, Globals.playersById);
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
    throw new Error(`NPC "${rawTarget}" not found.`);
  }

  if (target.isNPC !== true) {
    throw new Error(`Character "${rawTarget}" is not an NPC.`);
  }

  return target;
}

function refillNpcStoredNeedBars(npc) {
  if (!npc || typeof npc.getNeedBars !== 'function' || typeof npc.setNeedBarValue !== 'function') {
    throw new Error('Need refill target is missing need-bar helpers.');
  }

  const storedBars = npc.getNeedBars({ scope: 'stored' });
  if (!Array.isArray(storedBars) || storedBars.length === 0) {
    throw new Error(`${npc.name || npc.id || 'NPC'} has no stored need bars to refill.`);
  }

  let refillCount = 0;
  for (const bar of storedBars) {
    const barId = typeof bar?.id === 'string' ? bar.id.trim() : '';
    if (!barId) {
      throw new Error(`${npc.name || npc.id || 'NPC'} has a stored need bar without an id.`);
    }

    const maxValue = Number(bar.max);
    if (!Number.isFinite(maxValue)) {
      throw new Error(`Need bar "${barId}" for ${npc.name || npc.id || 'NPC'} does not have a finite max value.`);
    }

    npc.setNeedBarValue(barId, maxValue, {
      allowInactive: true,
      allowPlayerOnly: false
    });
    refillCount += 1;
  }

  return refillCount;
}

class RefillNeedsCommand extends SlashCommandBase {
  static get name() {
    return 'refill_needs';
  }

  static get description() {
    return 'Refill stored need bars for one NPC or every NPC.';
  }

  static get args() {
    return [
      { name: 'target', type: 'string', required: true }
    ];
  }

  static get usage() {
    return '/refill_needs <npc name|alias|all>';
  }

  static async execute(interaction, args = {}) {
    if (Globals.gameLoaded !== true) {
      throw new Error('Cannot use /refill_needs when no game is loaded.');
    }

    const targetText = getSingleCharacterArgValue({ interaction, args, argName: 'target' });
    if (!targetText) {
      throw new Error('Usage: /refill_needs <npc name|alias|all>');
    }

    const targets = targetText.toLowerCase() === 'all'
      ? getAllNpcTargets()
      : [resolveNpcTarget(interaction, targetText)];

    let totalRefilled = 0;
    for (const npc of targets) {
      totalRefilled += refillNpcStoredNeedBars(npc);
    }

    const content = targets.length === 1
      ? `Refilled ${totalRefilled} stored need bars for ${targets[0].name || targets[0].id || 'NPC'}.`
      : `Refilled ${totalRefilled} stored need bars for ${targets.length} NPCs: ${formatNameList(targets.map(npc => npc.name || npc.id || 'NPC'))}.`;

    await interaction.reply({
      content,
      ephemeral: false
    });

    if (typeof interaction.requestClientRefresh === 'function') {
      interaction.requestClientRefresh({ locationRefreshRequested: true });
    }
  }
}

module.exports = RefillNeedsCommand;
