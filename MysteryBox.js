const IdGenerator = require('./IdGenerator.js');

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

function clonePlain(value) {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeResolved(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new Error('MysteryBox resolved must be a boolean.');
  }
  return value;
}

class MysteryBox {
  static #instances = new Map();
  static #indexByKey = new Map();

  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('MysteryBox constructor requires an options object.');
    }

    const name = normalizeText(options.name);
    if (!name) {
      throw new Error('MysteryBox requires a non-empty name.');
    }

    const id = normalizeText(options.id) || IdGenerator.next('mysteryBox');
    this.id = id;
    this.name = name;
    this.keys = MysteryBox.#normalizeKeys([name, ...(Array.isArray(options.keys) ? options.keys : [])]);
    this.text = normalizeText(options.text);
    this.resolved = normalizeResolved(options.resolved);
    this.mentions = MysteryBox.#normalizeMentions(options.mentions);
    this.createdAt = normalizeText(options.createdAt) || new Date().toISOString();
    this.updatedAt = normalizeText(options.updatedAt) || this.createdAt;

    IdGenerator.register('mysteryBox', id);
    MysteryBox.#register(this);
  }

  static clear() {
    MysteryBox.#instances.clear();
    MysteryBox.#indexByKey.clear();
  }

  static getAll() {
    return Array.from(MysteryBox.#instances.values());
  }

  static getById(id) {
    const normalizedId = normalizeText(id);
    return normalizedId ? MysteryBox.#instances.get(normalizedId) || null : null;
  }

  static getByKey(key) {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return null;
    }
    const id = MysteryBox.#indexByKey.get(normalized);
    return id ? MysteryBox.getById(id) : null;
  }

  static findByNameOrKey(query) {
    const normalizedQuery = normalizeKey(query);
    if (!normalizedQuery) {
      return [];
    }
    const queryTerms = normalizedQuery.split(' ').filter(Boolean);
    return MysteryBox.getAll().filter((box) => {
      const values = [box.id, box.name, ...box.keys]
        .map((value) => normalizeKey(value))
        .filter(Boolean);
      return values.some((value) => (
        value === normalizedQuery
        || value.includes(normalizedQuery)
        || queryTerms.every((term) => value.includes(term))
      ));
    });
  }

  static listBySearchPhrase(query = '') {
    const normalizedQuery = normalizeKey(query);
    const boxes = MysteryBox.getAll();
    if (!normalizedQuery) {
      return boxes;
    }
    return boxes.filter((box) => {
      const values = [box.id, box.name, ...box.keys, box.text]
        .map((value) => normalizeKey(value))
        .filter(Boolean);
      return values.some((value) => value.includes(normalizedQuery));
    });
  }

  static fromJSON(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('MysteryBox.fromJSON requires an object payload.');
    }
    return new MysteryBox(payload);
  }

  static serializeAll() {
    return Object.fromEntries(
      MysteryBox.getAll().map((box) => [box.id, box.toJSON()])
    );
  }

  static loadAll(payload = {}) {
    MysteryBox.clear();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('MysteryBox.loadAll requires an object map.');
    }
    for (const entry of Object.values(payload)) {
      MysteryBox.fromJSON(entry);
    }
  }

  applyUpdate({ name = null, keys = [], text = null, mention = null } = {}) {
    const normalizedName = normalizeText(name);
    if (normalizedName) {
      this.name = normalizedName;
    }

    this.keys = MysteryBox.#normalizeKeys([
      this.name,
      ...this.keys,
      ...(Array.isArray(keys) ? keys : [])
    ]);

    if (typeof text === 'string') {
      const normalizedText = text.trim();
      if (normalizedText) {
        this.text = normalizedText;
      }
    }

    const normalizedMention = MysteryBox.#normalizeMention(mention);
    if (normalizedMention) {
      this.mentions.push(normalizedMention);
    }

    this.updatedAt = new Date().toISOString();
    MysteryBox.#register(this);
    return this;
  }

  applyManualEdit({ name, keys = [], text = null } = {}) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      throw new Error('MysteryBox manual edit requires a non-empty name.');
    }
    if (!Array.isArray(keys)) {
      throw new Error('MysteryBox manual edit keys must be an array.');
    }

    this.name = normalizedName;
    this.keys = MysteryBox.#normalizeKeys([this.name, ...keys]);

    if (text !== null && text !== undefined) {
      if (typeof text !== 'string') {
        throw new Error('MysteryBox manual edit text must be a string.');
      }
      this.text = normalizeText(text);
    }

    this.updatedAt = new Date().toISOString();
    MysteryBox.#register(this);
    return this;
  }

  markResolved() {
    this.resolved = true;
    this.updatedAt = new Date().toISOString();
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      keys: [...this.keys],
      text: this.text,
      resolved: this.resolved,
      mentions: clonePlain(this.mentions) || [],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static #register(box) {
    for (const [key, id] of MysteryBox.#indexByKey.entries()) {
      if (id === box.id) {
        MysteryBox.#indexByKey.delete(key);
      }
    }
    MysteryBox.#instances.set(box.id, box);
    for (const key of box.keys) {
      const normalized = normalizeKey(key);
      if (normalized) {
        MysteryBox.#indexByKey.set(normalized, box.id);
      }
    }
  }

  static #normalizeKeys(values) {
    const keys = [];
    const seen = new Set();
    for (const value of values) {
      const text = normalizeText(value);
      const normalized = normalizeKey(text);
      if (!text || !normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      keys.push(text);
    }
    return keys;
  }

  static #normalizeMentions(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => MysteryBox.#normalizeMention(entry)).filter(Boolean);
  }

  static #normalizeMention(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const name = normalizeText(value.name);
    const context = normalizeText(value.context);
    if (!name && !context) {
      return null;
    }
    const mention = {};
    if (name) {
      mention.name = name;
    }
    if (context) {
      mention.context = context;
    }
    const sourceEntryId = normalizeText(value.sourceEntryId);
    if (sourceEntryId) {
      mention.sourceEntryId = sourceEntryId;
    }
    if (value.worldTime && typeof value.worldTime === 'object' && !Array.isArray(value.worldTime)) {
      mention.worldTime = clonePlain(value.worldTime);
    }
    const createdAt = normalizeText(value.createdAt);
    mention.createdAt = createdAt || new Date().toISOString();
    return mention;
  }
}

module.exports = MysteryBox;
