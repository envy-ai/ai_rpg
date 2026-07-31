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

  function buildAssetRow(asset = {}) {
    const row = document.createElement('div');
    row.className = 'faction-asset-row';

    const nameField = document.createElement('input');
    nameField.type = 'text';
    nameField.placeholder = 'Asset name';
    nameField.value = asset.name || '';
    nameField.className = 'faction-asset-name';

    const typeField = document.createElement('input');
    typeField.type = 'text';
    typeField.placeholder = 'Type';
    typeField.value = asset.type || '';
    typeField.className = 'faction-asset-type';

    const descField = document.createElement('textarea');
    descField.rows = 2;
    descField.placeholder = 'Short description';
    descField.value = asset.description || '';
    descField.className = 'faction-asset-description';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn-link btn-sm';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => row.remove());

    row.appendChild(nameField);
    row.appendChild(typeField);
    row.appendChild(descField);
    row.appendChild(removeButton);
    return row;
  }

  function buildTierRow(tier = {}) {
    const row = document.createElement('div');
    row.className = 'faction-tier-row';

    const thresholdField = document.createElement('input');
    thresholdField.type = 'number';
    thresholdField.placeholder = 'Threshold';
    thresholdField.value = Number.isFinite(Number(tier.threshold)) ? tier.threshold : '';
    thresholdField.className = 'faction-tier-threshold';

    const labelField = document.createElement('input');
    labelField.type = 'text';
    labelField.placeholder = 'Label';
    labelField.value = tier.label || '';
    labelField.className = 'faction-tier-label';

    const perksField = document.createElement('textarea');
    perksField.rows = 2;
    perksField.placeholder = 'Perks (one per line)';
    perksField.value = joinList(tier.perks || []);
    perksField.className = 'faction-tier-perks';

    const penaltiesField = document.createElement('textarea');
    penaltiesField.rows = 2;
    penaltiesField.placeholder = 'Penalties (one per line)';
    penaltiesField.value = joinList(tier.penalties || []);
    penaltiesField.className = 'faction-tier-penalties';

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'btn btn-link btn-sm';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => row.remove());

    row.appendChild(thresholdField);
    row.appendChild(labelField);
    row.appendChild(perksField);
    row.appendChild(penaltiesField);
    row.appendChild(removeButton);
    return row;
  }

  function buildRelationRow(targetFaction, relation) {
    const row = document.createElement('div');
    row.className = 'faction-relation-row';
    row.dataset.targetId = targetFaction.id;

    const nameField = document.createElement('div');
    nameField.className = 'faction-relation-name';
    nameField.textContent = targetFaction.name || targetFaction.id;

    const statusField = document.createElement('select');
    statusField.className = 'faction-relation-status';
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

    const notesField = document.createElement('textarea');
    notesField.rows = 2;
    notesField.placeholder = 'Relationship notes';
    notesField.className = 'faction-relation-notes';
    notesField.value = relation?.notes || '';
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
    row.appendChild(statusField);
    row.appendChild(notesField);
    row.appendChild(clearButton);
    return row;
  }

  function collectAssetsFrom(container, {
    missingNameMessage = 'All assets must include a name.'
  } = {}) {
    if (!container) {
      return [];
    }
    const rows = Array.from(container.querySelectorAll('.faction-asset-row'));
    return rows.map(row => {
      const name = row.querySelector('.faction-asset-name')?.value?.trim() || '';
      const type = row.querySelector('.faction-asset-type')?.value?.trim() || '';
      const description = row.querySelector('.faction-asset-description')?.value?.trim() || '';
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
    const rows = Array.from(container.querySelectorAll('.faction-tier-row'));
    return rows.map(row => {
      const thresholdRaw = row.querySelector('.faction-tier-threshold')?.value?.trim() || '';
      const label = row.querySelector('.faction-tier-label')?.value?.trim() || '';
      const perks = splitList(row.querySelector('.faction-tier-perks')?.value || '');
      const penalties = splitList(row.querySelector('.faction-tier-penalties')?.value || '');
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
    buildAssetRow,
    buildTierRow,
    buildRelationRow,
    collectAssetsFrom,
    collectRelationsFrom,
    collectTiersFrom
  };
});
