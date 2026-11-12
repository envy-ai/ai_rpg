class IdGenerator {
  static nextSequential(category) {
    return require('./OperationalIdAllocator.js').getOperationalIdAllocator().next(category);
  }

  static reserveSequential(category, count) {
    return require('./OperationalIdAllocator.js').getOperationalIdAllocator().reserve(category, count);
  }

  static registerSequential(id) {
    require('./OperationalIdAllocator.js').getOperationalIdAllocator().register(id);
  }

  static discardSequentialRanges() {
    require('./OperationalIdAllocator.js').getOperationalIdAllocator().discardRanges();
  }

  static #prefixes = new Map([
    ['character', 'char'],
    ['char', 'char'],
    ['player', 'char'],
    ['npc', 'char'],
    ['thing', 'thing'],
    ['item', 'thing'],
    ['itemDefinition', 'itemdef'],
    ['itemdef', 'itemdef'],
    ['itemFamily', 'itemfamily'],
    ['itemfamily', 'itemfamily'],
    ['location', 'loc'],
    ['loc', 'loc'],
    ['exit', 'exit'],
    ['locationExit', 'exit'],
    ['region', 'region'],
    ['faction', 'faction'],
    ['mysteryBox', 'mystery'],
    ['mystery', 'mystery'],
    ['mysteryThread', 'mthread'],
    ['mthread', 'mthread'],
    ['scheduledEvent', 'sevent'],
    ['sevent', 'sevent'],
    ['tracker', 'tracker'],
    ['trackers', 'tracker'],
    ['quest', 'quest'],
    ['objective', 'obj'],
    ['obj', 'obj'],
    ['status', 'status'],
    ['statusEffect', 'status'],
    ['ability', 'ability'],
    ['technique', 'technique'],
    ['discipline', 'discipline'],
    ['techniqueGrant', 'tgrant'],
    ['tgrant', 'tgrant'],
    ['summonTemplate', 'stemplate'],
    ['stemplate', 'stemplate']
  ]);

  static #counters = new Map();
  static #usedIds = new Map();
  static #namedIds = new Map();
  static #namedCounters = new Map();

  static normalizeName(name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Named ID title must be nonempty text.');
    const normalized = name.trim().normalize('NFC').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
    if (!normalized) throw new Error(`Named ID title "${name}" has no alphanumeric characters. Supply a title containing letters or numbers.`);
    return normalized;
  }

  static nextNamed(type, name) {
    const prefix = IdGenerator.#normalizeType(type);
    const normalized = IdGenerator.normalizeName(name);
    const key = `${prefix}:${normalized}`;
    if (IdGenerator.#namedIds.has(key)) return IdGenerator.#namedIds.get(key);
    const id = IdGenerator.next(type, name);
    IdGenerator.#namedIds.set(key, id);
    return id;
  }

  static nextUniqueNamed(type, name) {
    return IdGenerator.next(type, name);
  }

  static normalizeStem(name) {
    // Select source words before snake normalization so internal apostrophes
    // do not consume an extra word (for example, Fizz's Sparkle Energy).
    IdGenerator.normalizeName(name);
    const words = name.normalize('NFC').match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
    return IdGenerator.normalizeName(words.slice(0, 3).join(' '));
  }

  static #historicallyReserved(prefix, id) {
    const counter = IdGenerator.#extractCounter(prefix, id);
    if (counter !== null && counter <= (IdGenerator.#counters.get(prefix) || 0)) return true;
    const stem = id.slice(prefix.length + 1);
    const counters = IdGenerator.#namedCounters.get(prefix);
    if (!counters) return false;
    if ((counters.get(stem) || 0) >= 1) return true;
    const suffixed = stem.match(/^(.*)_([1-9]\d*)$/u);
    if (!suffixed) return false;
    const ordinal = Number(suffixed[2]);
    return ordinal >= 2 && ordinal <= (counters.get(suffixed[1]) || 0);
  }

  static next(type, name) {
    const prefix = IdGenerator.#normalizeType(type);
    const stem = IdGenerator.normalizeStem(name);
    const baseId = `${prefix}_${stem}`;
    const used = IdGenerator.#getUsedSet(prefix);
    let counters = IdGenerator.#namedCounters.get(prefix);
    if (!counters) {
      counters = new Map();
      IdGenerator.#namedCounters.set(prefix, counters);
    }
    let ordinal = (counters.get(stem) || 0) + 1;
    if (!Number.isSafeInteger(ordinal)) throw new Error(`ID suffix counter exhausted for ${baseId}.`);
    let id = ordinal === 1 ? baseId : `${baseId}_${ordinal}`;
    while (used.has(id) || IdGenerator.#historicallyReserved(prefix, id)) {
      ordinal += 1;
      if (!Number.isSafeInteger(ordinal)) throw new Error(`ID suffix counter exhausted for ${baseId}.`);
      id = `${baseId}_${ordinal}`;
    }
    counters.set(stem, ordinal);
    IdGenerator.register(type, id);
    return id;
  }

  static #normalizeType(type) {
    if (typeof type !== 'string' || !type.trim()) {
      throw new Error('IdGenerator requires a non-empty object type.');
    }
    const key = type.trim();
    const prefix = IdGenerator.#prefixes.get(key);
    if (!prefix) {
      throw new Error(`Unknown ID object type: ${type}`);
    }
    return prefix;
  }

  static #getUsedSet(prefix) {
    let set = IdGenerator.#usedIds.get(prefix);
    if (!set) {
      set = new Set();
      IdGenerator.#usedIds.set(prefix, set);
    }
    return set;
  }

  static #extractCounter(prefix, id) {
    if (typeof id !== 'string') {
      return null;
    }
    const match = id.match(new RegExp(`^${prefix}_(\\d+)$`));
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  static register(type, id) {
    const prefix = IdGenerator.#normalizeType(type);
    if (typeof id !== 'string' || !id.trim()) {
      return;
    }
    const normalized = id.trim();
    IdGenerator.#getUsedSet(prefix).add(normalized);
    const counter = IdGenerator.#extractCounter(prefix, normalized);
    if (counter !== null) {
      IdGenerator.#counters.set(prefix, Math.max(IdGenerator.#counters.get(prefix) || 0, counter));
      IdGenerator.registerSequential(normalized);
    } else if (normalized.startsWith(`${prefix}_`) && !IdGenerator.#historicallyReserved(prefix, normalized)) {
      const stem = normalized.slice(prefix.length + 1);
      if (stem && /^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$/u.test(stem) && stem.normalize('NFC').toLowerCase() === stem) {
        let counters = IdGenerator.#namedCounters.get(prefix);
        if (!counters) { counters = new Map(); IdGenerator.#namedCounters.set(prefix, counters); }
        // A supplied suffix may also be a natural name. Reserve its exact
        // spelling without consuming the unsuffixed name's earlier ordinals.
        counters.set(stem, Math.max(counters.get(stem) || 0, 1));
      }
    }
  }

  static seedCounters(counters = {}) {
    if (!counters || typeof counters !== 'object' || Array.isArray(counters)) {
      return;
    }
    for (const [rawType, rawValue] of Object.entries(counters)) {
      const prefix = IdGenerator.#normalizeType(rawType);
      const value = Number(rawValue);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid ID counter for ${rawType}: ${rawValue}`);
      }
      IdGenerator.#counters.set(prefix, Math.max(IdGenerator.#counters.get(prefix) || 0, value));
      if (value > 0) IdGenerator.registerSequential(`${prefix}_${value}`);
    }
  }

  static snapshotCounters() {
    const counters = {};
    const prefixes = [...new Set(IdGenerator.#prefixes.values())];
    for (const prefix of prefixes) {
      const value = IdGenerator.#counters.get(prefix);
      if (Number.isInteger(value) && value > 0) {
        counters[prefix] = value;
      }
    }
    return counters;
  }

  static seedNamedCounters(counters = {}) {
    if (!counters || typeof counters !== 'object' || Array.isArray(counters)) throw new TypeError('metadata.idNameCounters must be an object keyed by ID prefix.');
    for (const [rawType, stems] of Object.entries(counters)) {
      const prefix = IdGenerator.#normalizeType(rawType);
      if (!stems || typeof stems !== 'object' || Array.isArray(stems)) throw new TypeError(`metadata.idNameCounters.${rawType} must be an object of normalized stems and positive integer counters.`);
      let values = IdGenerator.#namedCounters.get(prefix);
      if (!values) { values = new Map(); IdGenerator.#namedCounters.set(prefix, values); }
      for (const [stem, ordinal] of Object.entries(stems)) {
        if (!stem || !/^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$/u.test(stem) || stem.normalize('NFC').toLowerCase() !== stem) throw new Error(`metadata.idNameCounters.${rawType}.${stem}: Stem must be normalized lowercase snake_case text containing letters or numbers.`);
        if (!Number.isSafeInteger(ordinal) || ordinal < 1) throw new Error(`metadata.idNameCounters.${rawType}.${stem}: Counter must be a positive safe integer; restore the last valid allocator metadata.`);
        values.set(stem, Math.max(values.get(stem) || 0, ordinal));
      }
    }
  }

  static snapshotNamedCounters() {
    return Object.fromEntries([...IdGenerator.#namedCounters].filter(([, stems]) => stems.size).map(([prefix, stems]) => [prefix, Object.fromEntries(stems)]));
  }

  static withIsolatedState(callback) {
    if (typeof callback !== 'function' || callback.constructor.name === 'AsyncFunction') throw new TypeError('Isolated ID allocation requires a synchronous callback.');
    const original = [IdGenerator.#counters, IdGenerator.#usedIds, IdGenerator.#namedIds, IdGenerator.#namedCounters];
    IdGenerator.#counters = new Map();
    IdGenerator.#usedIds = new Map();
    IdGenerator.#namedIds = new Map();
    IdGenerator.#namedCounters = new Map();
    try {
      const result = callback();
      if (result && typeof result.then === 'function') throw new TypeError('Isolated ID allocation callback must not return a Promise.');
      return result;
    } finally {
      [IdGenerator.#counters, IdGenerator.#usedIds, IdGenerator.#namedIds, IdGenerator.#namedCounters] = original;
    }
  }

  static reset() {
    IdGenerator.#counters.clear();
    IdGenerator.#usedIds.clear();
    IdGenerator.#namedIds.clear();
    IdGenerator.#namedCounters.clear();
  }
}

module.exports = IdGenerator;
