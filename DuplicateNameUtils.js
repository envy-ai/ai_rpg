function omitLeadingThe(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/^the\s+/i, '');
}

function normalizeDuplicateName(value, { ignorePunctuation = false } = {}) {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = (ignorePunctuation
    ? value.replace(/[^\w\s]|_/g, ' ')
    : value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return omitLeadingThe(normalized);
}

function normalizePersonNameForDuplicateCheck(value) {
  return normalizeDuplicateName(value, { ignorePunctuation: true });
}

module.exports = {
  normalizeDuplicateName,
  normalizePersonNameForDuplicateCheck,
  omitLeadingThe
};
