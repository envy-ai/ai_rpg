document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('newGameForm');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const numSkillsField = document.getElementById('numSkills');
  const startingCurrencyField = document.getElementById('startingCurrency');
  const classSelect = document.getElementById('playerClassSelect');
  const classOtherInput = document.getElementById('playerClassOther');
  const raceSelect = document.getElementById('playerRaceSelect');
  const raceOtherInput = document.getElementById('playerRaceOther');
  const otherSelectUpdaters = [];

  const defaultNumSkills = (() => {
    if (!numSkillsField) {
      return 20;
    }
    const datasetValue = Number.parseInt(numSkillsField.dataset?.defaultValue ?? '', 10);
    if (Number.isFinite(datasetValue)) {
      return Math.max(1, Math.min(100, datasetValue));
    }
    const fieldValue = Number.parseInt(numSkillsField.value ?? '', 10);
    return Number.isFinite(fieldValue) ? Math.max(1, Math.min(100, fieldValue)) : 20;
  })();

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
    otherSelectUpdaters.forEach(fn => fn());
  }

  const setupOtherSelect = (selectEl, otherEl) => {
    if (!selectEl || !otherEl) {
      return;
    }

    const update = () => {
      const isOther = selectEl.value === '__other';
      otherEl.style.display = isOther ? 'block' : 'none';
      otherEl.disabled = !isOther;
      if (isOther && !otherEl.value) {
        otherEl.focus();
      }
    };

    selectEl.addEventListener('change', update);
    update();
    otherSelectUpdaters.push(update);
  };

  const resolveSelectionValue = (selectEl, otherEl) => {
    if (!selectEl) {
      return '';
    }
    const selected = selectEl.value || '';
    if (selected === '__other') {
      const otherValue = otherEl ? otherEl.value || '' : '';
      return otherValue.trim();
    }
    return selected.trim();
  };

  setupOtherSelect(classSelect, classOtherInput);
  setupOtherSelect(raceSelect, raceOtherInput);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const playerName = (document.getElementById('playerName')?.value || '').trim();
      const playerDescription = (document.getElementById('playerDescription')?.value || '').trim();
      const startingLocation = (document.getElementById('startingLocation')?.value || '').trim();
      const numSkillsRaw = (numSkillsField?.value || '').trim();
      const parsedNumSkills = Number.parseInt(numSkillsRaw, 10);
      const resolvedNumSkills = Number.isFinite(parsedNumSkills) ? parsedNumSkills : defaultNumSkills;
      const numSkills = Math.max(1, Math.min(100, resolvedNumSkills));
      const existingSkillsRaw = document.getElementById('existingSkills')?.value || '';
      const existingSkills = existingSkillsRaw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
      const playerClass = resolveSelectionValue(classSelect, classOtherInput);
      const playerRace = resolveSelectionValue(raceSelect, raceOtherInput);
      const startingCurrencyRaw = (startingCurrencyField?.value || '').trim();
      const parsedStartingCurrency = Number.parseInt(startingCurrencyRaw, 10);
      const fallbackStartingCurrency = Number.parseInt(startingCurrencyField?.dataset?.defaultValue ?? '', 10);
      const safeFallbackCurrency = Number.isFinite(fallbackStartingCurrency)
        ? Math.max(0, fallbackStartingCurrency)
        : 0;
      const startingCurrency = Number.isFinite(parsedStartingCurrency)
        ? Math.max(0, parsedStartingCurrency)
        : safeFallbackCurrency;

      try {
        setFormEnabled(false);
        showOverlay();
        if (window.disableNavigationGuard) window.disableNavigationGuard(true);

        const response = await fetch('/api/new-game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerName,
            playerDescription,
            playerClass,
            playerRace,
            startingLocation,
            numSkills,
            existingSkills,
            startingCurrency
          })
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
