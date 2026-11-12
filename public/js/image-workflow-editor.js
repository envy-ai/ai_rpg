(() => {
  'use strict';

  const TYPES = ['character', 'item', 'scenery', 'location', 'faction'];
  const options = {
    model: [],
    text_encoder: [],
    text_encoder_type: [],
    vae: [],
    sampler: [],
    scheduler: [],
    loras: [],
    workflows: [],
    presets: { generation: {}, edit: {} }
  };
  let availableLoras = null;
  const controllers = [];

  const defaultsFor = mode => ({
    family: mode === 'edit' ? 'flux_klein' : 'krea2',
    custom_template: '',
    model: '',
    text_encoder: '',
    text_encoder_type: '',
    vae: '',
    loras: [],
    steps: 6,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'simple',
    denoise: 0.45,
    ...(mode === 'edit' ? { flux_kv_cache: true } : { resolutions: {} })
  });

  const normalizeSettings = (value, workflowMode) => {
    const defaults = defaultsFor(workflowMode);
    const supplied = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const loras = normalizeLoras(supplied.loras);
    if (workflowMode === 'edit') {
      const { resolutions: _discardedResolutions, ...settings } = supplied;
      return { ...defaults, ...settings, loras };
    }
    return { ...defaults, ...supplied, loras, resolutions: { ...(supplied.resolutions || {}) } };
  };

  const normalizeLoras = value => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new TypeError('loras must be a list. Use [] for no optional LoRAs.');
    return value.map((entry, index) => {
      const lora = typeof entry === 'string' ? { name: entry, strength: 1 } : entry;
      if (!lora || typeof lora.name !== 'string' || !lora.name.trim()) {
        throw new TypeError(`loras[${index}].name must be a nonempty LoRA filename. Choose a LoRA or remove this row.`);
      }
      if (typeof lora.strength !== 'number' || !Number.isFinite(lora.strength)) {
        throw new TypeError(`loras[${index}].strength must be a finite number. Enter a numeric strength, such as 1 or 0.`);
      }
      return { name: lora.name.trim(), strength: lora.strength };
    });
  };

  const parseSettings = (input, workflowMode) => {
    let parsed;
    try {
      parsed = JSON.parse(input.value || '{}');
    } catch (cause) {
      throw new Error(`Cannot read ${workflowMode} workflow settings: ${cause.message}`, { cause });
    }
    return normalizeSettings(parsed, workflowMode);
  };

  async function fetchJson(url, init) {
    const response = await fetch(url, { cache: 'no-store', ...init });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || payload.message || `HTTP ${response.status}`);
    }
    return payload;
  }

  async function loadOptions() {
    const [comfyResult, presetResult] = await Promise.allSettled([
      fetchJson('/api/comfyui/workflow-options').then(payload => {
        if (!Array.isArray(payload.loras)) {
          throw new Error('ComfyUI workflow options must include a LoRA list.');
        }
        return payload;
      }),
      fetchJson('/api/image-workflow-presets')
    ]);

    if (comfyResult.status === 'fulfilled') {
      Object.assign(options, comfyResult.value);
      availableLoras = new Set(options.loras);
    } else {
      console.warn('Live ComfyUI workflow options unavailable:', comfyResult.reason.message);
    }

    if (presetResult.status === 'fulfilled') {
      options.presets = presetResult.value.presets || { generation: {}, edit: {} };
    } else {
      console.warn('Image workflow presets unavailable:', presetResult.reason.message);
    }
  }

  function initPresetModal() {
    const modal = document.getElementById('imageWorkflowPresetModal');
    const title = document.getElementById('imageWorkflowPresetModalTitle');
    const input = document.getElementById('imageWorkflowPresetName');
    const error = document.getElementById('imageWorkflowPresetError');
    const confirm = document.getElementById('imageWorkflowPresetConfirm');
    const cancel = document.getElementById('imageWorkflowPresetCancel');
    const closeButton = document.getElementById('imageWorkflowPresetClose');
    if (!modal || !title || !input || !error || !confirm || !cancel || !closeButton) {
      throw new Error('Image workflow preset modal markup is incomplete.');
    }

    let pendingResolve = null;
    const clearError = () => {
      error.textContent = '';
      error.hidden = true;
    };
    const close = value => {
      window.AIRPG_MODAL_STACK.setVisible(modal, false);
      clearError();
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve?.(value);
    };
    const submit = () => {
      const name = input.value.trim();
      if (!name) {
        error.textContent = 'Preset name cannot be empty.';
        error.hidden = false;
        input.focus();
        return;
      }
      close(name);
    };

    confirm.addEventListener('click', submit);
    cancel.addEventListener('click', () => close(null));
    closeButton.addEventListener('click', () => close(null));
    input.addEventListener('input', clearError);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });
    window.AIRPG_MODAL_STACK.configure(modal, {
      onDismiss: () => close(null),
      escape: 'dismiss',
      trapFocus: false,
      dismissOnBackdrop: true
    });

    return {
      requestName(workflowMode) {
        if (pendingResolve) {
          throw new Error('An image workflow preset name is already being requested.');
        }
        title.textContent = `Save ${workflowMode === 'edit' ? 'Edit' : 'Generation'} Preset As`;
        input.value = '';
        clearError();
        window.AIRPG_MODAL_STACK.setVisible(modal, true);
        input.focus();
        return new Promise(resolve => {
          pendingResolve = resolve;
        });
      }
    };
  }

  function initMode(mode, presetModal) {
    const valueInput = mode.querySelector('[data-image-workflow-value]');
    if (!valueInput) return null;

    const workflowMode = mode.dataset.imageWorkflowMode;
    let state = parseSettings(valueInput, workflowMode);
    const controls = mode.querySelector('[data-image-workflow-controls]');
    const useGlobal = mode.querySelector('[data-image-workflow-use-global]');
    const widgets = {};
    const fields = new Map();
    const resolutionInputs = new Map();
    const presetSelect = mode.querySelector('[data-image-workflow-preset]');
    const presetStatus = mode.querySelector('[data-image-workflow-preset-status]');
    let loraEditor;

    const setPresetStatus = message => {
      if (presetStatus) window.AIRPG_WIDGETS.StatusSurface.attach(presetStatus).update({ text: String(message ?? ''), visible: true });
    };
    const sync = () => {
      valueInput.value = JSON.stringify(state);
      controls?.classList.toggle('is-muted', Boolean(useGlobal?.checked));
      controls?.querySelectorAll('input,select,button').forEach(element => {
        element.disabled = Boolean(useGlobal?.checked);
      });
      Object.values(widgets).forEach(widget => widget.setDisabled(Boolean(useGlobal?.checked)));
      loraEditor?.setDisabled(Boolean(useGlobal?.checked));
    };
    const updateConditionalFields = () => {
      const fluxKvCacheSetting = mode.querySelector('[data-flux-kv-cache-setting]');
      if (fluxKvCacheSetting) {
        fluxKvCacheSetting.hidden = state.family !== 'flux_klein' || Boolean(state.custom_template);
      }
      const warning = mode.querySelector('[data-image-workflow-warning]');
      if (warning) warning.hidden = state.family !== 'custom';
    };
    const select = (field, multiple = false) => {
      const root = mode.querySelector(`[data-image-workflow-select="${field}"]`);
      if (!root || !window.AIRPG_WIDGETS?.SearchableSelect) return;
      widgets[field] = new window.AIRPG_WIDGETS.SearchableSelect(root, {
        multiple,
        options: options[field],
        value: state[field],
        onChange: value => {
          state[field] = value;
          sync();
        }
      });
    };

    select('model');
    select('text_encoder');
    select('text_encoder_type');
    select('vae');
    select('sampler');
    select('scheduler');

    // Compose the registered row lifecycle and selector; workflow JSON owns
    // names/strengths while the shared widgets own their native interactions.
    const loraRows = mode.querySelector('[data-image-workflow-lora-rows]');
    const loraAddRoot = mode.querySelector('[data-image-workflow-lora-add-select]');
    const loraAdd = mode.querySelector('[data-image-workflow-lora-add]');
    const loraEmpty = mode.querySelector('[data-image-workflow-lora-empty]');
    const loraStatus = mode.querySelector('[data-image-workflow-lora-status]');
    if (!loraRows || !loraAddRoot || !loraAdd || !loraEmpty || !loraStatus) {
      throw new Error('Image workflow LoRA editor markup is incomplete.');
    }
    const loraByRow = new WeakMap();
    let lorasDisabled = false;
    const announceLoras = message => { loraStatus.textContent = message; };
    const updateLoraAvailability = () => {
      const selected = new Set(state.loras.map(lora => lora.name));
      if (selected.has(loraPicker.getValue())) loraPicker.setValue('');
      loraPicker.setOptions(options.loras.filter(name => !selected.has(name)));
      loraEmpty.hidden = state.loras.length > 0;
      loraAdd.disabled = lorasDisabled || !loraPicker.getValue();
    };
    const loraPicker = new window.AIRPG_WIDGETS.SearchableSelect(loraAddRoot, {
      emptyLabel: 'Choose a LoRA…',
      onChange: () => { loraAdd.disabled = lorasDisabled || !loraPicker.getValue(); }
    });
    const loraRepeater = new window.AIRPG_WIDGETS.Repeater(loraRows, {
      onChange: ({ action, row }) => {
        if (action !== 'remove') return;
        const removed = loraByRow.get(row);
        state.loras = Array.from(loraRows.children, current => loraByRow.get(current));
        updateLoraAvailability();
        sync();
        loraRows.dispatchEvent(new Event('input', { bubbles: true }));
        announceLoras(`Removed ${removed.name}.`);
        if (!loraRows.children.length) loraAddRoot.querySelector('input')?.focus();
      }
    });
    const addLoraRow = lora => {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const strengthCell = document.createElement('td');
      const actions = document.createElement('td');
      const strengthField = window.AIRPG_WIDGETS.createField({ label: 'Strength', type: 'number', className: 'image-workflow-loras__strength' });
      const strength = strengthField.input;
      strength.dataset.imageWorkflowLoraStrength = '';
      strength.step = 'any';
      strength.required = true;
      strength.value = lora.strength;
      strength.setAttribute('aria-label', `Strength for ${lora.name}`);
      strength.addEventListener('input', () => {
        strength.setCustomValidity('');
        if (strength.value === '' || !Number.isFinite(strength.valueAsNumber)) {
          strength.setCustomValidity(`Strength for ${lora.name} must be a finite number. Enter a numeric strength, such as 1 or 0.`);
          return;
        }
        lora.strength = strength.valueAsNumber;
        sync();
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-secondary';
      remove.dataset.repeaterAction = 'remove';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${lora.name}`);
      name.textContent = lora.name;
      strengthCell.append(strengthField.field);
      actions.append(remove);
      row.append(name, strengthCell, actions);
      loraByRow.set(row, lora);
      loraRepeater.add(row, { notify: false });
      return strength;
    };
    const addSelectedLora = () => {
      const name = loraPicker.getValue();
      if (lorasDisabled || !name) return;
      const lora = { name, strength: 1 };
      state.loras.push(lora);
      const strength = addLoraRow(lora);
      loraPicker.setValue('');
      updateLoraAvailability();
      sync();
      loraRows.dispatchEvent(new Event('input', { bubbles: true }));
      announceLoras(`Added ${name} at strength 1.`);
      strength.focus();
      strength.select();
    };
    loraAdd.addEventListener('click', addSelectedLora);
    loraAddRoot.addEventListener('keydown', event => {
      if (event.target.type !== 'search' || event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      addSelectedLora();
    });
    loraEditor = {
      render() {
        loraRepeater.clear();
        state.loras.forEach(addLoraRow);
        updateLoraAvailability();
      },
      setDisabled(disabled) {
        lorasDisabled = disabled;
        loraPicker.setDisabled(disabled);
        loraAdd.disabled = disabled || !loraPicker.getValue();
      }
    };

    mode.querySelectorAll('[data-image-workflow-field]').forEach(element => {
      const field = element.dataset.imageWorkflowField;
      fields.set(field, element);
      element.addEventListener('change', () => {
        state[field] = element.type === 'checkbox' ? element.checked : element.value;
        if (field === 'family' && element.value !== 'custom') {
          state.custom_template = '';
          const customWorkflow = fields.get('custom_template');
          if (customWorkflow) customWorkflow.value = '';
        }
        if (field === 'custom_template' && element.value) {
          state.family = 'custom';
          const family = fields.get('family');
          if (family) family.value = 'custom';
        }
        updateConditionalFields();
        sync();
      });
    });

    const resolutions = mode.querySelector('[data-image-workflow-resolutions]');
    if (resolutions) TYPES.forEach(type => {
      const widthField = window.AIRPG_WIDGETS.createField({ label: 'Width', type: 'number', className: 'form-group' });
      const heightField = window.AIRPG_WIDGETS.createField({ label: 'Height', type: 'number', className: 'form-group' });
      const width = widthField.input;
      const height = heightField.input;
      const group = document.createElement('div');
      const fieldGrid = document.createElement('div');
      group.className = 'form-group';
      const label = document.createElement('label');
      label.textContent = `${type[0].toUpperCase() + type.slice(1)} resolution`;
      group.append(label);
      fieldGrid.className = 'form-grid';
      const numberOrNull = value => value === '' ? null : Number(value);
      const change = () => {
        state.resolutions[type] = {
          width: numberOrNull(width.value),
          height: numberOrNull(height.value)
        };
        sync();
      };
      width.addEventListener('change', change);
      height.addEventListener('change', change);
      fieldGrid.append(widthField.field, heightField.field);
      group.append(fieldGrid);
      resolutions.append(group);
      resolutionInputs.set(type, { width, height });
    });

    const renderState = () => {
      if (availableLoras !== null) {
        state.loras = state.loras.filter(lora => availableLoras.has(lora.name));
      }
      fields.forEach((element, field) => {
        if (element.type === 'checkbox') element.checked = state[field] !== false;
        else element.value = state[field] ?? '';
      });
      Object.entries(widgets).forEach(([field, widget]) => widget.setValue(state[field]));
      loraEditor.render();
      resolutionInputs.forEach(({ width, height }, type) => {
        const current = state.resolutions[type] || {};
        width.value = current.width ?? '';
        height.value = current.height ?? '';
      });
      updateConditionalFields();
      sync();
      loraRows.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const refreshPresets = selectedName => {
      if (!presetSelect) return;
      const currentSelection = selectedName ?? presetSelect.value;
      const modePresets = options.presets?.[workflowMode] || {};
      presetSelect.replaceChildren(new Option('Select a preset…', ''));
      Object.keys(modePresets).sort((a, b) => a.localeCompare(b)).forEach(name => {
        presetSelect.append(new Option(name, name));
      });
      presetSelect.value = Object.prototype.hasOwnProperty.call(modePresets, currentSelection)
        ? currentSelection
        : '';
    };

    const refreshOptions = () => {
      ['model', 'text_encoder', 'text_encoder_type', 'vae', 'sampler', 'scheduler'].forEach(field => widgets[field]?.setOptions(options[field]));
      const custom = fields.get('custom_template');
      if (custom) {
        custom.querySelectorAll('option:not(:first-child)').forEach(option => option.remove());
        options.workflows.forEach(name => custom.append(new Option(name, name)));
        custom.value = state.custom_template || '';
      }
      refreshPresets();
      renderState();
    };

    const persistPreset = async (name, overwrite) => {
      if (Array.from(loraRows.querySelectorAll('input')).some(input => !input.reportValidity())) return;
      const payload = await fetchJson(`/api/image-workflow-presets/${workflowMode}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, settings: state, overwrite })
      });
      options.presets = payload.presets;
      controllers.forEach(controller => controller.refreshPresets(
        controller.workflowMode === workflowMode ? name : undefined
      ));
      setPresetStatus(`Saved preset “${name}” to ${payload.presetSaveTarget}.`);
    };

    mode.querySelector('[data-image-workflow-load]')?.addEventListener('click', () => {
      const name = presetSelect?.value || '';
      const preset = options.presets?.[workflowMode]?.[name];
      if (!name || !preset) {
        setPresetStatus('Select a preset to load.');
        return;
      }
      try {
        state = normalizeSettings(structuredClone(preset), workflowMode);
        renderState();
        setPresetStatus(`Loaded preset “${name}”.`);
      } catch (error) {
        window.AIRPG_PAGE_FEEDBACK.showError(error);
      }
    });

    mode.querySelector('[data-image-workflow-save]')?.addEventListener('click', async () => {
      const name = presetSelect?.value || '';
      if (!name) {
        setPresetStatus('Select a preset to replace, or use Save As.');
        return;
      }
      try {
        await persistPreset(name, true);
      } catch (error) {
        setPresetStatus(`Could not save preset: ${error.message}`);
      }
    });

    mode.querySelector('[data-image-workflow-save-as]')?.addEventListener('click', async () => {
      const name = await presetModal.requestName(workflowMode);
      if (!name) return;
      try {
        await persistPreset(name, false);
      } catch (error) {
        setPresetStatus(`Could not save preset: ${error.message}`);
      }
    });

    useGlobal?.addEventListener('change', sync);
    valueInput.addEventListener('change', () => {
      try {
        state = parseSettings(valueInput, workflowMode);
        renderState();
      } catch (error) {
        window.AIRPG_PAGE_FEEDBACK.showError(error);
      }
    });
    renderState();
    refreshOptions();
    return { workflowMode, refreshOptions, refreshPresets };
  }

  function initSubtabs(editor) {
    const buttons = Array.from(editor.querySelectorAll('[data-image-workflow-subtab]'));
    const modes = Array.from(editor.querySelectorAll('[data-image-workflow-mode]'));
    if (!buttons.length || !modes.length) return;

    return new window.AIRPG_WIDGETS.Tabs({
      tabs: buttons.map(button => ({
        id: button.dataset.imageWorkflowSubtab,
        button,
        panel: modes.find(mode => mode.dataset.imageWorkflowMode === button.dataset.imageWorkflowSubtab)
      })),
      activeClass: 'is-active'
    });
  }

  async function init() {
    const editors = Array.from(document.querySelectorAll('.image-workflow-editor'));
    if (!editors.length) return;
    const presetModal = initPresetModal();
    editors.forEach(editor => {
      editor.querySelectorAll('[data-image-workflow-mode]').forEach(mode => {
        const controller = initMode(mode, presetModal);
        if (controller) controllers.push(controller);
      });
      initSubtabs(editor);
    });
    await loadOptions();
    controllers.forEach(controller => controller.refreshOptions());
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
      console.error('Failed to initialize image workflow editor:', error);
      window.AIRPG_PAGE_FEEDBACK.showError(error);
    });
  });
})();
