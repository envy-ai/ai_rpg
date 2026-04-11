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
    return 'Restore a character to full health and clear the dead flag.';
  }

  static get args() {
    return [
      { name: 'character', type: 'string', required: false }
    ];
  }

  static execute(interaction, args = {}) {
    const characterName = getSingleCharacterArgValue({ interaction, args, argName: 'character' });
    let targetCharacter = null;

    if (characterName) {
      const currentLocationId = getInteractionCurrentLocationId(interaction, Globals.playersById);
      const { target, ambiguousMatches } = resolveCharacterTarget({
        rawName: characterName,
        playersByName: Globals.playersByName,
        playersById: Globals.playersById,
        currentLocationId,
        allowNPCs: true,
        allowPlayers: true
      });

      if (!target && ambiguousMatches.length > 1) {
        return interaction.reply({
          content: `Warning: "${characterName}" is ambiguous. Matches: ${formatAmbiguousCharacterMatches(ambiguousMatches)}. No character was healed.`,
          ephemeral: true
        });
      }

      if (!target) {
        throw new Error(`Unable to heal character "${characterName}".`);
      }

      targetCharacter = target;
    } else {
      const invokingPlayerId = typeof interaction?.user?.id === 'string'
        ? interaction.user.id.trim()
        : '';
      if (!invokingPlayerId) {
        throw new Error('No character was provided and the invoking player could not be determined.');
      }

      targetCharacter = Globals.playersById.get(invokingPlayerId) || null;
      if (!targetCharacter) {
        throw new Error('No character was provided and the invoking player was not found.');
      }
    }

    targetCharacter.isDead = false;
    targetCharacter.setHealth(targetCharacter.maxHealth);

    return interaction.reply({ content: `${targetCharacter.name} has been fully restored.`, ephemeral: false });
  }
}

module.exports = HealCommand;
