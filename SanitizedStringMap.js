const sanitizeString = require('./sanitizeString.js');

class SanitizedStringMap extends Map {
  static #sanitizeKey(key) {
    if (typeof key !== 'string') {
      throw new TypeError('SanitizedStringMap only accepts string keys.');
    }
    return sanitizeString(key);
  }

  set(key, value) {
    const sanitized = SanitizedStringMap.#sanitizeKey(key);
    return super.set(sanitized, value);
  }

  get(key) {
    const sanitized = SanitizedStringMap.#sanitizeKey(key);
    return super.get(sanitized);
  }

  has(key) {
    const sanitized = SanitizedStringMap.#sanitizeKey(key);
    return super.has(sanitized);
  }

  delete(key) {
    const sanitized = SanitizedStringMap.#sanitizeKey(key);
    return super.delete(sanitized);
  }
}

module.exports = SanitizedStringMap;
