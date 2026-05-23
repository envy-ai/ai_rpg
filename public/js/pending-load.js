(function () {
  let pendingLoadInProgress = false;

  async function getPendingLoadIntent() {
    const response = await fetch('/api/pending-load', { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
      return null;
    }
    return data.pendingLoad || null;
  }

  async function clearPendingLoadIntent() {
    await fetch('/api/pending-load', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});
  }

  async function loadPendingGame(intent) {
    if (pendingLoadInProgress || !intent?.saveName) {
      return;
    }
    pendingLoadInProgress = true;
    const clientId = window.AIRPG_CLIENT_ID
      || (window.localStorage ? window.localStorage.getItem('airpg:clientId') : null);
    try {
      const response = await fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saveName: intent.saveName,
          saveType: intent.saveType === 'autosaves' ? 'autosaves' : 'saves',
          clientId,
          fromPendingLoad: true
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      await clearPendingLoadIntent();
      window.location.href = '/#tab-adventure';
      window.location.reload();
    } catch (error) {
      pendingLoadInProgress = false;
      window.alert(`Pending save load failed: ${error.message || error}`);
    }
  }

  async function checkPendingLoad() {
    const intent = await getPendingLoadIntent();
    if (!intent) {
      return;
    }
    if (window.location.pathname !== '/') {
      window.location.href = '/?pendingLoad=1#tab-adventure';
      return;
    }
    await loadPendingGame(intent);
  }

  window.AIRPG_PENDING_LOAD = {
    check: checkPendingLoad,
    get: getPendingLoadIntent,
    load: loadPendingGame
  };

  window.addEventListener('DOMContentLoaded', () => {
    checkPendingLoad().catch(error => {
      console.warn('Failed to check pending load intent:', error);
    });
  });
})();
