const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const {
  formatAmbiguousCharacterMatches,
  getInteractionCurrentLocationId,
  getTrailingCharacterArgValue,
  resolveCharacterTarget
} = require('../slashcommand_utils/characterTargeting.js');

class SetLevelCommand extends SlashCommandBase {
  static get name() {
    return 'setlevel';
  }

  static get description() {
    return 'Set a character level directly.';
  }

  static get args() {
    return [
      { name: 'level', type: 'integer', required: true },
      { name: 'character', type: 'string', required: false }
    ];
  }

  static execute(interaction, args = {}) {
    const level = args.level;
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 20) {
      return interaction.reply({
        content: 'The level must be an integer between 1 and 20.',
        ephemeral: true
      });
    }

    let targetPlayer = null;
    const characterName = getTrailingCharacterArgValue({
      interaction,
      args,
      argName: 'character',
      leadingArgCount: 1
    });
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
      targetPlayer = target;
      if (!targetPlayer && ambiguousMatches.length > 1) {
        return interaction.reply({
          content: `Character "${characterName}" is ambiguous. Matches: ${formatAmbiguousCharacterMatches(ambiguousMatches)}.`,
          ephemeral: true
        });
      }
      if (!targetPlayer) {
        return interaction.reply({
          content: `Character "${characterName}" not found.`,
          ephemeral: true
        });
      }
    } else {
      const invokingPlayerId = interaction?.user?.id;
      targetPlayer = Globals.playersById.get(invokingPlayerId);
      if (!targetPlayer) {
        return interaction.reply({
          content: 'You do not have a character in the game. Specify a character name to set a level.',
          ephemeral: true
        });
      }
    }

    const currentLevel = Number(targetPlayer.level);
    if (!Number.isInteger(currentLevel) || currentLevel < 1) {
      throw new Error(`Target character "${targetPlayer.name || characterName || 'unknown'}" has an invalid current level.`);
    }

    if (currentLevel === level) {
      return interaction.reply({
        content: `${targetPlayer.name} is already level ${level}. XP was left unchanged.`,
        ephemeral: false
      });
    }

    if (level > currentLevel) {
      targetPlayer.levelUp(level - currentLevel);
    } else {
      targetPlayer.setLevel(level);
    }

    return interaction.reply({
      content: `Set ${targetPlayer.name} from level ${currentLevel} to level ${level}. XP was left unchanged.`,
      ephemeral: false
    });
  }
}

module.exports = SetLevelCommand;
