class SanitizedStringSet extends Set {
  // Adds items after trimming, replacing punctuation with spaces, collapsing spaces, and converting to lowercase
  add(value) {
    if (typeof value === 'string') {
      const sanitized = value
        .trim()
        .replace(/[^\w\s]|_/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();
      super.add(sanitized);
    }
  }
  has(value) {
    if (typeof value === 'string') {
      const sanitized = value
        .trim()
        .replace(/[^\w\s]|_/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();
      return super.has(sanitized);
    }
    return false;
  }
  delete(value) {
    if (typeof value === 'string') {
      const sanitized = value
        .trim()
        .replace(/[^\w\s]|_/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();
      return super.delete(sanitized);
    }
    return false;
  }
}

module.exports = SanitizedStringSet;