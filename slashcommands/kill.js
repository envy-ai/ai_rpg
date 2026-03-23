const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const {
  formatAmbiguousCharacterMatches,
  getInteractionCurrentLocationId,
  getSingleCharacterArgValue,
  resolveCharacterTarget
} = require('../slashcommand_utils/characterTargeting.js');

class KillCommand extends SlashCommandBase {
  static get name() {
    return 'kill';
  }

  static get description() {
    return 'Immediately kill an NPC by name.';
  }

  static get args() {
    return [
      { name: 'character', type: 'string', required: true }
    ];
  }

  static execute(interaction, args = {}) {
    const characterName = getSingleCharacterArgValue({ interaction, args, argName: 'character' });
    if (!characterName) {
      throw new Error('Argument "character" must be a non-empty string.');
    }

    const currentLocationId = getInteractionCurrentLocationId(interaction, Globals.playersById);
    const { target: npc, ambiguousMatches, exactDisallowedMatch } = resolveCharacterTarget({
      rawName: characterName,
      playersByName: Globals.playersByName,
      playersById: Globals.playersById,
      currentLocationId,
      allowNPCs: true,
      allowPlayers: false
    });

    if (!npc && ambiguousMatches.length > 1) {
      return interaction.reply({
        content: `Warning: "${characterName}" is ambiguous. Matches: ${formatAmbiguousCharacterMatches(ambiguousMatches)}. No NPC was killed.`,
        ephemeral: true
      });
    }

    if (exactDisallowedMatch) {
      throw new Error(`"${characterName}" resolves to ${exactDisallowedMatch.name}, which is not an NPC.`);
    }

    if (!npc) {
      throw new Error(`Unable to kill NPC "${characterName}".`);
    }

    npc.isDead = true;
    npc.setHealth(0);

    return interaction.reply({ content: `${npc.name} has been killed.`, ephemeral: false });
  }
}

module.exports = KillCommand;
