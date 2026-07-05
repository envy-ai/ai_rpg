const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const Player = require('../Player.js');
const Utils = require('../Utils.js');
const {
    CHAT_TOOL_DEFINITIONS,
    createChatToolRuntime,
    getChatToolDefinitions
} = require('../chat_tool_calls.js');

function createTempPlayerDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-player-fields-'));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', `
attributes:
  strength:
    label: Strength
    default: 5
`);
    writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
    writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
    writeFile('defs/need_bars.yaml', 'need_bars: {}\n');

    return tempBaseDir;
}

function withTempPlayerEnvironment(run) {
    const tempBaseDir = createTempPlayerDefs();
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;
    const previousRegistry = Globals.modExtensionRegistry;

    Player.clearRuntimeRegistries();
    Globals.baseDir = tempBaseDir;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
        formulas: {
            character_creation: {
                attribute_pool_formula: '0',
                skill_pool_formula: '0',
                max_attribute: '18',
                max_skill: '10'
            }
        }
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        return run();
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Globals.modExtensionRegistry = previousRegistry;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
}

function registerPlayerSexualTraitsField(registry) {
    registry.registerEntityField({
        modName: 'nsfw-boost',
        entityType: 'player',
        fieldName: 'sexualTraits',
        type: 'string',
        description: '2-5 traits, comma separated, from the sexualTraits list above. Traits from the same category are allowed as long as they do not conflict. Then, a sentence or two worth of note.',
        exposeToCreateTool: true,
        exposeToUpdateTool: true,
        exposeToGeneratorPrompt: true,
        exposeToXmlParser: true,
        xmlPrompt: {
            placeholder: '2-5 traits, comma separated, then a sentence or two worth of note.'
        }
    });
}

test('registered Player field persists, loads, and installs a direct accessor', () => {
    withTempPlayerEnvironment(() => {
        const registry = new ModExtensionRegistry();
        registerPlayerSexualTraitsField(registry);
        Globals.modExtensionRegistry = registry;

        const npc = new Player({
            id: 'sexual-traits-npc',
            name: 'Mira',
            isNPC: true,
            sexualTraits: 'switch, romantic, intense - Mira treats intimacy as trust under pressure.'
        });

        assert.equal(npc.sexualTraits, 'switch, romantic, intense - Mira treats intimacy as trust under pressure.');
        assert.equal(npc.getExtensionField('sexualTraits'), 'switch, romantic, intense - Mira treats intimacy as trust under pressure.');

        const status = npc.getStatus();
        assert.equal(status.sexualTraits, 'switch, romantic, intense - Mira treats intimacy as trust under pressure.');

        const saved = npc.toJSON();
        assert.equal(saved.sexualTraits, 'switch, romantic, intense - Mira treats intimacy as trust under pressure.');

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.sexualTraits, 'switch, romantic, intense - Mira treats intimacy as trust under pressure.');
        assert.equal(loaded.toJSON().sexualTraits, 'switch, romantic, intense - Mira treats intimacy as trust under pressure.');
    });
});

test('registered Player fields extend createNpc and character field update tools', () => {
    const registry = new ModExtensionRegistry();
    registerPlayerSexualTraitsField(registry);

    const tools = getChatToolDefinitions({ modExtensionRegistry: registry });
    const createNpc = tools.find(entry => entry?.function?.name === 'createNpc')?.function;
    const updateCharacterFields = tools.find(entry => entry?.function?.name === 'updateCharacterFields')?.function;
    const updateObjectFields = tools.find(entry => entry?.function?.name === 'updateObjectFields')?.function;

    assert.equal(createNpc.parameters.properties.sexualTraits.type, 'string');
    assert.match(updateCharacterFields.description, /sexualTraits/);
    assert.match(updateObjectFields.description, /Registered Player fields.*sexualTraits/);
});

test('createNpc forwards registered Player field seed data to NPC generation', async () => {
    const registry = new ModExtensionRegistry();
    registerPlayerSexualTraitsField(registry);
    Globals.modExtensionRegistry = registry;
    let capturedArgs = null;

    const location = { id: 'loc-1', name: 'Study', baseLevel: 4 };
    const region = { id: 'region-1', name: 'Manor' };
    let completionCalls = 0;
    const LLMClient = {
        async chatCompletion(options) {
            completionCalls += 1;
            if (completionCalls === 1) {
                options.onResponse?.({
                    data: {
                        choices: [{
                            message: {
                                content: '',
                                tool_calls: [{
                                    id: 'call-create-npc',
                                    type: 'function',
                                    function: {
                                        name: 'createNpc',
                                        arguments: JSON.stringify({
                                            name: 'Mira Vale',
                                            sexualTraits: 'switch, romantic, intense - Mira likes mutual challenge.'
                                        })
                                    }
                                }]
                            }
                        }]
                    }
                });
                return '';
            }
            options.onResponse?.({
                data: {
                    choices: [{
                        message: { content: 'Created the NPC.', tool_calls: [] }
                    }]
                }
            });
            return 'Created the NPC.';
        },
        logPrompt() {},
        formatMessagesForErrorLog(messages) {
            return JSON.stringify(messages);
        }
    };

    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
        getCurrentPlayer: () => ({ id: 'player-1', name: 'Player', currentLocation: location.id }),
        createLocationFromEvent: async () => location,
        createRegionStubFromEvent: async () => region,
        generateItemsByNames: async () => [],
        generateNpcFromEvent: async (args) => {
            capturedArgs = args;
            return {
                id: 'npc-1',
                name: 'Mira Vale',
                isNPC: true,
                currentLocation: args.location.id
            };
        },
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => region,
        LLMClient,
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { get: id => (id === location.id ? location : null), getAll: () => [location] },
        Region: { getAll: () => [region] },
        getGameLocations: () => new Map([[location.id, location]]),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map([[region.id, region]]),
        getPendingRegionStubs: () => new Map(),
        getModExtensionRegistry: () => registry
    });

    await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: '@Create Mira.' }]
        },
        metadataLabel: 'test_create_npc_player_field'
    });

    assert.equal(capturedArgs.npc.sexualTraits, 'switch, romantic, intense - Mira likes mutual challenge.');
});

test('updateCharacterFields accepts registered Player fields', async () => {
    const registry = new ModExtensionRegistry();
    registerPlayerSexualTraitsField(registry);
    Globals.modExtensionRegistry = registry;
    const npc = {
        id: 'npc-1',
        name: 'Mira Vale',
        isNPC: true,
        sexualTraits: '',
        getAliases: () => [],
        setExtensionField(fieldName, value) {
            this[fieldName] = value;
        },
        toJSON() {
            return { id: this.id, name: this.name, sexualTraits: this.sexualTraits };
        }
    };
    let completionCalls = 0;
    const LLMClient = {
        async chatCompletion(options) {
            completionCalls += 1;
            if (completionCalls === 1) {
                options.onResponse?.({
                    data: {
                        choices: [{
                            message: {
                                content: '',
                                tool_calls: [{
                                    id: 'call-update-character',
                                    type: 'function',
                                    function: {
                                        name: 'updateCharacterFields',
                                        arguments: JSON.stringify({
                                            character: 'Mira Vale',
                                            fields: {
                                                sexualTraits: 'dominant, teasing - Mira likes to control the tempo.'
                                            }
                                        })
                                    }
                                }]
                            }
                        }]
                    }
                });
                return '';
            }
            options.onResponse?.({
                data: {
                    choices: [{
                        message: { content: 'Updated the NPC.', tool_calls: [] }
                    }]
                }
            });
            return 'Updated the NPC.';
        },
        logPrompt() {},
        formatMessagesForErrorLog(messages) {
            return JSON.stringify(messages);
        }
    };
    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
        getCurrentPlayer: () => ({ id: 'player-1', name: 'Player' }),
        createLocationFromEvent: async () => null,
        createRegionStubFromEvent: async () => null,
        generateItemsByNames: async () => [],
        generateNpcFromEvent: async () => null,
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => null,
        LLMClient,
        Player: { getAll: () => [npc] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [] },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map(),
        getModExtensionRegistry: () => registry
    });

    await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: '@Update Mira.' }]
        },
        metadataLabel: 'test_update_character_player_field'
    });

    assert.equal(npc.sexualTraits, 'dominant, teasing - Mira likes to control the tempo.');
});

function createPromptEnv() {
    const env = nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
    env.addGlobal('randomword', () => 'test');
    return env;
}

function buildBaseContextForRender(overrides = {}) {
    return {
        config: {},
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
        factions: [],
        trackers: [],
        currentRegion: {
            name: 'Test Region',
            description: '',
            secrets: [],
            locations: [],
            connectedRegions: []
        },
        currentLocation: {
            name: 'Test Location',
            description: '',
            shortDescription: '',
            statusEffects: [],
            exits: [],
            items: [],
            npcs: []
        },
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

test('base context renders registered Player field values when registered', () => {
    const registry = new ModExtensionRegistry();
    registerPlayerSexualTraitsField(registry);
    const promptEnv = createPromptEnv();
    const baseContext = buildBaseContextForRender({
        playerEntityPromptFields: registry.getEntityFields('player'),
        npcs: [{
            name: 'Mira',
            description: 'A test NPC.',
            personality: { type: '', traits: '', goals: [], notes: '', aiNotes: '' },
            aiNotes: '',
            inventory: [],
            gear: {},
            skills: [],
            sexualTraits: 'dominant, teasing - Mira likes to control the tempo.'
        }]
    });

    const rendered = promptEnv.render('base-context.xml.njk', baseContext);

    assert.match(rendered, /<sexualTraits>dominant, teasing - Mira likes to control the tempo\.<\/sexualTraits>/);
});

function loadParseLocationNpcs(registry) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function parseLocationNpcs');
    const end = source.indexOf('\nfunction parseRegionNpcs', start);
    assert.notEqual(start, -1, 'Could not locate parseLocationNpcs');
    assert.notEqual(end, -1, 'Could not locate parseRegionNpcs');
    const context = {
        Array,
        Boolean,
        Error,
        Map,
        Number,
        Object,
        String,
        console,
        Utils,
        Globals: {
            modExtensionRegistry: registry,
            config: { strictXMLParsing: false }
        },
        modExtensionRegistry: registry,
        parseGeneratedNpcBoolean: value => /^\s*(true|1|yes|hidden)\s*$/i.test(String(value || '')),
        parseGeneratedNpcQuantityFromNode: () => 1,
        parseNpcStartingNeeds: () => ({ needBars: [], needBarApplicability: {} }),
        parseNpcStartingHealth: () => null,
        parseIntegerFromText: value => {
            const parsed = Number.parseInt(String(value || ''), 10);
            return Number.isFinite(parsed) ? parsed : null;
        },
        getPlayerXmlParserFields: () => registry.getEntityFields('player', { exposeToXmlParser: true })
            .filter(field => field && field.xmlPrompt && typeof field.xmlPrompt.tagName === 'string'),
        normalizeRegisteredPlayerFieldValue: value => {
            if (value === undefined || value === null) {
                return undefined;
            }
            const trimmed = String(value).trim();
            return trimmed && trimmed.toLowerCase() !== 'n/a' ? trimmed : undefined;
        },
        getPlayerExtensionFieldInputsFromXmlNode: (node, fields, sourceLabel) => {
            const inputs = {};
            for (const field of fields || []) {
                const tagName = field?.xmlPrompt?.tagName || field?.fieldName;
                const valueNode = node.getElementsByTagName(tagName)[0] || null;
                const value = context.normalizeRegisteredPlayerFieldValue(
                    valueNode?.textContent,
                    field,
                    sourceLabel
                );
                if (value !== undefined) {
                    inputs[field.fieldName] = value;
                }
            }
            return inputs;
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.parseLocationNpcs = parseLocationNpcs;`,
        context
    );
    return context.parseLocationNpcs;
}

test('NPC XML parser maps registered Player XML fields onto parsed NPC data', () => {
    const registry = new ModExtensionRegistry();
    registerPlayerSexualTraitsField(registry);
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    const parseLocationNpcs = loadParseLocationNpcs(registry);

    try {
        const parsed = parseLocationNpcs(`
<npcInfo>
  <npcs>
    <npc>
      <name>Mira</name>
      <description>A test NPC.</description>
      <shortDescription>Test NPC</shortDescription>
      <sexualTraits>switch, romantic, intense - Mira likes mutual challenge.</sexualTraits>
    </npc>
  </npcs>
</npcInfo>`);

        assert.equal(parsed.npcs.length, 1);
        assert.equal(parsed.npcs[0].sexualTraits, 'switch, romantic, intense - Mira likes mutual challenge.');
    } finally {
        Globals.config = previousConfig;
    }
});
