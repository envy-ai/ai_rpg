(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CurrencyUtils = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  function normalizeName(value, fallback) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return fallback !== undefined ? fallback : null;
  }

  function extractSetting(options) {
    if (!options || typeof options !== 'object') {
      return null;
    }
    if (options.setting && typeof options.setting === 'object') {
      return options.setting;
    }
    if (typeof options.currencyName === 'string' || typeof options.currencyNamePlural === 'string') {
      return options;
    }
    return null;
  }

  function resolvePlural(singular, plural) {
    if (plural) {
      return plural;
    }
    if (!singular) {
      return 'coins';
    }
    if (/s$/i.test(singular)) {
      return `${singular}es`;
    }
    return `${singular}s`;
  }

  function getCurrencyLabel(amount, options = {}) {
    const setting = extractSetting(options) || {};
    const singular = normalizeName(options.singular, normalizeName(setting.currencyName, 'coin'));
    const plural = normalizeName(options.plural, normalizeName(setting.currencyNamePlural, null));

    const resolvedSingular = singular || 'coin';
    const resolvedPlural = resolvePlural(resolvedSingular, plural);

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
      return resolvedPlural;
    }
    return Math.abs(numericAmount) === 1 ? resolvedSingular : resolvedPlural;
  }

  return {
    getCurrencyLabel
  };
});
