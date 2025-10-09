class ConfigManager {
    constructor() {
        this.form = document.getElementById('configForm');
        this.statusMessage = document.getElementById('status-message');
        this.modelSelect = null;
        this.modelOptionsInput = null;
        this.modelOptions = [];
        this.previousModelValue = '';
        this.addModelModal = null;
        this.addModelInput = null;
        this.addModelError = null;
        this.addModelConfirm = null;
        this.addModelCancel = null;
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.validateForm();
        this.initializeModelSelector();
    }
    
    bindEvents() {
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));

        // Real-time validation
        const inputs = this.form.querySelectorAll('input:not([type="hidden"]), select');
        inputs.forEach(input => {
            const validate = () => this.validateForm();
            input.addEventListener('input', validate);
            input.addEventListener('change', validate);
            input.addEventListener('blur', () => this.validateField(input));
        });
    }
    
    validateField(input) {
        const value = input.value.trim();
        let isValid = true;
        let message = '';
        
        switch (input.name) {
            case 'server.host':
                isValid = value.length > 0;
                message = isValid ? '' : 'Host is required';
                break;
                
            case 'server.port':
                const port = parseInt(value);
                isValid = port >= 1 && port <= 65535;
                message = isValid ? '' : 'Port must be between 1 and 65535';
                break;
                
            case 'ai.endpoint':
                try {
                    new URL(value);
                    isValid = true;
                } catch {
                    isValid = false;
                    message = 'Invalid URL format';
                }
                break;
                
            case 'ai.apiKey':
                isValid = value.length > 0;
                message = isValid ? '' : 'API Key is required';
                break;
                
            case 'ai.model':
                isValid = value.length > 0;
                message = isValid ? '' : 'Model is required';
                break;
                
            case 'ai.maxTokens':
                const maxTokens = parseInt(value);
                isValid = maxTokens >= 1 && maxTokens <= 4000;
                message = isValid ? '' : 'Max tokens must be between 1 and 4000';
                break;
                
            case 'ai.temperature':
                const temp = parseFloat(value);
                isValid = temp >= 0 && temp <= 2;
                message = isValid ? '' : 'Temperature must be between 0.0 and 2.0';
                break;
        }
        
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
        const inputs = this.form.querySelectorAll('input[required]:not([type="hidden"]), select[required]');
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
    const endpoint = document.getElementById('ai-endpoint').value;
    const apiKey = document.getElementById('ai-apiKey').value;
    const model = document.getElementById('ai-model').value;
    
    if (!endpoint || !apiKey || !model) {
        showTestResult('Please fill in endpoint, API key, and model before testing.', 'error');
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
                endpoint: endpoint,
                apiKey: apiKey,
                model: model
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
