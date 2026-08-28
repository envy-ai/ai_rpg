const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nunjucks = require('nunjucks');

const {
    buildActorRelationshipPromptContext
} = require('../../base_context_relationships.js');
const {
    shouldIncludeEntryInBaseContextHistory
} = require('../../base_context_history.js');
const {
    containsOmittedMarker,
    shouldExcludeSummaryEntry
} = require('../../chat_history_utils.js');
const {
    formatSceneStartWorldTimeLabel
} = require('../../history_time_labels.js');

const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');

function createPromptEnv({ randomWord = true } = {}) {
    const env = nunjucks.configure(PROMPTS_DIR, {
        autoescape: false,
        throwOnUndefined: true
    });
    if (randomWord) {
        env.addGlobal('randomword', () => 'test');
    }
    return env;
}

function buildBaseRenderContext({
    question = 'What is here?',
    currencyName = 'gold',
    currencyNamePlural,
    regionName = 'Test Region',
    config = null,
    promptUsesCaching = false,
    trackers = false,
    allNpcs = false,
    currentLocation = null,
    currentPlayerInventory = null,
    overrides = {}
} = {}) {
    return {
        config: config || {
            extra_system_instructions: '',
            prompt_uses_caching: promptUsesCaching,
            soft_quest_limit: 10
        },
        promptType: 'question',
        question,
        setting: {
            baseContextPreamble: '',
            name: 'Test Setting',
            description: 'A test setting.',
            theme: 'Test',
            genre: 'Fantasy',
            startingLocationType: 'Town',
            magicLevel: 'Low',
            techLevel: 'Low',
            tone: 'Neutral',
            difficulty: 'Normal',
            currencyName,
            currencyNamePlural: currencyNamePlural || currencyName,
            currencyValueNotes: '',
            writingStyleNotes: '',
            races: [],
            attributes: [],
            skills: []
        },
        rarityDefinitions: [],
        gameHistory: '',
        recentGameHistory: '',
        omitGameHistory: false,
        worldOutline: { regions: [] },
        ...(allNpcs ? { allNpcs: [] } : {}),
        factions: [],
        ...(trackers ? { trackers: [] } : {}),
        currentRegion: {
            name: regionName,
            description: '',
            secrets: [],
            locations: [],
            connectedRegions: []
        },
        currentLocation,
        currentPlayer: {
            name: 'Tester',
            description: 'A player.',
            class: 'Adventurer',
            race: 'Human',
            currency: 0,
            statusEffects: [],
            skills: [],
            abilities: [],
            inventory: currentPlayerInventory || [],
            needs: [],
            currentQuests: []
        },
        party: [],
        npcs: [],
        additionalLore: '',
        itemContext: '',
        abilityContext: '',
        plotSummary: '',
        plotExpander: '',
        worldTime: {
            dayIndex: 0,
            timeMinutes: 720,
            dateLabel: 'Day 1',
            timeLabel: '12:00 PM',
            segment: 'Noon',
            season: 'Spring',
            seasonDescription: '',
            holiday: null,
            lighting: 'Daylight',
            hasLocalWeather: false,
            weatherName: '',
            weatherDescription: '',
            lightLevelDescription: 'Bright'
        },
        currentVehicle: null,
        omitInventoryItems: false,
        omitAbilities: false,
        suppressQuestList: false,
        saveFileSaveVersion: 1,
        Globals: {
            saveFileSaveVersion: 1
        },
        ...overrides
    };
}

function loadBuildBasePromptContext({
    players = new Map(),
    currentPlayer = null,
    registry = null,
    includeMysteryCleanup = true,
    playerAvailableSkills = new Map(),
    config = {},
    chatHistory = [],
    sceneSummaries = null,
    saveMetadata = null
} = {}) {
    const source = fs.readFileSync(require.resolve('../../server.js'), 'utf8');
    const start = source.indexOf('function buildBasePromptContext');
    const end = source.indexOf('\nfunction getBaseContextTurnKey', start);
    assert.notEqual(start, -1, 'Could not locate buildBasePromptContext');
    assert.notEqual(end, -1, 'Could not locate getBaseContextTurnKey');

    const context = {
        Boolean,
        Error,
        Map,
        Number,
        Object,
        Set,
        String,
        console,
        config,
        currentPlayer: currentPlayer || {
            id: 'player_1',
            name: 'Tester',
            currentQuests: [],
            getAbilities: () => [],
            getPartyMembers: () => [],
            getStatus: () => ({
                name: 'Tester',
                description: '',
                inventory: [],
                gear: {},
                skills: []
            })
        },
        currentTurnToken: null,
        chatHistory,
        factions: new Map(),
        gameLocations: new Map(),
        HIDDEN_CHAT_LABEL: 'Hidden from Player',
        pendingRegionStubs: new Map(),
        players,
        regions: new Map(),
        skills: new Map(),
        things: new Map(),
        attributeDefinitionsForPrompt: {
            intelligence: {},
            strength: {}
        },
        Globals: {
            ensureWorldTimeInitialized: () => ({}),
            getPlotAnalysis: () => null,
            getSaveMetadata: () => saveMetadata,
            getSceneSummaries: () => sceneSummaries,
            getSerializedCalendarDefinition: () => ({}),
            saveFileSaveVersion: 1
        },
        Player: {
            getAvailableSkills: () => playerAvailableSkills,
            getDispositionDefinitions: () => ({ types: {}, range: {} }),
            getNeedBarDefinitionsForContext: () => []
        },
        StatusEffect: {
            normalizeDuration: value => value
        },
        Thing: {
            generateRandomRarityDefinition: () => ({ label: 'Common' }),
            getAllRarityDefinitions: () => [{ label: 'Common', description: 'Common item.' }]
        },
        buildActiveMysteryThreadsForPrompt: () => [],
        ...(includeMysteryCleanup ? { buildMysteryCleanupThreadsForPrompt: () => [] } : {}),
        buildNpcRepresentationSummaryForPrompt: () => '',
        buildActorRelationshipPromptContext,
        buildTrackersForPrompt: () => [],
        buildSettingPromptContext: () => ({
            name: 'Test Setting',
            description: 'A test setting.',
            genre: 'science fantasy',
            tone: 'neutral',
            skills: ['Cybernetics'],
            attributes: ['intelligence', 'strength']
        }),
        collectNpcNamesForContext: () => [],
        containsOmittedMarker,
        describeSettingForPrompt: () => 'A test setting.',
        extractPersonality: () => ({}),
        findRegionByLocationId: () => null,
        getActiveSettingSnapshot: () => ({ name: 'Test Setting' }),
        getExperiencePointValues: () => ({}),
        getGearSlotNames: () => ['head', 'body'],
        getGearSlotTypes: () => ['head', 'body'],
        getThingGeneratorPromptFields: registry
            ? () => registry.getEntityFields('thing', { exposeToGeneratorPrompt: true })
            : () => [],
        getRegisteredPlayerEntityFields: registry
            ? (filter = {}) => registry.getEntityFields('player', filter)
            : () => [],
        getPlayerGeneratorPromptFields: registry
            ? () => registry.getEntityFields('player', { exposeToGeneratorPrompt: true })
                .filter(field => field && field.xmlPrompt && typeof field.xmlPrompt.tagName === 'string')
            : () => [],
        getWorldOutline: () => ({ regions: [] }),
        isHiddenChatEntry: () => false,
        modExtensionRegistry: registry,
        normalizeLocationWeatherExposure: () => 'no',
        resolveLocationHasWeather: () => null,
        resolveEffectiveLocationHasWeather: () => 'no',
        resolveMysteryThreadMaxActive: () => 0,
        resolveRegionWeatherForPrompt: () => null,
        formatHistoryEntrySpeakerPrefix: (_entry, { roleLabel }) => `${roleLabel}:`,
        formatSceneStartWorldTimeLabel,
        partitionBaseContextHistoryBySceneCoverage: require('../../base_context_history.js')
            .partitionBaseContextHistoryBySceneCoverage,
        resolveBatchedRecentHistoryTurnCount: require('../../base_context_history.js')
            .resolveBatchedRecentHistoryTurnCount,
        resolveRecentHistoryBatchInterval: require('../../base_context_history.js')
            .resolveRecentHistoryBatchInterval,
        shouldExcludeSummaryEntry,
        shouldIncludeEntryInBaseContextHistory
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.buildBasePromptContext = buildBasePromptContext;`,
        context
    );
    return context.buildBasePromptContext;
}

module.exports = {
    createPromptEnv,
    buildBaseRenderContext,
    loadBuildBasePromptContext
};
