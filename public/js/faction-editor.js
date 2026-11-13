(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FactionEditor = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
  function splitList(value) {
    if (typeof value !== 'string') {
      return [];
    }
    return value
      .split(/[\n,]+/)
      .map(entry => entry.trim())
      .filter(Boolean);
  }

  function joinList(entries) {
    if (!Array.isArray(entries)) {
      return '';
    }
    return entries.join('\n');
  }

  function normalizeRelationStatus(value) {
    const status = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!status) {
      return '';
    }
    if (!['allied', 'neutral', 'hostile', 'rival'].includes(status)) {
      throw new Error(`Invalid relation status "${value}".`);
    }
    return status;
  }

  function trimRelationStatus(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function resolveStandingTierLabel(value, tiers = []) {
    if (!Number.isFinite(value)) {
      return '—';
    }
    const sorted = Array.isArray(tiers)
      ? tiers.slice().sort((a, b) => Number(a.threshold) - Number(b.threshold))
      : [];
    let resolved = null;
    for (const tier of sorted) {
      const threshold = Number(tier?.threshold);
      if (!Number.isFinite(threshold)) {
        continue;
      }
      if (value >= threshold) {
        resolved = tier;
      } else {
        break;
      }
    }
    return resolved?.label || '—';
  }

  const rowGroups = new WeakMap();
  function rowGroup(container, kind) {
    let owner = rowGroups.get(container);
    if (owner && owner.kind !== kind) throw new Error(`Faction row root already owns ${owner.kind} rows.`);
    if (!owner) {
      owner = { kind, rows: new globalThis.AIRPG_WIDGETS.ReaderRows(container) };
      rowGroups.set(container, owner);
    }
    return owner.rows;
  }

  function nativeField(label, className, value, type = 'text', placeholder = label) {
    return globalThis.AIRPG_WIDGETS.createField({
      label, inputClass: className, className: 'form-group form-row-field',
      value, type, placeholder, rows: 2
    });
  }

  function appendAssetRow(container, asset = {}) {
    const row = container.ownerDocument.createElement('div');
    row.className = 'faction-asset-row';
    const name = nativeField('Asset name', 'faction-asset-name', asset.name || '');
    const type = nativeField('Type', 'faction-asset-type', asset.type || '');
    const description = nativeField('Short description', 'faction-asset-description', asset.description || '', 'textarea');
    const remove = container.ownerDocument.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-link btn-sm';
    remove.textContent = 'Remove';
    row.append(name.field, type.field, description.field, remove);
    rowGroup(container, 'assets').add(row, () => ({
      name: name.input.value.trim(), type: type.input.value.trim(), description: description.input.value.trim()
    }), { removeButton: remove });
    return row;
  }

  function appendTierRow(container, tier = {}) {
    const row = container.ownerDocument.createElement('div');
    row.className = 'faction-tier-row';
    const threshold = nativeField('Threshold', 'faction-tier-threshold', Number.isFinite(Number(tier.threshold)) ? tier.threshold : '', 'number');
    const label = nativeField('Label', 'faction-tier-label', tier.label || '');
    const perks = nativeField('Perks (one per line)', 'faction-tier-perks', joinList(tier.perks || []), 'textarea');
    const penalties = nativeField('Penalties (one per line)', 'faction-tier-penalties', joinList(tier.penalties || []), 'textarea');
    const remove = container.ownerDocument.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-link btn-sm';
    remove.textContent = 'Remove';
    row.append(threshold.field, label.field, perks.field, penalties.field, remove);
    rowGroup(container, 'tiers').add(row, () => ({
      thresholdRaw: threshold.input.value.trim(), label: label.input.value.trim(),
      perks: splitList(perks.input.value), penalties: splitList(penalties.input.value)
    }), { removeButton: remove });
    return row;
  }

  function clearAssetRows(container) { rowGroup(container, 'assets').clear(); }
  function clearTierRows(container) { rowGroup(container, 'tiers').clear(); }

  const FAVOR_EFFECT_TYPES = ['none', 'reveal-route', 'grant-item', 'grant-currency', 'fast-travel', 'restore-needs'];
  const FAVOR_EFFECT_PARAM_HINTS = {
    'none': '',
    'reveal-route': '{}',
    'grant-item': '{ "name": "Item name", "description": "What it is" }',
    'grant-currency': '{ "amount": 50 }',
    'fast-travel': '{}',
    'restore-needs': '{ "bars": [{ "needBar": "Rest", "percentage": 100 }] }'
  };

  function formatCooldownMinutes(minutes) {
    const value = Number(minutes);
    if (!Number.isSafeInteger(value) || value <= 0) return '';
    if (value % 1440 === 0) return `${value / 1440} ${value === 1440 ? 'day' : 'days'}`;
    if (value % 60 === 0) return `${value / 60} ${value === 60 ? 'hour' : 'hours'}`;
    return `${value} ${value === 1 ? 'minute' : 'minutes'}`;
  }

  function selectField(label, className, options, value) {
    const created = nativeField(label, className, '', 'select');
    options.forEach(option => {
      const element = created.input.ownerDocument.createElement('option');
      element.value = option.value;
      element.textContent = option.label;
      created.input.appendChild(element);
    });
    created.input.value = value;
    return created;
  }

  function appendFavorRow(container, favor = {}) {
    const doc = container.ownerDocument;
    const row = doc.createElement('div');
    row.className = 'faction-favor-row';
    const name = nativeField('Favor name', 'faction-favor-name', favor.name || '');
    const shortDescription = nativeField('Short description', 'faction-favor-short-description', favor.shortDescription || '');
    const description = nativeField('Description', 'faction-favor-description', favor.description || '', 'textarea');
    const minThreshold = nativeField('Required tier threshold', 'faction-favor-threshold',
      Number.isFinite(Number(favor.minThreshold)) ? favor.minThreshold : '', 'number');
    const cooldown = nativeField('Cooldown (e.g. 3 days)', 'faction-favor-cooldown', formatCooldownMinutes(favor.cooldownMinutes) || favor.cooldown || '');
    const presence = selectField('Where usable', 'faction-favor-presence', [
      { value: 'anywhere', label: 'Anywhere' },
      { value: 'faction-presence', label: 'Where the faction has a presence' }
    ], favor.presence || 'anywhere');
    const requiresTarget = selectField('Needs a target', 'faction-favor-requires-target', [
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Yes' }
    ], favor.requiresTarget ? 'true' : 'false');
    const targetPrompt = nativeField('Target hint', 'faction-favor-target-prompt', favor.targetPrompt || '');
    const effectType = selectField('Guaranteed effect', 'faction-favor-effect-type',
      FAVOR_EFFECT_TYPES.map(type => ({ value: type, label: type })), favor.effect?.type || 'none');
    const effectParams = nativeField('Effect details (JSON)', 'faction-favor-effect-params',
      favor.effect ? JSON.stringify(favor.effect.params || {}) : '', 'textarea',
      FAVOR_EFFECT_PARAM_HINTS[favor.effect?.type || 'none'] || '');
    effectType.input.addEventListener('change', () => {
      effectParams.input.placeholder = FAVOR_EFFECT_PARAM_HINTS[effectType.input.value] || '';
    });
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-link btn-sm';
    remove.textContent = 'Remove';
    row.append(name.field, shortDescription.field, description.field, minThreshold.field, cooldown.field,
      presence.field, requiresTarget.field, targetPrompt.field, effectType.field, effectParams.field, remove);
    const favorId = typeof favor.id === 'string' ? favor.id : '';
    rowGroup(container, 'favors').add(row, () => ({
      id: favorId,
      name: name.input.value.trim(),
      shortDescription: shortDescription.input.value.trim(),
      description: description.input.value.trim(),
      minThresholdRaw: minThreshold.input.value.trim(),
      cooldown: cooldown.input.value.trim(),
      presence: presence.input.value,
      requiresTarget: requiresTarget.input.value === 'true',
      targetPrompt: targetPrompt.input.value.trim(),
      effectType: effectType.input.value,
      effectParamsRaw: effectParams.input.value.trim()
    }), { removeButton: remove });
    return row;
  }

  function clearFavorRows(container) { rowGroup(container, 'favors').clear(); }

  function collectFavorsFrom(container) {
    if (!container) {
      return [];
    }
    return rowGroup(container, 'favors').read().map((row, index) => {
      const isBlank = !row.name && !row.shortDescription && !row.description && !row.minThresholdRaw && !row.cooldown;
      if (isBlank) return null;
      const label = row.name ? `Favor "${row.name}"` : `Favor ${index + 1}`;
      let effect = null;
      if (row.effectType && row.effectType !== 'none') {
        let params = {};
        if (row.effectParamsRaw) {
          try {
            params = JSON.parse(row.effectParamsRaw);
          } catch (error) {
            throw new Error(`${label} effect details must be valid JSON, for example ${FAVOR_EFFECT_PARAM_HINTS[row.effectType] || '{}'}.`);
          }
        }
        effect = { type: row.effectType, params };
      }
      const favor = {
        name: row.name,
        shortDescription: row.shortDescription,
        description: row.description,
        minThreshold: row.minThresholdRaw === '' ? null : Number(row.minThresholdRaw),
        cooldown: row.cooldown,
        presence: row.presence,
        requiresTarget: row.requiresTarget,
        targetPrompt: row.targetPrompt,
        effect
      };
      if (row.id) favor.id = row.id;
      return favor;
    }).filter(Boolean);
  }

  function buildRelationRow(targetFaction, relation) {
    const row = document.createElement('div');
    row.className = 'faction-relation-row';
    row.dataset.targetId = targetFaction.id;

    const nameField = document.createElement('div');
    nameField.className = 'faction-relation-name';
    nameField.textContent = targetFaction.name || targetFaction.id;

    const status = nativeField('Relationship', 'faction-relation-status', '', 'select');
    const statusField = status.input;
    [
      { value: '', label: 'None' },
      { value: 'allied', label: 'Allied' },
      { value: 'neutral', label: 'Neutral' },
      { value: 'hostile', label: 'Hostile' },
      { value: 'rival', label: 'Rival' }
    ].forEach(option => {
      const opt = document.createElement('option');
      opt.value = option.value;
      opt.textContent = option.label;
      statusField.appendChild(opt);
    });
    statusField.value = relation?.status || '';

    const notes = nativeField('Relationship notes', 'faction-relation-notes', relation?.notes || '', 'textarea');
    const notesField = notes.input;
    notesField.disabled = !statusField.value;

    statusField.addEventListener('change', () => {
      const hasStatus = Boolean(statusField.value);
      notesField.disabled = !hasStatus;
      if (!hasStatus) {
        notesField.value = '';
      }
    });

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'btn btn-link btn-sm';
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', () => {
      statusField.value = '';
      notesField.value = '';
      notesField.disabled = true;
    });

    row.appendChild(nameField);
    row.appendChild(status.field);
    row.appendChild(notes.field);
    row.appendChild(clearButton);
    return row;
  }

  function collectAssetsFrom(container, {
    missingNameMessage = 'All assets must include a name.'
  } = {}) {
    if (!container) {
      return [];
    }
    const rows = rowGroup(container, 'assets').read();
    return rows.map(({ name, type, description }) => {
      if (!name && !type && !description) {
        return null;
      }
      if (!name) {
        throw new Error(missingNameMessage);
      }
      const asset = { name };
      if (type) asset.type = type;
      if (description) asset.description = description;
      return asset;
    }).filter(Boolean);
  }

  function collectRelationsFrom(container, {
    normalizeStatus = trimRelationStatus,
    missingNotesMessage = 'All relations with a status require notes.'
  } = {}) {
    if (!container) {
      return {};
    }
    const rows = Array.from(container.querySelectorAll('.faction-relation-row'));
    const relations = {};
    rows.forEach(row => {
      const targetId = row.dataset.targetId || '';
      const statusRaw = row.querySelector('.faction-relation-status')?.value || '';
      const status = normalizeStatus(statusRaw);
      const notes = row.querySelector('.faction-relation-notes')?.value?.trim() || '';
      if (!status) {
        return;
      }
      if (!notes) {
        throw new Error(missingNotesMessage);
      }
      relations[targetId] = { status, notes };
    });
    return relations;
  }

  function collectTiersFrom(container, {
    invalidThresholdMessage = 'Reputation tiers require a numeric threshold.'
  } = {}) {
    if (!container) {
      return [];
    }
    const rows = rowGroup(container, 'tiers').read();
    return rows.map(({ thresholdRaw, label, perks, penalties }) => {
      if (!thresholdRaw && !label && perks.length === 0 && penalties.length === 0) {
        return null;
      }
      const threshold = Number(thresholdRaw);
      if (!Number.isFinite(threshold)) {
        throw new Error(invalidThresholdMessage);
      }
      return {
        threshold,
        label,
        perks,
        penalties
      };
    }).filter(Boolean);
  }

  return {
    splitList,
    joinList,
    normalizeRelationStatus,
    resolveStandingTierLabel,
    appendAssetRow,
    appendTierRow,
    clearAssetRows,
    clearTierRows,
    appendFavorRow,
    clearFavorRows,
    collectFavorsFrom,
    formatCooldownMinutes,
    buildRelationRow,
    collectAssetsFrom,
    collectRelationsFrom,
    collectTiersFrom
  };
});
