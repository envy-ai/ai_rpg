const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const {
  formatAmbiguousCharacterMatches,
  getInteractionCurrentLocationId,
  getSingleCharacterArgValue,
  resolveCharacterTarget
} = require('../slashcommand_utils/characterTargeting.js');

class HealCommand extends SlashCommandBase {
  static get name() {
    return 'heal';
  }

  static get aliases() {
    return ['resurrect'];
  }

  static get description() {
    return 'Restore an NPC to full health and clear the dead flag.';
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
        content: `Warning: "${characterName}" is ambiguous. Matches: ${formatAmbiguousCharacterMatches(ambiguousMatches)}. No NPC was healed.`,
        ephemeral: true
      });
    }

    if (exactDisallowedMatch) {
      throw new Error(`"${characterName}" resolves to ${exactDisallowedMatch.name}, which is not an NPC.`);
    }

    if (!npc) {
      throw new Error(`Unable to heal NPC "${characterName}".`);
    }

    npc.isDead = false;
    npc.setHealth(npc.maxHealth);

    return interaction.reply({ content: `${npc.name} has been fully restored.`, ephemeral: false });
  }
}

module.exports = HealCommand;
