class AIRPGChat {
    constructor() {
        this.chatLog = document.getElementById('chatLog');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.prefixHelpLink = document.getElementById('prefixHelpLink');
        this.prefixHelpModal = document.getElementById('prefixHelpModal');
        this.prefixHelpCloseButton = document.getElementById('prefixHelpCloseBtn');
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
        this.inputHistory = [];
        this.inputHistoryIndex = null;
        this.inputHistoryDraft = '';

        this.clientId = this.loadClientId();
        this.pendingRequests = new Map();
        this.ws = null;
        this.wsReconnectDelay = 1000;
        this.wsReconnectTimer = null;
        this.streamingStatusElements = new Map();
        this.wsReadyWaiters = [];
        this.wsReady = false;
        this.chatCompletionAudio = null;
        this.chatCompletionAudioSource = null;
        this.deferredTravelCompletionSoundQueue = [];
        this.awaitingDeferredTravelCompletionSound = false;
        window.AIRPG_CLIENT_ID = this.clientId;

        this.pendingMoveOverlay = false;
        this.questConfirmationQueue = [];
        this.activeQuestConfirmation = null;
        this.questConfirmationModal = null;
        this.questConfirmationDialog = null;
        this.questConfirmationTitle = null;
        this.questConfirmationBackdrop = null;
        this.questConfirmationSummary = null;
        this.questConfirmationDescription = null;
        this.questConfirmationObjectives = null;
        this.questConfirmationRewards = null;
        this.questConfirmationGiver = null;
        this.questConfirmationStatus = null;
        this.questConfirmationAcceptButton = null;
        this.questConfirmationDeclineButton = null;
        this.questConfirmationSubmitting = false;

        this.latestPlayerActionEntryKey = null;
        this.pendingRedoStorageKey = 'airpg:pendingRedoPlayerAction';
        this.pendingRedoInProgress = false;
        this.emergencyResetInProgress = false;
        this.shortDescriptionPrompted = false;

        this.ensureTemplateEnvironment();
        this.init();
        this.initSkillIncreaseControls();
        this.connectWebSocket();

        this.locationRefreshTimers = [];
        this.locationRefreshPending = false;
        this.activeEventBundle = null;
        this.activeStatusBundle = null;

        this.setupEditModal();
        this.setupQuestConfirmationModal();
        this.setupPrefixHelpModal();
        this.loadExistingHistory();

        window.AIRPG_CHAT = this;
        this.promptProgressMessage = null;
        this.promptProgressHideTimer = null;
        this.promptProgressDragState = {
            active: false,
            pointerId: null,
            offsetX: 0,
            offsetY: 0
        };
        this.worldTimeIndicator = document.getElementById('worldTimeIndicator');
        this.worldTimeIndicatorTime = document.getElementById('worldTimeIndicatorTime');
        this.worldTimeIndicatorDate = document.getElementById('worldTimeIndicatorDate');
        this.worldTimeIndicatorMeta = document.getElementById('worldTimeIndicatorMeta');
        this.worldTimeIndicatorLightLevel = document.getElementById('worldTimeIndicatorLightLevel');
        this.worldTimeIndicatorWeather = document.getElementById('worldTimeIndicatorWeather');
        this.lastWorldTimeIndicatorState = null;
    }

    setupQuestConfirmationModal() {
        if (this.questConfirmationModal) {
            return;
        }

        const container = document.createElement('div');
        container.className = 'quest-confirmation';
        container.setAttribute('hidden', '');
        container.innerHTML = `
            <div class="quest-confirmation__backdrop" role="presentation"></div>
            <div class="quest-confirmation__dialog" role="dialog" aria-modal="true" aria-labelledby="questConfirmationTitle">
                <header class="quest-confirmation__header">
                    <h2 id="questConfirmationTitle" class="quest-confirmation__title">Quest Available</h2>
                </header>
                <div class="quest-confirmation__body">
                    <p class="quest-confirmation__giver"></p>
                    <p class="quest-confirmation__summary"></p>
                    <p class="quest-confirmation__description"></p>
                    <div class="quest-confirmation__section quest-confirmation__section--objectives">
                        <h3>Objectives</h3>
                        <ul class="quest-confirmation__objectives"></ul>
                    </div>
                    <div class="quest-confirmation__section quest-confirmation__section--rewards">
                        <h3>Rewards</h3>
                        <ul class="quest-confirmation__rewards"></ul>
                    </div>
                    <p class="quest-confirmation__status" role="status" aria-live="polite"></p>
                </div>
                <footer class="quest-confirmation__footer">
                    <button type="button" class="quest-confirmation__decline">Decline</button>
                    <button type="button" class="quest-confirmation__accept">Accept Quest</button>
                </footer>
            </div>
        `;

        document.body.appendChild(container);

        this.questConfirmationModal = container;
        this.questConfirmationDialog = container.querySelector('.quest-confirmation__dialog');
        this.questConfirmationBackdrop = container.querySelector('.quest-confirmation__backdrop');
        this.questConfirmationTitle = container.querySelector('.quest-confirmation__title');
        this.questConfirmationSummary = container.querySelector('.quest-confirmation__summary');
        this.questConfirmationDescription = container.querySelector('.quest-confirmation__description');
        this.questConfirmationObjectives = container.querySelector('.quest-confirmation__objectives');
        this.questConfirmationRewards = container.querySelector('.quest-confirmation__rewards');
        this.questConfirmationGiver = container.querySelector('.quest-confirmation__giver');
        this.questConfirmationStatus = container.querySelector('.quest-confirmation__status');
        this.questConfirmationAcceptButton = container.querySelector('.quest-confirmation__accept');
        this.questConfirmationDeclineButton = container.querySelector('.quest-confirmation__decline');

        if (this.questConfirmationAcceptButton) {
            this.questConfirmationAcceptButton.addEventListener('click', () => this.submitQuestConfirmation(true));
        }
        if (this.questConfirmationDeclineButton) {
            this.questConfirmationDeclineButton.addEventListener('click', () => this.submitQuestConfirmation(false));
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isQuestConfirmationVisible() && !this.questConfirmationSubmitting) {
                this.submitQuestConfirmation(false);
            }
        });
    }

    setupPrefixHelpModal() {
        if (!this.prefixHelpModal) {
            return;
        }

        if (this.prefixHelpCloseButton) {
            this.prefixHelpCloseButton.addEventListener('click', () => this.closePrefixHelpModal());
        }

        this.prefixHelpModal.addEventListener('click', (event) => {
            if (event.target === this.prefixHelpModal) {
                this.closePrefixHelpModal();
            }
        });
    }

    isPrefixHelpModalOpen() {
        return Boolean(this.prefixHelpModal && !this.prefixHelpModal.hasAttribute('hidden'));
    }

    syncBodyModalOpenClass() {
        const hasOpenModal = Boolean(document.querySelector('.modal[aria-hidden="false"], .chat-edit-modal.is-open, .quest-confirmation.is-open, .npc-selection-modal'));
        if (hasOpenModal) {
            document.body.classList.add('modal-open');
        } else {
            document.body.classList.remove('modal-open');
        }
    }

    openPrefixHelpModal() {
        if (!this.prefixHelpModal) {
            return;
        }
        this.prefixHelpModal.removeAttribute('hidden');
        this.prefixHelpModal.setAttribute('aria-hidden', 'false');
        if (this.prefixHelpLink) {
            this.prefixHelpLink.setAttribute('aria-expanded', 'true');
        }
        document.body.classList.add('modal-open');
        if (this.prefixHelpCloseButton) {
            this.prefixHelpCloseButton.focus();
        }
    }

    closePrefixHelpModal() {
        if (!this.prefixHelpModal) {
            return;
        }
        this.prefixHelpModal.setAttribute('hidden', '');
        this.prefixHelpModal.setAttribute('aria-hidden', 'true');
        if (this.prefixHelpLink) {
            this.prefixHelpLink.setAttribute('aria-expanded', 'false');
        }
        this.syncBodyModalOpenClass();
        if (this.prefixHelpLink) {
            this.prefixHelpLink.focus();
        }
    }

    isQuestConfirmationVisible() {
        return Boolean(this.questConfirmationModal && !this.questConfirmationModal.hasAttribute('hidden'));
    }

    normalizeQuestConfirmationRequest(payload) {
        if (!payload || typeof payload !== 'object') {
            return null;
        }

        const confirmationId = typeof payload.confirmationId === 'string'
            ? payload.confirmationId.trim()
            : '';
        if (!confirmationId) {
            return null;
        }

        const questSource = payload.quest && typeof payload.quest === 'object' ? payload.quest : null;
        if (!questSource) {
            return null;
        }

        const safeText = (value) => {
            if (typeof value !== 'string') {
                return '';
            }
            const trimmed = value.trim();
            return trimmed.length ? trimmed : '';
        };

        const objectives = Array.isArray(questSource.objectives)
            ? questSource.objectives
                .map(entry => {
                    if (!entry || typeof entry !== 'object') {
                        return null;
                    }
                    const description = safeText(entry.description);
                    if (!description) {
                        return null;
                    }
                    return {
                        description,
                        optional: Boolean(entry.optional)
                    };
                })
                .filter(Boolean)
            : [];

        const rewardItems = Array.isArray(questSource.rewardItems)
            ? questSource.rewardItems
                .map(entry => {
                    if (!entry) {
                        return null;
                    }
                    if (typeof entry === 'string') {
                        const name = safeText(entry);
                        return name ? { name } : null;
                    }
                    if (typeof entry === 'object') {
                        const name = safeText(entry.name || entry.label);
                        if (!name) {
                            return null;
                        }
                        const quantity = Number.isFinite(entry.quantity)
                            ? Math.max(1, Math.round(entry.quantity))
                            : null;
                        return quantity && quantity !== 1
                            ? { name, quantity }
                            : { name };
                    }
                    return null;
                })
                .filter(Boolean)
            : [];

        const rewardCurrency = Number.isFinite(questSource.rewardCurrency)
            ? Math.max(0, Math.round(questSource.rewardCurrency))
            : 0;
        const rewardXp = Number.isFinite(questSource.rewardXp)
            ? Math.max(0, Math.round(questSource.rewardXp))
            : 0;
        const rewardFactionReputation = (() => {
            const source = questSource.rewardFactionReputation;
            if (!source) {
                return [];
            }
            if (Array.isArray(source)) {
                return source
                    .map(entry => {
                        if (!entry || typeof entry !== 'object') {
                            return null;
                        }
                        const factionName = safeText(entry.factionName || entry.factionId || entry.name);
                        const points = Number(entry.points ?? entry.amount ?? entry.delta ?? entry.value);
                        if (!factionName || !Number.isFinite(points) || !Number.isInteger(points) || points === 0) {
                            return null;
                        }
                        return {
                            factionName,
                            points
                        };
                    })
                    .filter(Boolean);
            }
            if (typeof source === 'object') {
                return Object.entries(source)
                    .map(([factionKey, value]) => {
                        const factionName = safeText(factionKey);
                        const points = Number(value);
                        if (!factionName || !Number.isFinite(points) || !Number.isInteger(points) || points === 0) {
                            return null;
                        }
                        return {
                            factionName,
                            points
                        };
                    })
                    .filter(Boolean);
            }
            return [];
        })();

        return {
            confirmationId,
            quest: {
                id: safeText(questSource.id),
                name: safeText(questSource.name),
                summary: safeText(questSource.summary),
                description: safeText(questSource.description),
                giver: safeText(questSource.giver),
                objectives,
                rewardItems,
                rewardCurrency,
                rewardXp,
                rewardFactionReputation
            }
        };
    }

    enqueueQuestConfirmation(request) {
        const normalized = this.normalizeQuestConfirmationRequest(request);
        if (!normalized) {
            console.warn('Received invalid quest confirmation payload:', request);
            return;
        }

        this.questConfirmationQueue.push(normalized);
        if (!this.activeQuestConfirmation) {
            this.presentNextQuestConfirmation();
        }
    }

    presentNextQuestConfirmation() {
        if (this.activeQuestConfirmation || !this.questConfirmationQueue.length) {
            return;
        }
        const next = this.questConfirmationQueue.shift();
        this.activeQuestConfirmation = next;
        this.renderQuestConfirmation(next);
        this.openQuestConfirmationModal();
    }

    openQuestConfirmationModal() {
        if (!this.questConfirmationModal) {
            return;
        }
        this.questConfirmationModal.removeAttribute('hidden');
        this.questConfirmationModal.classList.add('is-open');
        this.questConfirmationSubmitting = false;
        this.setQuestConfirmationStatus('');
        this.setQuestConfirmationBusy(false);
        if (this.questConfirmationAcceptButton) {
            setTimeout(() => {
                this.questConfirmationAcceptButton?.focus();
            }, 50);
        }
    }

    closeQuestConfirmationModal() {
        if (!this.questConfirmationModal) {
            return;
        }
        this.questConfirmationModal.setAttribute('hidden', '');
        this.questConfirmationModal.classList.remove('is-open');
        this.questConfirmationSubmitting = false;
        this.activeQuestConfirmation = null;
        this.setQuestConfirmationStatus('');
    }

    setQuestConfirmationStatus(message, tone = null) {
        if (!this.questConfirmationStatus) {
            return;
        }
        const text = typeof message === 'string' ? message.trim() : '';
        this.questConfirmationStatus.textContent = text;
        this.questConfirmationStatus.classList.remove('is-error', 'is-success');
        if (!text) {
            return;
        }
        if (tone === 'error') {
            this.questConfirmationStatus.classList.add('is-error');
        } else if (tone === 'success') {
            this.questConfirmationStatus.classList.add('is-success');
        }
    }

    setQuestConfirmationBusy(isBusy, message = null) {
        this.questConfirmationSubmitting = Boolean(isBusy);
        if (this.questConfirmationAcceptButton) {
            this.questConfirmationAcceptButton.disabled = this.questConfirmationSubmitting;
        }
        if (this.questConfirmationDeclineButton) {
            this.questConfirmationDeclineButton.disabled = this.questConfirmationSubmitting;
        }
        if (typeof message === 'string') {
            this.setQuestConfirmationStatus(message, isBusy ? null : undefined);
        }
    }

    renderQuestConfirmation(request) {
        if (!request || !request.quest) {
            return;
        }
        const quest = request.quest;
        const toggleHidden = (element, shouldHide) => {
            if (!element) {
                return;
            }
            if (shouldHide) {
                element.setAttribute('hidden', '');
            } else {
                element.removeAttribute('hidden');
            }
        };

        const titleSegments = [];
        if (quest.name) {
            titleSegments.push(`Accept "${quest.name}"?`);
        } else {
            titleSegments.push('Accept this quest?');
        }
        if (this.questConfirmationTitle) {
            this.questConfirmationTitle.textContent = titleSegments.join(' ');
        }

        if (this.questConfirmationGiver) {
            this.questConfirmationGiver.textContent = quest.giver
                ? `Quest giver: ${quest.giver}`
                : '';
            toggleHidden(this.questConfirmationGiver, !quest.giver);
        }

        if (this.questConfirmationSummary) {
            this.questConfirmationSummary.textContent = quest.summary
                ? quest.summary
                : '';
            toggleHidden(this.questConfirmationSummary, !quest.summary);
        }

        if (this.questConfirmationDescription) {
            const description = quest.description && quest.description !== quest.summary
                ? quest.description
                : '';
            this.questConfirmationDescription.textContent = description;
            toggleHidden(this.questConfirmationDescription, !description);
        }

        if (this.questConfirmationObjectives) {
            this.questConfirmationObjectives.innerHTML = '';
            if (Array.isArray(quest.objectives) && quest.objectives.length) {
                quest.objectives.forEach(entry => {
                    const item = document.createElement('li');
                    item.textContent = entry.optional
                        ? `${entry.description} (optional)`
                        : entry.description;
                    this.questConfirmationObjectives.appendChild(item);
                });
            } else {
                const item = document.createElement('li');
                item.textContent = 'No explicit objectives were provided.';
                this.questConfirmationObjectives.appendChild(item);
            }
        }

        if (this.questConfirmationRewards) {
            this.questConfirmationRewards.innerHTML = '';
            const rewardLines = [];
            const formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
            if (quest.rewardCurrency > 0) {
                rewardLines.push(`Currency: ${formatter.format(quest.rewardCurrency)}`);
            }
            if (quest.rewardXp > 0) {
                rewardLines.push(`Experience: ${formatter.format(quest.rewardXp)} XP`);
            }
            if (Array.isArray(quest.rewardItems) && quest.rewardItems.length) {
                quest.rewardItems.forEach(entry => {
                    const line = entry.quantity && entry.quantity !== 1
                        ? `${entry.quantity} × ${entry.name}`
                        : entry.name;
                    rewardLines.push(line);
                });
            }
            if (Array.isArray(quest.rewardFactionReputation) && quest.rewardFactionReputation.length) {
                quest.rewardFactionReputation.forEach(entry => {
                    const points = Number(entry.points);
                    if (!Number.isFinite(points) || !Number.isInteger(points) || points === 0) {
                        return;
                    }
                    const signed = points > 0 ? `+${points}` : `${points}`;
                    rewardLines.push(`${signed} reputation with ${entry.factionName}`);
                });
            }
            if (!rewardLines.length) {
                rewardLines.push('No guaranteed rewards listed.');
            }

            rewardLines.forEach(line => {
                const item = document.createElement('li');
                item.textContent = line;
                this.questConfirmationRewards.appendChild(item);
            });
        }

        this.setQuestConfirmationStatus('');
    }

    async submitQuestConfirmation(accepted) {
        if (!this.activeQuestConfirmation || this.questConfirmationSubmitting) {
            return;
        }
        if (typeof accepted !== 'boolean') {
            return;
        }

        if (!this.clientId) {
            this.setQuestConfirmationStatus('Client ID missing; cannot respond to quest.', 'error');
            return;
        }

        this.setQuestConfirmationBusy(true, accepted ? 'Accepting quest…' : 'Declining quest…');

        try {
            const response = await fetch('/api/quests/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    confirmationId: this.activeQuestConfirmation.confirmationId,
                    clientId: this.clientId,
                    decision: accepted ? 'accept' : 'decline'
                })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                const errorMessage = data?.error || `HTTP ${response.status}`;
                throw new Error(errorMessage);
            }
            this.setQuestConfirmationStatus(accepted ? 'Quest accepted.' : 'Quest declined.', 'success');
            this.closeQuestConfirmationModal();
            this.presentNextQuestConfirmation();
            try {
                window.refreshQuestPanel?.();
            } catch (panelError) {
                console.debug('Quest panel refresh failed:', panelError);
            }
        } catch (error) {
            console.warn('Failed to submit quest confirmation:', error);
            this.setQuestConfirmationStatus(error?.message || 'Failed to submit quest confirmation.', 'error');
            this.setQuestConfirmationBusy(false);
            return;
        }
    }

    handleQuestConfirmationRequest(payload) {
        this.enqueueQuestConfirmation(payload);
    }

    async loadExistingHistory() {
        try {
            const response = await fetch('/api/chat/history');
            const data = await response.json();

            this.updateServerHistory(Array.isArray(data.history) ? data.history : []);
            if (data?.worldTime && typeof data.worldTime === 'object') {
                this.updateWorldTimeIndicator(data.worldTime, { emitTransitions: false });
            }
            await this.checkShortDescriptionBackfill();
            await this.tryRunPendingRedo();
        } catch (error) {
            console.log('No existing history to load:', error.message);
            this.reportPendingRedoError(`Redo pending but chat history failed to load: ${error.message || error}`);
        }
    }

    normalizeWeatherNameForDisplay(name) {
        if (typeof name !== 'string') {
            return '';
        }
        const trimmed = name.trim();
        if (!trimmed) {
            return '';
        }
        const normalized = trimmed.toLowerCase();
        if (
            normalized === 'unspecified weather'
            || normalized === 'unknown weather'
            || normalized === 'no local weather'
        ) {
            return '';
        }
        return trimmed;
    }

    updateWorldTimeIndicator(worldTime, { emitTransitions = false } = {}) {
        if (!worldTime || typeof worldTime !== 'object') {
            return;
        }
        if (!this.worldTimeIndicator) {
            return;
        }

        const timeLabel = typeof worldTime.timeLabel === 'string' && worldTime.timeLabel.trim()
            ? worldTime.timeLabel.trim()
            : '--:--';
        const dateLabel = typeof worldTime.dateLabel === 'string' && worldTime.dateLabel.trim()
            ? worldTime.dateLabel.trim()
            : 'Unknown date';
        const segment = typeof worldTime.segment === 'string' && worldTime.segment.trim()
            ? worldTime.segment.trim()
            : 'Unknown segment';
        const season = typeof worldTime.season === 'string' && worldTime.season.trim()
            ? worldTime.season.trim()
            : 'Unknown season';
        const rawWeatherName = typeof worldTime.weatherName === 'string' && worldTime.weatherName.trim()
            ? worldTime.weatherName.trim()
            : '';
        const locationHasWeather = rawWeatherName.toLowerCase() !== 'no local weather';
        const weatherName = this.normalizeWeatherNameForDisplay(worldTime.weatherName);
        const shouldShowWeather = Boolean(weatherName);
        const lightLevel = typeof worldTime.lightLevelDescription === 'string' && worldTime.lightLevelDescription.trim()
            ? worldTime.lightLevelDescription.trim()
            : (typeof worldTime.lighting === 'string' && worldTime.lighting.trim()
                ? worldTime.lighting.trim()
                : '');

        const previousState = this.lastWorldTimeIndicatorState;
        if (emitTransitions && previousState) {
            if (
                locationHasWeather
                && previousState.locationHasWeather
                && lightLevel
                && previousState.lightLevel
                && lightLevel !== previousState.lightLevel
            ) {
                this.addEventSummary('💡', `Light level changed from ${previousState.lightLevel} to ${lightLevel}.`);
            }
            if (weatherName && previousState.weatherName && weatherName !== previousState.weatherName) {
                this.addEventSummary('🌦️', `Weather changed from ${previousState.weatherName} to ${weatherName}.`);
            }
        }

        if (this.worldTimeIndicatorTime) {
            this.worldTimeIndicatorTime.textContent = timeLabel;
        }
        if (this.worldTimeIndicatorDate) {
            this.worldTimeIndicatorDate.textContent = dateLabel;
        }
        if (this.worldTimeIndicatorMeta) {
            this.worldTimeIndicatorMeta.textContent = `${segment} · ${season}`;
        }
        if (this.worldTimeIndicatorLightLevel) {
            if (lightLevel) {
                this.worldTimeIndicatorLightLevel.textContent = lightLevel;
                this.worldTimeIndicatorLightLevel.removeAttribute('hidden');
            } else {
                this.worldTimeIndicatorLightLevel.textContent = '';
                this.worldTimeIndicatorLightLevel.setAttribute('hidden', '');
            }
        }
        if (this.worldTimeIndicatorWeather) {
            if (shouldShowWeather) {
                this.worldTimeIndicatorWeather.textContent = `Weather: ${weatherName}`;
                this.worldTimeIndicatorWeather.removeAttribute('hidden');
            } else {
                this.worldTimeIndicatorWeather.textContent = '';
                this.worldTimeIndicatorWeather.setAttribute('hidden', '');
            }
        }

        this.lastWorldTimeIndicatorState = {
            timeLabel,
            dateLabel,
            segment,
            season,
            lightLevel,
            weatherName,
            locationHasWeather
        };

        this.worldTimeIndicator.removeAttribute('hidden');
    }

    renderWorldTimeTransitions(transitions = [], requestId = null) {
        if (!Array.isArray(transitions) || !transitions.length) {
            return;
        }

        const context = requestId ? this.getRequestContext(requestId) : null;
        const seen = context && context.renderedTimeTransitions instanceof Set
            ? context.renderedTimeTransitions
            : null;

        transitions.forEach((transition, index) => {
            if (!transition || typeof transition !== 'object') {
                return;
            }
            const type = typeof transition.type === 'string' ? transition.type.trim().toLowerCase() : '';
            if (!type) {
                return;
            }

            const from = typeof transition.from === 'string' ? transition.from.trim() : '';
            const to = typeof transition.to === 'string' ? transition.to.trim() : '';
            if (!to) {
                return;
            }

            const key = `${type}:${from}:${to}:${transition.atDayIndex ?? ''}:${transition.atTimeMinutes ?? ''}:${index}`;
            if (seen && seen.has(key)) {
                return;
            }
            if (seen) {
                seen.add(key);
            }

            if (type === 'segment') {
                const fromText = from ? `from ${from} ` : '';
                this.addEventSummary('🕒', `Time shifted ${fromText}to ${to}.`);
                return;
            }

            if (type === 'season') {
                const fromText = from ? `from ${from} ` : '';
                this.addEventSummary('🍂', `Season changed ${fromText}to ${to}.`);
            }
        });
    }

    async checkShortDescriptionBackfill() {
        if (this.shortDescriptionPrompted) {
            return;
        }
        this.shortDescriptionPrompted = true;

        const clientId = this.clientId || window.AIRPG_CLIENT_ID;
        if (!clientId) {
            console.warn('Short description backfill check skipped: missing client ID.');
            return;
        }

        let response = null;
        try {
            response = await fetch(`/api/short-descriptions/pending?clientId=${encodeURIComponent(clientId)}`, {
                cache: 'no-store'
            });
        } catch (error) {
            console.warn('Failed to check short description backfill status:', error);
            return;
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success || !data?.pending || !data?.plan) {
            return;
        }

        const counts = data.plan.counts || {};
        const prompts = data.plan.prompts || {};
        const messageLines = [
            'There are items, locations, regions, and abilities in your save file that don\'t have short descriptions. This is probably due to your save being from an older version of AI RPG. It\'s not necessary to update them, but for long-standing saves, it could drastically shorten your base context, speeding up the game and improving coherence. If you are using an API plan that charges per token, be aware that this may incur additional costs. Note that in new saves, short descriptions are generated alongside the full data, so this is only needed for older saves, and only once. Be sure to save when it\'s done!',
            '',
            'Here are the number of each item to be processed, along with the number of prompts required (potentially more if there are errors):',
            '',
            `Items: ${counts.items || 0} (${prompts.items || 0} prompts)`,
            `Regions: ${counts.regions || 0} (${prompts.regions || 0} prompts)`,
            `Locations: ${counts.locations || 0} (${prompts.locations || 0} prompts)`,
            `Abilities: ${counts.abilities || 0} (${prompts.abilities || 0} prompts)`,
            '',
            'Do you wish to process these now? Cancel if you would prefer not to. You can still play your game as normal.'
        ];
        const shouldProcess = window.confirm(messageLines.join('\n'));

        try {
            const processResponse = await fetch('/api/short-descriptions/process', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId,
                    action: shouldProcess ? 'run' : 'skip'
                })
            });
            if (!processResponse.ok) {
                const errorData = await processResponse.json().catch(() => ({}));
                const errorMessage = errorData?.error || `HTTP ${processResponse.status}`;
                if (shouldProcess) {
                    this.addMessage('system', `Short description update failed: ${errorMessage}`, true);
                } else {
                    console.warn('Failed to dismiss short description backfill:', errorMessage);
                }
            }
        } catch (error) {
            if (shouldProcess) {
                this.addMessage('system', `Short description update failed: ${error.message || error}`, true);
            } else {
                console.warn('Failed to dismiss short description backfill:', error);
            }
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

    getAttachmentTypes() {
        return new Set(['skill-check', 'attack-check', 'plausibility', 'slop-remover', 'supplemental-story-info']);
    }

    getClientMessageHistoryConfig() {
        const config = window.AIRPG_CONFIG?.clientMessageHistory;
        if (!config || typeof config !== 'object') {
            throw new Error('AIRPG_CONFIG.clientMessageHistory is required for client pruning.');
        }

        const maxMessages = Number(config.maxMessages);
        if (!Number.isInteger(maxMessages) || maxMessages <= 0) {
            throw new Error('AIRPG_CONFIG.clientMessageHistory.maxMessages must be a positive integer.');
        }

        const pruneTo = Number(config.pruneTo);
        if (!Number.isInteger(pruneTo) || pruneTo <= 0) {
            throw new Error('AIRPG_CONFIG.clientMessageHistory.pruneTo must be a positive integer.');
        }

        if (pruneTo > maxMessages) {
            throw new Error('AIRPG_CONFIG.clientMessageHistory.pruneTo must be <= maxMessages.');
        }

        return { maxMessages, pruneTo };
    }

    getServerHistoryTurnAnchorIndexes(history) {
        if (!Array.isArray(history)) {
            throw new Error('Server history must be an array before identifying turn anchors.');
        }

        const userAnchors = [];
        const assistantFallbackAnchors = [];

        history.forEach((entry, index) => {
            if (!entry || typeof entry !== 'object') {
                return;
            }
            const role = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
            const entryType = typeof entry.type === 'string' ? entry.type.trim().toLowerCase() : '';

            if (role === 'user') {
                userAnchors.push(index);
                return;
            }

            if (role === 'assistant' && (entryType === 'player-action' || entryType === 'storyteller-answer')) {
                assistantFallbackAnchors.push(index);
            }
        });

        return userAnchors.length ? userAnchors : assistantFallbackAnchors;
    }

    pruneServerHistoryIfNeeded() {
        const { maxMessages } = this.getClientMessageHistoryConfig();
        if (!Array.isArray(this.serverHistory)) {
            throw new Error('Server history must be an array before pruning.');
        }

        const turnAnchorIndexes = this.getServerHistoryTurnAnchorIndexes(this.serverHistory);
        let prunedHistory = this.serverHistory;
        let didPrune = false;

        if (turnAnchorIndexes.length > 0) {
            if (turnAnchorIndexes.length > maxMessages) {
                const startIndex = turnAnchorIndexes[turnAnchorIndexes.length - maxMessages];
                prunedHistory = this.serverHistory.slice(startIndex);
                didPrune = true;
            }
        } else if (this.serverHistory.length > maxMessages) {
            prunedHistory = this.serverHistory.slice(-maxMessages);
            didPrune = true;
        }

        if (!didPrune) {
            return false;
        }

        const attachmentTypes = this.getAttachmentTypes();
        const resolvedParentById = new Map();
        let lastNonAttachmentId = null;

        prunedHistory.forEach(entry => {
            if (!entry) {
                lastNonAttachmentId = null;
                return;
            }
            const entryType = entry.type || null;
            const isAttachment = attachmentTypes.has(entryType);
            if (!isAttachment) {
                lastNonAttachmentId = entry.id || null;
                return;
            }
            if (!entry.parentId && entry.id && lastNonAttachmentId) {
                resolvedParentById.set(entry.id, lastNonAttachmentId);
            }
        });

        const keptIds = new Set(
            prunedHistory
                .map(entry => entry && entry.id)
                .filter(Boolean)
        );

        this.serverHistory = prunedHistory.filter(entry => {
            if (!entry) {
                return false;
            }
            const entryType = entry.type || null;
            if (!attachmentTypes.has(entryType)) {
                return true;
            }
            const parentId = entry.parentId || (entry.id ? resolvedParentById.get(entry.id) : null);
            if (!parentId) {
                return false;
            }
            return keptIds.has(parentId);
        });

        return true;
    }

    updateServerHistory(history) {
        this.serverHistory = Array.isArray(history)
            ? history.map(entry => this.normalizeLocalEntry(entry))
            : [];
        this.pruneServerHistoryIfNeeded();
        this.chatHistory = [this.systemMessage, ...this.serverHistory];
        this.renderChatHistory();
    }

    renderChatHistory() {
        if (!this.chatLog) {
            return;
        }

        const latestPlayerAction = this.getLatestPlayerActionEntry();
        this.latestPlayerActionEntryKey = this.getEntryKey(latestPlayerAction);

        this.messageRegistry.clear();
        const fragment = document.createDocumentFragment();

        const aggregatedEntries = [];
        const recordsById = new Map();
        const pendingAttachments = new Map();
        let lastAttachable = null;
        const attachmentTypes = this.getAttachmentTypes();

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

        if (entry.type === 'status-summary') {
            return this.createStatusSummaryElement(entry);
        }

        if (entry.type === 'plausibility') {
            return this.createPlausibilityEntryElement(entry);
        }

        if (entry.type === 'slop-remover') {
            return this.createSlopRemovalEntryElement(entry);
        }

        if (entry.type === 'skill-check') {
            return this.createSkillCheckEntryElement(entry);
        }

        if (entry.type === 'attack-check') {
            return this.createAttackCheckEntryElement(entry);
        }

        const messageDiv = document.createElement('div');
        const role = entry.type === 'user-question'
            ? 'user-question-message'
            : entry.role === 'user'
                ? 'user-message'
                : entry.type === 'npc-action'
                    ? 'npc-message'
                    : 'ai-message';
        messageDiv.className = `message ${role}`;
        messageDiv.dataset.timestamp = entry.timestamp || '';



        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        if (entry.role === 'user') {
            senderDiv.textContent = '👤 You';
        } else if (entry.isNpcTurn) {
            const npcName = entry.actor || (entry.role !== 'assistant' ? entry.role : null) || 'NPC';
            senderDiv.textContent = `🧑 ${npcName}`;
        } else if (entry.role === 'assistant') {
            senderDiv.textContent = '🤖 AI Game Master';
        } else {
            senderDiv.textContent = '📝 System';
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const shouldBypassMarkdown = entry.role === 'user'
            && typeof entry.content === 'string'
            && entry.content.charAt(0) === '#';
        this.setMessageContent(contentDiv, entry.content || '', { allowMarkdown: !shouldBypassMarkdown });

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
                case 'slop-remover': {
                    const markup = this.renderSlopRemovalMarkup(attachment.slopRemoval || attachment);
                    if (markup) {
                        html = `<div class="message-insight-tooltip slop-remover-tooltip">${markup}</div>`;
                        icon = '🧹';
                        label = 'View slop remover details';
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
            console.log('Plausibility payload missing type:', plausibility);
            console.log('Plausibility structured data:', structured);
            console.trace();
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

    normalizeSlopRemovalPayload(slopRemoval) {
        if (!slopRemoval || typeof slopRemoval !== 'object') {
            return { slopWords: [], slopNgrams: [] };
        }
        const source = slopRemoval.slopRemoval && typeof slopRemoval.slopRemoval === 'object'
            ? slopRemoval.slopRemoval
            : slopRemoval;
        const slopWords = Array.isArray(source.slopWords)
            ? source.slopWords.map(word => (typeof word === 'string' ? word.trim() : '')).filter(Boolean)
            : [];
        const slopNgrams = Array.isArray(source.slopNgrams)
            ? source.slopNgrams.map(ngram => (typeof ngram === 'string' ? ngram.trim() : '')).filter(Boolean)
            : [];
        return { slopWords, slopNgrams };
    }

    renderSlopRemovalMarkup(slopRemoval) {
        const normalized = this.normalizeSlopRemovalPayload(slopRemoval);
        if (!normalized.slopWords.length && !normalized.slopNgrams.length) {
            return '';
        }

        const sections = [];
        if (normalized.slopWords.length) {
            const words = normalized.slopWords
                .map(word => `<li>${this.escapeHtml(word)}</li>`)
                .join('');
            sections.push(`<div class="slop-remover-section"><h4>Slop words</h4><ul>${words}</ul></div>`);
        }
        if (normalized.slopNgrams.length) {
            const ngrams = normalized.slopNgrams
                .map(ngram => `<li>${this.escapeHtml(ngram)}</li>`)
                .join('');
            sections.push(`<div class="slop-remover-section"><h4>Repeated n-grams</h4><ul>${ngrams}</ul></div>`);
        }

        return sections.join('');
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
                && node.dataset.type !== 'plausibility'
                && node.dataset.type !== 'slop-remover');
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
                listItem.appendChild(document.createTextNode(' '));
                const textSpan = document.createElement('span');
                textSpan.className = 'event-summary-text';
                this.setMessageContent(textSpan, item.text, { allowMarkdown: true });
                listItem.appendChild(textSpan);
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

    createStatusSummaryElement(entry) {
        const container = document.createElement('div');
        container.className = 'message status-summary-batch';
        container.dataset.timestamp = entry.timestamp || '';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = entry.summaryTitle || '🌀 Status Changes';

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
                listItem.appendChild(document.createTextNode(' '));
                const textSpan = document.createElement('span');
                textSpan.className = 'event-summary-text';
                this.setMessageContent(textSpan, item.text, { allowMarkdown: true });
                listItem.appendChild(textSpan);
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

        if (this.shouldShowRedoAction(entry)) {
            const redoButton = document.createElement('button');
            redoButton.type = 'button';
            redoButton.className = 'message-action message-action--redo';
            redoButton.title = 'Redo last player action';
            redoButton.setAttribute('aria-label', 'Redo last player action');
            redoButton.textContent = '🔁';
            redoButton.addEventListener('click', async () => {
                if (redoButton.disabled) {
                    return;
                }
                redoButton.disabled = true;
                try {
                    await this.handleRedoPlayerAction(entry);
                } catch (error) {
                    this.addMessage('system', `Redo failed: ${error.message || error}`, true);
                    redoButton.disabled = false;
                }
            });
            wrapper.appendChild(redoButton);
        }

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

    getEntryKey(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }
        return entry.id || entry.timestamp || null;
    }

    getLatestPlayerActionEntry() {
        if (!Array.isArray(this.serverHistory) || !this.serverHistory.length) {
            return null;
        }
        for (let index = this.serverHistory.length - 1; index >= 0; index -= 1) {
            const entry = this.serverHistory[index];
            if (!entry) {
                continue;
            }
            if (entry.role !== 'assistant') {
                continue;
            }
            if (entry.type !== 'player-action') {
                continue;
            }
            if (typeof entry.content !== 'string' || !entry.content.trim()) {
                continue;
            }
            return entry;
        }
        return null;
    }

    shouldShowRedoAction(entry) {
        if (!entry || entry.role !== 'assistant' || entry.type !== 'player-action') {
            return false;
        }
        const entryKey = this.getEntryKey(entry);
        if (!entryKey || !this.latestPlayerActionEntryKey) {
            return false;
        }
        return entryKey === this.latestPlayerActionEntryKey;
    }

    findUserEntryForAction(actionEntry) {
        if (!actionEntry || !Array.isArray(this.serverHistory)) {
            return null;
        }
        const actionKey = this.getEntryKey(actionEntry);
        if (!actionKey) {
            return null;
        }
        const actionIndex = this.serverHistory.findIndex(entry => this.getEntryKey(entry) === actionKey);
        if (actionIndex <= 0) {
            return null;
        }
        for (let idx = actionIndex - 1; idx >= 0; idx -= 1) {
            const candidate = this.serverHistory[idx];
            if (!candidate || candidate.role !== 'user') {
                continue;
            }
            if (typeof candidate.content !== 'string' || !candidate.content.trim()) {
                continue;
            }
            return candidate;
        }
        return null;
    }

    storePendingRedoAction(payload) {
        if (!payload || typeof payload.content !== 'string' || !payload.content.trim()) {
            throw new Error('Missing player input for redo.');
        }
        try {
            window.localStorage.setItem(this.pendingRedoStorageKey, JSON.stringify(payload));
        } catch (error) {
            throw new Error('Failed to store redo payload in local storage.');
        }
    }

    peekPendingRedoAction() {
        try {
            const raw = window.localStorage.getItem(this.pendingRedoStorageKey);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('Invalid redo payload.');
            }
            return parsed;
        } catch (error) {
            throw new Error(error.message || 'Failed to read redo payload.');
        }
    }

    consumePendingRedoAction() {
        const pending = this.peekPendingRedoAction();
        if (pending) {
            this.clearPendingRedoAction();
        }
        return pending;
    }

    clearPendingRedoAction() {
        try {
            window.localStorage.removeItem(this.pendingRedoStorageKey);
        } catch (error) {
            throw new Error('Failed to clear redo payload from local storage.');
        }
    }

    reportPendingRedoError(message) {
        try {
            const pending = this.peekPendingRedoAction();
            if (!pending) {
                return;
            }
            this.addMessage('system', message, true);
        } catch (error) {
            console.warn('Failed to report pending redo error:', error);
        }
    }

    async cancelAllPrompts({ waitForDrain = true, timeoutMs = 12000 } = {}) {
        if (typeof waitForDrain !== 'boolean') {
            throw new Error('waitForDrain must be a boolean.');
        }

        const normalizedTimeoutMs = Number(timeoutMs);
        if (!Number.isFinite(normalizedTimeoutMs) || normalizedTimeoutMs < 0) {
            throw new Error('timeoutMs must be a finite number >= 0.');
        }

        const response = await fetch('/api/prompts/cancel-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                waitForDrain,
                timeoutMs: Math.floor(normalizedTimeoutMs)
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
            const errorMessage = data?.error || `HTTP ${response.status}`;
            throw new Error(`Failed to cancel prompts: ${errorMessage}`);
        }
        return data;
    }

    async cancelAllPromptsAndLoadLatestAutosave({ triggerButton = null } = {}) {
        if (this.emergencyResetInProgress) {
            throw new Error('Prompt reset already in progress.');
        }

        this.emergencyResetInProgress = true;
        const originalLabel = triggerButton ? triggerButton.textContent : null;
        if (triggerButton) {
            triggerButton.disabled = true;
            triggerButton.textContent = 'Resetting...';
        }

        try {
            await this.cancelAllPrompts({ waitForDrain: true, timeoutMs: 12000 });
            const autosaveName = await this.fetchLatestAutosaveName();
            await this.loadAutosave(autosaveName);
        } finally {
            this.emergencyResetInProgress = false;
            if (triggerButton && triggerButton.isConnected) {
                triggerButton.disabled = false;
                if (originalLabel !== null) {
                    triggerButton.textContent = originalLabel;
                }
            }
        }
    }

    async fetchLatestAutosaveName() {
        const response = await fetch('/api/saves?type=autosaves', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
            const errorMessage = data?.error || `HTTP ${response.status}`;
            throw new Error(`Failed to load autosaves: ${errorMessage}`);
        }
        const saves = Array.isArray(data.saves) ? data.saves : [];
        if (!saves.length) {
            throw new Error('No autosaves available to load.');
        }
        const latest = saves[0];
        if (!latest?.saveName) {
            throw new Error('Latest autosave is missing a save name.');
        }
        return latest.saveName;
    }

    async loadAutosave(saveName) {
        if (!saveName) {
            throw new Error('Autosave name is required.');
        }
        const clientId = this.clientId || window.AIRPG_CLIENT_ID || null;
        const response = await fetch('/api/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ saveName, saveType: 'autosaves', clientId })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
            const errorMessage = data?.error || `HTTP ${response.status}`;
            throw new Error(`Failed to load autosave: ${errorMessage}`);
        }
        window.location.reload();
    }

    async handleRedoPlayerAction(entry) {
        if (this.pendingRedoInProgress) {
            throw new Error('Redo already in progress.');
        }
        if (this.emergencyResetInProgress) {
            throw new Error('Prompt reset already in progress.');
        }
        if (!this.shouldShowRedoAction(entry)) {
            throw new Error('Only the most recent player action can be redone.');
        }
        const userEntry = this.findUserEntryForAction(entry);
        if (!userEntry) {
            throw new Error('Unable to locate the player input for this action.');
        }
        const content = typeof userEntry.content === 'string' ? userEntry.content : '';
        const travel = Boolean(userEntry.travel);
        const travelMetadata = userEntry.travelMetadata || userEntry?.metadata?.travelMetadata || null;

        this.pendingRedoInProgress = true;
        try {
            this.storePendingRedoAction({
                content,
                travel,
                travelMetadata,
                sourceActionId: entry.id || null,
                sourceTimestamp: entry.timestamp || null
            });

            await this.cancelAllPrompts({ waitForDrain: true, timeoutMs: 12000 });
            const autosaveName = await this.fetchLatestAutosaveName();
            await this.loadAutosave(autosaveName);
        } catch (error) {
            this.pendingRedoInProgress = false;
            try {
                this.clearPendingRedoAction();
            } catch (clearError) {
                console.warn('Failed to clear pending redo payload:', clearError);
            }
            throw error;
        }
    }

    async tryRunPendingRedo() {
        let pending = null;
        try {
            pending = this.peekPendingRedoAction();
        } catch (error) {
            this.addMessage('system', error.message || 'Failed to read pending redo payload.', true);
            return;
        }
        if (!pending) {
            return;
        }
        if (!Array.isArray(this.serverHistory) || !this.serverHistory.length) {
            this.addMessage('system', 'Redo pending but chat history is unavailable.', true);
            return;
        }

        let consumed = null;
        try {
            consumed = this.consumePendingRedoAction();
        } catch (error) {
            this.addMessage('system', error.message || 'Failed to clear pending redo payload.', true);
            return;
        }

        if (!consumed || typeof consumed.content !== 'string' || !consumed.content.trim()) {
            this.addMessage('system', 'Redo payload missing player input.', true);
            return;
        }

        this.pendingRedoInProgress = true;
        try {
            this.recordInputHistoryEntry(consumed.content);
            await this.submitChatMessage(consumed.content, {
                setButtonLoading: true,
                travel: Boolean(consumed.travel),
                travelMetadata: consumed.travelMetadata || null
            });
        } catch (error) {
            this.addMessage('system', `Redo failed to submit: ${error.message || error}`, true);
        } finally {
            this.pendingRedoInProgress = false;
        }
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
            try {
                await window.refreshStoryTools?.({ preserveSelection: true });
            } catch (refreshError) {
                console.debug('Story Tools refresh skipped after edit:', refreshError);
            }
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
            try {
                await window.refreshStoryTools?.({ preserveSelection: true });
            } catch (refreshError) {
                console.debug('Story Tools refresh skipped after delete:', refreshError);
            }
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
        window.refreshStoryTools?.({ preserveSelection: true });
        try {
            window.refreshQuestPanel?.();
        } catch (error) {
            console.debug('Quest panel refresh skipped:', error);
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

    resolveChatCompletionSoundSource(rawPath) {
        if (rawPath === null || rawPath === false || typeof rawPath === 'undefined') {
            return null;
        }
        if (typeof rawPath !== 'string') {
            console.warn('Ignoring invalid chat completion sound path value from server.');
            return null;
        }

        const trimmed = rawPath.trim();
        if (!trimmed) {
            return null;
        }

        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }

        return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    }

    playChatCompletionSound(rawPath) {
        const source = this.resolveChatCompletionSoundSource(rawPath);
        if (!source) {
            return;
        }

        if (!this.chatCompletionAudio || this.chatCompletionAudioSource !== source) {
            this.chatCompletionAudio = new Audio(source);
            this.chatCompletionAudio.preload = 'auto';
            this.chatCompletionAudioSource = source;
        }

        try {
            this.chatCompletionAudio.currentTime = 0;
            const playResult = this.chatCompletionAudio.play();
            if (playResult && typeof playResult.catch === 'function') {
                playResult.catch((error) => {
                    console.warn('Failed to play chat completion sound:', error?.message || error);
                });
            }
        } catch (error) {
            console.warn('Failed to play chat completion sound:', error?.message || error);
        }
    }

    setTravelCompletionSoundSource(context, rawPath) {
        if (!context) {
            return null;
        }
        const source = this.resolveChatCompletionSoundSource(rawPath);
        if (!source) {
            return null;
        }
        context.travelCompletionSoundSource = source;
        return source;
    }

    queueDeferredTravelCompletionSound(source) {
        if (!source) {
            return;
        }
        this.deferredTravelCompletionSoundQueue.push(source);
        if (!this.awaitingDeferredTravelCompletionSound) {
            return;
        }
        const nextSound = this.deferredTravelCompletionSoundQueue.shift();
        this.awaitingDeferredTravelCompletionSound = false;
        if (nextSound) {
            this.playChatCompletionSound(nextSound);
        }
    }

    playDeferredTravelCompletionSound({ waitForNext = false } = {}) {
        const nextSound = this.deferredTravelCompletionSoundQueue.shift();
        if (nextSound) {
            this.awaitingDeferredTravelCompletionSound = false;
            this.playChatCompletionSound(nextSound);
            return true;
        }
        this.awaitingDeferredTravelCompletionSound = Boolean(waitForNext);
        return false;
    }

    tryPlayTravelCompletionSound(context) {
        if (!context || !context.isTravelRequest || context.travelCompletionPlayed) {
            return false;
        }
        if (!context.travelCompletionReady) {
            return false;
        }
        const source = context.travelCompletionSoundSource;
        if (!source) {
            return false;
        }
        this.playChatCompletionSound(source);
        context.travelCompletionPlayed = true;
        return true;
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
            case 'prompt_progress':
                this.handlePromptProgress(payload);
                break;
            case 'prompt_progress_cleared':
                this.handlePromptProgressCleared(payload);
                break;
            case 'quest_confirmation_request':
                this.handleQuestConfirmationRequest(payload);
                break;
            default:
                console.log('Realtime update:', payload);
                break;
        }
    }

    bindPromptProgressOverlayInteractions(overlay, header, toggleButton) {
        if (!overlay || !header || overlay.dataset.dragBound === 'true') {
            return;
        }

        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

        const onPointerMove = (event) => {
            if (!this.promptProgressDragState.active || event.pointerId !== this.promptProgressDragState.pointerId) {
                return;
            }
            const overlayRect = overlay.getBoundingClientRect();
            const maxLeft = Math.max(0, window.innerWidth - overlayRect.width);
            const maxTop = Math.max(0, window.innerHeight - overlayRect.height);
            const targetLeft = clamp(event.clientX - this.promptProgressDragState.offsetX, 0, maxLeft);
            const targetTop = clamp(event.clientY - this.promptProgressDragState.offsetY, 0, maxTop);
            overlay.style.left = `${targetLeft}px`;
            overlay.style.top = `${targetTop}px`;
            overlay.style.right = 'auto';
            overlay.classList.add('is-dragging');
        };

        const stopDragging = (event) => {
            if (!this.promptProgressDragState.active) {
                return;
            }
            if (event && event.pointerId !== undefined && event.pointerId !== this.promptProgressDragState.pointerId) {
                return;
            }
            this.promptProgressDragState.active = false;
            this.promptProgressDragState.pointerId = null;
            overlay.classList.remove('is-dragging');
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', stopDragging);
            window.removeEventListener('pointercancel', stopDragging);
        };

        header.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) {
                return;
            }
            if (toggleButton && toggleButton.contains(event.target)) {
                return;
            }
            if (event.target && event.target.closest('.prompt-progress-overlay__actions')) {
                return;
            }
            const rect = overlay.getBoundingClientRect();
            this.promptProgressDragState.active = true;
            this.promptProgressDragState.pointerId = event.pointerId;
            this.promptProgressDragState.offsetX = event.clientX - rect.left;
            this.promptProgressDragState.offsetY = event.clientY - rect.top;
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', stopDragging);
            window.addEventListener('pointercancel', stopDragging);
            event.preventDefault();
        });

        overlay.dataset.dragBound = 'true';
    }

    renderPromptProgress(entries = []) {
        if (!Array.isArray(entries)) {
            return;
        }

        const tableHeaderHtml = '<tr><th class="prompt-progress-cancel-header">Actions</th><th>Prompt</th><th>Model</th><th>Bytes</th><th>Seconds</th><th>Timeout In</th><th>Latency</th><th>Avg B/s</th><th>Retries</th></tr>';
        const renderTimestamp = () => new Date().toISOString().replace('T', ' ').replace('Z', '');

        if (!entries.length) {
            if (this.promptProgressMessage) {
                const contentDiv = this.promptProgressMessage.querySelector('.prompt-progress-overlay__content');
                if (contentDiv) {
                    const emptyTable = document.createElement('table');
                    emptyTable.className = 'prompt-progress-table';
                    const emptyHead = document.createElement('thead');
                    emptyHead.innerHTML = tableHeaderHtml;
                    const emptyBody = document.createElement('tbody');
                    const placeholderRow = document.createElement('tr');
                    placeholderRow.className = 'prompt-progress-placeholder-row';
                    placeholderRow.setAttribute('hidden', '');
                    placeholderRow.setAttribute('aria-hidden', 'true');
                    emptyBody.appendChild(placeholderRow);
                    emptyTable.appendChild(emptyHead);
                    emptyTable.appendChild(emptyBody);
                    const emptyWrap = document.createElement('div');
                    emptyWrap.className = 'prompt-progress-table-wrap';
                    emptyWrap.appendChild(emptyTable);
                    contentDiv.innerHTML = '';
                    contentDiv.appendChild(emptyWrap);
                }
                if (!this.promptProgressHideTimer) {
                    this.promptProgressHideTimer = setTimeout(() => {
                        if (!this.promptProgressMessage) {
                            this.promptProgressHideTimer = null;
                            return;
                        }
                        const livePlaceholderRow = this.promptProgressMessage.querySelector('tr.prompt-progress-placeholder-row');
                        if (livePlaceholderRow && livePlaceholderRow.parentNode) {
                            livePlaceholderRow.parentNode.removeChild(livePlaceholderRow);
                        }
                        this.promptProgressHideTimer = null;
                    }, 3500);
                }
            }
            return;
        }

        if (this.promptProgressHideTimer) {
            clearTimeout(this.promptProgressHideTimer);
            this.promptProgressHideTimer = null;
        }

        const formatBytes = (value) => {
            if (!Number.isFinite(value)) return '-';
            return value.toLocaleString();
        };

        const table = document.createElement('table');
        table.className = 'prompt-progress-table';
        const thead = document.createElement('thead');
        thead.innerHTML = tableHeaderHtml;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        entries.forEach(entry => {
            const row = document.createElement('tr');
            const cancelCell = document.createElement('td');
            const actionWrap = document.createElement('div');
            actionWrap.className = 'prompt-progress-actions';
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.className = 'prompt-progress-cancel prompt-progress-action';
            cancelButton.textContent = '🗙';
            cancelButton.setAttribute('aria-label', `Cancel prompt ${entry.label || 'prompt'}`);
            cancelButton.title = 'Cancel prompt';
            const retryButton = document.createElement('button');
            retryButton.type = 'button';
            retryButton.className = 'prompt-progress-retry prompt-progress-action';
            retryButton.textContent = '⟳';
            retryButton.setAttribute('aria-label', `Retry prompt ${entry.label || 'prompt'}`);
            retryButton.title = 'Retry prompt attempt';
            if (!entry.id) {
                cancelButton.disabled = true;
                retryButton.disabled = true;
            } else {
                cancelButton.addEventListener('click', () => {
                    this.cancelPromptProgress(entry.id, entry.label || 'prompt', {
                        cancelButton,
                        retryButton,
                        row
                    });
                });
                retryButton.addEventListener('click', () => {
                    this.retryPromptProgress(entry.id, entry.label || 'prompt', {
                        cancelButton,
                        retryButton,
                        row
                    });
                });
            }
            actionWrap.appendChild(cancelButton);
            actionWrap.appendChild(retryButton);
            cancelCell.appendChild(actionWrap);
            const labelCell = document.createElement('td');
            labelCell.textContent = entry.label || 'prompt';
            const modelCell = document.createElement('td');
            modelCell.textContent = entry.model || '-';
            const bytesCell = document.createElement('td');
            bytesCell.textContent = formatBytes(Number(entry.bytes));
            const secondsCell = document.createElement('td');
            secondsCell.textContent = Number.isFinite(entry.seconds) ? `${Math.round(entry.seconds)}s` : '-';
            const timeoutCell = document.createElement('td');
            timeoutCell.textContent = Number.isFinite(entry.timeoutSeconds) ? `${Math.max(0, Math.round(entry.timeoutSeconds))}s` : '-';
            const latencyCell = document.createElement('td');
            latencyCell.textContent = Number.isFinite(entry.latencyMs) ? `${(entry.latencyMs / 1000).toFixed(1)}s` : '-';
            const avgCell = document.createElement('td');
            avgCell.textContent = Number.isFinite(entry.avgBps) ? `${entry.avgBps}` : '-';
            const retryCell = document.createElement('td');
            retryCell.textContent = Number.isFinite(entry.retries) ? `${entry.retries}` : '0';
            row.appendChild(cancelCell);
            row.appendChild(labelCell);
            row.appendChild(modelCell);
            row.appendChild(bytesCell);
            row.appendChild(secondsCell);
            row.appendChild(timeoutCell);
            row.appendChild(latencyCell);
            row.appendChild(avgCell);
            row.appendChild(retryCell);
            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        const tableWrap = document.createElement('div');
        tableWrap.className = 'prompt-progress-table-wrap';
        tableWrap.appendChild(table);

        if (!this.promptProgressMessage) {
            const overlay = document.createElement('aside');
            overlay.className = 'prompt-progress-overlay';
            overlay.setAttribute('aria-live', 'polite');
            overlay.setAttribute('aria-label', 'AI prompt activity');

            const headerDiv = document.createElement('div');
            headerDiv.className = 'prompt-progress-overlay__header';

            const metaDiv = document.createElement('div');
            metaDiv.className = 'prompt-progress-overlay__meta';

            const titleDiv = document.createElement('div');
            titleDiv.className = 'prompt-progress-overlay__title';
            titleDiv.textContent = '⏳ AI Prompts';

            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'prompt-progress-overlay__timestamp';
            timestampDiv.textContent = renderTimestamp();

            const actionDiv = document.createElement('div');
            actionDiv.className = 'prompt-progress-overlay__actions';

            const resetButton = document.createElement('button');
            resetButton.type = 'button';
            resetButton.className = 'prompt-progress-overlay__reset';
            resetButton.textContent = 'Abort + Reload';
            resetButton.title = 'Cancel all prompts and reload latest autosave';
            resetButton.setAttribute('aria-label', 'Cancel all prompts and reload latest autosave');
            resetButton.addEventListener('click', async () => {
                if (resetButton.disabled) {
                    return;
                }
                try {
                    await this.cancelAllPromptsAndLoadLatestAutosave({ triggerButton: resetButton });
                } catch (error) {
                    const message = error?.message || String(error);
                    this.addMessage('system', `Cancel/reload failed: ${message}`, true);
                }
            });

            const toggleButton = document.createElement('button');
            toggleButton.type = 'button';
            toggleButton.className = 'prompt-progress-overlay__toggle';
            toggleButton.textContent = '−';
            toggleButton.title = 'Contract prompt activity panel';
            toggleButton.setAttribute('aria-label', 'Contract prompt activity panel');
            toggleButton.setAttribute('aria-expanded', 'true');
            toggleButton.addEventListener('click', () => {
                const contracted = overlay.classList.toggle('is-contracted');
                toggleButton.textContent = contracted ? '+' : '−';
                toggleButton.title = contracted ? 'Expand prompt activity panel' : 'Contract prompt activity panel';
                toggleButton.setAttribute('aria-label', toggleButton.title);
                toggleButton.setAttribute('aria-expanded', contracted ? 'false' : 'true');
            });

            const contentDiv = document.createElement('div');
            contentDiv.className = 'prompt-progress-overlay__content';
            contentDiv.appendChild(tableWrap);

            metaDiv.appendChild(titleDiv);
            metaDiv.appendChild(timestampDiv);
            headerDiv.appendChild(metaDiv);
            actionDiv.appendChild(resetButton);
            actionDiv.appendChild(toggleButton);
            headerDiv.appendChild(actionDiv);
            overlay.appendChild(headerDiv);
            overlay.appendChild(contentDiv);
            this.bindPromptProgressOverlayInteractions(overlay, headerDiv, toggleButton);
            document.body.appendChild(overlay);
            this.promptProgressMessage = overlay;
        } else {
            if (!this.promptProgressMessage.isConnected) {
                document.body.appendChild(this.promptProgressMessage);
            }
            const contentDiv = this.promptProgressMessage.querySelector('.prompt-progress-overlay__content');
            if (contentDiv) {
                contentDiv.innerHTML = '';
                contentDiv.appendChild(tableWrap);
            }
            const tsDiv = this.promptProgressMessage.querySelector('.prompt-progress-overlay__timestamp');
            if (tsDiv) {
                tsDiv.textContent = renderTimestamp();
            }
        }
    }

    setPromptProgressActionState({ cancelButton = null, retryButton = null, row = null, isPending = false } = {}) {
        if (cancelButton) {
            cancelButton.disabled = isPending;
        }
        if (retryButton) {
            retryButton.disabled = isPending;
        }
        if (row) {
            row.classList.toggle('prompt-progress-canceling', isPending);
        }
    }

    async cancelPromptProgress(promptId, label, { cancelButton = null, retryButton = null, row = null } = {}) {
        const resolvedId = typeof promptId === 'string' ? promptId.trim() : '';
        if (!resolvedId) {
            return;
        }
        this.setPromptProgressActionState({ cancelButton, retryButton, row, isPending: true });
        try {
            const response = await fetch(`/api/prompts/${encodeURIComponent(resolvedId)}/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.warn(`Failed to cancel prompt ${label || resolvedId}:`, error);
            this.setPromptProgressActionState({ cancelButton, retryButton, row, isPending: false });
        }
    }

    async retryPromptProgress(promptId, label, { cancelButton = null, retryButton = null, row = null } = {}) {
        const resolvedId = typeof promptId === 'string' ? promptId.trim() : '';
        if (!resolvedId) {
            return;
        }
        this.setPromptProgressActionState({ cancelButton, retryButton, row, isPending: true });
        try {
            const response = await fetch(`/api/prompts/${encodeURIComponent(resolvedId)}/retry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
        } catch (error) {
            console.warn(`Failed to retry prompt ${label || resolvedId}:`, error);
            this.setPromptProgressActionState({ cancelButton, retryButton, row, isPending: false });
        }
    }

    async handlePromptProgressCleared(payload) {
        // Remove any existing prompt progress UI and refresh adventure tab sections without a full reload.
        this.renderPromptProgress([]);

        const refreshTasks = [];

        try {
            refreshTasks.push(this.refreshChatHistory());
        } catch (error) {
            console.warn('Failed to queue chat history refresh after prompt clear:', error);
        }

        try {
            refreshTasks.push(this.checkLocationUpdate());
        } catch (error) {
            console.warn('Failed to queue location refresh after prompt clear:', error);
        }

        try {
            if (typeof window.refreshQuestPanel === 'function') {
                refreshTasks.push(Promise.resolve(window.refreshQuestPanel()));
            }
        } catch (error) {
            console.warn('Failed to queue quest panel refresh after prompt clear:', error);
        }

        try {
            if (typeof window.refreshParty === 'function') {
                refreshTasks.push(Promise.resolve(window.refreshParty()));
            }
        } catch (error) {
            console.warn('Failed to queue party refresh after prompt clear:', error);
        }

        if (refreshTasks.length) {
            try {
                await Promise.allSettled(refreshTasks);
            } catch (error) {
                console.warn('Background section refreshes after prompt clear encountered errors:', error);
            }
        }
    }

    handlePromptProgress(payload) {
        if (!payload || typeof payload !== 'object') {
            return;
        }
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        if (payload.done && (!entries.length)) {
            this.renderPromptProgress([]);
            return;
        }
        if (entries.length) {
            if (!this.promptProgressMessage) {
                this.renderPromptProgress(entries);
                return;
            }
            this.renderPromptProgress(entries);
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
                renderedTimeTransitions: new Set(),
                streamed: {
                    playerAction: false
                },
                statusElement: null,
                httpResolved: false,
                streamComplete: false,
                streamMeta: null,
                isTravelRequest: false,
                suppressTravelCompletionSound: false,
                travelCompletionSoundSource: null,
                travelCompletionReady: false,
                travelCompletionPlayed: false
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
        this.setMessageContent(contentDiv, 'Processing...', { allowMarkdown: true });

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
                this.setMessageContent(contentDiv, message, { allowMarkdown: true });
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

    setMessageInputValue(value) {
        if (!this.messageInput) {
            return;
        }
        this.messageInput.value = value;
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
        if (typeof this.messageInput.setSelectionRange === 'function') {
            const length = this.messageInput.value.length;
            this.messageInput.setSelectionRange(length, length);
        }
    }

    recordInputHistoryEntry(value) {
        const content = typeof value === 'string' ? value : '';
        if (!content.trim()) {
            return;
        }
        this.inputHistory.push(content);
        this.inputHistoryIndex = null;
        this.inputHistoryDraft = '';
    }

    handleInputHistoryNavigation(event) {
        if (!event || !this.messageInput) {
            return false;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return false;
        }

        const key = event.key;
        if (key !== 'ArrowUp' && key !== 'ArrowDown') {
            return false;
        }

        if (!this.inputHistory.length) {
            return false;
        }

        const currentValue = this.messageInput.value || '';
        const selectionStart = this.messageInput.selectionStart ?? 0;
        const selectionEnd = this.messageInput.selectionEnd ?? 0;
        const selectionCollapsed = selectionStart === selectionEnd;
        const isSingleLine = !currentValue.includes('\n');
        const atStart = selectionStart === 0 && selectionEnd === 0;
        const atEnd = selectionStart === currentValue.length && selectionEnd === currentValue.length;

        if (key === 'ArrowUp') {
            if (!(atStart || (isSingleLine && selectionCollapsed))) {
                return false;
            }
            event.preventDefault();
            if (this.inputHistoryIndex === null) {
                this.inputHistoryDraft = currentValue;
                this.inputHistoryIndex = this.inputHistory.length - 1;
            } else if (this.inputHistoryIndex > 0) {
                this.inputHistoryIndex -= 1;
            }
            const nextValue = this.inputHistory[this.inputHistoryIndex] ?? '';
            this.setMessageInputValue(nextValue);
            return true;
        }

        if (key === 'ArrowDown') {
            if (!(atEnd || (isSingleLine && selectionCollapsed))) {
                return false;
            }
            if (this.inputHistoryIndex === null) {
                return false;
            }
            event.preventDefault();
            if (this.inputHistoryIndex < this.inputHistory.length - 1) {
                this.inputHistoryIndex += 1;
                const nextValue = this.inputHistory[this.inputHistoryIndex] ?? '';
                this.setMessageInputValue(nextValue);
            } else {
                this.inputHistoryIndex = null;
                this.setMessageInputValue(this.inputHistoryDraft || '');
            }
            return true;
        }

        return false;
    }

    bindEvents() {
        this.sendButton.addEventListener('click', () => this.sendMessage());

        if (this.prefixHelpLink) {
            this.prefixHelpLink.addEventListener('click', (event) => {
                event.preventDefault();
                this.openPrefixHelpModal();
            });
        }

        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.messageInput.addEventListener('keydown', (event) => {
            this.handleInputHistoryNavigation(event);
        });

        // Auto-resize textarea
        this.messageInput.addEventListener('input', () => {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
            if (this.inputHistoryIndex === null) {
                this.inputHistoryDraft = this.messageInput.value;
            }
        });

        document.addEventListener('keydown', (event) => {
            if (!event || typeof event.key !== 'string') {
                return;
            }

            if (event.key === 'Escape' && this.isPrefixHelpModalOpen()) {
                event.preventDefault();
                this.closePrefixHelpModal();
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
        const allowMarkdown = options.allowMarkdown !== false;
        const disableMarkdown = sender === 'user'
            && typeof content === 'string'
            && content.charAt(0) === '#';
        this.setMessageContent(contentDiv, content, { allowMarkdown: allowMarkdown && !disableMarkdown });

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
        messageDiv.className = 'message ai-message';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = `🧑 ${npcName || 'NPC'}`;

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

    addStatusSummary(icon, summaryText) {
        if (!summaryText) {
            return;
        }

        if (this.pushStatusBundleItem(icon || '🌀', summaryText)) {
            return;
        }

        this.renderStandaloneStatusSummary(icon, summaryText);
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
        this.setMessageContent(contentDiv, summaryText, { allowMarkdown: true });

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
        this.setMessageContent(contentDiv, summaryText, { allowMarkdown: true });

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
        this.setMessageContent(contentDiv, summaryMessage, { allowMarkdown: true });

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

    addDispositionChanges(changes) {
        if (!Array.isArray(changes) || !changes.length) {
            return;
        }

        const items = changes.filter(Boolean);
        if (!items.length) {
            return;
        }

        const toSummaryText = (change) => {
            const npcName = change.npcName || change.name || 'Someone';
            const typeLabel = change.typeLabel || change.typeKey || 'Disposition';
            const deltaRaw = Number(change.delta);
            const previousRaw = Number(change.previousValue);
            const newRaw = Number(change.newValue);
            const delta = Number.isFinite(deltaRaw)
                ? deltaRaw
                : (Number.isFinite(newRaw) && Number.isFinite(previousRaw)
                    ? (newRaw - previousRaw)
                    : 0);
            if (!delta) {
                return '';
            }

            const sign = delta > 0 ? '+' : '';
            const beforeText = change.before ? String(change.before).trim() : '';
            const afterText = change.after ? String(change.after).trim() : '';
            let summary = `${npcName}'s ${typeLabel} disposition Δ ${sign}${Math.round(delta)}`;
            if (beforeText || afterText) {
                summary += ` (${beforeText || '?'} -> ${afterText || '?'})`;
            }
            const reason = change.reason ? String(change.reason).trim() : '';
            if (reason) {
                summary += ` - ${reason}`;
            }
            return summary;
        };

        if (this.activeEventBundle) {
            items.forEach(change => {
                const summary = toSummaryText(change);
                if (summary) {
                    this.addEventSummary('💞', summary);
                }
            });
            this.markEventBundleRefresh();
            return;
        }

        const lines = items
            .map(toSummaryText)
            .filter(Boolean)
            .join('\n');
        if (!lines) {
            return;
        }
        this.renderStandaloneEventSummary('💞', lines);
    }

    addFactionReputationChanges(changes) {
        if (!Array.isArray(changes) || !changes.length) {
            return;
        }

        const items = changes.filter(Boolean);
        if (!items.length) {
            return;
        }

        const toSummaryText = (change) => {
            const beforeRaw = Number(change.before);
            const afterRaw = Number(change.after);
            const amountRaw = Number(change.amount);
            const amount = Number.isFinite(amountRaw)
                ? amountRaw
                : (Number.isFinite(afterRaw) && Number.isFinite(beforeRaw)
                    ? (afterRaw - beforeRaw)
                    : 0);
            if (!amount) {
                return '';
            }

            const factionName = change.factionName || change.factionId || 'a faction';
            const sign = amount > 0 ? '+' : '';
            let summary = `Reputation with ${factionName} ${sign}${Math.round(amount)}`;
            if (Number.isFinite(afterRaw)) {
                summary += ` (now ${Math.round(afterRaw)})`;
            }
            const reason = change.reason ? String(change.reason).trim() : '';
            if (reason) {
                summary += ` - ${reason}`;
            }
            return summary;
        };

        if (this.activeEventBundle) {
            items.forEach(change => {
                const summary = toSummaryText(change);
                if (summary) {
                    this.addEventSummary('🏳️', summary);
                }
            });
            this.markEventBundleRefresh();
            return;
        }

        const lines = items
            .map(toSummaryText)
            .filter(Boolean)
            .join('\n');
        if (!lines) {
            return;
        }
        this.renderStandaloneEventSummary('🏳️', lines);
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
            let travelledTo = new Set();
            entries.forEach((location) => {
                const destination = safeItem(location, 'a new location');

                if (!travelledTo.has(destination)) {
                    this.addEventSummary('🚶', `Travelled to ${destination}.`);
                }
                travelledTo.add(destination);
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
                    const sourceName = safeItem(entry?.source, '');
                    const fromClause = sourceName ? ` from ${sourceName}` : '';
                    this.addEventSummary('🌾', `${actor} harvested ${itemName}${fromClause}.`);
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
                        this.addStatusSummary('🌀', `${entity} gained status: "${description}".`);
                    } else if (action === 'lost') {
                        this.addStatusSummary('🌀', `${entity} lost status: "${description}".`);
                    } else if (action) {
                        this.addStatusSummary('🌀', `${entity} ${action} status: "${description}".`);
                    } else {
                        this.addStatusSummary('🌀', `${entity} changed status: "${description}".`);
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
        this.setMessageContent(contentDiv, summaryText, { allowMarkdown: true });

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

    renderStandaloneStatusSummary(icon, summaryText) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message status-summary';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = `${icon || '🌀'} Status Change`;

        const contentDiv = document.createElement('div');
        this.setMessageContent(contentDiv, summaryText, { allowMarkdown: true });

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

    pushStatusBundleItem(icon, text) {
        if (!this.activeStatusBundle) {
            return false;
        }
        if (!text) {
            return true;
        }
        this.activeStatusBundle.items.push({
            icon: icon || '•',
            text
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

    startStatusBundle() {
        if (this.activeStatusBundle) {
            return this.activeStatusBundle;
        }
        this.activeStatusBundle = {
            items: [],
            timestamp: new Date().toISOString()
        };
        return this.activeStatusBundle;
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
            li.appendChild(document.createTextNode(' '));
            const textSpan = document.createElement('span');
            textSpan.className = 'event-summary-text';
            this.setMessageContent(textSpan, item.text, { allowMarkdown: true });
            li.appendChild(textSpan);
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

    flushStatusBundle() {
        const bundle = this.activeStatusBundle;
        this.activeStatusBundle = null;
        if (!bundle) {
            return;
        }

        if (!bundle.items.length) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message status-summary-batch';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🌀 Status Changes';

        const contentDiv = document.createElement('div');
        const list = document.createElement('ul');
        list.className = 'event-summary-list';

        bundle.items.forEach(item => {
            const li = document.createElement('li');
            const iconSpan = document.createElement('span');
            iconSpan.className = 'event-summary-icon';
            iconSpan.textContent = item.icon || '•';
            li.appendChild(iconSpan);
            li.appendChild(document.createTextNode(' '));
            const textSpan = document.createElement('span');
            textSpan.className = 'event-summary-text';
            this.setMessageContent(textSpan, item.text, { allowMarkdown: true });
            li.appendChild(textSpan);
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

    addSlopRemovalMessage(slopRemoval) {
        const normalized = this.normalizeSlopRemovalPayload(slopRemoval);
        if (!normalized.slopWords.length && !normalized.slopNgrams.length) {
            return;
        }

        const attached = this.attachInsightToLatestMessage('slop-remover', {
            slopRemoval: normalized
        });
        if (attached) {
            return;
        }

        const timestamp = new Date().toISOString();
        const messageDiv = this.buildSlopRemovalMessageElement({ data: normalized, timestamp });
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

    buildSlopRemovalMessageElement({ data, timestamp }) {
        const markup = this.renderSlopRemovalMarkup(data);
        if (!markup) {
            return null;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message slop-remover-message';
        messageDiv.dataset.type = 'slop-remover';
        messageDiv.dataset.timestamp = timestamp || '';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🧹 Slop Remover';

        const contentDiv = document.createElement('div');
        const details = document.createElement('details');
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = 'Slop Remover';
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

    createSlopRemovalEntryElement(entry) {
        if (!entry || typeof entry.slopRemoval !== 'object') {
            return null;
        }
        const normalized = this.normalizeSlopRemovalPayload(entry.slopRemoval);
        return this.buildSlopRemovalMessageElement({ data: normalized, timestamp: entry.timestamp });
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
            if (typeof attacker.attackSkill.levelBonus === 'number' && attacker.attackSkill.levelBonus !== 0) {
                const levelText = formatSigned(attacker.attackSkill.levelBonus) ?? attacker.attackSkill.levelBonus;
                parts.push(`(Level bonus ${levelText})`);
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
            if (typeof defenseSkill.levelBonus === 'number' && defenseSkill.levelBonus !== 0) {
                const levelText = formatSigned(defenseSkill.levelBonus) ?? defenseSkill.levelBonus;
                defenceSegments.push(`(Level bonus ${levelText})`);
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
                const defenseSkill = difficulty.defenseSkill;
                const defenseSegments = [this.escapeHtml(String(defenseSkill.name))];

                if (typeof defenseSkill.value === 'number' && !Number.isNaN(defenseSkill.value)) {
                    const modifier = formatSigned(defenseSkill.value);
                    defenseSegments.push(modifier !== null ? modifier : String(defenseSkill.value));
                }
                if (typeof defenseSkill.levelBonus === 'number' && defenseSkill.levelBonus !== 0) {
                    const levelText = formatSigned(defenseSkill.levelBonus) ?? defenseSkill.levelBonus;
                    defenseSegments.push(`(Level bonus ${levelText})`);
                }

                const rawValueAvailable = typeof defenseSkill.rawValue === 'number' && !Number.isNaN(defenseSkill.rawValue);
                const capValue = typeof defenseSkill.cap === 'number' && !Number.isNaN(defenseSkill.cap)
                    ? defenseSkill.cap
                    : null;
                const wasCapped = rawValueAvailable
                    && typeof defenseSkill.value === 'number'
                    && !Number.isNaN(defenseSkill.value)
                    && defenseSkill.rawValue !== defenseSkill.value;

                if (wasCapped) {
                    const rawText = formatSigned(defenseSkill.rawValue) ?? String(defenseSkill.rawValue);
                    const capText = capValue !== null
                        ? (formatSigned(capValue) ?? String(capValue))
                        : null;
                    const levelText = typeof difficulty.defenderLevel === 'number'
                        ? `5 + Lvl ${difficulty.defenderLevel}`
                        : null;
                    const capDetails = [];
                    if (capText !== null) {
                        capDetails.push(`cap ${capText}`);
                    }
                    if (levelText) {
                        capDetails.push(levelText);
                    }
                    const capTrail = capDetails.length ? `; ${capDetails.join(' • ')}` : '';
                    defenseSegments.push(`(capped from ${rawText}${capTrail})`);
                }

                diffParts.push(`Best Defense: ${defenseSegments.join(' ')}`);
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
                let skillText = `${skillName}${modifier !== null ? modifier : roll.attackSkill.value}`;
                const skillMods = Array.isArray(roll.attackSkill.modifiers) ? roll.attackSkill.modifiers : [];
                if (skillMods.length) {
                    const modDetails = skillMods
                        .map(entry => {
                            const label = entry?.effectName ? String(entry.effectName) : 'Status Effect';
                            const mod = formatSigned(entry?.modifier);
                            return mod ? `${mod} (${this.escapeHtml(label)})` : null;
                        })
                        .filter(Boolean);
                    if (modDetails.length) {
                        skillText += `<br><small>${modDetails.join('<br>')}</small>`;
                    }
                }
                if (typeof roll.attackSkill.levelBonus === 'number' && roll.attackSkill.levelBonus !== 0) {
                    const levelText = formatSigned(roll.attackSkill.levelBonus) ?? roll.attackSkill.levelBonus;
                    skillText += `<br><small>Level bonus ${levelText}</small>`;
                }
                rollSegments.push(skillText);
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
            if (typeof damage.preEffectivenessTotal === 'number' && damage.preEffectivenessTotal !== damage.total) {
                damageParts.push(`Pre-multiplier ${damage.preEffectivenessTotal}`);
            }
            if (typeof damage.multiplier === 'number') {
                const multiplierText = formatDecimal(damage.multiplier) ?? String(damage.multiplier);
                if (typeof damage.effectiveness === 'number') {
                    damageParts.push(`Multiplier ×${multiplierText} (Effectiveness ${damage.effectiveness})`);
                } else {
                    damageParts.push(`Multiplier ×${multiplierText}`);
                }
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
                if (typeof damage.damageAttribute.levelBonus === 'number' && damage.damageAttribute.levelBonus !== 0) {
                    const levelText = formatSigned(damage.damageAttribute.levelBonus) ?? damage.damageAttribute.levelBonus;
                    parts.push(`(Level bonus ${levelText})`);
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

                if (Number.isFinite(calc.preEffectivenessDamage)
                    && Number.isFinite(calc.damageEffectivenessMultiplier)
                    && (calc.damageEffectivenessMultiplier !== 1 || Number.isFinite(calc.damageEffectiveness))) {
                    const preEffectivenessText = formatDecimal(calc.preEffectivenessDamage) ?? String(calc.preEffectivenessDamage);
                    const multiplierText = formatDecimal(calc.damageEffectivenessMultiplier) ?? String(calc.damageEffectivenessMultiplier);
                    const effectivenessText = Number.isFinite(calc.damageEffectiveness)
                        ? ` (effectiveness ${calc.damageEffectiveness})`
                        : '';

                    if (calc.damageEffectivenessMultiplier === 0.5) {
                        const scaledValue = Number(calc.preEffectivenessDamage) * calc.damageEffectivenessMultiplier;
                        const halfRounded = Math.ceil(scaledValue);
                        const halfRoundedText = formatDecimal(halfRounded) ?? String(halfRounded);
                        segments.push(`Effectiveness${effectivenessText}: ceil(${preEffectivenessText} × ${multiplierText}) = ${halfRoundedText}`);
                    } else {
                        const postEffectivenessText = Number.isFinite(calc.finalDamage)
                            ? (formatDecimal(calc.finalDamage) ?? String(calc.finalDamage))
                            : null;
                        if (postEffectivenessText !== null) {
                            segments.push(`Effectiveness${effectivenessText}: ${preEffectivenessText} × ${multiplierText} = ${postEffectivenessText}`);
                        }
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
                    } else if (calc.preventedBy === 'effectiveness') {
                        segments.push('Damage prevented: effectiveness multiplier reduced damage to zero.');
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
            return { shouldRefreshLocation: false, skipHistoryRefresh: false };
        }

        this.flushEventBundle();
        this.flushStatusBundle();
        this.startEventBundle();
        this.startStatusBundle();

        if (payload.streamMeta && context) {
            context.streamMeta = payload.streamMeta;
        }

        if (payload.worldTime && typeof payload.worldTime === 'object') {
            this.updateWorldTimeIndicator(payload.worldTime, { emitTransitions: true });
            const transitions = Array.isArray(payload.worldTime.transitions)
                ? payload.worldTime.transitions
                : [];
            if (transitions.length) {
                this.renderWorldTimeTransitions(transitions, requestId || null);
            }
        }

        let shouldRefreshLocation = false;
        let skipHistoryRefresh = Boolean(payload.skipHistoryRefresh);

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
        if (Array.isArray(payload.dispositionChanges) && payload.dispositionChanges.length) {
            this.addDispositionChanges(payload.dispositionChanges);
            shouldRefreshLocation = true;
        }
        if (Array.isArray(payload.factionReputationChanges) && payload.factionReputationChanges.length) {
            this.addFactionReputationChanges(payload.factionReputationChanges);
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
        this.flushStatusBundle();

        if (payload.plausibility) {
            this.addPlausibilityMessage(payload.plausibility);
        }

        if (payload.slopRemoval) {
            this.addSlopRemovalMessage(payload.slopRemoval);
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
        this.flushStatusBundle();

        return { shouldRefreshLocation, skipHistoryRefresh };
    }

    renderNpcTurn(requestId, turn, index = 0) {
        if (!turn || !turn.response) {
            return;
        }

        this.flushEventBundle();
        this.flushStatusBundle();
        this.startEventBundle();
        this.startStatusBundle();

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
        if (turn.slopRemoval) {
            this.addSlopRemovalMessage(turn.slopRemoval);
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
        if (Array.isArray(turn.dispositionChanges) && turn.dispositionChanges.length) {
            this.addDispositionChanges(turn.dispositionChanges);
        }
        if (Array.isArray(turn.factionReputationChanges) && turn.factionReputationChanges.length) {
            this.addFactionReputationChanges(turn.factionReputationChanges);
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
        this.flushStatusBundle();
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
        if (context?.isTravelRequest) {
            this.setTravelCompletionSoundSource(context, payload.completionSoundPath);
            if (context.suppressTravelCompletionSound) {
                const source = context.travelCompletionSoundSource;
                if (source && !context.travelCompletionPlayed) {
                    this.queueDeferredTravelCompletionSound(source);
                    context.travelCompletionPlayed = true;
                }
            } else {
                this.tryPlayTravelCompletionSound(context);
            }
        } else {
            this.playChatCompletionSound(payload.completionSoundPath);
        }
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
        if (mapTab && mapTab.classList.contains('active') && !isSelfEvent) {
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
        if (mapTab && mapTab.classList.contains('active') && !isSelfEvent) {
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

    async submitChatMessage(rawContent, { setButtonLoading = false, travel = false, travelMetadata = null, suppressTravelCompletionSound = false } = {}) {
        const content = typeof rawContent === 'string' ? rawContent : '';
        const trimmed = content.trim();
        if (!trimmed) {
            return;
        }

        const firstVisibleIndex = typeof content === 'string' ? content.search(/\S/) : -1;
        const trimmedVisibleContent = firstVisibleIndex > -1
            ? content.slice(firstVisibleIndex)
            : '';
        const isQuestionEntry = trimmedVisibleContent.startsWith('?');
        let genericMarkerLength = 0;
        let genericPromptStorageMode = null;
        if (trimmedVisibleContent.startsWith('@@@')) {
            genericMarkerLength = 3;
            genericPromptStorageMode = 'no_log';
        } else if (trimmedVisibleContent.startsWith('@@')) {
            genericMarkerLength = 2;
            genericPromptStorageMode = 'hide_base_context';
        } else if (trimmedVisibleContent.startsWith('@')) {
            genericMarkerLength = 1;
            genericPromptStorageMode = 'normal';
        }
        const isGenericPromptEntry = genericMarkerLength > 0;
        const isNoLogGenericPromptEntry = isGenericPromptEntry && genericPromptStorageMode === 'no_log';
        const normalizedUserContent = isQuestionEntry
            ? trimmedVisibleContent.slice(1).replace(/^\s+/, '')
            : (isGenericPromptEntry
                ? trimmedVisibleContent.slice(genericMarkerLength).replace(/^\s+/, '')
                : content);

        if (isNoLogGenericPromptEntry) {
            this.addMessage('user', normalizedUserContent, false);
        } else {
            const userEntry = this.normalizeLocalEntry({
                role: 'user',
                type: isQuestionEntry
                    ? 'user-question'
                    : (isGenericPromptEntry ? 'user-generic-prompt' : undefined),
                content: normalizedUserContent
            });
            this.serverHistory.push(userEntry);
            this.pruneServerHistoryIfNeeded();
            this.chatHistory = [this.systemMessage, ...this.serverHistory];
            this.renderChatHistory();
        }

        const requestMessages = (() => {
            const rawUserMessage = { role: 'user', content };
            if (isNoLogGenericPromptEntry) {
                return [...this.chatHistory, rawUserMessage];
            }

            const history = Array.isArray(this.chatHistory)
                ? [...this.chatHistory]
                : [];
            if (!history.length) {
                return [rawUserMessage];
            }

            const lastIndex = history.length - 1;
            const lastMessage = history[lastIndex];
            if (lastMessage && lastMessage.role === 'user') {
                history[lastIndex] = {
                    ...lastMessage,
                    content
                };
                return history;
            }

            return [...history, rawUserMessage];
        })();

        const requestId = this.generateRequestId();
        const context = this.ensureRequestContext(requestId);
        if (context) {
            context.isTravelRequest = Boolean(travel);
            context.suppressTravelCompletionSound = Boolean(suppressTravelCompletionSound);
            context.travelCompletionSoundSource = null;
            context.travelCompletionReady = false;
            context.travelCompletionPlayed = false;
        }

        if (setButtonLoading) {
            this.setSendButtonLoading(true);
        }

        this.showLoading(requestId);

        let shouldRefreshLocation = false;
        let finalizeMode = 'none';
        let skipHistoryRefresh = isNoLogGenericPromptEntry;

        try {
            await this.waitForWebSocketReady(1000);
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: requestMessages,
                    clientId: this.clientId,
                    requestId,
                    travel: Boolean(travel),
                    travelMetadata: travelMetadata || null
                })
            });

            const data = await response.json();
            context.httpResolved = true;
            this.setTravelCompletionSoundSource(context, data?.completionSoundPath);

            if (data.error) {
                this.hideLoading(requestId);
                this.addMessage('system', `Error: ${data.error}`, true);
                finalizeMode = 'immediate';
            } else {
                const result = this.processChatPayload(requestId, data, { fromStream: false });
                shouldRefreshLocation = result.shouldRefreshLocation || shouldRefreshLocation;
                skipHistoryRefresh = skipHistoryRefresh || Boolean(result.skipHistoryRefresh);

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

        if (context?.isTravelRequest && !context.suppressTravelCompletionSound) {
            context.travelCompletionReady = true;
            this.tryPlayTravelCompletionSound(context);
        }

        if (finalizeMode === 'immediate' || finalizeMode === 'afterRefresh') {
            this.finalizeChatRequest(requestId);
        }

        if (!skipHistoryRefresh) {
            await this.refreshChatHistory();
        }
    }

    async sendMessage() {
        const rawInput = this.messageInput.value;
        if (!rawInput || !rawInput.trim()) {
            return;
        }

        this.recordInputHistoryEntry(rawInput);
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

    async dispatchAutomatedMessage(message, { travel = false, travelMetadata = null, suppressTravelCompletionSound = false } = {}) {
        await this.submitChatMessage(message, {
            setButtonLoading: Boolean(travel),
            travel: Boolean(travel),
            travelMetadata: travelMetadata || null,
            suppressTravelCompletionSound: Boolean(suppressTravelCompletionSound)
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
