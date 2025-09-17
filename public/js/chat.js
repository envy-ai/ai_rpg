class AIRPGChat {
    constructor() {
        this.chatLog = document.getElementById('chatLog');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');

        // Start with system prompt for AI context
        this.chatHistory = [
            {
                role: "system",
                content: window.systemPrompt || "You are a creative and engaging AI Game Master for a text-based RPG. Create immersive adventures, memorable characters, and respond to player actions with creativity and detail. Keep responses engaging but concise."
            }
        ];

        // Load any existing chat history for AI context
        this.loadExistingHistory();

        this.init();
    }

    async loadExistingHistory() {
        try {
            const response = await fetch('/api/chat/history');
            const data = await response.json();

            if (data.history && data.history.length > 0) {
                // Add existing messages to chat history for AI context
                // Convert server format to AI API format
                data.history.forEach(msg => {
                    this.chatHistory.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: msg.content
                    });
                });
            }
        } catch (error) {
            console.log('No existing history to load:', error.message);
        }
    }

    init() {
        this.bindEvents();
        this.messageInput.focus();
    }

    bindEvents() {
        this.sendButton.addEventListener('click', () => this.sendMessage());

        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        this.messageInput.addEventListener('input', () => {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
        });
    }

    addMessage(sender, content, isError = false, debugInfo = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}${isError ? ' error' : ''}`;

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = sender === 'user' ? '👤 You' : '🤖 AI Game Master';

        const contentDiv = document.createElement('div');
        contentDiv.textContent = content;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);

        // Add debug information if available (for AI responses)
        if (debugInfo && sender === 'ai') {
            const debugDetails = document.createElement('details');
            debugDetails.className = 'debug-details';

            const debugSummary = document.createElement('summary');
            debugSummary.className = 'debug-summary';
            debugSummary.textContent = '🔍 Debug: View AI Prompt';

            const debugContent = document.createElement('div');
            debugContent.className = 'debug-content';

            if (debugInfo.usedPlayerTemplate) {
                debugContent.innerHTML = `
                    <div class="debug-section">
                        <strong>Player Context:</strong> ${debugInfo.playerName}<br>
                        <em>${debugInfo.playerDescription}</em>
                    </div>
                    <div class="debug-section">
                        <strong>System Prompt Sent to AI:</strong>
                        <pre class="debug-prompt">${this.escapeHtml(debugInfo.systemMessage)}</pre>
                    </div>
                    <div class="debug-section">
                        <strong>Full AI Prompt Sent:</strong>
                        <pre class="debug-prompt">${this.escapeHtml(debugInfo.generationPrompt)}</pre>
                    </div>
                `;
            } else {
                debugContent.innerHTML = `
                    <div class="debug-section">
                        <strong>No Player Template Used</strong><br>
                        Reason: ${debugInfo.reason || debugInfo.error || 'Unknown'}
                    </div>
                `;
            }

            debugDetails.appendChild(debugSummary);
            debugDetails.appendChild(debugContent);
            messageDiv.appendChild(debugDetails);
        }

        messageDiv.appendChild(timestampDiv);
        this.chatLog.appendChild(messageDiv);

        this.scrollToBottom();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'message ai-message loading';
        loadingDiv.id = 'loading-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🤖 AI Game Master';

        const contentDiv = document.createElement('div');
        contentDiv.textContent = 'Thinking...';

        loadingDiv.appendChild(senderDiv);
        loadingDiv.appendChild(contentDiv);
        this.chatLog.appendChild(loadingDiv);

        this.scrollToBottom();
    }

    hideLoading() {
        const loadingMessage = document.getElementById('loading-message');
        if (loadingMessage) {
            loadingMessage.remove();
        }
    }

    scrollToBottom() {
        this.chatLog.scrollTop = this.chatLog.scrollHeight;
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;

        this.addMessage('user', message);
        this.chatHistory.push({ role: 'user', content: message });

        this.messageInput.value = '';
        this.sendButton.disabled = true;
        this.showLoading();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: this.chatHistory
                })
            });

            const data = await response.json();
            this.hideLoading();

            if (data.error) {
                this.addMessage('system', `Error: ${data.error}`, true);
            } else {
                this.addMessage('ai', data.response, false, data.debug);
                this.chatHistory.push({ role: 'assistant', content: data.response });

                // Check for location updates after AI response
                this.checkLocationUpdate();
            }
        } catch (error) {
            this.hideLoading();
            this.addMessage('system', `Connection error: ${error.message}`, true);
        }

        this.sendButton.disabled = false;
        this.messageInput.focus();
    }

    async checkLocationUpdate() {
        try {
            const response = await fetch('/api/player');
            const result = await response.json();

            if (result.success && result.player) {
                if (window.updateInventoryDisplay) {
                    window.updateInventoryDisplay(result.player.inventory || []);
                }

                if (result.player.currentLocation) {
                    // Fetch location details
                    const locationResponse = await fetch(`/api/locations/${result.player.currentLocation}`);
                    const locationResult = await locationResponse.json();

                    if (locationResult.success && locationResult.location) {
                        // Update location display if the updateLocationDisplay function exists
                        if (window.updateLocationDisplay) {
                            window.updateLocationDisplay(locationResult.location);
                        }
                    }
                }
            }
        } catch (error) {
            console.log('Could not check location update:', error);
        }
    }
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AIRPGChat();
});
