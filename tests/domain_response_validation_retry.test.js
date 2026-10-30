const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const axios = require('axios');
const Globals = require('../Globals.js');
const IdGenerator = require('../IdGenerator.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const StatusEffect = require('../StatusEffect.js');
const Events = require('../Events.js');
const LLMClient = require('../LLMClient.js');
const MysteryThread = require('../MysteryThread.js');

function completionResponse(payload, content) {
    return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: `domain-validation-${Math.random().toString(36).slice(2)}`,
            model: payload.model,
            choices: [{
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content }
            }],
            usage: { total_tokens: 20 }
        }
    };
}

test('Location detached parsing leaves a stub and region untouched until commit', () => {
    Region.clear();
    Location.clear();
    const region = new Region({
        id: 'region_validation_atomicity',
        name: 'Validation Reach',
        description: 'A region used for isolated generation tests.'
    });
    const stub = new Location({
        id: 'loc_validation_atomicity',
        name: 'Old Watchpost',
        description: 'An authoritative stub description.',
        shortDescription: 'old watchpost',
        baseLevel: 3,
        regionId: region.id,
        isStub: true,
        stubMetadata: {
            stubDescription: 'An authoritative stub description.',
            stubShortDescription: 'old watchpost',
            hasWeather: 'yes'
        }
    });
    const before = JSON.stringify(stub.toJSON());
    const regionMembersBefore = [...region.locationIds];
    const invalidXml = `<location>
        <name>Restored Watchpost</name>
        <description>A restored watchpost.</description>
        <shortDescription>restored watchpost</shortDescription>
        <baseLevel>3</baseLevel>
        <dangerLevel>6</dangerLevel>
        <hasWeather>yes</hasWeather>
    </location>`;

    assert.throws(() => Location.parseXMLSnippet(invalidXml, {
        existingLocation: stub,
        regionId: region.id,
        requireDangerLevel: true,
        requireHasWeather: true
    }), /Generated location <dangerLevel> must be an integer from 1 to 5/);
    assert.equal(JSON.stringify(stub.toJSON()), before);
    assert.deepEqual(region.locationIds, regionMembersBefore);
    assert.equal(Location.get(stub.id), stub);

    const validXml = invalidXml.replace('<dangerLevel>6</dangerLevel>', '<dangerLevel>2</dangerLevel>');
    const missingWeatherXml = validXml.replace('<hasWeather>yes</hasWeather>', '');
    assert.throws(() => Location.parseXMLSnippet(missingWeatherXml, {
        regionId: region.id,
        requireDangerLevel: true,
        requireHasWeather: true
    }), /is missing required <hasWeather>/);
    assert.deepEqual(Location.getAll().map(location => location.id), [stub.id],
        'a rejected new location is not registered in the location indexes');
    assert.deepEqual(region.locationIds, regionMembersBefore,
        'a rejected new location is not added to region membership');

    const plan = Location.parseXMLSnippet(validXml, {
        existingLocation: stub,
        regionId: region.id,
        requireDangerLevel: true,
        requireHasWeather: true
    });
    assert.equal(JSON.stringify(stub.toJSON()), before, 'parsing yields a detached promotion plan');
    assert.deepEqual(region.locationIds, regionMembersBefore);

    const committed = Location.commitParsedSnippet(plan);
    assert.equal(committed, stub, 'stub promotion preserves the authoritative location identity');
    assert.equal(stub.isStub, false);
    assert.equal(stub.name, 'Restored Watchpost');
    assert.equal(stub.dangerLevel, 2);
    assert.equal(Location.get(stub.id), stub);
    assert.deepEqual(region.locationIds, regionMembersBefore);

    Location.clear();
    Region.clear();
});

test('StatusEffect generation corrects a rejected source description before assigning an ID', { concurrency: false }, async () => {
    const originalPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRegistry = Globals.modExtensionRegistry;
    const root = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(root, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(root, 'status-response-validation-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 1,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    Globals.modExtensionRegistry = null;
    const payloads = [];
    const invalidResponse = `<statusEffects><effect>
        <sourceDescription>Different source text</sourceDescription>
        <description>A malformed candidate.</description>
    </effect></statusEffects>`;
    const validResponse = `<statusEffects><effect>
        <sourceDescription>A restorative pulse.</sourceDescription>
        <name>Restored</name>
        <description>Restores focus.</description>
        <duration>5 minutes</duration>
        <attributes><attribute><name>Wisdom</name><modifier>1</modifier></attribute></attributes>
    </effect></statusEffects>`;
    const statusIdStart = IdGenerator.snapshotCounters().status || 0;

    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        if (payloads.length === 2) {
            assert.equal(IdGenerator.snapshotCounters().status || 0, statusIdStart,
                'the rejected response and correction request allocate no final status IDs');
        }
        return completionResponse(payload, payloads.length === 1 ? invalidResponse : validResponse);
    };

    try {
        const results = await StatusEffect.generateFromDescriptions(['A restorative pulse.'], {
            promptEnv: { render: () => '<template/>' },
            parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generate a status effect' }),
            prepareBasePromptContext: async () => ({})
        });

        assert.equal(payloads.length, 2);
        const correction = payloads[1].messages.slice(-2);
        assert.equal(correction[0].role, 'assistant');
        assert.match(correction[1].content, /Generated status effect refers to unknown sourceDescription/);
        assert.equal(results.size, 1);
        const effect = results.get('A restorative pulse.');
        assert.ok(effect.id);
        assert.equal(effect.name, 'Restored');
        assert.equal(effect.duration, 5);
        assert.equal((IdGenerator.snapshotCounters().status || 0), statusIdStart + 1);
    } finally {
        axios.post = originalPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.modExtensionRegistry = originalRegistry;
    }
});

test('alter_location validates malformed XML before mutating the target', { concurrency: false }, async () => {
    const originalChatCompletion = LLMClient.chatCompletion;
    const originalGlobalsConfig = Globals.config;
    const previousDeps = Events._deps;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const location = {
        id: 'loc_alter_validation',
        name: 'Quiet Study',
        description: 'A dusty study.',
        shortDescription: 'dusty study',
        baseLevel: 4,
        getDetails() {
            return { name: this.name, description: this.description, shortDescription: this.shortDescription, baseLevel: this.baseLevel, generationHints: {} };
        },
        getStatusEffects() { return []; },
        addStatusEffect() {}
    };
    const originalState = { name: location.name, description: location.description, baseLevel: location.baseLevel };
    let rejectedError = null;
    let completionOptions = null;

    Globals.config = { ai: { retryAttempts: 1 } };
    Events.initialize({
        config: Globals.config,
        promptEnv: { render: () => '<template/>' },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }),
        prepareBasePromptContext: async () => ({}),
        Location: { get: () => location },
        generatedImages: new Map()
    });
    LLMClient.chatCompletion = async options => {
        completionOptions = options;
        assert.equal(options.throwOnError, true);
        assert.equal(options.responseValidationRetryFeedback, true);
        try {
            options.responseValidator('This is not location XML.');
        } catch (error) {
            rejectedError = error;
        }
        assert.ok(rejectedError, 'the malformed XML response is rejected by the actual location parser');
        assert.deepEqual({ name: location.name, description: location.description, baseLevel: location.baseLevel }, originalState,
            'rejected response does not touch world state before a correction is accepted');
        const accepted = `<location><name>Restored Study</name>
            <description>A clean study with repaired windows.</description>
            <shortDescription>clean study</shortDescription><baseLevel>4</baseLevel></location>`;
        await options.responseValidator(accepted);
        return accepted;
    };

    try {
        await Events._handlers.alter_location.call(Events, [{
            currentName: location.name,
            newName: location.name,
            description: 'Repair the windows.'
        }], { location });
        assert.ok(completionOptions);
        assert.ok(rejectedError);
        assert.equal(location.name, 'Restored Study');
        assert.equal(location.description, 'A clean study with repaired windows.');
    } finally {
        LLMClient.chatCompletion = originalChatCompletion;
        Globals.config = originalGlobalsConfig;
        Events._deps = previousDeps;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
    }
});

test('mystery thread check rejects an invalid envelope before accepting its corrected result', { concurrency: false }, async () => {
    const originalChatCompletion = LLMClient.chatCompletion;
    const originalLogPrompt = LLMClient.logPrompt;
    const originalGetActive = MysteryThread.getActive;
    const originalSerializer = Events._serializeMysteryThreadForPrompt;
    const originalMarkThreads = Events._markResolvedMysteryThreadsInactive;
    const previousDeps = Events._deps;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;
    const errors = [];
    const applied = [];

    MysteryThread.getActive = () => [{ id: 'thread-validation', name: 'The Quiet Bell', status: 'active' }];
    Events._serializeMysteryThreadForPrompt = thread => ({ id: thread.id, name: thread.name, boxes: [] });
    Events._markResolvedMysteryThreadsInactive = threads => {
        applied.push(...threads);
        return threads;
    };
    LLMClient.logPrompt = () => '/tmp/mystery-thread-validation.log';
    Events.initialize({
        config: {},
        promptEnv: { render: () => '<template/>' },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'check the thread' }),
        prepareBasePromptContext: async () => ({})
    });
    LLMClient.chatCompletion = async options => {
        assert.equal(options.responseValidationRetryFeedback, true);
        assert.equal(options.throwOnError, true);
        for (const response of ['<wrongRoot/>', '<resolvedMysteries></resolvedMysteries>']) {
            try {
                options.responseValidator(response);
                return response;
            } catch (error) {
                errors.push(error);
            }
        }
        throw errors.at(-1);
    };

    try {
        const result = await Events._runMysteryThreadCheckPrompt({ textToCheck: 'The bell fell silent.' });
        assert.equal(errors.length, 1);
        assert.match(errors[0].message, /missing <resolvedMysteries> root/);
        assert.deepEqual(result, { inactivatedThreads: [], resolvedBoxes: [] });
        assert.deepEqual(applied, [], 'the invalid response never reaches the world-application callback');
    } finally {
        LLMClient.chatCompletion = originalChatCompletion;
        LLMClient.logPrompt = originalLogPrompt;
        MysteryThread.getActive = originalGetActive;
        Events._serializeMysteryThreadForPrompt = originalSerializer;
        Events._markResolvedMysteryThreadsInactive = originalMarkThreads;
        Events._deps = previousDeps;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
    }
});

test('API validated-response adapter returns the already parsed accepted DTO', async () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('async function completeWithValidatedResponse(options, parseResponse) {');
    const end = source.indexOf('\nconst PromptAuditLog = require', start);
    assert.ok(start >= 0 && end > start, 'the production validation adapter is present');
    const observations = [];
    const responses = ['bad response', 'accepted response'];
    const context = {
        LLMClient: {
            async chatCompletion(options) {
                let accepted;
                while (responses.length) {
                    const text = responses.shift();
                    const attempt = { options, text };
                    observations.push(attempt);
                    try {
                        await options.responseValidator(text);
                        accepted = text;
                        break;
                    } catch (error) {
                        attempt.error = error;
                    }
                }
                return accepted;
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.completeWithValidatedResponse = completeWithValidatedResponse;`, context);

    let parseCalls = 0;
    const expectedError = new Error('Calendar event list must contain one event.');
    const result = await context.completeWithValidatedResponse({ metadataLabel: 'calendar_definition' }, response => {
        parseCalls += 1;
        if (response === 'bad response') throw expectedError;
        return { acceptedText: response, entries: ['one'] };
    });

    assert.equal(parseCalls, 2, 'the parser runs once per provider attempt; the accepted DTO is reused');
    assert.equal(observations.length, 2);
    assert.equal(observations[0].error, expectedError);
    assert.equal(observations[0].options.responseValidationRetryFeedback, true);
    assert.equal(observations[0].options.throwOnError, true);
    assert.equal(result.response, 'accepted response');
    assert.deepEqual(JSON.parse(JSON.stringify(result.parsed)), { acceptedText: 'accepted response', entries: ['one'] });
});

test('calendar generation caller retries its actual domain parser and returns the accepted DTO', { concurrency: false }, async () => {
    const originalPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const root = path.resolve(__dirname, '..', 'tmp');
    fs.mkdirSync(root, { recursive: true });
    Globals.baseDir = fs.mkdtempSync(path.join(root, 'calendar-response-validation-'));
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'test-model',
            stream: false,
            retryAttempts: 1,
            max_concurrent_requests: 1,
            supress_seed: true
        }
    };
    const payloads = [];
    const invalidCalendar = `<calendarDefinition><yearName>Test Year</yearName>
        <months><month><name>First</name><lengthDays>not-a-number</lengthDays></month></months>
        <weekdays><weekday>Day</weekday></weekdays></calendarDefinition>`;
    const validCalendar = `<calendarDefinition><yearName>Test Year</yearName>
        <months><month><name>First</name><lengthDays>30</lengthDays></month></months>
        <weekdays><weekday>Day</weekday></weekdays><seasons></seasons><holidays></holidays></calendarDefinition>`;
    axios.post = async (_endpoint, payload) => {
        payloads.push(JSON.parse(JSON.stringify(payload)));
        return completionResponse(payload, payloads.length === 1 ? invalidCalendar : validCalendar);
    };

    try {
        const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
        const helperStart = apiSource.indexOf('async function completeWithValidatedResponse(options, parseResponse) {');
        const helperEnd = apiSource.indexOf('\nconst PromptAuditLog = require', helperStart);
        const sanitizeStart = apiSource.indexOf('        function sanitizeXmlForDom(input) {');
        const sanitizeEnd = apiSource.indexOf('\n        function parseSettingXmlResponse', sanitizeStart);
        const parserStart = apiSource.indexOf('        function parseCalendarDefinitionXml(xmlContent) {');
        const parserEnd = apiSource.indexOf('\n        function parseSeasonImageDescriptionsXml', parserStart);
        const generatorStart = apiSource.indexOf('        async function generateCalendarDefinitionWithAi({ settingSnapshot = null } = {}) {');
        const generatorEnd = apiSource.indexOf('\n        async function resolveCalendarDefinitionForSetting', generatorStart);
        assert.ok(helperStart >= 0 && helperEnd > helperStart);
        assert.ok(sanitizeStart >= 0 && sanitizeEnd > sanitizeStart);
        assert.ok(parserStart >= 0 && parserEnd > parserStart);
        assert.ok(generatorStart >= 0 && generatorEnd > generatorStart);

        const context = {
            Globals,
            Utils: require('../Utils.js'),
            LLMClient,
            promptEnv: { render: () => '<template/>' },
            parseXMLTemplate: () => ({ systemPrompt: 'calendar system', generationPrompt: 'Generate a calendar.' }),
            buildCalendarSettingContext: () => ({ name: 'Validation Test' })
        };
        vm.createContext(context);
        vm.runInContext([
            apiSource.slice(helperStart, helperEnd),
            apiSource.slice(sanitizeStart, sanitizeEnd),
            apiSource.slice(parserStart, parserEnd),
            apiSource.slice(generatorStart, generatorEnd),
            'this.generateCalendarDefinitionWithAi = generateCalendarDefinitionWithAi;'
        ].join('\n'), context);

        const calendar = await context.generateCalendarDefinitionWithAi({ settingSnapshot: { name: 'Validation Test' } });
        assert.equal(payloads.length, 2);
        assert.equal(payloads[0].messages.at(-1).content, 'Generate a calendar.');
        assert.ok(payloads[1].messages.some(message => (
            typeof message.content === 'string'
            && /Calendar XML field months\.month\[1\]\.lengthDays must be a finite integer/.test(message.content)
        )), 'the actual calendar validation error is present in the correction conversation');
        assert.equal(calendar.yearName, 'Test Year');
        assert.equal(calendar.months[0].lengthDays, 30);
        assert.deepEqual(JSON.parse(JSON.stringify(calendar.weekdays)), ['Day']);
    } finally {
        axios.post = originalPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
    }
});
