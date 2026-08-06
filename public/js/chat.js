const TURN_DIFF_CATEGORIES = new Set([
    'time',
    'travel',
    'character',
    'needs',
    'inventory',
    'npc_party',
    'quest_reward',
    'disposition',
    'faction_relationship',
    'location_world',
    'status',
    'other'
]);
const TURN_DIFF_SEVERITIES = new Set(['normal', 'important', 'critical']);

function normalizeNewExitSummaryText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim().replace(/\s+/g, ' ');
}

function normalizeNewExitSummaryComparison(value) {
    return normalizeNewExitSummaryText(value).toLowerCase();
}

function selectNewExitSummaryField(entry, keys) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(keys)) {
        return '';
    }
    for (const key of keys) {
        const text = normalizeNewExitSummaryText(entry[key]);
        if (text) {
            return text;
        }
    }
    return '';
}

function formatNewExitLocationEndpoint(locationName, regionName, currentRegionName) {
    const normalizedLocationName = normalizeNewExitSummaryText(locationName);
    if (!normalizedLocationName) {
        return '';
    }

    const normalizedRegionName = normalizeNewExitSummaryText(regionName);
    const normalizedCurrentRegionName = normalizeNewExitSummaryText(currentRegionName);
    const locationComparison = normalizeNewExitSummaryComparison(normalizedLocationName);
    const regionComparison = normalizeNewExitSummaryComparison(normalizedRegionName);
    const currentRegionComparison = normalizeNewExitSummaryComparison(normalizedCurrentRegionName);
    const shouldAppendRegion = Boolean(
        normalizedRegionName
        && regionComparison
        && regionComparison !== locationComparison
        && (!currentRegionComparison || regionComparison !== currentRegionComparison)
    );

    return shouldAppendRegion
        ? `${normalizedLocationName} (${normalizedRegionName})`
        : normalizedLocationName;
}

function decodeToolCallDebugXmlEntities(value) {
    if (typeof value !== 'string' || !value) {
        return value;
    }
    return value
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, '&');
}

function cloneToolCallDebugDisplayValue(value, { unescapeContentFields = false } = {}) {
    if (Array.isArray(value)) {
        return value.map(entry => cloneToolCallDebugDisplayValue(entry, { unescapeContentFields }));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }

    const clone = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (unescapeContentFields && key === 'content' && typeof nestedValue === 'string') {
            clone[key] = decodeToolCallDebugXmlEntities(nestedValue);
        } else {
            clone[key] = cloneToolCallDebugDisplayValue(nestedValue, { unescapeContentFields });
        }
    }
    return clone;
}

function prepareToolCallDebugSectionValue(label, value) {
    const normalizedLabel = typeof label === 'string' ? label.trim().toLowerCase() : '';
    return cloneToolCallDebugDisplayValue(value, {
        unescapeContentFields: normalizedLabel === 'result' || normalizedLabel === 'error'
    });
}

function prepareToolCallDebugSectionDisplay(label, value) {
    const normalizedLabel = typeof label === 'string' ? label.trim().toLowerCase() : '';
    const jsonValue = prepareToolCallDebugSectionValue(label, value);
    if (normalizedLabel !== 'result' && normalizedLabel !== 'error') {
        return { jsonValue, contentFields: [] };
    }

    const contentFields = [];
    const replaceContentFields = (nestedValue, pathPrefix = '') => {
        if (Array.isArray(nestedValue)) {
            return nestedValue.map((entry, index) => {
                const nextPathPrefix = pathPrefix ? `${pathPrefix}[${index}]` : `[${index}]`;
                return replaceContentFields(entry, nextPathPrefix);
            });
        }
        if (!nestedValue || typeof nestedValue !== 'object') {
            return nestedValue;
        }

        const clone = {};
        for (const [key, childValue] of Object.entries(nestedValue)) {
            const path = pathPrefix ? `${pathPrefix}.${key}` : key;
            if (key === 'content' && typeof childValue === 'string' && childValue.trim()) {
                contentFields.push({ path, content: childValue });
                clone[key] = '[shown below]';
            } else {
                clone[key] = replaceContentFields(childValue, path);
            }
        }
        return clone;
    };

    return {
        jsonValue: replaceContentFields(jsonValue),
        contentFields
    };
}

function getCurrentNewExitSummaryContext() {
    const currentLocation = window.AIRPG_LAST_LOCATION && typeof window.AIRPG_LAST_LOCATION === 'object'
        ? window.AIRPG_LAST_LOCATION
        : null;
    return {
        currentLocationName: normalizeNewExitSummaryText(currentLocation?.name || ''),
        currentRegionName: normalizeNewExitSummaryText(
            currentLocation?.regionName
            || currentLocation?.region?.name
            || currentLocation?.stubMetadata?.regionName
            || currentLocation?.stubMetadata?.targetRegionName
            || ''
        )
    };
}

function formatNewExitDiscoveredSummaryDetail(entry, {
    currentLocationName = '',
    currentRegionName = ''
} = {}) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return normalizeNewExitSummaryText(entry) || 'a new path';
    }

    const kind = selectNewExitSummaryField(entry, ['kind', 'destinationKind', 'type']).toLowerCase();
    const primaryDestinationName = selectNewExitSummaryField(entry, [
        'destinationName',
        'name',
        'targetName',
        'label',
        'text',
        'raw'
    ]);
    const destinationLocationName = selectNewExitSummaryField(entry, [
        'destinationLocationName',
        'targetLocationName'
    ]);
    let destinationRegionName = selectNewExitSummaryField(entry, [
        'destinationRegionName',
        'targetRegionName',
        'destinationRegion'
    ]);
    if (!destinationRegionName && kind === 'region') {
        destinationRegionName = primaryDestinationName;
    }

    const originLocationName = selectNewExitSummaryField(entry, [
        'exitLocationName',
        'originLocationName',
        'sourceLocationName',
        'originLocation',
        'origin'
    ]);
    const originRegionName = selectNewExitSummaryField(entry, [
        'exitRegionName',
        'originRegionName',
        'sourceRegionName',
        'originRegion'
    ]);

    let destinationDetail = '';
    if (destinationLocationName) {
        destinationDetail = formatNewExitLocationEndpoint(
            destinationLocationName,
            destinationRegionName,
            currentRegionName
        );
    } else if (kind === 'region') {
        destinationDetail = destinationRegionName || primaryDestinationName;
    } else {
        destinationDetail = formatNewExitLocationEndpoint(
            primaryDestinationName,
            destinationRegionName,
            currentRegionName
        );
    }

    if (!destinationDetail) {
        destinationDetail = primaryDestinationName || 'a new path';
    }

    const originDetail = formatNewExitLocationEndpoint(
        originLocationName,
        originRegionName,
        currentRegionName
    );
    const currentLocationComparison = normalizeNewExitSummaryComparison(currentLocationName);
    const originLocationComparison = normalizeNewExitSummaryComparison(originLocationName);
    const currentRegionComparison = normalizeNewExitSummaryComparison(currentRegionName);
    const originRegionComparison = normalizeNewExitSummaryComparison(originRegionName);
    const originMatchesCurrent = Boolean(
        currentLocationComparison
        && originLocationComparison === currentLocationComparison
        && (!originRegionComparison || !currentRegionComparison || originRegionComparison === currentRegionComparison)
    );

    return originDetail && !originMatchesCurrent
        ? `${originDetail} -> ${destinationDetail}`
        : destinationDetail;
}

function buildNewExitDiscoveredSummaryMetadata(entry, detail = '') {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }

    const destinationKind = selectNewExitSummaryField(entry, [
        'destinationKind',
        'kind',
        'type'
    ]).toLowerCase();
    const originLocationId = selectNewExitSummaryField(entry, [
        'originLocationId',
        'exitLocationId',
        'sourceLocationId'
    ]);
    const originRegionId = selectNewExitSummaryField(entry, [
        'originRegionId',
        'exitRegionId',
        'sourceRegionId'
    ]);
    const destinationId = selectNewExitSummaryField(entry, [
        'destinationId',
        'destinationLocationId',
        'targetLocationId',
        'stubId'
    ]);
    const destinationRegionId = selectNewExitSummaryField(entry, [
        'destinationRegionId',
        'targetRegionId',
        'regionId'
    ]);
    const exitId = selectNewExitSummaryField(entry, ['exitId']);

    if (!originLocationId && !originRegionId && !destinationId && !destinationRegionId && !exitId) {
        return null;
    }

    const destinationRegionName = selectNewExitSummaryField(entry, [
        'destinationRegionName',
        'targetRegionName',
        'destinationRegion'
    ]);
    const destinationLocationName = selectNewExitSummaryField(entry, [
        'destinationLocationName',
        'targetLocationName'
    ]);
    const destinationName = destinationLocationName
        || selectNewExitSummaryField(entry, ['destinationName', 'name', 'targetName'])
        || destinationRegionName;
    const originLocationName = selectNewExitSummaryField(entry, [
        'originLocationName',
        'exitLocationName',
        'sourceLocationName',
        'originLocation',
        'origin'
    ]);
    const originRegionName = selectNewExitSummaryField(entry, [
        'originRegionName',
        'exitRegionName',
        'sourceRegionName',
        'originRegion'
    ]);

    return {
        label: normalizeNewExitSummaryText(detail) || destinationName || destinationRegionName || 'New exit',
        destinationKind: destinationKind || null,
        originLocationId: originLocationId || null,
        originLocationName: originLocationName || null,
        originRegionId: originRegionId || null,
        originRegionName: originRegionName || null,
        destinationId: destinationId || null,
        destinationName: destinationName || null,
        destinationLocationName: destinationLocationName || null,
        destinationRegionId: destinationRegionId || null,
        destinationRegionName: destinationRegionName || null,
        exitId: exitId || null
    };
}

function normalizeNewExitNavigationMetadata(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
    if (!source) {
        return null;
    }
    const metadata = source.newExitDiscovered && typeof source.newExitDiscovered === 'object'
        ? source.newExitDiscovered
        : source;
    const normalized = {};
    [
        'label',
        'destinationKind',
        'originLocationId',
        'originLocationName',
        'originRegionId',
        'originRegionName',
        'destinationId',
        'destinationName',
        'destinationLocationName',
        'destinationRegionId',
        'destinationRegionName',
        'exitId'
    ].forEach(key => {
        const text = normalizeNewExitSummaryText(metadata[key]);
        normalized[key] = text || null;
    });

    if (!normalized.originRegionId && !normalized.originLocationId && !normalized.destinationId && !normalized.exitId) {
        return null;
    }

    return normalized;
}

function getNewExitPillLabel(metadata) {
    const destination = normalizeNewExitSummaryText(
        metadata?.destinationLocationName
        || metadata?.destinationName
        || metadata?.destinationRegionName
        || metadata?.label
    );
    return destination || 'Map';
}

function dispatchNewExitSummarySelected(target, metadata) {
    const normalized = normalizeNewExitNavigationMetadata(metadata);
    if (!target || !normalized) {
        return;
    }
    target.dispatchEvent(new CustomEvent('airpg:new-exit-summary-selected', {
        bubbles: true,
        detail: normalized
    }));
}

function currentChatTimestampString() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatSignedNumber(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }
    return value >= 0 ? `+${value}` : `${value}`;
}

function findNeedBarDefinition(change, resolvedBarName) {
    const definitions = Array.isArray(window.needBarDefinitions) ? window.needBarDefinitions : [];
    const barId = typeof change?.needBarId === 'string' ? change.needBarId.trim() : '';
    return definitions.find((definition) => {
        if (!definition || typeof definition !== 'object') {
            return false;
        }
        const definitionId = typeof definition.id === 'string' ? definition.id.trim() : '';
        if (definitionId && barId && definitionId === barId) {
            return true;
        }
        const definitionName = typeof definition.name === 'string' ? definition.name.trim().toLowerCase() : '';
        return Boolean(resolvedBarName && definitionName && definitionName === resolvedBarName);
    });
}

function formatCircumstanceEntryText(entry) {
    if (!entry) {
        return null;
    }
    const hasAmount = typeof entry.amount === 'number' && !Number.isNaN(entry.amount);
    const amountText = hasAmount
        ? (formatSignedNumber(entry.amount) ?? String(entry.amount))
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
}

class AIRPGChat {
    constructor() {
        this.chatLog = document.getElementById('chatLog');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.abortTurnButton = document.getElementById('abortTurnButton');
        this.prefixHelpLink = document.getElementById('prefixHelpLink');
        this.prefixHelpModal = document.getElementById('prefixHelpModal');
        this.prefixHelpCloseButton = document.getElementById('prefixHelpCloseBtn');
        this.chatBubbleFilterToggle = document.getElementById('chatBubbleFilterToggle');
        this.chatBubbleFilterPopover = document.getElementById('chatBubbleFilterPopover');
        this.chatBubbleFilterOptions = document.getElementById('chatBubbleFilterOptions');
        this.emptyActionConfirmModal = document.getElementById('emptyActionConfirmModal');
        this.emptyActionConfirmCloseButton = document.getElementById('emptyActionConfirmCloseBtn');
        this.emptyActionConfirmCancelButton = document.getElementById('emptyActionConfirmCancelBtn');
        this.emptyActionConfirmSubmitButton = document.getElementById('emptyActionConfirmSubmitBtn');
        this.slashUploadModal = document.getElementById('slashUploadModal');
        this.slashUploadTitle = document.getElementById('slashUploadTitle');
        this.slashUploadCloseButton = document.getElementById('slashUploadCloseBtn');
        this.slashUploadDescription = document.getElementById('slashUploadDescription');
        this.slashUploadFileInput = document.getElementById('slashUploadFile');
        this.slashUploadStatus = document.getElementById('slashUploadStatus');
        this.slashUploadCancelButton = document.getElementById('slashUploadCancelBtn');
        this.slashUploadSubmitButton = document.getElementById('slashUploadSubmitBtn');
        this.playerInputRequestPanel = document.getElementById('playerInputRequestPanel');
        this.playerInputRequestHeader = document.getElementById('playerInputRequestHeader');
        this.playerInputRequestTitle = document.getElementById('playerInputRequestTitle');
        this.playerInputRequestPromptLabel = document.getElementById('playerInputRequestPromptLabel');
        this.playerInputRequestQuestion = document.getElementById('playerInputRequestQuestion');
        this.playerInputRequestForm = document.getElementById('playerInputRequestForm');
        this.playerInputRequestLabel = document.querySelector('label[for="playerInputRequestAnswer"]');
        this.playerInputRequestAnswer = document.getElementById('playerInputRequestAnswer');
        this.playerInputRequestNumericAnswer = document.getElementById('playerInputRequestNumericAnswer');
        this.playerInputRequestStatus = document.getElementById('playerInputRequestStatus');
        this.playerInputRequestCloseButton = document.getElementById('playerInputRequestCloseBtn');
        this.playerInputRequestCancelButton = document.getElementById('playerInputRequestCancelBtn');
        this.playerInputRequestSubmitButton = document.getElementById('playerInputRequestSubmitBtn');
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
        this.chatBubbleFilterCookieName = 'airpg_chat_bubble_hidden_types';
        this.chatBubbleHiddenTypes = this.loadChatBubbleHiddenTypes();
        this.chatBubbleTypes = new Map();
        this.chatBubbleFilterBound = false;

        this.clientId = window.DomUtils.loadClientId();
        this.pendingRequests = new Map();
        this.ws = null;
        this.wsReconnectDelay = 1000;
        this.wsReconnectTimer = null;
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
        this.turnRollbackInProgress = false;
        this.shortDescriptionPrompted = false;
        this.pendingSlashUploadRequest = null;
        this.slashUploadSubmitting = false;
        this.playerInputRequests = new Map();
        this.playerInputRequestQueue = [];
        this.activePlayerInputRequest = null;
        this.playerInputRequestSubmitting = false;
        this.playerInputRequestDragState = {
            active: false,
            pointerId: null,
            offsetX: 0,
            offsetY: 0
        };

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
        this.setupEmptyActionConfirmModal();
        this.setupSlashUploadModal();
        this.setupPlayerInputRequestPanel();
        this.loadExistingHistory();

        window.AIRPG_CHAT = this;
        this.promptProgressDock = document.getElementById('promptProgressDock');
        this.promptProgressDockStateStorageKey = 'airpg:promptProgressDockState';
        this.promptProgressDockStates = ['collapsed', 'one-line', 'table'];
        this.promptProgressDockStateClassMap = {
            collapsed: 'prompt-progress-dock--collapsed',
            'one-line': 'prompt-progress-dock--one-line',
            table: 'prompt-progress-dock--table'
        };
        this.promptProgressModeIconPaths = {
            compress: '/assets/material-icons/misc/compress.svg',
            expand: '/assets/material-icons/misc/expand.svg'
        };
        this.promptProgressActionIconPaths = {
            view: '/assets/material-icons/misc/view_prompt.svg',
            cancel: '/assets/material-icons/misc/cancel.svg',
            restart: '/assets/material-icons/misc/restart.svg'
        };
        this.promptProgressFaviconOriginalHref = '';
        this.promptProgressFaviconOriginalSource = '';
        this.promptProgressFaviconOriginalType = '';
        this.promptProgressFaviconBaseImage = null;
        this.promptProgressFaviconBaseImagePromise = null;
        this.promptProgressFaviconUpdateToken = 0;
        this.promptProgressFaviconFillColor = '#0f3d7a';
        this.promptProgressDockState = this.loadPromptProgressDockState();
        this.promptProgressDockBound = false;
        this.promptProgressMessage = this.promptProgressDock;
        this.promptProgressEntries = [];
        this.promptProgressHideTimer = null;
        this.promptProgressRenderThrottleMs = 500;
        this.promptProgressRenderTimer = null;
        this.promptProgressPendingEntries = null;
        this.promptProgressLastRenderTs = 0;
        this.promptProgressMinTableWidth = null;
        this.promptProgressTableWrap = null;
        this.promptProgressTable = null;
        this.promptProgressTableBody = null;
        this.promptProgressDragState = {
            active: false,
            pointerId: null,
            offsetX: 0,
            offsetY: 0
        };
        this.promptProgressViewerDragState = {
            active: false,
            pointerId: null,
            viewerId: null,
            offsetX: 0,
            offsetY: 0
        };
        this.promptProgressViewerWindows = new Map();
        this.promptProgressViewerCounter = 0;
        this.worldTimeIndicator = document.getElementById('worldTimeIndicator');
        this.worldTimeIndicatorTime = document.getElementById('worldTimeIndicatorTime');
        this.worldTimeIndicatorDate = document.getElementById('worldTimeIndicatorDate');
        this.worldTimeIndicatorMeta = document.getElementById('worldTimeIndicatorMeta');
        this.worldTimeIndicatorLightLevel = document.getElementById('worldTimeIndicatorLightLevel');
        this.worldTimeIndicatorWeather = document.getElementById('worldTimeIndicatorWeather');
        this.lastWorldTimeIndicatorState = null;
        this.modalPromptProgressObserver = null;
        this.renderPromptProgress([]);
        this.setupModalPromptProgressObserver();
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

    setupEmptyActionConfirmModal() {
        if (!this.emptyActionConfirmModal) {
            return;
        }

        const cancel = () => this.closeEmptyActionConfirmModal({ refocusInput: true });
        if (this.emptyActionConfirmCloseButton) {
            this.emptyActionConfirmCloseButton.addEventListener('click', cancel);
        }
        if (this.emptyActionConfirmCancelButton) {
            this.emptyActionConfirmCancelButton.addEventListener('click', cancel);
        }
        if (this.emptyActionConfirmSubmitButton) {
            this.emptyActionConfirmSubmitButton.addEventListener('click', () => {
                this.closeEmptyActionConfirmModal({ refocusInput: false });
                this.sendMessage({ allowEmptyAction: true });
            });
        }

        this.emptyActionConfirmModal.addEventListener('click', (event) => {
            if (event.target === this.emptyActionConfirmModal) {
                cancel();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isEmptyActionConfirmModalOpen()) {
                event.preventDefault();
                cancel();
            }
        });
    }

    setupSlashUploadModal() {
        if (!this.slashUploadModal) {
            return;
        }

        if (this.slashUploadCloseButton) {
            this.slashUploadCloseButton.addEventListener('click', () => this.cancelSlashUploadModal());
        }
        if (this.slashUploadCancelButton) {
            this.slashUploadCancelButton.addEventListener('click', () => this.cancelSlashUploadModal());
        }
        if (this.slashUploadSubmitButton) {
            this.slashUploadSubmitButton.addEventListener('click', () => this.submitSlashUploadModal());
        }
        if (this.slashUploadFileInput) {
            this.slashUploadFileInput.addEventListener('change', () => {
                if (!this.slashUploadStatus) {
                    return;
                }
                if (this.slashUploadFileInput.files && this.slashUploadFileInput.files.length > 0) {
                    const count = this.slashUploadFileInput.files.length;
                    this.setSlashUploadStatus(`${count} file${count === 1 ? '' : 's'} selected.`, 'info');
                } else {
                    this.setSlashUploadStatus('', 'info');
                }
            });
        }

        this.slashUploadModal.addEventListener('click', (event) => {
            if (event.target === this.slashUploadModal && !this.slashUploadSubmitting) {
                this.cancelSlashUploadModal();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.isSlashUploadModalOpen() && !this.slashUploadSubmitting) {
                this.cancelSlashUploadModal();
            }
        });
    }

    setupPlayerInputRequestPanel() {
        if (!this.playerInputRequestPanel) {
            return;
        }
        this.bindPlayerInputRequestDrag();
        if (this.playerInputRequestForm) {
            this.playerInputRequestForm.addEventListener('submit', (event) => {
                event.preventDefault();
                this.submitPlayerInputRequest();
            });
        }
        if (this.playerInputRequestCloseButton) {
            this.playerInputRequestCloseButton.addEventListener('click', () => this.cancelActivePlayerInputRequest());
        }
        if (this.playerInputRequestCancelButton) {
            this.playerInputRequestCancelButton.addEventListener('click', () => this.cancelActivePlayerInputRequest());
        }
        if (this.playerInputRequestAnswer) {
            this.playerInputRequestAnswer.addEventListener('input', () => {
                if (this.playerInputRequestStatus) {
                    this.playerInputRequestStatus.hidden = true;
                    this.playerInputRequestStatus.textContent = '';
                }
            });
        }
        if (this.playerInputRequestNumericAnswer) {
            this.playerInputRequestNumericAnswer.addEventListener('input', () => {
                if (this.playerInputRequestStatus) {
                    this.playerInputRequestStatus.hidden = true;
                    this.playerInputRequestStatus.textContent = '';
                }
            });
        }
    }

    bindPanelDragInteractions(panel, header, {
        dragState,
        shouldIgnorePointerDown = null,
        extraMoveGuard = null,
        onDragStart = null,
        onDragMove = null,
        onDragEnd = null
    } = {}) {
        if (!panel || !header || !dragState || panel.dataset.dragBound === 'true') {
            return;
        }

        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

        const onPointerMove = (event) => {
            if (!dragState.active || event.pointerId !== dragState.pointerId) {
                return;
            }
            if (extraMoveGuard && extraMoveGuard(event)) {
                return;
            }
            const rect = panel.getBoundingClientRect();
            const maxLeft = Math.max(0, window.innerWidth - rect.width);
            const maxTop = Math.max(0, window.innerHeight - rect.height);
            const left = clamp(event.clientX - dragState.offsetX, 0, maxLeft);
            const top = clamp(event.clientY - dragState.offsetY, 0, maxTop);
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.right = 'auto';
            if (onDragMove) {
                onDragMove(panel);
            }
            panel.classList.add('is-dragging');
        };

        const stopDragging = (event) => {
            if (!dragState.active) {
                return;
            }
            if (event && event.pointerId !== undefined && event.pointerId !== dragState.pointerId) {
                return;
            }
            dragState.active = false;
            dragState.pointerId = null;
            if (onDragEnd) {
                onDragEnd();
            }
            panel.classList.remove('is-dragging');
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', stopDragging);
            window.removeEventListener('pointercancel', stopDragging);
        };

        header.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) {
                return;
            }
            if (shouldIgnorePointerDown && shouldIgnorePointerDown(event)) {
                return;
            }
            const rect = panel.getBoundingClientRect();
            dragState.active = true;
            dragState.pointerId = event.pointerId;
            if (onDragStart) {
                onDragStart(panel, event);
            }
            dragState.offsetX = event.clientX - rect.left;
            dragState.offsetY = event.clientY - rect.top;
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', stopDragging);
            window.addEventListener('pointercancel', stopDragging);
            event.preventDefault();
        });

        panel.dataset.dragBound = 'true';
    }

    bindPlayerInputRequestDrag() {
        this.bindPanelDragInteractions(this.playerInputRequestPanel, this.playerInputRequestHeader, {
            dragState: this.playerInputRequestDragState,
            shouldIgnorePointerDown: (event) => Boolean(
                event.target && event.target.closest('button, input, textarea, select, a')
            ),
            onDragMove: (panel) => {
                panel.style.transform = 'none';
                panel.dataset.dragPositioned = 'true';
            }
        });
    }

    normalizePlayerInputRequest(payload) {
        if (!payload || typeof payload !== 'object') {
            return null;
        }
        const inputRequestId = typeof payload.inputRequestId === 'string'
            ? payload.inputRequestId.trim()
            : '';
        const question = typeof payload.question === 'string'
            ? payload.question.trim()
            : '';
        if (!inputRequestId || !question) {
            return null;
        }
        return {
            inputRequestId,
            question,
            mode: payload.mode === 'confirmation'
                ? 'confirmation'
                : (payload.mode === 'integer' ? 'integer' : 'text'),
            title: typeof payload.title === 'string' && payload.title.trim()
                ? payload.title.trim()
                : null,
            confirmLabel: typeof payload.confirmLabel === 'string' && payload.confirmLabel.trim()
                ? payload.confirmLabel.trim()
                : null,
            cancelLabel: typeof payload.cancelLabel === 'string' && payload.cancelLabel.trim()
                ? payload.cancelLabel.trim()
                : null,
            requestId: typeof payload.requestId === 'string' && payload.requestId.trim()
                ? payload.requestId.trim()
                : null,
            promptLabel: typeof payload.promptLabel === 'string' && payload.promptLabel.trim()
                ? payload.promptLabel.trim()
                : 'chat'
        };
    }

    handlePlayerInputRequest(payload) {
        const request = this.normalizePlayerInputRequest(payload);
        if (!request) {
            console.warn('Received invalid player input request payload:', payload);
            return;
        }
        this.playerInputRequests.set(request.inputRequestId, request);
        if (this.activePlayerInputRequest?.inputRequestId === request.inputRequestId) {
            this.showPlayerInputRequest(request);
            return;
        }
        if (this.activePlayerInputRequest) {
            this.playerInputRequestQueue = this.playerInputRequestQueue
                .filter(entry => entry.inputRequestId !== request.inputRequestId);
            this.playerInputRequestQueue.push(request);
            return;
        }
        this.showPlayerInputRequest(request);
    }

    handlePlayerInputRequestClosed(payload) {
        const inputRequestId = typeof payload?.inputRequestId === 'string'
            ? payload.inputRequestId.trim()
            : '';
        if (!inputRequestId) {
            return;
        }
        this.playerInputRequests.delete(inputRequestId);
        this.playerInputRequestQueue = this.playerInputRequestQueue
            .filter(entry => entry.inputRequestId !== inputRequestId);
        if (this.activePlayerInputRequest?.inputRequestId === inputRequestId) {
            this.hidePlayerInputRequestPanel();
            this.showNextPlayerInputRequest();
        }
    }

    renderPlayerInputRequestQuestion(question) {
        if (!this.playerInputRequestQuestion) {
            return;
        }
        const source = typeof question === 'string' ? question.trim() : '';
        const lines = source
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
        this.playerInputRequestQuestion.replaceChildren();
        const renderedLines = lines.length ? lines : [source];
        renderedLines.forEach((line, index) => {
            const lineElement = document.createElement('div');
            lineElement.className = 'player-input-request-panel__question-line';
            if (index === 0) {
                lineElement.classList.add('player-input-request-panel__question-line--lead');
            } else if (/^enter an integer\b/i.test(line)) {
                lineElement.classList.add('player-input-request-panel__question-line--note');
            }

            const labelMatch = index > 0 ? line.match(/^([^:]{1,40}):\s*(.+)$/) : null;
            if (labelMatch) {
                const label = document.createElement('span');
                label.className = 'player-input-request-panel__question-label';
                label.textContent = `${labelMatch[1]}:`;
                const value = document.createElement('span');
                value.className = 'player-input-request-panel__question-value';
                value.textContent = labelMatch[2];
                lineElement.append(label, document.createTextNode(' '), value);
            } else {
                lineElement.textContent = line;
            }

            this.playerInputRequestQuestion.appendChild(lineElement);
        });
    }

    getActivePlayerInputRequestAnswer() {
        const request = this.activePlayerInputRequest;
        const input = request?.mode === 'integer'
            ? this.playerInputRequestNumericAnswer
            : this.playerInputRequestAnswer;
        return input?.value?.trim() || '';
    }

    focusActivePlayerInputRequestAnswer() {
        const request = this.activePlayerInputRequest;
        const input = request?.mode === 'integer'
            ? this.playerInputRequestNumericAnswer
            : this.playerInputRequestAnswer;
        input?.focus();
    }

    showPlayerInputRequest(request) {
        if (!this.playerInputRequestPanel) {
            return;
        }
        const isConfirmation = request.mode === 'confirmation';
        const isInteger = request.mode === 'integer';
        this.activePlayerInputRequest = request;
        this.playerInputRequestSubmitting = false;
        this.playerInputRequestPanel.classList.toggle('is-confirmation', isConfirmation);
        this.playerInputRequestPanel.classList.toggle('is-integer', isInteger);
        if (this.playerInputRequestTitle) {
            this.playerInputRequestTitle.textContent = request.title || (isConfirmation ? 'Confirm Action' : 'Question from AI');
        }
        this.renderPlayerInputRequestQuestion(request.question);
        if (this.playerInputRequestPromptLabel) {
            this.playerInputRequestPromptLabel.textContent = request.promptLabel || '';
        }
        if (this.playerInputRequestAnswer) {
            this.playerInputRequestAnswer.value = '';
            this.playerInputRequestAnswer.disabled = false;
            this.playerInputRequestAnswer.hidden = isConfirmation || isInteger;
        }
        if (this.playerInputRequestNumericAnswer) {
            this.playerInputRequestNumericAnswer.value = '';
            this.playerInputRequestNumericAnswer.disabled = false;
            this.playerInputRequestNumericAnswer.hidden = isConfirmation || !isInteger;
        }
        if (this.playerInputRequestLabel) {
            this.playerInputRequestLabel.hidden = isConfirmation;
            if (!isConfirmation) {
                this.playerInputRequestLabel.textContent = isInteger ? 'Roll' : 'Answer';
                this.playerInputRequestLabel.setAttribute('for', isInteger ? 'playerInputRequestNumericAnswer' : 'playerInputRequestAnswer');
            }
        }
        if (this.playerInputRequestStatus) {
            this.playerInputRequestStatus.textContent = '';
            this.playerInputRequestStatus.hidden = true;
            this.playerInputRequestStatus.dataset.state = '';
        }
        if (this.playerInputRequestSubmitButton) {
            this.playerInputRequestSubmitButton.disabled = false;
            this.playerInputRequestSubmitButton.textContent = isConfirmation
                ? (request.confirmLabel || 'Confirm')
                : 'Submit';
        }
        if (this.playerInputRequestCancelButton) {
            this.playerInputRequestCancelButton.disabled = false;
            this.playerInputRequestCancelButton.textContent = request.cancelLabel || 'Cancel';
        }
        this.playerInputRequestPanel.removeAttribute('hidden');
        this.playerInputRequestPanel.setAttribute('aria-hidden', 'false');
        window.setTimeout(() => {
            if (isConfirmation) {
                this.playerInputRequestSubmitButton?.focus({ preventScroll: true });
            } else if (isInteger) {
                this.playerInputRequestNumericAnswer?.focus({ preventScroll: true });
            } else {
                this.playerInputRequestAnswer?.focus({ preventScroll: true });
            }
        }, 0);
    }

    hidePlayerInputRequestPanel() {
        if (!this.playerInputRequestPanel) {
            return;
        }
        this.activePlayerInputRequest = null;
        this.playerInputRequestSubmitting = false;
        this.playerInputRequestPanel.setAttribute('hidden', '');
        this.playerInputRequestPanel.setAttribute('aria-hidden', 'true');
        this.playerInputRequestPanel.classList.remove('is-confirmation');
        this.playerInputRequestPanel.classList.remove('is-integer');
        if (this.playerInputRequestQuestion) {
            this.playerInputRequestQuestion.replaceChildren();
        }
        if (this.playerInputRequestAnswer) {
            this.playerInputRequestAnswer.value = '';
            this.playerInputRequestAnswer.disabled = false;
            this.playerInputRequestAnswer.hidden = false;
        }
        if (this.playerInputRequestNumericAnswer) {
            this.playerInputRequestNumericAnswer.value = '';
            this.playerInputRequestNumericAnswer.disabled = false;
            this.playerInputRequestNumericAnswer.hidden = true;
        }
        if (this.playerInputRequestLabel) {
            this.playerInputRequestLabel.hidden = false;
            this.playerInputRequestLabel.textContent = 'Answer';
            this.playerInputRequestLabel.setAttribute('for', 'playerInputRequestAnswer');
        }
        if (this.playerInputRequestTitle) {
            this.playerInputRequestTitle.textContent = 'Question from AI';
        }
        if (this.playerInputRequestSubmitButton) {
            this.playerInputRequestSubmitButton.textContent = 'Submit';
        }
        if (this.playerInputRequestCancelButton) {
            this.playerInputRequestCancelButton.textContent = 'Cancel';
        }
    }

    showNextPlayerInputRequest() {
        while (this.playerInputRequestQueue.length) {
            const next = this.playerInputRequestQueue.shift();
            if (next && this.playerInputRequests.has(next.inputRequestId)) {
                this.showPlayerInputRequest(next);
                return;
            }
        }
    }

    setPlayerInputRequestStatus(message, state = 'info') {
        if (!this.playerInputRequestStatus) {
            return;
        }
        this.playerInputRequestStatus.textContent = message || '';
        this.playerInputRequestStatus.dataset.state = state || 'info';
        this.playerInputRequestStatus.hidden = !message;
    }

    async submitPlayerInputRequest() {
        const request = this.activePlayerInputRequest;
        if (!request || this.playerInputRequestSubmitting) {
            return;
        }
        if (request.mode === 'confirmation') {
            await this.sendPlayerInputRequestResponse(request, { confirmed: true });
            return;
        }
        const answer = this.getActivePlayerInputRequestAnswer();
        if (!answer) {
            this.setPlayerInputRequestStatus('Enter an answer before submitting.', 'error');
            this.focusActivePlayerInputRequestAnswer();
            return;
        }
        if (request.mode === 'integer' && !/^-?\d+$/.test(answer)) {
            this.setPlayerInputRequestStatus('Enter an integer roll.', 'error');
            this.focusActivePlayerInputRequestAnswer();
            return;
        }
        await this.sendPlayerInputRequestResponse(request, { answer });
    }

    async cancelActivePlayerInputRequest() {
        const request = this.activePlayerInputRequest;
        if (!request || this.playerInputRequestSubmitting) {
            return;
        }
        await this.sendPlayerInputRequestResponse(request, { cancelled: true });
    }

    async sendPlayerInputRequestResponse(request, { answer = '', cancelled = false, confirmed = false } = {}) {
        if (!request || !request.inputRequestId) {
            return;
        }
        this.playerInputRequestSubmitting = true;
        if (this.playerInputRequestSubmitButton) {
            this.playerInputRequestSubmitButton.disabled = true;
        }
        if (this.playerInputRequestCancelButton) {
            this.playerInputRequestCancelButton.disabled = true;
        }
        if (this.playerInputRequestAnswer) {
            this.playerInputRequestAnswer.disabled = true;
        }
        if (this.playerInputRequestNumericAnswer) {
            this.playerInputRequestNumericAnswer.disabled = true;
        }
        this.setPlayerInputRequestStatus(cancelled ? 'Cancelling...' : (confirmed ? 'Confirming...' : 'Submitting...'));
        try {
            const response = await fetch('/api/chat/user-input-response', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inputRequestId: request.inputRequestId,
                    requestId: request.requestId || null,
                    clientId: this.clientId,
                    answer,
                    confirmed: Boolean(confirmed),
                    cancelled: Boolean(cancelled)
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.success) {
                throw new Error(data?.error || `HTTP ${response.status}`);
            }
            this.handlePlayerInputRequestClosed({
                inputRequestId: request.inputRequestId
            });
        } catch (error) {
            this.playerInputRequestSubmitting = false;
            if (this.playerInputRequestSubmitButton) {
                this.playerInputRequestSubmitButton.disabled = false;
            }
            if (this.playerInputRequestCancelButton) {
                this.playerInputRequestCancelButton.disabled = false;
            }
            if (this.playerInputRequestAnswer) {
                this.playerInputRequestAnswer.disabled = false;
            }
            if (this.playerInputRequestNumericAnswer) {
                this.playerInputRequestNumericAnswer.disabled = false;
            }
            this.setPlayerInputRequestStatus(`Failed: ${error.message || error}`, 'error');
        }
    }

    isPrefixHelpModalOpen() {
        return Boolean(this.prefixHelpModal && !this.prefixHelpModal.hasAttribute('hidden'));
    }

    isEmptyActionConfirmModalOpen() {
        return Boolean(this.emptyActionConfirmModal && !this.emptyActionConfirmModal.hasAttribute('hidden'));
    }

    isSlashUploadModalOpen() {
        return Boolean(this.slashUploadModal && !this.slashUploadModal.hasAttribute('hidden'));
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

    openEmptyActionConfirmModal() {
        if (!this.emptyActionConfirmModal) {
            return;
        }
        this.emptyActionConfirmModal.removeAttribute('hidden');
        this.emptyActionConfirmModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
        window.setTimeout(() => {
            this.emptyActionConfirmSubmitButton?.focus();
        }, 0);
    }

    closeEmptyActionConfirmModal({ refocusInput = false } = {}) {
        if (!this.emptyActionConfirmModal) {
            return;
        }
        this.emptyActionConfirmModal.setAttribute('hidden', '');
        this.emptyActionConfirmModal.setAttribute('aria-hidden', 'true');
        this.syncBodyModalOpenClass();
        if (refocusInput) {
            this.messageInput?.focus();
        }
    }

    setSlashUploadStatus(message = '', variant = 'info') {
        if (!this.slashUploadStatus) {
            return;
        }
        const text = typeof message === 'string' ? message.trim() : '';
        if (!text) {
            this.slashUploadStatus.textContent = '';
            this.slashUploadStatus.hidden = true;
            this.slashUploadStatus.removeAttribute('data-variant');
            return;
        }
        this.slashUploadStatus.textContent = text;
        this.slashUploadStatus.hidden = false;
        this.slashUploadStatus.setAttribute('data-variant', variant || 'info');
    }

    updateSlashUploadModalButtons() {
        if (this.slashUploadSubmitButton) {
            this.slashUploadSubmitButton.disabled = this.slashUploadSubmitting;
        }
        if (this.slashUploadCancelButton) {
            this.slashUploadCancelButton.disabled = this.slashUploadSubmitting;
        }
        if (this.slashUploadCloseButton) {
            this.slashUploadCloseButton.disabled = this.slashUploadSubmitting;
        }
        if (this.slashUploadFileInput) {
            this.slashUploadFileInput.disabled = this.slashUploadSubmitting;
        }
    }

    openSlashUploadModal(action = {}) {
        if (!this.slashUploadModal || !this.slashUploadFileInput) {
            throw new Error('Slash upload modal is not available.');
        }
        if (this.pendingSlashUploadRequest) {
            throw new Error('Another slash upload is already pending.');
        }

        const title = typeof action.title === 'string' && action.title.trim()
            ? action.title.trim()
            : 'Upload File';
        const description = typeof action.description === 'string' && action.description.trim()
            ? action.description.trim()
            : 'Choose a file to continue.';
        const accept = typeof action.accept === 'string' ? action.accept.trim() : '';
        const submitLabel = typeof action.submitLabel === 'string' && action.submitLabel.trim()
            ? action.submitLabel.trim()
            : 'Upload';
        const cancelLabel = typeof action.cancelLabel === 'string' && action.cancelLabel.trim()
            ? action.cancelLabel.trim()
            : 'Cancel';

        this.slashUploadSubmitting = false;
        this.updateSlashUploadModalButtons();
        this.setSlashUploadStatus('', 'info');
        this.slashUploadFileInput.value = '';
        this.slashUploadFileInput.accept = accept;
        if (action.multiple === true) {
            this.slashUploadFileInput.setAttribute('multiple', '');
        } else {
            this.slashUploadFileInput.removeAttribute('multiple');
        }

        if (this.slashUploadTitle) {
            this.slashUploadTitle.textContent = title;
        }
        if (this.slashUploadDescription) {
            this.slashUploadDescription.textContent = description;
        }
        if (this.slashUploadSubmitButton) {
            this.slashUploadSubmitButton.textContent = submitLabel;
        }
        if (this.slashUploadCancelButton) {
            this.slashUploadCancelButton.textContent = cancelLabel;
        }

        this.slashUploadModal.removeAttribute('hidden');
        this.slashUploadModal.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        window.setTimeout(() => {
            this.slashUploadFileInput?.focus();
        }, 0);

        return new Promise(resolve => {
            this.pendingSlashUploadRequest = {
                resolve,
                action
            };
        });
    }

    hideSlashUploadModal() {
        if (!this.slashUploadModal) {
            return;
        }
        this.slashUploadModal.setAttribute('hidden', '');
        this.slashUploadModal.setAttribute('aria-hidden', 'true');
        this.syncBodyModalOpenClass();
    }

    settleSlashUploadRequest(result) {
        const pending = this.pendingSlashUploadRequest;
        this.pendingSlashUploadRequest = null;
        this.slashUploadSubmitting = false;
        this.updateSlashUploadModalButtons();
        this.setSlashUploadStatus('', 'info');
        if (this.slashUploadFileInput) {
            this.slashUploadFileInput.value = '';
        }
        this.hideSlashUploadModal();
        if (pending && typeof pending.resolve === 'function') {
            pending.resolve(result);
        }
    }

    cancelSlashUploadModal() {
        if (!this.pendingSlashUploadRequest || this.slashUploadSubmitting) {
            return;
        }
        this.settleSlashUploadRequest({ canceled: true, uploads: [] });
    }

    async submitSlashUploadModal() {
        if (!this.pendingSlashUploadRequest || !this.slashUploadFileInput || this.slashUploadSubmitting) {
            return;
        }

        const files = Array.from(this.slashUploadFileInput.files || []);
        if (!files.length) {
            this.setSlashUploadStatus('Choose at least one file to upload.', 'error');
            return;
        }

        this.slashUploadSubmitting = true;
        this.updateSlashUploadModalButtons();
        this.setSlashUploadStatus('Reading selected files...', 'info');

        try {
            const uploads = await Promise.all(files.map(async (file) => ({
                filename: file.name,
                content: await file.text(),
                mimeType: file.type || null,
                size: Number.isFinite(file.size) ? file.size : null
            })));
            this.settleSlashUploadRequest({ canceled: false, uploads });
        } catch (error) {
            this.slashUploadSubmitting = false;
            this.updateSlashUploadModalButtons();
            this.setSlashUploadStatus(`Failed to read file: ${error?.message || error}`, 'error');
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
        const rewardNpcDispositions = Array.isArray(questSource.rewardNpcDispositions)
            ? questSource.rewardNpcDispositions
                .map(entry => {
                    if (!entry || typeof entry !== 'object') {
                        return null;
                    }
                    const npcName = safeText(entry.npcName || entry.name || entry.npcId || entry.id);
                    if (!npcName || !Array.isArray(entry.dispositions)) {
                        return null;
                    }
                    const dispositions = entry.dispositions
                        .map(disposition => {
                            if (!disposition || typeof disposition !== 'object') {
                                return null;
                            }
                            const type = safeText(disposition.type);
                            const intensity = Number(disposition.intensity ?? disposition.amount ?? disposition.delta ?? disposition.value);
                            if (!type || !Number.isFinite(intensity) || !Number.isInteger(intensity) || intensity === 0) {
                                return null;
                            }
                            const delta = Number(disposition.delta);
                            return {
                                type,
                                intensity,
                                delta: Number.isFinite(delta) ? delta : null,
                                reason: safeText(disposition.reason) || null
                            };
                        })
                        .filter(Boolean);
                    if (!dispositions.length) {
                        return null;
                    }
                    return { npcName, dispositions };
                })
                .filter(Boolean)
            : [];

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
                rewardFactionReputation,
                rewardNpcDispositions
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
            if (Array.isArray(quest.rewardNpcDispositions) && quest.rewardNpcDispositions.length) {
                quest.rewardNpcDispositions.forEach(entry => {
                    const npcName = entry?.npcName || 'NPC';
                    const dispositions = Array.isArray(entry?.dispositions) ? entry.dispositions : [];
                    dispositions.forEach(disposition => {
                        const intensity = Number(disposition?.intensity);
                        if (!Number.isFinite(intensity) || !Number.isInteger(intensity) || intensity === 0) {
                            return;
                        }
                        // Prefer the server-resolved delta (intensity scaled by the
                        // typical step) so the accept dialog matches the quest list and
                        // the change actually applied on completion; fall back to the
                        // raw intensity only if no delta was provided.
                        const deltaRaw = Number(disposition?.delta);
                        const amount = Number.isFinite(deltaRaw) && deltaRaw !== 0 ? deltaRaw : intensity;
                        const signed = amount > 0 ? `+${amount}` : `${amount}`;
                        const reason = disposition.reason ? ` - ${disposition.reason}` : '';
                        rewardLines.push(`${npcName}: ${disposition.type} ${signed}${reason}`);
                    });
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
                this.addEventSummary('💡', `Light level changed from ${previousState.lightLevel} to ${lightLevel}.`, 'time');
            }
            if (weatherName && previousState.weatherName && weatherName !== previousState.weatherName) {
                this.addEventSummary('🌦️', `Weather changed from ${previousState.weatherName} to ${weatherName}.`, 'time');
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
                this.addEventSummary('🕒', `Time shifted ${fromText}to ${to}.`, 'time');
                return;
            }

            if (type === 'season') {
                const fromText = from ? `from ${from} ` : '';
                this.addEventSummary('🍂', `Season changed ${fromText}to ${to}.`, 'time');
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

    readClientCookie(name) {
        if (!name) {
            throw new Error('Cookie name is required.');
        }
        const cookieName = encodeURIComponent(name);
        const cookieString = typeof document.cookie === 'string' ? document.cookie : '';
        if (!cookieString) {
            return '';
        }
        const cookies = cookieString.split(';');
        for (const cookie of cookies) {
            const trimmed = cookie.trim();
            const separatorIndex = trimmed.indexOf('=');
            const rawName = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex) : trimmed;
            if (rawName !== cookieName) {
                continue;
            }
            const rawValue = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : '';
            return decodeURIComponent(rawValue);
        }
        return '';
    }

    writeClientCookie(name, value) {
        if (!name) {
            throw new Error('Cookie name is required.');
        }
        const maxAgeSeconds = 60 * 60 * 24 * 365;
        document.cookie = [
            `${encodeURIComponent(name)}=${encodeURIComponent(String(value ?? ''))}`,
            `Max-Age=${maxAgeSeconds}`,
            'Path=/',
            'SameSite=Lax'
        ].join('; ');
    }

    loadChatBubbleHiddenTypes() {
        try {
            const raw = this.readClientCookie(this.chatBubbleFilterCookieName);
            if (!raw) {
                return new Set();
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return new Set();
            }
            return new Set(
                parsed
                    .map(value => this.normalizeChatBubbleType(value))
                    .filter(Boolean)
            );
        } catch (error) {
            console.warn('Failed to load chat bubble filter state:', error);
            return new Set();
        }
    }

    persistChatBubbleHiddenTypes() {
        try {
            const values = Array.from(this.chatBubbleHiddenTypes || []);
            this.writeClientCookie(
                this.chatBubbleFilterCookieName,
                JSON.stringify(values)
            );
        } catch (error) {
            console.warn('Failed to persist chat bubble filter state:', error);
        }
    }

    normalizeChatBubbleType(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    formatChatBubbleTypeLabel(type) {
        const normalized = this.normalizeChatBubbleType(type);
        const labels = {
            assistant: 'AI Game Master',
            user: 'Player Messages',
            system: 'System Messages',
            error: 'Errors',
            'player-action': 'Player Action Results',
            'player-action-open-container': 'Container Opening Results',
            'user-question': 'Player Questions',
            'storyteller-answer': 'Storyteller Answers',
            'user-generic-prompt': 'Generic Prompt Requests',
            'generic-prompt-response': 'Generic Prompt Responses',
            'npc-action': 'NPC Actions',
            'npc-message': 'NPC Messages',
            'while-you-were-away-player': 'While You Were Away',
            'event-summary': 'Event Summaries',
            'status-summary': 'Status Summaries',
            'check-results': 'Check Results',
            'tool-call-debug': 'Tool Call Debug',
            plausibility: 'Plausibility Checks',
            'slop-remover': 'Slop Remover',
            'skill-check': 'Skill Checks',
            'attack-check': 'Attack Checks',
            'tracker-updates': 'Tracker Updates',
            'relationship-updates': 'Relationship Updates',
            'container-transfer': 'Container Transfers'
        };
        if (labels[normalized]) {
            return labels[normalized];
        }
        if (!normalized) {
            return 'Other Messages';
        }
        return normalized
            .split('-')
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }

    resolveChatBubbleDescriptor(entryOrType, labelOverride = '') {
        let rawType = '';
        let role = '';
        let isNpcTurn = false;

        if (entryOrType && typeof entryOrType === 'object') {
            rawType = typeof entryOrType.type === 'string' ? entryOrType.type : '';
            role = typeof entryOrType.role === 'string' ? entryOrType.role.trim().toLowerCase() : '';
            isNpcTurn = entryOrType.isNpcTurn === true;
        } else {
            rawType = entryOrType;
        }

        let type = this.normalizeChatBubbleType(rawType);
        if (!type) {
            if (role === 'user') {
                type = 'user';
            } else if (role === 'system') {
                type = 'system';
            } else if (isNpcTurn) {
                type = 'npc-message';
            } else if (role === 'assistant') {
                type = 'assistant';
            } else {
                type = 'system';
            }
        }

        const override = typeof labelOverride === 'string' ? labelOverride.trim() : '';
        return {
            type,
            label: override || this.formatChatBubbleTypeLabel(type)
        };
    }

    registerChatBubbleType(type, label) {
        const normalized = this.normalizeChatBubbleType(type);
        if (!normalized) {
            return false;
        }
        const resolvedLabel = typeof label === 'string' && label.trim()
            ? label.trim()
            : this.formatChatBubbleTypeLabel(normalized);
        const existing = this.chatBubbleTypes.get(normalized);
        if (existing === resolvedLabel) {
            return false;
        }
        this.chatBubbleTypes.set(normalized, resolvedLabel);
        return true;
    }

    decorateChatBubbleElement(element, entryOrType, labelOverride = '') {
        if (!element) {
            return element;
        }
        const descriptor = this.resolveChatBubbleDescriptor(entryOrType, labelOverride);
        element.dataset.chatBubbleType = descriptor.type;
        element.dataset.chatBubbleLabel = descriptor.label;
        const added = this.registerChatBubbleType(descriptor.type, descriptor.label);
        this.applyChatBubbleTypeVisibility(element);
        if (added) {
            this.renderChatBubbleFilterOptions();
        }
        return element;
    }

    syncChatBubbleTypesFromDom() {
        if (!this.chatLog) {
            return;
        }
        this.chatLog.querySelectorAll('.message[data-chat-bubble-type]').forEach(element => {
            this.registerChatBubbleType(element.dataset.chatBubbleType, element.dataset.chatBubbleLabel);
        });
    }

    applyChatBubbleTypeVisibility(element) {
        if (!element) {
            return false;
        }
        const type = this.normalizeChatBubbleType(element.dataset?.chatBubbleType || '');
        const hidden = Boolean(type && this.chatBubbleHiddenTypes?.has(type));
        element.classList.toggle('chat-bubble-hidden-by-filter', hidden);
        if (hidden) {
            element.setAttribute('aria-hidden', 'true');
        } else {
            element.removeAttribute('aria-hidden');
        }
        return hidden;
    }

    applyChatBubbleFilters() {
        if (!this.chatLog) {
            return;
        }
        this.chatLog.querySelectorAll('.message[data-chat-bubble-type]').forEach(element => {
            this.applyChatBubbleTypeVisibility(element);
        });
        this.updateChatBubbleFilterToggleState();
    }

    getSortedChatBubbleTypes() {
        this.syncChatBubbleTypesFromDom();
        return Array.from(this.chatBubbleTypes.entries())
            .map(([type, label]) => ({ type, label }))
            .sort((left, right) => left.label.localeCompare(right.label));
    }

    renderChatBubbleFilterOptions() {
        if (!this.chatBubbleFilterOptions) {
            return;
        }

        const types = this.getSortedChatBubbleTypes();
        this.chatBubbleFilterOptions.innerHTML = '';
        if (!types.length) {
            const empty = document.createElement('div');
            empty.className = 'chat-bubble-filter-empty';
            empty.textContent = 'No chat bubbles yet.';
            this.chatBubbleFilterOptions.appendChild(empty);
            this.updateChatBubbleFilterToggleState();
            return;
        }

        types.forEach(({ type, label }) => {
            const row = document.createElement('label');
            row.className = 'chat-bubble-filter-option';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'chat-bubble-filter-option__input';
            checkbox.checked = !this.chatBubbleHiddenTypes.has(type);
            checkbox.dataset.chatBubbleType = type;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    this.chatBubbleHiddenTypes.delete(type);
                } else {
                    this.chatBubbleHiddenTypes.add(type);
                }
                this.persistChatBubbleHiddenTypes();
                this.applyChatBubbleFilters();
            });

            const text = document.createElement('span');
            text.className = 'chat-bubble-filter-option__label';
            text.textContent = label;

            row.appendChild(checkbox);
            row.appendChild(text);
            this.chatBubbleFilterOptions.appendChild(row);
        });

        this.updateChatBubbleFilterToggleState();
    }

    updateChatBubbleFilterToggleState() {
        if (!this.chatBubbleFilterToggle) {
            return;
        }
        const hasHidden = Boolean(this.chatBubbleHiddenTypes && this.chatBubbleHiddenTypes.size > 0);
        this.chatBubbleFilterToggle.classList.toggle('is-filtering', hasHidden);
    }

    setChatBubbleFilterPopoverOpen(open) {
        if (!this.chatBubbleFilterPopover || !this.chatBubbleFilterToggle) {
            return;
        }
        const shouldOpen = Boolean(open);
        this.chatBubbleFilterPopover.hidden = !shouldOpen;
        this.chatBubbleFilterToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        this.chatBubbleFilterToggle.classList.toggle('is-open', shouldOpen);
        if (shouldOpen) {
            this.renderChatBubbleFilterOptions();
        }
    }

    toggleChatBubbleFilterPopover(forceOpen = null) {
        const shouldOpen = forceOpen === null
            ? Boolean(this.chatBubbleFilterPopover?.hidden)
            : Boolean(forceOpen);
        this.setChatBubbleFilterPopoverOpen(shouldOpen);
    }

    setupChatBubbleFilter() {
        if (!this.chatBubbleFilterToggle || !this.chatBubbleFilterPopover || this.chatBubbleFilterBound) {
            return;
        }
        this.chatBubbleFilterBound = true;
        this.syncChatBubbleTypesFromDom();
        this.renderChatBubbleFilterOptions();
        this.applyChatBubbleFilters();

        this.chatBubbleFilterToggle.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleChatBubbleFilterPopover();
        });

        this.chatBubbleFilterPopover.addEventListener('click', (event) => {
            event.stopPropagation();
        });

        document.addEventListener('click', (event) => {
            if (this.chatBubbleFilterPopover.hidden) {
                return;
            }
            const target = event.target;
            if (this.chatBubbleFilterPopover.contains(target) || this.chatBubbleFilterToggle.contains(target)) {
                return;
            }
            this.setChatBubbleFilterPopoverOpen(false);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !this.chatBubbleFilterPopover.hidden) {
                event.preventDefault();
                this.setChatBubbleFilterPopoverOpen(false);
                this.chatBubbleFilterToggle.focus();
            }
        });
    }

    isModelBoundChatRequestMessage(entry) {
        if (!entry || typeof entry !== 'object') {
            return false;
        }
        const role = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
        if (!role) {
            return false;
        }
        if (typeof entry.content === 'string') {
            return true;
        }
        return role === 'assistant' && Array.isArray(entry.tool_calls);
    }

    buildModelBoundChatHistory() {
        if (!Array.isArray(this.chatHistory)) {
            return [];
        }
        return this.chatHistory.filter(entry => this.isModelBoundChatRequestMessage(entry));
    }

    createMarkdownRenderer() {
        if (typeof window === 'undefined' || typeof window.markdownit !== 'function') {
            return null;
        }
        try {
            const markdownRenderer = window.markdownit({
                html: true,
                linkify: true,
                breaks: true
            });

            const defaultTableOpen = markdownRenderer.renderer.rules.table_open
                || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
            const defaultTableClose = markdownRenderer.renderer.rules.table_close
                || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

            markdownRenderer.renderer.rules.table_open = (tokens, idx, options, env, self) => (
                `<div class="message-table-scroll">${defaultTableOpen(tokens, idx, options, env, self)}`
            );
            markdownRenderer.renderer.rules.table_close = (tokens, idx, options, env, self) => (
                `${defaultTableClose(tokens, idx, options, env, self)}</div>`
            );

            return markdownRenderer;
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
                this.promoteHiddenNoteTags(target);
                return;
            } catch (error) {
                console.warn('Failed to render markdown content:', error);
            }
        }

        target.textContent = raw;
    }

    promoteHiddenNoteTags(target) {
        if (!target || typeof target.querySelectorAll !== 'function') {
            return;
        }
        const hiddenNodes = Array.from(target.querySelectorAll('hidden'));
        hiddenNodes.forEach(node => {
            const wrapper = document.createElement('div');
            wrapper.className = 'hidden-note';
            while (node.firstChild) {
                wrapper.appendChild(node.firstChild);
            }
            node.replaceWith(wrapper);
        });
    }

    getAttachmentTypes() {
        return new Set(['skill-check', 'attack-check', 'plausibility', 'slop-remover', 'supplemental-story-info']);
    }

    getTurnDiffEntryTypes() {
        return new Set(['event-summary', 'status-summary']);
    }

    isLegacyDirectTravelSummaryEntry(entry) {
        if (!entry || entry.type !== 'event-summary' || entry.parentId) {
            return false;
        }
        const items = Array.isArray(entry.summaryItems) ? entry.summaryItems : [];
        return items.some(item => {
            if (!item || typeof item !== 'object') {
                return false;
            }
            const category = typeof item.category === 'string' ? item.category.trim().toLowerCase() : '';
            const sourceType = typeof item.sourceType === 'string' ? item.sourceType.trim().toLowerCase() : '';
            const text = typeof item.text === 'string' ? item.text.trim().toLowerCase() : '';
            return category === 'travel'
                || sourceType === 'travel_move'
                || text.startsWith('traveled from ');
        });
    }

    findLegacyDirectTravelDrawerParentId(startIndex) {
        if (!Array.isArray(this.serverHistory)) {
            return null;
        }
        for (let index = startIndex + 1; index < this.serverHistory.length; index += 1) {
            const candidate = this.serverHistory[index];
            if (!candidate) {
                continue;
            }
            if (candidate.type === 'while-you-were-away') {
                continue;
            }
            if (candidate.type === 'while-you-were-away-player') {
                return candidate.id || null;
            }
            if (candidate.role === 'user' || candidate.type === 'player-action' || candidate.type === 'npc-action') {
                return null;
            }
        }
        return null;
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
        const turnDiffEntryTypes = this.getTurnDiffEntryTypes();
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
            const isAttachment = attachmentTypes.has(entryType);
            const isParentLinkedTurnDiff = turnDiffEntryTypes.has(entryType) && Boolean(entry.parentId);
            if (!isAttachment && !isParentLinkedTurnDiff) {
                return true;
            }
            const parentId = isAttachment
                ? entry.parentId || (entry.id ? resolvedParentById.get(entry.id) : null)
                : entry.parentId;
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
        this.chatBubbleTypes.clear();
        const fragment = document.createDocumentFragment();

        const aggregatedEntries = [];
        const recordsById = new Map();
        const pendingAttachments = new Map();
        const pendingTurnDiffEntries = new Map();
        let lastAttachable = null;
        const attachmentTypes = this.getAttachmentTypes();
        const turnDiffEntryTypes = this.getTurnDiffEntryTypes();

        const attachToRecord = (record, attachment) => {
            if (record && attachment) {
                record.attachments.push(attachment);
                return true;
            }
            return false;
        };

        const attachTurnDiffToRecord = (record, entry) => {
            if (record && entry) {
                record.turnDiffEntries.push(entry);
                return true;
            }
            return false;
        };

        this.serverHistory.forEach((entry, entryIndex) => {
            if (!entry) {
                lastAttachable = null;
                return;
            }

            const entryType = entry.type || null;
            const isAttachmentType = attachmentTypes.has(entryType);
            const isTurnDiffType = turnDiffEntryTypes.has(entryType);
            const parentId = entry.parentId
                || (this.isLegacyDirectTravelSummaryEntry(entry)
                    ? this.findLegacyDirectTravelDrawerParentId(entryIndex)
                    : null);

            if (isTurnDiffType && parentId) {
                const parentRecord = recordsById.get(parentId);
                if (attachTurnDiffToRecord(parentRecord, entry)) {
                    return;
                }
                if (!pendingTurnDiffEntries.has(parentId)) {
                    pendingTurnDiffEntries.set(parentId, []);
                }
                pendingTurnDiffEntries.get(parentId).push(entry);
                return;
            }

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

                const orphanRecord = { entry, attachments: [], turnDiffEntries: [] };
                aggregatedEntries.push(orphanRecord);
                if (entry.id) {
                    recordsById.set(entry.id, orphanRecord);
                }
                lastAttachable = null;
                return;
            }

            const record = { entry, attachments: [], turnDiffEntries: [] };
            aggregatedEntries.push(record);

            if (entry.id) {
                recordsById.set(entry.id, record);
                if (pendingAttachments.has(entry.id)) {
                    const pendingList = pendingAttachments.get(entry.id);
                    pendingList.forEach(pendingEntry => record.attachments.push(pendingEntry));
                    pendingAttachments.delete(entry.id);
                }
                if (pendingTurnDiffEntries.has(entry.id)) {
                    const pendingList = pendingTurnDiffEntries.get(entry.id);
                    pendingList.forEach(pendingEntry => record.turnDiffEntries.push(pendingEntry));
                    pendingTurnDiffEntries.delete(entry.id);
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
                    aggregatedEntries.push({ entry, attachments: [], turnDiffEntries: [] });
                });
            }
        }

        aggregatedEntries.forEach(({ entry, attachments, turnDiffEntries }) => {
            const element = this.createChatMessageElement(entry, attachments, turnDiffEntries);
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
                <div>Welcome to the AI RPG! I\'m your Game Master. Use System for operational configuration, Worlds for world profiles, then New Game to begin.</div>
            `;
            this.decorateChatBubbleElement(placeholder, 'assistant');
            this.chatLog.appendChild(placeholder);
        } else {
            this.chatLog.appendChild(fragment);
        }

        this.syncChatBubbleTypesFromDom();
        this.renderChatBubbleFilterOptions();
        this.applyChatBubbleFilters();
        this.scrollToBottom();
    }

    createChatMessageElement(entry, attachments = [], turnDiffEntries = []) {
        if (!entry) {
            return null;
        }
        const renderEditedPlainText = entry.metadata?.editedPlainText === true
            && typeof entry.content === 'string'
            && entry.content.trim();

        if (!renderEditedPlainText && entry.type === 'event-summary') {
            return this.createEventSummaryElement(entry);
        }

        if (!renderEditedPlainText && entry.type === 'status-summary') {
            return this.createStatusSummaryElement(entry);
        }

        if (!renderEditedPlainText && entry.type === 'plausibility') {
            return this.createPlausibilityEntryElement(entry);
        }

        if (!renderEditedPlainText && entry.type === 'slop-remover') {
            return this.createSlopRemovalEntryElement(entry);
        }

        if (!renderEditedPlainText && entry.type === 'skill-check') {
            return this.createSkillCheckEntryElement(entry);
        }

        if (!renderEditedPlainText && entry.type === 'attack-check') {
            return this.createAttackCheckEntryElement(entry);
        }

        if (!renderEditedPlainText && entry.type === 'check-results') {
            return this.createCheckResultsEntryElement(entry);
        }

        if (!renderEditedPlainText && entry.type === 'tool-call-debug') {
            return this.createToolCallDebugEntryElement(entry);
        }

        if (!renderEditedPlainText && entry.type === 'save-notice') {
            return this.createSaveNoticeElement(entry);
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
        messageDiv.dataset.entryId = entry.id || '';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        if (entry.type === 'tool-call-debug') {
            senderDiv.textContent = 'Tool Calls';
        } else if (entry.type === 'tracker-updates') {
            senderDiv.textContent = 'Tracker Updates';
        } else if (entry.type === 'relationship-updates') {
            senderDiv.textContent = 'Relationship Updates';
        } else if (entry.role === 'user') {
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

        if (Array.isArray(turnDiffEntries) && turnDiffEntries.length) {
            this.appendTurnDiffDrawer(messageDiv, turnDiffEntries);
        }

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

        this.decorateChatBubbleElement(messageDiv, entry);
        return messageDiv;
    }

    createToolCallDebugEntryElement(entry) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ai-message tool-call-debug-message';
        messageDiv.dataset.type = 'tool-call-debug';
        messageDiv.dataset.timestamp = entry.timestamp || '';
        messageDiv.dataset.entryId = entry.id || '';
        this.decorateChatBubbleElement(messageDiv, 'tool-call-debug');

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = 'Tool Calls';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content tool-call-debug-content';

        const records = Array.isArray(entry.toolCalls) ? entry.toolCalls : [];
        if (records.length) {
            if (entry.summary) {
                const overview = document.createElement('div');
                overview.className = 'tool-call-debug-overview';
                overview.textContent = String(entry.summary);
                contentDiv.appendChild(overview);
            }
            records.forEach((record, index) => {
                contentDiv.appendChild(this.createToolCallDebugRecordElement(record, index));
            });
        } else {
            this.setMessageContent(
                contentDiv,
                entry.content || 'No tool calls recorded yet.',
                { allowMarkdown: true }
            );
        }

        const actions = this.createMessageActions(entry, { allowSystem: true, allowEdit: false, persistent: true });
        this.appendMessageSections(messageDiv, {
            senderDiv,
            bodyDiv: contentDiv,
            timestampText: this.formatTimestamp(entry.timestamp),
            actions
        });

        return messageDiv;
    }

    createToolCallDebugRecordElement(record, index) {
        if (!record || typeof record !== 'object') {
            throw new Error('Tool-call debug entry contains an invalid record.');
        }

        const name = typeof record.name === 'string' && record.name.trim()
            ? record.name.trim()
            : 'unknownTool';
        const rawStatus = typeof record.status === 'string' && record.status.trim()
            ? record.status.trim()
            : 'unknown';
        const status = ['running', 'completed', 'error', 'unknown'].includes(rawStatus)
            ? rawStatus
            : 'unknown';

        const details = document.createElement('details');
        details.className = `tool-call-debug-item tool-call-debug-item--${status}`;
        if (record.cacheHit) {
            details.classList.add('tool-call-debug-item--cache-hit');
        }
        details.open = status === 'running' || status === 'error';

        const summary = document.createElement('summary');
        summary.className = 'tool-call-debug-summary';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'tool-call-debug-name';
        nameSpan.textContent = name;
        summary.appendChild(nameSpan);

        const metaSpan = document.createElement('span');
        metaSpan.className = 'tool-call-debug-meta';
        const parsedSequence = Number(record.sequence);
        const sequence = Number.isInteger(parsedSequence) && parsedSequence > 0
            ? parsedSequence
            : index + 1;
        metaSpan.textContent = `#${sequence} • ${record.cacheHit ? 'cache hit' : status}`;
        summary.appendChild(metaSpan);

        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'tool-call-debug-body';
        if (record.sourceLabel || record.round || record.id || record.cacheHit || record.cacheKey) {
            const facts = document.createElement('div');
            facts.className = 'tool-call-debug-facts';
            const factParts = [];
            if (record.sourceLabel) {
                factParts.push(`Prompt: ${record.sourceLabel}`);
            }
            if (record.round !== null && record.round !== undefined) {
                factParts.push(`Round: ${record.round}`);
            }
            if (record.id) {
                factParts.push(`Tool call id: ${record.id}`);
            }
            if (record.cacheHit) {
                factParts.push('Cache: hit');
            }
            if (record.cacheHit && record.cacheKey) {
                factParts.push(`Cache key: ${record.cacheKey}`);
            }
            facts.textContent = factParts.join(' • ');
            body.appendChild(facts);
        }

        body.appendChild(this.createToolCallDebugSection('Parameters', record.parameters || {}));
        if (Object.prototype.hasOwnProperty.call(record, 'result')) {
            body.appendChild(this.createToolCallDebugSection('Result', record.result));
        }
        if (record.error) {
            body.appendChild(this.createToolCallDebugSection('Error', record.error));
        }

        details.appendChild(body);
        return details;
    }

    createToolCallDebugSection(label, value) {
        const section = document.createElement('section');
        section.className = 'tool-call-debug-section';

        const heading = document.createElement('div');
        heading.className = 'tool-call-debug-section-title';
        heading.textContent = label;
        section.appendChild(heading);

        const display = prepareToolCallDebugSectionDisplay(label, value);
        display.contentFields.forEach(field => {
            section.appendChild(this.createToolCallDebugContentFieldElement(field));
        });
        section.appendChild(this.createToolCallDebugJsonViewer(display.jsonValue));

        return section;
    }

    createToolCallDebugContentFieldElement(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'tool-call-debug-content-field';

        const title = document.createElement('div');
        title.className = 'tool-call-debug-content-field-title';
        title.textContent = field && field.path ? field.path : 'content';
        wrapper.appendChild(title);

        const body = document.createElement('pre');
        body.className = 'tool-call-debug-content-field-body';
        body.textContent = field && typeof field.content === 'string' ? field.content : '';
        wrapper.appendChild(body);

        return wrapper;
    }

    createToolCallDebugJsonViewer(value) {
        if (!window.customElements || !window.customElements.get('andypf-json-viewer')) {
            throw new Error('The @andypf/json-viewer custom element is required for tool-call debug rendering.');
        }

        const viewer = document.createElement('andypf-json-viewer');
        viewer.className = 'tool-call-debug-json-viewer';
        viewer.indent = 2;
        viewer.expanded = 1;
        viewer.theme = 'darcula';
        viewer.showDataTypes = true;
        viewer.showToolbar = false;
        viewer.showSize = true;
        viewer.showCopy = true;
        viewer.expandIconType = 'arrow';
        viewer.expandEmpty = false;
        viewer.preserveExpanded = true;
        viewer.data = value === undefined ? null : value;
        return viewer;
    }

    createCheckResultsEntryElement(entry) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ai-message check-results-message';
        messageDiv.dataset.type = 'check-results';
        messageDiv.dataset.timestamp = entry.timestamp || '';
        messageDiv.dataset.entryId = entry.id || '';
        this.decorateChatBubbleElement(messageDiv, 'check-results');

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '🎲 Checks';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content check-results-content';

        const records = Array.isArray(entry.checkResults) ? entry.checkResults : [];
        if (records.length) {
            if (entry.summary) {
                const overview = document.createElement('div');
                overview.className = 'check-results-overview';
                overview.textContent = String(entry.summary);
                contentDiv.appendChild(overview);
            }
            records.forEach((record, index) => {
                contentDiv.appendChild(this.createCheckResultRecordElement(record, index));
            });
        } else {
            this.setMessageContent(
                contentDiv,
                entry.content || 'No checks recorded yet.',
                { allowMarkdown: true }
            );
        }

        const actions = this.createMessageActions(entry);
        this.appendMessageSections(messageDiv, {
            senderDiv,
            bodyDiv: contentDiv,
            timestampText: this.formatTimestamp(entry.timestamp),
            actions
        });

        return messageDiv;
    }

    createCheckResultRecordElement(record, index) {
        if (!record || typeof record !== 'object') {
            throw new Error('Check-results entry contains an invalid record.');
        }

        const rawStatus = typeof record.status === 'string' && record.status.trim()
            ? record.status.trim()
            : 'unknown';
        const status = ['running', 'completed', 'error', 'unknown'].includes(rawStatus)
            ? rawStatus
            : 'unknown';
        const rawKind = typeof record.kind === 'string' && record.kind.trim()
            ? record.kind.trim()
            : 'check';
        const kind = rawKind.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'check';

        const details = document.createElement('details');
        details.className = `check-result-item check-result-item--${status} check-result-item--${kind}`;
        if (record.cacheHit) {
            details.classList.add('check-result-item--cache-hit');
        }

        const summary = document.createElement('summary');
        summary.className = 'check-result-summary';

        const title = document.createElement('span');
        title.className = 'check-result-title';
        title.textContent = this.resolveCheckResultSummaryText(record);
        summary.appendChild(title);

        const meta = document.createElement('span');
        meta.className = 'check-result-meta';
        meta.textContent = record.cacheHit ? 'cache hit' : status;
        summary.appendChild(meta);

        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'check-result-body';
        const detailsHtml = this.buildCheckResultDetailsHtml(record);
        if (detailsHtml) {
            const detailsWrapper = document.createElement('div');
            detailsWrapper.className = 'check-result-details';
            detailsWrapper.innerHTML = detailsHtml;
            body.appendChild(detailsWrapper);
        } else if (status === 'error') {
            const error = document.createElement('div');
            error.className = 'check-result-error';
            error.textContent = record.error?.message || 'Check resolution failed.';
            body.appendChild(error);
        } else if (status === 'running') {
            const pending = document.createElement('div');
            pending.className = 'check-result-pending';
            pending.textContent = 'Resolving...';
            body.appendChild(pending);
        } else {
            const empty = document.createElement('div');
            empty.className = 'check-result-pending';
            empty.textContent = 'No check details were recorded.';
            body.appendChild(empty);
        }

        details.appendChild(body);
        return details;
    }

    resolveCheckResultSummaryText(record) {
        if (record && typeof record.summary === 'string' && record.summary.trim()) {
            const summary = record.summary.trim();
            if (record.kind === 'attack') {
                return summary
                    .replace(/,\s*[-+]?\d+(?:\.\d+)?\s+damage(?:,\s*[-+]?\d+(?:\.\d+)?%\s+remaining)?$/i, '')
                    .replace(/,\s*[-+]?\d+(?:\.\d+)?%\s+remaining$/i, '');
            }
            if (record.kind === 'skill' || record.kind === 'opposed-skill') {
                return summary
                    .replace(/,\s*(?:total\s+)?[-+]?\d+(?:\.\d+)?(?:\s+vs\s+(?:DC\s+)?[-+]?\d+(?:\.\d+)?)?(?:,\s*margin\s+[-+]?\d+(?:\.\d+)?)?$/i, '')
                    .replace(/,\s*margin\s+[-+]?\d+(?:\.\d+)?$/i, '');
            }
            return summary;
        }
        if (record?.kind === 'attack') {
            return 'Attack check';
        }
        if (record?.kind === 'area-attack') {
            return 'Area attack';
        }
        if (record?.kind === 'opposed-skill') {
            return 'Opposed skill check';
        }
        if (record?.kind === 'skill') {
            return 'Skill check';
        }
        return 'Check';
    }

    buildCheckResultDetailsHtml(record) {
        if (!record || typeof record !== 'object') {
            return '';
        }
        if ((record.kind === 'skill' || record.kind === 'opposed-skill') && record.skillCheck) {
            const details = this.generateSkillCheckInsight(record.skillCheck);
            return details?.html || '';
        }
        if (record.kind === 'attack' && record.attackSummary) {
            const details = this.generateAttackCheckInsight(record.attackSummary);
            return details?.html || '';
        }
        if (record.kind === 'area-attack' && record.areaAttackSummary) {
            const details = this.generateAreaAttackInsight(record.areaAttackSummary);
            return details?.html || '';
        }
        return '';
    }

    appendTurnDiffDrawer(parentElement, turnDiffEntries = []) {
        if (!parentElement || !Array.isArray(turnDiffEntries) || !turnDiffEntries.length) {
            return null;
        }
        if (!window.TurnStateDiffDrawer || typeof window.TurnStateDiffDrawer.appendDrawer !== 'function') {
            throw new Error('TurnStateDiffDrawer script is required before chat.js can render turn diff drawers.');
        }

        return window.TurnStateDiffDrawer.appendDrawer(parentElement, turnDiffEntries, {
            renderText: (target, text) => this.setMessageContent(target, text, { allowMarkdown: true })
        });
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

    generateAreaAttackInsight(summary) {
        if (!summary || typeof summary !== 'object') {
            return null;
        }

        const lines = [];
        const effectParts = [];
        if (summary.areaShape) {
            effectParts.push(this.escapeHtml(String(summary.areaShape)));
        }
        if (summary.weapon && summary.weapon !== 'N/A') {
            effectParts.push(`Weapon: ${this.escapeHtml(String(summary.weapon))}`);
        }
        if (summary.ability && summary.ability !== 'N/A') {
            effectParts.push(`Ability: ${this.escapeHtml(String(summary.ability))}`);
        }
        if (summary.effectDescription) {
            effectParts.push(this.escapeHtml(String(summary.effectDescription)));
        }
        if (effectParts.length) {
            lines.push(`<li><strong>Area Effect:</strong> ${effectParts.join(' • ')}</li>`);
        }

        const sharedRoll = summary.sharedRoll || {};
        const rollParts = [];
        if (typeof sharedRoll.die === 'number') {
            rollParts.push(`d20 ${sharedRoll.die}`);
        }
        if (sharedRoll.attackSkill) {
            rollParts.push(this.escapeHtml(String(sharedRoll.attackSkill)));
        }
        if (sharedRoll.damageAttribute) {
            rollParts.push(`Damage: ${this.escapeHtml(String(sharedRoll.damageAttribute))}`);
        }
        if (typeof sharedRoll.total === 'number') {
            rollParts.push(`Total ${sharedRoll.total}`);
        }
        if (rollParts.length) {
            lines.push(`<li><strong>Shared Roll:</strong> ${rollParts.join(' → ')}</li>`);
        }

        const results = Array.isArray(summary.results) ? summary.results : [];
        results.forEach((result) => {
            if (!result || typeof result !== 'object') {
                return;
            }
            const target = result.target || result.targetName || 'Target';
            const resultParts = [];
            resultParts.push(result.hit ? 'Hit' : 'Miss');
            if (result.position) {
                resultParts.push(this.escapeHtml(String(result.position)));
            }
            if (typeof result.damageApplied === 'number') {
                const damageValue = this.formatHealthDisplayValue(result.damageApplied);
                resultParts.push(`Damage ${damageValue}`);
            }
            if (typeof result.healthLostPercent === 'number') {
                resultParts.push(`Lost ${result.healthLostPercent}%`);
            }
            if (typeof result.remainingHealthPercent === 'number') {
                resultParts.push(`Remaining ${result.remainingHealthPercent}%`);
            }
            if (result.secondaryEffectApplied && result.secondaryEffect) {
                resultParts.push(`Effect: ${this.escapeHtml(String(result.secondaryEffect))}`);
            } else if (result.secondaryEffect) {
                resultParts.push(`Possible effect: ${this.escapeHtml(String(result.secondaryEffect))}`);
            }
            if (result.attackSummary?.hitDegree !== undefined && result.attackSummary?.hitDegree !== null) {
                const hitDegree = Number(result.attackSummary.hitDegree);
                if (Number.isFinite(hitDegree)) {
                    resultParts.push(`Degree ${formatSignedNumber(hitDegree) ?? hitDegree}`);
                }
            }

            let targetDetailHtml = '';
            if (result.attackSummary && typeof result.attackSummary === 'object') {
                const targetAttackInsight = this.generateAttackCheckInsight(result.attackSummary);
                if (targetAttackInsight?.html) {
                    targetDetailHtml = `<div class="area-attack-target-breakdown">${targetAttackInsight.html}</div>`;
                }
            }

            lines.push(`<li><strong>${this.escapeHtml(String(target))}:</strong> ${resultParts.join(' • ')}${targetDetailHtml}</li>`);
        });

        if (!lines.length) {
            return null;
        }

        return {
            html: `<div class="area-attack-details"><ul>${lines.join('\n')}</ul></div>`
        };
    }

    getAttackSummaryRenderKey(summary) {
        if (!summary || typeof summary !== 'object') {
            return '';
        }
        try {
            return JSON.stringify(summary);
        } catch (_) {
            return [
                summary.attacker?.name || '',
                summary.defender?.name || '',
                summary.hit === true ? 'hit' : 'miss',
                summary.roll?.die ?? '',
                summary.roll?.total ?? '',
                summary.damage?.total ?? '',
                summary.damage?.applied ?? ''
            ].join('|');
        }
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
            return { slopWords: [], slopRegexes: [], slopNgrams: [] };
        }
        const source = slopRemoval.slopRemoval && typeof slopRemoval.slopRemoval === 'object'
            ? slopRemoval.slopRemoval
            : slopRemoval;
        const slopWords = Array.isArray(source.slopWords)
            ? source.slopWords.map(word => (typeof word === 'string' ? word.trim() : '')).filter(Boolean)
            : [];
        const slopRegexes = Array.isArray(source.slopRegexes)
            ? source.slopRegexes.map(name => (typeof name === 'string' ? name.trim() : '')).filter(Boolean)
            : [];
        const slopNgrams = Array.isArray(source.slopNgrams)
            ? source.slopNgrams.map(ngram => (typeof ngram === 'string' ? ngram.trim() : '')).filter(Boolean)
            : [];
        return { slopWords, slopRegexes, slopNgrams };
    }

    renderSlopRemovalMarkup(slopRemoval) {
        const normalized = this.normalizeSlopRemovalPayload(slopRemoval);
        if (!normalized.slopWords.length && !normalized.slopRegexes.length && !normalized.slopNgrams.length) {
            return '';
        }

        const sections = [];
        if (normalized.slopWords.length) {
            const words = normalized.slopWords
                .map(word => `<li>${this.escapeHtml(word)}</li>`)
                .join('');
            sections.push(`<div class="slop-remover-section"><h4>Slop words</h4><ul>${words}</ul></div>`);
        }
        if (normalized.slopRegexes.length) {
            const regexes = normalized.slopRegexes
                .map(name => `<li>${this.escapeHtml(name)}</li>`)
                .join('');
            sections.push(`<div class="slop-remover-section"><h4>Regex matches</h4><ul>${regexes}</ul></div>`);
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

    createNewExitSummaryPill(metadata) {
        const normalized = normalizeNewExitNavigationMetadata(metadata);
        if (!normalized) {
            return null;
        }

        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'event-summary-new-exit-pill';
        pill.textContent = `🗺️ ${getNewExitPillLabel(normalized)}`;
        pill.title = 'Open this exit on the map';
        pill.setAttribute('aria-label', `Open ${getNewExitPillLabel(normalized)} on the map`);
        try {
            pill.dataset.newExitSummaryPayload = JSON.stringify(normalized);
        } catch (_) {
            // The click listener closes over normalized metadata, so dataset serialization is only for server-rendered parity.
        }
        pill.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            dispatchNewExitSummarySelected(pill, normalized);
        });
        return pill;
    }

    appendEventSummaryItemContent(listItem, item) {
        if (!listItem || !item || !item.text) {
            return;
        }

        const textSpan = document.createElement('span');
        textSpan.className = 'event-summary-text';
        this.setMessageContent(textSpan, item.text, { allowMarkdown: true });
        listItem.appendChild(textSpan);

        const pill = this.createNewExitSummaryPill(item.metadata?.newExitDiscovered || null);
        if (pill) {
            listItem.appendChild(document.createTextNode(' '));
            listItem.appendChild(pill);
        }
    }

    createEventSummaryElement(entry) {
        const container = document.createElement('div');
        container.className = 'message event-summary-batch';
        container.dataset.timestamp = entry.timestamp || '';
        this.decorateChatBubbleElement(container, 'event-summary');

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = entry.summaryTitle || '📋 Events';

        const listWrapper = document.createElement('div');
        const list = document.createElement('ul');
        list.className = 'event-summary-list';

        const dispositionRows = Array.isArray(entry.summaryItems) && entry.summaryItems.length
            ? this.createDispositionSummaryRows(entry.summaryItems)
            : null;
        if (dispositionRows && this.hasOnlyDispositionSummaryItems(entry.summaryItems)) {
            listWrapper.appendChild(dispositionRows);
        } else if (Array.isArray(entry.summaryItems) && entry.summaryItems.length) {
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
                this.appendEventSummaryItemContent(listItem, item);
                list.appendChild(listItem);
            });
            listWrapper.appendChild(list);
        }

        const actions = this.createMessageActions(entry);
        this.appendMessageSections(container, {
            senderDiv,
            bodyDiv: listWrapper,
            timestampText: this.formatTimestamp(entry.timestamp),
            actions
        });

        return container;
    }

    createStatusSummaryElement(entry) {
        const container = document.createElement('div');
        container.className = 'message status-summary-batch';
        container.dataset.timestamp = entry.timestamp || '';
        this.decorateChatBubbleElement(container, 'status-summary');

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

        const actions = this.createMessageActions(entry);
        this.appendMessageSections(container, {
            senderDiv,
            bodyDiv: listWrapper,
            timestampText: this.formatTimestamp(entry.timestamp),
            actions
        });

        return container;
    }

    createSaveNoticeElement(entry) {
        const container = document.createElement('div');
        container.className = 'message save-notice';
        container.dataset.timestamp = entry.timestamp || '';
        container.dataset.entryId = entry.id || '';

        const text = document.createElement('span');
        text.className = 'save-notice__text';
        const content = typeof entry.content === 'string' && entry.content.trim()
            ? entry.content.trim()
            : '💾 Game saved.';
        text.textContent = content;
        container.appendChild(text);

        const timestampDiv = document.createElement('span');
        timestampDiv.className = 'save-notice__timestamp';
        timestampDiv.textContent = this.formatTimestamp(entry.timestamp);
        container.appendChild(timestampDiv);

        return container;
    }

    createMessageActions(entry, { allowSystem = false, allowEdit = true, persistent = false } = {}) {
        if (!entry || (entry.role === 'system' && !allowSystem)) {
            return null;
        }
        if (!this.getEntryKey(entry)) {
            return null;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'message-actions';
        if (persistent) {
            wrapper.classList.add('message-actions--persistent');
        }

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

        if (allowEdit) {
            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'message-action message-action--edit';
            editButton.title = 'Edit message';
            editButton.setAttribute('aria-label', 'Edit message');
            editButton.textContent = '✏️';
            editButton.addEventListener('click', () => {
                this.openEditModal(entry);
            });
            wrapper.appendChild(editButton);
        }

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'message-action message-action--delete';
        deleteButton.title = 'Delete message';
        deleteButton.setAttribute('aria-label', 'Delete message');
        deleteButton.textContent = '🗑️';
        deleteButton.addEventListener('click', () => {
            this.handleDeleteMessage(entry);
        });

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
                timeoutMs: Math.floor(normalizedTimeoutMs),
                clientId: this.clientId
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
            const errorMessage = data?.error || `HTTP ${response.status}`;
            throw new Error(`Failed to cancel prompts: ${errorMessage}`);
        }
        return data;
    }

    async cancelAllPromptsAndLoadLatestAutosave({ triggerButton = this.abortTurnButton } = {}) {
        if (this.turnRollbackInProgress) {
            return false;
        }
        this.turnRollbackInProgress = true;
        const originalButtonAriaLabel = triggerButton?.getAttribute('aria-label');
        const originalButtonTitle = triggerButton?.getAttribute('title');
        if (triggerButton) {
            triggerButton.disabled = true;
            triggerButton.setAttribute('aria-busy', 'true');
            triggerButton.setAttribute('aria-label', 'Stopping prompts and restoring the latest autosave');
            triggerButton.setAttribute('title', 'Stopping prompts and restoring the latest autosave…');
        }

        try {
            const response = await fetch('/api/turn/cancel-and-rollback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: this.clientId || window.AIRPG_CLIENT_ID || null
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.success) {
                const error = new Error(data?.error || `HTTP ${response.status}`);
                error.serverStack = typeof data?.stack === 'string' ? data.stack : '';
                throw error;
            }
            window.location.reload();
            return true;
        } catch (error) {
            this.turnRollbackInProgress = false;
            if (triggerButton) {
                triggerButton.disabled = false;
                triggerButton.removeAttribute('aria-busy');
                if (originalButtonAriaLabel === null) {
                    triggerButton.removeAttribute('aria-label');
                } else {
                    triggerButton.setAttribute('aria-label', originalButtonAriaLabel);
                }
                if (originalButtonTitle === null) {
                    triggerButton.removeAttribute('title');
                } else {
                    triggerButton.setAttribute('title', originalButtonTitle);
                }
            }
            const stack = typeof error?.serverStack === 'string' && error.serverStack.trim()
                ? error.serverStack.trim()
                : (typeof error?.stack === 'string' ? error.stack : (error?.message || String(error)));
            console.error('Failed to stop the turn and restore the latest autosave:', stack);
            alert(`Failed to stop the turn and restore the latest autosave:\n\n${stack}`);
            return false;
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

    formatHealthDisplayValue(value) {
        return window.DomUtils.formatHealthDisplayValue(value);
    }

    isHealthNeedBarChange(change, barName = '') {
        const resolvedBarName = String(barName || change?.needBarName || change?.needBar || change?.bar || change?.needBarId || '').trim().toLowerCase();
        const source = String(change?.source || '').trim().toLowerCase();
        return resolvedBarName === 'health' || source === 'health_regen';
    }

    resolveNeedBarMaxValue(change, barName = '') {
        const directMax = Number(change?.max);
        if (Number.isFinite(directMax)) {
            return directMax;
        }

        const resolvedBarName = String(barName || change?.needBarName || change?.needBar || change?.bar || change?.needBarId || '').trim().toLowerCase();
        const match = findNeedBarDefinition(change, resolvedBarName);
        const definitionMax = Number(match?.max);
        return Number.isFinite(definitionMax) ? definitionMax : null;
    }

    formatNeedBarDelta(change, delta, barName = '', { roundNonHealth = false } = {}) {
        const magnitude = typeof change?.magnitude === 'string' ? change.magnitude.trim().toLowerCase() : '';
        const direction = typeof change?.direction === 'string' ? change.direction.trim().toLowerCase() : '';
        if (magnitude === 'all' || magnitude === 'fill') {
            const maxValue = this.resolveNeedBarMaxValue(change, barName);
            if (Number.isFinite(maxValue)) {
                const sign = direction === 'decrease'
                    ? '-'
                    : (direction === 'increase' || magnitude === 'fill'
                        ? '+'
                        : (Number(delta) < 0 ? '-' : '+'));
                if (this.isHealthNeedBarChange(change, barName)) {
                    const displayMax = this.formatHealthDisplayValue(maxValue);
                    return displayMax !== null ? `${sign}${displayMax}` : '';
                }
                const displayMax = roundNonHealth ? Math.round(maxValue) : maxValue;
                return `${sign}${displayMax}`;
            }
        }

        if (!Number.isFinite(delta) || delta === 0) {
            return '';
        }

        if (this.isHealthNeedBarChange(change, barName)) {
            const displayDelta = Math.ceil(Math.abs(delta));
            return `${delta > 0 ? '+' : '-'}${displayDelta}`;
        }

        const displayDelta = roundNonHealth ? Math.round(delta) : delta;
        return `${delta > 0 ? '+' : ''}${displayDelta}`;
    }

    setupEditModal() {
        this.editModal = document.createElement('div');
        this.editModal.className = 'chat-edit-modal';
        this.editModal.setAttribute('data-ctrl-enter-submit', '.chat-edit-modal__save');
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
        if (!entry || !this.getEntryKey(entry)) {
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

    handleChatHistoryUpdated(payload = {}) {
        if (payload && typeof payload === 'object' && payload.worldTime && typeof payload.worldTime === 'object') {
            this.updateWorldTimeIndicator(payload.worldTime, { emitTransitions: false });
            const transitions = Array.isArray(payload.worldTime.transitions)
                ? payload.worldTime.transitions
                : [];
            if (transitions.length) {
                this.renderWorldTimeTransitions(transitions, null);
            }
        }
        if (payload && payload.locationRefreshRequested && typeof window.loadCurrentLocation === 'function') {
            Promise.resolve(window.loadCurrentLocation()).catch((error) => {
                console.warn('Failed to refresh location after chat_history_updated:', error);
            });
        }
        if (payload && payload.relationshipGraphRefreshRequested && typeof window.loadRelationshipGraph === 'function') {
            Promise.resolve(window.loadRelationshipGraph()).catch((error) => {
                console.warn('Failed to refresh relationship graph after chat_history_updated:', error);
            });
        }
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
            case 'summary_error':
                this.handleSummaryError(payload);
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
            case 'prompt_progress_group_failure':
                this.handlePromptProgressGroupFailure(payload);
                break;
            case 'prompt_progress_cleared':
                this.handlePromptProgressCleared(payload);
                break;
            case 'quest_confirmation_request':
                this.handleQuestConfirmationRequest(payload);
                break;
            case 'player_input_request':
                this.handlePlayerInputRequest(payload);
                break;
            case 'player_input_request_closed':
                this.handlePlayerInputRequestClosed(payload);
                break;
            default:
                console.log('Realtime update:', payload);
                break;
        }
    }

    bindPromptProgressOverlayInteractions(overlay, header, toggleButton) {
        this.bindPanelDragInteractions(overlay, header, {
            dragState: this.promptProgressDragState,
            shouldIgnorePointerDown: (event) => Boolean(
                (toggleButton && toggleButton.contains(event.target))
                || (event.target && event.target.closest('.prompt-progress-overlay__actions'))
            ),
            onDragStart: (panel) => {
                panel.dataset.autoAnchored = 'false';
            },
            onDragMove: (panel) => {
                panel.dataset.autoAnchored = 'false';
            }
        });
    }

    getPromptProgressSafeTopOffsetPx() {
        const SAFE_MARGIN = 12;
        let maxBottom = SAFE_MARGIN;
        const candidates = [
            document.querySelector('.app-header') || document.querySelector('.header'),
            document.querySelector('.tab-bar')
        ];

        for (const element of candidates) {
            if (!element) {
                continue;
            }
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                continue;
            }
            maxBottom = Math.max(maxBottom, Math.ceil(rect.bottom) + SAFE_MARGIN);
        }

        const maxTop = Math.max(SAFE_MARGIN, window.innerHeight - 180);
        return Math.min(maxBottom, maxTop);
    }

    applyPromptProgressAutoAnchor(overlay) {
        if (!overlay || overlay.dataset.autoAnchored === 'false') {
            return;
        }
        overlay.style.left = '16px';
        overlay.style.right = 'auto';
        overlay.style.top = `${this.getPromptProgressSafeTopOffsetPx()}px`;
        overlay.dataset.autoAnchored = 'true';
    }

    loadPromptProgressDockState() {
        const defaultState = 'one-line';
        try {
            const stored = window.localStorage?.getItem(this.promptProgressDockStateStorageKey);
            if (this.promptProgressDockStates.includes(stored)) {
                return stored;
            }
        } catch (error) {
            console.warn('Failed to load prompt progress dock state:', error);
        }
        return defaultState;
    }

    ensurePromptProgressDock() {
        if (!this.promptProgressDock) {
            this.promptProgressDock = document.getElementById('promptProgressDock');
        }
        if (!this.promptProgressDock) {
            throw new Error('Prompt progress dock host #promptProgressDock is missing.');
        }
        if (!this.promptProgressDockBound) {
            this.promptProgressDock.addEventListener('click', (event) => {
                if (event.target && event.target.closest('button, a, input, textarea, select')) {
                    return;
                }
                if (this.promptProgressDockState === 'collapsed') {
                    this.setPromptProgressDockState('one-line');
                }
            });
            this.promptProgressDock.addEventListener('keydown', (event) => {
                if (this.promptProgressDockState !== 'collapsed') {
                    return;
                }
                if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                }
                event.preventDefault();
                this.setPromptProgressDockState('one-line');
            });
            this.promptProgressDockBound = true;
        }
        this.updatePromptProgressDockStateClasses();
        return this.promptProgressDock;
    }

    updatePromptProgressDockStateClasses() {
        const dock = this.promptProgressDock;
        if (!dock) {
            return;
        }
        Object.values(this.promptProgressDockStateClassMap).forEach(className => {
            dock.classList.remove(className);
        });
        dock.classList.add(this.promptProgressDockStateClassMap[this.promptProgressDockState] || 'prompt-progress-dock--one-line');
        dock.tabIndex = this.promptProgressDockState === 'collapsed' ? 0 : -1;
        dock.setAttribute('aria-expanded', this.promptProgressDockState === 'collapsed' ? 'false' : 'true');
    }

    setPromptProgressDockState(state, { persist = true } = {}) {
        const nextState = this.promptProgressDockStates.includes(state) ? state : 'one-line';
        this.promptProgressDockState = nextState;
        if (persist) {
            try {
                window.localStorage?.setItem(this.promptProgressDockStateStorageKey, nextState);
            } catch (error) {
                console.warn('Failed to persist prompt progress dock state:', error);
            }
        }
        this.updatePromptProgressDockStateClasses();
        if (Array.isArray(this.promptProgressEntries)) {
            this.renderPromptProgress(this.promptProgressEntries);
        }
    }

    cyclePromptProgressDockState() {
        const currentIndex = this.promptProgressDockStates.indexOf(this.promptProgressDockState);
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % this.promptProgressDockStates.length;
        this.setPromptProgressDockState(this.promptProgressDockStates[nextIndex]);
    }

    getLongestRunningPromptProgressEntry(entries = this.promptProgressEntries) {
        if (!Array.isArray(entries) || !entries.length) {
            return null;
        }
        return entries.reduce((longest, entry) => {
            if (!longest) {
                return entry;
            }
            const entrySeconds = Number(entry?.seconds);
            const longestSeconds = Number(longest?.seconds);
            const safeEntrySeconds = Number.isFinite(entrySeconds) ? entrySeconds : 0;
            const safeLongestSeconds = Number.isFinite(longestSeconds) ? longestSeconds : 0;
            return safeEntrySeconds > safeLongestSeconds ? entry : longest;
        }, null);
    }

    getPromptProgressAggregateFraction(entries = this.promptProgressEntries) {
        if (!Array.isArray(entries) || !entries.length) {
            return null;
        }
        const fractions = entries
            .map(entry => Number(entry?.progressFraction))
            .filter(value => Number.isFinite(value));
        if (!fractions.length) {
            return null;
        }
        return Math.max(...fractions);
    }

    // Mirror the chat prompt-progress aggregate as a thin bar pinned to the
    // bottom of any open modal, so a modal that is waiting on the LLM shows the
    // same progress signal as the chat screen. Bars are injected/removed on the
    // fly and require no per-modal markup.
    updateModalPromptProgressBars() {
        if (typeof document === 'undefined' || !document.body) {
            return;
        }

        const entries = Array.isArray(this.promptProgressEntries) ? this.promptProgressEntries : [];
        const aggregate = this.getPromptProgressAggregateFraction(entries);
        const isActive = entries.length > 0 && aggregate !== null;
        const isGroupWaiting = entries.length > 0
            && entries.every(entry => entry?.isGroupWaiting === true);

        if (!isActive) {
            document.querySelectorAll('.modal__prompt-progress').forEach(bar => bar.remove());
            return;
        }

        const fraction = Math.max(0, Math.min(1, aggregate));
        const openDialogs = new Set(document.querySelectorAll('.modal[aria-hidden="false"] .modal__dialog'));

        // Drop bars that belong to modals which are no longer open.
        document.querySelectorAll('.modal__prompt-progress').forEach(bar => {
            if (!openDialogs.has(bar.parentElement)) {
                bar.remove();
            }
        });

        openDialogs.forEach(dialog => {
            let bar = dialog.querySelector(':scope > .modal__prompt-progress');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'modal__prompt-progress';
                bar.setAttribute('aria-hidden', 'true');
                const fill = document.createElement('div');
                fill.className = 'modal__prompt-progress-fill';
                bar.appendChild(fill);
                dialog.appendChild(bar);
            }
            bar.classList.toggle('modal__prompt-progress--group-waiting', isGroupWaiting);
            const fill = bar.firstElementChild;
            if (fill) {
                fill.style.width = `${fraction * 100}%`;
            }
        });
    }

    // Refresh modal progress bars when a modal opens/closes mid-prompt so a
    // freshly-opened modal picks up an in-flight prompt without waiting for the
    // next progress tick.
    setupModalPromptProgressObserver() {
        if (this.modalPromptProgressObserver || typeof MutationObserver === 'undefined' || !document.body) {
            return;
        }
        this.modalPromptProgressObserver = new MutationObserver(mutations => {
            const touchedModal = mutations.some(mutation => {
                const target = mutation.target;
                return target
                    && target.nodeType === 1
                    && typeof target.matches === 'function'
                    && target.matches('.modal');
            });
            if (touchedModal) {
                this.updateModalPromptProgressBars();
            }
        });
        this.modalPromptProgressObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['aria-hidden', 'hidden'],
            subtree: true
        });
    }

    ensurePromptProgressFavicon() {
        const favicon = document.querySelector('link[rel~="icon"]');
        if (!favicon) {
            throw new Error('Prompt progress favicon link is missing.');
        }
        if (!this.promptProgressFaviconOriginalHref) {
            this.promptProgressFaviconOriginalHref = favicon.getAttribute('href') || favicon.href || '';
            this.promptProgressFaviconOriginalSource = favicon.href || this.promptProgressFaviconOriginalHref;
            this.promptProgressFaviconOriginalType = favicon.getAttribute('type') || '';
        }
        return favicon;
    }

    loadPromptProgressFaviconBaseImage() {
        if (this.promptProgressFaviconBaseImage) {
            return Promise.resolve(this.promptProgressFaviconBaseImage);
        }
        if (this.promptProgressFaviconBaseImagePromise) {
            return this.promptProgressFaviconBaseImagePromise;
        }

        const imageSource = this.promptProgressFaviconOriginalSource || this.promptProgressFaviconOriginalHref;
        if (!imageSource) {
            throw new Error('Prompt progress favicon source is missing.');
        }

        this.promptProgressFaviconBaseImagePromise = new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                this.promptProgressFaviconBaseImage = image;
                resolve(image);
            };
            image.onerror = () => {
                reject(new Error(`Failed to load prompt progress favicon image: ${imageSource}`));
            };
            image.src = imageSource;
        });

        return this.promptProgressFaviconBaseImagePromise;
    }

    restorePromptProgressFavicon() {
        this.promptProgressFaviconUpdateToken += 1;
        const favicon = this.ensurePromptProgressFavicon();
        if (this.promptProgressFaviconOriginalHref) {
            favicon.href = this.promptProgressFaviconOriginalHref;
        }
        favicon.type = this.promptProgressFaviconOriginalType || 'image/svg+xml';
    }

    async updatePromptProgressFavicon(entries = this.promptProgressEntries) {
        const favicon = this.ensurePromptProgressFavicon();
        const activeEntry = this.getLongestRunningPromptProgressEntry(entries);
        if (!activeEntry) {
            this.restorePromptProgressFavicon();
            return;
        }

        const updateToken = this.promptProgressFaviconUpdateToken + 1;
        this.promptProgressFaviconUpdateToken = updateToken;
        const iconSize = 64;
        const canvas = document.createElement('canvas');
        canvas.width = iconSize;
        canvas.height = iconSize;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Prompt progress favicon canvas context is unavailable.');
        }

        const progressFraction = Number(activeEntry.progressFraction);
        const safeProgressFraction = Number.isFinite(progressFraction) ? progressFraction : 0;
        const fillHeight = iconSize * safeProgressFraction;
        context.clearRect(0, 0, iconSize, iconSize);
        context.fillStyle = this.promptProgressFaviconFillColor;
        context.fillRect(0, iconSize - fillHeight, iconSize, fillHeight);

        const baseImage = await this.loadPromptProgressFaviconBaseImage();
        if (updateToken !== this.promptProgressFaviconUpdateToken) {
            return;
        }

        context.drawImage(baseImage, 0, 0, iconSize, iconSize);
        favicon.type = 'image/png';
        favicon.href = canvas.toDataURL('image/png');
    }

    getPromptProgressEntry(promptId) {
        const resolvedId = typeof promptId === 'string' ? promptId.trim() : '';
        if (!resolvedId || !Array.isArray(this.promptProgressEntries)) {
            return null;
        }
        return this.promptProgressEntries.find(entry => entry && entry.id === resolvedId) || null;
    }

    getPromptProgressEntryForGroup(progressGroupId) {
        const resolvedGroupId = typeof progressGroupId === 'string' ? progressGroupId.trim() : '';
        if (!resolvedGroupId || !Array.isArray(this.promptProgressEntries)) {
            return null;
        }
        let latestMatch = null;
        for (let index = this.promptProgressEntries.length - 1; index >= 0; index -= 1) {
            const entry = this.promptProgressEntries[index];
            if (!entry || entry.progressGroupId !== resolvedGroupId) {
                continue;
            }
            latestMatch = latestMatch || entry;
            if (entry.isComplete !== true) {
                return entry;
            }
        }
        return latestMatch;
    }

    bindPromptProgressViewerInteractions(viewer, header, viewerState = null) {
        this.bindPanelDragInteractions(viewer, header, {
            dragState: this.promptProgressViewerDragState,
            shouldIgnorePointerDown: (event) => Boolean(
                event.target && event.target.closest('.prompt-progress-viewer__actions')
            ),
            extraMoveGuard: () => Boolean(
                viewerState?.id && this.promptProgressViewerDragState.viewerId !== viewerState.id
            ),
            onDragStart: (panel) => {
                this.promptProgressViewerDragState.viewerId = viewerState?.id || null;
                panel.dataset.autoAnchored = 'false';
            },
            onDragMove: (panel) => {
                panel.dataset.autoAnchored = 'false';
            },
            onDragEnd: () => {
                this.promptProgressViewerDragState.viewerId = null;
            }
        });
    }

    applyPromptProgressViewerAutoAnchor(viewer) {
        if (!viewer || viewer.dataset.autoAnchored === 'false') {
            return;
        }
        const stackOffset = Number(viewer.dataset.stackOffset || 0);
        const safeStackOffset = Number.isFinite(stackOffset) ? stackOffset : 0;
        viewer.style.left = 'auto';
        viewer.style.right = `${16 + safeStackOffset}px`;
        viewer.style.top = `${this.getPromptProgressSafeTopOffsetPx() + safeStackOffset}px`;
        viewer.dataset.autoAnchored = 'true';
    }

    closePromptProgressViewer(viewerId = null) {
        const resolvedViewerId = typeof viewerId === 'string' ? viewerId.trim() : '';
        if (!resolvedViewerId) {
            for (const viewerState of this.promptProgressViewerWindows.values()) {
                if (viewerState?.element?.isConnected) {
                    viewerState.element.remove();
                }
            }
            this.promptProgressViewerWindows.clear();
            this.renderPromptProgress(this.promptProgressEntries);
            return;
        }
        const viewerState = this.promptProgressViewerWindows.get(resolvedViewerId);
        if (viewerState?.element?.isConnected) {
            viewerState.element.remove();
        }
        this.promptProgressViewerWindows.delete(resolvedViewerId);
        this.renderPromptProgress(this.promptProgressEntries);
    }

    async copyTextToClipboard(text) {
        const value = typeof text === 'string' ? text : '';
        if (!value) {
            throw new Error('Nothing to copy.');
        }

        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(value);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) {
            throw new Error('Clipboard copy failed.');
        }
    }

    scrollPromptProgressViewerToBottom(viewerOrState = null) {
        const viewer = viewerOrState?.element || viewerOrState;
        if (!viewer) {
            return;
        }
        const streamTextElement = viewer.querySelector('.prompt-progress-viewer__stream-text');
        if (!streamTextElement) {
            return;
        }
        requestAnimationFrame(() => {
            streamTextElement.scrollTop = streamTextElement.scrollHeight;
        });
    }

    createPromptProgressViewerEntrySnapshot(entry = {}) {
        return {
            ...entry,
            id: typeof entry.id === 'string' ? entry.id : '',
            label: typeof entry.label === 'string' ? entry.label : 'Streaming response',
            model: typeof entry.model === 'string' ? entry.model : '',
            promptText: typeof entry.promptText === 'string' ? entry.promptText : '',
            previewText: typeof entry.previewText === 'string' ? entry.previewText : '',
            progressGroupId: typeof entry.progressGroupId === 'string' ? entry.progressGroupId : null,
            failedResponses: Array.isArray(entry.failedResponses)
                ? entry.failedResponses.filter(response => typeof response === 'string')
                : [],
            responseFailed: entry.responseFailed === true,
            receivedCount: entry.receivedCount ?? entry.bytes ?? null,
            bytes: entry.bytes ?? entry.receivedCount ?? null
        };
    }

    hasPromptProgressViewerForPrompt(promptId) {
        const resolvedId = typeof promptId === 'string' ? promptId.trim() : '';
        if (!resolvedId || !(this.promptProgressViewerWindows instanceof Map)) {
            return false;
        }
        const liveEntry = this.getPromptProgressEntry(resolvedId);
        const progressGroupId = typeof liveEntry?.progressGroupId === 'string'
            ? liveEntry.progressGroupId
            : null;
        for (const viewerState of this.promptProgressViewerWindows.values()) {
            const followsPrompt = viewerState?.promptId === resolvedId;
            const followsGroup = progressGroupId && viewerState?.progressGroupId === progressGroupId;
            if ((followsPrompt || followsGroup) && viewerState?.element?.isConnected) {
                return true;
            }
        }
        return false;
    }

    createPromptProgressViewerWindow(viewerState) {
        const viewer = document.createElement('aside');
        viewer.className = 'prompt-progress-viewer';
        viewer.setAttribute('role', 'dialog');
        viewer.setAttribute('aria-modal', 'false');
        viewer.setAttribute('aria-live', 'polite');
        viewer.setAttribute('aria-label', 'Streaming prompt response viewer');
        viewer.dataset.autoAnchored = 'true';
        viewer.dataset.viewerId = viewerState.id;
        viewer.dataset.promptId = viewerState.promptId;
        viewer.dataset.progressGroupId = viewerState.progressGroupId || '';
        viewer.dataset.stackOffset = String(viewerState.stackOffset || 0);

        const header = document.createElement('div');
        header.className = 'prompt-progress-viewer__header';

        const meta = document.createElement('div');
        meta.className = 'prompt-progress-viewer__meta';

        const title = document.createElement('div');
        title.className = 'prompt-progress-viewer__title';

        const subtitle = document.createElement('div');
        subtitle.className = 'prompt-progress-viewer__subtitle';

        const actions = document.createElement('div');
        actions.className = 'prompt-progress-viewer__actions';

        const followLabel = document.createElement('label');
        followLabel.className = 'prompt-progress-viewer__follow';
        followLabel.title = 'Keep the streamed response view scrolled to the bottom';

        const followCheckbox = document.createElement('input');
        followCheckbox.type = 'checkbox';
        followCheckbox.className = 'prompt-progress-viewer__follow-input';
        followCheckbox.checked = viewerState.followStream === true;
        followCheckbox.setAttribute('aria-label', 'Keep streamed response view scrolled to the bottom');
        followCheckbox.addEventListener('change', () => {
            viewerState.followStream = followCheckbox.checked;
            if (followCheckbox.checked) {
                this.scrollPromptProgressViewerToBottom(viewer);
            }
        });

        const followText = document.createElement('span');
        followText.className = 'prompt-progress-viewer__follow-text';
        followText.textContent = 'Follow';

        followLabel.appendChild(followCheckbox);
        followLabel.appendChild(followText);

        const copyPromptButton = document.createElement('button');
        copyPromptButton.type = 'button';
        copyPromptButton.className = 'prompt-progress-viewer__copy';
        copyPromptButton.textContent = 'Copy Prompt';
        copyPromptButton.title = 'Copy the full prompt to the clipboard';
        copyPromptButton.setAttribute('aria-label', 'Copy the full prompt to the clipboard');
        copyPromptButton.addEventListener('click', async () => {
            const promptText = typeof viewerState.lastEntry?.promptText === 'string' ? viewerState.lastEntry.promptText : '';
            if (!promptText) {
                return;
            }
            try {
                await this.copyTextToClipboard(promptText);
                copyPromptButton.textContent = 'Copied';
                copyPromptButton.dataset.feedbackActive = 'true';
                if (copyPromptButton._feedbackTimer) {
                    clearTimeout(copyPromptButton._feedbackTimer);
                }
                copyPromptButton._feedbackTimer = setTimeout(() => {
                    copyPromptButton.textContent = 'Copy Prompt';
                    delete copyPromptButton.dataset.feedbackActive;
                }, 1600);
            } catch (error) {
                console.warn('Failed to copy prompt text:', error);
                copyPromptButton.textContent = 'Copy Failed';
                copyPromptButton.dataset.feedbackActive = 'true';
                if (copyPromptButton._feedbackTimer) {
                    clearTimeout(copyPromptButton._feedbackTimer);
                }
                copyPromptButton._feedbackTimer = setTimeout(() => {
                    copyPromptButton.textContent = 'Copy Prompt';
                    delete copyPromptButton.dataset.feedbackActive;
                }, 1800);
            }
        });

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'prompt-progress-viewer__close';
        closeButton.textContent = '×';
        closeButton.title = 'Close streamed response viewer';
        closeButton.setAttribute('aria-label', 'Close streamed response viewer');
        closeButton.addEventListener('click', () => this.closePromptProgressViewer(viewerState.id));

        meta.appendChild(title);
        meta.appendChild(subtitle);
        header.appendChild(meta);
        actions.appendChild(followLabel);
        actions.appendChild(copyPromptButton);
        actions.appendChild(closeButton);
        header.appendChild(actions);

        const content = document.createElement('div');
        content.className = 'prompt-progress-viewer__content';

        const streamSection = document.createElement('section');
        streamSection.className = 'prompt-progress-viewer__section prompt-progress-viewer__section--stream';

        const streamLabel = document.createElement('div');
        streamLabel.className = 'prompt-progress-viewer__section-label';
        streamLabel.textContent = 'Prompt + Response';

        const streamText = document.createElement('pre');
        streamText.className = 'prompt-progress-viewer__stream-text';

        const promptText = document.createElement('span');
        promptText.className = 'prompt-progress-viewer__prompt-inline';

        const separatorText = document.createTextNode('');

        const failedResponseText = document.createElement('span');
        failedResponseText.className = 'prompt-progress-viewer__failed-response-inline';

        const failedResponseSeparatorText = document.createTextNode('');

        const responseText = document.createElement('span');
        responseText.className = 'prompt-progress-viewer__response-inline';

        streamText.appendChild(promptText);
        streamText.appendChild(separatorText);
        streamText.appendChild(failedResponseText);
        streamText.appendChild(failedResponseSeparatorText);
        streamText.appendChild(responseText);

        streamSection.appendChild(streamLabel);
        streamSection.appendChild(streamText);

        content.appendChild(streamSection);

        viewer.appendChild(header);
        viewer.appendChild(content);
        this.bindPromptProgressViewerInteractions(viewer, header, viewerState);
        viewerState.element = viewer;
        return viewer;
    }

    syncPromptProgressViewerWindow(viewerState) {
        if (!viewerState) {
            return;
        }
        const exactEntry = this.getPromptProgressEntry(viewerState.promptId);
        const progressGroupId = viewerState.progressGroupId || exactEntry?.progressGroupId || null;
        const liveEntry = progressGroupId
            ? this.getPromptProgressEntryForGroup(progressGroupId)
            : exactEntry;
        if (liveEntry) {
            viewerState.lastEntry = this.createPromptProgressViewerEntrySnapshot(liveEntry);
            viewerState.promptId = liveEntry.id;
            viewerState.progressGroupId = liveEntry.progressGroupId || progressGroupId;
            viewerState.isLive = true;
        } else {
            viewerState.isLive = false;
        }

        const entry = viewerState.lastEntry || {
            id: viewerState.promptId,
            label: 'Streaming response',
            promptText: '',
            previewText: ''
        };
        const viewer = viewerState.element || this.createPromptProgressViewerWindow(viewerState);
        const title = viewer.querySelector('.prompt-progress-viewer__title');
        const subtitle = viewer.querySelector('.prompt-progress-viewer__subtitle');
        const copyButton = viewer.querySelector('.prompt-progress-viewer__copy');
        const followCheckbox = viewer.querySelector('.prompt-progress-viewer__follow-input');
        const streamTextElement = viewer.querySelector('.prompt-progress-viewer__stream-text');
        const promptTextElement = viewer.querySelector('.prompt-progress-viewer__prompt-inline');
        const failedResponseTextElement = viewer.querySelector('.prompt-progress-viewer__failed-response-inline');
        const responseTextElement = viewer.querySelector('.prompt-progress-viewer__response-inline');
        const promptText = typeof entry.promptText === 'string' ? entry.promptText : '';
        const previewText = typeof entry.previewText === 'string' ? entry.previewText : '';
        const failedResponses = Array.isArray(entry.failedResponses)
            ? entry.failedResponses.filter(response => typeof response === 'string')
            : [];
        const receivedLabel = this.formatPromptProgressReceived(entry);
        const statusLabel = viewerState.isLive ? 'Streaming response' : 'Saved prompt snapshot';
        const fullModelName = typeof entry.model === 'string' ? entry.model : '';
        const displayedModelName = this.formatPromptProgressModelName(fullModelName);
        const metaParts = [statusLabel, displayedModelName || null, receivedLabel !== '-' ? receivedLabel : null].filter(Boolean);

        if (viewer.dataset.promptId !== (entry.id || viewerState.promptId || '') && copyButton) {
            if (copyButton._feedbackTimer) {
                clearTimeout(copyButton._feedbackTimer);
            }
            copyButton.textContent = 'Copy Prompt';
            delete copyButton.dataset.feedbackActive;
        }
        viewer.dataset.promptId = entry.id || viewerState.promptId || '';
        viewer.dataset.progressGroupId = viewerState.progressGroupId || '';

        if (title) {
            title.textContent = entry.label || 'Streaming response';
        }
        if (subtitle) {
            subtitle.textContent = metaParts.length ? metaParts.join(' • ') : 'Streaming response';
            subtitle.title = fullModelName && displayedModelName !== fullModelName
                ? `Model: ${fullModelName}`
                : '';
        }
        if (copyButton) {
            copyButton.disabled = !promptText;
            copyButton.title = promptText
                ? 'Copy the full prompt to the clipboard'
                : 'Prompt text is not available to copy';
        }
        if (followCheckbox) {
            followCheckbox.checked = viewerState.followStream === true;
        }
        const renderedPromptText = promptText || 'Prompt not available for this stream.';
        const renderedResponseText = previewText || 'Waiting for streamed text...';
        if (promptTextElement) {
            promptTextElement.textContent = renderedPromptText;
        }
        if (failedResponseTextElement) {
            failedResponseTextElement.textContent = failedResponses
                .map(response => response.trim() ? response : '(empty response)')
                .join('\n\n');
        }
        if (streamTextElement && promptTextElement && failedResponseTextElement && responseTextElement) {
            const separatorNode = promptTextElement.nextSibling;
            if (separatorNode && separatorNode.nodeType === Node.TEXT_NODE) {
                separatorNode.textContent = '\n\n';
            }
            const failedResponseSeparatorNode = failedResponseTextElement.nextSibling;
            if (failedResponseSeparatorNode && failedResponseSeparatorNode.nodeType === Node.TEXT_NODE) {
                failedResponseSeparatorNode.textContent = failedResponses.length ? '\n\n' : '';
            }
        }
        if (responseTextElement) {
            responseTextElement.textContent = entry.responseFailed === true ? '' : renderedResponseText;
        }
        viewer.classList.toggle('is-prompt-empty', !promptText);
        viewer.classList.toggle('has-failed-responses', failedResponses.length > 0);
        viewer.classList.toggle('is-response-empty', !previewText || entry.responseFailed === true);
        this.applyPromptProgressViewerAutoAnchor(viewer);

        if (!viewer.isConnected) {
            document.body.appendChild(viewer);
        }
        if (viewerState.followStream === true) {
            this.scrollPromptProgressViewerToBottom(viewer);
        }
    }

    syncPromptProgressViewers() {
        if (!(this.promptProgressViewerWindows instanceof Map)) {
            return;
        }
        for (const viewerState of this.promptProgressViewerWindows.values()) {
            this.syncPromptProgressViewerWindow(viewerState);
        }
    }

    openPromptProgressViewer(promptId) {
        const resolvedId = typeof promptId === 'string' ? promptId.trim() : '';
        if (!resolvedId) {
            return;
        }
        const entry = this.getPromptProgressEntry(resolvedId);
        if (!entry) {
            return;
        }
        this.promptProgressViewerCounter += 1;
        const viewerState = {
            id: `prompt-progress-viewer-${this.promptProgressViewerCounter}`,
            promptId: resolvedId,
            progressGroupId: typeof entry.progressGroupId === 'string' ? entry.progressGroupId : null,
            followStream: true,
            isLive: true,
            lastEntry: this.createPromptProgressViewerEntrySnapshot(entry),
            stackOffset: ((this.promptProgressViewerCounter - 1) % 6) * 24,
            element: null
        };
        this.promptProgressViewerWindows.set(viewerState.id, viewerState);
        this.syncPromptProgressViewerWindow(viewerState);
        this.renderPromptProgress(this.promptProgressEntries);
    }

    formatPromptProgressReceived(entry) {
        const rawCount = entry?.receivedCount ?? entry?.bytes;
        const count = Number(rawCount);
        if (!Number.isFinite(count)) {
            return '-';
        }
        return count.toLocaleString();
    }

    formatPromptProgressModelName(modelName) {
        if (typeof modelName !== 'string') {
            return '';
        }
        const characters = Array.from(modelName);
        return characters.length > 10
            ? `${characters.slice(0, 10).join('')}...`
            : modelName;
    }

    formatPromptProgressPercent(entry) {
        const progressFraction = Number(entry?.progressFraction);
        if (!Number.isFinite(progressFraction)) {
            return '-';
        }
        return `${(Math.floor(progressFraction * 1000) / 10).toFixed(1)}%`;
    }

    formatPromptProgressApproxPercent(entry) {
        const progressFraction = Number(entry?.progressFraction);
        if (!Number.isFinite(progressFraction)) {
            return '~0%';
        }
        return `~${Math.floor(progressFraction * 100)}%`;
    }

    clearPendingPromptProgressRender() {
        if (this.promptProgressRenderTimer) {
            clearTimeout(this.promptProgressRenderTimer);
            this.promptProgressRenderTimer = null;
        }
    }

    flushPromptProgressRender(entries = null) {
        this.clearPendingPromptProgressRender();
        const entriesToRender = Array.isArray(entries)
            ? entries
            : (Array.isArray(this.promptProgressPendingEntries)
                ? this.promptProgressPendingEntries
                : []);
        this.promptProgressPendingEntries = null;
        this.promptProgressLastRenderTs = Date.now();
        this.renderPromptProgress(entriesToRender);
    }

    applyPromptProgressMinTableWidth(table) {
        if (!table || !Number.isFinite(this.promptProgressMinTableWidth) || this.promptProgressMinTableWidth <= 0) {
            return;
        }
        table.style.minWidth = `${Math.ceil(this.promptProgressMinTableWidth)}px`;
    }

    updatePromptProgressMinTableWidth(table) {
        if (!table || !table.isConnected) {
            return;
        }
        const rowCount = table.tBodies?.[0]?.rows?.length || 0;
        if (rowCount <= 0) {
            return;
        }
        const rectWidth = table.getBoundingClientRect().width;
        const measuredWidth = Math.ceil(Math.max(
            Number.isFinite(rectWidth) ? rectWidth : 0,
            Number.isFinite(table.scrollWidth) ? table.scrollWidth : 0
        ));
        if (measuredWidth <= 0) {
            return;
        }
        if (!Number.isFinite(this.promptProgressMinTableWidth) || measuredWidth > this.promptProgressMinTableWidth) {
            this.promptProgressMinTableWidth = measuredWidth;
            table.style.minWidth = `${measuredWidth}px`;
        }
    }

    ensurePromptProgressTable(tableHeaderHtml) {
        if (!this.promptProgressTableWrap || !this.promptProgressTable || !this.promptProgressTableBody) {
            const table = document.createElement('table');
            table.className = 'prompt-progress-table';

            const thead = document.createElement('thead');
            thead.innerHTML = tableHeaderHtml;
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            table.appendChild(tbody);

            const tableWrap = document.createElement('div');
            tableWrap.className = 'prompt-progress-table-wrap';
            tableWrap.appendChild(table);

            this.promptProgressTableWrap = tableWrap;
            this.promptProgressTable = table;
            this.promptProgressTableBody = tbody;
        }

        if (!this.promptProgressTable.tHead) {
            const thead = document.createElement('thead');
            thead.innerHTML = tableHeaderHtml;
            this.promptProgressTable.insertBefore(thead, this.promptProgressTable.firstChild);
        } else {
            this.promptProgressTable.tHead.innerHTML = tableHeaderHtml;
        }
        if (!this.promptProgressTableBody.parentNode) {
            this.promptProgressTable.appendChild(this.promptProgressTableBody);
        }
        this.applyPromptProgressMinTableWidth(this.promptProgressTable);

        return {
            tableWrap: this.promptProgressTableWrap,
            table: this.promptProgressTable,
            tbody: this.promptProgressTableBody
        };
    }

    attachPromptProgressTable(contentDiv) {
        if (!contentDiv || !this.promptProgressTableWrap) {
            return;
        }
        if (this.promptProgressTableWrap.parentNode === contentDiv) {
            return;
        }
        contentDiv.replaceChildren(this.promptProgressTableWrap);
    }

    schedulePromptProgressRender(entries = [], { force = false } = {}) {
        const normalizedEntries = Array.isArray(entries)
            ? entries.filter(entry => entry && typeof entry === 'object')
            : [];
        this.promptProgressPendingEntries = normalizedEntries;

        if (force || !this.promptProgressDock || !this.promptProgressLastRenderTs) {
            this.flushPromptProgressRender(normalizedEntries);
            return;
        }

        const now = Date.now();
        const elapsed = now - this.promptProgressLastRenderTs;
        if (elapsed >= this.promptProgressRenderThrottleMs) {
            this.flushPromptProgressRender(normalizedEntries);
            return;
        }

        if (!this.promptProgressRenderTimer) {
            this.promptProgressRenderTimer = setTimeout(() => {
                this.promptProgressRenderTimer = null;
                this.flushPromptProgressRender();
            }, Math.max(0, this.promptProgressRenderThrottleMs - elapsed));
        }
    }

    createPromptProgressBar(entryOrFraction = null, { aggregate = false, groupWaiting = false } = {}) {
        const bar = document.createElement('div');
        bar.className = aggregate ? 'prompt-progress-bar prompt-progress-bar--aggregate' : 'prompt-progress-bar';
        if (!aggregate && entryOrFraction?.isComplete === true) {
            bar.classList.add('prompt-progress-bar--complete');
        }
        if (groupWaiting || entryOrFraction?.isGroupWaiting === true) {
            bar.classList.add('prompt-progress-bar--group-waiting');
        }
        const fill = document.createElement('div');
        fill.className = 'prompt-progress-bar__fill';
        const fraction = typeof entryOrFraction === 'number'
            ? entryOrFraction
            : Number(entryOrFraction?.progressFraction);
        fill.style.width = Number.isFinite(fraction) ? `${fraction * 100}%` : '0%';
        bar.appendChild(fill);
        return bar;
    }

    createPromptProgressModeButton({ state, icon, label }) {
        const targetState = this.promptProgressDockStates.includes(state) ? state : 'one-line';
        const iconName = icon === 'expand' ? 'expand' : 'compress';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `prompt-progress-dock__mode-button prompt-progress-dock__mode-button--${iconName}`;
        button.title = label;
        button.setAttribute('aria-label', label);

        const image = document.createElement('img');
        image.className = 'prompt-progress-dock__mode-icon';
        image.src = this.promptProgressModeIconPaths[iconName];
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');

        button.appendChild(image);
        button.addEventListener('click', () => this.setPromptProgressDockState(targetState));
        return button;
    }

    createPromptProgressActionIcon(iconName) {
        const normalizedIconName = Object.prototype.hasOwnProperty.call(this.promptProgressActionIconPaths, iconName)
            ? iconName
            : 'view';
        const image = document.createElement('img');
        image.className = 'prompt-progress-action__icon';
        image.src = this.promptProgressActionIconPaths[normalizedIconName];
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        return image;
    }

    createPromptProgressActions(entry, row = null) {
        const isViewerActive = this.hasPromptProgressViewerForPrompt(entry.id);
        const isComplete = entry?.isComplete === true;
        const isGroupWaiting = entry?.isGroupWaiting === true;
        const actionWrap = document.createElement('div');
        actionWrap.className = 'prompt-progress-actions';

        const viewButton = document.createElement('button');
        viewButton.type = 'button';
        viewButton.className = 'prompt-progress-view prompt-progress-action';
        viewButton.appendChild(this.createPromptProgressActionIcon('view'));
        viewButton.setAttribute('aria-label', `${isViewerActive ? 'Open another' : 'View'} streamed response for ${entry.label || 'prompt'}`);
        viewButton.title = isViewerActive ? 'Open another streamed response viewer' : 'View streamed response';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'prompt-progress-cancel prompt-progress-action';
        cancelButton.appendChild(this.createPromptProgressActionIcon('cancel'));
        cancelButton.setAttribute('aria-label', `Cancel prompt ${entry.label || 'prompt'}`);
        cancelButton.title = 'Cancel prompt';

        const retryButton = document.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'prompt-progress-retry prompt-progress-action';
        retryButton.appendChild(this.createPromptProgressActionIcon('restart'));
        retryButton.setAttribute('aria-label', `Retry prompt ${entry.label || 'prompt'}`);
        retryButton.title = 'Retry prompt attempt';

        if (!entry.id || isComplete) {
            viewButton.disabled = true;
            cancelButton.disabled = true;
            retryButton.disabled = true;
        } else {
            if (isViewerActive) {
                viewButton.classList.add('is-active');
            }
            viewButton.addEventListener('click', () => {
                this.openPromptProgressViewer(entry.id);
            });
            if (isGroupWaiting) {
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
        }

        actionWrap.appendChild(viewButton);
        actionWrap.appendChild(retryButton);
        actionWrap.appendChild(cancelButton);
        return actionWrap;
    }

    createPromptProgressTableRow(entry, { compact = false } = {}) {
        const row = document.createElement('tr');
        const isViewerActive = this.hasPromptProgressViewerForPrompt(entry.id);
        if (isViewerActive) {
            row.classList.add('prompt-progress-row-viewing');
        }
        if (compact) {
            row.classList.add('prompt-progress-row-compact');
        }
        if (entry?.isComplete === true) {
            row.classList.add('prompt-progress-row-complete');
        }
        if (entry?.isGroupWaiting === true) {
            row.classList.add('prompt-progress-row-group-waiting');
        }

        const actionCell = document.createElement('td');
        actionCell.appendChild(this.createPromptProgressActions(entry, row));

        const labelCell = document.createElement('td');
        labelCell.textContent = entry.label || 'prompt';

        const progressCell = document.createElement('td');
        progressCell.className = 'prompt-progress-progress-cell';
        progressCell.appendChild(this.createPromptProgressBar(entry));
        const progressLabel = document.createElement('span');
        progressLabel.className = 'prompt-progress-bar-label';
        progressLabel.textContent = this.formatPromptProgressPercent(entry);
        progressCell.appendChild(progressLabel);

        const modelCell = document.createElement('td');
        const fullModelName = typeof entry.model === 'string' ? entry.model : '';
        const displayedModelName = this.formatPromptProgressModelName(fullModelName);
        modelCell.textContent = displayedModelName || '-';
        if (fullModelName && displayedModelName !== fullModelName) {
            modelCell.title = fullModelName;
        }

        const receivedCell = document.createElement('td');
        receivedCell.textContent = this.formatPromptProgressReceived(entry);

        const secondsCell = document.createElement('td');
        secondsCell.textContent = Number.isFinite(entry.seconds) ? `${Math.round(entry.seconds)}s` : '-';

        const timeoutCell = document.createElement('td');
        timeoutCell.textContent = Number.isFinite(entry.timeoutSeconds) ? `${Math.round(entry.timeoutSeconds)}s` : '-';

        const latencyCell = document.createElement('td');
        latencyCell.textContent = Number.isFinite(entry.latencyMs) ? `${(entry.latencyMs / 1000).toFixed(1)}s` : '-';

        const retryCell = document.createElement('td');
        retryCell.textContent = Number.isFinite(entry.retries) ? `${entry.retries}` : '0';

        row.appendChild(actionCell);
        row.appendChild(labelCell);
        row.appendChild(progressCell);
        row.appendChild(modelCell);
        row.appendChild(receivedCell);
        row.appendChild(secondsCell);
        row.appendChild(timeoutCell);
        row.appendChild(latencyCell);
        row.appendChild(retryCell);
        return row;
    }

    createPromptProgressHeader(renderTimestamp) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'prompt-progress-dock__header';

        const metaDiv = document.createElement('div');
        metaDiv.className = 'prompt-progress-dock__meta';

        const titleDiv = document.createElement('div');
        titleDiv.className = 'prompt-progress-dock__title';
        titleDiv.textContent = 'AI Prompts';

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'prompt-progress-dock__timestamp';
        timestampDiv.textContent = renderTimestamp();

        const actionDiv = document.createElement('div');
        actionDiv.className = 'prompt-progress-dock__actions';

        actionDiv.appendChild(this.createPromptProgressModeButton({
            state: 'one-line',
            icon: 'compress',
            label: 'Show compact prompt tracker'
        }));

        metaDiv.appendChild(titleDiv);
        metaDiv.appendChild(timestampDiv);
        headerDiv.appendChild(metaDiv);
        headerDiv.appendChild(actionDiv);
        return headerDiv;
    }

    formatPromptProgressOneLineLabel(entry, runningCount = 0) {
        const baseLabel = entry?.label || 'prompt';
        const extraCount = Math.max(0, Number.isInteger(runningCount) ? runningCount - 1 : 0);
        return extraCount > 0
            ? `${baseLabel} (and ${extraCount} more)`
            : baseLabel;
    }

    createPromptProgressOneLine(entry, { runningCount = 0 } = {}) {
        const row = document.createElement('div');
        row.className = 'prompt-progress-dock__one-line-row';
        const isIdle = !entry?.id;
        const isComplete = entry?.isComplete === true;
        const isGroupWaiting = entry?.isGroupWaiting === true;
        row.classList.toggle('prompt-progress-dock__one-line-row--idle', isIdle);
        row.classList.toggle('prompt-progress-dock__one-line-row--complete', isComplete);
        row.classList.toggle('prompt-progress-dock__one-line-row--group-waiting', isGroupWaiting);

        const progressFraction = Number(entry?.progressFraction);
        const fill = document.createElement('div');
        fill.className = 'prompt-progress-dock__one-line-fill';
        fill.style.width = Number.isFinite(progressFraction) ? `${progressFraction * 100}%` : '0%';
        row.appendChild(fill);

        const content = document.createElement('div');
        content.className = 'prompt-progress-dock__one-line-content';

        const modeControls = document.createElement('div');
        modeControls.className = 'prompt-progress-dock__mode-controls';
        modeControls.appendChild(this.createPromptProgressModeButton({
            state: 'collapsed',
            icon: 'compress',
            label: 'Show prompt tracker as progress bar'
        }));
        modeControls.appendChild(this.createPromptProgressModeButton({
            state: 'table',
            icon: 'expand',
            label: 'Show full prompt tracker table'
        }));

        const label = document.createElement('span');
        label.className = 'prompt-progress-dock__one-line-label';
        label.textContent = isIdle ? 'no prompts running' : this.formatPromptProgressOneLineLabel(entry, runningCount);

        const received = document.createElement('span');
        received.className = 'prompt-progress-dock__one-line-stat';
        received.textContent = `${this.formatPromptProgressReceived(entry)} chars`;

        const percent = document.createElement('span');
        percent.className = 'prompt-progress-dock__one-line-percent';
        percent.textContent = this.formatPromptProgressApproxPercent(entry);

        if (!isIdle) {
            content.appendChild(this.createPromptProgressActions(entry || {}, null));
        }
        content.appendChild(label);
        if (!isIdle) {
            content.appendChild(received);
            content.appendChild(percent);
        }
        content.appendChild(modeControls);
        row.appendChild(content);
        return row;
    }

    createIdlePromptProgressEntry() {
        return {
            id: '',
            label: 'no prompts running',
            receivedCount: 0,
            bytes: 0,
            progressFraction: 0,
            targetCharacters: null,
            runCount: 0,
            averageOutputCharacters: null,
            seconds: 0,
            timeoutSeconds: null,
            latencyMs: null,
            avgReceivedPerSecond: null,
            retries: 0
        };
    }

    renderPromptProgressCollapsed(dock, entries = this.promptProgressEntries) {
        const aggregateProgress = this.getPromptProgressAggregateFraction(entries) || 0;
        const groupWaiting = entries.length > 0
            && entries.every(entry => entry?.isGroupWaiting === true);
        const aggregateBar = this.createPromptProgressBar(aggregateProgress, {
            aggregate: true,
            groupWaiting
        });
        dock.replaceChildren(aggregateBar);
    }

    renderPromptProgressOneLine(dock, entries = this.promptProgressEntries) {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'prompt-progress-dock__content';
        const longestEntry = this.getLongestRunningPromptProgressEntry(entries) || this.createIdlePromptProgressEntry();
        contentDiv.appendChild(this.createPromptProgressOneLine(longestEntry, {
            runningCount: entries.length
        }));
        dock.replaceChildren(contentDiv);
    }

    renderPromptProgressTable(dock, entries = this.promptProgressEntries, tableHeaderHtml, renderTimestamp) {
        const headerDiv = this.createPromptProgressHeader(renderTimestamp);
        const contentDiv = document.createElement('div');
        contentDiv.className = 'prompt-progress-dock__content';

        const { table, tableWrap, tbody } = this.ensurePromptProgressTable(tableHeaderHtml);
        const rowsFragment = document.createDocumentFragment();
        const rows = entries.length ? entries : [this.createIdlePromptProgressEntry()];
        rows.forEach(entry => {
            const row = this.createPromptProgressTableRow(entry);
            if (!entries.length) {
                row.classList.add('prompt-progress-row-idle');
            }
            rowsFragment.appendChild(row);
        });
        tbody.replaceChildren(rowsFragment);
        contentDiv.appendChild(tableWrap);
        dock.replaceChildren(headerDiv, contentDiv);
        this.updatePromptProgressMinTableWidth(table);
    }

    renderPromptProgress(entries = []) {
        if (!Array.isArray(entries)) {
            return;
        }
        this.promptProgressEntries = entries.filter(entry => entry && typeof entry === 'object');
        const dock = this.ensurePromptProgressDock();
        this.promptProgressMessage = dock;
        const tableHeaderHtml = '<tr><th class="prompt-progress-cancel-header">Actions</th><th>Prompt</th><th>Progress</th><th>Model</th><th>Received</th><th>Seconds</th><th>Timeout In</th><th>Latency</th><th>Retries</th></tr>';
        const renderTimestamp = () => currentChatTimestampString();

        if (this.promptProgressHideTimer) {
            clearTimeout(this.promptProgressHideTimer);
            this.promptProgressHideTimer = null;
        }

        this.updatePromptProgressFavicon(this.promptProgressEntries).catch(error => {
            console.warn('Failed to update prompt progress favicon:', error);
        });
        dock.hidden = false;
        this.updatePromptProgressDockStateClasses();
        this.updateModalPromptProgressBars();

        if (this.promptProgressDockState === 'collapsed') {
            this.renderPromptProgressCollapsed(dock, this.promptProgressEntries);
            this.syncPromptProgressViewers();
            return;
        }

        if (this.promptProgressDockState === 'one-line') {
            this.renderPromptProgressOneLine(dock, this.promptProgressEntries);
            this.syncPromptProgressViewers();
            return;
        }

        this.renderPromptProgressTable(dock, this.promptProgressEntries, tableHeaderHtml, renderTimestamp);
        this.syncPromptProgressViewers();
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
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: this.clientId
                })
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
        this.schedulePromptProgressRender([], { force: true });
        this.restorePromptProgressFavicon();

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
            this.schedulePromptProgressRender([], { force: true });
            return;
        }
        if (entries.length) {
            const hasCompletedEntry = entries.some(entry => entry?.isComplete === true);
            this.schedulePromptProgressRender(entries, { force: hasCompletedEntry });
        }
    }

    handlePromptProgressGroupFailure(payload) {
        const progressGroupId = typeof payload?.progressGroupId === 'string'
            ? payload.progressGroupId.trim()
            : '';
        if (!progressGroupId || !Array.isArray(payload?.failedResponses)) {
            throw new Error('Invalid prompt_progress_group_failure payload.');
        }
        const failedResponses = payload.failedResponses.filter(response => typeof response === 'string');
        const failedPromptId = typeof payload.promptId === 'string' ? payload.promptId : null;

        this.promptProgressEntries = this.promptProgressEntries.map(entry => {
            if (entry?.progressGroupId !== progressGroupId) {
                return entry;
            }
            return {
                ...entry,
                failedResponses: [...failedResponses],
                responseFailed: !failedPromptId || entry.id === failedPromptId
            };
        });

        for (const viewerState of this.promptProgressViewerWindows.values()) {
            if (viewerState?.progressGroupId !== progressGroupId || !viewerState.lastEntry) {
                continue;
            }
            viewerState.lastEntry = {
                ...viewerState.lastEntry,
                failedResponses: [...failedResponses],
                responseFailed: !failedPromptId || viewerState.lastEntry.id === failedPromptId
            };
        }
        this.renderPromptProgress(this.promptProgressEntries);
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
                httpResolved: false,
                streamComplete: false,
                streamMeta: null,
                isTravelRequest: false,
                suppressTravelCompletionSound: false,
                travelCompletionSoundSource: null,
                travelCompletionReady: false,
                travelCompletionPlayed: false,
                requestStatusSpinnerActive: false,
                requestStatusSpinnerMessage: '',
                requestStatusSpinnerUpdatedAt: 0
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

    updateStatusMessage(requestId, message, { stage = null, scope = 'chat' } = {}) {
        if (!requestId) {
            return;
        }
        const context = this.ensureRequestContext(requestId);
        if (!context) {
            return;
        }

        this.showRequestStatusSpinner(requestId, message, { stage, scope });
    }

    showRequestStatusSpinner(requestId, message, { stage = null, scope = 'chat' } = {}) {
        if (!requestId) {
            return;
        }
        const context = this.ensureRequestContext(requestId);
        if (!context) {
            return;
        }

        const statusMessage = typeof message === 'string' && message.trim()
            ? message.trim()
            : 'Processing...';
        context.requestStatusSpinnerActive = true;
        context.requestStatusSpinnerMessage = statusMessage;
        context.requestStatusSpinnerStage = stage || '';
        context.requestStatusSpinnerScope = scope || 'chat';
        context.requestStatusSpinnerUpdatedAt = Date.now();

        try {
            window.showLocationOverlay?.(statusMessage);
        } catch (error) {
            console.debug('Failed to show chat status spinner:', error);
        }
    }

    getActiveRequestStatusSpinnerContext() {
        let activeContext = null;
        for (const context of this.pendingRequests.values()) {
            if (!context?.requestStatusSpinnerActive) {
                continue;
            }
            if (!activeContext
                || (context.requestStatusSpinnerUpdatedAt || 0) > (activeContext.requestStatusSpinnerUpdatedAt || 0)) {
                activeContext = context;
            }
        }
        return activeContext;
    }

    hideRequestStatusSpinner(requestId) {
        if (!requestId) {
            return;
        }
        const context = this.pendingRequests.get(requestId);
        if (context) {
            context.requestStatusSpinnerActive = false;
            context.requestStatusSpinnerMessage = '';
            context.requestStatusSpinnerStage = '';
            context.requestStatusSpinnerScope = '';
            context.requestStatusSpinnerUpdatedAt = 0;
        }

        if (this.pendingMoveOverlay) {
            return;
        }

        const activeContext = this.getActiveRequestStatusSpinnerContext();
        if (activeContext?.requestStatusSpinnerMessage) {
            try {
                window.showLocationOverlay?.(activeContext.requestStatusSpinnerMessage);
            } catch (error) {
                console.debug('Failed to restore chat status spinner:', error);
            }
            return;
        }

        try {
            window.hideLocationOverlay?.();
        } catch (error) {
            console.debug('Failed to hide chat status spinner:', error);
        }
    }

    removeStatusMessage(requestId) {
        if (!requestId) {
            return;
        }
        this.hideRequestStatusSpinner(requestId);
    }

    init() {
        this.bindEvents();
        this.setupChatBubbleFilter();
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

    navigateInputHistory(key, currentValue = '') {
        if (!this.messageInput || !this.inputHistory.length) {
            return false;
        }
        if (key !== 'ArrowUp' && key !== 'ArrowDown') {
            return false;
        }

        const selectionStart = this.messageInput.selectionStart ?? 0;
        const selectionEnd = this.messageInput.selectionEnd ?? 0;
        const selectionCollapsed = selectionStart === selectionEnd;
        if (!selectionCollapsed) {
            return false;
        }

        const atEnd = selectionStart === currentValue.length && selectionEnd === currentValue.length;

        if (key === 'ArrowUp') {
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
            if (!atEnd) {
                return false;
            }
            if (this.inputHistoryIndex === null) {
                return false;
            }
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

    handleInputHistoryNavigation(event) {
        if (!event || !this.messageInput) {
            return false;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
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
        if (!selectionCollapsed) {
            return false;
        }

        window.requestAnimationFrame(() => {
            if (!this.messageInput || document.activeElement !== this.messageInput) {
                return;
            }

            const nextValue = this.messageInput.value || '';
            const nextSelectionStart = this.messageInput.selectionStart ?? 0;
            const nextSelectionEnd = this.messageInput.selectionEnd ?? 0;
            const caretMoved = nextSelectionStart !== selectionStart || nextSelectionEnd !== selectionEnd;
            const valueChanged = nextValue !== currentValue;
            if (caretMoved || valueChanged) {
                return;
            }

            this.navigateInputHistory(key, nextValue);
        });

        return false;
    }

    bindEvents() {
        this.sendButton.addEventListener('click', () => this.sendMessage());
        if (this.abortTurnButton) {
            this.abortTurnButton.addEventListener('click', () => {
                void this.cancelAllPromptsAndLoadLatestAutosave({
                    triggerButton: this.abortTurnButton
                });
            });
        }

        document.addEventListener('click', (event) => {
            const trigger = event.target?.closest?.('.event-summary-new-exit-pill[data-new-exit-summary-payload]');
            if (!trigger) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            let metadata = null;
            try {
                metadata = JSON.parse(trigger.dataset.newExitSummaryPayload || 'null');
            } catch (error) {
                console.warn('Failed to parse new exit summary map target:', error);
                return;
            }
            dispatchNewExitSummarySelected(trigger, metadata);
        });

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

    appendChatBubble({ className, senderText, contentDiv, bubbleType, scroll = true, decorate = null }) {
        const messageDiv = document.createElement('div');
        messageDiv.className = className;

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = senderText;

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = currentChatTimestampString();

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        if (typeof decorate === 'function') {
            decorate(messageDiv);
        } else {
            this.decorateChatBubbleElement(messageDiv, bubbleType);
        }
        this.chatLog.appendChild(messageDiv);
        if (scroll) {
            this.scrollToBottom();
        }
        return messageDiv;
    }

    appendMessageSections(container, { senderDiv, bodyDiv, timestampText, actions }) {
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = timestampText;

        container.appendChild(senderDiv);
        container.appendChild(bodyDiv);
        container.appendChild(timestampDiv);

        if (actions) {
            container.appendChild(actions);
        }
    }

    addMessage(sender, content, isError = false, debugInfo = null, options = {}) {
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        const allowMarkdown = options.allowMarkdown !== false;
        const disableMarkdown = sender === 'user'
            && typeof content === 'string'
            && content.charAt(0) === '#';
        this.setMessageContent(contentDiv, content, { allowMarkdown: allowMarkdown && !disableMarkdown });

        // Add debug information if available (for AI responses)
        const bubbleType = options.bubbleType || (isError ? 'error' : (sender === 'user' ? 'user' : sender || 'assistant'));
        return this.appendChatBubble({
            className: `message ${sender === 'user' ? 'user-message' : 'ai-message'}${isError ? ' error' : ''}`,
            senderText: sender === 'user' ? '👤 You' : '🤖 AI Game Master',
            contentDiv,
            decorate: (messageDiv) => this.decorateChatBubbleElement(messageDiv, options.bubbleType || bubbleType)
        });
    }

    addNpcMessage(npcName, content) {
        if (!content) {
            return;
        }

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        this.setMessageContent(contentDiv, content, { allowMarkdown: true });

        this.appendChatBubble({
            className: 'message ai-message',
            senderText: `🧑 ${npcName || 'NPC'}`,
            contentDiv,
            bubbleType: 'npc-message'
        });
    }

    updateRegisteredNpcTurnMessage(turn) {
        if (!turn || !turn.response) {
            return false;
        }

        let registered = turn.timestamp ? this.messageRegistry.get(turn.timestamp) : null;
        if (!registered?.element && turn.entryId) {
            const existingElement = Array.from(this.chatLog?.querySelectorAll?.('.message') || [])
                .find(element => element?.dataset?.entryId === turn.entryId);
            if (existingElement) {
                registered = {
                    entry: registered?.entry || null,
                    element: existingElement
                };
            }
        }

        const element = registered?.element;
        if (!element) {
            return false;
        }

        const npcName = turn.name || 'NPC';
        const senderDiv = element.querySelector('.message-sender');
        if (senderDiv) {
            senderDiv.textContent = `🧑 ${npcName}`;
        }

        const contentDiv = element.querySelector('.message-content');
        if (contentDiv) {
            this.setMessageContent(contentDiv, turn.response, { allowMarkdown: true });
        }

        if (turn.entryId) {
            element.dataset.entryId = turn.entryId;
        }
        if (turn.timestamp) {
            element.dataset.timestamp = turn.timestamp;
            this.messageRegistry.set(turn.timestamp, {
                entry: {
                    ...(registered.entry || {}),
                    id: turn.entryId || registered.entry?.id || null,
                    role: 'assistant',
                    actor: turn.name || registered.entry?.actor || null,
                    content: turn.response,
                    isNpcTurn: true,
                    timestamp: turn.timestamp
                },
                element
            });
        }

        this.scrollToBottom();
        return true;
    }


    normalizeTurnDiffCategory(category, fallback = 'other') {
        const candidate = typeof category === 'string' ? category.trim() : '';
        if (candidate && TURN_DIFF_CATEGORIES.has(candidate)) {
            return candidate;
        }
        return TURN_DIFF_CATEGORIES.has(fallback) ? fallback : 'other';
    }

    normalizeTurnDiffSeverity(severity, fallback = 'normal') {
        const candidate = typeof severity === 'string' ? severity.trim().toLowerCase() : '';
        if (candidate && TURN_DIFF_SEVERITIES.has(candidate)) {
            return candidate;
        }
        return TURN_DIFF_SEVERITIES.has(fallback) ? fallback : 'normal';
    }

    normalizeTurnDiffSourceType(sourceType) {
        const candidate = typeof sourceType === 'string' ? sourceType.trim() : '';
        return candidate || null;
    }

    normalizeTurnDiffEntityRefs(entityRefs) {
        if (!Array.isArray(entityRefs)) {
            return [];
        }
        return entityRefs
            .map(ref => {
                if (!ref || typeof ref !== 'object') {
                    return null;
                }
                const type = typeof ref.type === 'string' ? ref.type.trim().toLowerCase() : '';
                const id = typeof ref.id === 'string' ? ref.id.trim() : '';
                const name = typeof ref.name === 'string' ? ref.name.trim() : '';
                if (!type || (!id && !name)) {
                    return null;
                }
                return { type, id: id || null, name: name || null };
            })
            .filter(Boolean);
    }

    normalizeTurnDiffMetadata(metadata) {
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            return null;
        }
        try {
            return JSON.parse(JSON.stringify(metadata));
        } catch (error) {
            console.warn('Failed to serialize turn diff metadata:', error.message);
            return null;
        }
    }

    normalizeDispositionSummaryItem(item) {
        if (!item || typeof item !== 'object') {
            return null;
        }
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) {
            return null;
        }

        const metadata = item.metadata && typeof item.metadata === 'object'
            ? item.metadata.dispositionChange
            : null;
        const parsed = text.match(/^(.+?)'s\s+(.+?)\s+disposition\s+Δ\s+([+-]?\d+)/i);
        const npcName = typeof metadata?.npcName === 'string' && metadata.npcName.trim()
            ? metadata.npcName.trim()
            : (parsed ? parsed[1].trim() : 'Someone');
        const typeLabel = typeof metadata?.typeLabel === 'string' && metadata.typeLabel.trim()
            ? metadata.typeLabel.trim()
            : (parsed ? parsed[2].trim() : 'Disposition');
        const metadataDelta = Number(metadata?.delta);
        const parsedDelta = parsed ? Number(parsed[3]) : NaN;
        const delta = Number.isFinite(metadataDelta)
            ? metadataDelta
            : (Number.isFinite(parsedDelta) ? parsedDelta : null);
        const icon = typeof metadata?.icon === 'string' && metadata.icon.trim()
            ? metadata.icon.trim()
            : (typeof item.icon === 'string' && item.icon.trim() ? item.icon.trim() : '💞');
        const npcId = typeof metadata?.npcId === 'string' && metadata.npcId.trim()
            ? metadata.npcId.trim()
            : null;

        if (Number.isFinite(delta) && delta === 0) {
            return null;
        }

        return {
            npcId,
            npcName,
            typeLabel,
            icon,
            delta,
            text,
            item
        };
    }

    groupDispositionSummaryItems(items) {
        const groups = new Map();
        (Array.isArray(items) ? items : []).forEach(item => {
            const normalized = this.normalizeDispositionSummaryItem(item);
            if (!normalized) {
                return;
            }
            const groupKey = normalized.npcId || normalized.npcName.toLowerCase();
            if (!groups.has(groupKey)) {
                groups.set(groupKey, {
                    npcName: normalized.npcName,
                    changes: []
                });
            }
            groups.get(groupKey).changes.push(normalized);
        });
        return Array.from(groups.values()).filter(group => group.changes.length);
    }

    hasOnlyDispositionSummaryItems(items) {
        const sourceItems = (Array.isArray(items) ? items : [])
            .filter(item => item && typeof item === 'object' && item.text);
        return sourceItems.length > 0 && sourceItems.every(item => Boolean(this.normalizeDispositionSummaryItem(item)));
    }

    createDispositionSummaryRows(items) {
        const groups = this.groupDispositionSummaryItems(items);
        if (!groups.length) {
            return null;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'disposition-summary-rows';

        groups.forEach(group => {
            const details = document.createElement('details');
            details.className = 'disposition-summary-row';

            const summary = document.createElement('summary');
            summary.className = 'disposition-summary-row__summary';

            const name = document.createElement('strong');
            name.className = 'disposition-summary-row__name';
            name.textContent = group.npcName;
            summary.appendChild(name);
            summary.appendChild(document.createTextNode(': '));

            const pills = document.createElement('span');
            pills.className = 'disposition-summary-row__pills';
            group.changes.forEach(change => {
                if (!Number.isFinite(change.delta) || change.delta === 0) {
                    return;
                }
                const pill = document.createElement('span');
                pill.className = 'disposition-summary-row__pill';
                pill.title = change.typeLabel;
                const sign = change.delta > 0 ? '+' : '';
                pill.textContent = `${change.icon}${sign}${Math.round(change.delta)}`;
                pills.appendChild(pill);
            });
            summary.appendChild(pills);
            details.appendChild(summary);

            const body = document.createElement('div');
            body.className = 'disposition-summary-row__details';
            const list = document.createElement('ul');
            list.className = 'event-summary-list disposition-summary-row__detail-list';
            group.changes.forEach(change => {
                const li = document.createElement('li');
                const iconSpan = document.createElement('span');
                iconSpan.className = 'event-summary-icon';
                iconSpan.textContent = change.icon || '💞';
                li.appendChild(iconSpan);
                li.appendChild(document.createTextNode(' '));
                const textSpan = document.createElement('span');
                textSpan.className = 'event-summary-text';
                this.setMessageContent(textSpan, change.text, { allowMarkdown: true });
                li.appendChild(textSpan);
                list.appendChild(li);
            });
            body.appendChild(list);
            details.appendChild(body);
            wrapper.appendChild(details);
        });

        return wrapper;
    }

    addEventSummary(icon, summaryText, category = 'other', metadata = {}) {
        const item = icon && typeof icon === 'object' && !Array.isArray(icon) ? icon : null;
        const resolvedText = item ? item.text : summaryText;
        if (!resolvedText) {
            return;
        }

        if (this.pushEventBundleItem(item || icon || '📣', resolvedText, category, metadata)) {
            return;
        }

        this.renderStandaloneEventSummary(item?.icon || icon, resolvedText, item);
    }

    addStatusSummary(icon, summaryText, category = 'status', metadata = {}) {
        if (!summaryText) {
            return;
        }

        if (this.pushStatusBundleItem(icon || '🌀', summaryText, category, metadata)) {
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

        if (this.pushEventBundleItem('✨', summaryText, 'quest_reward')) {
            return;
        }

        const contentDiv = document.createElement('div');
        this.setMessageContent(contentDiv, summaryText, { allowMarkdown: true });

        this.appendChatBubble({
            className: 'message event-summary xp-award',
            senderText: '✨ Experience Gained',
            contentDiv,
            bubbleType: 'event-summary'
        });
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

        if (this.pushEventBundleItem('💰', summaryText, 'quest_reward')) {
            return;
        }

        const contentDiv = document.createElement('div');
        this.setMessageContent(contentDiv, summaryText, { allowMarkdown: true });

        this.appendChatBubble({
            className: 'message event-summary currency-change',
            senderText: '💰 Currency Update',
            contentDiv,
            bubbleType: 'event-summary'
        });
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

        const resolveNeedBarIcon = (change) => {
            const directIcon = typeof change?.needBarIcon === 'string' ? change.needBarIcon.trim() : '';
            if (directIcon) {
                return directIcon;
            }

            const barName = typeof change?.needBarName === 'string'
                ? change.needBarName.trim().toLowerCase()
                : (typeof change?.bar === 'string' ? change.bar.trim().toLowerCase() : '');
            const match = findNeedBarDefinition(change, barName);

            const fallbackIcon = typeof match?.icon === 'string' ? match.icon.trim() : '';
            return fallbackIcon || '🧪';
        };

        const toNeedBarSummaryItem = (change) => {
            if (!change) {
                return null;
            }
            const actorName = change.actorName || change.actorId || 'Unknown';
            const barName = change.needBarName || change.needBar || change.bar || change.needBarId || 'Need Bar';
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
            const deltaText = this.formatNeedBarDelta(change, delta, barName, { roundNonHealth: true });
            if (deltaText) {
                segments.push(`Δ ${deltaText}`);
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

            const icon = resolveNeedBarIcon(change);
            const text = segments.join(' ');
            return {
                icon,
                text,
                category: 'needs',
                sourceType: 'need_bar_change',
                entityRefs: this.normalizeTurnDiffEntityRefs([{
                    type: 'npc',
                    id: change.actorId || null,
                    name: actorName
                }]),
                metadata: {
                    needBarChange: {
                        actorId: change.actorId || null,
                        actorName,
                        needBarId: change.needBarId || change.id || null,
                        needBarName: barName,
                        icon,
                        delta: Number.isFinite(delta) ? delta : null,
                        deltaText,
                        direction: direction || null,
                        magnitude: magnitude || null,
                        max: Number.isFinite(Number(change.max)) ? Number(change.max) : null,
                        reason: reason || null,
                        text
                    }
                }
            };
        };

        if (this.activeEventBundle) {
            items.forEach(change => {
                const summaryItem = toNeedBarSummaryItem(change);
                if (summaryItem) {
                    this.addEventSummary(summaryItem);
                }
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

        let appendedCount = 0;
        items.forEach(change => {
            if (!change) {
                return;
            }
            const actorName = change.actorName || change.actorId || 'Unknown';
            const barName = change.needBarName || change.needBar || change.bar || change.needBarId || 'Need Bar';
            const delta = Number(change.delta);
            const newValue = Number(change.newValue);
            const maxValue = Number(change.max);
            const isHealthChange = this.isHealthNeedBarChange(change, barName);
            const magnitudeLabel = capitalize(change.magnitude || '');
            const directionLabel = capitalize(change.direction || '');
            const reason = typeof change.reason === 'string' ? change.reason.trim() : '';

            const segments = [];
            segments.push(`<strong>${this.escapeHtml(String(actorName))}</strong> – ${this.escapeHtml(String(barName))}`);

            const deltaText = this.formatNeedBarDelta(change, delta, barName);
            if (deltaText) {
                segments.push(deltaText);
            } else if (change.magnitude === 'all' || change.magnitude === 'fill') {
                segments.push('Adjusted to limit');
            }

            if (Number.isFinite(newValue)) {
                const displayNewValue = isHealthChange
                    ? this.formatHealthDisplayValue(newValue)
                    : newValue;
                const displayMaxValue = isHealthChange
                    ? this.formatHealthDisplayValue(maxValue)
                    : maxValue;
                const capText = Number.isFinite(maxValue) && displayMaxValue !== null
                    ? `/${displayMaxValue}`
                    : '';
                segments.push(`now ${displayNewValue}${capText}`);
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

            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = segments.join(' ');

            this.appendChatBubble({
                className: 'message event-summary needbar-change',
                senderText: `${resolveNeedBarIcon(change)} Need Bar Update`,
                contentDiv,
                bubbleType: 'event-summary',
                scroll: false
            });
            appendedCount += 1;
        });

        if (!appendedCount) {
            return;
        }
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

        if (this.pushEventBundleItem(isHealing ? '🌿' : '☠️', summaryMessage, 'character')) {
            return;
        }

        const contentDiv = document.createElement('div');
        this.setMessageContent(contentDiv, summaryMessage, { allowMarkdown: true });

        this.appendChatBubble({
            className: 'message event-summary environmental-damage',
            senderText: isHealing ? '🌿 Environmental Healing' : '☠️ Environmental Damage',
            contentDiv,
            bubbleType: 'event-summary'
        });
    }

    addDispositionChanges(changes) {
        if (!Array.isArray(changes) || !changes.length) {
            return;
        }

        const items = changes.filter(Boolean);
        if (!items.length) {
            return;
        }

        const toSummaryItem = (change) => {
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
                return null;
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
            const icon = typeof change.typeIcon === 'string' && change.typeIcon.trim()
                ? change.typeIcon.trim()
                : (typeof change.icon === 'string' && change.icon.trim() ? change.icon.trim() : '💞');
            return {
                icon,
                text: summary,
                category: 'disposition',
                sourceType: 'disposition_change',
                entityRefs: this.normalizeTurnDiffEntityRefs([{
                    type: 'npc',
                    id: change.npcId || null,
                    name: npcName
                }]),
                metadata: {
                    dispositionChange: {
                        npcId: change.npcId || null,
                        npcName,
                        typeKey: change.typeKey || null,
                        typeLabel,
                        icon,
                        delta: Math.round(delta),
                        previousValue: Number.isFinite(previousRaw) ? previousRaw : null,
                        newValue: Number.isFinite(newRaw) ? newRaw : null,
                        reason: reason || null,
                        text: summary
                    }
                }
            };
        };

        if (this.activeEventBundle) {
            items.forEach(change => {
                const summaryItem = toSummaryItem(change);
                if (summaryItem) {
                    this.addEventSummary(summaryItem);
                }
            });
            this.markEventBundleRefresh();
            return;
        }

        const summaryItems = items
            .map(toSummaryItem)
            .filter(Boolean);
        if (!summaryItems.length) {
            return;
        }
        this.renderDispositionSummaryBatch(summaryItems);
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
                    this.addEventSummary('🏳️', summary, 'faction_relationship');
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
                    this.addEventSummary('🚶', `Travelled to ${destination}.`, 'travel');
                }
                travelledTo.add(destination);
            });
        };

        const handlers = {
            attack_damage: (entries) => {
                entries.forEach((entry) => {
                    const attacker = safeName(entry?.attacker);
                    const target = safeName(entry?.target || 'their target');
                    this.addEventSummary('⚔️', `${attacker} attacked ${target}.`, 'character');
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
                            this.addEventSummary('🧪', `${consumer} consumed ${itemName}.${detailText}`, 'inventory');
                        } else {
                            this.addEventSummary('🧪', `${itemName} was consumed or destroyed.${detailText}`, 'inventory');
                        }
                    } else {
                        const itemName = safeItem(entry, 'An item');
                        this.addEventSummary('🧪', `${itemName} was consumed or destroyed.`, 'inventory');
                    }
                });
            },
            death_incapacitation: (entries) => {
                entries.forEach((entry) => {
                    const status = typeof entry?.status === 'string' ? entry.status.trim().toLowerCase() : null;
                    const target = safeName(entry?.name ?? entry);
                    if (status === 'dead') {
                        this.addEventSummary('☠️', `${target} was killed.`, 'character');
                    } else {
                        this.addEventSummary('☠️', `${target} was incapacitated.`, 'character');
                    }
                });
            },
            drop_item: (entries) => {
                entries.forEach((entry) => {
                    const character = safeName(entry?.character);
                    const item = safeItem(entry?.item);
                    this.addEventSummary('📦', `${character} dropped ${item}.`, 'inventory');
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

                    this.addEventSummary('💖', summary, 'character');
                });
            },
            scenery_appear: (entries) => {
                entries.forEach((item) => {
                    const itemName = safeItem(item);
                    this.addEventSummary('✨', `${itemName} appeared in the scene.`, 'location_world');
                });
            },
            item_appear: (entries) => {
                entries.forEach((item) => {
                    const itemName = safeItem(item);
                    this.addEventSummary('✨', `${itemName} appeared in the scene.`, 'location_world');
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
                const currentLocationSummaryContext = getCurrentNewExitSummaryContext();
                entries.forEach((description) => {
                    const detail = formatNewExitDiscoveredSummaryDetail(
                        description,
                        currentLocationSummaryContext
                    );
                    const newExitMetadata = buildNewExitDiscoveredSummaryMetadata(
                        description,
                        detail
                    );
                    this.addEventSummary({
                        icon: '🚪',
                        text: `New exit discovered: ${detail}.`,
                        category: 'travel',
                        severity: 'important',
                        sourceType: 'new_exit_discovered',
                        metadata: newExitMetadata
                            ? { newExitDiscovered: newExitMetadata }
                            : null
                    });
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
                        this.addEventSummary('🙋', `${name} arrived at the location.`, 'npc_party');
                    } else if (action === 'left') {
                        const detail = destinationText ? ` for ${destinationText}` : '';
                        this.addEventSummary('🏃', `${name} left the area${detail}.`, 'npc_party');
                    } else {
                        this.addEventSummary('📍', `${name} ${entry?.action || 'moved'}.`, 'npc_party');
                    }
                });
            },
            party_change: (entries) => {
                entries.forEach((entry) => {
                    const name = safeName(entry?.name);
                    const action = (entry?.action || '').trim().toLowerCase();
                    if (action === 'joined') {
                        this.addEventSummary('🤝', `${name} joined the party.`, 'npc_party');
                    } else if (action === 'left') {
                        this.addEventSummary('👋', `${name} left the party.`, 'npc_party');
                    } else {
                        this.addEventSummary('📣', `${name} ${entry?.action || 'changed party status'}.`, 'npc_party');
                    }
                });
            },
            harvest_gather: (entries) => {
                entries.forEach((entry) => {
                    const actor = safeName(entry?.harvester);
                    const itemName = safeItem(entry?.item);
                    const sourceName = safeItem(entry?.source, '');
                    const fromClause = sourceName ? ` from ${sourceName}` : '';
                    this.addEventSummary('🌾', `${actor} harvested ${itemName}${fromClause}.`, 'inventory');
                });
            },
            pick_up_item: (entries) => {
                entries.forEach((entry) => {
                    const actor = safeName(entry?.name);
                    const itemName = safeItem(entry?.item);
                    this.addEventSummary('🎒', `${actor} picked up ${itemName}.`, 'inventory');
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
                    this.addEventSummary('🔄', `${giver} gave ${item} to ${receiver}.`, 'inventory');
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
                    this.addEventSummary('🛠️', text, 'inventory');
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
                    this.addEventSummary('🏙️', summaryText, 'location_world');
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
                    this.addEventSummary('🧬', text, 'character');
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

    renderStandaloneEventSummary(icon, summaryText, item = null) {
        const contentDiv = document.createElement('div');
        if (item && typeof item === 'object' && item.metadata?.newExitDiscovered) {
            const list = document.createElement('ul');
            list.className = 'event-summary-list';
            const li = document.createElement('li');
            const iconSpan = document.createElement('span');
            iconSpan.className = 'event-summary-icon';
            iconSpan.textContent = item.icon || icon || '•';
            li.appendChild(iconSpan);
            li.appendChild(document.createTextNode(' '));
            this.appendEventSummaryItemContent(li, item);
            list.appendChild(li);
            contentDiv.appendChild(list);
        } else {
            this.setMessageContent(contentDiv, summaryText, { allowMarkdown: true });
        }

        this.appendChatBubble({
            className: 'message event-summary',
            senderText: `${icon || '📣'} Event`,
            contentDiv,
            bubbleType: 'event-summary'
        });
    }

    renderDispositionSummaryBatch(items) {
        if (!Array.isArray(items) || !items.length) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message event-summary-batch disposition-summary-batch';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = '💞 Disposition Changes';

        const contentDiv = document.createElement('div');
        const rows = this.createDispositionSummaryRows(items);
        if (!rows) {
            return;
        }

        contentDiv.appendChild(rows);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = currentChatTimestampString();

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.decorateChatBubbleElement(messageDiv, 'event-summary');
        this.chatLog.appendChild(messageDiv);
        this.scrollToBottom();
    }

    renderStandaloneStatusSummary(icon, summaryText) {
        const contentDiv = document.createElement('div');
        this.setMessageContent(contentDiv, summaryText, { allowMarkdown: true });

        this.appendChatBubble({
            className: 'message status-summary',
            senderText: `${icon || '🌀'} Status Change`,
            contentDiv,
            bubbleType: 'status-summary'
        });
    }

    pushEventBundleItem(icon, text, category = 'other', metadata = {}) {
        if (!this.activeEventBundle) {
            return false;
        }
        const item = icon && typeof icon === 'object' && !Array.isArray(icon)
            ? icon
            : { icon, text, category, ...metadata };
        if (!item.text) {
            return true;
        }
        this.activeEventBundle.items.push({
            icon: item.icon || '•',
            text: item.text,
            category: this.normalizeTurnDiffCategory(item.category),
            severity: this.normalizeTurnDiffSeverity(item.severity),
            sourceType: this.normalizeTurnDiffSourceType(item.sourceType),
            entityRefs: this.normalizeTurnDiffEntityRefs(item.entityRefs),
            metadata: this.normalizeTurnDiffMetadata(item.metadata)
        });
        return true;
    }

    pushStatusBundleItem(icon, text, category = 'status', metadata = {}) {
        if (!this.activeStatusBundle) {
            return false;
        }
        const item = icon && typeof icon === 'object' && !Array.isArray(icon)
            ? icon
            : { icon, text, category, ...metadata };
        if (!item.text) {
            return true;
        }
        this.activeStatusBundle.items.push({
            icon: item.icon || '•',
            text: item.text,
            category: this.normalizeTurnDiffCategory(item.category, 'status'),
            severity: this.normalizeTurnDiffSeverity(item.severity),
            sourceType: this.normalizeTurnDiffSourceType(item.sourceType || 'status_effect_change'),
            entityRefs: this.normalizeTurnDiffEntityRefs(item.entityRefs),
            metadata: this.normalizeTurnDiffMetadata(item.metadata)
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

    startEventBundle(parentElement = null) {
        if (this.activeEventBundle) {
            if (parentElement && !this.activeEventBundle.parentElement) {
                this.activeEventBundle.parentElement = parentElement;
            }
            return this.activeEventBundle;
        }
        this.activeEventBundle = {
            items: [],
            refresh: false,
            timestamp: new Date().toISOString(),
            parentElement
        };
        return this.activeEventBundle;
    }

    startStatusBundle(parentElement = null) {
        if (this.activeStatusBundle) {
            if (parentElement && !this.activeStatusBundle.parentElement) {
                this.activeStatusBundle.parentElement = parentElement;
            }
            return this.activeStatusBundle;
        }
        this.activeStatusBundle = {
            items: [],
            timestamp: new Date().toISOString(),
            parentElement
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

        if (bundle.parentElement) {
            this.appendTurnDiffDrawer(bundle.parentElement, [{
                type: 'event-summary',
                summaryTitle: '📋 Events',
                summaryItems: bundle.items.map(item => ({
                    icon: item.icon || '•',
                    text: item.text || '',
                    category: this.normalizeTurnDiffCategory(item.category),
                    severity: this.normalizeTurnDiffSeverity(item.severity),
                    sourceType: this.normalizeTurnDiffSourceType(item.sourceType),
                    entityRefs: this.normalizeTurnDiffEntityRefs(item.entityRefs),
                    metadata: this.normalizeTurnDiffMetadata(item.metadata)
                })),
                timestamp: bundle.timestamp || new Date().toISOString()
            }]);
            this.scrollToBottom();
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
        const dispositionRows = this.createDispositionSummaryRows(bundle.items);

        if (dispositionRows && this.hasOnlyDispositionSummaryItems(bundle.items)) {
            contentDiv.appendChild(dispositionRows);
        } else {
            bundle.items.forEach(item => {
                const li = document.createElement('li');
                const iconSpan = document.createElement('span');
                iconSpan.className = 'event-summary-icon';
                iconSpan.textContent = item.icon || '•';
                li.appendChild(iconSpan);
                li.appendChild(document.createTextNode(' '));
                this.appendEventSummaryItemContent(li, item);
                list.appendChild(li);
            });

            contentDiv.appendChild(list);
        }

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        const timestamp = bundle.timestamp || new Date().toISOString();
        timestampDiv.textContent = timestamp.replace('T', ' ').replace('Z', '');

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.decorateChatBubbleElement(messageDiv, 'event-summary');
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

        if (bundle.parentElement) {
            this.appendTurnDiffDrawer(bundle.parentElement, [{
                type: 'status-summary',
                summaryTitle: '🌀 Status Changes',
                summaryItems: bundle.items.map(item => ({
                    icon: item.icon || '•',
                    text: item.text || '',
                    category: this.normalizeTurnDiffCategory(item.category, 'status'),
                    severity: this.normalizeTurnDiffSeverity(item.severity),
                    sourceType: this.normalizeTurnDiffSourceType(item.sourceType || 'status_effect_change'),
                    entityRefs: this.normalizeTurnDiffEntityRefs(item.entityRefs),
                    metadata: this.normalizeTurnDiffMetadata(item.metadata)
                })),
                timestamp: bundle.timestamp || new Date().toISOString()
            }]);
            this.scrollToBottom();
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

        this.decorateChatBubbleElement(messageDiv, 'status-summary');
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
        if (!normalized.slopWords.length && !normalized.slopRegexes.length && !normalized.slopNgrams.length) {
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

    buildCollapsibleDetailsMessageElement({
        className,
        type,
        timestamp,
        senderText,
        summaryText,
        bodyHtml,
        contentClass = '',
        bodyClass = '',
        bubbleType
    }) {
        const messageDiv = document.createElement('div');
        messageDiv.className = className;
        messageDiv.dataset.type = type;
        messageDiv.dataset.timestamp = timestamp || '';

        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.textContent = senderText;

        const contentDiv = document.createElement('div');
        if (contentClass) {
            contentDiv.className = contentClass;
        }
        const details = document.createElement('details');
        const summaryEl = document.createElement('summary');
        summaryEl.textContent = summaryText;
        details.appendChild(summaryEl);

        const body = document.createElement('div');
        if (bodyClass) {
            body.className = bodyClass;
        }
        body.innerHTML = bodyHtml;
        details.appendChild(body);

        contentDiv.appendChild(details);

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = this.formatTimestamp(timestamp);

        messageDiv.appendChild(senderDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);

        this.decorateChatBubbleElement(messageDiv, bubbleType);
        return messageDiv;
    }

    buildLabeledModifierLine(label, name, value) {
        if (!name && typeof value !== 'number') {
            return null;
        }
        const parts = [];
        if (name) {
            parts.push(this.escapeHtml(String(name)));
        }
        if (typeof value === 'number') {
            const modifier = formatSignedNumber(value);
            parts.push(modifier !== null ? `(${modifier})` : `(${value})`);
        }
        if (!parts.length) {
            return null;
        }
        return `<li><strong>${label}:</strong> ${parts.join(' ')}</li>`;
    }

    buildCircumstancesLine(roll, { preEscaped = false } = {}) {
        const circumstanceEntries = Array.isArray(roll.circumstanceModifiers)
            ? roll.circumstanceModifiers
            : [];
        const formattedCircumstances = circumstanceEntries
            .map((entry) => {
                const text = formatCircumstanceEntryText(entry);
                return preEscaped && text !== null ? this.escapeHtml(text) : text;
            })
            .filter(Boolean);

        const hasCircumstanceReason = Boolean(roll.circumstanceReason);
        const circumstanceTotalAvailable = typeof roll.circumstanceModifier === 'number' && !Number.isNaN(roll.circumstanceModifier);
        const shouldShowCircumstances = formattedCircumstances.length > 0
            || hasCircumstanceReason
            || (circumstanceTotalAvailable && roll.circumstanceModifier !== 0);

        let line = null;
        if (shouldShowCircumstances) {
            const parts = [];
            if (circumstanceTotalAvailable && (roll.circumstanceModifier !== 0 || formattedCircumstances.length > 0)) {
                const totalText = formatSignedNumber(roll.circumstanceModifier) ?? roll.circumstanceModifier;
                parts.push(`Total ${totalText}`);
            }
            if (formattedCircumstances.length) {
                parts.push(preEscaped
                    ? `<small>${formattedCircumstances.join('<br>')}</small>`
                    : `<small>${formattedCircumstances.map(item => this.escapeHtml(item)).join('<br>')}</small>`);
            } else if (hasCircumstanceReason) {
                parts.push(this.escapeHtml(String(roll.circumstanceReason)));
            }

            line = `<li><strong>Circumstances:</strong> ${parts.join('<br>')}</li>`;
        }

        return { line, formattedCircumstances, circumstanceTotalAvailable };
    }

    buildPlausibilityMessageElement({ data, timestamp }) {
        const markup = this.renderPlausibilityMarkup(data);

        return this.buildCollapsibleDetailsMessageElement({
            className: 'message plausibility-message',
            type: 'plausibility',
            timestamp,
            senderText: '🧭 Plausibility Check',
            summaryText: 'Plausibility Check',
            bodyHtml: markup,
            bubbleType: 'plausibility'
        });
    }

    buildSlopRemovalMessageElement({ data, timestamp }) {
        const markup = this.renderSlopRemovalMarkup(data);
        if (!markup) {
            return null;
        }

        return this.buildCollapsibleDetailsMessageElement({
            className: 'message slop-remover-message',
            type: 'slop-remover',
            timestamp,
            senderText: '🧹 Slop Remover',
            summaryText: 'Slop Remover',
            bodyHtml: markup,
            bubbleType: 'slop-remover'
        });
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

        const lines = [];
        const rawRoll = resolution.roll;
        const roll = rawRoll && typeof rawRoll === 'object' ? rawRoll : {};
        const rawDifficulty = resolution.difficulty;
        const difficulty = rawDifficulty && typeof rawDifficulty === 'object' ? rawDifficulty : {};
        const { skill, attribute, label, reason, margin, type } = resolution;
        const opponent = resolution.opponent && typeof resolution.opponent === 'object'
            ? resolution.opponent
            : null;

        const skillLine = this.buildLabeledModifierLine('Skill', skill, roll.skillValue);
        if (skillLine) {
            lines.push(skillLine);
        }

        const attributeLine = this.buildLabeledModifierLine('Attribute', attribute, roll.attributeBonus);
        if (attributeLine) {
            lines.push(attributeLine);
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

        if (opponent && opponent.name) {
            lines.push(`<li><strong>Opponent:</strong> ${this.escapeHtml(String(opponent.name))}</li>`);
        }

        const opponentSkillLine = opponent
            ? this.buildLabeledModifierLine('Opponent Skill', opponent.skill, roll.opponentSkillValue)
            : null;
        if (opponentSkillLine) {
            lines.push(opponentSkillLine);
        }

        const opponentAttributeLine = opponent
            ? this.buildLabeledModifierLine('Opponent Attribute', opponent.attribute, roll.opponentAttributeBonus)
            : null;
        if (opponentAttributeLine) {
            lines.push(opponentAttributeLine);
        }

        const circumstances = this.buildCircumstancesLine(roll);
        const formattedCircumstances = circumstances.formattedCircumstances;
        if (circumstances.line) {
            lines.push(circumstances.line);
        }

        if (roll && (typeof roll.die === 'number' || typeof roll.total === 'number')) {
            const segments = [];
            if (typeof roll.die === 'number') {
                segments.push(`d20 ${roll.die}`);
            }
            if (typeof roll.skillValue === 'number') {
                const modifier = formatSignedNumber(roll.skillValue);
                segments.push(`Skill ${modifier !== null ? modifier : roll.skillValue}`);
            }
            if (typeof roll.attributeBonus === 'number') {
                const modifier = formatSignedNumber(roll.attributeBonus);
                segments.push(`Attribute ${modifier !== null ? modifier : roll.attributeBonus}`);
            }
            if (typeof roll.circumstanceModifier === 'number'
                && !Number.isNaN(roll.circumstanceModifier)
                && (roll.circumstanceModifier !== 0 || formattedCircumstances.length)) {
                const modifier = formatSignedNumber(roll.circumstanceModifier);
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

        if (roll && (typeof roll.opponentDie === 'number' || typeof roll.opponentTotal === 'number')) {
            const segments = [];
            if (typeof roll.opponentDie === 'number') {
                segments.push(`d20 ${roll.opponentDie}`);
            }
            if (typeof roll.opponentSkillValue === 'number') {
                const modifier = formatSignedNumber(roll.opponentSkillValue);
                segments.push(`Skill ${modifier !== null ? modifier : roll.opponentSkillValue}`);
            }
            if (typeof roll.opponentAttributeBonus === 'number') {
                const modifier = formatSignedNumber(roll.opponentAttributeBonus);
                segments.push(`Attribute ${modifier !== null ? modifier : roll.opponentAttributeBonus}`);
            }
            if (typeof roll.opponentTotal === 'number') {
                segments.push(`Total ${roll.opponentTotal}`);
            }
            let rollText = segments.join(' → ');
            if (roll.opponentDetail) {
                rollText += `<br><small>${this.escapeHtml(String(roll.opponentDetail))}</small>`;
            }
            lines.push(`<li><strong>Opponent Roll:</strong> ${rollText}</li>`);
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

        return this.buildCollapsibleDetailsMessageElement({
            className: 'message skill-check-message',
            type: 'skill-check',
            timestamp,
            senderText: '🎯 Skill Check',
            summaryText: 'Skill Check',
            bodyHtml: `<ul>${lines.join('\n')}</ul>`,
            bodyClass: 'skill-check-details',
            bubbleType: 'skill-check'
        });
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
                const modifier = formatSignedNumber(attacker.attackSkill.value);
                parts.push(modifier !== null ? modifier : String(attacker.attackSkill.value));
            }
            if (typeof attacker.attackSkill.levelBonus === 'number' && attacker.attackSkill.levelBonus !== 0) {
                const levelText = formatSignedNumber(attacker.attackSkill.levelBonus) ?? attacker.attackSkill.levelBonus;
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
                const modifier = formatSignedNumber(attacker.attackAttribute.modifier);
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
                const modifier = formatSignedNumber(defenseSkill.value);
                defenceSegments.push(modifier !== null ? modifier : String(defenseSkill.value));
            }
            if (typeof defenseSkill.levelBonus === 'number' && defenseSkill.levelBonus !== 0) {
                const levelText = formatSignedNumber(defenseSkill.levelBonus) ?? defenseSkill.levelBonus;
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
                    const modifier = formatSignedNumber(defenseSkill.value);
                    defenseSegments.push(modifier !== null ? modifier : String(defenseSkill.value));
                }
                if (typeof defenseSkill.levelBonus === 'number' && defenseSkill.levelBonus !== 0) {
                    const levelText = formatSignedNumber(defenseSkill.levelBonus) ?? defenseSkill.levelBonus;
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
                    const rawText = formatSignedNumber(defenseSkill.rawValue) ?? String(defenseSkill.rawValue);
                    const capText = capValue !== null
                        ? (formatSignedNumber(capValue) ?? String(capValue))
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
        const circumstances = this.buildCircumstancesLine(roll, { preEscaped: true });
        const formattedCircumstances = circumstances.formattedCircumstances;
        const totalCircumstanceAvailable = circumstances.circumstanceTotalAvailable;
        if (circumstances.line) {
            lines.push(circumstances.line);
        }

        if (typeof roll.die === 'number' || typeof roll.total === 'number' || roll.attackSkill || roll.attackAttribute) {
            const rollSegments = [];
            if (typeof roll.die === 'number') {
                rollSegments.push(`d20 ${roll.die}`);
            }
            if (roll.attackSkill && typeof roll.attackSkill.value === 'number') {
                const skillName = roll.attackSkill.name ? `${this.escapeHtml(String(roll.attackSkill.name))} ` : '';
                const modifier = formatSignedNumber(roll.attackSkill.value);
                let skillText = `${skillName}${modifier !== null ? modifier : roll.attackSkill.value}`;
                const skillMods = Array.isArray(roll.attackSkill.modifiers) ? roll.attackSkill.modifiers : [];
                if (skillMods.length) {
                    const modDetails = skillMods
                        .map(entry => {
                            const label = entry?.effectName ? String(entry.effectName) : 'Status Effect';
                            const mod = formatSignedNumber(entry?.modifier);
                            return mod ? `${mod} (${this.escapeHtml(label)})` : null;
                        })
                        .filter(Boolean);
                    if (modDetails.length) {
                        skillText += `<br><small>${modDetails.join('<br>')}</small>`;
                    }
                }
                if (typeof roll.attackSkill.levelBonus === 'number' && roll.attackSkill.levelBonus !== 0) {
                    const levelText = formatSignedNumber(roll.attackSkill.levelBonus) ?? roll.attackSkill.levelBonus;
                    skillText += `<br><small>Level bonus ${levelText}</small>`;
                }
                rollSegments.push(skillText);
            }
            if (roll.attackAttribute && typeof roll.attackAttribute.modifier === 'number') {
                const attrName = roll.attackAttribute.name ? `${this.escapeHtml(String(roll.attackAttribute.name))} ` : '';
                const modifier = formatSignedNumber(roll.attackAttribute.modifier);
                rollSegments.push(`${attrName}${modifier !== null ? modifier : roll.attackAttribute.modifier}`);
            }
            if (totalCircumstanceAvailable
                && (roll.circumstanceModifier !== 0 || formattedCircumstances.length)) {
                const modifier = formatSignedNumber(roll.circumstanceModifier);
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
                    const modifier = formatSignedNumber(damage.damageAttribute.modifier);
                    parts.push(modifier !== null ? modifier : String(damage.damageAttribute.modifier));
                }
                if (typeof damage.damageAttribute.levelBonus === 'number' && damage.damageAttribute.levelBonus !== 0) {
                    const levelText = formatSignedNumber(damage.damageAttribute.levelBonus) ?? damage.damageAttribute.levelBonus;
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
                const startingHealth = this.formatHealthDisplayValue(target.startingHealth);
                targetParts.push(`Start ${startingHealth}`);
            }
            if (typeof target.remainingHealth === 'number') {
                const remainingHealth = this.formatHealthDisplayValue(target.remainingHealth);
                targetParts.push(`End ${remainingHealth}`);
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

        return this.buildCollapsibleDetailsMessageElement({
            className: 'message attack-check-message',
            type: 'attack-check',
            timestamp,
            senderText: '⚔️ Attack Check',
            summaryText: 'Attack Check',
            bodyHtml: `<ul>${lines.join('\n')}</ul>`,
            contentClass: 'message-content',
            bodyClass: 'skill-check-details attack-check-details',
            bubbleType: 'attack-check'
        });
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
        return window.DomUtils.escapeHtml(text);
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
        const existingPlayerActionElement = context?.playerActionElement || null;
        this.startEventBundle(existingPlayerActionElement);
        this.startStatusBundle(existingPlayerActionElement);

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
            const playerActionElement = this.addMessage('ai', payload.response, false, payload.debug, {
                bubbleType: payload.proseType || 'player-action'
            });
            shouldRefreshLocation = true;
            if (context) {
                context.playerActionElement = playerActionElement;
                if (this.activeEventBundle) {
                    this.activeEventBundle.parentElement = playerActionElement;
                }
                if (this.activeStatusBundle) {
                    this.activeStatusBundle.parentElement = playerActionElement;
                }
                context.playerActionRendered = true;
                if (context.streamed) {
                    context.streamed.playerAction = context.streamed.playerAction || fromStream;
                }
            }
        }

        const checkResultsRecorded = payload.checkResultsRecorded === true;
        const actionResolutions = [];
        const hasActionResolutionsArray = Array.isArray(payload.actionResolutions);
        if (hasActionResolutionsArray) {
            payload.actionResolutions.forEach(resolution => {
                if (resolution && typeof resolution === 'object') {
                    actionResolutions.push(resolution);
                }
            });
        }
        if (!hasActionResolutionsArray && payload.actionResolution && typeof payload.actionResolution === 'object') {
            actionResolutions.push(payload.actionResolution);
        }
        if (!checkResultsRecorded && actionResolutions.length) {
            if (context && !context.renderedActionResolutionKeys) {
                context.renderedActionResolutionKeys = new Set();
            }
            const renderedActionResolutionKeys = context?.renderedActionResolutionKeys || null;
            actionResolutions.forEach((resolution, index) => {
                if (resolution.roll === null || resolution.roll === undefined) {
                    return;
                }
                let renderKey = `${index}:`;
                try {
                    renderKey += JSON.stringify(resolution);
                } catch (_) {
                    renderKey += `${resolution.degree || ''}:${resolution.roll?.die ?? ''}:${resolution.roll?.total ?? ''}`;
                }
                if (renderedActionResolutionKeys && renderedActionResolutionKeys.has(renderKey)) {
                    return;
                }
                this.addSkillCheckMessage(resolution);
                if (renderedActionResolutionKeys) {
                    renderedActionResolutionKeys.add(renderKey);
                }
            });
        }

        const attackSummaries = [];
        const hasAttackSummariesArray = Array.isArray(payload.attackSummaries);
        if (hasAttackSummariesArray) {
            payload.attackSummaries.forEach(summary => {
                if (summary && typeof summary === 'object') {
                    attackSummaries.push(summary);
                }
            });
        }
        const resolvedAttackSummary = payload.attackSummary || payload.attackCheck?.summary || null;
        if (!hasAttackSummariesArray && resolvedAttackSummary && typeof resolvedAttackSummary === 'object') {
            attackSummaries.push(resolvedAttackSummary);
        }
        if (!checkResultsRecorded && attackSummaries.length) {
            if (context && !context.renderedAttackSummaryKeys) {
                context.renderedAttackSummaryKeys = new Set();
            }
            const renderedAttackSummaryKeys = context?.renderedAttackSummaryKeys || null;
            attackSummaries.forEach((summary, index) => {
                const renderKey = `${index}:${this.getAttackSummaryRenderKey(summary)}`;
                if (renderedAttackSummaryKeys && renderedAttackSummaryKeys.has(renderKey)) {
                    return;
                }
                this.addAttackCheckMessage(summary);
                if (renderedAttackSummaryKeys) {
                    renderedAttackSummaryKeys.add(renderKey);
                }
            });
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

        const plausibilities = [];
        const hasPlausibilitiesArray = Array.isArray(payload.plausibilities);
        if (hasPlausibilitiesArray) {
            payload.plausibilities.forEach(plausibility => {
                if (plausibility && typeof plausibility === 'object') {
                    plausibilities.push(plausibility);
                }
            });
        }
        if (!hasPlausibilitiesArray && payload.plausibility && typeof payload.plausibility === 'object') {
            plausibilities.push(payload.plausibility);
        }
        if (plausibilities.length) {
            if (context && !context.renderedPlausibilityKeys) {
                context.renderedPlausibilityKeys = new Set();
            }
            const renderedPlausibilityKeys = context?.renderedPlausibilityKeys || null;
            plausibilities.forEach((plausibility, index) => {
                let renderKey = `${index}:`;
                try {
                    renderKey += JSON.stringify(plausibility);
                } catch (_) {
                    renderKey += plausibility.structured?.type || plausibility.raw || '';
                }
                if (renderedPlausibilityKeys && renderedPlausibilityKeys.has(renderKey)) {
                    return;
                }
                this.addPlausibilityMessage(plausibility);
                if (renderedPlausibilityKeys) {
                    renderedPlausibilityKeys.add(renderKey);
                }
            });
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

        const updatedExistingTurn = this.updateRegisteredNpcTurnMessage(turn);
        if (!updatedExistingTurn) {
            this.addNpcMessage(turn.name || 'NPC', turn.response);
        }
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
        const turnCheckResultsRecorded = turn.checkResultsRecorded === true;
        const attackSummaries = [];
        const hasAttackSummariesArray = Array.isArray(turn.attackSummaries);
        if (hasAttackSummariesArray) {
            turn.attackSummaries.forEach(summary => {
                if (summary && typeof summary === 'object') {
                    attackSummaries.push(summary);
                }
            });
        }
        const resolvedAttackSummary = turn.attackSummary || turn.attackCheck?.summary || null;
        if (!hasAttackSummariesArray && resolvedAttackSummary && typeof resolvedAttackSummary === 'object') {
            attackSummaries.push(resolvedAttackSummary);
        }
        if (!turnCheckResultsRecorded && attackSummaries.length) {
            if (context && !context.renderedNpcAttackSummaryKeys) {
                context.renderedNpcAttackSummaryKeys = new Set();
            }
            const renderedNpcAttackSummaryKeys = context?.renderedNpcAttackSummaryKeys || null;
            attackSummaries.forEach((summary, summaryIndex) => {
                const renderKey = `${index}:${summaryIndex}:${this.getAttackSummaryRenderKey(summary)}`;
                if (renderedNpcAttackSummaryKeys && renderedNpcAttackSummaryKeys.has(renderKey)) {
                    return;
                }
                this.addAttackCheckMessage(summary);
                if (renderedNpcAttackSummaryKeys) {
                    renderedNpcAttackSummaryKeys.add(renderKey);
                }
            });
        }

        const actionResolutions = [];
        const hasActionResolutionsArray = Array.isArray(turn.actionResolutions);
        if (hasActionResolutionsArray) {
            turn.actionResolutions.forEach(resolution => {
                if (resolution && typeof resolution === 'object') {
                    actionResolutions.push(resolution);
                }
            });
        }
        if (!hasActionResolutionsArray && turn.actionResolution && typeof turn.actionResolution === 'object') {
            actionResolutions.push(turn.actionResolution);
        }
        if (!turnCheckResultsRecorded && actionResolutions.length) {
            if (context && !context.renderedNpcActionResolutionKeys) {
                context.renderedNpcActionResolutionKeys = new Set();
            }
            const renderedNpcActionResolutionKeys = context?.renderedNpcActionResolutionKeys || null;
            actionResolutions.forEach((resolution, resolutionIndex) => {
                if (resolution.roll === null || resolution.roll === undefined) {
                    return;
                }
                let renderKey = `${index}:${resolutionIndex}:`;
                try {
                    renderKey += JSON.stringify(resolution);
                } catch (_) {
                    renderKey += `${resolution.degree || ''}:${resolution.roll?.die ?? ''}:${resolution.roll?.total ?? ''}`;
                }
                if (renderedNpcActionResolutionKeys && renderedNpcActionResolutionKeys.has(renderKey)) {
                    return;
                }
                this.addSkillCheckMessage(resolution);
                if (renderedNpcActionResolutionKeys) {
                    renderedNpcActionResolutionKeys.add(renderKey);
                }
            });
        }

        const plausibilities = [];
        const hasPlausibilitiesArray = Array.isArray(turn.plausibilities);
        if (hasPlausibilitiesArray) {
            turn.plausibilities.forEach(plausibility => {
                if (plausibility && typeof plausibility === 'object') {
                    plausibilities.push(plausibility);
                }
            });
        }
        if (!hasPlausibilitiesArray && turn.plausibility && typeof turn.plausibility === 'object') {
            plausibilities.push(turn.plausibility);
        }
        if (plausibilities.length) {
            if (context && !context.renderedNpcPlausibilityKeys) {
                context.renderedNpcPlausibilityKeys = new Set();
            }
            const renderedNpcPlausibilityKeys = context?.renderedNpcPlausibilityKeys || null;
            plausibilities.forEach((plausibility, plausibilityIndex) => {
                let renderKey = `${index}:${plausibilityIndex}:`;
                try {
                    renderKey += JSON.stringify(plausibility);
                } catch (_) {
                    renderKey += plausibility.structured?.type || plausibility.raw || '';
                }
                if (renderedNpcPlausibilityKeys && renderedNpcPlausibilityKeys.has(renderKey)) {
                    return;
                }
                this.addPlausibilityMessage(plausibility);
                if (renderedNpcPlausibilityKeys) {
                    renderedNpcPlausibilityKeys.add(renderKey);
                }
            });
        }

        this.flushEventBundle();
        this.flushStatusBundle();
    }

    handleChatStatus(payload) {
        if (!payload) {
            return;
        }

        const scopeRaw = typeof payload.scope === 'string' ? payload.scope.trim().toLowerCase() : '';
        if (scopeRaw === 'new_game') {
            const pendingAbilitySelection = payload?.pendingAbilitySelection
                || (payload?.abilitySelection?.pending ? payload.abilitySelection : null);
            const shouldMarkGameLoaded = payload.gameLoaded === true || Boolean(pendingAbilitySelection);
            if (shouldMarkGameLoaded) {
                window.__AIRPG_GAME_LOADED__ = true;
                if (pendingAbilitySelection && typeof window.handlePendingAbilitySelectionPayload === 'function') {
                    try {
                        window.handlePendingAbilitySelectionPayload(pendingAbilitySelection);
                    } catch (abilitySelectionError) {
                        console.warn('Failed to handle startup ability selection payload:', abilitySelectionError);
                    }
                }
                this.checkLocationUpdate().catch(error => {
                    console.warn('Failed to refresh location after new-game readiness update:', error);
                });
            }
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

    handleSummaryError(payload) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid summary_error payload.');
        }
        const message = typeof payload.message === 'string' && payload.message.trim()
            ? payload.message.trim()
            : 'Automatic summary failed.';
        const stack = typeof payload.stack === 'string' && payload.stack.trim()
            ? payload.stack.trim()
            : message;
        console.error('Automatic summary failed:', stack);
        if (typeof alert !== 'function') {
            throw new Error('Unable to display the automatic summary error because alert() is unavailable.');
        }
        alert(`Automatic summary failed:\n\n${stack}`);
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
            const newExitEntry = {
                kind: payload.created?.type || 'location',
                name: exitName,
                destinationId: payload.created?.destinationId || payload.created?.stubId || '',
                destinationRegionId: payload.created?.regionId || payload.created?.destinationRegionId || '',
                exitId: payload.created?.exitId || '',
                originLocationName: payload.originLocationName || '',
                originLocationId: payload.originLocationId || '',
                originRegionName: payload.originRegionName || '',
                originRegionId: payload.originRegionId || '',
                destinationRegionName: payload.created?.type === 'region'
                    ? exitName
                    : (payload.created?.destinationRegionName || '')
            };
            const detail = formatNewExitDiscoveredSummaryDetail(newExitEntry, getCurrentNewExitSummaryContext());
            const newExitMetadata = buildNewExitDiscoveredSummaryMetadata(newExitEntry, detail);
            const summary = `New exit discovered: ${detail}`;
            const metadata = newExitMetadata
                ? { newExitDiscovered: newExitMetadata }
                : {};
            const item = {
                icon: '🚪',
                text: summary,
                category: 'travel',
                severity: 'important',
                sourceType: 'new_exit_discovered',
                metadata
            };
            if (!this.pushEventBundleItem(item)) {
                this.addEventSummary(item);
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

            if (!this.pushEventBundleItem('🚪', summary, 'travel')) {
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
            const activeElement = document.activeElement;
            const activeInTypingContext = activeElement instanceof HTMLElement
                && Boolean(activeElement.closest('input, textarea, select, [contenteditable="true"]'));
            if (!activeInTypingContext) {
                this.messageInput?.focus();
            }
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

    showChatErrorPopup(message) {
        const text = typeof message === 'string' && message.trim()
            ? message.trim()
            : 'Unknown chat error.';
        if (typeof alert === 'function') {
            alert(`Chat error: ${text}`);
        }
    }

    async submitChatMessage(rawContent, { setButtonLoading = false, travel = false, travelMetadata = null, suppressTravelCompletionSound = false, allowEmptyAction = false } = {}) {
        const content = typeof rawContent === 'string' ? rawContent : '';
        const trimmed = content.trim();
        if (!trimmed && !allowEmptyAction) {
            return;
        }
        if (typeof window.isPlayerAbilitySelectionBlockingGameplay === 'function'
            && window.isPlayerAbilitySelectionBlockingGameplay()) {
            try {
                if (typeof window.requestPlayerAbilitySelectionFlow === 'function') {
                    const pendingSelectionPromise = window.requestPlayerAbilitySelectionFlow({ force: true });
                    if (pendingSelectionPromise && typeof pendingSelectionPromise.catch === 'function') {
                        pendingSelectionPromise.catch((abilitySelectionError) => {
                            console.warn('Failed to open pending player ability selection modal:', abilitySelectionError);
                        });
                    }
                }
            } catch (abilitySelectionError) {
                console.warn('Failed to open pending player ability selection modal:', abilitySelectionError);
            }
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
        } else if (trimmedVisibleContent.startsWith('\\')) {
            genericMarkerLength = 1;
            genericPromptStorageMode = 'hide_base_context';
        }
        const isGenericPromptEntry = genericMarkerLength > 0;
        const isNoLogGenericPromptEntry = isGenericPromptEntry && genericPromptStorageMode === 'no_log';
        const normalizedUserContent = isQuestionEntry
            ? trimmedVisibleContent.slice(1).replace(/^\s+/, '')
            : (isGenericPromptEntry
                ? trimmedVisibleContent.slice(genericMarkerLength).replace(/^\s+/, '')
                : content);
        const requestId = this.generateRequestId();

        if (isNoLogGenericPromptEntry) {
            this.addMessage('user', normalizedUserContent, false);
        } else {
            const userEntry = this.normalizeLocalEntry({
                id: requestId,
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
                return [...this.buildModelBoundChatHistory(), rawUserMessage];
            }

            const history = this.buildModelBoundChatHistory();
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
            const pendingAbilitySelection = data?.pendingAbilitySelection
                || (data?.abilitySelection?.pending ? data.abilitySelection : null);
            if (pendingAbilitySelection && typeof window.handlePendingAbilitySelectionPayload === 'function') {
                try {
                    window.handlePendingAbilitySelectionPayload(pendingAbilitySelection);
                } catch (abilitySelectionError) {
                    console.warn('Failed to handle pending ability selection payload:', abilitySelectionError);
                }
            }

            if (data.error) {
                const errorMessage = data.error;
                this.hideLoading(requestId);
                if (this.turnRollbackInProgress) {
                    skipHistoryRefresh = true;
                } else if (!pendingAbilitySelection) {
                    this.addMessage('system', `Error: ${errorMessage}`, true);
                    this.showChatErrorPopup(errorMessage);
                }
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
            if (this.turnRollbackInProgress) {
                context.httpResolved = true;
                finalizeMode = 'immediate';
                skipHistoryRefresh = true;
            } else {
                const errorMessage = `Connection error: ${error.message}`;
                this.addMessage('system', errorMessage, true);
                this.showChatErrorPopup(errorMessage);
                context.httpResolved = true;
                finalizeMode = 'immediate';
            }
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
            try {
                await window.refreshStoryTools?.({ preserveSelection: true });
            } catch (refreshError) {
                console.debug('Story Tools refresh skipped after chat response:', refreshError);
            }
        }
    }

    async sendMessage({ allowEmptyAction = false } = {}) {
        const rawInput = this.messageInput.value;
        const hasInputText = typeof rawInput === 'string' && rawInput.trim().length > 0;
        if (!hasInputText && !allowEmptyAction) {
            this.openEmptyActionConfirmModal();
            return;
        }
        if (typeof window.isPlayerAbilitySelectionBlockingGameplay === 'function'
            && window.isPlayerAbilitySelectionBlockingGameplay()) {
            if (typeof window.requestPlayerAbilitySelectionFlow === 'function') {
                const pendingSelectionPromise = window.requestPlayerAbilitySelectionFlow({ force: true });
                if (pendingSelectionPromise && typeof pendingSelectionPromise.catch === 'function') {
                    pendingSelectionPromise.catch((abilitySelectionError) => {
                        console.warn('Failed to open pending player ability selection modal:', abilitySelectionError);
                    });
                }
            }
            return;
        }

        if (hasInputText) {
            this.recordInputHistoryEntry(rawInput);
        }
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        const trimmed = hasInputText ? rawInput.trim() : '';
        if (trimmed.startsWith('/')) {
            try {
                await this.executeSlashCommand(trimmed);
            } catch (error) {
                console.error('Slash command failed:', error);
                this.addMessage('system', `Slash command error: ${error.message || error}`, true);
            }
            return;
        }

        const messageToSubmit = hasInputText ? rawInput : '';
        await this.submitChatMessage(messageToSubmit, {
            setButtonLoading: true,
            travel: false,
            allowEmptyAction: !hasInputText
        });
    }

    async dispatchAutomatedMessage(message, { travel = false, travelMetadata = null, suppressTravelCompletionSound = false, allowEmptyAction = false } = {}) {
        await this.submitChatMessage(message, {
            setButtonLoading: Boolean(travel),
            travel: Boolean(travel),
            travelMetadata: travelMetadata || null,
            suppressTravelCompletionSound: Boolean(suppressTravelCompletionSound),
            allowEmptyAction: Boolean(allowEmptyAction)
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

    async processSlashCommandReplies(replies, { requestBody = null, commandName = '', defaultSuccessMessage = null } = {}) {
        const replyList = Array.isArray(replies) ? replies : [];
        if (!replyList.length) {
            if (typeof defaultSuccessMessage === 'string' && defaultSuccessMessage.trim()) {
                this.addMessage('system', defaultSuccessMessage.trim(), false);
            }
            return;
        }

        for (const reply of replyList) {
            if (!reply || typeof reply !== 'object') {
                continue;
            }

            const message = typeof reply.content === 'string' ? reply.content.trim() : '';
            if (message) {
                const isError = Boolean(reply.ephemeral);
                this.addMessage('system', message, isError, null, { allowMarkdown: true });
            }

            if (reply.action) {
                await this.handleSlashCommandReplyAction(reply.action, {
                    requestBody,
                    commandName
                });
            }
        }
    }

    async handleSlashCommandReplyAction(action, { requestBody = null, commandName = '' } = {}) {
        if (!action || typeof action !== 'object') {
            return;
        }

        switch (action.type) {
            case 'request_file_upload':
                await this.requestSlashCommandUpload(action, { requestBody, commandName });
                return;
            case 'reload_page':
                this.scheduleSlashCommandPageReload(action);
                return;
            default:
                throw new Error(`Unsupported slash command action type: ${action.type}`);
        }
    }

    scheduleSlashCommandPageReload(action) {
        const delayMs = action.delayMs === undefined ? 0 : action.delayMs;
        if (!Number.isInteger(delayMs) || delayMs < 0) {
            throw new Error('Slash command reload action delayMs must be a non-negative integer.');
        }
        if (!window.location || typeof window.location.reload !== 'function') {
            throw new Error('Browser reload is unavailable for slash command action.');
        }
        window.setTimeout(() => {
            window.location.reload();
        }, delayMs);
    }

    async requestSlashCommandUpload(action, { requestBody = null, commandName = '' } = {}) {
        try {
            window.hideLocationOverlay?.();
        } catch (_) {
            // ignore overlay errors
        }

        const uploadSelection = await this.openSlashUploadModal(action);
        if (!uploadSelection || uploadSelection.canceled === true) {
            return;
        }

        const uploadRequestBody = {
            ...(requestBody && typeof requestBody === 'object' ? requestBody : {}),
            uploads: Array.isArray(uploadSelection.uploads) ? uploadSelection.uploads : []
        };
        const uploadMessage = typeof action.uploadMessage === 'string' && action.uploadMessage.trim()
            ? action.uploadMessage.trim()
            : 'Uploading file...';

        try {
            window.showLocationOverlay?.(uploadMessage);
        } catch (_) {
            // ignore overlay errors
        }

        try {
            const data = await this.postSlashCommandRequest('/api/slash-command/upload', uploadRequestBody);

            await this.processSlashCommandReplies(Array.isArray(data.replies) ? data.replies : [], {
                requestBody: uploadRequestBody,
                commandName,
                defaultSuccessMessage: `Upload for '${commandName}' completed.`
            });
        } finally {
            try {
                window.hideLocationOverlay?.();
            } catch (_) {
                // ignore overlay errors
            }
        }
    }

    async postSlashCommandRequest(url, requestBody) {
        const response = await fetch(url, {
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

        return data;
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
            userId: window.currentPlayerData?.id || null,
            clientId: this.clientId || window.AIRPG_CLIENT_ID || null
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
            const data = await this.postSlashCommandRequest('/api/slash-command', requestBody);

            const showExecutionOverlay = data?.executionOptions?.showExecutionOverlay !== false;
            if (!showExecutionOverlay) {
                if (overlayTimer) {
                    window.clearTimeout(overlayTimer);
                    overlayTimer = null;
                }
                try {
                    window.hideLocationOverlay?.();
                } catch (_) {
                    // ignore
                }
            }

            await this.processSlashCommandReplies(Array.isArray(data.replies) ? data.replies : [], {
                requestBody,
                commandName,
                defaultSuccessMessage: `Command '${commandName}' executed.`
            });

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
