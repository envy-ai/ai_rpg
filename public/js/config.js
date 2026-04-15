class ConfigManager {
    constructor() {
        this.form = document.getElementById('configForm');
        this.statusMessage = document.getElementById('status-message');
        this.tabButtons = [];
        this.tabPanels = [];
        this.aiBackendSelect = null;
        this.aiBackendSections = [];
        this.codexSessionModeSelect = null;
        this.codexSessionModeSections = [];
        this.modelSelect = null;
        this.modelOptionsInput = null;
        this.modelOptions = [];
        this.previousModelValue = '';
        this.addModelModal = null;
        this.addModelInput = null;
        this.addModelError = null;
        this.addModelConfirm = null;
        this.addModelCancel = null;
        this.gameConfigOverrideTextarea = null;
        this.lastSavedGameConfigOverrideYaml = '';
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.initializeTabs();
        this.initializeModelSelector();
        this.initializeAiBackendFields();
        this.initializeGameConfigOverride();
        this.validateForm();
    }
    
    bindEvents() {
        if (!this.form) {
            return;
        }

        this.form.addEventListener('submit', (e) => this.handleSubmit(e));

        // Real-time validation
        const inputs = this.form.querySelectorAll('input:not([type="hidden"]), select, textarea');
        inputs.forEach(input => {
            const validate = () => this.validateForm();
            input.addEventListener('input', validate);
            input.addEventListener('change', validate);
            input.addEventListener('blur', () => this.validateField(input));
        });
    }
    
    validateField(input) {
        if (!input || typeof input.checkValidity !== 'function') {
            return true;
        }

        const isValid = input.checkValidity();
        const message = isValid ? '' : (input.validationMessage || 'Invalid value.');

        this.setFieldValidation(input, isValid, message);
        return isValid;
    }
    
    setFieldValidation(input, isValid, message) {
        const helpText = input.parentElement.querySelector('.help-text');
        
        if (isValid) {
            input.style.boxShadow = '';
            if (helpText) {
                helpText.style.color = 'rgba(255, 255, 255, 0.7)';
                if (!helpText.dataset.original) {
                    helpText.dataset.original = helpText.textContent;
                }
                helpText.textContent = helpText.dataset.original;
            }
        } else {
            input.style.boxShadow = '0 0 0 2px rgba(255, 100, 100, 0.5)';
            if (helpText) {
                helpText.style.color = 'rgb(255, 150, 150)';
                if (!helpText.dataset.original) {
                    helpText.dataset.original = helpText.textContent;
                }
                helpText.textContent = message;
            }
        }
    }
    
    validateForm() {
        if (!this.form) {
            return true;
        }

        const inputs = this.form.querySelectorAll('input[required]:not([type="hidden"]), select[required], textarea[required]');
        let allValid = true;

        inputs.forEach(input => {
            if (!this.validateField(input)) {
                allValid = false;
            }
        });
        
        const submitButton = this.form.querySelector('button[type="submit"]');
        submitButton.disabled = !allValid;
        
        return allValid;
    }
    
    async handleSubmit(e) {
        e.preventDefault();
        
        if (!this.validateForm()) {
            this.showMessage('Please fix validation errors before saving.', 'error');
            return;
        }
        
        const submitButton = this.form.querySelector('button[type="submit"]');
        const originalText = submitButton.textContent;
        
        try {
            submitButton.disabled = true;
            submitButton.textContent = '💾 Saving...';
            
            const formData = new FormData(this.form);
            const data = Object.fromEntries(formData);
            
            const response = await fetch('/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                    'X-Requested-With': 'fetch'
                },
                body: new URLSearchParams(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showMessage(result.message, 'success');
            } else {
                this.showMessage(result.message, 'error');
            }
            
        } catch (error) {
            this.showMessage(`Error saving configuration: ${error.message}`, 'error');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }
    }
    
    showMessage(message, type) {
        if (!this.statusMessage) {
            return;
        }
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
        this.statusMessage.style.display = 'block';
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                this.statusMessage.style.display = 'none';
            }, 5000);
        }
    }

    initializeTabs() {
        this.tabButtons = Array.from(document.querySelectorAll('[data-config-tab-target]'));
        this.tabPanels = Array.from(document.querySelectorAll('[data-config-tab-panel]'));

        if (!this.tabButtons.length || !this.tabPanels.length) {
            return;
        }

        this.tabButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.dataset.configTabTarget;
                this.activateTab(target);
            });
        });

        const activeButton = this.tabButtons.find(button => button.classList.contains('active'));
        this.activateTab(activeButton?.dataset.configTabTarget || this.tabButtons[0].dataset.configTabTarget);
    }

    activateTab(targetName) {
        if (!targetName) {
            return;
        }

        this.tabButtons.forEach((button) => {
            const isActive = button.dataset.configTabTarget === targetName;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        this.tabPanels.forEach((panel) => {
            const isActive = panel.dataset.configTabPanel === targetName;
            panel.hidden = !isActive;
            panel.classList.toggle('active', isActive);
        });
    }

    initializeModelSelector() {
        this.modelSelect = document.getElementById('ai-model');
        this.modelOptionsInput = document.getElementById('model-options');
        this.addModelModal = document.getElementById('addModelModal');
        this.addModelInput = document.getElementById('newModelName');
        this.addModelError = document.getElementById('addModelError');
        this.addModelConfirm = document.getElementById('addModelConfirm');
        this.addModelCancel = document.getElementById('addModelCancel');
        const addModelCancelClose = document.getElementById('addModelCancelClose');

        if (this.modelOptionsInput) {
            try {
                const parsed = JSON.parse(this.modelOptionsInput.value || '[]');
                if (Array.isArray(parsed)) {
                    this.modelOptions = Array.from(new Set(parsed.filter(Boolean)));
                }
            } catch (error) {
                console.warn('Failed to parse model options:', error.message);
                this.modelOptions = [];
            }
        }

        if (this.modelSelect) {
            const currentValue = this.modelSelect.value;
            if (currentValue && currentValue !== '__add_new__' && !this.modelOptions.includes(currentValue)) {
                this.modelOptions.push(currentValue);
                this.updateModelOptionsInput();
            }
            this.previousModelValue = currentValue;
            this.modelSelect.addEventListener('focus', () => {
                this.previousModelValue = this.modelSelect.value;
            });
            this.modelSelect.addEventListener('change', () => this.handleModelChange());
        }

        if (this.addModelConfirm) {
            this.addModelConfirm.addEventListener('click', () => this.handleAddModelSubmit());
        }
        if (this.addModelCancel) {
            this.addModelCancel.addEventListener('click', () => this.closeAddModelModal(true));
        }
        if (addModelCancelClose) {
            addModelCancelClose.addEventListener('click', () => this.closeAddModelModal(true));
        }
        if (this.addModelModal) {
            this.addModelModal.addEventListener('click', (event) => {
                if (event.target === this.addModelModal) {
                    this.closeAddModelModal(true);
                }
            });
            this.addModelModal.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    this.closeAddModelModal(true);
                }
            });
        }
        if (this.addModelInput) {
            this.addModelInput.addEventListener('input', () => this.clearAddModelError());
            this.addModelInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this.handleAddModelSubmit();
                }
            });
        }
    }

    initializeAiBackendFields() {
        this.aiBackendSelect = document.getElementById('ai-backend');
        this.aiBackendSections = Array.from(document.querySelectorAll('[data-ai-backend-section]'));
        this.codexSessionModeSelect = document.getElementById('ai-codex-sessionMode');
        this.codexSessionModeSections = Array.from(document.querySelectorAll('[data-codex-session-mode-section]'));

        if (this.aiBackendSelect) {
            this.aiBackendSelect.addEventListener('change', () => {
                this.updateAiBackendVisibility();
                this.validateForm();
            });
        }

        if (this.codexSessionModeSelect) {
            this.codexSessionModeSelect.addEventListener('change', () => {
                this.updateAiBackendVisibility();
                this.validateForm();
            });
        }

        this.updateAiBackendVisibility();
    }

    updateAiBackendVisibility() {
        const backend = this.aiBackendSelect?.value || 'openai_compatible';
        const codexSessionMode = this.codexSessionModeSelect?.value || 'fresh';

        this.aiBackendSections.forEach((section) => {
            const requiredBackend = section.dataset.aiBackendSection;
            const isVisible = !requiredBackend || requiredBackend === backend;
            section.hidden = !isVisible;
        });

        this.codexSessionModeSections.forEach((section) => {
            const requiredMode = section.dataset.codexSessionModeSection;
            const isVisible = backend === 'codex_cli_bridge'
                && (!requiredMode || requiredMode === codexSessionMode);
            section.hidden = !isVisible;
        });

        const backendRequiredFields = this.form
            ? Array.from(this.form.querySelectorAll('[data-required-backend]'))
            : [];
        backendRequiredFields.forEach((field) => {
            const requiredBackend = field.dataset.requiredBackend;
            field.required = requiredBackend === backend;
        });

        const codexSessionRequiredFields = this.form
            ? Array.from(this.form.querySelectorAll('[data-required-codex-session-mode]'))
            : [];
        codexSessionRequiredFields.forEach((field) => {
            const requiredMode = field.dataset.requiredCodexSessionMode;
            field.required = backend === 'codex_cli_bridge' && requiredMode === codexSessionMode;
        });
    }

    handleModelChange() {
        if (!this.modelSelect) {
            return;
        }

        const selected = this.modelSelect.value;
        if (selected === '__add_new__') {
            this.openAddModelModal();
        } else {
            this.previousModelValue = selected;
        }
    }

    openAddModelModal() {
        if (!this.addModelModal) {
            return;
        }
        this.clearAddModelError();
        this.addModelModal.removeAttribute('hidden');
        this.addModelModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        if (this.addModelInput) {
            this.addModelInput.value = '';
            setTimeout(() => this.addModelInput.focus(), 0);
        }
    }

    closeAddModelModal(cancelled = false) {
        if (!this.addModelModal) {
            return;
        }
        this.addModelModal.setAttribute('hidden', '');
        this.addModelModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        this.clearAddModelError();

        if (cancelled && this.modelSelect) {
            this.modelSelect.value = this.previousModelValue || (this.modelOptions[0] || '');
        }
        if (this.modelSelect) {
            this.modelSelect.focus();
        }
    }

    handleAddModelSubmit() {
        if (!this.addModelInput || !this.modelSelect) {
            return;
        }

        const newModel = this.addModelInput.value.trim();
        if (!newModel) {
            this.showAddModelError('Model name cannot be empty.');
            return;
        }

        const duplicate = this.modelOptions.some(option => option.toLowerCase() === newModel.toLowerCase());
        if (duplicate) {
            this.showAddModelError('This model is already in the list.');
            return;
        }

        this.modelOptions.push(newModel);
        this.updateModelOptionsInput();

        const addOption = this.modelSelect.querySelector('option[value="__add_new__"]');
        const option = document.createElement('option');
        option.value = newModel;
        option.textContent = newModel;
        if (addOption) {
            this.modelSelect.insertBefore(option, addOption);
        } else {
            this.modelSelect.appendChild(option);
        }

        this.modelSelect.value = newModel;
        this.previousModelValue = newModel;
        this.closeAddModelModal();
        this.validateField(this.modelSelect);
    }

    showAddModelError(message) {
        if (!this.addModelError) {
            return;
        }
        this.addModelError.textContent = message;
        this.addModelError.hidden = false;
    }

    clearAddModelError() {
        if (!this.addModelError) {
            return;
        }
        this.addModelError.hidden = true;
        this.addModelError.textContent = '';
    }

    updateModelOptionsInput() {
        if (!this.modelOptionsInput) {
            return;
        }
        this.modelOptionsInput.value = JSON.stringify(this.modelOptions);
    }

    initializeGameConfigOverride() {
        this.gameConfigOverrideTextarea = document.getElementById('game-config-override-yaml');
        if (!this.gameConfigOverrideTextarea) {
            return;
        }

        this.lastSavedGameConfigOverrideYaml = this.normalizeYaml(this.gameConfigOverrideTextarea.value);
        this.gameConfigOverrideTextarea.addEventListener('change', () => {
            this.handleGameConfigOverrideChange();
        });
    }

    normalizeYaml(value) {
        if (typeof value !== 'string') {
            return '';
        }
        return value.replace(/\r\n/g, '\n');
    }

    async handleGameConfigOverrideChange() {
        if (!this.gameConfigOverrideTextarea || this.gameConfigOverrideTextarea.disabled) {
            return;
        }

        const nextYaml = this.normalizeYaml(this.gameConfigOverrideTextarea.value);
        if (nextYaml === this.lastSavedGameConfigOverrideYaml) {
            return;
        }

        const originalDisabled = this.gameConfigOverrideTextarea.disabled;

        try {
            this.gameConfigOverrideTextarea.disabled = true;
            this.showMessage('Reloading per-game configuration...', 'info');

            const response = await fetch('/api/game-config-override', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ yaml: nextYaml })
            });

            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || result.message || 'Failed to reload per-game configuration.');
            }

            const savedYaml = this.normalizeYaml(result.gameConfigOverrideYaml || '');
            this.lastSavedGameConfigOverrideYaml = savedYaml;
            this.gameConfigOverrideTextarea.value = savedYaml;
            this.showMessage(result.message || 'Per-game configuration override saved.', 'success');
        } catch (error) {
            this.showMessage(`Error updating per-game configuration: ${error.message}`, 'error');
        } finally {
            this.gameConfigOverrideTextarea.disabled = originalDisabled;
        }
    }
}

// Utility functions
function togglePassword(fieldId) {
    const field = document.getElementById(fieldId);
    const button = field.parentElement.querySelector('.toggle-password');
    
    if (field.type === 'password') {
        field.type = 'text';
        button.textContent = '🙈';
    } else {
        field.type = 'password';
        button.textContent = '👁️';
    }
}

async function testConnection() {
    const backend = document.getElementById('ai-backend')?.value || 'openai_compatible';
    const endpoint = document.getElementById('ai-endpoint').value;
    const apiKey = document.getElementById('ai-apiKey').value;
    const model = document.getElementById('ai-model').value;
    const codexSessionMode = document.getElementById('ai-codex-sessionMode')?.value || 'fresh';
    const codexSessionId = document.getElementById('ai-codex-sessionId')?.value || '';

    if (!model) {
        showTestResult('Please fill in the model before testing.', 'error');
        return;
    }
    if (backend === 'openai_compatible' && (!endpoint || !apiKey)) {
        showTestResult('Please fill in endpoint, API key, and model before testing.', 'error');
        return;
    }
    if (backend === 'codex_cli_bridge' && codexSessionMode === 'resume_id' && !codexSessionId.trim()) {
        showTestResult('Please provide a Codex session ID when using resume_id mode.', 'error');
        return;
    }
    
    const button = event.target;
    const originalText = button.textContent;
    
    try {
        button.disabled = true;
        button.textContent = '🔗 Testing...';
        
        const response = await fetch('/api/test-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                backend,
                endpoint: endpoint,
                apiKey: apiKey,
                model: model,
                codexBridge: {
                    command: document.getElementById('ai-codex-command')?.value || '',
                    home: document.getElementById('ai-codex-home')?.value || '',
                    session_mode: codexSessionMode,
                    session_id: codexSessionId,
                    sandbox: document.getElementById('ai-codex-sandbox')?.value || 'read-only',
                    skip_git_repo_check: Boolean(document.getElementById('ai-codex-skipGitRepoCheck')?.checked),
                    reasoning_effort: document.getElementById('ai-codex-reasoningEffort')?.value || '',
                    profile: document.getElementById('ai-codex-profile')?.value || '',
                    prompt_preamble: document.getElementById('ai-codex-promptPreamble')?.value || ''
                }
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showTestResult('✅ Connection successful! AI configuration is working.', 'success');
        } else {
            showTestResult(`❌ Connection failed: ${result.error || 'Unknown error'}`, 'error');
        }
        
    } catch (error) {
        showTestResult(`❌ Connection test failed: ${error.message}`, 'error');
    } finally {
        button.disabled = false;
        button.textContent = originalText;
    }
}

function showTestResult(message, type) {
    const statusMessage = document.getElementById('status-message');
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    
    setTimeout(() => {
        statusMessage.style.display = 'none';
    }, 5000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ConfigManager();
});
