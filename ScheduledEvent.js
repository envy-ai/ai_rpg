const IdGenerator = require('./IdGenerator.js');

const VALID_STATUSES = new Set(['pending', 'resolved', 'skipped']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clonePlain(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeWorldMinute(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`ScheduledEvent ${label} must be a non-negative integer.`);
  }
  return value;
}

function normalizeWorldTime(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`ScheduledEvent ${label} must be a world-time object.`);
  }
  const dayIndex = value.dayIndex;
  const timeMinutes = value.timeMinutes;
  if (!Number.isInteger(dayIndex) || dayIndex < 0) {
    throw new Error(`ScheduledEvent ${label}.dayIndex must be a non-negative integer.`);
  }
  if (!Number.isInteger(timeMinutes) || timeMinutes < 0) {
    throw new Error(`ScheduledEvent ${label}.timeMinutes must be a non-negative integer.`);
  }
  return { dayIndex, timeMinutes };
}

function normalizeStatus(value) {
  const status = normalizeText(value) || 'pending';
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`ScheduledEvent status must be one of: ${Array.from(VALID_STATUSES).join(', ')}.`);
  }
  return status;
}

class ScheduledEvent {
  static #instances = new Map();

  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('ScheduledEvent constructor requires an options object.');
    }

    const event = normalizeText(options.event || options.description);
    if (!event) {
      throw new Error('ScheduledEvent requires a non-empty event string.');
    }
    const regionId = normalizeText(options.regionId);
    if (!regionId) {
      throw new Error('ScheduledEvent requires a non-empty regionId.');
    }
    const regionName = normalizeText(options.regionName);
    if (!regionName) {
      throw new Error('ScheduledEvent requires a non-empty regionName.');
    }
    const locationId = normalizeText(options.locationId);
    if (!locationId) {
      throw new Error('ScheduledEvent requires a non-empty locationId.');
    }
    const locationName = normalizeText(options.locationName);
    if (!locationName) {
      throw new Error('ScheduledEvent requires a non-empty locationName.');
    }

    const id = normalizeText(options.id) || IdGenerator.next('scheduledEvent');
    this.id = id;
    this.event = event;
    this.regionId = regionId;
    this.regionName = regionName;
    this.locationId = locationId;
    this.locationName = locationName;
    this.targetWorldMinute = normalizeWorldMinute(options.targetWorldMinute, 'targetWorldMinute');
    this.targetWorldTime = normalizeWorldTime(options.targetWorldTime, 'targetWorldTime');
    this.createdAtWorldMinute = normalizeWorldMinute(options.createdAtWorldMinute, 'createdAtWorldMinute');
    this.createdAtWorldTime = normalizeWorldTime(options.createdAtWorldTime, 'createdAtWorldTime');
    this.status = normalizeStatus(options.status);
    this.resolutionSummary = normalizeText(options.resolutionSummary);
    this.playerProse = normalizeText(options.playerProse);
    this.resolvedAtWorldMinute = options.resolvedAtWorldMinute === null || options.resolvedAtWorldMinute === undefined
      ? null
      : normalizeWorldMinute(options.resolvedAtWorldMinute, 'resolvedAtWorldMinute');
    this.resolvedAtWorldTime = options.resolvedAtWorldTime === null || options.resolvedAtWorldTime === undefined
      ? null
      : normalizeWorldTime(options.resolvedAtWorldTime, 'resolvedAtWorldTime');
    this.createdAt = normalizeText(options.createdAt) || new Date().toISOString();
    this.updatedAt = normalizeText(options.updatedAt) || this.createdAt;

    IdGenerator.register('scheduledEvent', id);
    ScheduledEvent.#instances.set(this.id, this);
  }

  static clear() {
    ScheduledEvent.#instances.clear();
  }

  static getAll() {
    return Array.from(ScheduledEvent.#instances.values());
  }

  static getById(id) {
    const normalizedId = normalizeText(id);
    return normalizedId ? ScheduledEvent.#instances.get(normalizedId) || null : null;
  }

  static getPending() {
    return ScheduledEvent.getAll()
      .filter(event => event.status === 'pending')
      .sort(ScheduledEvent.#chronologicalSort);
  }

  static getPendingDue(worldMinute) {
    const normalizedMinute = normalizeWorldMinute(worldMinute, 'due worldMinute');
    return ScheduledEvent.getPending()
      .filter(event => event.targetWorldMinute <= normalizedMinute);
  }

  static fromJSON(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('ScheduledEvent.fromJSON requires an object payload.');
    }
    return new ScheduledEvent(payload);
  }

  static serializeAll() {
    return Object.fromEntries(
      ScheduledEvent.getAll().map(event => [event.id, event.toJSON()])
    );
  }

  static loadAll(payload = {}) {
    ScheduledEvent.clear();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('ScheduledEvent.loadAll requires an object map.');
    }
    for (const entry of Object.values(payload)) {
      ScheduledEvent.fromJSON(entry);
    }
  }

  markResolved({ summary, playerProse = '', worldMinute, worldTime } = {}) {
    const normalizedSummary = normalizeText(summary);
    if (!normalizedSummary) {
      throw new Error('ScheduledEvent.markResolved requires a non-empty summary.');
    }
    this.status = 'resolved';
    this.resolutionSummary = normalizedSummary;
    this.playerProse = normalizeText(playerProse);
    this.resolvedAtWorldMinute = normalizeWorldMinute(worldMinute, 'resolvedAtWorldMinute');
    this.resolvedAtWorldTime = normalizeWorldTime(worldTime, 'resolvedAtWorldTime');
    this.updatedAt = new Date().toISOString();
    return this;
  }

  markSkipped({ worldMinute, worldTime } = {}) {
    this.status = 'skipped';
    this.resolutionSummary = '';
    this.playerProse = '';
    this.resolvedAtWorldMinute = normalizeWorldMinute(worldMinute, 'resolvedAtWorldMinute');
    this.resolvedAtWorldTime = normalizeWorldTime(worldTime, 'resolvedAtWorldTime');
    this.updatedAt = new Date().toISOString();
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      event: this.event,
      regionId: this.regionId,
      regionName: this.regionName,
      locationId: this.locationId,
      locationName: this.locationName,
      targetWorldMinute: this.targetWorldMinute,
      targetWorldTime: clonePlain(this.targetWorldTime),
      createdAtWorldMinute: this.createdAtWorldMinute,
      createdAtWorldTime: clonePlain(this.createdAtWorldTime),
      status: this.status,
      resolutionSummary: this.resolutionSummary,
      playerProse: this.playerProse,
      resolvedAtWorldMinute: this.resolvedAtWorldMinute,
      resolvedAtWorldTime: clonePlain(this.resolvedAtWorldTime),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static #chronologicalSort(left, right) {
    if (left.targetWorldMinute !== right.targetWorldMinute) {
      return left.targetWorldMinute - right.targetWorldMinute;
    }
    return left.id.localeCompare(right.id);
  }
}

module.exports = ScheduledEvent;
