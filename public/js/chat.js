class AIRPGChat {
    constructor() {
        this.chatLog = document.getElementById('chatLog');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.sendButtonDefaultHtml = this.sendButton ? this.sendButton.innerHTML : 'Send';
        this.skillPointsDisplay = document.getElementById('unspentSkillPointsDisplay');
        this.skillRankElements = this.collectSkillRankElements();

        // Start with system prompt for AI context
        this.chatHistory = [
            {
                role: "system",
                content: window.systemPrompt || "You are a creative and engaging AI Game Master for a text-based RPG. Create immersive adventures, memorable characters, and respond to player actions with creativity and detail. Keep responses engaging but concise."
            }
        ];
        this.systemMessage = this.chatHistory[0];
        this.serverHistory = [];
        this.messageRegistry = new Map();

        this.clientId = this.loadClientId();
        this.pendingRequests = new Map();
        this.ws = null;
        this.wsReconnectDelay = 1000;
        this.wsReconnectTimer = null;
        this.streamingStatusElements = new Map();
        this.wsReadyWaiters = [];
        this.wsReady = false;
        window.AIRPG_CLIENT_ID = this.clientId;

        this.init();
        this.initSkillIncreaseControls();
        this.connectWebSocket();

        this.locationRefreshTimers = [];
        this.locationRefreshPending = false;
        this.activeEventBundle = null;

        this.setupEditModal();
        this.loadExistingHistory();
    }

    async loadExistingHistory() {
        try {
            const response = await fetch('/api/chat/history');
            const data = await response.json();

            this.updateServerHistory(Array.isArray(data.history) ? data.history : []);
        } catch (error) {
            console.log('No existing history to load:', error.message);
        }
    }

    loadClientId() {
        const storageKey = 'airpg:clientId';
        try {
            const existing = window.localStorage.getItem(storageKey);
            if (existing && existing.length > 0) {
                return existing;
            }
        } catch (_) {
            // Ignore localStorage failures
        }
        const generated = (window.crypto && typeof window.crypto.randomUUID === 'function')
            ? window.crypto.randomUUID()
            : `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        try {
            window.localStorage.setItem(storageKey, generated);
        } catch (_) {
            // Ignore storage write errors
        }
        return generated;
    }

    normalizeLocalEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        const normalized = { ...entry };
        if (!normalized.timestamp) {
            normalized.timestamp = new Date().toISOString();
        }
        return normalized;
    }

    updateServerHistory(history) {
        this.serverHistory = Array.isArray(history)
            ? history.map(entry => this.normalizeLocalEntry(entry))
            : [];
        this.chatHistory = [this.systemMessage, ...this.serverHistory];
        this.renderChatHistory();
    }

    renderChatHistory() {
        if (!this.chatLog) {
            return;
        }

        this.messageRegistry.clear();
        const fragment = document.createDocumentFragment();

        this.serverHistory.forEach(entry => {
            const element = this.createChatMessageElement(entry);
            if (element) {
                fragment.appendChild(element);
                if (entry.timestamp) {
                    this.messageRegistry.set(entry.timestamp, { entry, element });
                }
            }
        });

        this.chatLog.innerHTML = '';
        if (fragment.childNodes.length === 0) {
            const placeholder = document.createElement('div');
            placeholder.className = 'message ai-message';
            placeholder.innerHTML = `
                <div class="message-sender">🤖 AI Game Master</div>\                
                <div class="message-actions" hidden></div>
                <div>Welcome to the AI RPG! I\'m your Game Master. Configure your AI settings above and then describe what kind of adventure you\'d like to embark on.</div>
            `;
            this.chatLog.appendChild(placeholder);
        } else {
            this.chatLog.appendChild(fragment);
        }
        this.scrollToBottom();
    }

    createChatMessageElement(entry) {
        if (!entry) {
            return null;
        }

        if (entry.type === 'event-summary') {
            return this.createEventSummaryElement(entry);
        }

        const messageDiv = document.createElement('div');
        const role = entry.role === 'user' ? 'user-message' : 'ai-message';
        messageDiv.className = `message ${role}`;
        messageDiv.dataset.timestamp = entry.timestamp || '';



        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        if (entry.role === 'user') {
            senderDiv.textContent = '👤 You';
        } else if (entry.role === 'assistant') {
            senderDiv.textContent = '🤖 AI Game Master';
        } else {
            senderDiv.textContent = '📝 System';
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = entry.content || '';

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = this.formatTimestamp(entry.timestamp);

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        const actions = this.createMessageActions(entry);
        if (actions) {
            messageDiv.appendChild(actions);
        }

        return messageDiv;
    }

    createEventSummaryElement(entry) {
        const container = document.createElement('div');
        container.className = 'message event-summary-batch';
        container.dataset.timestamp = entry.timestamp || '';

        const actions = this.createMessageActions(entry);
        if (actions) {
            container.appendChild(actions);
        }

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = entry.summaryTitle || '📋 Events';

        const listWrapper = document.createElement('div');
        const list = document.createElement('ul');
        list.className = 'event-summary-list';

        if (Array.isArray(entry.summaryItems) && entry.summaryItems.length) {
            entry.summaryItems.forEach(item => {
                if (!item || !item.text) {
                    return;
                }
                const listItem = document.createElement('li');
                const iconSpan = document.createElement('span');
                iconSpan.className = 'event-summary-icon';
                iconSpan.textContent = item.icon || '•';
                listItem.appendChild(iconSpan);
                listItem.appendChild(document.createTextNode(` ${item.text}`));
                list.appendChild(listItem);
            });
        } else if (typeof entry.content === 'string') {
            entry.content.split('\n').forEach((line, idx) => {
                const trimmed = line.trim();
                if (!trimmed) {
                    return;
                }
                if (idx === 0 && !entry.summaryTitle) {
                    senderDiv.textContent = trimmed;
                    return;
                }
                const listItem = document.createElement('li');
                listItem.textContent = trimmed;
                list.appendChild(listItem);
            });
        }

        listWrapper.appendChild(list);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = this.formatTimestamp(entry.timestamp);

        container.appendChild(senderDiv);
        container.appendChild(listWrapper);
        container.appendChild(timestampDiv);

        return container;
    }

    createMessageActions(entry) {
        if (!entry || (entry.role === 'system')) {
            return null;
        }
        if (!entry.timestamp) {
            return null;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'message-actions';

        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'message-action message-action--edit';
        editButton.title = 'Edit message';
        editButton.setAttribute('aria-label', 'Edit message');
        editButton.textContent = '✏️';
        editButton.addEventListener('click', () => {
            this.openEditModal(entry);
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'message-action message-action--delete';
        deleteButton.title = 'Delete message';
        deleteButton.setAttribute('aria-label', 'Delete message');
        deleteButton.textContent = '🗑️';
        deleteButton.addEventListener('click', () => {
            this.handleDeleteMessage(entry);
        });

        wrapper.appendChild(editButton);
        wrapper.appendChild(deleteButton);
        return wrapper;
    }

    formatTimestamp(timestamp) {
        if (!timestamp) {
            return '';
        }
        return String(timestamp).replace('T', ' ').replace('Z', '');
    }

    setupEditModal() {
        this.editModal = document.createElement('div');
        this.editModal.className = 'chat-edit-modal';
        this.editModal.setAttribute('hidden', '');

        this.editModal.innerHTML = `
            <div class="chat-edit-modal__backdrop" role="presentation"></div>
            <div class="chat-edit-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="chatEditModalTitle">
                <header class="chat-edit-modal__header">
                    <h2 id="chatEditModalTitle">Edit Message</h2>
                    <button type="button" class="chat-edit-modal__close" aria-label="Close edit dialog">×</button>
                </header>
                <div class="chat-edit-modal__body">
                    <textarea class="chat-edit-modal__textarea" rows="8"></textarea>
                </div>
                <footer class="chat-edit-modal__footer">
                    <button type="button" class="chat-edit-modal__cancel">Cancel</button>
                    <button type="button" class="chat-edit-modal__save">Save</button>
                </footer>
            </div>
        `;

        document.body.appendChild(this.editModal);

        this.editTextarea = this.editModal.querySelector('.chat-edit-modal__textarea');
        this.editCancelButton = this.editModal.querySelector('.chat-edit-modal__cancel');
        this.editSaveButton = this.editModal.querySelector('.chat-edit-modal__save');
        this.editCloseButton = this.editModal.querySelector('.chat-edit-modal__close');
        this.editBackdrop = this.editModal.querySelector('.chat-edit-modal__backdrop');
        this.editCurrentEntry = null;

        const closeHandler = () => this.closeEditModal();
        this.editCancelButton.addEventListener('click', closeHandler);
        this.editCloseButton.addEventListener('click', closeHandler);
        this.editBackdrop.addEventListener('click', closeHandler);
        this.editSaveButton.addEventListener('click', () => this.submitEdit());
        document.addEventListener('keydown', (event) => {
            if (!this.editModal.hasAttribute('hidden') && event.key === 'Escape') {
                this.closeEditModal();
            }
        });
    }

    openEditModal(entry) {
        if (!entry || !this.editModal) {
            return;
        }
        this.editCurrentEntry = entry;
        this.editTextarea.value = entry.content || '';
        this.editModal.removeAttribute('hidden');
        this.editModal.classList.add('is-open');
        setTimeout(() => {
            this.editTextarea.focus();
        }, 50);
    }

    closeEditModal() {
        if (!this.editModal) {
            return;
        }
        this.editModal.setAttribute('hidden', '');
        this.editModal.classList.remove('is-open');
        this.editCurrentEntry = null;
    }

    async submitEdit() {
        if (!this.editCurrentEntry) {
            return;
        }
        const timestamp = this.editCurrentEntry.timestamp;
        const content = this.editTextarea.value;

        try {
            const response = await fetch('/api/chat/message', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamp, content })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
            this.closeEditModal();
            await this.refreshChatHistory();
        } catch (error) {
            console.warn('Failed to edit message:', error);
            alert(`Failed to edit message: ${error.message || error}`);
        }
    }

    async handleDeleteMessage(entry) {
        if (!entry || !entry.timestamp) {
            return;
        }
        const confirmed = window.confirm('Delete this message? This action cannot be undone.');
        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch('/api/chat/message', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamp: entry.timestamp })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
            await this.refreshChatHistory();
        } catch (error) {
            console.warn('Failed to delete message:', error);
            alert(`Failed to delete message: ${error.message || error}`);
        }
    }

    async refreshChatHistory() {
        try {
            const response = await fetch('/api/chat/history', { cache: 'no-store' });
            const data = await response.json();
            this.updateServerHistory(Array.isArray(data.history) ? data.history : []);
        } catch (error) {
            console.warn('Failed to refresh chat history:', error);
        }
    }

    generateRequestId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
        return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    connectWebSocket(delay = 0) {
        // log a trace to the console
        console.log(`Connecting WebSocket with delay: ${delay}`);
        console.trace('WebSocket connect stack trace');
        if (delay > 0) {
            window.setTimeout(() => this.connectWebSocket(0), delay);
            return;
        }

        if (this.wsReconnectTimer) {
            window.clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }

        this.wsReady = false;

        const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${protocol}://${window.location.host}/ws?clientId=${encodeURIComponent(this.clientId)}`;

        try {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }

            const socket = new WebSocket(url);
            this.ws = socket;

            socket.addEventListener('open', () => this.handleWebSocketOpen());
            socket.addEventListener('close', event => this.handleWebSocketClose(event));
            socket.addEventListener('error', error => {
                console.warn('Realtime websocket error:', error.message || error);
            });
            socket.addEventListener('message', event => this.handleWebSocketMessage(event));
        } catch (error) {
            console.warn('Failed to establish realtime connection:', error.message);
            this.scheduleWebSocketReconnect();
        }
    }

    scheduleWebSocketReconnect() {
        if (this.wsReconnectTimer) {
            return;
        }

        this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 2, 15000);
        this.wsReconnectTimer = window.setTimeout(() => {
            this.wsReconnectTimer = null;
            this.connectWebSocket();
        }, this.wsReconnectDelay);
    }

    flushWebSocketWaiters(success) {
        if (!Array.isArray(this.wsReadyWaiters) || !this.wsReadyWaiters.length) {
            return;
        }
        const waiters = this.wsReadyWaiters.slice();
        this.wsReadyWaiters = [];
        waiters.forEach(waiter => {
            if (waiter && typeof waiter.resolve === 'function') {
                if (waiter.timeoutId) {
                    window.clearTimeout(waiter.timeoutId);
                }
                waiter.resolve(success);
            }
        });
    }

    waitForWebSocketReady(timeoutMs = 0) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN && this.wsReady) {
            return Promise.resolve(true);
        }

        if (timeoutMs <= 0) {
            return Promise.resolve(false);
        }

        return new Promise(resolve => {
            const waiter = {
                resolve: (value) => resolve(value),
                timeoutId: null
            };
            waiter.timeoutId = window.setTimeout(() => {
                this.wsReadyWaiters = this.wsReadyWaiters.filter(item => item !== waiter);
                resolve(false);
            }, timeoutMs);
            this.wsReadyWaiters.push(waiter);
        });
    }

    handleWebSocketOpen() {
        this.wsReconnectDelay = 1000;
        if (this.wsReconnectTimer) {
            window.clearTimeout(this.wsReconnectTimer);
            this.wsReconnectTimer = null;
        }
        this.wsReady = true;
        this.flushWebSocketWaiters(true);
    }

    handleWebSocketClose() {
        this.ws = null;
        this.wsReady = false;
        this.flushWebSocketWaiters(false);
        if (window.AIRPG?.imageManager?.setRealtimeAvailable) {
            try {
                window.AIRPG.imageManager.setRealtimeAvailable(false);
            } catch (_) {
                // Ignore realtime errors on disconnect
            }
        }
        this.scheduleWebSocketReconnect();
    }

    handleConnectionAck(payload) {
        if (!payload || !payload.clientId) {
            return;
        }
        const assignedClientId = payload.clientId;
        const changed = assignedClientId !== this.clientId;
        this.clientId = assignedClientId;
        window.AIRPG_CLIENT_ID = this.clientId;
        if (changed) {
            try {
                window.localStorage.setItem('airpg:clientId', this.clientId);
            } catch (_) {
                // Ignore storage issues
            }
        }

        if (window.AIRPG?.imageManager?.setRealtimeAvailable) {
            try {
                window.AIRPG.imageManager.setRealtimeAvailable(true);
            } catch (_) {
                // Ignore realtime errors on ack
            }
        }
    }

    handleWebSocketMessage(event) {
        if (!event || typeof event.data !== 'string') {
            return;
        }

        let payload = null;
        try {
            payload = JSON.parse(event.data);
        } catch (error) {
            console.warn('Received invalid realtime payload:', error.message);
            return;
        }

        if (!payload || !payload.type) {
            return;
        }

        switch (payload.type) {
            case 'connection_ack':
                this.handleConnectionAck(payload);
                break;
            case 'chat_status':
                this.handleChatStatus(payload);
                break;
            case 'player_action':
                this.handlePlayerActionStream(payload);
                break;
            case 'npc_turn':
                this.handleNpcTurnStream(payload);
                break;
            case 'chat_complete':
                this.handleChatComplete(payload);
                break;
            case 'chat_error':
                this.handleChatError(payload);
                break;
            case 'generation_status':
                this.handleGenerationStatus(payload);
                break;
            case 'region_generated':
                this.handleRegionGenerated(payload);
                break;
            case 'location_generated':
                this.handleLocationGenerated(payload);
                break;
            case 'location_exit_created':
                this.handleLocationExitCreated(payload);
                break;
            case 'image_job_update':
                this.handleImageJobUpdate(payload);
                break;
            default:
                console.log('Realtime update:', payload);
                break;
        }
    }

    ensureRequestContext(requestId) {
        if (!requestId) {
            return null;
        }
        let context = this.pendingRequests.get(requestId);
        if (!context) {
            context = {
                requestId,
                playerActionRendered: false,
                renderedNpcTurns: new Set(),
                streamed: {
                    playerAction: false
                },
                statusElement: null,
                httpResolved: false,
                streamComplete: false,
                streamMeta: null
            };
            this.pendingRequests.set(requestId, context);
        }
        return context;
    }

    getRequestContext(requestId) {
        if (!requestId) {
            return null;
        }
        return this.pendingRequests.get(requestId) || null;
    }

    createStatusElement(requestId) {
        const element = document.createElement('div');
        element.className = 'message ai-message loading status-update';
        element.dataset.requestId = requestId;

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🤖 AI Game Master';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = 'Processing...';

        element.appendChild(senderDiv);
        element.appendChild(contentDiv);
        this.chatLog.appendChild(element);
        this.streamingStatusElements.set(requestId, element);
        this.scrollToBottom();
        return element;
    }

    updateStatusMessage(requestId, message, { stage = null, scope = 'chat' } = {}) {
        if (!requestId) {
            return;
        }
        const context = this.ensureRequestContext(requestId);
        if (!context) {
            return;
        }

        let element = context.statusElement;
        if (!element) {
            element = this.createStatusElement(requestId);
            context.statusElement = element;
        }

        if (element) {
            element.dataset.stage = stage || '';
            element.dataset.scope = scope;
            const contentDiv = element.querySelector('.message-content');
            if (contentDiv) {
                contentDiv.textContent = message;
            }
        }
    }

    removeStatusMessage(requestId) {
        if (!requestId) {
            return;
        }
        const element = this.streamingStatusElements.get(requestId);
        if (element) {
            element.remove();
            this.streamingStatusElements.delete(requestId);
        }
        const context = this.pendingRequests.get(requestId);
        if (context) {
            context.statusElement = null;
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

    addNpcMessage(npcName, content) {
        if (!content) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message npc-message ai-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = `🤖 NPC · ${npcName || 'Unknown NPC'}`;

        const contentDiv = document.createElement('div');
        contentDiv.textContent = content;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addEventMessage(contentHtml) {
        if (!contentHtml) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '📊 Event Checks';

        const contentDiv = document.createElement('div');
        const details = document.createElement('details');
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = 'Event Checks';
        details.appendChild(summaryEl);
        const detailsBody = document.createElement('div');
        detailsBody.innerHTML = contentHtml;
        details.appendChild(detailsBody);
        contentDiv.appendChild(details);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addEventSummary(icon, summaryText) {
        if (!summaryText) {
            return;
        }

        if (this.pushEventBundleItem(icon || '📣', summaryText)) {
            return;
        }

        this.renderStandaloneEventSummary(icon, summaryText);
    }

    addExperienceAward(amount, reason = '') {
        const numeric = Number(amount);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return;
        }

        const reasonText = reason && String(reason).trim();
        const summaryText = `+${numeric} XP${reasonText ? ` (${reasonText})` : ''}`;

        if (this.pushEventBundleItem('✨', summaryText)) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-summary xp-award';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '✨ Experience Gained';

        const contentDiv = document.createElement('div');
        contentDiv.textContent = summaryText;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addExperienceAwards(awards) {
        if (!Array.isArray(awards)) {
            return;
        }
        awards.forEach(entry => {
            if (!entry) {
                return;
            }
            const amount = typeof entry === 'object' ? entry.amount : entry;
            const reason = typeof entry === 'object' ? entry.reason : '';
            this.addExperienceAward(amount, reason);
        });
    }

    getCurrencyLabel(amount) {
        const setting = window.currentSetting || {};
        if (window.CurrencyUtils && typeof window.CurrencyUtils.getCurrencyLabel === 'function') {
            return window.CurrencyUtils.getCurrencyLabel(amount, { setting });
        }

        const singular = typeof setting.currencyName === 'string' && setting.currencyName.trim()
            ? setting.currencyName.trim()
            : 'coin';
        const plural = typeof setting.currencyNamePlural === 'string' && setting.currencyNamePlural.trim()
            ? setting.currencyNamePlural.trim()
            : `${singular}s`;
        return Math.abs(Number(amount)) === 1 ? singular : plural;
    }

    addCurrencyChange(amount) {
        const numeric = Number(amount);
        if (!Number.isFinite(numeric) || numeric === 0) {
            return;
        }

        const sign = numeric > 0 ? '+' : '-';
        const absolute = Math.abs(numeric);
        const label = this.getCurrencyLabel(absolute);
        const summaryText = `${sign}${absolute} ${label}`;

        if (this.pushEventBundleItem('💰', summaryText)) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-summary currency-change';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '💰 Currency Update';

        const contentDiv = document.createElement('div');
        contentDiv.textContent = summaryText;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addCurrencyChanges(changes) {
        if (!Array.isArray(changes)) {
            return;
        }
        changes.forEach(entry => {
            if (!entry) {
                return;
            }
            const amount = typeof entry === 'object' ? entry.amount : entry;
            this.addCurrencyChange(amount);
        });
    }

    addNeedBarChanges(changes) {
        if (!Array.isArray(changes) || !changes.length) {
            return;
        }

        const items = changes.filter(Boolean);
        if (!items.length) {
            return;
        }

        if (this.activeEventBundle) {
            items.forEach(change => {
                if (!change) {
                    return;
                }
                const actorName = change.actorName || change.actorId || 'Unknown';
                const barName = change.needBarName || change.needBar || 'Need Bar';
                const direction = typeof change.direction === 'string' ? change.direction.trim().toLowerCase() : '';
                const magnitude = typeof change.magnitude === 'string' ? change.magnitude.trim().toLowerCase() : '';
                const parts = [];
                if (magnitude) {
                    parts.push(magnitude);
                }
                if (direction) {
                    parts.push(direction);
                }
                const detail = parts.length ? parts.join(' ') : 'changed';

                const baseline = `${actorName}'s ${barName} ${detail}`.trim();
                const segments = [baseline];

                const delta = Number(change.delta);
                if (Number.isFinite(delta) && delta !== 0) {
                    segments.push(`Δ ${delta > 0 ? '+' : ''}${Math.round(delta)}`);
                }

                const reason = change.reason && String(change.reason).trim();
                if (reason) {
                    segments.push(`– ${reason}`);
                }

                const threshold = change.currentThreshold;
                if (threshold && threshold.name) {
                    const effect = threshold.effect ? ` – ${threshold.effect}` : '';
                    segments.push(`→ ${threshold.name}${effect}`);
                }

                this.addEventSummary('🧪', segments.join(' '));
            });

            this.markEventBundleRefresh();
            return;
        }

        const capitalize = (value) => {
            if (typeof value !== 'string') {
                return '';
            }
            const trimmed = value.trim();
            if (!trimmed) {
                return '';
            }
            return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
        };

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-summary needbar-change';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🧪 Need Bar Update';

        const contentDiv = document.createElement('div');
        const list = document.createElement('ul');

        items.forEach(change => {
            const actorName = change.actorName || change.actorId || 'Unknown';
            const barName = change.needBarName || change.needBarId || 'Need Bar';
            const delta = Number(change.delta);
            const newValue = Number(change.newValue);
            const maxValue = Number(change.max);
            const magnitudeLabel = capitalize(change.magnitude || '');
            const directionLabel = capitalize(change.direction || '');
            const reason = typeof change.reason === 'string' ? change.reason.trim() : '';

            const segments = [];
            segments.push(`<strong>${this.escapeHtml(String(actorName))}</strong> – ${this.escapeHtml(String(barName))}`);

            if (Number.isFinite(delta) && delta !== 0) {
                segments.push(`${delta > 0 ? '+' : ''}${delta}`);
            } else if (change.magnitude === 'all' || change.magnitude === 'fill') {
                segments.push('Adjusted to limit');
            }

            if (Number.isFinite(newValue)) {
                const capText = Number.isFinite(maxValue) && maxValue !== newValue
                    ? `/${maxValue}`
                    : (Number.isFinite(maxValue) ? `/${maxValue}` : '');
                segments.push(`now ${newValue}${capText}`);
            }

            const labelParts = [];
            if (directionLabel) {
                labelParts.push(directionLabel);
            }
            if (magnitudeLabel) {
                labelParts.push(magnitudeLabel);
            }
            if (labelParts.length) {
                segments.push(`(${labelParts.join(' ')})`);
            }

            if (reason) {
                segments.push(`– ${this.escapeHtml(reason)}`);
            }

            const threshold = change.currentThreshold;
            if (threshold && threshold.name) {
                const thresholdParts = [this.escapeHtml(String(threshold.name))];
                if (threshold.effect) {
                    thresholdParts.push(this.escapeHtml(String(threshold.effect)));
                }
                segments.push(`→ ${thresholdParts.join(' – ')}`);
            }

            const item = document.createElement('li');
            item.innerHTML = segments.join(' ');
            list.appendChild(item);
        });

        if (!list.childElementCount) {
            return;
        }

        contentDiv.appendChild(list);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();

        this.scheduleLocationRefresh();
    }

    addEnvironmentalDamageEvent(event) {
        if (!event) {
            return;
        }

        const rawAmount = typeof event === 'object' ? (event.amount ?? event.damage ?? event.value) : event;
        const numericAmount = Number(rawAmount);
        const damageAmount = Number.isFinite(numericAmount) ? Math.max(1, Math.round(Math.abs(numericAmount))) : null;
        if (!damageAmount) {
            return;
        }

        const effectTypeRaw = event && typeof event === 'object' && event.type
            ? String(event.type).trim().toLowerCase()
            : 'damage';
        const isHealing = effectTypeRaw === 'healing' || effectTypeRaw === 'heal';
        const name = event && typeof event === 'object' && event.name ? String(event.name).trim() : '';
        const severityRaw = event && typeof event === 'object' && event.severity ? String(event.severity).trim() : '';
        const reason = event && typeof event === 'object' && event.reason ? String(event.reason).trim() : '';
        const summaryMessage = this.buildEnvironmentalSummary({ name, damageAmount, severityRaw, reason, isHealing });

        if (this.pushEventBundleItem(isHealing ? '🌿' : '☠️', summaryMessage)) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-summary environmental-damage';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = isHealing ? '🌿 Environmental Healing' : '☠️ Environmental Damage';

        const contentDiv = document.createElement('div');
        contentDiv.textContent = summaryMessage;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addEnvironmentalDamageEvents(events) {
        if (!Array.isArray(events)) {
            return;
        }
        events.forEach(entry => {
            if (!entry) {
                return;
            }
            this.addEnvironmentalDamageEvent(entry);
        });
    }

    addEventSummaries(eventData) {
        if (!eventData) {
            return;
        }

        const parsed = eventData.parsed || eventData;
        if (!parsed || typeof parsed !== 'object') {
            return;
        }

        const safeName = (value) => {
            if (!value && value !== 0) return 'Someone';
            const text = String(value).trim();
            if (!text) {
                return 'Someone';
            }
            if (text.toLowerCase() === 'player') {
                return 'You';
            }
            return text;
        };

        const safeItem = (value, fallback = 'an item') => {
            if (!value && value !== 0) return fallback;
            const text = String(value).trim();
            return text || fallback;
        };

        const locationRefreshEventTypes = new Set([
            'item_appear',
            'drop_item',
            'pick_up_item',
            'transfer_item',
            'consume_item',
            'move_location',
            'npc_arrival_departure',
            'needbar_change',
            'alter_item',
            'alter_location'
        ]);
        let shouldRefreshLocation = false;

        const handlers = {
            attack_damage: (entries) => {
                entries.forEach((entry) => {
                    const attacker = safeName(entry?.attacker);
                    const target = safeName(entry?.target || 'their target');
                    this.addEventSummary('⚔️', `${attacker} attacked ${target}.`);
                });
            },
            consume_item: (entries) => {
                entries.forEach((entry) => {
                    const user = safeName(entry?.user);
                    const item = safeItem(entry?.item);
                    this.addEventSummary('🧪', `${user} consumed ${item}.`);
                });
            },
            death_incapacitation: (entries) => {
                entries.forEach((name) => {
                    const target = safeName(name);
                    this.addEventSummary('☠️', `${target} was incapacitated.`);
                });
            },
            drop_item: (entries) => {
                entries.forEach((entry) => {
                    const character = safeName(entry?.character);
                    const item = safeItem(entry?.item);
                    this.addEventSummary('📦', `${character} dropped ${item}.`);
                });
            },
            heal_recover: (entries) => {
                entries.forEach((entry) => {
                    const healer = entry?.healer ? safeName(entry.healer) : null;
                    const recipient = safeName(entry?.recipient);
                    const effect = entry?.effect && String(entry.effect).trim();
                    const detail = effect ? ` (${effect})` : '';
                    if (healer) {
                        this.addEventSummary('💖', `${healer} healed ${recipient}${detail}.`);
                    } else {
                        this.addEventSummary('💖', `${recipient} recovered${detail}.`);
                    }
                });
            },
            item_appear: (entries) => {
                entries.forEach((item) => {
                    const itemName = safeItem(item);
                    this.addEventSummary('✨', `${itemName} appeared in the scene.`);
                });
            },
            move_location: (entries) => {
                entries.forEach((location) => {
                    const destination = safeItem(location, 'a new location');
                    this.addEventSummary('🚶', `Travelled to ${destination}.`);
                });
            },
            new_exit_discovered: (entries) => {
                entries.forEach((description) => {
                    const detail = safeItem(description, 'a new path');
                    this.addEventSummary('🚪', `New exit discovered: ${detail}.`);
                });
            },
            npc_arrival_departure: (entries) => {
                entries.forEach((entry) => {
                    const name = safeName(entry?.name);
                    const action = (entry?.action || '').trim().toLowerCase();
                    const destination = entry?.destination || entry?.location;
                    const destinationText = destination ? safeItem(destination, 'another location') : null;
                    if (action === 'arrived') {
                        this.addEventSummary('🙋', `${name} arrived at the location.`);
                    } else if (action === 'left') {
                        const detail = destinationText ? ` for ${destinationText}` : '';
                        this.addEventSummary('🏃', `${name} left the area${detail}.`);
                    } else {
                        this.addEventSummary('📍', `${name} ${entry?.action || 'moved'}.`);
                    }
                });
            },
            party_change: (entries) => {
                entries.forEach((entry) => {
                    const name = safeName(entry?.name);
                    const action = (entry?.action || '').trim().toLowerCase();
                    if (action === 'joined') {
                        this.addEventSummary('🤝', `${name} joined the party.`);
                    } else if (action === 'left') {
                        this.addEventSummary('👋', `${name} left the party.`);
                    } else {
                        this.addEventSummary('📣', `${name} ${entry?.action || 'changed party status'}.`);
                    }
                });
            },
            pick_up_item: (entries) => {
                entries.forEach((entry) => {
                    const actor = safeName(entry?.name);
                    const itemName = safeItem(entry?.item);
                    this.addEventSummary('🎒', `${actor} picked up ${itemName}.`);
                });
            },
            status_effect_change: (entries) => {
                entries.forEach((entry) => {
                    const entity = safeName(entry?.entity);
                    const description = entry?.description ? String(entry.description).trim() : 'a status effect';
                    const action = (entry?.action || '').trim().toLowerCase();
                    if (action === 'gained') {
                        this.addEventSummary('🌀', `${entity} gained ${description}.`);
                    } else if (action === 'lost') {
                        this.addEventSummary('🌀', `${entity} lost ${description}.`);
                    } else {
                        this.addEventSummary('🌀', `${entity} changed status: ${description}.`);
                    }
                });
            },
            transfer_item: (entries) => {
                entries.forEach((entry) => {
                    const giver = safeName(entry?.giver);
                    const item = safeItem(entry?.item);
                    const receiver = safeName(entry?.receiver);
                    this.addEventSummary('🔄', `${giver} gave ${item} to ${receiver}.`);
                });
            },
            alter_item: (entries) => {
                entries.forEach((entry) => {
                    if (!entry) {
                        return;
                    }
                    const original = safeItem(entry.originalName || entry.newName || 'an item');
                    const renamed = entry.newName && entry.originalName && entry.newName !== entry.originalName
                        ? safeItem(entry.newName)
                        : null;
                    const changeDescription = entry.changeDescription ? String(entry.changeDescription).trim() : '';
                    let text;
                    if (renamed) {
                        text = `${original} upgraded to ${renamed}`;
                    } else {
                        text = `${original} was altered permanently`;
                    }
                    if (changeDescription) {
                        text += ` (${changeDescription})`;
                    }
                    text += '.';
                    this.addEventSummary('🛠️', text);
                });
            },
            alter_location: (entries) => {
                entries.forEach((entry) => {
                    if (!entry) {
                        return;
                    }
                    const locationName = safeItem(entry.name || 'The location', 'The location');
                    const changeDescription = entry.changeDescription ? String(entry.changeDescription).trim() : '';
                    const summaryText = changeDescription
                        ? `${locationName} changed: ${changeDescription}.`
                        : `${locationName} was altered.`;
                    this.addEventSummary('🏙️', summaryText);
                });
            },
            alter_npc: (entries) => {
                entries.forEach((entry) => {
                    if (!entry) {
                        return;
                    }
                    const npcName = safeName(entry.name || entry.originalName || 'An NPC');
                    const changeDescription = entry.changeDescription ? String(entry.changeDescription).trim() : '';
                    let text = changeDescription
                        ? `${npcName}: ${changeDescription}`
                        : `${npcName} was altered.`;
                    if (Array.isArray(entry.droppedItems) && entry.droppedItems.length) {
                        const dropped = entry.droppedItems.map(item => safeItem(item, 'an item')).join(', ');
                        text += ` Dropped ${dropped}.`;
                    }
                    if (!text.endsWith('.')) {
                        text += '.';
                    }
                    this.addEventSummary('🧬', text);
                });
            },
            needbar_change: (entries) => {
                const formatLabel = (value) => {
                    if (!value || typeof value !== 'string') {
                        return '';
                    }
                    const trimmed = value.trim();
                    if (!trimmed) {
                        return '';
                    }
                    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
                };

                entries.forEach((entry) => {
                    const actor = safeName(entry?.character || entry?.name);
                    const barName = safeItem(entry?.needBar, 'a need bar');
                    const direction = formatLabel(entry?.direction || '');
                    const magnitude = formatLabel(entry?.magnitude || '');
                    const detailParts = [];
                    if (magnitude) {
                        detailParts.push(magnitude.toLowerCase());
                    }
                    if (direction) {
                        detailParts.push(direction.toLowerCase());
                    }
                    const detailText = detailParts.length ? detailParts.join(' ') : '';
                    const text = detailText
                        ? `${actor}'s ${barName} had a ${detailText}.`
                        : `${actor}'s ${barName} changed.`;
                    this.addEventSummary('🧪', text);
                });
            }
        };

        Object.entries(parsed).forEach(([eventType, entries]) => {
            if (!entries || (Array.isArray(entries) && entries.length === 0)) {
                return;
            }

            const handler = handlers[eventType];
            if (!handler) {
                return;
            }

            const normalized = Array.isArray(entries) ? entries : [entries];
            handler(normalized);

            if (!shouldRefreshLocation && locationRefreshEventTypes.has(eventType)) {
                shouldRefreshLocation = true;
            }
        });

        if (shouldRefreshLocation) {
            if (this.activeEventBundle) {
                this.markEventBundleRefresh();
            } else {
                this.scheduleLocationRefresh();
            }
        }
    }

    renderStandaloneEventSummary(icon, summaryText) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-summary';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = `${icon || '📣'} Event`;

        const contentDiv = document.createElement('div');
        contentDiv.textContent = summaryText;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    pushEventBundleItem(icon, text) {
        if (!this.activeEventBundle) {
            return false;
        }
        if (!text) {
            return true;
        }
        this.activeEventBundle.items.push({
            icon: icon || '•',
            text: text
        });
        return true;
    }

    markEventBundleRefresh() {
        if (this.activeEventBundle) {
            this.activeEventBundle.refresh = true;
        } else {
            this.scheduleLocationRefresh();
        }
    }

    startEventBundle() {
        if (this.activeEventBundle) {
            return this.activeEventBundle;
        }
        this.activeEventBundle = {
            items: [],
            refresh: false,
            timestamp: new Date().toISOString()
        };
        return this.activeEventBundle;
    }

    flushEventBundle() {
        const bundle = this.activeEventBundle;
        this.activeEventBundle = null;
        if (!bundle) {
            return { shouldRefresh: false };
        }

        if (!bundle.items.length) {
            if (bundle.refresh) {
                this.scheduleLocationRefresh();
            }
            return { shouldRefresh: bundle.refresh };
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-summary-batch';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '📋 Events';

        const contentDiv = document.createElement('div');
        const list = document.createElement('ul');
        list.className = 'event-summary-list';

        bundle.items.forEach(item => {
            const li = document.createElement('li');
            const iconSpan = document.createElement('span');
            iconSpan.className = 'event-summary-icon';
            iconSpan.textContent = item.icon || '•';
            li.appendChild(iconSpan);
            li.appendChild(document.createTextNode(' ' + item.text));
            list.appendChild(li);
        });

        contentDiv.appendChild(list);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = bundle.timestamp || new Date().toISOString();
        timestampDiv.textContent = timestamp.replace('T', ' ').replace('Z', '');

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();

        if (bundle.refresh) {
            this.scheduleLocationRefresh();
        }

        return { shouldRefresh: bundle.refresh };
    }

    buildEnvironmentalSummary({ name, damageAmount, severityRaw, reason, isHealing }) {
        const severityLabel = severityRaw ? severityRaw.charAt(0).toUpperCase() + severityRaw.slice(1) : '';
        let description;
        if (name) {
            description = isHealing
                ? `${name} regained ${damageAmount} HP`
                : `${name} took ${damageAmount} damage`;
        } else {
            description = isHealing
                ? `Regained ${damageAmount} HP`
                : `Took ${damageAmount} damage`;
        }

        if (severityLabel) {
            description += ` (${severityLabel})`;
        }
        if (reason) {
            description += ` - ${reason}`;
        }
        return description;
    }

    scheduleLocationRefresh(delays = [0, 400, 1200]) {
        if (!Array.isArray(this.locationRefreshTimers)) {
            this.locationRefreshTimers = [];
        }

        if (this.locationRefreshPending) {
            this.locationRefreshTimers.forEach(timerId => clearTimeout(timerId));
            this.locationRefreshTimers = [];
            this.locationRefreshPending = false;
        }

        const uniqueDelays = Array.from(new Set((Array.isArray(delays) ? delays : [delays])
            .map(value => Number(value))
            .filter(value => Number.isFinite(value) && value >= 0)));

        if (!uniqueDelays.length) {
            uniqueDelays.push(0);
        }

        this.locationRefreshPending = true;
        this.locationRefreshTimers = uniqueDelays.map(delay => {
            const timerId = setTimeout(() => {
                Promise.resolve(this.checkLocationUpdate())
                    .catch(() => { })
                    .finally(() => {
                        this.locationRefreshTimers = this.locationRefreshTimers.filter(id => id !== timerId);
                        if (this.locationRefreshTimers.length === 0) {
                            this.locationRefreshPending = false;
                        }
                    });
            }, delay);
            return timerId;
        });
    }

    addPlausibilityMessage(contentHtml) {
        if (!contentHtml) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message plausibility-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🧭 Plausibility Check';

        const contentDiv = document.createElement('div');
        const details = document.createElement('details');
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = 'Plausibility Check';
        details.appendChild(summaryEl);

        const body = document.createElement('div');
        body.innerHTML = contentHtml;
        details.appendChild(body);

        contentDiv.appendChild(details);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addSkillCheckMessage(resolution) {
        if (!resolution || typeof resolution !== 'object') {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message skill-check-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🎯 Skill Check';

        const contentDiv = document.createElement('div');

        const lines = [];
        const { roll = {}, difficulty = {}, skill, attribute, label, reason, margin, type } = resolution;

        const formatSigned = (value) => {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return null;
            }
            return value >= 0 ? `+${value}` : `${value}`;
        };

        if (skill || typeof roll.skillValue === 'number') {
            const parts = [];
            if (skill) {
                parts.push(this.escapeHtml(String(skill)));
            }
            if (typeof roll.skillValue === 'number') {
                const modifier = formatSigned(roll.skillValue);
                parts.push(modifier !== null ? `(${modifier})` : `(${roll.skillValue})`);
            }
            if (parts.length) {
                lines.push(`<li><strong>Skill:</strong> ${parts.join(' ')}</li>`);
            }
        }

        if (attribute || typeof roll.attributeBonus === 'number') {
            const parts = [];
            if (attribute) {
                parts.push(this.escapeHtml(String(attribute)));
            }
            if (typeof roll.attributeBonus === 'number') {
                const modifier = formatSigned(roll.attributeBonus);
                parts.push(modifier !== null ? `(${modifier})` : `(${roll.attributeBonus})`);
            }
            if (parts.length) {
                lines.push(`<li><strong>Attribute:</strong> ${parts.join(' ')}</li>`);
            }
        }

        if (difficulty && (difficulty.label || typeof difficulty.dc === 'number')) {
            const diffParts = [];
            if (difficulty.label) {
                diffParts.push(this.escapeHtml(String(difficulty.label)));
            }
            if (typeof difficulty.dc === 'number') {
                diffParts.push(`(DC ${difficulty.dc})`);
            }
            if (diffParts.length) {
                lines.push(`<li><strong>Difficulty:</strong> ${diffParts.join(' ')}</li>`);
            }
        }

        const circumstanceEntries = Array.isArray(roll.circumstanceModifiers)
            ? roll.circumstanceModifiers
            : [];
        const formatCircumstanceEntry = (entry) => {
            if (!entry) {
                return null;
            }
            const hasAmount = typeof entry.amount === 'number' && !Number.isNaN(entry.amount);
            const amountText = hasAmount
                ? (formatSigned(entry.amount) ?? String(entry.amount))
                : null;
            const reasonText = entry.reason ? String(entry.reason) : null;

            const parts = [];
            if (amountText) {
                parts.push(amountText);
            }
            if (reasonText) {
                parts.push(amountText ? `– ${reasonText}` : reasonText);
            }

            if (!parts.length) {
                return null;
            }

            return this.escapeHtml(parts.join(' '));
        };

        const formattedCircumstances = circumstanceEntries
            .map(formatCircumstanceEntry)
            .filter(Boolean);

        const hasCircumstanceDetails = formattedCircumstances.length > 0;
        const hasCircumstanceReason = Boolean(roll.circumstanceReason);
        const circumstanceTotalAvailable = typeof roll.circumstanceModifier === 'number' && !Number.isNaN(roll.circumstanceModifier);
        const shouldShowCircumstances = hasCircumstanceDetails
            || hasCircumstanceReason
            || (circumstanceTotalAvailable && roll.circumstanceModifier !== 0);

        if (shouldShowCircumstances) {
            const parts = [];
            if (circumstanceTotalAvailable && (roll.circumstanceModifier !== 0 || hasCircumstanceDetails)) {
                const totalText = formatSigned(roll.circumstanceModifier) ?? roll.circumstanceModifier;
                parts.push(`Total ${totalText}`);
            }
            if (formattedCircumstances.length) {
                parts.push(`<small>${formattedCircumstances.join('<br>')}</small>`);
            } else if (hasCircumstanceReason) {
                parts.push(this.escapeHtml(String(roll.circumstanceReason)));
            }

            lines.push(`<li><strong>Circumstances:</strong> ${parts.join('<br>')}</li>`);
        }

        if (roll && (typeof roll.die === 'number' || typeof roll.total === 'number')) {
            const segments = [];
            if (typeof roll.die === 'number') {
                segments.push(`d20 ${roll.die}`);
            }
            if (typeof roll.skillValue === 'number') {
                const modifier = formatSigned(roll.skillValue);
                segments.push(`Skill ${modifier !== null ? modifier : roll.skillValue}`);
            }
            if (typeof roll.attributeBonus === 'number') {
                const modifier = formatSigned(roll.attributeBonus);
                segments.push(`Attribute ${modifier !== null ? modifier : roll.attributeBonus}`);
            }
            if (typeof roll.circumstanceModifier === 'number'
                && !Number.isNaN(roll.circumstanceModifier)
                && (roll.circumstanceModifier !== 0 || formattedCircumstances.length)) {
                const modifier = formatSigned(roll.circumstanceModifier);
                segments.push(`Circumstances ${modifier !== null ? modifier : roll.circumstanceModifier}`);
            }
            if (typeof roll.total === 'number') {
                segments.push(`Total ${roll.total}`);
            }

            let rollText = segments.join(' → ');
            if (roll.detail) {
                rollText += `<br><small>${this.escapeHtml(String(roll.detail))}</small>`;
            }

            lines.push(`<li><strong>Roll:</strong> ${rollText}</li>`);
        }

        const resultParts = [];
        if (label) {
            resultParts.push(this.escapeHtml(String(label)));
        }
        if (typeof margin === 'number') {
            resultParts.push(`(margin ${margin >= 0 ? '+' : ''}${margin})`);
        }
        if (type) {
            resultParts.push(`[${this.escapeHtml(String(type))}]`);
        }
        if (reason) {
            resultParts.push(`– ${this.escapeHtml(String(reason))}`);
        }
        if (resultParts.length) {
            lines.push(`<li><strong>Outcome:</strong> ${resultParts.join(' ')}</li>`);
        }

        if (!lines.length) {
            return;
        }

        const details = document.createElement('details');
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = 'Skill Check';
        details.appendChild(summaryEl);

        const wrapper = document.createElement('div');
        wrapper.className = 'skill-check-details';
        wrapper.innerHTML = `<ul>${lines.join('\n')}</ul>`;
        details.appendChild(wrapper);

        contentDiv.appendChild(details);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addAttackCheckMessage(summary) {
        if (!summary || typeof summary !== 'object') {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message attack-check-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '⚔️ Attack Check';

        const contentDiv = document.createElement('div');

        const lines = [];
        const formatSigned = (value) => {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return null;
            }
            return value >= 0 ? `+${value}` : `${value}`;
        };

        const resultParts = [];
        if (typeof summary.hit === 'boolean') {
            resultParts.push(summary.hit ? 'Hit' : 'Miss');
        }
        if (typeof summary.hitDegree === 'number' && !Number.isNaN(summary.hitDegree)) {
            resultParts.push(`(degree ${summary.hitDegree >= 0 ? '+' : ''}${summary.hitDegree})`);
        }
        if (resultParts.length) {
            lines.push(`<li><strong>Result:</strong> ${resultParts.join(' ')}</li>`);
        }

        const attacker = summary.attacker || {};
        const attackerParts = [];
        if (attacker.name) {
            attackerParts.push(this.escapeHtml(String(attacker.name)));
        }
        if (typeof attacker.level === 'number') {
            attackerParts.push(`Level ${attacker.level}`);
        }
        if (attacker.weapon) {
            attackerParts.push(`Weapon: ${this.escapeHtml(String(attacker.weapon))}`);
        }
        if (attacker.ability && attacker.ability !== 'N/A') {
            attackerParts.push(`Ability: ${this.escapeHtml(String(attacker.ability))}`);
        }
        if (attackerParts.length) {
            lines.push(`<li><strong>Attacker:</strong> ${attackerParts.join(' • ')}</li>`);
        }

        if (attacker.attackSkill && (attacker.attackSkill.name || typeof attacker.attackSkill.value === 'number')) {
            const parts = [];
            if (attacker.attackSkill.name) {
                parts.push(this.escapeHtml(String(attacker.attackSkill.name)));
            }
            if (typeof attacker.attackSkill.value === 'number') {
                const modifier = formatSigned(attacker.attackSkill.value);
                parts.push(modifier !== null ? modifier : String(attacker.attackSkill.value));
            }
            if (parts.length) {
                lines.push(`<li><strong>Attack Skill:</strong> ${parts.join(' ')}</li>`);
            }
        }

        if (attacker.attackAttribute && (attacker.attackAttribute.name || typeof attacker.attackAttribute.modifier === 'number')) {
            const parts = [];
            if (attacker.attackAttribute.name) {
                parts.push(this.escapeHtml(String(attacker.attackAttribute.name)));
            }
            if (typeof attacker.attackAttribute.modifier === 'number') {
                const modifier = formatSigned(attacker.attackAttribute.modifier);
                parts.push(modifier !== null ? modifier : String(attacker.attackAttribute.modifier));
            }
            if (parts.length) {
                lines.push(`<li><strong>Attack Attribute:</strong> ${parts.join(' ')}</li>`);
            }
        }

        const defender = summary.defender || {};
        const defenderParts = [];
        if (defender.name) {
            defenderParts.push(this.escapeHtml(String(defender.name)));
        }
        if (typeof defender.level === 'number') {
            defenderParts.push(`Level ${defender.level}`);
        }
        if (defender.defenseSkill) {
            const defenseSkill = defender.defenseSkill;
            const defenceSegments = [];
            if (defenseSkill.name) {
                defenceSegments.push(this.escapeHtml(String(defenseSkill.name)));
            }
            if (typeof defenseSkill.value === 'number') {
                const modifier = formatSigned(defenseSkill.value);
                defenceSegments.push(modifier !== null ? modifier : String(defenseSkill.value));
            }
            if (defenseSkill.source) {
                defenceSegments.push(`[${this.escapeHtml(String(defenseSkill.source))}]`);
            }
            if (defenceSegments.length) {
                defenderParts.push(`Defense: ${defenceSegments.join(' ')}`);
            }
        }
        if (defenderParts.length) {
            lines.push(`<li><strong>Defender:</strong> ${defenderParts.join(' • ')}</li>`);
        }

        const difficulty = summary.difficulty || {};
        if (difficulty.value || typeof difficulty.defenderLevel === 'number' || difficulty.defenseSkill) {
            const diffParts = [];
            if (typeof difficulty.value === 'number') {
                diffParts.push(`Hit DC ${difficulty.value}`);
            }
            if (typeof difficulty.defenderLevel === 'number') {
                diffParts.push(`Defender Level ${difficulty.defenderLevel}`);
            }
            if (difficulty.defenseSkill && difficulty.defenseSkill.name) {
                diffParts.push(`Best Defense: ${this.escapeHtml(String(difficulty.defenseSkill.name))}`);
            }
            if (diffParts.length) {
                lines.push(`<li><strong>Difficulty:</strong> ${diffParts.join(' • ')}</li>`);
            }
        }

        const roll = summary.roll || {};
        const circumstanceEntries = Array.isArray(roll.circumstanceModifiers)
            ? roll.circumstanceModifiers
            : [];
        const formatCircumstanceEntry = (entry) => {
            if (!entry) {
                return null;
            }
            const hasAmount = typeof entry.amount === 'number' && !Number.isNaN(entry.amount);
            const amountText = hasAmount
                ? (formatSigned(entry.amount) ?? String(entry.amount))
                : null;
            const reasonText = entry.reason ? String(entry.reason) : null;

            const parts = [];
            if (amountText) {
                parts.push(amountText);
            }
            if (reasonText) {
                parts.push(amountText ? `– ${reasonText}` : reasonText);
            }

            if (!parts.length) {
                return null;
            }
            return this.escapeHtml(parts.join(' '));
        };

        const formattedCircumstances = circumstanceEntries
            .map(formatCircumstanceEntry)
            .filter(Boolean);
        const totalCircumstanceAvailable = typeof roll.circumstanceModifier === 'number' && !Number.isNaN(roll.circumstanceModifier);
        const hasCircumstanceReason = Boolean(roll.circumstanceReason);
        const shouldShowCircumstances = formattedCircumstances.length
            || hasCircumstanceReason
            || (totalCircumstanceAvailable && roll.circumstanceModifier !== 0);

        if (shouldShowCircumstances) {
            const parts = [];
            if (totalCircumstanceAvailable && (roll.circumstanceModifier !== 0 || formattedCircumstances.length)) {
                const totalText = formatSigned(roll.circumstanceModifier) ?? roll.circumstanceModifier;
                parts.push(`Total ${totalText}`);
            }
            if (formattedCircumstances.length) {
                parts.push(`<small>${formattedCircumstances.join('<br>')}</small>`);
            } else if (hasCircumstanceReason) {
                parts.push(this.escapeHtml(String(roll.circumstanceReason)));
            }

            lines.push(`<li><strong>Circumstances:</strong> ${parts.join('<br>')}</li>`);
        }

        if (typeof roll.die === 'number' || typeof roll.total === 'number' || roll.attackSkill || roll.attackAttribute) {
            const rollSegments = [];
            if (typeof roll.die === 'number') {
                rollSegments.push(`d20 ${roll.die}`);
            }
            if (roll.attackSkill && typeof roll.attackSkill.value === 'number') {
                const skillName = roll.attackSkill.name ? `${this.escapeHtml(String(roll.attackSkill.name))} ` : '';
                const modifier = formatSigned(roll.attackSkill.value);
                rollSegments.push(`${skillName}${modifier !== null ? modifier : roll.attackSkill.value}`);
            }
            if (roll.attackAttribute && typeof roll.attackAttribute.modifier === 'number') {
                const attrName = roll.attackAttribute.name ? `${this.escapeHtml(String(roll.attackAttribute.name))} ` : '';
                const modifier = formatSigned(roll.attackAttribute.modifier);
                rollSegments.push(`${attrName}${modifier !== null ? modifier : roll.attackAttribute.modifier}`);
            }
            if (totalCircumstanceAvailable
                && (roll.circumstanceModifier !== 0 || formattedCircumstances.length)) {
                const modifier = formatSigned(roll.circumstanceModifier);
                rollSegments.push(`Circumstances ${modifier !== null ? modifier : roll.circumstanceModifier}`);
            }
            if (typeof roll.total === 'number') {
                rollSegments.push(`Total ${roll.total}`);
            }

            if (rollSegments.length) {
                let rollText = rollSegments.join(' → ');
                if (roll.detail) {
                    rollText += `<br><small>${this.escapeHtml(String(roll.detail))}</small>`;
                }
                lines.push(`<li><strong>Roll:</strong> ${rollText}</li>`);
            }
        }

        const damage = summary.damage || {};
        if (typeof damage.total === 'number' || typeof damage.raw === 'number' || damage.weaponName || (damage.damageAttribute && (damage.damageAttribute.name || typeof damage.damageAttribute.modifier === 'number'))) {
            const damageParts = [];
            if (typeof damage.total === 'number') {
                damageParts.push(`Total ${damage.total}`);
            }
            if (typeof damage.applied === 'number' && damage.applied !== damage.total) {
                damageParts.push(`Applied ${damage.applied}`);
            }
            if (typeof damage.raw === 'number' && damage.raw !== damage.total) {
                damageParts.push(`Raw ${damage.raw}`);
            }
            if (typeof damage.toughnessReduction === 'number' && damage.toughnessReduction) {
                damageParts.push(`Toughness -${Math.abs(damage.toughnessReduction)}`);
            }
            if (damageParts.length) {
                lines.push(`<li><strong>Damage:</strong> ${damageParts.join(' • ')}</li>`);
            }

            const weaponParts = [];
            if (damage.weaponName) {
                weaponParts.push(this.escapeHtml(String(damage.weaponName)));
            }
            if (typeof damage.weaponRating === 'number') {
                weaponParts.push(`Rating ${damage.weaponRating}`);
            }
            if (typeof damage.baseWeaponDamage === 'number') {
                weaponParts.push(`Base ${damage.baseWeaponDamage}`);
            }
            if (weaponParts.length) {
                lines.push(`<li><strong>Weapon:</strong> ${weaponParts.join(' • ')}</li>`);
            }

            if (damage.damageAttribute && (damage.damageAttribute.name || typeof damage.damageAttribute.modifier === 'number')) {
                const parts = [];
                if (damage.damageAttribute.name) {
                    parts.push(this.escapeHtml(String(damage.damageAttribute.name)));
                }
                if (typeof damage.damageAttribute.modifier === 'number') {
                    const modifier = formatSigned(damage.damageAttribute.modifier);
                    parts.push(modifier !== null ? modifier : String(damage.damageAttribute.modifier));
                }
                if (parts.length) {
                    lines.push(`<li><strong>Damage Attribute:</strong> ${parts.join(' ')}</li>`);
                }
            }
        }

        const target = summary.target || {};
        if (typeof target.startingHealth === 'number' || typeof target.remainingHealth === 'number') {
            const targetParts = [];
            if (typeof target.startingHealth === 'number') {
                targetParts.push(`Start ${target.startingHealth}`);
            }
            if (typeof target.remainingHealth === 'number') {
                targetParts.push(`End ${target.remainingHealth}`);
            }
            if (typeof target.healthLostPercent === 'number') {
                targetParts.push(`Lost ${target.healthLostPercent}%`);
            }
            if (typeof target.remainingHealthPercent === 'number') {
                targetParts.push(`Remaining ${target.remainingHealthPercent}%`);
            }
            if (typeof target.defeated === 'boolean') {
                targetParts.push(target.defeated ? 'Defeated' : 'Standing');
            }
            if (targetParts.length) {
                lines.push(`<li><strong>Target Health:</strong> ${targetParts.join(' • ')}</li>`);
            }
        }

        if (!lines.length) {
            return;
        }

        const details = document.createElement('details');
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = 'Attack Check';
        details.appendChild(summaryEl);

        const wrapper = document.createElement('div');
        wrapper.className = 'skill-check-details attack-check-details';
        wrapper.innerHTML = `<ul>${lines.join('\n')}</ul>`;
        details.appendChild(wrapper);

        contentDiv.appendChild(details);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    collectSkillRankElements() {
        const elements = new Map();
        const rankNodes = document.querySelectorAll('.skill-rank[data-skill-name]');
        rankNodes.forEach(node => {
            const name = node.dataset.skillName;
            if (name) {
                elements.set(name, node);
            }
        });
        return elements;
    }

    initSkillIncreaseControls() {
        const buttons = document.querySelectorAll('.skill-increase-btn[data-skill-name]');
        if (!buttons.length) {
            return;
        }

        buttons.forEach(button => {
            button.addEventListener('click', async () => {
                const skillName = button.dataset.skillName;
                if (!skillName) return;

                try {
                    const response = await fetch(`/api/player/skills/${encodeURIComponent(skillName)}/increase`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ amount: 1 })
                    });

                    const data = await response.json();

                    if (!response.ok || !data.success) {
                        throw new Error(data.error || `Server error (${response.status})`);
                    }

                    if (data.player) {
                        this.refreshSkillState(data.player);
                    }
                } catch (error) {
                    alert(`Failed to increase skill: ${error.message}`);
                }
            });
        });
    }

    updateSkillPointsDisplay(value) {
        if (this.skillPointsDisplay && value !== undefined && value !== null) {
            this.skillPointsDisplay.textContent = value;
        }
    }

    updateSkillRankDisplay(skillName, rank) {
        if (!skillName) return;
        const element = this.skillRankElements.get(skillName);
        if (element && rank !== undefined && rank !== null) {
            element.textContent = rank;
        }
    }

    refreshSkillState(player) {
        if (!player) return;
        if (player.unspentSkillPoints !== undefined) {
            this.updateSkillPointsDisplay(player.unspentSkillPoints);
        }
        if (player.skills) {
            for (const [skillName, rank] of Object.entries(player.skills)) {
                this.updateSkillRankDisplay(skillName, rank);
            }
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showLoading(requestId, message = 'Thinking...') {
        if (!requestId) {
            return;
        }
        this.updateStatusMessage(requestId, message, { stage: 'loading' });
    }

    hideLoading(requestId) {
        if (!requestId) {
            return;
        }
        this.removeStatusMessage(requestId);
    }

    setSendButtonLoading(isLoading) {
        if (!this.sendButton) {
            return;
        }

        if (isLoading) {
            this.sendButton.classList.add('is-loading');
            this.sendButton.disabled = true;
            this.sendButton.setAttribute('aria-busy', 'true');
            this.sendButton.innerHTML = '<span class="send-button-spinner" aria-hidden="true"></span><span class="sr-only">Sending…</span>';
        } else {
            this.sendButton.classList.remove('is-loading');
            this.sendButton.disabled = false;
            this.sendButton.removeAttribute('aria-busy');
            this.sendButton.innerHTML = this.sendButtonDefaultHtml || 'Send';
        }
    }

    scrollToBottom() {
        this.chatLog.scrollTop = this.chatLog.scrollHeight;
    }

    processChatPayload(requestId, payload, { fromStream = false } = {}) {
        const context = requestId ? this.ensureRequestContext(requestId) : null;
        if (!payload || typeof payload !== 'object') {
            return { shouldRefreshLocation: false };
        }

        this.flushEventBundle();
        this.startEventBundle();

        if (payload.streamMeta && context) {
            context.streamMeta = payload.streamMeta;
        }

        let shouldRefreshLocation = false;

        if (payload.response && (!context || !context.playerActionRendered)) {
            this.hideLoading(requestId);
            this.addMessage('ai', payload.response, false, payload.debug);
            shouldRefreshLocation = true;
            if (context) {
                context.playerActionRendered = true;
                if (context.streamed) {
                    context.streamed.playerAction = context.streamed.playerAction || fromStream;
                }
            }
        }

        if (payload.eventChecks) {
            this.addEventMessage(payload.eventChecks);
        }

        if (payload.actionResolution && payload.actionResolution.roll !== null && payload.actionResolution.roll !== undefined) {
            this.addSkillCheckMessage(payload.actionResolution);
        }

        const resolvedAttackSummary = payload.attackSummary || payload.attackCheck?.summary || null;
        if (resolvedAttackSummary) {
            this.addAttackCheckMessage(resolvedAttackSummary);
        }

        if (payload.events) {
            this.addEventSummaries(payload.events);
            shouldRefreshLocation = true;
        }

        if (Array.isArray(payload.experienceAwards) && payload.experienceAwards.length) {
            this.addExperienceAwards(payload.experienceAwards);
        }

        if (Array.isArray(payload.currencyChanges) && payload.currencyChanges.length) {
            this.addCurrencyChanges(payload.currencyChanges);
        }

        if (Array.isArray(payload.environmentalDamageEvents) && payload.environmentalDamageEvents.length) {
            this.addEnvironmentalDamageEvents(payload.environmentalDamageEvents);
        }

        if (Array.isArray(payload.needBarChanges) && payload.needBarChanges.length) {
            this.addNeedBarChanges(payload.needBarChanges);
            shouldRefreshLocation = true;
        }

        if (Array.isArray(payload.corpseCountdownUpdates) && payload.corpseCountdownUpdates.length) {
            window.updateNpcCorpseVisuals?.(payload.corpseCountdownUpdates);
            shouldRefreshLocation = true;
        }

        if (Array.isArray(payload.corpseRemovals) && payload.corpseRemovals.length) {
            window.removeNpcCards?.(payload.corpseRemovals);
            shouldRefreshLocation = true;
        }

        const bundleResult = this.flushEventBundle();
        if (bundleResult.shouldRefresh) {
            shouldRefreshLocation = true;
        }

        if (payload.plausibility) {
            this.addPlausibilityMessage(payload.plausibility);
        }

        if (Array.isArray(payload.npcTurns) && payload.npcTurns.length) {
            payload.npcTurns.forEach((turn, index) => {
                this.renderNpcTurn(requestId, turn, index, fromStream);
            });
            shouldRefreshLocation = true;
        }

        const finalBundleResult = this.flushEventBundle();
        if (finalBundleResult.shouldRefresh) {
            shouldRefreshLocation = true;
        }

        return { shouldRefreshLocation };
    }

    renderNpcTurn(requestId, turn, index = 0) {
        if (!turn || !turn.response) {
            return;
        }

        this.flushEventBundle();
        this.startEventBundle();

        const context = this.getRequestContext(requestId);
        const keyBase = turn.npcId || turn.name || `npc-${index}`;
        const key = `${keyBase}:${turn.response}`;

        if (context) {
            if (!context.renderedNpcTurns) {
                context.renderedNpcTurns = new Set();
            }
            if (context.renderedNpcTurns.has(key)) {
                return;
            }
            context.renderedNpcTurns.add(key);
        }

        this.addNpcMessage(turn.name || 'NPC', turn.response);

        if (turn.eventChecks) {
            this.addEventMessage(turn.eventChecks);
        }
        if (turn.events) {
            this.addEventSummaries(turn.events);
        }
        if (Array.isArray(turn.experienceAwards) && turn.experienceAwards.length) {
            this.addExperienceAwards(turn.experienceAwards);
        }
        if (Array.isArray(turn.currencyChanges) && turn.currencyChanges.length) {
            this.addCurrencyChanges(turn.currencyChanges);
        }
        if (Array.isArray(turn.environmentalDamageEvents) && turn.environmentalDamageEvents.length) {
            this.addEnvironmentalDamageEvents(turn.environmentalDamageEvents);
        }
        if (Array.isArray(turn.needBarChanges) && turn.needBarChanges.length) {
            this.addNeedBarChanges(turn.needBarChanges);
        }
        if (Array.isArray(turn.corpseCountdownUpdates) && turn.corpseCountdownUpdates.length) {
            window.updateNpcCorpseVisuals?.(turn.corpseCountdownUpdates);
        }
        if (Array.isArray(turn.corpseRemovals) && turn.corpseRemovals.length) {
            window.removeNpcCards?.(turn.corpseRemovals);
        }
        if (turn.attackSummary) {
            this.addAttackCheckMessage(turn.attackSummary);
        } else if (turn.attackCheck && turn.attackCheck.summary) {
            this.addAttackCheckMessage(turn.attackCheck.summary);
        }
        if (turn.actionResolution && turn.actionResolution.roll !== null && turn.actionResolution.roll !== undefined) {
            this.addSkillCheckMessage(turn.actionResolution);
        }

        this.flushEventBundle();
    }

    handleChatStatus(payload) {
        if (!payload) {
            return;
        }
        const requestId = payload.requestId;
        if (!requestId) {
            return;
        }
        const message = typeof payload.message === 'string' && payload.message.length
            ? payload.message
            : (payload.stage ? payload.stage.replace(/[:_]/g, ' ') : 'Processing...');
        this.updateStatusMessage(requestId, message, {
            stage: payload.stage || 'status',
            scope: payload.scope || 'chat'
        });
    }

    handlePlayerActionStream(payload) {
        if (!payload || !payload.requestId) {
            return;
        }
        const result = this.processChatPayload(payload.requestId, payload, { fromStream: true });
        if (result.shouldRefreshLocation) {
            this.scheduleLocationRefresh();
        }
    }

    handleNpcTurnStream(payload) {
        if (!payload || !payload.requestId) {
            return;
        }
        const normalized = { npcTurns: [payload] };
        const result = this.processChatPayload(payload.requestId, normalized, { fromStream: true });
        if (result.shouldRefreshLocation) {
            this.scheduleLocationRefresh();
        }
    }

    handleChatComplete(payload) {
        if (!payload || !payload.requestId) {
            return;
        }
        const context = this.ensureRequestContext(payload.requestId);
        if (context) {
            context.streamComplete = true;
            if (context.httpResolved) {
                this.finalizeChatRequest(payload.requestId);
            }
        }
        this.removeStatusMessage(payload.requestId);
    }

    handleChatError(payload) {
        if (!payload) {
            return;
        }
        const requestId = payload.requestId || null;
        const message = payload.message || 'Chat processing failed.';
        if (requestId) {
            this.hideLoading(requestId);
        }
        this.addMessage('system', message, true);
        if (requestId) {
            const context = this.ensureRequestContext(requestId);
            context.streamComplete = true;
            if (context.httpResolved) {
                this.finalizeChatRequest(requestId);
            }
        }
    }

    handleGenerationStatus(payload) {
        if (!payload) {
            return;
        }
        const scope = payload.scope || 'generation';
        const stageText = payload.stage ? payload.stage.replace(/[:_]/g, ' ') : 'update';
        const message = payload.message || `${scope} ${stageText}`;
        console.log(`[${scope}] ${stageText}: ${message}`);
    }

    handleRegionGenerated(payload) {
        if (!payload || !payload.region) {
            return;
        }
        const name = payload.region.name || 'Region';
        this.addMessage('ai', `🗺️ Region generated: ${name}`, false);
    }

    handleLocationGenerated(payload) {
        if (!payload) {
            return;
        }
        const name = (payload.location && payload.location.name) || payload.name || 'Location';
        if (!name) {
            return;
        }
        this.addMessage('ai', `📍 Location generated: ${name}`, false);
    }

    handleLocationExitCreated(payload) {
        if (!payload || !payload.location || !payload.originLocationId) {
            return;
        }

        const isSelfEvent = payload.initiatedBy && payload.initiatedBy === this.clientId;
        const currentLocationId = window.AIRPG_LAST_LOCATION_ID || null;
        const targetLocationId = payload.location?.id || payload.originLocationId;
        const shouldRefreshLocation = targetLocationId
            && (!currentLocationId || currentLocationId === payload.originLocationId || currentLocationId === targetLocationId);

        if (shouldRefreshLocation && typeof window.updateLocationDisplay === 'function') {
            try {
                window.updateLocationDisplay(payload.location);
            } catch (error) {
                console.warn('Failed to refresh location after exit creation:', error);
            }
        }

        const mapTab = document.querySelector('[data-tab="map"]');
        if (mapTab && mapTab.classList.contains('active')) {
            const mapContainer = document.getElementById('mapContainer');
            const activeRegionId = mapContainer?.dataset?.regionId || null;
            if (!activeRegionId || (payload.originRegionId && payload.originRegionId === activeRegionId)) {
                try {
                    window.loadRegionMap?.(activeRegionId || payload.originRegionId || null);
                } catch (error) {
                    console.warn('Failed to refresh region map after exit creation:', error);
                }
            }
        }

        if (!isSelfEvent) {
            const exitName = (payload.created && payload.created.name)
                || payload.location?.name
                || 'a new exit';
            const summary = payload.created?.type === 'region'
                ? `New region pathway discovered: ${exitName}`
                : `New exit discovered: ${exitName}`;
            if (!this.pushEventBundleItem('🚪', summary)) {
                this.addMessage('ai', `🚪 ${summary}`, false);
            }
        }
    }

    handleImageJobUpdate(payload) {
        if (!payload || !payload.jobId) {
            return;
        }
        if (window.AIRPG?.imageManager?.handleRealtimeJobUpdate) {
            try {
                window.AIRPG.imageManager.handleRealtimeJobUpdate(payload);
            } catch (error) {
                console.warn('Failed to process image job update:', error);
            }
        }
    }

    finalizeChatRequest(requestId) {
        if (!requestId) {
            return;
        }
        this.removeStatusMessage(requestId);
        this.pendingRequests.delete(requestId);
        if (this.pendingRequests.size === 0) {
            this.setSendButtonLoading(false);
            this.messageInput?.focus();
        }
    }

    async sendMessage() {
        const rawInput = this.messageInput.value;
        const message = rawInput.trim();
        if (!message) return;

        const userEntry = this.normalizeLocalEntry({ role: 'user', content: rawInput });
        this.serverHistory.push(userEntry);
        this.chatHistory = [this.systemMessage, ...this.serverHistory];
        this.renderChatHistory();

        this.messageInput.value = '';
        this.setSendButtonLoading(true);
        const requestId = this.generateRequestId();
        const context = this.ensureRequestContext(requestId);
        this.showLoading(requestId);

        let shouldRefreshLocation = false;

        try {
            await this.waitForWebSocketReady(1000);
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: this.chatHistory,
                    clientId: this.clientId,
                    requestId
                })
            });

            const data = await response.json();
            context.httpResolved = true;

            if (data.error) {
                this.hideLoading(requestId);
                this.addMessage('system', `Error: ${data.error}`, true);
                this.finalizeChatRequest(requestId);
            } else {
                const result = this.processChatPayload(requestId, data, { fromStream: false });
                shouldRefreshLocation = result.shouldRefreshLocation || shouldRefreshLocation;

                if (!context.streamMeta || context.streamMeta.enabled === false) {
                    this.finalizeChatRequest(requestId);
                } else if (context.streamComplete) {
                    this.finalizeChatRequest(requestId);
                }
            }
        } catch (error) {
            this.hideLoading(requestId);
            this.addMessage('system', `Connection error: ${error.message}`, true);
            context.httpResolved = true;
            this.finalizeChatRequest(requestId);
        }

        if (shouldRefreshLocation) {
            try {
                await this.checkLocationUpdate();
            } catch (refreshError) {
                console.warn('Failed to refresh location after chat response:', refreshError);
            }
        }

        await this.refreshChatHistory();
    }

    async checkLocationUpdate() {
        console.log('Checking for location update...');
        try {
            const response = await fetch('/api/player', { cache: 'no-store' });
            const result = await response.json();

            if (result.success && result.player) {
                if (window.updateInventoryDisplay) {
                    window.updateInventoryDisplay(result.player || {});
                }
                if (window.refreshParty) {
                    window.refreshParty();
                }

                this.refreshSkillState(result.player);

                const locationId = result.player?.locationId || result.player?.currentLocation || null;
                if (locationId) {
                    // Fetch location details
                    const cacheBuster = Date.now();
                    const locationResponse = await fetch(`/api/locations/${locationId}?_=${cacheBuster}`, {
                        cache: 'no-store'
                    });
                    const locationResult = await locationResponse.json();
                    console.log('Location details fetched:', locationResult);

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
        console.log("Location update check complete.");
    }
}

console.log("chat.js loaded");

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    //new AIRPGChat();
});
