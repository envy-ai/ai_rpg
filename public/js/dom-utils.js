(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DomUtils = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatHealthDisplayValue(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return null;
    }
    return Math.ceil(Math.max(0, numericValue));
  }

  function loadClientId() {
    const storageKey = 'airpg:clientId';
    try {
      const existing = window.localStorage.getItem(storageKey);
      if (existing && existing.length > 0) {
        return existing;
      }
    } catch (_) {
      // Ignore localStorage failures
    }
    const generated = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      window.localStorage.setItem(storageKey, generated);
    } catch (_) {
      // Ignore storage write errors
    }
    return generated;
  }

  return {
    escapeHtml,
    formatHealthDisplayValue,
    loadClientId
  };
});
