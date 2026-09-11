const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDuplicateName,
  normalizePersonNameForDuplicateCheck
} = require('../DuplicateNameUtils.js');

test('normalizeDuplicateName omits one leading the after whitespace normalization', () => {
  assert.equal(normalizeDuplicateName('  The   Sunken Archive  '), 'sunken archive');
  assert.equal(normalizeDuplicateName('Sunken Archive'), 'sunken archive');
  assert.equal(normalizeDuplicateName('The'), 'the');
  assert.equal(normalizeDuplicateName('Theodore'), 'theodore');
});

test('normalizePersonNameForDuplicateCheck retains punctuation-insensitive matching', () => {
  assert.equal(normalizePersonNameForDuplicateCheck("The Warden's Hand"), 'warden s hand');
  assert.equal(normalizePersonNameForDuplicateCheck("Warden's Hand"), 'warden s hand');
});
