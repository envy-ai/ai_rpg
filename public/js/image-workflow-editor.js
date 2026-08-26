(() => {
  'use strict';

  const TYPES = ['character', 'item', 'scenery', 'location'];
  const options = {
    model: [],
    text_encoder: [],
    vae: [],
    loras: [],
    workflows: [],
    presets: { generation: {}, edit: {} }
  };
  const controllers = [];

  const defaultsFor = mode => ({
    family: mode === 'edit' ? 'flux_klein' : 'krea2',
    custom_template: '',
    model: '',
    text_encoder: '',
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
    if (workflowMode === 'edit') {
      const { resolutions: _discardedResolutions, ...settings } = supplied;
      return { ...defaults, ...settings };
    }
    return { ...defaults, ...supplied, resolutions: { ...(supplied.resolutions || {}) } };
  };

  const parseSettings = (input, workflowMode) => {
    try {
      return normalizeSettings(JSON.parse(input.value || '{}'), workflowMode);
    } catch {
      return normalizeSettings({}, workflowMode);
    }
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
      fetchJson('/api/comfyui/workflow-options'),
      fetchJson('/api/image-workflow-presets')
    ]);

    if (comfyResult.status === 'fulfilled') {
      Object.assign(options, comfyResult.value);
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
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
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
    modal.addEventListener('click', event => {
      if (event.target === modal) close(null);
    });
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      }
    });

    return {
      requestName(workflowMode) {
        if (pendingResolve) {
          throw new Error('An image workflow preset name is already being requested.');
        }
        title.textContent = `Save ${workflowMode === 'edit' ? 'Edit' : 'Generation'} Preset As`;
        input.value = '';
        clearError();
        modal.hidden = false;
        modal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        setTimeout(() => input.focus(), 0);
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

    const setPresetStatus = message => {
      if (presetStatus) presetStatus.textContent = message;
    };
    const sync = () => {
      valueInput.value = JSON.stringify(state);
      controls?.classList.toggle('is-muted', Boolean(useGlobal?.checked));
      controls?.querySelectorAll('input,select,button').forEach(element => {
        element.disabled = Boolean(useGlobal?.checked);
      });
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
    select('vae');
    select('loras', true);

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
      const width = document.createElement('input');
      const height = document.createElement('input');
      const group = document.createElement('div');
      const fieldGrid = document.createElement('div');
      const widthGroup = document.createElement('div');
      const heightGroup = document.createElement('div');
      group.className = 'form-group';
      group.innerHTML = `<label>${type[0].toUpperCase() + type.slice(1)} resolution</label>`;
      fieldGrid.className = 'form-grid';
      widthGroup.className = heightGroup.className = 'form-group';
      widthGroup.innerHTML = '<label>Width</label>';
      heightGroup.innerHTML = '<label>Height</label>';
      width.type = height.type = 'number';
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
      widthGroup.append(width);
      heightGroup.append(height);
      fieldGrid.append(widthGroup, heightGroup);
      group.append(fieldGrid);
      resolutions.append(group);
      resolutionInputs.set(type, { width, height });
    });

    const renderState = () => {
      fields.forEach((element, field) => {
        if (element.type === 'checkbox') element.checked = state[field] !== false;
        else element.value = state[field] ?? '';
      });
      Object.entries(widgets).forEach(([field, widget]) => widget.setValue(state[field]));
      resolutionInputs.forEach(({ width, height }, type) => {
        const current = state.resolutions[type] || {};
        width.value = current.width ?? '';
        height.value = current.height ?? '';
      });
      updateConditionalFields();
      sync();
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
      ['model', 'text_encoder', 'vae', 'loras'].forEach(field => widgets[field]?.setOptions(options[field]));
      const custom = fields.get('custom_template');
      if (custom) {
        custom.querySelectorAll('option:not(:first-child)').forEach(option => option.remove());
        options.workflows.forEach(name => custom.append(new Option(name, name)));
        custom.value = state.custom_template || '';
      }
      refreshPresets();
    };

    const persistPreset = async (name, overwrite) => {
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
      state = normalizeSettings(structuredClone(preset), workflowMode);
      renderState();
      setPresetStatus(`Loaded preset “${name}”.`);
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
    renderState();
    refreshOptions();
    return { workflowMode, refreshOptions, refreshPresets };
  }

  function initSubtabs(editor) {
    const buttons = Array.from(editor.querySelectorAll('[data-image-workflow-subtab]'));
    const modes = Array.from(editor.querySelectorAll('[data-image-workflow-mode]'));
    if (!buttons.length || !modes.length) return;

    const activate = name => {
      buttons.forEach(button => {
        const active = button.dataset.imageWorkflowSubtab === name;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      modes.forEach(mode => {
        mode.hidden = mode.dataset.imageWorkflowMode !== name;
      });
    };

    buttons.forEach(button => button.addEventListener('click', () => activate(button.dataset.imageWorkflowSubtab)));
    activate(buttons.find(button => button.classList.contains('is-active'))?.dataset.imageWorkflowSubtab || buttons[0].dataset.imageWorkflowSubtab);
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
    init().catch(error => console.error('Failed to initialize image workflow editor:', error));
  });
})();
