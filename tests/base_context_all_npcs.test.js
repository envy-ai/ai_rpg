const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nunjucks = require('nunjucks');

const {
    buildActorRelationshipPromptContext
} = require('../base_context_relationships.js');

function createPromptEnv() {
    const env = nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
    env.addGlobal('randomword', () => 'test');
    return env;
}

function buildRenderContext(overrides = {}) {
    return {
        config: {
            extra_system_instructions: '',
            prompt_uses_caching: false
        },
        promptType: 'question',
        question: 'What is here?',
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
            currencyName: 'gold',
            currencyNamePlural: 'gold',
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
        allNpcs: [],
        factions: [],
        trackers: [],
        currentRegion: {
            name: 'Test Region',
            description: '',
            secrets: [],
            locations: [],
            connectedRegions: []
        },
        currentLocation: null,
        currentPlayer: {
            name: 'Tester',
            description: 'A player.',
            class: 'Adventurer',
            race: 'Human',
            currency: 0,
            statusEffects: [],
            skills: [],
            abilities: [],
            inventory: [],
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

function loadBuildBasePromptContext({ players, currentPlayer }) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
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
        config: {},
        currentPlayer,
        currentTurnToken: null,
        chatHistory: [],
        factions: new Map(),
        gameLocations: new Map(),
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
            getSerializedCalendarDefinition: () => ({}),
            saveFileSaveVersion: 1
        },
        Player: {
            getAvailableSkills: () => new Map(),
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
        describeSettingForPrompt: () => 'A test setting.',
        extractPersonality: () => ({}),
        findRegionByLocationId: () => null,
        getActiveSettingSnapshot: () => ({ name: 'Test Setting' }),
        getExperiencePointValues: () => ({}),
        getGearSlotNames: () => ['head', 'body'],
        getGearSlotTypes: () => ['head', 'body'],
        getThingGeneratorPromptFields: () => [],
        getRegisteredPlayerEntityFields: () => [],
        getPlayerGeneratorPromptFields: () => [],
        getWorldOutline: () => ({ regions: [] }),
        modExtensionRegistry: null,
        normalizeLocationWeatherExposure: () => 'no',
        resolveLocationHasWeather: () => null,
        resolveMysteryThreadMaxActive: () => 0,
        resolveRegionWeatherForPrompt: () => null
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.buildBasePromptContext = buildBasePromptContext;`,
        context
    );
    return context.buildBasePromptContext;
}

function loadGetWorldOutline({ players, currentPlayer, regionsByName }) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function getWorldOutline');
    const end = source.indexOf('\nfunction hasActiveImageJob', start);
    assert.notEqual(start, -1, 'Could not locate getWorldOutline');
    assert.notEqual(end, -1, 'Could not locate hasActiveImageJob');

    const context = {
        Map,
        Region: {
            getIndexByName: () => regionsByName
        },
        players,
        currentPlayer
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.getWorldOutline = getWorldOutline;`,
        context
    );
    return context.getWorldOutline;
}

function createActor({
    id,
    name,
    shortDescription = '',
    description = '',
    isNPC = true,
    currentLocation = null,
    partyMembers = []
}) {
    return {
        id,
        name,
        shortDescription,
        description,
        isNPC,
        currentLocation,
        currentQuests: [],
        getAbilities: () => [],
        getPartyMembers: () => partyMembers,
        getStatus: () => ({
            name,
            description,
            shortDescription,
            inventory: [],
            gear: {},
            skills: []
        })
    };
}

test('base context renders alphabetized allNpcs block before worldOutline', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        allNpcs: [
            { name: 'Zara', description: 'A watchful scout.' },
            { name: 'Mira', description: 'A silver-tongued envoy.' }
        ],
        worldOutline: {
            regions: [{
                name: 'Test Region',
                label: 'Test Region',
                locations: []
            }]
        }
    }));

    const allNpcsIndex = rendered.indexOf('<allNpcs>');
    const worldOutlineIndex = rendered.indexOf('<worldOutline>');
    assert.ok(allNpcsIndex >= 0, 'expected <allNpcs> block');
    assert.ok(worldOutlineIndex > allNpcsIndex, 'expected <allNpcs> before <worldOutline>');
    assert.match(rendered, /This is a list of all characters in the story and a short description of each\./);
    assert.match(rendered, /- Mira: A silver-tongued envoy\.[\s\S]*- Zara: A watchful scout\./);
});

test('buildBasePromptContext exposes alphabetized allNpcs summaries', () => {
    const player = createActor({
        id: 'player_1',
        name: 'Aria',
        shortDescription: 'A decisive explorer.',
        isNPC: false,
        currentLocation: 'loc_1'
    });
    const mira = createActor({
        id: 'npc_1',
        name: 'Mira',
        description: 'A careful negotiator. She keeps ledgers.',
        currentLocation: 'loc_1'
    });
    const zed = createActor({
        id: 'npc_2',
        name: 'Zed',
        shortDescription: 'A quiet sentry.',
        currentLocation: 'loc_2'
    });
    const players = new Map([
        [zed.id, zed],
        [player.id, player],
        [mira.id, mira]
    ]);
    const buildBasePromptContext = loadBuildBasePromptContext({ players, currentPlayer: player });

    const context = buildBasePromptContext({
        locationOverride: {
            id: 'loc_1',
            name: 'Atrium',
            description: 'A test location.',
            items: [],
            scenery: [],
            npcIds: [],
            getDetails: () => ({
                name: 'Atrium',
                description: 'A test location.',
                exits: {},
                npcIds: []
            })
        }
    });

    assert.deepEqual(JSON.parse(JSON.stringify(context.allNpcs)), [
        { name: 'Aria', description: 'A decisive explorer.' },
        { name: 'Mira', description: 'A careful negotiator.' },
        { name: 'Zed', description: 'A quiet sentry.' }
    ]);
});

test('worldOutline location labels include alphabetized character names and none for empty locations', () => {
    const player = createActor({
        id: 'player_1',
        name: 'Aria',
        isNPC: false,
        currentLocation: 'loc_1',
        partyMembers: ['npc_party']
    });
    const partyMember = createActor({
        id: 'npc_party',
        name: 'Bryn',
        currentLocation: null
    });
    const npc = createActor({
        id: 'npc_1',
        name: 'Mira',
        currentLocation: 'loc_1'
    });
    const players = new Map([
        [player.id, player],
        [npc.id, npc],
        [partyMember.id, partyMember]
    ]);
    const locOne = { id: 'loc_1', name: 'Atrium', shortDescription: 'Sunlit entry hall' };
    const locTwo = { id: 'loc_2', name: 'Vault', shortDescription: 'Silent lower chamber' };
    const regionsByName = new Map([[
        'Test Region',
        {
            name: 'Test Region',
            shortDescription: 'A region.',
            locations: [locTwo, locOne]
        }
    ]]);
    const getWorldOutline = loadGetWorldOutline({ players, currentPlayer: player, regionsByName });

    const outline = getWorldOutline();
    const atrium = outline.regions[0].locations.find(location => location.name === 'Atrium');
    const vault = outline.regions[0].locations.find(location => location.name === 'Vault');

    assert.equal(atrium.label, 'Atrium - Sunlit entry hall; Characters: Aria, Bryn, Mira');
    assert.equal(vault.label, 'Vault - Silent lower chamber; Characters: none');
});
