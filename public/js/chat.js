class AIRPGChat {
    constructor() {
        this.chatLog = document.getElementById('chatLog');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.skillPointsDisplay = document.getElementById('unspentSkillPointsDisplay');
        this.skillRankElements = this.collectSkillRankElements();

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
        this.initSkillIncreaseControls();
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
        contentDiv.innerHTML = contentHtml;

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
            return text || 'Someone';
        };

        const safeItem = (value, fallback = 'an item') => {
            if (!value && value !== 0) return fallback;
            const text = String(value).trim();
            return text || fallback;
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
                entries.forEach((item) => {
                    const itemName = safeItem(item);
                    this.addEventSummary('🎒', `Picked up ${itemName}.`);
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
        contentDiv.innerHTML = contentHtml;

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

        contentDiv.innerHTML = `
            <div class="skill-check-details">
                <ul>
                    ${lines.join('\n')}
                </ul>
            </div>
        `;

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
        const rawInput = this.messageInput.value;
        const message = rawInput.trim();
        if (!message) return;

        this.addMessage('user', message);
        this.chatHistory.push({ role: 'user', content: rawInput });

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

                if (data.eventChecks) {
                    this.addEventMessage(data.eventChecks);
                }

                if (data.actionResolution) {
                    this.addSkillCheckMessage(data.actionResolution);
                }

                if (data.events) {
                    this.addEventSummaries(data.events);
                }

                if (data.plausibility) {
                    this.addPlausibilityMessage(data.plausibility);
                }

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
                if (window.refreshParty) {
                    window.refreshParty();
                }

                this.refreshSkillState(result.player);

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
