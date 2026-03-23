function stripQuotes(value) {
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
}

function sanitizeLookupKey(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/[^\w\s]|_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenizePositionalArgs(value) {
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
}

function containsNamedArgSyntax(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return /\b[a-zA-Z0-9_]+\s*=/.test(value);
}

function hasExplicitNamedArg(argsText, argName) {
  if (typeof argsText !== 'string' || typeof argName !== 'string' || !argName.trim()) {
    return false;
  }

  const escaped = argName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\s)${escaped}\\s*=`, 'i');
  return pattern.test(argsText);
}

function getSingleCharacterArgValue({ interaction, args = {}, argName = 'character' } = {}) {
  const rawArgsText = typeof interaction?.argsText === 'string' ? interaction.argsText.trim() : '';
  if (rawArgsText && !containsNamedArgSyntax(rawArgsText)) {
    return stripQuotes(rawArgsText);
  }
  return stripQuotes(args?.[argName]);
}

function getTrailingCharacterArgValue({
  interaction,
  args = {},
  argName = 'character',
  leadingArgCount = 1
} = {}) {
  const rawArgsText = typeof interaction?.argsText === 'string' ? interaction.argsText.trim() : '';
  if (!rawArgsText || containsNamedArgSyntax(rawArgsText)) {
    return stripQuotes(args?.[argName]);
  }

  const tokens = tokenizePositionalArgs(rawArgsText);
  if (tokens.length <= leadingArgCount) {
    return stripQuotes(args?.[argName]);
  }

  return stripQuotes(tokens.slice(leadingArgCount).join(' '));
}

function getInteractionCurrentLocationId(interaction, playersById) {
  const invokingPlayerId = interaction?.user?.id;
  if (!invokingPlayerId || !(playersById instanceof Map)) {
    return '';
  }

  const invokingPlayer = playersById.get(invokingPlayerId);
  const currentLocationId = typeof invokingPlayer?.currentLocation === 'string'
    ? invokingPlayer.currentLocation.trim()
    : '';
  return currentLocationId;
}

function isCandidateAllowed(candidate, { allowNPCs = true, allowPlayers = true } = {}) {
  if (!candidate || typeof candidate !== 'object') {
    return false;
  }
  if (candidate.isNPC) {
    return !!allowNPCs;
  }
  return !!allowPlayers;
}

function resolveCharacterTarget({
  rawName,
  playersByName,
  playersById,
  currentLocationId = '',
  allowNPCs = true,
  allowPlayers = true
} = {}) {
  const resolvedName = stripQuotes(rawName);
  if (!resolvedName) {
    return {
      target: null,
      ambiguousMatches: [],
      exactDisallowedMatch: null
    };
  }

  let directTarget = null;
  try {
    directTarget = playersByName?.get(resolvedName) || null;
  } catch (_) {
    directTarget = null;
  }

  if (directTarget) {
    if (isCandidateAllowed(directTarget, { allowNPCs, allowPlayers })) {
      return {
        target: directTarget,
        ambiguousMatches: [],
        exactDisallowedMatch: null
      };
    }

    return {
      target: null,
      ambiguousMatches: [],
      exactDisallowedMatch: directTarget
    };
  }

  const key = sanitizeLookupKey(resolvedName);
  if (!key || !(playersById instanceof Map)) {
    return {
      target: null,
      ambiguousMatches: [],
      exactDisallowedMatch: null
    };
  }

  const matches = [];
  const seenIds = new Set();
  for (const candidate of playersById.values()) {
    if (!candidate || typeof candidate.id !== 'string' || seenIds.has(candidate.id)) {
      continue;
    }
    if (!isCandidateAllowed(candidate, { allowNPCs, allowPlayers })) {
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
      ambiguousMatches: [],
      exactDisallowedMatch: null
    };
  }

  if (matches.length > 1 && currentLocationId) {
    const locationMatches = matches.filter(candidate => {
      const candidateLocationId = typeof candidate.currentLocation === 'string'
        ? candidate.currentLocation.trim()
        : '';
      return candidateLocationId && candidateLocationId === currentLocationId;
    });

    if (locationMatches.length === 1) {
      return {
        target: locationMatches[0],
        ambiguousMatches: [],
        exactDisallowedMatch: null
      };
    }

    if (locationMatches.length > 1) {
      return {
        target: null,
        ambiguousMatches: locationMatches,
        exactDisallowedMatch: null
      };
    }
  }

  return {
    target: null,
    ambiguousMatches: matches,
    exactDisallowedMatch: null
  };
}

function formatAmbiguousCharacterMatches(matches, { limit = 8 } = {}) {
  if (!Array.isArray(matches) || matches.length === 0) {
    return '';
  }

  return matches
    .map(candidate => candidate?.name)
    .filter(name => typeof name === 'string' && name.trim())
    .slice(0, limit)
    .join(', ');
}

module.exports = {
  stripQuotes,
  sanitizeLookupKey,
  tokenizePositionalArgs,
  containsNamedArgSyntax,
  hasExplicitNamedArg,
  getSingleCharacterArgValue,
  getTrailingCharacterArgValue,
  getInteractionCurrentLocationId,
  resolveCharacterTarget,
  formatAmbiguousCharacterMatches
};
