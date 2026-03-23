const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const {
  formatAmbiguousCharacterMatches,
  getInteractionCurrentLocationId,
  getSingleCharacterArgValue,
  resolveCharacterTarget
} = require('../slashcommand_utils/characterTargeting.js');

class IncapacitateCommand extends SlashCommandBase {
  static get name() {
    return 'incapacitate';
  }

  static get description() {
    return 'Drop an NPC to zero health without killing them.';
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
        content: `Warning: "${characterName}" is ambiguous. Matches: ${formatAmbiguousCharacterMatches(ambiguousMatches)}. No NPC was incapacitated.`,
        ephemeral: true
      });
    }

    if (exactDisallowedMatch) {
      throw new Error(`"${characterName}" resolves to ${exactDisallowedMatch.name}, which is not an NPC.`);
    }

    if (!npc) {
      throw new Error(`Unable to incapacitate NPC "${characterName}".`);
    }

    npc.isDead = false;
    npc.setHealth(0);

    return interaction.reply({ content: `${npc.name} is incapacitated.`, ephemeral: false });
  }
}

module.exports = IncapacitateCommand;
