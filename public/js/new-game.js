document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('newGameForm');
  if (form?.dataset.worldLoaded === 'false') {
    form.addEventListener('submit', event => event.preventDefault());
    return;
  }
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const saveNewGameSettingsBtn = document.getElementById('saveNewGameSettingsBtn');
  const loadNewGameSettingsBtn = document.getElementById('loadNewGameSettingsBtn');
  const newGameSettingsStatus = document.getElementById('newGameSettingsStatus');
  const startingCurrencyField = document.getElementById('startingCurrency');
  const startMonthField = document.getElementById('startMonth');
  const startDayField = document.getElementById('startDay');
  const startTimeField = document.getElementById('startTime');
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

  const reviewedDraftToken = new URLSearchParams(location.search).get('draftToken');
  const NEW_GAME_DEFAULTS = window.NEW_GAME_DEFAULTS || {};
  const NEW_GAME_SETTINGS_API = {
    save: '/api/new-game/settings/save',
    load: '/api/new-game/settings/load',
    list: '/api/new-game/settings/saves'
  };

  const getSelectedStartingMonthLength = () => {
    const selectedOption = startMonthField?.selectedOptions?.[0] || null;
    if (!selectedOption) {
      throw new Error('The starting month selector has no selected month.');
    }
    const configuredLength = Number(selectedOption.dataset.lengthDays);
    return Number.isInteger(configuredLength) && configuredLength > 0
      ? configuredLength
      : 31;
  };

  const populateStartingDayOptions = (preferredDay) => {
    if (!startDayField) {
      return;
    }
    const monthLength = getSelectedStartingMonthLength();
    const parsedPreferredDay = Number(preferredDay);
    const hasValidPreferredDay = Number.isInteger(parsedPreferredDay)
      && parsedPreferredDay >= 1
      && parsedPreferredDay <= monthLength;

    startDayField.replaceChildren();
    if (!hasValidPreferredDay) {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a day';
      placeholder.disabled = true;
      placeholder.selected = true;
      startDayField.appendChild(placeholder);
    }
    for (let day = 1; day <= monthLength; day += 1) {
      const option = document.createElement('option');
      option.value = String(day);
      option.textContent = String(day);
      option.selected = hasValidPreferredDay && day === parsedPreferredDay;
      startDayField.appendChild(option);
    }
  };

  if (startMonthField && startDayField) {
    const defaultStartDay = Number(startDayField.dataset.defaultValue || NEW_GAME_DEFAULTS.startDay || 1);
    populateStartingDayOptions(defaultStartDay);
    startMonthField.addEventListener('change', () => {
      populateStartingDayOptions(Number(startDayField.value));
    });
  }
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
    clientId: window.DomUtils.loadClientId(),
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
    if (payload.promptFailure) window.AIRPG_PROMPT_WINDOWS.showFailure(payload.promptFailure);
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
      // The fieldset's disabled state belongs to the rendered world guard.
      if (el.tagName !== 'FIELDSET') el.disabled = !enabled;
    });
    updateSubmitState();
    otherSelectUpdaters.forEach(fn => fn());
    updateSettingsTriggers();
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

  const resolveStartTimeForPayload = () => {
    const startTimeRaw = (startTimeField?.value || '').trim();
    const parsedStartTime = Number(startTimeRaw);
    const fallbackStartTime = Number(startTimeField?.dataset?.defaultValue ?? '');
    if (Number.isFinite(parsedStartTime)) {
      return parsedStartTime;
    }
    if (Number.isFinite(fallbackStartTime)) {
      return fallbackStartTime;
    }
    return 9;
  };

  const resolveStartMonthForPayload = () => {
    if (startMonthField && !startMonthField.value) {
      throw new Error('Select a starting month.');
    }
    const parsedStartMonth = Number(startMonthField?.value);
    const fallbackStartMonth = Number(startMonthField?.dataset?.defaultValue ?? '');
    if (Number.isInteger(parsedStartMonth) && parsedStartMonth >= 1) {
      return parsedStartMonth;
    }
    if (Number.isInteger(fallbackStartMonth) && fallbackStartMonth >= 1) {
      return fallbackStartMonth;
    }
    return 1;
  };

  const resolveStartDayForPayload = () => {
    if (startDayField && !startDayField.value) {
      throw new Error('Select a valid starting day for the selected month.');
    }
    const parsedStartDay = Number(startDayField?.value);
    const fallbackStartDay = Number(startDayField?.dataset?.defaultValue ?? '');
    if (Number.isInteger(parsedStartDay) && parsedStartDay >= 1) {
      return parsedStartDay;
    }
    if (Number.isInteger(fallbackStartDay) && fallbackStartDay >= 1) {
      return fallbackStartDay;
    }
    return 1;
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
      startMonth: resolveStartMonthForPayload(),
      startDay: resolveStartDayForPayload(),
      startTime: resolveStartTimeForPayload(),
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

  const resolveLoadedStartTimeValue = (savedSettings) => {
    const fallbackStartTime = Number(startTimeField?.dataset?.defaultValue ?? '');
    const parsed = Number(savedSettings?.startTime);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    if (Number.isFinite(fallbackStartTime)) {
      return fallbackStartTime;
    }
    return 9;
  };

  const resolveLoadedStartMonthValue = (savedSettings) => {
    const fallbackStartMonth = Number(startMonthField?.dataset?.defaultValue ?? '');
    const parsed = Number(savedSettings?.startMonth);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
    if (Number.isInteger(fallbackStartMonth) && fallbackStartMonth >= 1) {
      return fallbackStartMonth;
    }
    return 1;
  };

  const resolveLoadedStartDayValue = (savedSettings) => {
    const fallbackStartDay = Number(startDayField?.dataset?.defaultValue ?? '');
    const parsed = Number(savedSettings?.startDay);
    if (Number.isInteger(parsed) && parsed >= 1) {
      return parsed;
    }
    if (Number.isInteger(fallbackStartDay) && fallbackStartDay >= 1) {
      return fallbackStartDay;
    }
    return 1;
  };

  const applyLoadedNewGameSettings = async (savedSettings) => {
    if (!savedSettings || typeof savedSettings !== 'object' || Array.isArray(savedSettings)) {
      throw new Error('Loaded settings payload must be an object.');
    }
    const readyAllocator = await ensureAllocatorReady();
    for (const name of ['attributes', 'skills']) {
      const record = savedSettings[name];
      if (record !== undefined && (!record || typeof record !== 'object' || Array.isArray(record))) {
        throw new Error(`Loaded settings ${name} must be an object.`);
      }
    }
    const staged = {
      playerName: typeof savedSettings.playerName === 'string' ? savedSettings.playerName : (NEW_GAME_DEFAULTS.playerName || ''),
      playerDescription: typeof savedSettings.playerDescription === 'string' ? savedSettings.playerDescription : (NEW_GAME_DEFAULTS.playerDescription || ''),
      startingLocation: typeof savedSettings.startingLocation === 'string' ? savedSettings.startingLocation : (NEW_GAME_DEFAULTS.startingLocation || ''),
      playerLevel: resolveLoadedLevelValue(savedSettings),
      startingCurrency: resolveLoadedCurrencyValue(savedSettings),
      startMonth: resolveLoadedStartMonthValue(savedSettings),
      startDay: resolveLoadedStartDayValue(savedSettings),
      startTime: resolveLoadedStartTimeValue(savedSettings),
      attributes: savedSettings.attributes === undefined ? {} : savedSettings.attributes,
      skills: savedSettings.skills === undefined ? {} : savedSettings.skills
    };
    // Validate the active calendar before touching either form or allocator state.
    if (startMonthField && startDayField) {
      const month = Array.from(startMonthField.options).find(option => Number(option.value) === staged.startMonth);
      if (!month) {
        throw new Error(`Saved starting month ${staged.startMonth} is unavailable in the active calendar.`);
      }
      const configuredLength = Number(month.dataset.lengthDays);
      const monthLength = Number.isInteger(configuredLength) && configuredLength > 0 ? configuredLength : 31;
      if (staged.startDay > monthLength) {
        throw new Error(`Saved starting day ${staged.startDay} is unavailable in ${month.textContent.trim()}.`);
      }
    }
    const previousControls = Array.from(form.querySelectorAll('input, textarea, select')).map(control => ({
      control, value: control.value, disabled: control.disabled, style: control.getAttribute('style')
    }));
    const previousDayOptions = startDayField ? Array.from(startDayField.childNodes, node => node.cloneNode(true)) : [];
    const previousAllocation = {
      attributes: readyAllocator.getAttributeValues(),
      skills: readyAllocator.getSkillValues()
    };
    const restoreControls = () => {
      if (startDayField) startDayField.replaceChildren(...previousDayOptions.map(node => node.cloneNode(true)));
      for (const { control, value, disabled, style } of previousControls) {
        control.value = value;
        control.disabled = disabled;
        if (style === null) control.removeAttribute('style');
        else control.setAttribute('style', style);
      }
    };
    try {
      for (const id of ['playerName', 'playerDescription', 'startingLocation']) {
        const field = document.getElementById(id);
        if (field) field.value = staged[id];
      }
      if (levelField) {
        levelField.value = String(staged.playerLevel);
        levelField.dispatchEvent(new Event('change'));
      }
      if (startingCurrencyField) startingCurrencyField.value = String(staged.startingCurrency);
      if (startMonthField && startDayField) {
        startMonthField.value = String(staged.startMonth);
        populateStartingDayOptions(staged.startDay);
      }
      if (startTimeField) startTimeField.value = String(staged.startTime);
      applySelectValue(classSelect, classOtherInput, savedSettings.playerClass);
      applySelectValue(raceSelect, raceOtherInput, savedSettings.playerRace);
      const summary = readyAllocator.applyLoadedValues({ attributes: staged.attributes, skills: staged.skills });
      updateSubmitState();
      return summary;
    } catch (error) {
      try {
        // Restore the previous level before recomputing allocator limits and pools.
        restoreControls();
        readyAllocator.applyLoadedValues(previousAllocation);
        restoreControls();
        updateSubmitState();
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
        error.stack = `${error.stack}\n\nRestoring the previous form also failed:\n${rollbackError.stack}`;
        console.error('Failed to restore previous new-game form settings:', rollbackError);
      }
      throw error;
    }
  };

  const saveDialog = document.getElementById('saveNewGameSettingsDialog');
  const loadDialog = document.getElementById('loadNewGameSettingsDialog');
  const saveSettingsForm = document.getElementById('saveNewGameSettingsForm');
  const saveNameField = document.getElementById('newGameSettingsSaveName');
  const saveSummary = document.getElementById('newGameSettingsSaveSummary');
  const saveSubmit = document.getElementById('saveNewGameSettingsSubmit');
  const searchField = document.getElementById('newGameSettingsSearch');
  const clearSearch = document.getElementById('newGameSettingsClearSearch');
  const resultCount = document.getElementById('newGameSettingsResultCount');
  const choices = document.getElementById('newGameSettingsChoices');
  const listRetry = document.getElementById('newGameSettingsListRetry');
  const loadSubmit = document.getElementById('loadNewGameSettingsSubmit');
  let preparingSettingsDialog = false;
  let saveSnapshot = null;
  let savedEntries = [];
  let selectedSaveName = null;
  let listLoading = false;

  const updateSettingsTriggers = () => {
    const disabled = Boolean(reviewedDraftToken || !isFormEnabled || preparingSettingsDialog || saveDialog.open || loadDialog.open);
    saveNewGameSettingsBtn.disabled = disabled;
    loadNewGameSettingsBtn.disabled = disabled;
  };

  // Only the lifecycle is shared. Snapshot and library rules remain page-local.
  const createSettingsDialog = (dialog, trigger, status) => {
    const workflow = {
      dialog, pending: false, epoch: 0, controller: null,
      status(message, state = '') {
        status.textContent = message;
        status.dataset.state = state;
      },
      open(focusControl) {
        workflow.epoch += 1;
        workflow.status('');
        dialog.showModal();
        updateSettingsTriggers();
        focusControl.focus();
        return workflow.epoch;
      },
      close() {
        if (!workflow.pending) dialog.close();
      },
      setPending(pending) {
        workflow.pending = pending;
        dialog.setAttribute('aria-busy', String(pending));
        for (const control of dialog.querySelectorAll('input, button')) control.disabled = pending;
        updateSettingsTriggers();
      }
    };
    dialog.addEventListener('cancel', event => {
      if (workflow.pending) event.preventDefault();
    });
    dialog.addEventListener('close', () => {
      workflow.epoch += 1;
      workflow.controller?.abort();
      workflow.controller = null;
      updateSettingsTriggers();
      trigger.focus();
    });
    for (const button of dialog.querySelectorAll('[data-settings-dialog-close]')) {
      button.addEventListener('click', () => workflow.close());
    }
    return workflow;
  };
  const saveWorkflow = createSettingsDialog(saveDialog, saveNewGameSettingsBtn, document.getElementById('newGameSettingsSaveStatus'));
  const loadWorkflow = createSettingsDialog(loadDialog, loadNewGameSettingsBtn, document.getElementById('newGameSettingsLoadStatus'));

  const reportSettingsError = (error, workflow, returnFocus) => {
    console.error('New-game form settings operation failed:', error);
    setNewGameSettingsStatus(error.message, 'error');
    workflow?.status(error.message, 'error');
    window.AIRPG_PAGE_FEEDBACK.showError(error, { returnFocus });
  };

  const readSettingsResponse = async (response, operation) => {
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new Error(`${operation} returned invalid JSON (HTTP ${response.status}).`, { cause });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.success !== 'boolean') {
      throw new Error(`${operation} returned an invalid response envelope.`);
    }
    if (!response.ok || !payload.success) {
      if (typeof payload.error !== 'string' || !payload.error.trim()) {
        throw new Error(`${operation} returned an invalid error response (HTTP ${response.status}).`);
      }
      const error = new Error(payload.error);
      if (payload.stack !== undefined) {
        if (typeof payload.stack !== 'string') throw new Error(`${operation} returned an invalid error stack.`);
        error.stack = payload.stack;
      }
      if (payload.code !== undefined) error.code = payload.code;
      throw error;
    }
    return payload;
  };

  const validateLoadedSettings = settings => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('Loaded settings payload must be an object.');
    }
    for (const key of ['playerName', 'playerDescription', 'playerClass', 'playerRace', 'startingLocation']) {
      if (settings[key] !== undefined && typeof settings[key] !== 'string') throw new Error(`Loaded settings ${key} must be text.`);
    }
    for (const key of ['playerLevel', 'startMonth', 'startDay', 'startTime', 'startingCurrency']) {
      if (settings[key] !== undefined && (typeof settings[key] !== 'number' || !Number.isFinite(settings[key]))) {
        throw new Error(`Loaded settings ${key} must be a finite number.`);
      }
    }
    for (const key of ['attributes', 'skills']) {
      if (!settings[key] || typeof settings[key] !== 'object' || Array.isArray(settings[key])) throw new Error(`Loaded settings ${key} must be an object.`);
      for (const [name, value] of Object.entries(settings[key])) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Loaded ${key} value '${name}' must be a finite number.`);
      }
    }
    return settings;
  };

  const renderSaveSummary = snapshot => {
    const month = Array.from(startMonthField.options).find(option => Number(option.value) === snapshot.startMonth);
    const rows = [
      ['Character', `${snapshot.playerName || 'Name not supplied'} · Level ${snapshot.playerLevel}`],
      ['Starting date / time', `${month.textContent.trim()}, day ${snapshot.startDay} · ${String(snapshot.startTime).padStart(2, '0')}:00`],
      ['Allocations', `${Object.keys(snapshot.attributes).length} attributes · ${Object.keys(snapshot.skills).length} skills`]
    ];
    if (snapshot.playerClass || snapshot.playerRace) rows.splice(1, 0, ['Class / Race', [snapshot.playerClass, snapshot.playerRace].filter(Boolean).join(' · ')]);
    saveSummary.replaceChildren();
    for (const [label, value] of rows) {
      const term = document.createElement('dt'); term.textContent = label;
      const detail = document.createElement('dd'); detail.textContent = value;
      saveSummary.append(term, detail);
    }
  };

  const renderSavedEntries = () => {
    const query = searchField.value.trim().toLowerCase();
    const visible = savedEntries.filter(entry => [entry.saveName, entry.playerName, entry.currentSettingName]
      .some(value => typeof value === 'string' && value.toLowerCase().includes(query)));
    if (!visible.some(entry => entry.saveName === selectedSaveName)) selectedSaveName = null;
    choices.replaceChildren();
    clearSearch.disabled = loadWorkflow.pending || !searchField.value;
    loadSubmit.disabled = loadWorkflow.pending || listLoading || !selectedSaveName;
    resultCount.textContent = listLoading ? '' : `${visible.length} of ${savedEntries.length} saved settings`;
    if (listLoading) return;
    if (!visible.length) {
      loadWorkflow.status(savedEntries.length ? 'No saved settings match your search.' : 'No saved new-game form settings found.');
      return;
    }
    for (const entry of visible) {
      const card = document.createElement('label'); card.className = 'new-game-settings-choice';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'newGameSettingsSave'; radio.value = entry.saveName;
      radio.checked = selectedSaveName === entry.saveName; radio.disabled = loadWorkflow.pending;
      const text = document.createElement('span'); text.className = 'new-game-settings-choice__text';
      const name = document.createElement('strong'); name.textContent = entry.saveName; text.append(name);
      const details = [];
      if (typeof entry.playerName === 'string' && entry.playerName) details.push(`${entry.playerName}${Number.isFinite(entry.playerLevel) ? ` · Level ${entry.playerLevel}` : ''}`);
      else if (Number.isFinite(entry.playerLevel)) details.push(`Level ${entry.playerLevel}`);
      if (typeof entry.currentSettingName === 'string' && entry.currentSettingName) details.push(entry.currentSettingName);
      const timestamp = typeof entry.timestamp === 'string' ? new Date(entry.timestamp) : null;
      details.push(timestamp && Number.isFinite(timestamp.getTime()) ? timestamp.toLocaleString() : 'Timestamp unavailable');
      const counts = [];
      if (Number.isInteger(entry.totalAttributes)) counts.push(`${entry.totalAttributes} attributes`);
      if (Number.isInteger(entry.totalSkills)) counts.push(`${entry.totalSkills} skills`);
      if (counts.length) details.push(counts.join(' · '));
      for (const value of details) { const line = document.createElement('span'); line.textContent = value; text.append(line); }
      radio.addEventListener('change', () => {
        selectedSaveName = radio.value;
        loadSubmit.disabled = false;
        loadWorkflow.status('');
      });
      card.append(radio, text); choices.append(card);
    }
  };

  const fetchSavedEntries = async () => {
    const epoch = loadWorkflow.epoch;
    loadWorkflow.controller?.abort();
    const controller = new AbortController();
    loadWorkflow.controller = controller;
    savedEntries = []; selectedSaveName = null; listLoading = true;
    listRetry.hidden = true;
    searchField.disabled = false;
    loadWorkflow.status('Loading saved settings…');
    renderSavedEntries();
    try {
      const response = await fetch(NEW_GAME_SETTINGS_API.list, { signal: controller.signal });
      const payload = await readSettingsResponse(response, 'Listing saved settings');
      if (epoch !== loadWorkflow.epoch || !loadDialog.open) return;
      if (!Array.isArray(payload.saves)) throw new Error('Saved settings response must contain a saves array.');
      const names = new Set();
      for (const entry of payload.saves) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.saveName !== 'string' || !entry.saveName.trim()) {
          throw new Error('A saved settings entry is missing its save name.');
        }
        if (names.has(entry.saveName)) throw new Error(`Duplicate saved settings name '${entry.saveName}'.`);
        names.add(entry.saveName);
      }
      savedEntries = payload.saves;
      listLoading = false; searchField.disabled = false;
      loadWorkflow.status(''); renderSavedEntries();
    } catch (error) {
      if (epoch !== loadWorkflow.epoch || !loadDialog.open) return;
      listLoading = false;
      renderSavedEntries(); resultCount.textContent = '';
      searchField.disabled = true;
      clearSearch.disabled = true;
      listRetry.hidden = false;
      reportSettingsError(error, loadWorkflow, listRetry);
    }
  };

  setupOtherSelect(classSelect, classOtherInput);
  setupOtherSelect(raceSelect, raceOtherInput);

  saveNewGameSettingsBtn.addEventListener('click', async () => {
    if (saveNewGameSettingsBtn.disabled) return;
    preparingSettingsDialog = true; updateSettingsTriggers();
    try {
      saveSnapshot = await collectNewGameSettings();
      saveNameField.value = buildSettingsSaveDefaultName();
      renderSaveSummary(saveSnapshot);
      setNewGameSettingsStatus('');
      saveWorkflow.open(saveNameField); saveNameField.select();
    } catch (error) {
      reportSettingsError(error, null, saveNewGameSettingsBtn);
    } finally {
      preparingSettingsDialog = false; updateSettingsTriggers();
    }
  });

  saveSettingsForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (saveWorkflow.pending || !saveDialog.open) return;
    saveWorkflow.setPending(true); saveWorkflow.status('Saving…');
    saveSubmit.textContent = 'Saving…';
    let failure = null;
    try {
      const response = await fetch(NEW_GAME_SETTINGS_API.save, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saveName: saveNameField.value.trim(), settings: saveSnapshot })
      });
      const payload = await readSettingsResponse(response, 'Saving form settings');
      if (typeof payload.saveName !== 'string' || !payload.saveName.trim()) throw new Error('Save response is missing the actual save name.');
      setNewGameSettingsStatus(`Saved form settings as '${payload.saveName}'.`, 'success');
    } catch (error) { failure = error; }
    finally { saveWorkflow.setPending(false); saveSubmit.textContent = 'Save'; }
    if (failure) reportSettingsError(failure, saveWorkflow, saveNameField);
    else saveWorkflow.close();
  });

  loadNewGameSettingsBtn.addEventListener('click', () => {
    if (loadNewGameSettingsBtn.disabled) return;
    searchField.value = '';
    searchField.disabled = false;
    setNewGameSettingsStatus('');
    loadWorkflow.open(searchField);
    fetchSavedEntries();
  });
  listRetry.addEventListener('click', () => fetchSavedEntries());
  searchField.addEventListener('input', () => { loadWorkflow.status(''); renderSavedEntries(); });
  clearSearch.addEventListener('click', () => { searchField.value = ''; loadWorkflow.status(''); renderSavedEntries(); searchField.focus(); });
  loadSubmit.addEventListener('click', async () => {
    if (loadWorkflow.pending || listLoading || !selectedSaveName || !loadDialog.open) return;
    const saveName = selectedSaveName;
    loadWorkflow.setPending(true); loadWorkflow.status('Loading form settings…');
    loadSubmit.textContent = 'Loading…';
    let failure = null;
    try {
      const response = await fetch(NEW_GAME_SETTINGS_API.load, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ saveName })
      });
      const payload = await readSettingsResponse(response, 'Loading form settings');
      const summary = await applyLoadedNewGameSettings(validateLoadedSettings(payload.settings));
      setNewGameSettingsStatus(`${summarizeLoadResult(summary)} Loaded '${saveName}'.`, 'success');
    } catch (error) { failure = error; }
    finally { loadWorkflow.setPending(false); renderSavedEntries(); loadSubmit.textContent = 'Load Form Settings'; }
    if (failure) reportSettingsError(failure, loadWorkflow, loadSubmit);
    else loadWorkflow.close();
  });
  updateSettingsTriggers();

  let reviewedDraft = null;
  if (reviewedDraftToken) {
    setFormEnabled(false);
    try {
      const response = await fetch(`/api/new-game/drafts/${encodeURIComponent(reviewedDraftToken)}`);
      const result = await response.json();
      if (!response.ok || !result.success) { const error = new Error(result.error || 'Reviewed draft could not be read.'); error.stack = result.stack || error.stack; throw error; }
      reviewedDraft = result.draft;
      await applyLoadedNewGameSettings(reviewedDraft.fields);
      const notice = document.createElement('p');
      notice.textContent = 'Reviewed setup from Stories. Start creates the reviewed profile and protagonist, replacing the active game. Return to Stories to revise these fields.';
      notice.setAttribute('role', 'status');
      form.prepend(notice);
      for (const field of form.querySelectorAll('input, textarea, select')) field.disabled = true;
      startBtn.disabled = false;
    } catch (error) { window.AIRPG_PAGE_FEEDBACK.showError(error); return; }
  }
  if (form) {
    form.addEventListener('submit' , async (e) => {
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
      const startMonth = resolveStartMonthForPayload();
      const startDay = resolveStartDayForPayload();
      const startTime = resolveStartTimeForPayload();
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
          startMonth,
          startDay,
          startTime,
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

        if (reviewedDraftToken) {
          payload.draftToken = reviewedDraftToken;
          const response = await fetch('/api/new-game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const result = await response.json();
          if (!response.ok || !result.success) {
            const error = new Error(result.details || result.error || `Reviewed setup failed: HTTP ${response.status}`);
            error.stack = result.stack || error.stack;
            error.code = result.code;
            if (result.promptFailure) error.promptFailure = result.promptFailure;
            throw error;
          }
          window.location.assign('/#tab-adventure');
          return;
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
            const error = new Error(errMsg);
            error.stack = result?.stack || error.stack;
            error.code = result?.code;
            if (result?.promptFailure) error.promptFailure = result.promptFailure;
            throw error;
          }
        }).catch((err) => {
          console.error(`New game creation failed: ${err?.message || err}`);
          window.AIRPG_PAGE_FEEDBACK.showError(err);
        });

        window.location.assign('/#tab-adventure');
      } catch (err) {
        window.AIRPG_PAGE_FEEDBACK.showError(err);
        realtimeState.activeRequestId = null;
        hideOverlay();
        setFormEnabled(true);
        if (window.disableNavigationGuard) window.disableNavigationGuard(false);
      }
    });
  }
});
