// Player Stats Configuration JavaScript

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('player-stats-form');
  const statusMessage = document.getElementById('status-message');
  const resetButton = document.getElementById('reset-stats');
  const abilitiesSection = document.getElementById('abilitiesSection');
  const abilitiesList = document.getElementById('abilitiesList');
  const abilitiesEmpty = document.getElementById('abilitiesEmpty');
  const playerStatusEffectsList = document.getElementById('playerStatusEffectsList');
  const playerStatusEffectAddBtn = document.getElementById('playerStatusEffectAddBtn');
  const MAX_HEALTH_DISPLAY_ID = 'player-max-health-display';
  const DEFAULT_HEALTH_ATTRIBUTE = 'constitution';
  let playerHealthAttributeKey = DEFAULT_HEALTH_ATTRIBUTE;

  const playerStatusModifierTemplates = {
    buildOptions(selectEl) {
      if (!selectEl) {
        return;
      }
      selectEl.innerHTML = '';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Select attribute or skill';
      selectEl.appendChild(defaultOpt);

      const attributes = Array.from(document.querySelectorAll('.attribute-group label'))
        .map(label => {
          const forAttr = label?.getAttribute('for') || '';
          const key = forAttr.replace('attr-', '').trim();
          const labelText = label.textContent?.trim() || key;
          return key ? { key, label: labelText } : null;
        })
        .filter(Boolean);

      const skills = Array.from(document.querySelectorAll('.skill-name'))
        .map(node => node?.textContent?.trim())
        .filter(Boolean)
        .map(name => ({ key: name, label: name }));

      const addGroup = (label, values, prefix) => {
        if (!values.length) return;
        const group = document.createElement('optgroup');
        group.label = label;
        values.forEach(entry => {
          const option = document.createElement('option');
          option.value = `${prefix}:${entry.key}`;
          option.textContent = entry.label || entry.key;
          group.appendChild(option);
        });
        selectEl.appendChild(group);
      };

      addGroup('Attributes', attributes, 'attr');
      addGroup('Skills', skills, 'skill');
    },
    createRow(initial) {
      const row = document.createElement('div');
      row.className = 'thing-modifier-row';

      const select = document.createElement('select');
      select.className = 'thing-modifier-select';
      this.buildOptions(select);

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'thing-modifier-value';
      input.placeholder = '+/-';
      input.step = '1';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'npc-edit-remove-btn';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => row.remove());

      row.appendChild(select);
      row.appendChild(input);
      row.appendChild(removeBtn);

      if (initial) {
        if (initial.attribute) {
          select.value = `attr:${initial.attribute}`;
        } else if (initial.skill) {
          select.value = `skill:${initial.skill}`;
        }
        if (Number.isFinite(initial.modifier)) {
          input.value = initial.modifier;
        }
      }

      return row;
    },
    renderList(container, entries = []) {
      if (!container) return;
      container.innerHTML = '';
      if (!Array.isArray(entries) || !entries.length) {
        container.appendChild(this.createRow(null));
        return;
      }
      entries.forEach(entry => container.appendChild(this.createRow(entry)));
    },
    collect(container) {
      const result = { attributes: [], skills: [] };
      if (!container) return result;
      container.querySelectorAll('.thing-modifier-row').forEach(row => {
        const select = row.querySelector('.thing-modifier-select');
        const input = row.querySelector('.thing-modifier-value');
        const selection = select?.value || '';
        const [type, key] = selection.split(':');
        const modRaw = input?.value ?? '';
        const modifier = Number(modRaw);
        if (!key || !Number.isFinite(modifier)) {
          return;
        }
        if (type === 'attr') {
          result.attributes.push({ attribute: key, modifier });
        } else if (type === 'skill') {
          result.skills.push({ skill: key, modifier });
        }
      });
      return result;
    }
  };

  function createPlayerStatusEffectRow(effect = {}) {
    if (!playerStatusEffectsList) {
      return null;
    }

    const row = document.createElement('div');
    row.className = 'thing-edit-row thing-edit-status-row';

    const descriptionInput = document.createElement('textarea');
    descriptionInput.className = 'thing-edit-status-description';
    descriptionInput.rows = 2;
    descriptionInput.placeholder = 'Description';
    descriptionInput.value = effect.description || effect.text || effect.name || '';

    const durationInput = document.createElement('input');
    durationInput.type = 'text';
    durationInput.className = 'thing-edit-status-duration';
    durationInput.placeholder = 'Duration';
    if (effect.duration !== undefined && effect.duration !== null && effect.duration !== '') {
      durationInput.value = String(effect.duration);
    }

    const modifiersContainer = document.createElement('div');
    modifiersContainer.className = 'thing-modifier-list';
    const addModifierBtn = document.createElement('button');
    addModifierBtn.type = 'button';
    addModifierBtn.className = 'npc-edit-add-btn';
    addModifierBtn.textContent = 'Add Modifier';
    addModifierBtn.addEventListener('click', () => {
      modifiersContainer.appendChild(playerStatusModifierTemplates.createRow(null));
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'npc-edit-remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(descriptionInput);
    row.appendChild(durationInput);
    row.appendChild(modifiersContainer);
    row.appendChild(addModifierBtn);
    row.appendChild(removeBtn);

    playerStatusEffectsList.appendChild(row);

    const existingModifiers = [
      ...(Array.isArray(effect.attributes) ? effect.attributes.map(entry => ({ attribute: entry.attribute || entry.name, modifier: entry.modifier })) : []),
      ...(Array.isArray(effect.skills) ? effect.skills.map(entry => ({ skill: entry.skill || entry.name, modifier: entry.modifier })) : [])
    ];
    playerStatusModifierTemplates.renderList(modifiersContainer, existingModifiers);

    return row;
  }

  function renderPlayerStatusEffects(effects = []) {
    if (!playerStatusEffectsList) {
      return;
    }
    playerStatusEffectsList.innerHTML = '';
    const entries = Array.isArray(effects) ? effects : [];
    if (!entries.length) {
      createPlayerStatusEffectRow({});
      return;
    }
    entries.forEach(effect => createPlayerStatusEffectRow(effect));
  }

  function collectPlayerStatusEffects() {
    if (!playerStatusEffectsList) {
      return [];
    }
    const effects = [];
    playerStatusEffectsList.querySelectorAll('.thing-edit-status-row').forEach(row => {
      const description = row.querySelector('.thing-edit-status-description')?.value?.trim();
      if (!description) {
        return;
      }
      const durationRaw = row.querySelector('.thing-edit-status-duration')?.value?.trim();
      const effect = { description };
      if (durationRaw) {
        const numeric = Number.parseInt(durationRaw, 10);
        effect.duration = Number.isFinite(numeric) ? numeric : durationRaw;
      }
      const modifierContainer = row.querySelector('.thing-modifier-list');
      const modifiers = playerStatusModifierTemplates.collect(modifierContainer);
      if (modifiers.attributes.length) {
        effect.attributes = modifiers.attributes;
      }
      if (modifiers.skills.length) {
        effect.skills = modifiers.skills;
      }
      effects.push(effect);
    });
    return effects;
  }


  function resolveAttributeKey(attributes = {}, key = '') {
    if (!key) {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(attributes, key)) {
      return key;
    }
    const lowered = key.toLowerCase();
    for (const candidate of Object.keys(attributes)) {
      if (candidate && candidate.toLowerCase() === lowered) {
        return candidate;
      }
    }
    return null;
  }

  function calculateMaxHealthValue(levelInput, attributes = {}, healthAttribute = DEFAULT_HEALTH_ATTRIBUTE) {
    const levelNumeric = Number(levelInput);
    const level = Number.isFinite(levelNumeric) && levelNumeric >= 1 ? Math.round(levelNumeric) : 1;
    const attributeKey = typeof healthAttribute === 'string' && healthAttribute.trim()
      ? healthAttribute.trim()
      : DEFAULT_HEALTH_ATTRIBUTE;
    const resolvedKey = resolveAttributeKey(attributes, attributeKey) || resolveAttributeKey(attributes, DEFAULT_HEALTH_ATTRIBUTE);
    const attributeValueRaw = resolvedKey ? attributes[resolvedKey] : undefined;
    const attributeNumeric = Number(attributeValueRaw);
    const attributeValue = Number.isFinite(attributeNumeric) ? attributeNumeric : 10;
    const computed = Math.floor(10 + (attributeValue / 2) * (level + 1));
    return Number.isFinite(computed) ? Math.max(1, computed) : null;
  }

  function getFormAttributeValues() {
    const attributes = {};
    const attributeInputs = document.querySelectorAll('.attribute-input');
    attributeInputs.forEach(input => {
      if (!input || !input.name) {
        return;
      }
      const rawName = input.name.replace('attributes.', '').trim();
      if (!rawName) {
        return;
      }
      const numeric = Number.parseInt(input.value ?? '', 10);
      if (Number.isFinite(numeric)) {
        attributes[rawName] = numeric;
      }
    });
    return attributes;
  }

  function updateMaxHealthDisplayFromForm() {
    const display = document.getElementById(MAX_HEALTH_DISPLAY_ID);
    if (!display) {
      return;
    }
    const levelField = document.getElementById('player-level');
    const levelValue = levelField ? Number.parseInt(levelField.value ?? '', 10) : null;
    const attributes = getFormAttributeValues();
    const computed = calculateMaxHealthValue(levelValue, attributes, playerHealthAttributeKey);
    display.textContent = Number.isFinite(computed) ? computed : '—';
  }

  function updateMaxHealthDisplayFromData(playerData = {}) {
    const display = document.getElementById(MAX_HEALTH_DISPLAY_ID);
    if (!display) {
      return;
    }
    const numeric = Number.parseInt(playerData.maxHealth ?? '', 10);
    display.textContent = Number.isFinite(numeric) ? numeric : '—';
  }

  // Initialize attribute modifier calculations
  initializeAttributeModifiers();

  // Setup event listeners
  setupFormHandlers();
  setupAttributeModifiers();
  if (resetButton) {
    setupResetButton();
  }
  if (playerStatusEffectAddBtn) {
    playerStatusEffectAddBtn.addEventListener('click', () => {
      const row = createPlayerStatusEffectRow({});
      row?.querySelector('.thing-edit-status-description')?.focus();
    });
  }

  const levelInput = document.getElementById('player-level');
  if (levelInput) {
    levelInput.addEventListener('input', updateMaxHealthDisplayFromForm);
    levelInput.addEventListener('change', updateMaxHealthDisplayFromForm);
  }

  updateMaxHealthDisplayFromForm();
  renderPlayerStatusEffects([]);
  primePlayerStatusEffects();

  /**
   * Setup form submission handler
   */
  function setupFormHandlers() {
    form.addEventListener('submit', handleFormSubmission);
  }

  /**
   * Setup real-time attribute modifier calculation
   */
  function setupAttributeModifiers() {
    const attributeInputs = document.querySelectorAll('.attribute-input');
    attributeInputs.forEach(input => {
      input.addEventListener('input', updateAttributeModifier);
      input.addEventListener('change', updateAttributeModifier);
      input.addEventListener('input', updateMaxHealthDisplayFromForm);
      input.addEventListener('change', updateMaxHealthDisplayFromForm);
    });
  }

  /**
   * Setup reset button functionality
   */
  function setupResetButton() {
    resetButton.addEventListener('click', function () {
      if (confirm('Are you sure you want to reset all stats to default values? This action cannot be undone.')) {
        resetToDefaults();
      }
    });
  }

  /**
   * Handle form submission
   */
  async function handleFormSubmission(event) {
    event.preventDefault();

    const formData = new FormData(form);
    const playerData = {};

    // Extract basic information
    playerData.name = formData.get('name');
    playerData.description = formData.get('description');
    playerData.level = parseInt(formData.get('level'));
    playerData.health = parseInt(formData.get('health'));
    if (playerHealthAttributeKey) {
      playerData.healthAttribute = playerHealthAttributeKey;
    }

    // Extract attributes
    playerData.attributes = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('attributes.')) {
        const attrName = key.replace('attributes.', '');
        playerData.attributes[attrName] = parseInt(value);
      }
    }

    // Extract skills
    playerData.skills = {};
    const skillInputs = document.querySelectorAll('.skill-input');
    skillInputs.forEach(input => {
      const skillName = input.dataset.skillName || input.name.replace('skills.', '');
      if (!skillName) return;
      const value = parseInt(input.value);
      if (!isNaN(value)) {
        playerData.skills[skillName] = value;
      }
    });

    // Extract unspent skill points
    const unspentField = document.getElementById('unspent-skill-points-input');
    if (unspentField) {
      const points = parseInt(unspentField.value);
      if (!isNaN(points)) {
        playerData.unspentSkillPoints = points;
      }
    }

    playerData.statusEffects = collectPlayerStatusEffects();

    playerData.calculatedMaxHealth = calculateMaxHealthValue(playerData.level, playerData.attributes, playerHealthAttributeKey);

    // Validate form data
    const validation = validatePlayerData(playerData);
    if (!validation.valid) {
      showStatusMessage(validation.message, 'error');
      return;
    }

    // Determine if we're updating or creating
    const isUpdate = await hasCurrentPlayer();
    const endpoint = isUpdate ? '/api/player/update-stats' : '/api/player/create-from-stats';

    try {
      showStatusMessage(isUpdate ? 'Updating player stats...' : 'Creating new player...', 'info');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(playerData)
      });

      const result = await response.json();

      if (result.success) {
        showStatusMessage(result.message || 'Player stats saved successfully!', 'success');

        // Update the form with any calculated values
        updateFormWithPlayerData(result.player);

        if (result.imageNeedsUpdate && result.player?.id && window.AIRPG?.imageManager) {
          window.AIRPG.imageManager.ensureImage({
            entityType: 'player',
            entityId: result.player.id,
            force: true
          }).catch(error => {
            console.warn('Failed to queue player portrait regeneration:', error);
          });
        }

        // If this was a new player creation, reload the page to show update mode
        if (!isUpdate) {
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        }
      } else {
        showStatusMessage(result.error || 'Failed to save player stats', 'error');
      }
    } catch (error) {
      console.error('Error saving player stats:', error);
      showStatusMessage('Network error - unable to save player stats', 'error');
    }
  }

  /**
   * Update attribute modifier display when value changes
   */
  function updateAttributeModifier(event) {
    const input = event.target;
    const attrName = input.name.replace('attributes.', '');
    const value = parseInt(input.value) || 10;
    const modifier = Math.floor((value - 10) / 2);

    const modifierElement = document.querySelector(`[data-attr="${attrName}"]`);
    if (modifierElement) {
      modifierElement.textContent = modifier >= 0 ? `+${modifier}` : `${modifier}`;

      // Update modifier styling
      modifierElement.className = 'attribute-modifier';
      if (modifier > 0) {
        modifierElement.classList.add('positive');
      } else if (modifier < 0) {
        modifierElement.classList.add('negative');
      }
    }
  }

  /**
   * Initialize all attribute modifiers on page load
   */
  function initializeAttributeModifiers() {
    const attributeInputs = document.querySelectorAll('.attribute-input');
    attributeInputs.forEach(input => {
      updateAttributeModifier({ target: input });
    });
  }

  /**
   * Validate player data before submission
   */
  function validatePlayerData(data) {
    // Check required fields
    if (!data.name || data.name.trim().length === 0) {
      return { valid: false, message: 'Player name is required' };
    }

    if (data.name.trim().length > 50) {
      return { valid: false, message: 'Player name must be 50 characters or less' };
    }

    // Validate level
    if (isNaN(data.level) || data.level < 1 || data.level > 20) {
      return { valid: false, message: 'Level must be between 1 and 20' };
    }

    // Validate health
    if (isNaN(data.health) || data.health < 0) {
      return { valid: false, message: 'Current health must be 0 or greater' };
    }

    // Validate attributes
    for (const [name, value] of Object.entries(data.attributes)) {
      if (isNaN(value) || value < 3 || value > 18) {
        return { valid: false, message: `${name} must be between 3 and 18` };
      }
    }

    if (data.skills) {
      for (const [skillName, value] of Object.entries(data.skills)) {
        if (isNaN(value) || value < 0) {
          return { valid: false, message: `${skillName} rank must be a non-negative number` };
        }
      }
    }

    if (data.unspentSkillPoints !== undefined) {
      if (isNaN(data.unspentSkillPoints) || data.unspentSkillPoints < 0) {
        return { valid: false, message: 'Unspent skill points must be zero or greater' };
      }
    }

    return { valid: true };
  }

  /**
   * Check if there's already a current player
   */
  async function hasCurrentPlayer() {
    try {
      const response = await fetch('/api/player');
      const result = await response.json();
      return result.success && result.player !== null;
    } catch (error) {
      console.error('Error checking current player:', error);
      // Fallback to form-based detection
      const nameField = document.getElementById('player-name');
      return nameField && nameField.value.trim().length > 0 &&
        nameField.value !== 'New Player' && nameField.value !== '';
    }
  }

  /**
   * Update form fields with player data from server response
   */
  function updateFormWithPlayerData(playerData) {
    if (!playerData) return;

    // Update basic fields
    const nameField = document.getElementById('player-name');
    const descField = document.getElementById('player-description');
    const levelField = document.getElementById('player-level');
    const healthField = document.getElementById('player-health');

    if (nameField) nameField.value = playerData.name || '';
    if (descField) descField.value = playerData.description || '';
    if (levelField) levelField.value = playerData.level || 1;
    if (healthField) healthField.value = playerData.health || 25;

    if (playerData.healthAttribute) {
      playerHealthAttributeKey = playerData.healthAttribute.toString().trim().toLowerCase() || DEFAULT_HEALTH_ATTRIBUTE;
    } else {
      playerHealthAttributeKey = DEFAULT_HEALTH_ATTRIBUTE;
    }

    updateMaxHealthDisplayFromData(playerData);

    // Update attribute fields
    if (playerData.attributes) {
      for (const [attrName, value] of Object.entries(playerData.attributes)) {
        const input = document.getElementById(`attr-${attrName}`);
        if (input) {
          input.value = value;
          updateAttributeModifier({ target: input });
        }
      }
    }

    if (playerData.skills) {
      for (const [skillName, value] of Object.entries(playerData.skills)) {
        const input = document.querySelector(`.skill-input[data-skill-name="${skillName}"]`);
        if (input) {
          input.value = value;
        }
      }
    }

    renderAbilities(playerData.abilities || []);
    renderPlayerStatusEffects(playerData.statusEffects || []);

    const unspentField = document.getElementById('unspent-skill-points-input');
    if (unspentField) {
      const nextValue = playerData.unspentSkillPoints ? parseInt(unspentField.value) : 0;
      unspentField.value = nextValue;
      unspentField.dataset.default = nextValue;
    }

    updateMaxHealthDisplayFromForm();
  }

  /**
   * Reset form to default values
   */
  function resetToDefaults() {
    // Reset basic fields to defaults
    document.getElementById('player-name').value = '';
    document.getElementById('player-description').value = '';
    document.getElementById('player-level').value = '1';
    document.getElementById('player-health').value = '25';
    playerHealthAttributeKey = DEFAULT_HEALTH_ATTRIBUTE;

    // Reset all attributes to 10
    const attributeInputs = document.querySelectorAll('.attribute-input');
    attributeInputs.forEach(input => {
      input.value = '10';
      updateAttributeModifier({ target: input });
    });

    const skillInputs = document.querySelectorAll('.skill-input');
    skillInputs.forEach(input => {
      input.value = '1';
    });

    const unspentField = document.getElementById('unspent-skill-points-input');
    if (unspentField) {
      const defaultPoints = parseInt(unspentField.dataset.default) || 0;
      unspentField.value = defaultPoints;
    }

    renderAbilities([]);
    renderPlayerStatusEffects([]);
    showStatusMessage('Stats reset to default values', 'info');
    updateMaxHealthDisplayFromForm();
  }

  /**
   * Show status message to user
   */
  function showStatusMessage(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';

    // Auto-hide success and info messages after 5 seconds
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        statusMessage.style.display = 'none';
      }, 5000);
    }
  }

  /**
   * Utility function to escape HTML in user input
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  async function primePlayerStatusEffects() {
    if (!playerStatusEffectsList) {
      return;
    }
    try {
      const response = await fetch('/api/player');
      const data = await response.json();
      if (response.ok && data?.success && data.player) {
        updateFormWithPlayerData(data.player);
        return;
      }
    } catch (error) {
      console.warn('Failed to fetch player for status effects:', error);
    }
    renderPlayerStatusEffects([]);
  }

  function renderAbilities(abilities = []) {
    if (!abilitiesList || !abilitiesEmpty) {
      return;
    }

    abilitiesList.innerHTML = '';

    if (Array.isArray(abilities) && abilities.length) {
      abilities.forEach(ability => {
        const card = document.createElement('div');
        const abilityType = typeof ability.type === 'string' ? ability.type.toLowerCase() : 'passive';
        card.className = `ability-card ability-type-${abilityType}`;

        const header = document.createElement('div');
        header.className = 'ability-header';

        const nameEl = document.createElement('span');
        nameEl.className = 'ability-name';
        nameEl.textContent = ability.name || 'Unnamed Ability';

        const metaEl = document.createElement('span');
        metaEl.className = 'ability-meta';
        const metaParts = [];
        metaParts.push((ability.type || 'Passive'));
        if (ability.level) {
          metaParts.push(`Level ${ability.level}`);
        }
        metaEl.textContent = metaParts.join(' • ');

        header.appendChild(nameEl);
        header.appendChild(metaEl);

        card.appendChild(header);

        if (ability.description) {
          const descEl = document.createElement('div');
          descEl.className = 'ability-description';
          descEl.textContent = ability.description;
          card.appendChild(descEl);
        }

        abilitiesList.appendChild(card);
      });

      abilitiesEmpty.hidden = true;
    } else {
      abilitiesEmpty.hidden = false;
    }

    if (abilitiesSection) {
      abilitiesSection.classList.toggle('has-abilities', Array.isArray(abilities) && abilities.length > 0);
    }
  }
});
