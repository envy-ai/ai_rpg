const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

class Command extends SlashCommandBase {
  static get name() {
    return 'awardxp';
  }

  static get description() {
    return 'Award experience points to yourself or another character.';
  }

  static get args() {
    return [
      { name: 'amount', type: 'integer', required: true },
      { name: 'character', type: 'string', required: false }
    ]
  }

  static execute(interaction, args) {
    const amount = args['amount'];
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      interaction.reply({ content: 'The amount of experience points must be a positive integer.', ephemeral: true });
      return;
    }

    let targetPlayer = null;
    const characterName = args['character'];
    if (characterName) {
      // Find the specified character
      const playersByName = Globals.playersByName;
      targetPlayer = playersByName.get(characterName);
      if (!targetPlayer) {
        interaction.reply({ content: `Character "${characterName}" not found.`, ephemeral: true });
        return;
      }
    } else {
      // No character specified, use the invoking player
      const invokingPlayerId = interaction.user.id;
      const playersById = Globals.playersById;
      targetPlayer = playersById.get(invokingPlayerId);
      if (!targetPlayer) {
        interaction.reply({ content: 'You do not have a character in the game. Specify a character name to award XP.', ephemeral: true });
        return;
      }
    }

    // Award the XP
    targetPlayer.addRawExperience(amount);
    interaction.reply({ content: `Awarded ${amount} XP to ${targetPlayer.name}.`, ephemeral: false });
  }
}

module.exports = Command;