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
  const overlayText = overlay ? overlay.querySelector('.overlay-text') : null;
  const spinnerDefaultText = overlayText && overlayText.textContent.trim()
    ? overlayText.textContent.trim()
    : 'Creating your adventure...';

  const stageMessages = {
    'new_game:start': 'Preparing your adventure...',
    'new_game:reset': 'Clearing previous game state...',
    'new_game:reset_complete': 'Game state cleared. Preparing skills...',
    'new_game:skills_existing': 'Integrating existing skills...',
    'new_game:skills_generate': 'Generating new skills...',
    'new_game:skills_ready': 'Skill library ready. Forging your hero...',
    'new_game:player_created': 'Forging your hero...',
    'new_game:region': 'Generating starting region...',
    'new_game:region_prepare': 'Preparing region prompt...',
    'new_game:region_request': 'Requesting region layout...',
    'new_game:region_response': 'Region layout received.',
    'new_game:region_parse': 'Interpreting region blueprint...',
    'new_game:region_instantiate': 'Placing region locations...',
    'new_game:region_entrance': 'Selecting starting entrance...',
    'new_game:region_npcs': 'Populating region with NPCs...',
    'new_game:region_complete': 'Region ready. Finalizing touches...',
    'new_game:location_detail': 'Detailing starting location...',
    'new_game:inventory': 'Outfitting your character...',
    'new_game:abilities': 'Discovering unique abilities...',
    'new_game:finalizing': 'Finalizing world setup...',
    'new_game:complete': 'Adventure ready! Redirecting...',
    'new_game:error': 'Failed to create new game.'
  };

  const realtimeState = {
    clientId: loadClientId(),
    ws: null,
    reconnectTimer: null,
    reconnectDelay: 1000,
    activeRequestId: null,
    connected: false
  };

  window.AIRPG_CLIENT_ID = realtimeState.clientId;

  function setOverlayText(text) {
    if (overlayText) {
      overlayText.textContent = text || spinnerDefaultText;
    }
  }

  function loadClientId() {
    const storageKey = 'airpg:clientId';
    try {
      const existing = window.localStorage.getItem(storageKey);
      if (existing && existing.length > 0) {
        return existing;
      }
    } catch (_) {
      // Ignore storage read errors
    }
    const generated = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      window.localStorage.setItem('airpg:clientId', generated);
    } catch (_) {
      // Ignore storage write errors
    }
    return generated;
  }

  function generateRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function scheduleWebSocketReconnect() {
    if (realtimeState.reconnectTimer) {
      return;
    }
    realtimeState.reconnectDelay = Math.min(realtimeState.reconnectDelay * 2, 15000);
    realtimeState.reconnectTimer = window.setTimeout(() => {
      realtimeState.reconnectTimer = null;
      connectWebSocket();
    }, realtimeState.reconnectDelay);
  }

  function handleConnectionAck(payload) {
    if (!payload || !payload.clientId) {
      return;
    }
    const assignedClientId = payload.clientId;
    const changed = assignedClientId && assignedClientId !== realtimeState.clientId;
    if (assignedClientId) {
      realtimeState.clientId = assignedClientId;
      window.AIRPG_CLIENT_ID = assignedClientId;
      if (changed) {
        try {
          window.localStorage.setItem('airpg:clientId', assignedClientId);
        } catch (_) {
          // Ignore storage errors
        }
      }
    }
    realtimeState.connected = true;
    realtimeState.reconnectDelay = 1000;
    if (realtimeState.reconnectTimer) {
      window.clearTimeout(realtimeState.reconnectTimer);
      realtimeState.reconnectTimer = null;
    }
  }

  function handleNewGameStatus(payload) {
    if (!payload || payload.scope !== 'new_game') {
      return;
    }
    if (realtimeState.activeRequestId && payload.requestId && payload.requestId !== realtimeState.activeRequestId) {
      return;
    }
    const stage = payload.stage || '';
    const message = payload.message || stageMessages[stage] || spinnerDefaultText;
    setOverlayText(message);
  }

  function handleWebSocketMessage(event) {
    if (!event || typeof event.data !== 'string') {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch (error) {
      console.warn('Realtime payload parse error:', error.message);
      return;
    }
    if (!payload || !payload.type) {
      return;
    }
    switch (payload.type) {
      case 'connection_ack':
        handleConnectionAck(payload);
        break;
      case 'chat_status':
        handleNewGameStatus(payload);
        break;
      case 'chat_error':
        if (payload.scope === 'new_game') {
          const message = payload.message || 'An error occurred while starting the game.';
          setOverlayText(message);
        }
        break;
      default:
        break;
    }
  }

  function connectWebSocket(delay = 0) {
    if (delay > 0) {
      window.setTimeout(() => connectWebSocket(0), delay);
      return;
    }

    if (realtimeState.reconnectTimer) {
      window.clearTimeout(realtimeState.reconnectTimer);
      realtimeState.reconnectTimer = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/ws?clientId=${encodeURIComponent(realtimeState.clientId)}`;

    try {
      if (realtimeState.ws && realtimeState.ws.readyState === WebSocket.OPEN) {
        realtimeState.ws.close();
      }

      const socket = new WebSocket(url);
      realtimeState.ws = socket;
      realtimeState.connected = false;

      socket.addEventListener('open', () => {
        realtimeState.connected = true;
        realtimeState.reconnectDelay = 1000;
        if (realtimeState.reconnectTimer) {
          window.clearTimeout(realtimeState.reconnectTimer);
          realtimeState.reconnectTimer = null;
        }
      });
      socket.addEventListener('message', handleWebSocketMessage);
      socket.addEventListener('close', () => {
        realtimeState.connected = false;
        scheduleWebSocketReconnect();
      });
      socket.addEventListener('error', () => {
        realtimeState.connected = false;
        scheduleWebSocketReconnect();
      });
    } catch (error) {
      console.warn('Failed to establish realtime connection:', error.message);
      scheduleWebSocketReconnect();
    }
  }

  connectWebSocket();


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
    setOverlayText(stageMessages['new_game:start']);
  }

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-busy', 'false');
    document.body.style.pointerEvents = '';
    setOverlayText(spinnerDefaultText);
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

        const requestId = generateRequestId();
        realtimeState.activeRequestId = requestId;

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
            startingCurrency,
            clientId: realtimeState.clientId,
            requestId
          })
        });

        const result = await response.json();

        if (!response.ok || !result?.success) {
          const errMsg = result?.error || `Server error (${response.status})`;
          alert(`New game creation failed: ${errMsg}`);
          realtimeState.activeRequestId = null;
          hideOverlay();
          setFormEnabled(true);
          if (window.disableNavigationGuard) window.disableNavigationGuard(false);
          return;
        }

        // Success → disable guard then redirect back to chat
        if (window.disableNavigationGuard) window.disableNavigationGuard(false);
        realtimeState.activeRequestId = null;
        window.location.assign('/');
      } catch (err) {
        alert(`New game creation failed: ${err?.message || err}`);
        realtimeState.activeRequestId = null;
        hideOverlay();
        setFormEnabled(true);
        if (window.disableNavigationGuard) window.disableNavigationGuard(false);
      }
    });
  }
});
