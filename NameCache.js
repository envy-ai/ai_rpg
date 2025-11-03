class NameCache {
  static #cache = new Map();

  static get(race, gender) {
    const key = `${race}|${gender}`;
    return this.#cache.get(key) || new Set();
  }

  static removeName(name) {
    // Search through all keys and remove the name from the sets
    for (const [key, set] of this.#cache) {
      set.delete(name);
    }
  }

  static add(race, gender, name) {
    // If name is a string, add it.  If it's an array or set, add all names.
    if (Array.isArray(name) || name instanceof Set) {
      for (const n of name) {
        this.add(race, gender, n);
      }
    } else if (typeof name === 'string') {
      const key = `${race}|${gender}`;
      const set = this.#cache.get(key) || new Set();
      set.add(name);
      this.#cache.set(key, set);
    }
  }

  // Remove a name at random and return it.
  static pop(race, gender) {
    const key = `${race}|${gender}`;
    const set = this.#cache.get(key);
    if (set && set.size > 0) {
      const name = Array.from(set)[Math.floor(Math.random() * set.size)];
      set.delete(name);
      return name;
    }
    return null;
  }
}