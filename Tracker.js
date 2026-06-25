const IdGenerator = require('./IdGenerator.js');
const Utils = require('./Utils.js');
const Globals = require('./Globals.js');

const VALID_TYPES = new Set([
  'countdown',
  'numerical_count',
  'x_out_of_total',
  'percentage',
  'short_string'
]);
const DEFAULT_SHORT_STRING_MAX_WORDS = 4;
const NOTE_MAX_WORDS = 100;
const WORD_COUNT_LABELS = Object.freeze({
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten'
});

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeWorldMinute(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Tracker ${label} must be a non-negative integer.`);
  }
  return value;
}

function normalizeOptionalWorldMinute(value, label) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return normalizeWorldMinute(value, label);
}

function normalizeType(value) {
  const type = normalizeText(value);
  if (!VALID_TYPES.has(type)) {
    throw new Error(`Tracker type must be one of: ${Array.from(VALID_TYPES).join(', ')}.`);
  }
  return type;
}

function resolveShortStringMaxWords(config = Globals.config) {
  const rawValue = config?.trackers?.short_string_max_words;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return DEFAULT_SHORT_STRING_MAX_WORDS;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('config.trackers.short_string_max_words must be an integer greater than or equal to 1.');
  }
  return value;
}

function formatWordCount(value) {
  return WORD_COUNT_LABELS[value] || String(value);
}

function normalizeNote(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error('Tracker note must be a string when provided.');
  }
  const note = value.trim();
  const words = note ? note.split(/\s+/).filter(Boolean) : [];
  if (words.length > NOTE_MAX_WORDS) {
    throw new Error(`Tracker note must be ${NOTE_MAX_WORDS} words or fewer.`);
  }
  return note;
}

function normalizeValueForType(value, type) {
  const text = normalizeText(value);
  if (!text) {
    throw new Error('Tracker value must be a non-empty string.');
  }

  if (type === 'short_string') {
    const words = text.split(/\s+/).filter(Boolean);
    const maxWords = resolveShortStringMaxWords();
    if (words.length > maxWords) {
      throw new Error(`Tracker short_string value must be ${formatWordCount(maxWords)} words or fewer.`);
    }
  }

  if (type === 'x_out_of_total') {
    const match = text.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!match) {
      throw new Error('Tracker x_out_of_total value must use x/total format.');
    }
    const current = Number.parseInt(match[1], 10);
    const total = Number.parseInt(match[2], 10);
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || current < 0 || total < 0) {
      throw new Error('Tracker x_out_of_total value must use non-negative integer parts.');
    }
  }

  if (type === 'percentage') {
    const match = text.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*%?$/);
    if (!match || !Number.isFinite(Number(match[1]))) {
      throw new Error('Tracker percentage value must be a finite number with optional %.');
    }
    return `${match[1]}%`;
  }

  return text;
}

function resolveCountdownUntilWorldMinute(value, {
  currentWorldMinute,
  fieldName = 'Tracker countdown value'
} = {}) {
  const worldMinute = normalizeWorldMinute(currentWorldMinute, 'currentWorldMinute');
  const durationMinutes = Utils.parseDurationToMinutes(value, { fieldName });
  const untilWorldMinute = worldMinute + durationMinutes;
  return normalizeWorldMinute(untilWorldMinute, 'countdownUntilWorldMinute');
}

function clonePlain(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

class Tracker {
  static #instances = new Map();

  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('Tracker constructor requires an options object.');
    }

    const name = normalizeText(options.name);
    if (!name) {
      throw new Error('Tracker requires a non-empty name.');
    }

    const type = normalizeType(options.type);
    const value = normalizeValueForType(options.value, type);
    const description = normalizeText(options.description);
    if (!description) {
      throw new Error('Tracker requires a non-empty description.');
    }

    const id = normalizeText(options.id) || IdGenerator.next('tracker');
    this.id = id;
    this.name = name;
    this.type = type;
    this.value = value;
    this.hiddenFromPlayer = options.hiddenFromPlayer === true;
    this.lastUpdatedWorldMinute = normalizeWorldMinute(
      options.lastUpdatedWorldMinute,
      'lastUpdatedWorldMinute'
    );
    this.countdownUntilWorldMinute = null;
    if (type === 'countdown') {
      if (options.countdownUntilWorldMinute !== undefined && options.countdownUntilWorldMinute !== null) {
        this.countdownUntilWorldMinute = normalizeOptionalWorldMinute(
          options.countdownUntilWorldMinute,
          'countdownUntilWorldMinute'
        );
      } else if (options.deriveCountdownUntilWorldMinute === true) {
        this.countdownUntilWorldMinute = resolveCountdownUntilWorldMinute(value, {
          currentWorldMinute: this.lastUpdatedWorldMinute
        });
      }
    }
    this.description = description;
    this.note = normalizeNote(options.note);
    this.createdAt = normalizeText(options.createdAt) || new Date().toISOString();
    this.updatedAt = normalizeText(options.updatedAt) || this.createdAt;

    IdGenerator.register('tracker', id);
    Tracker.#instances.set(this.id, this);
  }

  static get validTypes() {
    return Array.from(VALID_TYPES);
  }

  static get defaultShortStringMaxWords() {
    return DEFAULT_SHORT_STRING_MAX_WORDS;
  }

  static shortStringMaxWords(config = Globals.config) {
    return resolveShortStringMaxWords(config);
  }

  static shortStringMaxWordsText(config = Globals.config) {
    return formatWordCount(resolveShortStringMaxWords(config));
  }

  static get noteMaxWords() {
    return NOTE_MAX_WORDS;
  }

  static clear() {
    Tracker.#instances.clear();
  }

  static getAll() {
    return Array.from(Tracker.#instances.values());
  }

  static getById(id) {
    const normalizedId = normalizeText(id);
    return normalizedId ? Tracker.#instances.get(normalizedId) || null : null;
  }

  static findByNameOrKey(query) {
    const normalizedQuery = normalizeKey(query);
    if (!normalizedQuery) {
      return [];
    }
    const queryTerms = normalizedQuery.split(' ').filter(Boolean);
    return Tracker.getAll().filter((tracker) => {
      const values = [tracker.id, tracker.name]
        .map(value => normalizeKey(value))
        .filter(Boolean);
      return values.some(value => (
        value === normalizedQuery
        || value.includes(normalizedQuery)
        || queryTerms.every(term => value.includes(term))
      ));
    });
  }

  static fromJSON(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Tracker.fromJSON requires an object payload.');
    }
    return new Tracker(payload);
  }

  static serializeAll() {
    return Object.fromEntries(
      Tracker.getAll().map(tracker => [tracker.id, tracker.toJSON()])
    );
  }

  static loadAll(payload = {}) {
    Tracker.clear();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Tracker.loadAll requires an object map.');
    }
    for (const [id, entry] of Object.entries(payload)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Tracker.loadAll entry "${id}" must be an object.`);
      }
      Tracker.fromJSON({
        ...entry,
        id: normalizeText(entry.id) || normalizeText(id)
      });
    }
  }

  static removeById(id) {
    const tracker = Tracker.getById(id);
    if (!tracker) {
      return null;
    }
    Tracker.#instances.delete(tracker.id);
    return tracker;
  }

  updateValue(value, { worldMinute, countdownUntilWorldMinute, note } = {}) {
    this.value = normalizeValueForType(value, this.type);
    this.lastUpdatedWorldMinute = normalizeWorldMinute(worldMinute, 'lastUpdatedWorldMinute');
    if (this.type === 'countdown') {
      if (countdownUntilWorldMinute !== undefined && countdownUntilWorldMinute !== null) {
        this.countdownUntilWorldMinute = normalizeOptionalWorldMinute(
          countdownUntilWorldMinute,
          'countdownUntilWorldMinute'
        );
      } else {
        this.countdownUntilWorldMinute = resolveCountdownUntilWorldMinute(this.value, {
          currentWorldMinute: this.lastUpdatedWorldMinute
        });
      }
    }
    if (note !== undefined) {
      this.note = normalizeNote(note);
    }
    this.updatedAt = new Date().toISOString();
    return this;
  }

  updateEditableFields({
    name,
    type,
    value,
    hiddenFromPlayer = false,
    lastUpdatedWorldMinute,
    countdownUntilWorldMinute,
    description,
    note
  } = {}) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      throw new Error('Tracker requires a non-empty name.');
    }

    const normalizedType = normalizeType(type);
    const normalizedValue = normalizeValueForType(value, normalizedType);
    const normalizedDescription = normalizeText(description);
    if (!normalizedDescription) {
      throw new Error('Tracker requires a non-empty description.');
    }

    this.name = normalizedName;
    this.type = normalizedType;
    this.value = normalizedValue;
    this.hiddenFromPlayer = hiddenFromPlayer === true;
    this.lastUpdatedWorldMinute = normalizeWorldMinute(
      lastUpdatedWorldMinute,
      'lastUpdatedWorldMinute'
    );
    this.description = normalizedDescription;
    this.note = normalizeNote(note);
    this.countdownUntilWorldMinute = null;
    if (normalizedType === 'countdown') {
      if (countdownUntilWorldMinute !== undefined && countdownUntilWorldMinute !== null) {
        this.countdownUntilWorldMinute = normalizeOptionalWorldMinute(
          countdownUntilWorldMinute,
          'countdownUntilWorldMinute'
        );
      } else {
        this.countdownUntilWorldMinute = resolveCountdownUntilWorldMinute(normalizedValue, {
          currentWorldMinute: this.lastUpdatedWorldMinute
        });
      }
    }
    this.updatedAt = new Date().toISOString();
    return this;
  }

  displayValue({ formatCountdownValue } = {}) {
    if (this.type === 'countdown' && Number.isInteger(this.countdownUntilWorldMinute)) {
      if (typeof formatCountdownValue === 'function') {
        const formatted = normalizeText(formatCountdownValue(this.countdownUntilWorldMinute));
        if (formatted) {
          return formatted;
        }
      }
    }
    return this.value;
  }

  toPromptContext({ formatLastUpdated, formatCountdownValue } = {}) {
    const lastUpdated = typeof formatLastUpdated === 'function'
      ? normalizeText(formatLastUpdated(this.lastUpdatedWorldMinute)) || 'unknown'
      : `${this.lastUpdatedWorldMinute} minutes from game start`;
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      value: this.displayValue({ formatCountdownValue }),
      rawValue: this.value,
      hidden: this.hiddenFromPlayer,
      hiddenFromPlayer: this.hiddenFromPlayer,
      lastUpdated,
      lastUpdatedWorldMinute: this.lastUpdatedWorldMinute,
      countdownUntilWorldMinute: this.countdownUntilWorldMinute,
      guidance: this.description,
      note: this.note
    };
  }

  toClientJSON({ formatLastUpdated, formatCountdownValue } = {}) {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      value: this.displayValue({ formatCountdownValue }),
      rawValue: this.value,
      description: this.description,
      note: this.note,
      hiddenFromPlayer: this.hiddenFromPlayer,
      lastUpdated: typeof formatLastUpdated === 'function'
        ? normalizeText(formatLastUpdated(this.lastUpdatedWorldMinute)) || 'unknown'
        : `${this.lastUpdatedWorldMinute} minutes from game start`,
      lastUpdatedWorldMinute: this.lastUpdatedWorldMinute,
      countdownUntilWorldMinute: this.countdownUntilWorldMinute
    };
  }

  toPromptLine(options = {}) {
    const context = this.toPromptContext(options);
    return [
      context.id,
      context.name,
      `type=${context.type}`,
      `value=${context.value}`,
      `hidden=${context.hidden}`,
      `lastUpdated=${context.lastUpdated}`,
      `guidance=${context.guidance}`,
      `note=${context.note}`
    ].join(' | ');
  }

  toJSON() {
    const data = {
      id: this.id,
      name: this.name,
      type: this.type,
      value: this.value,
      hiddenFromPlayer: this.hiddenFromPlayer,
      lastUpdatedWorldMinute: this.lastUpdatedWorldMinute,
      description: this.description,
      note: this.note,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
    if (this.type === 'countdown') {
      data.countdownUntilWorldMinute = this.countdownUntilWorldMinute;
    }
    return clonePlain(data);
  }
}

module.exports = Tracker;
