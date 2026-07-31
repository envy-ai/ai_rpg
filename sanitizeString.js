// Shared string sanitization: punctuation/underscores become spaces,
// whitespace collapses, then trim and lowercase.
// Callers are responsible for validating the input is a string.
const sanitizeString = (value) => value
  .replace(/[^\w\s]|_/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

module.exports = sanitizeString;
