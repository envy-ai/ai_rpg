const Globals = require('../Globals.js');
const SlashCommandBase = require('../SlashCommandBase.js');

const stripQuotes = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  let trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const firstChar = trimmed.charAt(0);
  const lastChar = trimmed.charAt(trimmed.length - 1);
  if ((firstChar === '"' && lastChar === '"') || (firstChar === '\'' && lastChar === '\'')) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const parseOptionalLevel = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^[+-]?\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }
  return null;
};

class RespecAbilitiesCommand extends SlashCommandBase {
  static get name() {
    return 'respec_abilities';
  }

  static get description() {
    return 'Remove and regenerate a character\'s abilities up to their current level.';
  }

  static get args() {
    return [
      { name: 'character', type: 'string', required: false },
      { name: 'start_level', type: 'integer', required: false }
    ];
  }

  static async execute(interaction, args = {}) {
    const playersByName = Globals.playersByName;
    const playersById = Globals.playersById;
    let rawName = typeof args.character === 'string' ? args.character : null;
    const providedStartLevel = parseOptionalLevel(args.start_level);

    if (rawName) {
      rawName = stripQuotes(rawName);
    }

    let startLevel = providedStartLevel;
    if (!Number.isInteger(startLevel)) {
      const fallbackLevel = parseOptionalLevel(rawName);
      if (Number.isInteger(fallbackLevel)) {
        startLevel = fallbackLevel;
        rawName = null;
      }
    }

    let target = null;
    if (rawName) {
      target = playersByName.get(rawName);
      if (!target) {
        await interaction.reply({
          content: `Character "${rawName}" was not found.`,
          ephemeral: true
        });
        return;
      }
    } else {
      const userId = interaction?.user?.id;
      if (userId) {
        target = playersById.get(userId);
      }
      if (!target) {
        await interaction.reply({
          content: 'You do not control a character. Provide a character name to respec abilities.',
          ephemeral: true
        });
        return;
      }
    }

    if (typeof target.getAbilities !== 'function' || typeof target.setAbilities !== 'function') {
      await interaction.reply({
        content: `${target.name || 'This character'} cannot be respecced.`,
        ephemeral: true
      });
      return;
    }

    const currentLevel = Number.isInteger(target.level) ? target.level : Number.parseInt(target.level, 10) || 1;
    let effectiveStartLevel = Number.isInteger(startLevel) ? startLevel : 1;
    if (effectiveStartLevel < 1) {
      effectiveStartLevel = 1;
    }
    if (effectiveStartLevel > currentLevel) {
      await interaction.reply({
        content: `Start level ${effectiveStartLevel} exceeds ${target.name}'s current level (${currentLevel}).`,
        ephemeral: true
      });
      return;
    }

    const regenerateFn = Globals.generateLevelUpAbilitiesForCharacter;
    if (typeof regenerateFn !== 'function') {
      await interaction.reply({
        content: 'Ability regeneration is not available on this server.',
        ephemeral: true
      });
      return;
    }

    const existingAbilities = Array.isArray(target.getAbilities()) ? target.getAbilities() : [];
    const removedAbilities = [];
    const keptAbilities = [];

    for (const ability of existingAbilities) {
      const abilityLevel = Number.isFinite(Number(ability?.level)) ? Number(ability.level) : 1;
      if (abilityLevel >= effectiveStartLevel) {
        if (ability?.name) {
          removedAbilities.push(ability.name);
        }
      } else {
        keptAbilities.push({ ...ability });
      }
    }

    const snapshot = target.getAbilities();
    try {
      target.setAbilities(keptAbilities);
    } catch (error) {
      await interaction.reply({
        content: `Failed to prepare ${target.name} for respec: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    try {
      await regenerateFn(target, {
        previousLevel: effectiveStartLevel - 1,
        newLevel: currentLevel
      });
    } catch (error) {
      target.setAbilities(snapshot);
      await interaction.reply({
        content: `Error while regenerating abilities for ${target.name}: ${error.message}`,
        ephemeral: true
      });
      return;
    }

    const finalAbilities = Array.isArray(target.getAbilities()) ? target.getAbilities() : [];
    finalAbilities.sort((a, b) => {
      const levelA = Number.isFinite(Number(a?.level)) ? Number(a.level) : 0;
      const levelB = Number.isFinite(Number(b?.level)) ? Number(b.level) : 0;
      if (levelA !== levelB) {
        return levelA - levelB;
      }
      const nameA = typeof a?.name === 'string' ? a.name.toLowerCase() : '';
      const nameB = typeof b?.name === 'string' ? b.name.toLowerCase() : '';
      return nameA.localeCompare(nameB);
    });
    target.setAbilities(finalAbilities);

    const regenerated = finalAbilities.filter(ability => {
      const abilityLevel = Number.isFinite(Number(ability?.level)) ? Number(ability.level) : 1;
      return abilityLevel >= effectiveStartLevel;
    });

    const summaryList = regenerated.map(ability => {
      const label = ability?.name || 'Unnamed Ability';
      const levelLabel = Number.isFinite(Number(ability?.level)) ? ` (Lv ${ability.level})` : '';
      return `${label}${levelLabel}`;
    });

    const removedList = removedAbilities.length
      ? `**Removed:** ${removedAbilities.join(', ')}\n`
      : '';

    const regeneratedList = summaryList.length
      ? `**Regenerated:** ${summaryList.join(', ')}`
      : 'No new abilities were generated.';

    await interaction.reply({
      content: `${target.name} abilities respec complete (levels ${effectiveStartLevel}-${currentLevel}).\n${removedList}${regeneratedList}`,
      ephemeral: false
    });
  }
}

module.exports = RespecAbilitiesCommand;
