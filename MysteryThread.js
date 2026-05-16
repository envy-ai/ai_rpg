const IdGenerator = require('./IdGenerator.js');

const VALID_STATUSES = new Set(['active', 'inactive', 'concluded']);

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

function normalizeStringList(values, label) {
  if (values === null || values === undefined) {
    return [];
  }
  if (!Array.isArray(values)) {
    throw new Error(`MysteryThread ${label} must be an array.`);
  }

  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    const text = normalizeText(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function normalizeKeys(values) {
  const keys = [];
  const seen = new Set();
  for (const value of values) {
    const text = normalizeText(value);
    const key = normalizeKey(text);
    if (!text || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(text);
  }
  return keys;
}

function normalizeStatus(value) {
  const status = normalizeText(value) || 'inactive';
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`MysteryThread status must be one of: ${Array.from(VALID_STATUSES).join(', ')}.`);
  }
  return status;
}

class MysteryThread {
  static #instances = new Map();
  static #indexByKey = new Map();

  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new Error('MysteryThread constructor requires an options object.');
    }

    const name = normalizeText(options.name);
    if (!name) {
      throw new Error('MysteryThread requires a non-empty name.');
    }

    const id = normalizeText(options.id) || IdGenerator.next('mysteryThread');
    this.id = id;
    this.name = name;
    this.status = normalizeStatus(options.status);
    this.keys = normalizeKeys([name, ...(Array.isArray(options.keys) ? options.keys : [])]);
    this.summary = normalizeText(options.summary);
    this.constraints = normalizeStringList(options.constraints, 'constraints');
    this.boxIds = normalizeStringList(options.boxIds, 'boxIds');
    this.createdAt = normalizeText(options.createdAt) || new Date().toISOString();
    this.updatedAt = normalizeText(options.updatedAt) || this.createdAt;

    IdGenerator.register('mysteryThread', id);
    MysteryThread.#register(this);
  }

  static clear() {
    MysteryThread.#instances.clear();
    MysteryThread.#indexByKey.clear();
  }

  static getAll() {
    return Array.from(MysteryThread.#instances.values());
  }

  static getById(id) {
    const normalizedId = normalizeText(id);
    return normalizedId ? MysteryThread.#instances.get(normalizedId) || null : null;
  }

  static getByKey(key) {
    const normalized = normalizeKey(key);
    if (!normalized) {
      return null;
    }
    const id = MysteryThread.#indexByKey.get(normalized);
    return id ? MysteryThread.getById(id) : null;
  }

  static getContainingBox(boxId) {
    const normalizedId = normalizeText(boxId);
    if (!normalizedId) {
      return null;
    }
    return MysteryThread.getAll().find(thread => thread.boxIds.includes(normalizedId)) || null;
  }

  static getActive({ max = Infinity } = {}) {
    const active = MysteryThread.getAll().filter(thread => thread.status === 'active');
    if (max === Infinity) {
      return active;
    }
    const numericMax = Number(max);
    if (!Number.isInteger(numericMax) || numericMax < 0) {
      throw new Error('MysteryThread.getActive max must be an integer greater than or equal to 0.');
    }
    return active.slice(0, numericMax);
  }

  static findByNameOrKey(query) {
    const normalizedQuery = normalizeKey(query);
    if (!normalizedQuery) {
      return [];
    }
    const queryTerms = normalizedQuery.split(' ').filter(Boolean);
    return MysteryThread.getAll().filter((thread) => {
      const values = [thread.id, thread.name, ...thread.keys]
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
    const threads = MysteryThread.getAll();
    if (!normalizedQuery) {
      return threads;
    }
    return threads.filter((thread) => {
      const values = [
        thread.id,
        thread.name,
        thread.status,
        ...thread.keys,
        thread.summary,
        ...thread.constraints,
        ...thread.boxIds
      ].map((value) => normalizeKey(value)).filter(Boolean);
      return values.some((value) => value.includes(normalizedQuery));
    });
  }

  static fromJSON(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('MysteryThread.fromJSON requires an object payload.');
    }
    return new MysteryThread(payload);
  }

  static serializeAll() {
    return Object.fromEntries(
      MysteryThread.getAll().map((thread) => [thread.id, thread.toJSON()])
    );
  }

  static loadAll(payload = {}) {
    MysteryThread.clear();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('MysteryThread.loadAll requires an object map.');
    }
    for (const entry of Object.values(payload)) {
      MysteryThread.fromJSON(entry);
    }
  }

  static ensureLegacyThreadForBoxes(boxes = []) {
    const boxIds = boxes
      .map(box => normalizeText(typeof box === 'string' ? box : box?.id))
      .filter(Boolean);
    if (!boxIds.length || MysteryThread.getAll().length > 0) {
      return null;
    }
    return new MysteryThread({
      name: 'Legacy Mystery Boxes',
      status: 'inactive',
      summary: 'Mystery boxes loaded from an older save before mystery threads existed.',
      constraints: [],
      boxIds
    });
  }

  applyUpdate({
    name = null,
    keys = [],
    status = null,
    summary = null,
    constraints = null,
    boxId = null,
    boxIds = null
  } = {}) {
    const normalizedName = normalizeText(name);
    if (normalizedName) {
      this.name = normalizedName;
    }

    if (status !== null && status !== undefined) {
      this.status = normalizeStatus(status);
    }

    this.keys = normalizeKeys([
      this.name,
      ...this.keys,
      ...(Array.isArray(keys) ? keys : [])
    ]);

    if (typeof summary === 'string') {
      const normalizedSummary = normalizeText(summary);
      if (normalizedSummary) {
        this.summary = normalizedSummary;
      }
    }

    if (constraints !== null && constraints !== undefined) {
      this.constraints = normalizeStringList(constraints, 'constraints');
    }

    const nextBoxIds = [...this.boxIds];
    if (Array.isArray(boxIds)) {
      nextBoxIds.push(...boxIds);
    }
    const singleBoxId = normalizeText(boxId);
    if (singleBoxId) {
      nextBoxIds.push(singleBoxId);
    }
    this.boxIds = normalizeStringList(nextBoxIds, 'boxIds');

    this.updatedAt = new Date().toISOString();
    MysteryThread.#register(this);
    return this;
  }

  applyManualEdit({
    name,
    keys = [],
    status,
    summary = '',
    constraints = [],
    boxIds = []
  } = {}) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) {
      throw new Error('MysteryThread manual edit requires a non-empty name.');
    }
    if (!Array.isArray(keys)) {
      throw new Error('MysteryThread manual edit keys must be an array.');
    }

    this.name = normalizedName;
    this.status = normalizeStatus(status);
    this.keys = normalizeKeys([this.name, ...keys]);
    this.summary = normalizeText(summary);
    this.constraints = normalizeStringList(constraints, 'constraints');
    this.boxIds = normalizeStringList(boxIds, 'boxIds');
    this.updatedAt = new Date().toISOString();
    MysteryThread.#register(this);
    return this;
  }

  replaceBoxIds(boxIds = []) {
    this.boxIds = normalizeStringList(boxIds, 'boxIds');
    this.updatedAt = new Date().toISOString();
    MysteryThread.#register(this);
    return this;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      keys: [...this.keys],
      summary: this.summary,
      constraints: [...this.constraints],
      boxIds: [...this.boxIds],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  static #register(thread) {
    for (const [key, id] of MysteryThread.#indexByKey.entries()) {
      if (id === thread.id) {
        MysteryThread.#indexByKey.delete(key);
      }
    }
    MysteryThread.#instances.set(thread.id, thread);
    for (const key of thread.keys) {
      const normalized = normalizeKey(key);
      if (normalized) {
        MysteryThread.#indexByKey.set(normalized, thread.id);
      }
    }
  }
}

module.exports = MysteryThread;
