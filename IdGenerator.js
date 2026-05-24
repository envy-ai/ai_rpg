class IdGenerator {
  static #prefixes = new Map([
    ['character', 'char'],
    ['char', 'char'],
    ['player', 'char'],
    ['npc', 'char'],
    ['thing', 'thing'],
    ['item', 'thing'],
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
    ['quest', 'quest'],
    ['objective', 'obj'],
    ['obj', 'obj'],
    ['status', 'status'],
    ['statusEffect', 'status']
  ]);

  static #counters = new Map();
  static #usedIds = new Map();

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

  static next(type) {
    const prefix = IdGenerator.#normalizeType(type);
    const used = IdGenerator.#getUsedSet(prefix);
    let nextValue = (IdGenerator.#counters.get(prefix) || 0) + 1;
    let id = `${prefix}_${nextValue}`;

    while (used.has(id)) {
      nextValue += 1;
      id = `${prefix}_${nextValue}`;
    }

    IdGenerator.#counters.set(prefix, nextValue);
    used.add(id);
    return id;
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

  static reset() {
    IdGenerator.#counters.clear();
    IdGenerator.#usedIds.clear();
  }
}

module.exports = IdGenerator;
