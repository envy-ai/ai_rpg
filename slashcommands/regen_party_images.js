const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

function getDisplayName(characterOrId) {
  if (characterOrId && typeof characterOrId === 'object') {
    const name = typeof characterOrId.name === 'string' ? characterOrId.name.trim() : '';
    return name || characterOrId.id || 'unknown character';
  }
  return String(characterOrId || 'unknown character');
}

function resolveCurrentPlayer(interaction) {
  if (interaction?.currentPlayer && typeof interaction.currentPlayer === 'object') {
    return interaction.currentPlayer;
  }

  const userId = typeof interaction?.user?.id === 'string' && interaction.user.id.trim()
    ? interaction.user.id.trim()
    : '';
  if (!userId) {
    return null;
  }

  return Globals.playersById instanceof Map
    ? Globals.playersById.get(userId) || null
    : null;
}

function getPartyMemberIds(player) {
  if (!player || typeof player !== 'object') {
    return [];
  }
  if (typeof player.getPartyMembers === 'function') {
    const memberIds = player.getPartyMembers();
    return Array.isArray(memberIds) ? memberIds : [];
  }
  const partyMembers = player.partyMembers;
  if (partyMembers instanceof Set) {
    return Array.from(partyMembers);
  }
  return Array.isArray(partyMembers) ? partyMembers : [];
}

function summarizeList(label, values) {
  if (!Array.isArray(values) || !values.length) {
    return null;
  }
  return `${label} (${values.length}): ${values.join(', ')}`;
}

class RegenPartyImagesCommand extends SlashCommandBase {
  static get name() {
    return 'regen_party_images';
  }

  static get description() {
    return 'Regenerate portraits for every current party NPC.';
  }

  static get args() {
    return [];
  }

  static async execute(interaction) {
    const currentPlayer = resolveCurrentPlayer(interaction);
    if (!currentPlayer) {
      throw new Error('Current player is unavailable for party portrait regeneration.');
    }

    const rawMemberIds = getPartyMemberIds(currentPlayer);
    const skippedBeforeGeneration = [];
    const partyMembers = [];
    const seenIds = new Set();

    for (const rawId of rawMemberIds) {
      const memberId = typeof rawId === 'string' ? rawId.trim() : '';
      if (!memberId || seenIds.has(memberId)) {
        continue;
      }
      seenIds.add(memberId);

      const member = Globals.playersById instanceof Map
        ? Globals.playersById.get(memberId) || null
        : null;
      if (!member) {
        skippedBeforeGeneration.push(`${memberId} (not found)`);
        continue;
      }
      if (!member.isNPC) {
        skippedBeforeGeneration.push(`${getDisplayName(member)} (not an NPC)`);
        continue;
      }
      partyMembers.push(member);
    }

    if (!partyMembers.length) {
      const content = skippedBeforeGeneration.length
        ? [
            'No NPC party members are available for portrait regeneration.',
            summarizeList('Skipped party entries', skippedBeforeGeneration)
          ].filter(Boolean).join('\n')
        : 'No NPC party members are available for portrait regeneration.';
      await interaction.reply({ content, ephemeral: false });
      return;
    }

    if (typeof interaction?.generatePlayerImage !== 'function') {
      throw new Error('Portrait image generation helper is unavailable in slash-command context.');
    }

    const clientId = typeof interaction.clientId === 'string' && interaction.clientId.trim()
      ? interaction.clientId.trim()
      : null;

    const results = await Promise.all(partyMembers.map(async member => {
      try {
        const imageResult = await interaction.generatePlayerImage(member, { force: true, clientId });
        return { member, imageResult };
      } catch (error) {
        return { member, error };
      }
    }));

    const queued = [];
    const existing = [];
    const skipped = [...skippedBeforeGeneration];
    const failed = [];

    for (const { member, imageResult, error } of results) {
      const name = getDisplayName(member);
      if (error) {
        failed.push(`${name} (${error.message || error})`);
        continue;
      }
      if (imageResult?.existingJob) {
        existing.push(name);
        continue;
      }
      if (imageResult?.skipped) {
        skipped.push(`${name}${imageResult.reason ? ` (${imageResult.reason})` : ''}`);
        continue;
      }
      if (imageResult?.success) {
        queued.push(name);
        continue;
      }
      failed.push(`${name} (${imageResult?.message || 'portrait generation did not queue'})`);
    }

    const lines = [
      '## Party Portrait Regeneration',
      summarizeList('Queued portraits', queued),
      summarizeList('Joined existing portrait jobs', existing),
      summarizeList('Skipped party entries', skipped),
      summarizeList('Failed portraits', failed)
    ].filter(Boolean);

    await interaction.reply({
      content: lines.join('\n'),
      ephemeral: false
    });
  }
}

module.exports = RegenPartyImagesCommand;
