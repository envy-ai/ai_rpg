const Globals = require('../Globals.js');
const Location = require('../Location.js');
const SlashCommandBase = require('../SlashCommandBase.js');
const Utils = require('../Utils.js');
const {
  stripQuotes,
  tokenizePositionalArgs
} = require('../slashcommand_utils/characterTargeting.js');

function resolveLocation(rawLocationText) {
  const locationText = stripQuotes(rawLocationText);
  if (!locationText) {
    throw new Error('Location is required. Usage: /set_last_seen <location|all> <H AM/PM | H:MM AM/PM | duration ago>');
  }

  let location = null;
  try {
    location = Location.get(locationText);
  } catch (_) {
    location = null;
  }

  if (!location) {
    try {
      location = Location.getByName(locationText);
    } catch (_) {
      location = null;
    }
  }

  if (!location) {
    throw new Error(`Location "${locationText}" was not found.`);
  }

  return location;
}

function parseClockTimeText(rawValue) {
  const match = String(rawValue ?? '').trim().match(/^(\d{1,2})(?::([0-5]\d))?\s*([AaPp][Mm])$/);
  if (!match) {
    return null;
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = match[2] === undefined
    ? 0
    : Number.parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) {
    throw new Error(`Exact time "${rawValue}" must use an hour from 1 to 12.`);
  }

  const hour24 = (hour % 12) + (period === 'PM' ? 12 : 0);
  return (hour24 * 60) + minute;
}

function parseRelativeTimeCandidate(rawValue) {
  const trimmed = String(rawValue ?? '').trim();
  if (!trimmed.toLowerCase().endsWith(' ago')) {
    return null;
  }

  const durationText = trimmed.replace(/\s+ago$/i, '').trim();
  if (!durationText) {
    return null;
  }

  try {
    const minutesAgo = Utils.parseDurationToMinutes(durationText, {
      fieldName: '/set_last_seen time ago'
    });
    return {
      rawTimeText: trimmed,
      minutesAgo
    };
  } catch (_) {
    return null;
  }
}

function classifyDurationToken(rawToken) {
  const trimmed = String(rawToken ?? '').trim();
  const normalized = trimmed.replace(/^[,]+|[,]+$/g, '');
  const supportedUnitPattern = /^(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|rounds?|rnds?|rnd)$/i;
  if (!normalized) {
    return null;
  }

  if (normalized.toLowerCase() === 'and') {
    return 'separator';
  }
  if (/^[+-]/.test(normalized)) {
    return null;
  }
  if (/^\d+(?::[0-5]\d)?$/.test(normalized)) {
    return 'value';
  }
  if (/^\d/.test(normalized) && /[A-Za-z]/.test(normalized)) {
    return 'value+unit';
  }
  if (supportedUnitPattern.test(normalized)) {
    return 'unit';
  }

  return null;
}

function looksLikeDurationTokens(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) {
    return false;
  }

  let sawAnyDurationToken = false;
  let pendingBareValue = false;
  let bareValueCount = 0;

  for (const rawToken of tokens) {
    const tokenType = classifyDurationToken(rawToken);
    if (!tokenType) {
      return false;
    }
    if (tokenType === 'separator') {
      continue;
    }

    sawAnyDurationToken = true;
    if (tokenType === 'value') {
      bareValueCount += 1;
      if (pendingBareValue) {
        return false;
      }
      pendingBareValue = true;
      continue;
    }

    if (tokenType === 'unit') {
      if (!pendingBareValue) {
        return false;
      }
      pendingBareValue = false;
      continue;
    }

    if (pendingBareValue) {
      return false;
    }
  }

  if (!sawAnyDurationToken) {
    return false;
  }
  if (pendingBareValue) {
    return bareValueCount === 1;
  }
  return true;
}

function parseInvocation(rawInput) {
  const trimmed = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!trimmed) {
    throw new Error('Usage: /set_last_seen <location|all> <H AM/PM | H:MM AM/PM | duration ago>');
  }

  const exactMatch = trimmed.match(/^(.+?)\s+(\d{1,2}(?::\d{2})?\s*[AaPp][Mm])$/);
  if (exactMatch) {
    return {
      kind: 'clock',
      locationText: exactMatch[1].trim(),
      rawTimeText: exactMatch[2].trim(),
      clockMinutes: parseClockTimeText(exactMatch[2])
    };
  }

  const tokens = tokenizePositionalArgs(trimmed);
  if (tokens.length >= 3 && String(tokens[tokens.length - 1]).toLowerCase() === 'ago') {
    for (let splitIndex = 1; splitIndex < tokens.length - 1; splitIndex += 1) {
      const locationTokens = tokens.slice(0, splitIndex);
      const durationTokens = tokens.slice(splitIndex, -1);
      if (!looksLikeDurationTokens(durationTokens)) {
        continue;
      }

      const locationText = locationTokens.join(' ').trim();
      const candidateTimeText = `${durationTokens.join(' ')} ago`.trim();
      const relativeMatch = parseRelativeTimeCandidate(candidateTimeText);
      if (!relativeMatch || !locationText) {
        continue;
      }

      return {
        kind: 'ago',
        locationText,
        rawTimeText: relativeMatch.rawTimeText,
        minutesAgo: relativeMatch.minutesAgo
      };
    }
  }

  throw new Error(
    'Usage: /set_last_seen <location|all> <H AM/PM | H:MM AM/PM | duration ago>. Examples: /set_last_seen "Town Square" 3 PM, /set_last_seen "Town Square" 3:15 PM, /set_last_seen all 2 hours ago.'
  );
}

function absoluteMinutesToWorldTime(totalMinutes) {
  const timeConfig = Globals.getTimeConfig();
  const cycleLengthMinutes = timeConfig.cycleLengthMinutes;
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    throw new Error('Absolute world-minute timestamps must be non-negative integers.');
  }

  const dayIndex = Math.floor(totalMinutes / cycleLengthMinutes);
  const timeMinutes = totalMinutes - (dayIndex * cycleLengthMinutes);
  return { dayIndex, timeMinutes };
}

function resolveExactTimestamp(clockMinutes, rawTimeText) {
  if (!Number.isInteger(clockMinutes) || clockMinutes < 0) {
    throw new Error(`Exact time "${rawTimeText}" could not be parsed.`);
  }

  const currentTotalMinutes = Globals.getTotalWorldMinutes();
  const timeConfig = Globals.getTimeConfig();
  const cycleLengthMinutes = timeConfig.cycleLengthMinutes;
  if (clockMinutes >= cycleLengthMinutes) {
    throw new Error(
      `Exact time "${rawTimeText}" exceeds the configured in-world day length (${cycleLengthMinutes} minutes).`
    );
  }

  const currentDayIndex = Math.floor(currentTotalMinutes / cycleLengthMinutes);
  const currentTimeMinutes = currentTotalMinutes - (currentDayIndex * cycleLengthMinutes);
  const resolvedDayIndex = clockMinutes > currentTimeMinutes
    ? currentDayIndex - 1
    : currentDayIndex;

  if (resolvedDayIndex < 0) {
    throw new Error(
      `Exact time "${rawTimeText}" would resolve before the start of the current world timeline.`
    );
  }

  return (resolvedDayIndex * cycleLengthMinutes) + clockMinutes;
}

function resolveRelativeTimestamp(minutesAgo, rawTimeText) {
  if (!Number.isInteger(minutesAgo) || minutesAgo < 0) {
    throw new Error(`Relative time "${rawTimeText}" must be a non-negative duration.`);
  }

  const currentTotalMinutes = Globals.getTotalWorldMinutes();
  const resolvedTotalMinutes = currentTotalMinutes - minutesAgo;
  if (resolvedTotalMinutes < 0) {
    throw new Error(
      `Relative time "${rawTimeText}" would resolve before the start of the current world timeline.`
    );
  }

  return resolvedTotalMinutes;
}

function formatResolvedTimestamp(totalMinutes) {
  const worldTime = absoluteMinutesToWorldTime(totalMinutes);
  const timeLabel = Globals.formatTime(worldTime, { skipEnsure: true });
  const dateLabel = Globals.formatDate(worldTime, { skipEnsure: true });
  return {
    timeLabel,
    dateLabel
  };
}

function formatLocationLabel(location) {
  const name = typeof location?.name === 'string' ? location.name.trim() : '';
  const id = typeof location?.id === 'string' ? location.id.trim() : '';
  if (name && id && name !== id) {
    return `${name} (${id})`;
  }
  return name || id || 'unknown location';
}

function resolveTargetLocations(rawLocationText) {
  const locationText = stripQuotes(rawLocationText);
  if (!locationText) {
    throw new Error('Location is required. Usage: /set_last_seen <location|all> <H AM/PM | H:MM AM/PM | duration ago>');
  }

  if (locationText.trim().toLowerCase() === 'all') {
    const currentLocationId = typeof Globals.currentPlayer?.currentLocation === 'string'
      ? Globals.currentPlayer.currentLocation.trim()
      : '';
    if (!currentLocationId) {
      throw new Error('Cannot use /set_last_seen all without a current player location.');
    }

    const locations = Location.getAll().filter(location => (
      location
      && typeof location.id === 'string'
      && location.id.trim()
      && location.id.trim() !== currentLocationId
    ));
    if (!locations.length) {
      throw new Error('No non-current locations are available for /set_last_seen all.');
    }

    return {
      mode: 'all',
      locations
    };
  }

  return {
    mode: 'single',
    locations: [resolveLocation(locationText)]
  };
}

class SetLastSeenCommand extends SlashCommandBase {
  static get name() {
    return 'set_last_seen';
  }

  static get description() {
    return 'Set last-seen time/location for every NPC currently at a location.';
  }

  static get args() {
    return [];
  }

  static get usage() {
    return '/set_last_seen <location|all> <H AM/PM | H:MM AM/PM | duration ago>';
  }

  static async execute(interaction) {
    if (Globals.gameLoaded !== true) {
      throw new Error('Cannot use /set_last_seen when no game is loaded.');
    }

    const invocation = parseInvocation(interaction?.argsText);
    const targetSelection = resolveTargetLocations(invocation.locationText);

    const resolvedTimeMinutes = invocation.kind === 'clock'
      ? resolveExactTimestamp(invocation.clockMinutes, invocation.rawTimeText)
      : resolveRelativeTimestamp(invocation.minutesAgo, invocation.rawTimeText);

    const targetLocationIds = new Set(targetSelection.locations.map(location => location.id));
    const targets = [];
    for (const actor of Globals.playersById.values()) {
      if (!actor || actor.isNPC !== true) {
        continue;
      }
      if (!targetLocationIds.has(actor.currentLocation)) {
        continue;
      }
      targets.push(actor);
    }

    if (!targets.length) {
      if (targetSelection.mode === 'all') {
        throw new Error('No NPCs are currently at any location except the current one.');
      }
      throw new Error(`No NPCs are currently at ${formatLocationLabel(targetSelection.locations[0])}.`);
    }

    for (const actor of targets) {
      actor.recordLastSeenByPlayer({
        time: resolvedTimeMinutes,
        locationId: actor.currentLocation,
        wasInPlayerLocationPreviousRound: false
      });
    }

    const resolvedTimestamp = formatResolvedTimestamp(resolvedTimeMinutes);
    const npcCountLabel = `${targets.length} ${targets.length === 1 ? 'NPC' : 'NPCs'}`;
    const updatedLocationCount = new Set(targets.map(actor => actor.currentLocation)).size;
    const locationCountLabel = `${updatedLocationCount} ${updatedLocationCount === 1 ? 'location' : 'locations'}`;
    const messageParts = [
      targetSelection.mode === 'all'
        ? `Set last-seen data for ${npcCountLabel} across ${locationCountLabel} (all locations except the current one).`
        : `Set last-seen data for ${npcCountLabel} at ${formatLocationLabel(targetSelection.locations[0])}.`,
      `Resolved "${invocation.rawTimeText}" to ${resolvedTimestamp.timeLabel} on ${resolvedTimestamp.dateLabel}.`,
      'Marked them as not continuously present from the previous round.'
    ];

    await interaction.reply({
      content: messageParts.join(' '),
      ephemeral: false
    });
  }
}

module.exports = SetLastSeenCommand;
