document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('newGameForm');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const saveNewGameSettingsBtn = document.getElementById('saveNewGameSettingsBtn');
  const loadNewGameSettingsBtn = document.getElementById('loadNewGameSettingsBtn');
  const newGameSettingsStatus = document.getElementById('newGameSettingsStatus');
  const startingCurrencyField = document.getElementById('startingCurrency');
  const levelField = document.getElementById('playerLevel');
  const attributeGrid = document.getElementById('attributeGrid');
  const attributePointsDisplay = document.getElementById('attributePointsRemaining');
  const attributePointsWarning = document.getElementById('attributePointsWarning');
  const skillsGrid = document.getElementById('newGameSkillsGrid');
  const skillPointsDisplay = document.getElementById('skillPointsRemaining');
  const skillPointsWarning = document.getElementById('skillPointsWarning');
  const skillsSection = document.getElementById('newGameSkillsSection');
  const skillAddInput = document.getElementById('skillAddInput');
  const skillAddButton = document.getElementById('skillAddButton');
  const skillAddInputBottom = document.getElementById('skillAddInputBottom');
  const skillAddButtonBottom = document.getElementById('skillAddButtonBottom');
  const classSelect = document.getElementById('playerClassSelect');
  const classOtherInput = document.getElementById('playerClassOther');
  const raceSelect = document.getElementById('playerRaceSelect');
  const raceOtherInput = document.getElementById('playerRaceOther');
  const otherSelectUpdaters = [];
  const overlayText = overlay ? overlay.querySelector('.overlay-text') : null;
  const spinnerDefaultText = overlayText && overlayText.textContent.trim()
    ? overlayText.textContent.trim()
    : 'Creating your adventure...';

  const NEW_GAME_DEFAULTS = window.NEW_GAME_DEFAULTS || {};
  const NEW_GAME_SETTINGS_API = {
    save: '/api/new-game/settings/save',
    load: '/api/new-game/settings/load',
    list: '/api/new-game/settings/saves'
  };
  let isFormEnabled = true;
  let allocator = null;

  const stageMessages = {
    'new_game:start': 'Preparing your adventure...',
    'new_game:reset': 'Clearing previous game state...',
    'new_game:reset_complete': 'Game state cleared. Preparing skills...',
    'new_game:skills_existing': 'Integrating existing skills...',
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

  const updateSubmitState = () => {
    if (!startBtn) {
      return;
    }
    const pools = allocator ? allocator.getPools() : { attributePool: null, skillPool: null };
    const attrPool = Number(pools.attributePool);
    const skillPool = Number(pools.skillPool);
    const hasNegativePool = (Number.isFinite(attrPool) && attrPool < 0)
      || (Number.isFinite(skillPool) && skillPool < 0);
    startBtn.disabled = !isFormEnabled || hasNegativePool;
  };

  function setNewGameSettingsStatus(message, tone = '') {
    if (!newGameSettingsStatus) {
      return;
    }
    const safeMessage = typeof message === 'string' ? message.trim() : '';
    newGameSettingsStatus.textContent = safeMessage;
    if (!safeMessage) {
      newGameSettingsStatus.style.color = '';
      return;
    }
    if (tone === 'error') {
      newGameSettingsStatus.style.color = '#f44336';
      return;
    }
    if (tone === 'warn') {
      newGameSettingsStatus.style.color = '#ff9800';
      return;
    }
    if (tone === 'success') {
      newGameSettingsStatus.style.color = '#4caf50';
      return;
    }
    newGameSettingsStatus.style.color = '';
  }

  function summarizeLoadResult(summary) {
    if (!summary || typeof summary !== 'object') {
      return 'Loaded form settings.';
    }
    const attrSummary = summary.attributes || {};
    const skillSummary = summary.skills || {};
    const attrTotal = (Array.isArray(attrSummary.applied) ? attrSummary.applied.length : 0)
      + (Array.isArray(attrSummary.defaulted) ? attrSummary.defaulted.length : 0);
    const skillTotal = (Array.isArray(skillSummary.applied) ? skillSummary.applied.length : 0)
      + (Array.isArray(skillSummary.defaulted) ? skillSummary.defaulted.length : 0);
    const ignoredAttrCount = Array.isArray(attrSummary.ignored) ? attrSummary.ignored.length : 0;
    const ignoredSkillCount = Array.isArray(skillSummary.ignored) ? skillSummary.ignored.length : 0;
    const ignoredTotal = ignoredAttrCount + ignoredSkillCount;
    const suffix = ignoredTotal > 0
      ? ` ${ignoredTotal} non-matching loaded entries were ignored.`
      : '';
    return `Loaded attributes ${attrSummary.applied?.length || 0}/${attrTotal} and skills ${skillSummary.applied?.length || 0}/${skillTotal}.${suffix}`;
  }

  function setOverlayText(text) {
    if (overlayText) {
      overlayText.textContent = text || spinnerDefaultText;
    }
  }

  const showAllocatorError = (message) => {
    const safeMessage = message || 'Failed to initialize point pool formulas.';
    if (attributePointsWarning) {
      attributePointsWarning.textContent = safeMessage;
      attributePointsWarning.style.display = 'block';
      attributePointsWarning.style.color = '#f44336';
    }
    if (skillPointsWarning) {
      skillPointsWarning.textContent = safeMessage;
      skillPointsWarning.style.display = 'block';
      skillPointsWarning.style.color = '#f44336';
    }
    isFormEnabled = false;
    if (startBtn) {
      startBtn.disabled = true;
    }
  };

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
    const stageRaw = typeof payload.stage === 'string' ? payload.stage.trim() : '';
    const stageNormalized = stageRaw.toLowerCase();
    if (stageNormalized === 'spinner:update') {
      const overlayMessage = typeof payload.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : spinnerDefaultText;
      setOverlayText(overlayMessage);
      return;
    }
    const message = payload.message || stageMessages[stageRaw] || stageMessages[stageNormalized] || spinnerDefaultText;
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
  if (!window.AttributeSkillAllocator || typeof window.AttributeSkillAllocator.init !== 'function') {
    throw new Error('AttributeSkillAllocator.init is required but unavailable. Ensure /js/attribute-skill-allocator.js is loaded.');
  }

  try {
    allocator = window.AttributeSkillAllocator.init({
      levelField,
      attributeGrid,
      attributePointsDisplay,
      attributePointsWarning,
      skillsGrid,
      skillPointsDisplay,
    skillPointsWarning,
    skillsSection,
    addSkillInputs: [skillAddInput, skillAddInputBottom],
    addSkillButtons: [skillAddButton, skillAddButtonBottom],
    defaultSkillNames: NEW_GAME_DEFAULTS.existingSkills || [],
    poolFormulas: NEW_GAME_DEFAULTS.pointPoolFormulas || {},
    onPoolsUpdated: updateSubmitState
  });
  } catch (error) {
    console.error('Failed to initialize attribute/skill allocation:', error);
    showAllocatorError(error?.message || 'Failed to initialize point pool formulas.');
  }

  if (allocator) {
    allocator.ready.catch(error => {
      console.error('Failed to initialize attribute/skill allocation:', error);
      showAllocatorError(error?.message || 'Failed to initialize point pool formulas.');
    });
  }

  async function ensureAllocatorReady() {
    if (!allocator) {
      throw new Error('Cannot access attribute/skill allocator on this page.');
    }
    if (allocator.ready && typeof allocator.ready.then === 'function') {
      await allocator.ready;
    }
    return allocator;
  }


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
    isFormEnabled = enabled;
    Array.from(form.elements).forEach(el => {
      el.disabled = !enabled;
    });
    updateSubmitState();
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

  const applySelectValue = (selectEl, otherEl, rawValue) => {
    if (!selectEl) {
      return;
    }
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) {
      selectEl.value = '';
      if (otherEl) {
        otherEl.value = '';
      }
      selectEl.dispatchEvent(new Event('change'));
      return;
    }

    let matchedValue = '';
    for (const option of Array.from(selectEl.options || [])) {
      if (!option || typeof option.value !== 'string') {
        continue;
      }
      const optionValue = option.value.trim();
      if (!optionValue || optionValue === '__other') {
        continue;
      }
      if (optionValue.toLowerCase() === value.toLowerCase()) {
        matchedValue = optionValue;
        break;
      }
    }

    if (matchedValue) {
      selectEl.value = matchedValue;
      if (otherEl) {
        otherEl.value = '';
      }
    } else {
      selectEl.value = '__other';
      if (otherEl) {
        otherEl.value = value;
      }
    }
    selectEl.dispatchEvent(new Event('change'));
  };

  const resolveLevelForPayload = () => {
    const playerLevelRaw = (levelField?.value || '').trim();
    const parsedPlayerLevel = Number(playerLevelRaw);
    const fallbackLevel = Number(levelField?.dataset?.defaultValue ?? '');
    if (Number.isFinite(parsedPlayerLevel)) {
      return parsedPlayerLevel;
    }
    if (Number.isFinite(fallbackLevel)) {
      return fallbackLevel;
    }
    return 1;
  };

  const resolveStartingCurrencyForPayload = () => {
    const startingCurrencyRaw = (startingCurrencyField?.value || '').trim();
    const parsedStartingCurrency = Number.parseInt(startingCurrencyRaw, 10);
    const fallbackStartingCurrency = Number.parseInt(startingCurrencyField?.dataset?.defaultValue ?? '', 10);
    if (Number.isFinite(parsedStartingCurrency)) {
      return parsedStartingCurrency;
    }
    if (Number.isFinite(fallbackStartingCurrency)) {
      return fallbackStartingCurrency;
    }
    return 0;
  };

  const buildSettingsSaveDefaultName = () => {
    const playerName = (document.getElementById('playerName')?.value || '').trim() || 'adventurer';
    const level = resolveLevelForPayload();
    const dateStamp = new Date().toISOString().slice(0, 10);
    return `${playerName}-lvl-${level}-${dateStamp}`;
  };

  const collectNewGameSettings = async () => {
    const readyAllocator = await ensureAllocatorReady();
    return {
      playerName: (document.getElementById('playerName')?.value || '').trim(),
      playerDescription: (document.getElementById('playerDescription')?.value || '').trim(),
      playerClass: resolveSelectionValue(classSelect, classOtherInput),
      playerRace: resolveSelectionValue(raceSelect, raceOtherInput),
      playerLevel: resolveLevelForPayload(),
      startingLocation: (document.getElementById('startingLocation')?.value || '').trim(),
      startingCurrency: resolveStartingCurrencyForPayload(),
      attributes: readyAllocator.getAttributeValues(),
      skills: readyAllocator.getSkillValues()
    };
  };

  const resolveLoadedLevelValue = (savedSettings) => {
    const fallbackLevel = Number(levelField?.dataset?.defaultValue ?? '');
    const parsed = Number(savedSettings?.playerLevel);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    if (Number.isFinite(fallbackLevel)) {
      return fallbackLevel;
    }
    return 1;
  };

  const resolveLoadedCurrencyValue = (savedSettings) => {
    const fallbackCurrency = Number.parseInt(startingCurrencyField?.dataset?.defaultValue ?? '', 10);
    const parsed = Number.parseInt(savedSettings?.startingCurrency, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    if (Number.isFinite(fallbackCurrency)) {
      return fallbackCurrency;
    }
    return 0;
  };

  const applyLoadedNewGameSettings = async (savedSettings) => {
    if (!savedSettings || typeof savedSettings !== 'object' || Array.isArray(savedSettings)) {
      throw new Error('Loaded settings payload must be an object.');
    }
    const readyAllocator = await ensureAllocatorReady();

    const playerNameField = document.getElementById('playerName');
    const playerDescriptionField = document.getElementById('playerDescription');
    const startingLocationField = document.getElementById('startingLocation');
    if (playerNameField) {
      playerNameField.value = typeof savedSettings.playerName === 'string'
        ? savedSettings.playerName
        : (NEW_GAME_DEFAULTS.playerName || '');
    }
    if (playerDescriptionField) {
      playerDescriptionField.value = typeof savedSettings.playerDescription === 'string'
        ? savedSettings.playerDescription
        : (NEW_GAME_DEFAULTS.playerDescription || '');
    }
    if (startingLocationField) {
      startingLocationField.value = typeof savedSettings.startingLocation === 'string'
        ? savedSettings.startingLocation
        : (NEW_GAME_DEFAULTS.startingLocation || '');
    }

    const nextLevel = resolveLoadedLevelValue(savedSettings);
    if (levelField) {
      levelField.value = String(nextLevel);
      levelField.dispatchEvent(new Event('change'));
    }

    if (startingCurrencyField) {
      startingCurrencyField.value = String(resolveLoadedCurrencyValue(savedSettings));
    }

    applySelectValue(classSelect, classOtherInput, savedSettings.playerClass);
    applySelectValue(raceSelect, raceOtherInput, savedSettings.playerRace);

    const attributes = savedSettings.attributes && typeof savedSettings.attributes === 'object' && !Array.isArray(savedSettings.attributes)
      ? savedSettings.attributes
      : {};
    const skills = savedSettings.skills && typeof savedSettings.skills === 'object' && !Array.isArray(savedSettings.skills)
      ? savedSettings.skills
      : {};

    const summary = readyAllocator.applyLoadedValues({
      attributes,
      skills
    });
    updateSubmitState();
    return summary;
  };

  const chooseSavedSettingsEntry = (savedEntries) => {
    if (!Array.isArray(savedEntries) || !savedEntries.length) {
      return null;
    }
    const shownEntries = savedEntries.slice(0, 25);
    const promptLines = shownEntries.map((entry, index) => {
      const timestamp = typeof entry?.timestamp === 'string' && entry.timestamp.trim()
        ? new Date(entry.timestamp).toLocaleString()
        : 'Unknown time';
      const playerName = typeof entry?.playerName === 'string' && entry.playerName.trim()
        ? entry.playerName.trim()
        : 'Unknown player';
      return `${index + 1}. ${entry.saveName} (${playerName}, ${timestamp})`;
    });
    const selection = window.prompt(
      `Choose saved form settings by number or exact name:\n\n${promptLines.join('\n')}`
    );
    if (selection === null) {
      return null;
    }
    const trimmed = selection.trim();
    if (!trimmed) {
      throw new Error('Selection cannot be empty.');
    }
    const numericSelection = Number.parseInt(trimmed, 10);
    if (Number.isInteger(numericSelection) && String(numericSelection) === trimmed) {
      if (numericSelection < 1 || numericSelection > shownEntries.length) {
        throw new Error(`Selection ${numericSelection} is out of range.`);
      }
      return shownEntries[numericSelection - 1];
    }
    const byName = savedEntries.find(entry => typeof entry?.saveName === 'string' && entry.saveName === trimmed);
    if (byName) {
      return byName;
    }
    const byNameInsensitive = savedEntries.find(entry => typeof entry?.saveName === 'string' && entry.saveName.toLowerCase() === trimmed.toLowerCase());
    if (byNameInsensitive) {
      return byNameInsensitive;
    }
    throw new Error(`No saved settings found with name '${trimmed}'.`);
  };

  const saveNewGameSettings = async () => {
    const saveNameInput = window.prompt('Enter a name for this form settings save:', buildSettingsSaveDefaultName());
    if (saveNameInput === null) {
      return;
    }
    const settings = await collectNewGameSettings();
    const response = await fetch(NEW_GAME_SETTINGS_API.save, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        saveName: saveNameInput.trim(),
        settings
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || `Failed to save settings (${response.status}).`);
    }
    setNewGameSettingsStatus(`Saved form settings as '${payload.saveName}'.`, 'success');
  };

  const loadNewGameSettings = async () => {
    await ensureAllocatorReady();
    const listResponse = await fetch(NEW_GAME_SETTINGS_API.list);
    const listPayload = await listResponse.json().catch(() => ({}));
    if (!listResponse.ok || !listPayload?.success) {
      throw new Error(listPayload?.error || `Failed to list saved settings (${listResponse.status}).`);
    }
    const saves = Array.isArray(listPayload.saves) ? listPayload.saves : [];
    if (!saves.length) {
      setNewGameSettingsStatus('No saved new-game form settings found.', 'warn');
      return;
    }

    const selected = chooseSavedSettingsEntry(saves);
    if (!selected) {
      return;
    }
    const saveName = typeof selected.saveName === 'string' ? selected.saveName.trim() : '';
    if (!saveName) {
      throw new Error('Selected save is missing saveName.');
    }

    const loadResponse = await fetch(NEW_GAME_SETTINGS_API.load, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saveName })
    });
    const loadPayload = await loadResponse.json().catch(() => ({}));
    if (!loadResponse.ok || !loadPayload?.success) {
      throw new Error(loadPayload?.error || `Failed to load settings (${loadResponse.status}).`);
    }

    const summary = await applyLoadedNewGameSettings(loadPayload.settings || {});
    setNewGameSettingsStatus(`${summarizeLoadResult(summary)} Loaded '${saveName}'.`, 'success');
  };

  setupOtherSelect(classSelect, classOtherInput);
  setupOtherSelect(raceSelect, raceOtherInput);

  if (saveNewGameSettingsBtn) {
    saveNewGameSettingsBtn.addEventListener('click', async () => {
      try {
        setNewGameSettingsStatus('');
        saveNewGameSettingsBtn.disabled = true;
        const previousText = saveNewGameSettingsBtn.textContent;
        saveNewGameSettingsBtn.dataset.previousText = previousText || '';
        saveNewGameSettingsBtn.textContent = 'Saving...';
        await saveNewGameSettings();
      } catch (error) {
        setNewGameSettingsStatus(error?.message || 'Failed to save form settings.', 'error');
      } finally {
        saveNewGameSettingsBtn.textContent = saveNewGameSettingsBtn.dataset.previousText || 'Save Form Settings';
        saveNewGameSettingsBtn.disabled = false;
      }
    });
  }

  if (loadNewGameSettingsBtn) {
    loadNewGameSettingsBtn.addEventListener('click', async () => {
      try {
        setNewGameSettingsStatus('');
        loadNewGameSettingsBtn.disabled = true;
        const previousText = loadNewGameSettingsBtn.textContent;
        loadNewGameSettingsBtn.dataset.previousText = previousText || '';
        loadNewGameSettingsBtn.textContent = 'Loading...';
        await loadNewGameSettings();
      } catch (error) {
        setNewGameSettingsStatus(error?.message || 'Failed to load form settings.', 'error');
      } finally {
        loadNewGameSettingsBtn.textContent = loadNewGameSettingsBtn.dataset.previousText || 'Load Form Settings';
        loadNewGameSettingsBtn.disabled = false;
      }
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const playerName = (document.getElementById('playerName')?.value || '').trim();
      const playerDescription = (document.getElementById('playerDescription')?.value || '').trim();
      const startingLocation = (document.getElementById('startingLocation')?.value || '').trim();
      const playerLevelRaw = (levelField?.value || '').trim();
      const parsedPlayerLevel = Number(playerLevelRaw);
      const fallbackLevel = Number(levelField?.dataset?.defaultValue ?? '');
      const playerLevel = Number.isFinite(parsedPlayerLevel)
        ? parsedPlayerLevel
        : (Number.isFinite(fallbackLevel) ? fallbackLevel : null);
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
      const attributes = allocator ? allocator.getAttributeValues() : {};
      const skills = allocator ? allocator.getSkillValues() : {};
      const pools = allocator ? allocator.refreshPools() : { attributePool: null, skillPool: null };
      const attributePool = pools.attributePool;
      const skillPool = pools.skillPool;
      const unspentSkillPoints = allocator && allocator.hasSkills()
        ? skillPool
        : null;
      if ((Number.isFinite(attributePool) && attributePool < 0) || (Number.isFinite(skillPool) && skillPool < 0)) {
        return;
      }
      if ((Number.isFinite(attributePool) && attributePool > 0) || (Number.isFinite(skillPool) && skillPool > 0)) {
        const confirmed = window.confirm('You have unspent points. Start the game anyway?');
        if (!confirmed) {
          return;
        }
      }

      try {
        setFormEnabled(false);
        showOverlay();
        if (window.disableNavigationGuard) window.disableNavigationGuard(false);

        const requestId = generateRequestId();
        realtimeState.activeRequestId = requestId;

        const payload = {
          playerName,
          playerDescription,
          playerClass,
          playerRace,
          startingLocation,
          startingCurrency,
          clientId: realtimeState.clientId,
          requestId
        };
        if (Number.isFinite(playerLevel)) {
          payload.playerLevel = playerLevel;
        }
        if (Object.keys(attributes).length > 0) {
          payload.attributes = attributes;
        }
        if (Object.keys(skills).length > 0) {
          payload.skills = skills;
        }
        if (Number.isFinite(unspentSkillPoints)) {
          payload.unspentSkillPoints = unspentSkillPoints;
        }

        fetch('/api/new-game', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        }).then(async (response) => {
          const result = await response.json().catch(() => ({}));
          if (!response.ok || !result?.success) {
            const errMsg = result?.details || result?.error || `Server error (${response.status})`;
            console.error(`New game creation failed: ${errMsg}`);
          }
        }).catch((err) => {
          console.error(`New game creation failed: ${err?.message || err}`);
        });

        window.location.assign('/#tab-adventure');
      } catch (err) {
        console.error(`Failed to submit new game request: ${err?.message || err}`);
        realtimeState.activeRequestId = null;
        hideOverlay();
        setFormEnabled(true);
        if (window.disableNavigationGuard) window.disableNavigationGuard(false);
      }
    });
  }
});
