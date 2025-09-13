class ConfigManager {
    constructor() {
        this.form = document.getElementById('configForm');
        this.statusMessage = document.getElementById('status-message');
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.validateForm();
    }
    
    bindEvents() {
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
        
        // Real-time validation
        const inputs = this.form.querySelectorAll('input');
        inputs.forEach(input => {
            input.addEventListener('input', () => this.validateForm());
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
        const inputs = this.form.querySelectorAll('input[required]');
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
