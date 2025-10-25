class AIRPGChat {
    constructor() {
        this.chatLog = document.getElementById('chatLog');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.sendButtonDefaultHtml = this.sendButton ? this.sendButton.innerHTML : 'Send';
        this.skillPointsDisplay = document.getElementById('unspentSkillPointsDisplay');
        this.skillRankElements = this.collectSkillRankElements();
        this.templateEnv = null;
        this.markdownRenderer = this.createMarkdownRenderer();

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

        this.pendingMoveOverlay = false;

        this.ensureTemplateEnvironment();
        this.init();
        this.initSkillIncreaseControls();
        this.connectWebSocket();

        this.locationRefreshTimers = [];
        this.locationRefreshPending = false;
        this.activeEventBundle = null;

        this.setupEditModal();
        this.loadExistingHistory();

        window.AIRPG_CHAT = this;
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

    createMarkdownRenderer() {
        if (typeof window === 'undefined' || typeof window.markdownit !== 'function') {
            return null;
        }
        try {
            return window.markdownit({
                html: true,
                linkify: true,
                breaks: true
            });
        } catch (error) {
            console.warn('Failed to initialize Markdown renderer:', error);
            return null;
        }
    }

    setMessageContent(target, content, { allowMarkdown = true } = {}) {
        if (!target) {
            return;
        }
        const raw = content === undefined || content === null
            ? ''
            : (typeof content === 'string' ? content : String(content));

        if (allowMarkdown && this.markdownRenderer && raw) {
            try {
                target.innerHTML = this.markdownRenderer.render(raw);
                return;
            } catch (error) {
                console.warn('Failed to render markdown content:', error);
            }
        }

        target.textContent = raw;
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

        const aggregatedEntries = [];
        const recordsById = new Map();
        const pendingAttachments = new Map();
        let lastAttachable = null;
        const attachmentTypes = new Set(['skill-check', 'attack-check', 'plausibility']);

        const attachToRecord = (record, attachment) => {
            if (record && attachment) {
                record.attachments.push(attachment);
                return true;
            }
            return false;
        };

        this.serverHistory.forEach(entry => {
            if (!entry) {
                lastAttachable = null;
                return;
            }

            const entryType = entry.type || null;
            const isAttachmentType = attachmentTypes.has(entryType);
            const parentId = entry.parentId || null;

            if (isAttachmentType) {
                if (parentId) {
                    const parentRecord = recordsById.get(parentId);
                    if (attachToRecord(parentRecord, entry)) {
                        return;
                    }
                    if (!pendingAttachments.has(parentId)) {
                        pendingAttachments.set(parentId, []);
                    }
                    pendingAttachments.get(parentId).push(entry);
                    return;
                }

                if (attachToRecord(lastAttachable, entry)) {
                    return;
                }

                const orphanRecord = { entry, attachments: [] };
                aggregatedEntries.push(orphanRecord);
                if (entry.id) {
                    recordsById.set(entry.id, orphanRecord);
                }
                lastAttachable = null;
                return;
            }

            const record = { entry, attachments: [] };
            aggregatedEntries.push(record);

            if (entry.id) {
                recordsById.set(entry.id, record);
                if (pendingAttachments.has(entry.id)) {
                    const pendingList = pendingAttachments.get(entry.id);
                    pendingList.forEach(pendingEntry => record.attachments.push(pendingEntry));
                    pendingAttachments.delete(entry.id);
                }
            }

            if (!entryType) {
                lastAttachable = record;
            } else {
                lastAttachable = null;
            }
        });

        if (pendingAttachments.size) {
            for (const pendingList of pendingAttachments.values()) {
                pendingList.forEach(entry => {
                    aggregatedEntries.push({ entry, attachments: [] });
                });
            }
        }

        aggregatedEntries.forEach(({ entry, attachments }) => {
            const element = this.createChatMessageElement(entry, attachments);
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
                <div class="message-sender">🤖 AI Game Master</div>
                <div class="message-actions" hidden></div>
                <div>Welcome to the AI RPG! I\'m your Game Master. Configure your AI settings above, then click Game Settings to set up your world, and finally click New Game.</div>
            `;
            this.chatLog.appendChild(placeholder);
        } else {
            this.chatLog.appendChild(fragment);
        }
        this.scrollToBottom();
    }

    createChatMessageElement(entry, attachments = []) {
        if (!entry) {
            return null;
        }

        if (entry.type === 'event-summary') {
            return this.createEventSummaryElement(entry);
        }

        if (entry.type === 'plausibility') {
            return this.createPlausibilityEntryElement(entry);
        }

        if (entry.type === 'skill-check') {
            return this.createSkillCheckEntryElement(entry);
        }

        if (entry.type === 'attack-check') {
            return this.createAttackCheckEntryElement(entry);
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
        const allowMarkdown = entry.role === 'assistant';
        this.setMessageContent(contentDiv, entry.content || '', { allowMarkdown });

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = this.formatTimestamp(entry.timestamp);

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        const insights = this.prepareAttachmentInsights(attachments);

        const actions = this.createMessageActions(entry);
        if (actions) {
            messageDiv.appendChild(actions);
            if (insights.length) {
                this.appendInsightButtons(actions, insights);
            }
        } else if (insights.length) {
            const insightsOnly = document.createElement('div');
            insightsOnly.className = 'message-actions message-actions--insights-only';
            this.appendInsightButtons(insightsOnly, insights);
            messageDiv.appendChild(insightsOnly);
        }

        return messageDiv;
    }

    prepareAttachmentInsights(attachments = []) {
        if (!Array.isArray(attachments) || !attachments.length) {
            return [];
        }

        const insights = [];

        attachments.forEach(attachment => {
            if (!attachment) {
                return;
            }

            let html = null;
            let icon = null;
            let label = null;

            switch (attachment.type) {
                case 'skill-check': {
                    const details = this.generateSkillCheckInsight(attachment.skillCheck || attachment.resolution || null);
                    if (details?.html) {
                        html = `<div class="message-insight-tooltip skill-check-tooltip">${details.html}</div>`;
                        icon = '🎯';
                        label = 'View skill check details';
                    }
                    break;
                }
                case 'attack-check': {
                    const details = this.generateAttackCheckInsight(attachment.attackSummary || attachment.summary || attachment.attackCheck?.summary || null);
                    if (details?.html) {
                        html = `<div class="message-insight-tooltip attack-check-tooltip">${details.html}</div>`;
                        icon = '⚔️';
                        label = 'View attack check details';
                    }
                    break;
                }
                case 'plausibility': {
                    const markup = this.renderPlausibilityMarkup(attachment.plausibility);
                    if (markup) {
                        html = `<div class="message-insight-tooltip plausibility-tooltip">${markup}</div>`;
                        icon = '🧭';
                        label = 'View plausibility analysis';
                    }
                    break;
                }
                default:
                    break;
            }

            if (icon && html) {
                insights.push({ icon, html, label: label || 'View additional details' });
            }
        });

        return insights;
    }

    appendInsightButtons(actionsContainer, insights = []) {
        if (!actionsContainer || !insights.length) {
            return;
        }

        let wrapper = actionsContainer.querySelector('.message-insight-icons');
        if (!wrapper) {
            wrapper = document.createElement('div');
            wrapper.className = 'message-insight-icons';
            actionsContainer.insertBefore(wrapper, actionsContainer.firstChild || null);
        }

        if (!actionsContainer.__insightKeys) {
            actionsContainer.__insightKeys = new Set();
        }

        insights.forEach(insight => {
            if (!insight || !insight.icon || !insight.html) {
                return;
            }
            const signature = `${insight.icon}:${insight.html}`;
            if (actionsContainer.__insightKeys.has(signature)) {
                return;
            }
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'message-insight-button';
            button.textContent = insight.icon;
            if (insight.label) {
                button.setAttribute('aria-label', insight.label);
                button.title = insight.label;
            }

            button.addEventListener('mouseenter', event => this.handleInsightMouseEnter(event, insight.html));
            button.addEventListener('mousemove', event => this.handleInsightMouseMove(event));
            button.addEventListener('mouseleave', () => this.handleInsightMouseLeave());
            button.addEventListener('focus', () => this.handleInsightFocus(button, insight.html));
            button.addEventListener('blur', () => this.handleInsightMouseLeave());
            button.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') {
                    this.handleInsightMouseLeave();
                }
            });

            wrapper.appendChild(button);
            actionsContainer.__insightKeys.add(signature);
        });
    }

    handleInsightMouseEnter(event, html) {
        this.showInsightTooltip(html, event);
    }

    handleInsightMouseMove(event) {
        const controller = window.floatingTooltipController;
        if (controller && typeof controller.move === 'function') {
            controller.move(event);
        }
    }

    handleInsightMouseLeave() {
        const controller = window.floatingTooltipController;
        if (controller && typeof controller.hide === 'function') {
            controller.hide();
        }
    }

    handleInsightFocus(button, html) {
        if (!button) {
            return;
        }
        const rect = button.getBoundingClientRect();
        const syntheticEvent = {
            clientX: rect.left + rect.width / 2,
            clientY: rect.bottom,
            target: button
        };
        this.showInsightTooltip(html, syntheticEvent);
    }

    showInsightTooltip(html, event) {
        if (!html || !event) {
            return;
        }
        const controller = window.floatingTooltipController;
        if (controller && typeof controller.show === 'function') {
            controller.show(html, event, { allowHTML: true });
        }
    }

    generateSkillCheckInsight(resolution) {
        if (!resolution || typeof resolution !== 'object') {
            return null;
        }

        const element = this.buildSkillCheckMessageElement({ resolution, timestamp: null });
        if (!element) {
            return null;
        }
        const detailsElement = element.querySelector('.skill-check-details');
        if (!detailsElement) {
            return null;
        }
        return {
            html: detailsElement.innerHTML
        };
    }

    generateAttackCheckInsight(summary) {
        if (!summary || typeof summary !== 'object') {
            return null;
        }

        const element = this.buildAttackCheckMessageElement({ summary, timestamp: null });
        if (!element) {
            return null;
        }
        const detailsElement = element.querySelector('.attack-check-details');
        if (!detailsElement) {
            return null;
        }
        return {
            html: detailsElement.innerHTML
        };
    }

    ensureTemplateEnvironment() {
        if (this.templateEnv) {
            return this.templateEnv;
        }
        if (window.AIRPG_TEMPLATE_ENV) {
            this.templateEnv = window.AIRPG_TEMPLATE_ENV;
            return this.templateEnv;
        }
        if (!window.nunjucks || typeof window.nunjucks.Environment !== 'function' || typeof window.nunjucks.WebLoader !== 'function') {
            throw new Error('Nunjucks runtime is required for plausibility rendering.');
        }
        const loader = new window.nunjucks.WebLoader('/templates', {
            useCache: true,
            async: false
        });
        this.templateEnv = new window.nunjucks.Environment(loader, { autoescape: true });
        window.AIRPG_TEMPLATE_ENV = this.templateEnv;
        return this.templateEnv;
    }

    normalizePlausibilityPayload(plausibility) {
        if (!plausibility || typeof plausibility !== 'object') {
            throw new Error('Plausibility payload must be an object.');
        }

        const structured = plausibility.structured && typeof plausibility.structured === 'object'
            ? plausibility.structured
            : null;
        if (!structured) {
            throw new Error('Plausibility payload missing structured data.');
        }

        if (typeof structured.type !== 'string' || !structured.type.trim()) {
            throw new Error('Plausibility structured data missing outcome type.');
        }

        let sanitized;
        try {
            sanitized = JSON.parse(JSON.stringify(structured));
        } catch (error) {
            throw new Error(`Failed to sanitize plausibility data: ${error.message}`);
        }

        sanitized.type = sanitized.type.trim();
        if (typeof sanitized.reason === 'string') {
            sanitized.reason = sanitized.reason.trim();
        }

        return {
            raw: typeof plausibility.raw === 'string' && plausibility.raw.trim().length ? plausibility.raw.trim() : null,
            structured: sanitized
        };
    }

    renderPlausibilityMarkup(plausibility) {
        const normalized = this.normalizePlausibilityPayload(plausibility);
        const env = this.ensureTemplateEnvironment();
        try {
            return env.render('plausibility.njk', { plausibility: normalized.structured });
        } catch (error) {
            throw new Error(`Failed to render plausibility details: ${error.message}`);
        }
    }

    findLatestAttachableMessage() {
        if (!this.chatLog) {
            return null;
        }
        const candidates = Array.from(this.chatLog.querySelectorAll('.message'))
            .reverse()
            .filter(node => !node.classList.contains('event-summary-batch')
                && node.dataset.type !== 'skill-check'
                && node.dataset.type !== 'attack-check'
                && node.dataset.type !== 'plausibility');
        return candidates.length ? candidates[0] : null;
    }

    attachInsightToLatestMessage(type, payload) {
        const parent = this.findLatestAttachableMessage();
        if (!parent) {
            return false;
        }

        const attachments = [{ type, ...payload }];
        const insights = this.prepareAttachmentInsights(attachments);
        if (!insights.length) {
            return false;
        }

        let actions = parent.querySelector('.message-actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'message-actions message-actions--insights-only';
            parent.appendChild(actions);
        }

        this.appendInsightButtons(actions, insights);
        parent.classList.add('message--has-insights');
        return true;
    }

    createEventSummaryElement(entry) {
        const container = document.createElement('div');
        container.className = 'message event-summary-batch';
        container.dataset.timestamp = entry.timestamp || '';

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
        }

        listWrapper.appendChild(list);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = this.formatTimestamp(entry.timestamp);

        container.appendChild(senderDiv);
        container.appendChild(listWrapper);
        container.appendChild(timestampDiv);

        const actions = this.createMessageActions(entry);
        if (actions) {
            container.appendChild(actions);
        }

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
        let content = entry.content || '';

        if (entry.type === 'event-summary') {
            const summaryLines = [];
            if (Array.isArray(entry.summaryItems) && entry.summaryItems.length) {
                entry.summaryItems.forEach(item => {
                    if (!item || !item.text) {
                        return;
                    }
                    const icon = item.icon || '•';
                    summaryLines.push(`${icon} ${item.text}`.trim());
                });
            }

            if (summaryLines.length) {
                content = summaryLines.join('\n');
            } else if (typeof content === 'string' && content.includes('\n')) {
                const lines = content.split('\n');
                const summaryTitle = (entry.summaryTitle || '').trim();
                if (summaryTitle && lines.length && lines[0].trim() === summaryTitle) {
                    lines.shift();
                    content = lines.join('\n');
                }
            }
        }

        this.editTextarea.value = content;
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
        const { id, timestamp } = this.editCurrentEntry;
        const content = this.editTextarea.value;

        const payload = { content };
        if (id) {
            payload.id = id;
        }
        if (timestamp) {
            payload.timestamp = timestamp;
        }

        try {
            const response = await fetch('/api/chat/message', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
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

        const payload = {};
        if (entry.id) {
            payload.id = entry.id;
        }
        if (entry.timestamp) {
            payload.timestamp = entry.timestamp;
        }

        try {
            const response = await fetch('/api/chat/message', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
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

    handleChatHistoryUpdated() {
        this.refreshChatHistory();
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
            case 'location_exit_deleted':
                this.handleLocationExitDeleted(payload);
                break;
            case 'image_job_update':
                this.handleImageJobUpdate(payload);
                break;
            case 'chat_history_updated':
                this.handleChatHistoryUpdated(payload);
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
            this.chatLog.appendChild(element);
            this.scrollToBottom();
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

        document.addEventListener('keydown', (event) => {
            if (!event || typeof event.key !== 'string') {
                return;
            }

            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
                return;
            }

            if (event.key.toLowerCase() !== 'i') {
                return;
            }

            const activeElement = document.activeElement;
            const isTypingContext = activeElement instanceof HTMLElement
                && (activeElement.closest('input, textarea, select, [contenteditable="true"]')
                    || activeElement.classList.contains('chat-edit-modal__textarea'));
            if (isTypingContext) {
                return;
            }

            const inventoryButton = document.getElementById('chatPlayerInventoryButton');
            if (inventoryButton) {
                event.preventDefault();
                inventoryButton.click();
            }
        });
    }

    addMessage(sender, content, isError = false, debugInfo = null, options = {}) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}${isError ? ' error' : ''}`;

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = sender === 'user' ? '👤 You' : '🤖 AI Game Master';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const allowMarkdown = sender === 'ai' || options.allowMarkdown === true;
        this.setMessageContent(contentDiv, content, { allowMarkdown });

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
        timestampDiv.textContent = timestamp;

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);

        // Add debug information if available (for AI responses)
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
        contentDiv.className = 'message-content';
        this.setMessageContent(contentDiv, content, { allowMarkdown: true });

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
            if (value && typeof value === 'object') {
                const candidateKeys = ['name', 'label', 'title', 'text'];
                for (const key of candidateKeys) {
                    const candidate = value[key];
                    if (typeof candidate === 'string' && candidate.trim()) {
                        return safeName(candidate);
                    }
                }
                return 'Someone';
            }
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
            'scenery_appear',
            'item_appear',
            'drop_item',
            'pick_up_item',
            'transfer_item',
            'consume_item',
            'move_new_location',
            'move_location',
            'npc_arrival_departure',
            'needbar_change',
            'alter_item',
            'alter_location'
        ]);
        let shouldRefreshLocation = false;

        const handleMoveLocation = (entries) => {
            if (Array.isArray(entries) && entries.length) {
                if (!this.pendingMoveOverlay) {
                    this.pendingMoveOverlay = true;
                    const overlayDestination = safeItem(entries[0], 'a new location');
                    try {
                        window.showLocationOverlay?.(`Moving to ${overlayDestination}...`);
                    } catch (error) {
                        console.debug([error]);
                    }
                }
            }
            entries.forEach((location) => {
                const destination = safeItem(location, 'a new location');
                this.addEventSummary('🚶', `Travelled to ${destination}.`);
            });
        };

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
                    if (entry && typeof entry === 'object') {
                        const rawUser = typeof entry.user === 'string'
                            ? entry.user.trim()
                            : (entry.user === undefined || entry.user === null
                                ? ''
                                : String(entry.user).trim());
                        const consumer = rawUser && rawUser.toLowerCase() !== 'someone'
                            ? safeName(rawUser)
                            : null;
                        const itemName = safeItem(entry.item, 'An item');
                        const extraDetails = [];
                        const detailKeys = ['reason', 'detail', 'context', 'note', 'notes', 'usage', 'usedFor', 'method', 'result', 'effect'];
                        detailKeys.forEach(key => {
                            const value = entry[key];
                            if (typeof value === 'string') {
                                const trimmed = value.trim();
                                if (trimmed) {
                                    extraDetails.push(trimmed);
                                }
                            }
                        });
                        const detailText = extraDetails.length ? ` (${extraDetails.join('; ')})` : '';
                        if (consumer) {
                            this.addEventSummary('🧪', `${consumer} consumed ${itemName}.${detailText}`);
                        } else {
                            this.addEventSummary('🧪', `${itemName} was consumed or destroyed.${detailText}`);
                        }
                    } else {
                        const itemName = safeItem(entry, 'An item');
                        this.addEventSummary('🧪', `${itemName} was consumed or destroyed.`);
                    }
                });
            },
            death_incapacitation: (entries) => {
                entries.forEach((entry) => {
                    const status = typeof entry?.status === 'string' ? entry.status.trim().toLowerCase() : null;
                    const target = safeName(entry?.name ?? entry);
                    if (status === 'dead') {
                        this.addEventSummary('☠️', `${target} was killed.`);
                    } else {
                        this.addEventSummary('☠️', `${target} was incapacitated.`);
                    }
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
                    const recipient = safeName(entry?.recipient || entry?.character);
                    if (!recipient) {
                        return;
                    }

                    const healer = entry?.healer ? safeName(entry.healer) : null;
                    const rawAmount = Number(entry?.amountHealed);
                    const amount = Number.isFinite(rawAmount) ? Math.max(0, Math.round(rawAmount)) : null;
                    const reasonText = entry?.reason ? safeItem(entry.reason, '') : '';
                    const amountText = amount ? `${amount} hit point${amount === 1 ? '' : 's'}` : null;

                    let summary;
                    if (healer && healer !== recipient) {
                        summary = `${healer} healed ${recipient}`;
                        if (amountText) {
                            summary += ` for ${amountText}`;
                        }
                    } else {
                        summary = `${recipient} healed`;
                        if (amountText) {
                            summary += ` ${amountText}`;
                        }
                    }

                    if (reasonText) {
                        summary += ` (${reasonText})`;
                    }

                    if (!summary.endsWith('.')) {
                        summary += '.';
                    }

                    this.addEventSummary('💖', summary);
                });
            },
            scenery_appear: (entries) => {
                entries.forEach((item) => {
                    const itemName = safeItem(item);
                    this.addEventSummary('✨', `${itemName} appeared in the scene.`);
                });
            },
            item_appear: (entries) => {
                entries.forEach((item) => {
                    const itemName = safeItem(item);
                    this.addEventSummary('✨', `${itemName} appeared in the scene.`);
                });
            },
            move_location: handleMoveLocation,
            move_new_location: (entries) => {
                const normalized = Array.isArray(entries)
                    ? entries
                        .map(entry => (entry && typeof entry === 'object' && entry.name) ? entry.name : entry)
                        .filter(value => typeof value === 'string' && value.trim().length)
                    : [];
                if (!normalized.length) {
                    return;
                }
                handleMoveLocation(normalized.map(value => value.trim()));
            },
            new_exit_discovered: (entries) => {
                entries.forEach((description) => {
                    const detail = safeItem(description, 'a new path');
                    this.addEventSummary('🚪', `New exit discovered: ${detail}.`);
                    console.log("[Debug] New exit discovered event:", detail)
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
            harvest_gather: (entries) => {
                entries.forEach((entry) => {
                    const actor = safeName(entry?.harvester);
                    const itemName = safeItem(entry?.item);
                    this.addEventSummary('🌾', `${actor} harvested ${itemName}.`);
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
                    const originalName = entry.originalName || entry.from || null;
                    const newName = entry.newName || entry.to || null;
                    const changeDescriptionRaw = entry.changeDescription || entry.description || '';
                    const original = safeItem(originalName || newName || 'an item');
                    const renamed = newName && originalName && newName !== originalName
                        ? safeItem(newName)
                        : null;
                    const changeDescription = changeDescriptionRaw ? String(changeDescriptionRaw).trim() : '';
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
            needbar_change: () => {
                // Need bar summaries are rendered with full detail server-side; avoid duplicate, less informative client entry.
            }
        };

        /*
        // Don't parse these for now.
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
        */

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

    addPlausibilityMessage(plausibility) {
        const normalized = this.normalizePlausibilityPayload(plausibility);

        const attached = this.attachInsightToLatestMessage('plausibility', {
            plausibility: normalized
        });
        if (attached) {
            return;
        }

        const timestamp = new Date().toISOString();
        const messageDiv = this.buildPlausibilityMessageElement({ data: normalized, timestamp });
        if (!messageDiv) {
            return;
        }
        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    addSkillCheckMessage(resolution) {
        const attached = this.attachInsightToLatestMessage('skill-check', {
            skillCheck: resolution
        });
        if (attached) {
            return;
        }

        const timestamp = new Date().toISOString();
        const messageDiv = this.buildSkillCheckMessageElement({ resolution, timestamp });
        if (!messageDiv) {
            return;
        }
        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    buildPlausibilityMessageElement({ data, timestamp }) {
        const markup = this.renderPlausibilityMarkup(data);

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message plausibility-message';
        messageDiv.dataset.type = 'plausibility';
        messageDiv.dataset.timestamp = timestamp || '';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🧭 Plausibility Check';

        const contentDiv = document.createElement('div');
        const details = document.createElement('details');
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = 'Plausibility Check';
        details.appendChild(summaryEl);

        const body = document.createElement('div');
        body.innerHTML = markup;
        details.appendChild(body);

        contentDiv.appendChild(details);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = this.formatTimestamp(timestamp);

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        return messageDiv;
    }

    buildSkillCheckMessageElement({ resolution, timestamp }) {
        if (!resolution || typeof resolution !== 'object') {
            return null;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message skill-check-message';
        messageDiv.dataset.type = 'skill-check';
        messageDiv.dataset.timestamp = timestamp || '';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🎯 Skill Check';

        const contentDiv = document.createElement('div');

        const lines = [];
        const rawRoll = resolution.roll;
        const roll = rawRoll && typeof rawRoll === 'object' ? rawRoll : {};
        const rawDifficulty = resolution.difficulty;
        const difficulty = rawDifficulty && typeof rawDifficulty === 'object' ? rawDifficulty : {};
        const { skill, attribute, label, reason, margin, type } = resolution;

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

            return `${parts.join(' ')}`;
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
                parts.push(`<small>${formattedCircumstances.map(item => this.escapeHtml(item)).join('<br>')}</small>`);
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
            return null;
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
        timestampDiv.textContent = this.formatTimestamp(timestamp);

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        return messageDiv;
    }

    createPlausibilityEntryElement(entry) {
        if (!entry || typeof entry.plausibility !== 'object') {
            throw new Error('Chat history entry missing plausibility payload.');
        }
        const normalized = this.normalizePlausibilityPayload(entry.plausibility);
        const messageDiv = this.buildPlausibilityMessageElement({
            data: normalized,
            timestamp: entry.timestamp
        });
        if (!messageDiv) {
            return null;
        }
        const actions = this.createMessageActions(entry);
        if (actions) {
            messageDiv.appendChild(actions);
        }
        return messageDiv;
    }

    createSkillCheckEntryElement(entry) {
        const messageDiv = this.buildSkillCheckMessageElement({
            resolution: entry.skillCheck || entry.resolution || null,
            timestamp: entry.timestamp
        });
        if (!messageDiv) {
            return null;
        }
        const actions = this.createMessageActions(entry);
        if (actions) {
            messageDiv.appendChild(actions);
        }
        return messageDiv;
    }

    createAttackCheckEntryElement(entry) {
        const messageDiv = this.buildAttackCheckMessageElement({
            summary: entry.attackSummary || entry.summary || entry.attackCheck?.summary || null,
            timestamp: entry.timestamp
        });
        if (!messageDiv) {
            return null;
        }
        const actions = this.createMessageActions(entry);
        if (actions) {
            messageDiv.appendChild(actions);
        }
        return messageDiv;
    }

    buildAttackCheckMessageElement({ summary, timestamp }) {
        if (!summary || typeof summary !== 'object') {
            return null;
        }

        const formatSigned = (value) => {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return null;
            }
            return value >= 0 ? `+${value}` : `${value}`;
        };

        const normalizeNumber = (value) => {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                return null;
            }
            if (Math.abs(value) < 1e-9) {
                return 0;
            }
            return value;
        };

        const formatDecimal = (value) => {
            const normalized = normalizeNumber(value);
            if (normalized === null) {
                return null;
            }
            const fixed = normalized.toFixed(2);
            const trimmed = fixed.replace(/\.?0+$/, '');
            return trimmed.length ? trimmed : '0';
        };

        const formatSignedDecimal = (value) => {
            const normalized = normalizeNumber(value);
            if (normalized === null) {
                return null;
            }
            const magnitude = formatDecimal(Math.abs(normalized));
            if (magnitude === null) {
                return null;
            }
            return normalized >= 0 ? `+${magnitude}` : `-${magnitude}`;
        };

        const lines = [];

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

            if (damage.calculation && typeof damage.calculation === 'object') {
                const calc = damage.calculation;
                const segments = [];

                const baseDamageText = formatDecimal(calc.baseWeaponDamage);
                const hitDegreeRawText = formatDecimal(calc.hitDegreeRaw);
                const hitDegreeMultiplierText = formatDecimal(calc.hitDegreeMultiplier);
                const scaledDamageText = formatDecimal(calc.scaledDamage);

                if (baseDamageText && scaledDamageText) {
                    if (hitDegreeRawText && hitDegreeMultiplierText) {
                        segments.push(`Base ${baseDamageText} × min(2, 0.75 + ${hitDegreeRawText} / 4) = ${scaledDamageText}`);
                    } else if (hitDegreeMultiplierText) {
                        segments.push(`Base ${baseDamageText} × ${hitDegreeMultiplierText} = ${scaledDamageText}`);
                    } else {
                        segments.push(`Base ${baseDamageText} scaled = ${scaledDamageText}`);
                    }
                }

                const attributeModifierText = formatSignedDecimal(calc.attributeModifier);
                const preRoundedText = formatDecimal(calc.preRoundedDamage);
                if (attributeModifierText && preRoundedText) {
                    segments.push(`Attribute modifier ${attributeModifierText} → ${preRoundedText}`);
                }

                if (Number.isFinite(calc.roundedDamageComponent)) {
                    segments.push(`round(...) = ${calc.roundedDamageComponent}`);
                }

                if (Number.isFinite(calc.constantBonus) && Number.isFinite(calc.unmitigatedDamage)) {
                    const constantMagnitude = formatDecimal(Math.abs(calc.constantBonus));
                    const targetValue = formatDecimal(calc.unmitigatedDamage) ?? String(calc.unmitigatedDamage);
                    if (constantMagnitude && targetValue !== null) {
                        const prefix = calc.constantBonus >= 0 ? '+' : '-';
                        segments.push(`${prefix} ${constantMagnitude} base = ${targetValue}`);
                    }
                }

                if (calc.canDealDamage && Number.isFinite(calc.toughnessReduction) && calc.toughnessReduction !== 0 && Number.isFinite(calc.mitigatedDamage)) {
                    const toughnessMagnitude = formatDecimal(Math.abs(calc.toughnessReduction));
                    const mitigatedText = formatDecimal(calc.mitigatedDamage) ?? String(calc.mitigatedDamage);
                    if (toughnessMagnitude && mitigatedText !== null) {
                        const prefix = calc.toughnessReduction >= 0 ? '-' : '+';
                        segments.push(`${prefix} Toughness ${toughnessMagnitude} = ${mitigatedText}`);
                    }
                }

                if (Number.isFinite(calc.finalDamage)) {
                    const finalText = formatDecimal(calc.finalDamage) ?? String(calc.finalDamage);
                    segments.push(`Final damage = ${finalText}`);
                }

                if (typeof calc.preventedBy === 'string') {
                    if (calc.preventedBy === 'negative_hit_degree') {
                        segments.push('Damage prevented: hit degree below zero.');
                    } else if (calc.preventedBy === 'toughness') {
                        segments.push('Damage prevented: toughness reduced damage to zero.');
                    }
                }

                if (segments.length) {
                    const breakdown = segments
                        .map(segment => this.escapeHtml(segment))
                        .join('<br>');
                    lines.push(`<li><strong>Damage Calculation:</strong><br><small>${breakdown}</small></li>`);
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
            return null;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message attack-check-message';
        messageDiv.dataset.type = 'attack-check';
        messageDiv.dataset.timestamp = timestamp || '';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '⚔️ Attack Check';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

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
        timestampDiv.textContent = this.formatTimestamp(timestamp);

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        return messageDiv;
    }

    addAttackCheckMessage(summary) {
        const attached = this.attachInsightToLatestMessage('attack-check', {
            attackSummary: summary
        });
        if (attached) {
            return;
        }

        const messageDiv = this.buildAttackCheckMessageElement({
            summary,
            timestamp: new Date().toISOString()
        });
        if (!messageDiv) {
            return;
        }
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

        if (payload.locationRefreshRequested) {
            shouldRefreshLocation = true;
        }

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

        const stageRaw = typeof payload.stage === 'string' ? payload.stage.trim().toLowerCase() : '';
        if (stageRaw === 'spinner:start') {
            const overlayMessage = typeof payload.message === 'string' && payload.message.trim()
                ? payload.message.trim()
                : 'Loading...';
            try {
                window.showLocationOverlay?.(overlayMessage);
                this.pendingMoveOverlay = true;
            } catch (error) {
                console.debug('Failed to show overlay for spinner:start status:', error);
            }
            return;
        }
        if (stageRaw === 'spinner:update') {
            const overlayMessage = typeof payload.message === 'string' && payload.message.trim()
                ? payload.message.trim()
                : 'Loading...';
            try {
                window.showLocationOverlay?.(overlayMessage);
                this.pendingMoveOverlay = true;
            } catch (error) {
                console.debug('Failed to update overlay for spinner:update status:', error);
            }
            return;
        }
        if (stageRaw === 'spinner:stop') {
            try {
                window.hideLocationOverlay?.();
            } catch (error) {
                console.debug('Failed to hide overlay for spinner:stop status:', error);
            }
            this.pendingMoveOverlay = false;
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
            console.log('Discovered new exit:');
            console.log(exitName);
            const summary = payload.created?.type === 'region'
                ? `New region pathway discovered: ${exitName}`
                : `New exit discovered: ${exitName}`;
            if (!this.pushEventBundleItem('🚪', summary)) {
                this.addMessage('ai', `🚪 ${summary}`, false);
            }
        }
    }

    handleLocationExitDeleted(payload) {
        if (!payload) {
            return;
        }

        const originLocationId = payload.originLocationId || null;
        const locationData = payload.location || null;
        const currentLocationId = window.AIRPG_LAST_LOCATION_ID || null;
        const targetLocationId = locationData?.id || originLocationId;
        const isSelfEvent = payload.initiatedBy && payload.initiatedBy === this.clientId;

        const shouldRefreshLocation = targetLocationId
            && (!currentLocationId || currentLocationId === originLocationId || currentLocationId === targetLocationId);

        if (shouldRefreshLocation) {
            if (locationData && typeof window.updateLocationDisplay === 'function') {
                try {
                    window.updateLocationDisplay(locationData);
                } catch (error) {
                    console.warn('Failed to refresh location after exit deletion:', error);
                }
            } else {
                this.checkLocationUpdate().catch(error => {
                    console.warn('Failed to refresh location after exit deletion fallback:', error);
                });
            }
        }

        const mapTab = document.querySelector('[data-tab="map"]');
        if (mapTab && mapTab.classList.contains('active')) {
            const mapContainer = document.getElementById('mapContainer');
            const activeRegionId = mapContainer?.dataset?.regionId || null;
            const originRegionId = payload.originRegionId || null;
            if (!activeRegionId || !originRegionId || originRegionId === activeRegionId) {
                try {
                    window.loadRegionMap?.(activeRegionId || originRegionId || null);
                } catch (error) {
                    console.warn('Failed to refresh region map after exit deletion:', error);
                }
            }
        }

        if (!isSelfEvent) {
            const deletedStubName = payload?.deletedStub?.regionStubName
                || payload?.deletedStub?.name
                || null;
            const destinationId = payload?.removed?.destinationId || null;
            const summary = deletedStubName
                ? `Exit removed: ${deletedStubName}`
                : (destinationId ? `Exit removed to ${destinationId}` : 'An exit was removed.');

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
            if (this.pendingMoveOverlay && !this.locationRefreshPending) {
                try {
                    window.hideLocationOverlay?.();
                } catch (_) {
                    // ignore overlay errors
                }
                this.pendingMoveOverlay = false;
            }
        }
    }

    async submitChatMessage(rawContent, { setButtonLoading = false, travel = false, travelMetadata = null } = {}) {
        const content = typeof rawContent === 'string' ? rawContent : '';
        const trimmed = content.trim();
        if (!trimmed) {
            return;
        }

        const userEntry = this.normalizeLocalEntry({ role: 'user', content });
        this.serverHistory.push(userEntry);
        this.chatHistory = [this.systemMessage, ...this.serverHistory];
        this.renderChatHistory();

        const requestId = this.generateRequestId();
        const context = this.ensureRequestContext(requestId);

        if (setButtonLoading) {
            this.setSendButtonLoading(true);
        }

        this.showLoading(requestId);

        let shouldRefreshLocation = false;
        let finalizeMode = 'none';

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
                    requestId,
                    travel: Boolean(travel),
                    travelMetadata: travelMetadata || null
                })
            });

            const data = await response.json();
            context.httpResolved = true;

            if (data.error) {
                this.hideLoading(requestId);
                this.addMessage('system', `Error: ${data.error}`, true);
                finalizeMode = 'immediate';
            } else {
                const result = this.processChatPayload(requestId, data, { fromStream: false });
                shouldRefreshLocation = result.shouldRefreshLocation || shouldRefreshLocation;

                if (!context.streamMeta || context.streamMeta.enabled === false) {
                    finalizeMode = 'afterRefresh';
                } else if (context.streamComplete) {
                    finalizeMode = 'afterRefresh';
                }
            }
        } catch (error) {
            this.hideLoading(requestId);
            this.addMessage('system', `Connection error: ${error.message}`, true);
            context.httpResolved = true;
            finalizeMode = 'immediate';
        }

        if (shouldRefreshLocation) {
            try {
                await this.checkLocationUpdate();
            } catch (refreshError) {
                console.warn('Failed to refresh location after chat response:', refreshError);
            }
        }

        if (finalizeMode === 'immediate' || finalizeMode === 'afterRefresh') {
            this.finalizeChatRequest(requestId);
        }

        await this.refreshChatHistory();
    }

    async sendMessage() {
        const rawInput = this.messageInput.value;
        if (!rawInput || !rawInput.trim()) {
            return;
        }

        this.messageInput.value = '';
        const trimmed = rawInput.trim();
        if (trimmed.startsWith('/')) {
            try {
                await this.executeSlashCommand(trimmed);
            } catch (error) {
                console.error('Slash command failed:', error);
                this.addMessage('system', `Slash command error: ${error.message || error}`, true);
            }
            return;
        }

        await this.submitChatMessage(rawInput, { setButtonLoading: true, travel: false });
    }

    async dispatchAutomatedMessage(message, { travel = false, travelMetadata = null } = {}) {
        await this.submitChatMessage(message, {
            setButtonLoading: Boolean(travel),
            travel: Boolean(travel),
            travelMetadata: travelMetadata || null
        });
    }

    parseSlashArgs(argsText) {
        const result = {};
        if (!argsText || !argsText.trim()) {
            return result;
        }

        const pattern = /([a-zA-Z0-9_]+)=([^\s"]+|"[^"]*")/g;
        let match;
        while ((match = pattern.exec(argsText)) !== null) {
            const keyRaw = match[1];
            let valueRaw = match[2] || '';
            if (valueRaw.startsWith('"') && valueRaw.endsWith('"')) {
                valueRaw = valueRaw.slice(1, -1);
            }

            let value = valueRaw;
            const lower = valueRaw.trim().toLowerCase();
            if (/^-?\d+$/.test(valueRaw)) {
                value = Number.parseInt(valueRaw, 10);
            } else if (lower === 'true' || lower === 'false') {
                value = lower === 'true';
            }

            result[keyRaw.toLowerCase()] = value;
        }

        const remainder = argsText.replace(/([a-zA-Z0-9_]+)=([^\s"]+|"[^"]*")/g, '').trim();
        if (remainder) {
            result._ = remainder;
        }

        return result;
    }

    async executeSlashCommand(rawCommand) {
        const trimmed = rawCommand.startsWith('/') ? rawCommand.slice(1).trim() : rawCommand.trim();
        if (!trimmed) {
            throw new Error('Slash command is empty.');
        }

        const firstSpaceIndex = trimmed.indexOf(' ');
        const commandName = firstSpaceIndex === -1 ? trimmed : trimmed.slice(0, firstSpaceIndex);
        if (!commandName) {
            throw new Error('Slash command name is missing.');
        }

        const argsText = firstSpaceIndex === -1 ? '' : trimmed.slice(firstSpaceIndex + 1);
        const args = this.parseSlashArgs(argsText);

        this.addMessage('user', `/${trimmed}`, false);

        const requestBody = {
            command: commandName,
            args,
            argsText,
            userId: window.currentPlayerData?.id || null
        };

        this.setSendButtonLoading(true);

        let overlayTimer = null;
        const showOverlayAfterDelay = () => {
            overlayTimer = window.setTimeout(() => {
                try {
                    window.showLocationOverlay?.('Executing command...');
                } catch (error) {
                    console.warn('Failed to show overlay for slash command:', error);
                }
            }, 500);
        };
        showOverlayAfterDelay();

        try {
            const response = await fetch('/api/slash-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            let data = {};
            try {
                data = await response.json();
            } catch (_) {
                data = {};
            }

            if (!response.ok || !data?.success) {
                const errorText = (data && (data.error || (Array.isArray(data.errors) ? data.errors.join(', ') : null)))
                    || `HTTP ${response.status}`;
                throw new Error(errorText);
            }

            const replies = Array.isArray(data.replies) ? data.replies : [];
            if (!replies.length) {
                this.addMessage('system', `Command '${commandName}' executed.`, false);
            } else {
                replies.forEach(reply => {
                    if (!reply || typeof reply.content !== 'string') {
                        return;
                    }
                    const message = reply.content.trim();
                    if (!message) {
                        return;
                    }
                    const isError = Boolean(reply.ephemeral);
                    this.addMessage('system', message, isError, null, { allowMarkdown: true });
                });
            }

            try {
                await this.checkLocationUpdate();
            } catch (error) {
                console.warn('Failed to refresh after slash command:', error);
            }
        } finally {
            if (overlayTimer) {
                window.clearTimeout(overlayTimer);
            }
            try {
                window.hideLocationOverlay?.();
            } catch (_) {
                // ignore
            }
            this.setSendButtonLoading(false);
        }
    }

    async checkLocationUpdate() {
        console.log('Checking for location update...');
        const overlayWasRequested = this.pendingMoveOverlay === true;
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
        } finally {
            const hasPendingChat = this.pendingRequests && this.pendingRequests.size > 0;
            if (overlayWasRequested && !hasPendingChat) {
                try {
                    window.hideLocationOverlay?.();
                } catch (_) {
                    // ignore overlay errors
                }
                this.pendingMoveOverlay = false;
            }
        }
        console.log("Location update check complete.");
    }
}

console.log("chat.js loaded");

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    //new AIRPGChat();
});
