const DefaultUtils = require('./Utils.js');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureFunction(value, label) {
  if (typeof value !== 'function') {
    throw new Error(`${label} must be a function.`);
  }
}

function getAll(model, label) {
  ensureFunction(model?.getAll, `${label}.getAll`);
  const values = model.getAll();
  if (!Array.isArray(values)) {
    throw new Error(`${label}.getAll must return an array.`);
  }
  return values;
}

function resolveRegion(Region, rawRegion) {
  const query = normalizeText(rawRegion);
  if (!query) {
    throw new Error('scheduleEvent requires a non-empty region.');
  }
  const byId = typeof Region.get === 'function' ? Region.get(query) : null;
  if (byId) {
    return byId;
  }
  const byName = typeof Region.getByName === 'function' ? Region.getByName(query) : null;
  if (byName) {
    return byName;
  }
  const lowered = query.toLowerCase();
  const matches = getAll(Region, 'Region')
    .filter(region => normalizeText(region?.name).toLowerCase() === lowered);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(`Region "${query}" is ambiguous; use a region id.`);
  }
  throw new Error(`No region matches "${query}".`);
}

function resolveLocationInRegion(Location, rawLocation, region) {
  const query = normalizeText(rawLocation);
  const regionId = getRegionId(region);
  if (!query || !regionId) {
    return null;
  }
  const lowered = query.toLowerCase();
  const candidates = [];
  if (Array.isArray(region?.locationIds)) {
    for (const locationId of region.locationIds) {
      const location = typeof Location.get === 'function' ? Location.get(locationId) : null;
      if (location && normalizeText(location.name).toLowerCase() === lowered) {
        candidates.push(location);
      }
    }
  }
  if (!candidates.length) {
    candidates.push(
      ...getAll(Location, 'Location')
        .filter(location => (
          getLocationId(location)
          && getLocationRegionId(location, { Region: { getAll: () => [region] }, findRegionByLocationId: null }) === regionId
          && normalizeText(location?.name).toLowerCase() === lowered
        ))
    );
  }
  const unique = [];
  const seenIds = new Set();
  for (const candidate of candidates) {
    const id = getLocationId(candidate);
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    unique.push(candidate);
  }
  if (unique.length === 1) {
    return unique[0];
  }
  if (unique.length > 1) {
    throw new Error(`Location "${query}" is ambiguous inside region "${normalizeText(region.name) || regionId}"; use a location id.`);
  }
  return null;
}

function resolveLocation(Location, rawLocation, region = null) {
  const query = normalizeText(rawLocation);
  if (!query) {
    throw new Error('scheduleEvent requires a non-empty location.');
  }
  const byId = typeof Location.get === 'function' ? Location.get(query) : null;
  if (byId) {
    return byId;
  }
  const byRegion = resolveLocationInRegion(Location, query, region);
  if (byRegion) {
    return byRegion;
  }
  const byName = typeof Location.findByName === 'function' ? Location.findByName(query) : null;
  if (byName) {
    return byName;
  }
  const byGetName = typeof Location.getByName === 'function' ? Location.getByName(query) : null;
  if (byGetName) {
    return byGetName;
  }
  const lowered = query.toLowerCase();
  const matches = getAll(Location, 'Location')
    .filter(location => normalizeText(location?.name).toLowerCase() === lowered);
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(`Location "${query}" is ambiguous; use a location id.`);
  }
  throw new Error(`No location matches "${query}".`);
}

function getRegionId(region) {
  return normalizeText(region?.id);
}

function getLocationId(location) {
  return normalizeText(location?.id);
}

function getLocationRegionId(location, { Region, findRegionByLocationId }) {
  const directRegionId = normalizeText(location?.regionId || location?.regionID);
  if (directRegionId) {
    return directRegionId;
  }
  if (typeof findRegionByLocationId === 'function') {
    const found = findRegionByLocationId(getLocationId(location));
    const id = getRegionId(found);
    if (id) {
      return id;
    }
  }
  const locationId = getLocationId(location);
  for (const region of getAll(Region, 'Region')) {
    if (Array.isArray(region?.locationIds) && region.locationIds.includes(locationId)) {
      return getRegionId(region);
    }
  }
  return '';
}

function validateLocationInRegion(location, region, deps, rawRegion, rawLocation) {
  const regionId = getRegionId(region);
  const locationRegionId = getLocationRegionId(location, deps);
  const regionContainsLocation = Array.isArray(region?.locationIds)
    && region.locationIds.includes(getLocationId(location));
  if (locationRegionId === regionId || regionContainsLocation) {
    return;
  }
  throw new Error(`Location "${normalizeText(rawLocation)}" is not in region "${normalizeText(rawRegion)}".`);
}

function getCycleLengthMinutes(Globals) {
  ensureFunction(Globals?.getTimeConfig, 'Globals.getTimeConfig');
  const cycleLengthMinutes = Number(Globals.getTimeConfig()?.cycleLengthMinutes);
  if (!Number.isFinite(cycleLengthMinutes) || cycleLengthMinutes <= 0) {
    throw new Error('time.cycleLengthMinutes must be a positive number.');
  }
  return cycleLengthMinutes;
}

function absoluteMinuteToWorldTime(totalMinutes, cycleLengthMinutes) {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    throw new Error('Scheduled event target minute must be a non-negative integer.');
  }
  const dayIndex = Math.floor(totalMinutes / cycleLengthMinutes);
  const timeMinutes = totalMinutes - (dayIndex * cycleLengthMinutes);
  return { dayIndex, timeMinutes };
}

function normalizeExactWorldTime(value, cycleLengthMinutes) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('scheduleEvent at must be an object with dayIndex and timeMinutes.');
  }
  const dayIndex = value.dayIndex;
  const timeMinutes = value.timeMinutes;
  if (!Number.isInteger(dayIndex) || dayIndex < 0) {
    throw new Error('scheduleEvent at.dayIndex must be a non-negative integer.');
  }
  if (!Number.isInteger(timeMinutes) || timeMinutes < 0 || timeMinutes >= cycleLengthMinutes) {
    throw new Error('scheduleEvent at.timeMinutes must be an integer in the current day cycle.');
  }
  return { dayIndex, timeMinutes };
}

function hasTimingValue(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  return true;
}

function computeTargetWorldTime(args, { Globals, Utils }) {
  ensureFunction(Globals?.getTotalWorldMinutes, 'Globals.getTotalWorldMinutes');
  const currentTotalMinutes = Globals.getTotalWorldMinutes();
  if (!Number.isInteger(currentTotalMinutes) || currentTotalMinutes < 0) {
    throw new Error('Globals.getTotalWorldMinutes must return a non-negative integer.');
  }
  const cycleLengthMinutes = getCycleLengthMinutes(Globals);
  const hasIn = hasTimingValue(args.in);
  const hasAt = hasTimingValue(args.at);
  if (hasIn === hasAt) {
    throw new Error('Provide exactly one of in or at for scheduleEvent.');
  }

  let targetWorldMinute = null;
  let targetWorldTime = null;
  if (hasIn) {
    ensureFunction(Utils?.parseDurationToMinutes, 'Utils.parseDurationToMinutes');
    const durationMinutes = Utils.parseDurationToMinutes(args.in, {
      fieldName: 'scheduleEvent.in'
    });
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new Error('scheduleEvent in must describe a positive duration in the future.');
    }
    targetWorldMinute = currentTotalMinutes + durationMinutes;
    targetWorldTime = absoluteMinuteToWorldTime(targetWorldMinute, cycleLengthMinutes);
  } else {
    targetWorldTime = normalizeExactWorldTime(args.at, cycleLengthMinutes);
    targetWorldMinute = (targetWorldTime.dayIndex * cycleLengthMinutes) + targetWorldTime.timeMinutes;
    if (targetWorldMinute <= currentTotalMinutes) {
      throw new Error('scheduleEvent at must be in the future.');
    }
  }

  return {
    currentTotalMinutes,
    currentWorldTime: absoluteMinuteToWorldTime(currentTotalMinutes, cycleLengthMinutes),
    targetWorldMinute,
    targetWorldTime
  };
}

function formatWorldTimeLabels(worldTime, Globals) {
  ensureFunction(Globals?.formatDate, 'Globals.formatDate');
  ensureFunction(Globals?.formatTime, 'Globals.formatTime');
  return {
    dateLabel: Globals.formatDate(worldTime),
    timeLabel: Globals.formatTime(worldTime)
  };
}

function createScheduledEventScheduler({
  Globals,
  Utils = DefaultUtils,
  Location,
  Region,
  ScheduledEvent,
  findRegionByLocationId = null
} = {}) {
  if (!ScheduledEvent || typeof ScheduledEvent !== 'function') {
    throw new Error('ScheduledEvent constructor is required.');
  }

  const scheduleEvent = async (args = {}) => {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('scheduleEvent requires an arguments object.');
    }
    const event = normalizeText(args.event || args.description);
    if (!event) {
      throw new Error('scheduleEvent requires a non-empty event.');
    }
    const region = resolveRegion(Region, args.region);
    const location = resolveLocation(Location, args.location, region);
    validateLocationInRegion(location, region, { Region, findRegionByLocationId }, args.region, args.location);

    const {
      currentTotalMinutes,
      currentWorldTime,
      targetWorldMinute,
      targetWorldTime
    } = computeTargetWorldTime(args, { Globals, Utils });

    const scheduledEvent = new ScheduledEvent({
      event,
      regionId: getRegionId(region),
      regionName: normalizeText(region.name),
      locationId: getLocationId(location),
      locationName: normalizeText(location.name),
      targetWorldMinute,
      targetWorldTime,
      createdAtWorldMinute: currentTotalMinutes,
      createdAtWorldTime: currentWorldTime
    });
    const labels = formatWorldTimeLabels(targetWorldTime, Globals);
    return {
      id: scheduledEvent.id,
      event: scheduledEvent.event,
      region: scheduledEvent.regionName,
      location: scheduledEvent.locationName,
      regionId: scheduledEvent.regionId,
      locationId: scheduledEvent.locationId,
      dayIndex: targetWorldTime.dayIndex,
      timeMinutes: targetWorldTime.timeMinutes,
      targetWorldMinute,
      dateLabel: labels.dateLabel,
      timeLabel: labels.timeLabel
    };
  };

  return { scheduleEvent };
}

function findFinalScheduledEventResultBlock(input) {
  const text = typeof input === 'string' ? input : String(input ?? '');
  const matches = [];
  const selfClosingPattern = /<scheduledEventResult\b[^>]*\/\s*>/gi;
  const fullPattern = /<scheduledEventResult\b[\s\S]*?<\/scheduledEventResult>/gi;
  for (const match of text.matchAll(selfClosingPattern)) {
    matches.push({ index: match.index, block: match[0], selfClosing: true });
  }
  for (const match of text.matchAll(fullPattern)) {
    matches.push({ index: match.index, block: match[0], selfClosing: false });
  }
  if (!matches.length) {
    throw new Error('Scheduled event resolution response must contain <scheduledEventResult>.');
  }
  matches.sort((left, right) => left.index - right.index);
  return matches[matches.length - 1];
}

function extractDirectText(document, tagName) {
  const nodes = document.getElementsByTagName(tagName);
  if (!nodes || !nodes.length) {
    return '';
  }
  return DefaultUtils.extractXmlNodeContent(nodes[0]).trim();
}

function parseScheduledEventResultXml(input) {
  const finalBlock = findFinalScheduledEventResultBlock(input);
  if (finalBlock.selfClosing) {
    return {
      happened: false,
      summary: '',
      proseForPlayer: ''
    };
  }
  const document = DefaultUtils.parseXmlDocumentStrict(finalBlock.block);
  const summary = extractDirectText(document, 'summary');
  const proseForPlayer = extractDirectText(document, 'proseForPlayer');
  const happened = Boolean(summary || proseForPlayer);
  return {
    happened,
    summary,
    proseForPlayer
  };
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function requireDeterministicScheduledEventToolPlan(toolPlan) {
  if (!toolPlan || typeof toolPlan !== 'object' || Array.isArray(toolPlan)) {
    throw new Error('Deterministic scheduled event execution requires a parsed tool plan.');
  }
  if (typeof toolPlan.stateChangeRequired !== 'boolean') {
    throw new Error('Deterministic scheduled event tool plan is missing stateChangeRequired.');
  }
  if (!Array.isArray(toolPlan.directUpdates) || !Array.isArray(toolPlan.otherTools)) {
    throw new Error('Deterministic scheduled event tool plan has malformed planned calls.');
  }
  if (toolPlan.otherTools.length) {
    throw new Error(
      'Deterministic scheduled event execution only supports direct updateObjectFields plans.'
    );
  }
  if (!toolPlan.stateChangeRequired && toolPlan.directUpdates.length) {
    throw new Error('A no-change scheduled event tool plan cannot contain direct updates.');
  }
  if (toolPlan.stateChangeRequired && !toolPlan.directUpdates.length) {
    throw new Error('A state-changing scheduled event tool plan requires direct updates.');
  }
  return toolPlan;
}

function buildDeterministicScheduledEventToolCalls(toolPlan) {
  const plan = requireDeterministicScheduledEventToolPlan(toolPlan);
  return plan.directUpdates.map((update, index) => {
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new Error(`Scheduled event direct update ${index + 1} is malformed.`);
    }
    const objectType = normalizeText(update.objectType);
    const object = normalizeText(update.objectId) || normalizeText(update.objectName);
    const field = normalizeText(update.field);
    if (!objectType || !object || !field || !Object.hasOwn(update, 'value')) {
      throw new Error(
        `Scheduled event direct update ${index + 1} requires objectType, object reference, field, and value.`
      );
    }
    const argumentsObject = {
      objectType,
      object,
      fields: {
        [field]: cloneJsonValue(update.value)
      }
    };
    return {
      id: `scheduled_event_plan_${index + 1}`,
      functionName: 'updateObjectFields',
      argumentsObject,
      argumentsText: JSON.stringify(argumentsObject)
    };
  });
}

async function executeDeterministicScheduledEventToolPlan(toolPlan, {
  executeChatToolCall,
  validateToolCall,
  resultCache = new Map(),
  executionOptions = {}
} = {}) {
  ensureFunction(executeChatToolCall, 'executeChatToolCall');
  ensureFunction(validateToolCall, 'validateToolCall');
  if (!(resultCache instanceof Map)) {
    throw new Error('Deterministic scheduled event execution resultCache must be a Map.');
  }
  if (!executionOptions || typeof executionOptions !== 'object' || Array.isArray(executionOptions)) {
    throw new Error('Deterministic scheduled event executionOptions must be an object.');
  }

  const toolCalls = buildDeterministicScheduledEventToolCalls(toolPlan);
  const invocations = [];
  for (const toolCall of toolCalls) {
    await validateToolCall({
      name: toolCall.functionName,
      functionName: toolCall.functionName,
      argumentsObject: cloneJsonValue(toolCall.argumentsObject)
    });
    const cacheKey = JSON.stringify([toolCall.functionName, toolCall.argumentsObject]);
    let toolResult = resultCache.has(cacheKey)
      ? cloneJsonValue(resultCache.get(cacheKey))
      : await executeChatToolCall(toolCall, executionOptions);
    if (!toolResult || typeof toolResult.content !== 'string' || !toolResult.content.trim()) {
      throw new Error(`Scheduled event tool "${toolCall.functionName}" returned empty content.`);
    }
    if (resultCache.has(cacheKey)) {
      toolResult.metadata = {
        ...(toolResult.metadata || {}),
        cached: true
      };
    } else if (toolResult.metadata?.error !== true) {
      resultCache.set(cacheKey, cloneJsonValue(toolResult));
    }
    invocations.push({
      id: toolCall.id,
      name: toolCall.functionName,
      argumentsObject: cloneJsonValue(toolCall.argumentsObject),
      metadata: toolResult.metadata ? cloneJsonValue(toolResult.metadata) : null,
      content: toolResult.content
    });
  }
  return { toolCalls, invocations };
}

module.exports = {
  buildDeterministicScheduledEventToolCalls,
  createScheduledEventScheduler,
  executeDeterministicScheduledEventToolPlan,
  parseScheduledEventResultXml
};
