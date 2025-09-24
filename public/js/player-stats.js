// Player Stats Configuration JavaScript

document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('player-stats-form');
  const statusMessage = document.getElementById('status-message');
  const resetButton = document.getElementById('reset-stats');
  const abilitiesSection = document.getElementById('abilitiesSection');
  const abilitiesList = document.getElementById('abilitiesList');
  const abilitiesEmpty = document.getElementById('abilitiesEmpty');

  // Initialize attribute modifier calculations
  initializeAttributeModifiers();

  // Setup event listeners
  setupFormHandlers();
  setupAttributeModifiers();
  if (resetButton) {
    setupResetButton();
  }

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
    playerData.maxHealth = parseInt(formData.get('maxHealth'));

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

    if (isNaN(data.maxHealth) || data.maxHealth < 1) {
      return { valid: false, message: 'Maximum health must be 1 or greater' };
    }

    if (data.health > data.maxHealth) {
      return { valid: false, message: 'Current health cannot exceed maximum health' };
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
    const maxHealthField = document.getElementById('player-max-health');

    if (nameField) nameField.value = playerData.name || '';
    if (descField) descField.value = playerData.description || '';
    if (levelField) levelField.value = playerData.level || 1;
    if (healthField) healthField.value = playerData.health || 25;
    if (maxHealthField) maxHealthField.value = playerData.maxHealth || 25;

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

    const unspentField = document.getElementById('unspent-skill-points-input');
    if (unspentField) {
      const nextValue = playerData.unspentSkillPoints ? parseInt(unspentField.value) : 0;
      unspentField.value = nextValue;
      unspentField.dataset.default = nextValue;
    }
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
    document.getElementById('player-max-health').value = '25';

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
    showStatusMessage('Stats reset to default values', 'info');
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
