(function() {
  if (!window.fitty || typeof window.fitty !== 'function') {
    console.warn('fitty not loaded, skipping title scaling');
    return;
  }

  const selectors = '.location-entity-name, .inventory-name';
  const options = {
    minSize: 10,
    maxSize: 18,
    multiLine: false
  };

  let instances = window.fitty(selectors, options);

  const refit = () => {
    if (!instances) {
      instances = window.fitty(selectors, options);
      return;
    }

    if (Array.isArray(instances)) {
      instances.forEach(instance => {
        try {
          instance.fit();
        } catch (error) {
          console.warn('fitty instance fit failed:', error);
        }
      });
    } else if (typeof instances.fit === 'function') {
      try {
        instances.fit();
      } catch (error) {
        console.warn('fitty instance fit failed:', error);
      }
    }
  };

  refit();

  document.addEventListener('inventory:updated', refit);
  document.addEventListener('location:updated', refit);
  document.addEventListener('DOMContentLoaded', refit);
})();
