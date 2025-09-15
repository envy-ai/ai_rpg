document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('newGameForm');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');

  function showOverlay() {
    overlay.classList.add('show');
    overlay.setAttribute('aria-busy', 'true');
    document.body.style.pointerEvents = 'none';
  }

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-busy', 'false');
    document.body.style.pointerEvents = '';
  }

  function setFormEnabled(enabled) {
    Array.from(form.elements).forEach(el => {
      el.disabled = !enabled;
    });
    startBtn.disabled = !enabled;
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const playerName = (document.getElementById('playerName')?.value || '').trim();
      const playerDescription = (document.getElementById('playerDescription')?.value || '').trim();
      const startingLocation = (document.getElementById('startingLocation')?.value || '').trim();

      try {
        setFormEnabled(false);
        showOverlay();
        if (window.disableNavigationGuard) window.disableNavigationGuard(true);

        const response = await fetch('/api/new-game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName, playerDescription, startingLocation })
        });

        const result = await response.json();

        if (!response.ok || !result?.success) {
          const errMsg = result?.error || `Server error (${response.status})`;
          alert(`New game creation failed: ${errMsg}`);
          hideOverlay();
          setFormEnabled(true);
          if (window.disableNavigationGuard) window.disableNavigationGuard(false);
          return;
        }

        // Success → disable guard then redirect back to chat
        if (window.disableNavigationGuard) window.disableNavigationGuard(false);
        window.location.assign('/');
      } catch (err) {
        alert(`New game creation failed: ${err?.message || err}`);
        hideOverlay();
        setFormEnabled(true);
        if (window.disableNavigationGuard) window.disableNavigationGuard(false);
      }
    });
  }
});
