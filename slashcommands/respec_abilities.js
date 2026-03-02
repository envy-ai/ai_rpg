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

const hasProvidedValue = (value) => {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'string' && !value.trim()) {
    return false;
  }
  return true;
};

const sanitizeLookupKey = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .replace(/[^\w\s]|_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const tokenizePositionalArgs = (value) => {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  const tokens = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    const token = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
};

const containsNamedArgSyntax = (value) => {
  if (typeof value !== 'string') {
    return false;
  }
  return /\b[a-zA-Z0-9_]+\s*=/.test(value);
};

const hasExplicitNamedArg = (argsText, argName) => {
  if (typeof argsText !== 'string' || typeof argName !== 'string' || !argName.trim()) {
    return false;
  }
  const escaped = argName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\s)${escaped}\\s*=`, 'i');
  return pattern.test(argsText);
};

const resolveCharacterTarget = ({ playersByName, playersById, rawName }) => {
  const resolvedName = stripQuotes(rawName);
  if (!resolvedName) {
    return {
      target: null,
      ambiguousMatches: []
    };
  }

  let directTarget = null;
  try {
    directTarget = playersByName.get(resolvedName);
  } catch (_) {
    directTarget = null;
  }
  if (directTarget) {
    return {
      target: directTarget,
      ambiguousMatches: []
    };
  }

  const key = sanitizeLookupKey(resolvedName);
  if (!key) {
    return {
      target: null,
      ambiguousMatches: []
    };
  }

  const matches = [];
  const seenIds = new Set();

  for (const candidate of playersById.values()) {
    if (!candidate || typeof candidate.id !== 'string' || seenIds.has(candidate.id)) {
      continue;
    }

    const candidateNames = [];
    if (typeof candidate.name === 'string') {
      candidateNames.push(candidate.name);
    }
    if (typeof candidate.getAliases === 'function') {
      const aliases = candidate.getAliases();
      if (Array.isArray(aliases)) {
        for (const alias of aliases) {
          if (typeof alias === 'string') {
            candidateNames.push(alias);
          }
        }
      }
    }

    const isMatch = candidateNames.some(name => sanitizeLookupKey(name) === key);
    if (!isMatch) {
      continue;
    }

    seenIds.add(candidate.id);
    matches.push(candidate);
  }

  if (matches.length === 1) {
    return {
      target: matches[0],
      ambiguousMatches: []
    };
  }

  return {
    target: null,
    ambiguousMatches: matches
  };
};

const derivePositionalRespecInput = ({ rawArgsText, playersByName }) => {
  if (typeof rawArgsText !== 'string' || !rawArgsText.trim()) {
    return null;
  }
  if (containsNamedArgSyntax(rawArgsText)) {
    return null;
  }

  const trimmedArgsText = rawArgsText.trim();
  const fullTextCandidate = stripQuotes(trimmedArgsText);
  if (fullTextCandidate) {
    try {
      const directTarget = playersByName.get(fullTextCandidate);
      if (directTarget) {
        return {
          rawName: fullTextCandidate,
          startLevel: null,
          endLevel: null
        };
      }
    } catch (_) {
      // Ignore lookup errors and continue to tokenized parsing.
    }
  }

  const tokens = tokenizePositionalArgs(trimmedArgsText);
  if (!tokens.length) {
    return null;
  }

  for (let splitIndex = tokens.length; splitIndex >= 1; splitIndex -= 1) {
    const nameTokens = tokens.slice(0, splitIndex);
    const levelTokens = tokens.slice(splitIndex);

    if (!nameTokens.length || levelTokens.length > 2) {
      continue;
    }

    const parsedLevels = levelTokens.map(parseOptionalLevel);
    if (parsedLevels.some(level => !Number.isInteger(level))) {
      continue;
    }

    const candidateName = nameTokens.join(' ');
    try {
      const candidateTarget = playersByName.get(candidateName);
      if (!candidateTarget) {
        continue;
      }
    } catch (_) {
      continue;
    }

    return {
      rawName: candidateName,
      startLevel: parsedLevels[0] ?? null,
      endLevel: parsedLevels[1] ?? null
    };
  }

  if (tokens.length <= 2) {
    const parsedLevels = tokens.map(parseOptionalLevel);
    if (parsedLevels.every(level => Number.isInteger(level))) {
      return {
        rawName: null,
        startLevel: parsedLevels[0] ?? null,
        endLevel: parsedLevels[1] ?? null
      };
    }
  }

  return null;
};

class RespecAbilitiesCommand extends SlashCommandBase {
  static get name() {
    return 'respec_abilities';
  }

  static get description() {
    return 'Respec a character\'s abilities across a selected level range.';
  }

  static get args() {
    return [
      { name: 'character', type: 'string', required: false },
      { name: 'start_level', type: 'string', required: false },
      { name: 'end_level', type: 'string', required: false }
    ];
  }

  static validateArgs(providedArgs = {}) {
    const errors = [];

    if (hasProvidedValue(providedArgs.character) && typeof providedArgs.character !== 'string') {
      errors.push('Argument "character" must be a string.');
    }

    const startLevel = providedArgs.start_level;
    if (
      hasProvidedValue(startLevel)
      && typeof startLevel !== 'string'
      && !Number.isInteger(startLevel)
    ) {
      errors.push('Argument "start_level" must be a string or integer.');
    }

    const endLevel = providedArgs.end_level;
    if (
      hasProvidedValue(endLevel)
      && typeof endLevel !== 'string'
      && !Number.isInteger(endLevel)
    ) {
      errors.push('Argument "end_level" must be a string or integer.');
    }

    return errors;
  }

  static async execute(interaction, args = {}) {
    const playersByName = Globals.playersByName;
    const playersById = Globals.playersById;
    const rawArgsText = typeof interaction?.argsText === 'string' ? interaction.argsText : '';
    const usesNamedArgs = containsNamedArgSyntax(rawArgsText);
    const hasNamedCharacter = hasExplicitNamedArg(rawArgsText, 'character');
    const hasNamedStartLevel = hasExplicitNamedArg(rawArgsText, 'start_level');
    const hasNamedEndLevel = hasExplicitNamedArg(rawArgsText, 'end_level');
    const positionalInput = derivePositionalRespecInput({
      rawArgsText,
      playersByName
    });

    let rawName = typeof args.character === 'string' ? args.character : null;
    let startLevel = parseOptionalLevel(args.start_level);
    let endLevel = parseOptionalLevel(args.end_level);

    if (rawName) {
      rawName = stripQuotes(rawName);
    }

    if (usesNamedArgs) {
      if (
        !hasNamedCharacter
        && typeof args.character === 'string'
        && args.character.includes('=')
      ) {
        rawName = null;
      }
      if (
        !hasNamedStartLevel
        && typeof args.start_level === 'string'
        && args.start_level.includes('=')
      ) {
        startLevel = null;
      }
      if (
        !hasNamedEndLevel
        && typeof args.end_level === 'string'
        && args.end_level.includes('=')
      ) {
        endLevel = null;
      }
    }

    if (positionalInput) {
      rawName = positionalInput.rawName;
      startLevel = positionalInput.startLevel;
      endLevel = positionalInput.endLevel;
    } else {
      const startLevelProvided = usesNamedArgs
        ? hasNamedStartLevel && hasProvidedValue(args.start_level)
        : hasProvidedValue(args.start_level);
      if (startLevelProvided && !Number.isInteger(startLevel)) {
        await interaction.reply({
          content: 'Argument "start_level" must be an integer.',
          ephemeral: true
        });
        return;
      }
      const endLevelProvided = usesNamedArgs
        ? hasNamedEndLevel && hasProvidedValue(args.end_level)
        : hasProvidedValue(args.end_level);
      if (endLevelProvided && !Number.isInteger(endLevel)) {
        await interaction.reply({
          content: 'Argument "end_level" must be an integer.',
          ephemeral: true
        });
        return;
      }
    }

    let target = null;
    if (rawName) {
      const { target: resolvedTarget, ambiguousMatches } = resolveCharacterTarget({
        playersByName,
        playersById,
        rawName
      });
      target = resolvedTarget;

      if (!target && ambiguousMatches.length > 1) {
        const names = ambiguousMatches
          .map(candidate => candidate?.name)
          .filter(name => typeof name === 'string' && name.trim())
          .slice(0, 5);
        await interaction.reply({
          content: `Character "${rawName}" is ambiguous. Matches: ${names.join(', ')}.`,
          ephemeral: true
        });
        return;
      }

      if (!target) {
        const fallbackLevel = parseOptionalLevel(rawName);
        if (Number.isInteger(fallbackLevel)) {
          if (!Number.isInteger(startLevel)) {
            startLevel = fallbackLevel;
            rawName = null;
          } else if (!Number.isInteger(endLevel)) {
            endLevel = startLevel;
            startLevel = fallbackLevel;
            rawName = null;
          }
        }
      }
      if (rawName && !target) {
        await interaction.reply({
          content: `Character "${rawName}" was not found.`,
          ephemeral: true
        });
        return;
      }
    }

    if (!target) {
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
    let effectiveEndLevel = Number.isInteger(endLevel) ? endLevel : currentLevel;
    if (effectiveEndLevel < 1) {
      effectiveEndLevel = 1;
    }

    if (effectiveStartLevel > currentLevel) {
      await interaction.reply({
        content: `Start level ${effectiveStartLevel} exceeds ${target.name}'s current level (${currentLevel}).`,
        ephemeral: true
      });
      return;
    }
    if (effectiveEndLevel > currentLevel) {
      await interaction.reply({
        content: `End level ${effectiveEndLevel} exceeds ${target.name}'s current level (${currentLevel}).`,
        ephemeral: true
      });
      return;
    }
    if (effectiveEndLevel < effectiveStartLevel) {
      await interaction.reply({
        content: `End level ${effectiveEndLevel} cannot be lower than start level ${effectiveStartLevel}.`,
        ephemeral: true
      });
      return;
    }

    const existingAbilities = Array.isArray(target.getAbilities()) ? target.getAbilities() : [];
    const removedAbilities = [];
    const keptAbilities = [];

    for (const ability of existingAbilities) {
      const abilityLevel = Number.isFinite(Number(ability?.level)) ? Number(ability.level) : 1;
      if (abilityLevel >= effectiveStartLevel && abilityLevel <= effectiveEndLevel) {
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

    if (!target.isNPC) {
      if (typeof target.clearPendingAbilityOptionsForLevel === 'function') {
        for (let level = effectiveStartLevel; level <= effectiveEndLevel; level += 1) {
          try {
            target.clearPendingAbilityOptionsForLevel(level);
          } catch (_) {
            // Ignore malformed legacy pending-option level keys.
          }
        }
      }

      const removedList = removedAbilities.length
        ? `**Removed:** ${removedAbilities.join(', ')}\n`
        : '';

      await interaction.reply({
        content: `${target.name} abilities respec complete (levels ${effectiveStartLevel}-${effectiveEndLevel}).\n${removedList}Choose your replacement abilities in the level-up selection modal.`,
        ephemeral: false
      });
      return;
    }

    const regenerateFn = Globals.generateLevelUpAbilitiesForCharacter;
    if (typeof regenerateFn !== 'function') {
      try {
        target.setAbilities(snapshot);
      } catch (_) {
        // Ignore rollback error and still report command failure.
      }
      await interaction.reply({
        content: 'Ability regeneration is not available on this server.',
        ephemeral: true
      });
      return;
    }

    try {
      await regenerateFn(target, {
        previousLevel: effectiveStartLevel - 1,
        newLevel: effectiveEndLevel,
        requireAbilityAddition: removedAbilities.length > 0
      });
    } catch (error) {
      try {
        target.setAbilities(snapshot);
      } catch (_) {
        // Ignore rollback error and still report regeneration failure.
      }
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
      return abilityLevel >= effectiveStartLevel && abilityLevel <= effectiveEndLevel;
    });

    if (removedAbilities.length > 0 && regenerated.length === 0) {
      try {
        target.setAbilities(snapshot);
      } catch (_) {
        // Ignore rollback failure and report the underlying respec issue.
      }
      await interaction.reply({
        content: `Error while regenerating abilities for ${target.name}: generated replacements could not be applied; original abilities were restored.`,
        ephemeral: true
      });
      return;
    }

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
      content: `${target.name} abilities respec complete (levels ${effectiveStartLevel}-${effectiveEndLevel}).\n${removedList}${regeneratedList}`,
      ephemeral: false
    });
  }
}

module.exports = RespecAbilitiesCommand;
