const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const {
  formatAmbiguousCharacterMatches,
  getInteractionCurrentLocationId,
  getSingleCharacterArgValue,
  resolveCharacterTarget
} = require('../slashcommand_utils/characterTargeting.js');

class RespecSkillsCommand extends SlashCommandBase {
  static get name() {
    return 'respec_skills';
  }

  static get description() {
    return 'Respec an NPC\'s skills for its current level.';
  }

  static get args() {
    return [
      { name: 'character', type: 'string', required: true }
    ];
  }

  static async execute(interaction, args = {}) {
    const characterName = getSingleCharacterArgValue({ interaction, args, argName: 'character' });
    if (!characterName) {
      await interaction.reply({
        content: 'Provide an NPC name to respec.',
        ephemeral: true
      });
      return;
    }

    const currentLocationId = getInteractionCurrentLocationId(interaction, Globals.playersById);
    const {
      target: targetCharacter,
      ambiguousMatches,
      exactDisallowedMatch
    } = resolveCharacterTarget({
      playersByName: Globals.playersByName,
      playersById: Globals.playersById,
      rawName: characterName,
      currentLocationId,
      allowNPCs: true,
      allowPlayers: false
    });

    if (!targetCharacter && ambiguousMatches.length > 1) {
      await interaction.reply({
        content: `Warning: "${characterName}" is ambiguous. Matches: ${formatAmbiguousCharacterMatches(ambiguousMatches)}. No skills were respecced.`,
        ephemeral: true
      });
      return;
    }

    if (!targetCharacter) {
      if (exactDisallowedMatch) {
        await interaction.reply({
          content: `${exactDisallowedMatch.name} is not an NPC. Use a named NPC for /respec_skills.`,
          ephemeral: true
        });
        return;
      }
      await interaction.reply({
        content: `Character "${characterName}" not found.`,
        ephemeral: true
      });
      return;
    }

    if (typeof Globals.respecNpcSkillsForCharacter !== 'function') {
      throw new Error('Globals.respecNpcSkillsForCharacter is not available.');
    }

    let result;
    try {
      result = await Globals.respecNpcSkillsForCharacter(targetCharacter);
    } catch (error) {
      await interaction.reply({
        content: `Failed to respec skills for ${targetCharacter.name}: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    const highlightedSkills = result?.resultingSkills instanceof Map
      ? Array.from(result.resultingSkills.entries())
          .filter(([, value]) => Number(value) > 1)
          .sort((a, b) => {
            const diff = Number(b[1]) - Number(a[1]);
            return diff || a[0].localeCompare(b[0]);
          })
          .slice(0, 8)
          .map(([name, value]) => `${name} ${value}`)
      : [];

    const details = highlightedSkills.length
      ? ` Top skills: ${highlightedSkills.join(', ')}.`
      : ' No non-baseline skill points were available to assign.';

    await interaction.reply({
      content: `Respecced skills for ${targetCharacter.name} at level ${targetCharacter.level}. Spent ${result.spent} skill points.${details}`,
      ephemeral: false
    });
  }
}

module.exports = RespecSkillsCommand;
