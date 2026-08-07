const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');
const path = require('path');

const Events = require('../Events.js');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const {
    TinyBrainPromptExtension,
    createTinyBrainRenderState
} = require('../TinyBrainPromptRunner.js');
const { configureTinyBrainPromptContext } = require('../TinyBrainPromptFamilies.js');
const { buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts');

function createEventsPromptEnv() {
    const env = nunjucks.configure(PROMPTS_DIR, { autoescape: false });
    env.addGlobal('randomword', () => 'test');
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

function parseXMLTemplate(rendered) {
    const system = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/);
    const generation = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/);
    return {
        systemPrompt: system ? system[1] : null,
        generationPrompt: generation ? generation[1] : null
    };
}

function buildEventsContext(overrides = {}) {
    return {
        ...buildBaseRenderContext({}),
        promptType: 'events-xml',
        textToCheck: 'Exis picks up the lantern and hands Mira 5 credits.',
        omitGameHistory: true,
        currentLocation: { name: 'Test Location' },
        regionContext: { name: 'Test Region' },
        npcs: [],
        party: [],
        characterName: 'Exis',
        experiencePointValues: [],
        config: {},
        tinyBrainEventSectionKind: 'current',
        tinyBrainEventSectionLabel: 'CURRENT',
        tinyBrainEventStages: Events._buildTinyBrainEventStages(),
        ...overrides
    };
}

test('stage manifest separates current, transit, tracker, and suppressed stages', () => {
    const current = Events._buildTinyBrainEventStages();
    assert.deepEqual(
        current.map((stage) => stage.id),
        ['scene', 'items', 'characters', 'combat', 'progression', 'final', 'trackers']
    );
    assert.ok(current.at(-2).allowedTags.includes('currency'));
    assert.ok(current.at(-2).allowedTags.includes('inCombat'));
    assert.equal(current.at(-1).allowedTagList, '<trackerUpdates>');
    assert.deepEqual(current.at(-2).requiredTags, [
        'inCombat',
        'anyQuestObjectivesCompleted'
    ]);

    const origin = Events._buildTinyBrainEventStages({
        eventSectionKind: 'origin',
        suppressTimeAdvance: true,
        suppressTrackerUpdates: true,
        ignoredEventKeys: ['currency']
    });
    assert.ok(origin.every((stage) => !stage.allowedTags.includes('trackerUpdates')));
    assert.ok(origin.every((stage) => !stage.allowedTags.includes('timePassed')));
    assert.ok(origin.every((stage) => !stage.allowedTags.includes('currency')));

    const between = Events._buildTinyBrainEventStages({
        eventSectionKind: 'between',
        suppressTrackerUpdates: true
    });
    assert.deepEqual(between.map((stage) => stage.id), ['transit', 'final']);
    assert.ok(between.every((stage) =>
        stage.allowedTags.length === 1 && stage.allowedTags[0] === 'thingMoveWithCharacter'
    ));

    const trackers = Events._buildTinyBrainEventStages({
        eventSectionKind: 'tracker',
        eventMode: 'trackers'
    });
    assert.deepEqual(trackers.map((stage) => stage.id), ['trackers']);
});

test('tiny-brain event stage parser validates allowlists, semantics, trackers, and duplicates', () => {
    const done = Events.parseTinyBrainEventXmlStage('<done/>', {
        stageId: 'items',
        allowedTags: ['currency']
    });
    assert.equal(done.value.xml, '');

    const wrappedDone = Events.parseTinyBrainEventXmlStage(
        '<events><done/></events>',
        { stageId: 'items', allowedTags: ['currency'] }
    );
    assert.equal(wrappedDone.value.xml, '');
    assert.deepEqual(wrappedDone.value.signatures, []);

    const ignoredMove = Events.parseTinyBrainEventXmlStage(
        '<events><moveLocation><destinationName>Town Square</destinationName></moveLocation><arriveAtLocation/></events>',
        { stageId: 'scene', allowedTags: ['alterLocation'] }
    );
    assert.equal(ignoredMove.value.xml, '');
    assert.deepEqual(ignoredMove.value.signatures, []);
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><moveLocation><destinationName>Town Square</destinationName></moveLocation><arriveAtLocation/></events>',
            {
                stageId: 'final',
                allowedTags: ['inCombat'],
                requiredTags: ['inCombat']
            }
        ),
        /must include required tags: inCombat/
    );

    const ignoredNewMoveAlongsideEvent = Events.parseTinyBrainEventXmlStage(
        '<events><moveNewLocation><destinationName>New Square</destinationName></moveNewLocation><currency><amount>5</amount></currency><arriveAtLocation/></events>',
        { stageId: 'items', allowedTags: ['currency'] }
    );
    assert.doesNotMatch(ignoredNewMoveAlongsideEvent.value.xml, /moveNewLocation|arriveAtLocation/);
    assert.match(ignoredNewMoveAlongsideEvent.value.xml, /<currency>/);

    const currency = Events.parseTinyBrainEventXmlStage(
        '<events><currency><amount>5</amount></currency></events>',
        { stageId: 'items', allowedTags: ['currency'] }
    );
    assert.match(currency.value.xml, /<currency>/);
    assert.equal(currency.value.signatures.length, 1);

    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><currency><amount>5</amount></currency></events>',
            { stageId: 'scene', allowedTags: ['alterLocation'] }
        ),
        /does not allow <currency>/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><pickUpItem><fullItemName>Lantern</fullItemName><quantity>1</quantity></pickUpItem></events>',
            { stageId: 'items', allowedTags: ['pickUpItem'] }
        ),
        /requires a non-empty <actorName>/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><currency><amount>5</amount></currency></events>',
            {
                stageId: 'final',
                allowedTags: ['currency'],
                acceptedSignatures: currency.value.signatures
            }
        ),
        /repeated an already accepted/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><updateTracker><trackerName>Alarm</trackerName></updateTracker></events>',
            { sectionKind: 'tracker', stageId: 'trackers', allowedTags: ['trackerUpdates'] }
        ),
        /does not allow <updateTracker>/
    );

    const tracker = Events.parseTinyBrainEventXmlStage(
        '<events><trackerUpdates><trackerUpdate><trackerName>Alarm</trackerName><type>numerical_count</type><action>add</action><newValue>2</newValue><reason>Two guards remain.</reason></trackerUpdate></trackerUpdates></events>',
        { sectionKind: 'tracker', stageId: 'trackers', allowedTags: ['trackerUpdates'] }
    );
    assert.match(tracker.value.xml, /<trackerUpdates>/);
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><trackerUpdates></trackerUpdates></events>',
            { sectionKind: 'tracker', stageId: 'trackers', allowedTags: ['trackerUpdates'] }
        ),
        /must contain at least one/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('<done/>', {
            stageId: 'final',
            allowedTags: ['inCombat', 'anyQuestObjectivesCompleted'],
            requiredTags: ['inCombat', 'anyQuestObjectivesCompleted']
        }),
        /must include required tags/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('<events><done/></events>', {
            stageId: 'final',
            allowedTags: ['inCombat', 'anyQuestObjectivesCompleted'],
            requiredTags: ['inCombat', 'anyQuestObjectivesCompleted']
        }),
        /must include required tags/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><done/><currency><amount>5</amount></currency></events>',
            { stageId: 'items', allowedTags: ['currency'] }
        ),
        /only as the sole empty child/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage(
            '<events><done reason="none"/></events>',
            { stageId: 'items', allowedTags: ['currency'] }
        ),
        /only as the sole empty child/
    );
});

test('tiny-brain event stage parser rejects empty and malformed responses', () => {
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('<events></events>', {
            stageId: 'items',
            allowedTags: ['currency']
        }),
        /no event elements/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('<events><currency></events>', {
            stageId: 'items',
            allowedTags: ['currency']
        }),
        /Failed to parse/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlStage('   ', {
            stageId: 'items',
            allowedTags: ['currency']
        }),
        /non-whitespace/
    );
});

test('events tiny-brain template registers category checkpoints and local result builder', () => {
    const env = createEventsPromptEnv();
    const ctx = buildEventsContext();
    const templateContext = { ...ctx };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
    const state = tinyBrain.renderState;
    const full = env.render('base-context.xml.njk', templateContext);

    assert.ok(full.includes(state.programStartMarker), 'program start marker missing');
    assert.equal(state.checkpoints.length, 7);
    assert.equal(state.resultMarkers.length, 1);
    assert.equal(state.resultMarkers[0].builderName, 'event_xml_result');
    for (const checkpoint of state.checkpoints) {
        assert.equal(checkpoint.kind, 'parse');
        assert.equal(checkpoint.parserName, 'event_xml_stage');
        assert.equal(checkpoint.parserArgs[0], 'current');
    }
    assert.deepEqual(
        state.checkpoints.map((checkpoint) => checkpoint.parserArgs[1]),
        ['scene', 'items', 'characters', 'combat', 'progression', 'final', 'trackers']
    );
    assert.match(full, /# Events XML Event Schema/, 'schema include missing');
    assert.match(full, /<trackerUpdates>/, 'tracker schema should be documented');
    assert.doesNotMatch(
        full,
        /<moveLocation>|<moveNewLocation>|<arriveAtLocation\s*\/>|## Travel Boundary/,
        'staged schema must not document movement XML owned by player-action parsing'
    );
    assert.match(
        full,
        /Player movement is handled before event extraction and must not be emitted here/,
        'staged schema must explain that movement is handled before event extraction'
    );
    assert.doesNotMatch(
        full,
        /### `(?:in_combat|anyQuestObjectivesCompleted)` \(REQUIRED FIELD, 1x ONLY\)/,
        'staged schema must not present final-checkpoint fields as globally required'
    );
    assert.match(
        full,
        /A tag is required only when the current checkpoint explicitly lists it/,
        'checkpoint-local required-field instruction missing'
    );
    assert.match(
        full,
        /do not emit `<inCombat>` or `<anyQuestObjectivesCompleted>` before that checkpoint/,
        'final state flags must be forbidden before their checkpoint'
    );
    assert.match(
        full,
        /If there are none, return exactly `<events><done\/><\/events>`/,
        'empty checkpoint response must use the explicit events wrapper'
    );
    assert.doesNotMatch(full, /Do not write any XML in this first step/);

    const marker = state.programStartMarker;
    const generationPrompt = parseXMLTemplate(full).generationPrompt;
    const programInFull = generationPrompt.slice(generationPrompt.indexOf(marker) + marker.length);
    const state2 = createTinyBrainRenderState();
    const standalone = env.render('_includes/events-xml.tinybrain.njk', {
        ...ctx,
        __tinyBrainState: state2
    });
    const markerPattern = /\[\[TINYBRAIN_(?:CHECKPOINT|RESULT):[a-f0-9-]+:/g;
    assert.equal(
        programInFull.replace(markerPattern, '[[TINYBRAIN_MARKER:').trimEnd(),
        standalone.replace(markerPattern, '[[TINYBRAIN_MARKER:').trimEnd()
    );
});

test('base-context render without the tiny-brain flag keeps the monolithic events template', () => {
    const env = createEventsPromptEnv();
    const ctx = buildEventsContext();
    const state = createTinyBrainRenderState();
    const rendered = env.render('base-context.xml.njk', {
        ...ctx,
        __tinyBrainState: state
    });

    assert.equal(state.checkpoints.length, 0);
    assert.match(rendered, /Output only one `<events>\.\.\.<\/events>` XML block/);
    assert.match(rendered, /<trackerUpdates>/);
    assert.match(rendered, /<moveLocation>/);
    assert.match(rendered, /<moveNewLocation>/);
    assert.match(rendered, /<arriveAtLocation\/>/);
    assert.match(rendered, /## Travel Boundary/);
    assert.match(rendered, /### `in_combat` \(REQUIRED FIELD, 1x ONLY\)/);
    assert.match(rendered, /### `anyQuestObjectivesCompleted` \(REQUIRED FIELD, 1x ONLY\)/);
});

test('staged tiny-brain run retries one malformed checkpoint and assembles validated XML locally', async () => {
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousWithPromptProgressGroup = LLMClient.withPromptProgressGroup;
    const previousClearPromptProgressGroup = LLMClient.clearPromptProgressGroup;

    const env = createEventsPromptEnv();
    const ctx = buildEventsContext();
    const templateContext = { ...ctx };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
    const state = tinyBrain.renderState;
    const rendered = env.render('base-context.xml.njk', templateContext);

    const script = [
        '<done/>',
        '<events><pickUpItem><actorName>Exis</actorName><fullItemName>Lantern</fullItemName><quantity>1</quantity></pickUpItem><currency><amount>5</amount></currency></events>',
        '<done/>',
        '<done/>',
        '<done/>',
        '<events><inCombat><value>false</value></inCombat><anyQuestObjectivesCompleted><value>false</value></anyQuestObjectivesCompleted></events>',
        '<events><updateTracker><trackerName>Alarm</trackerName></updateTracker></events>',
        '<done/>'
    ];
    let calls = 0;
    const progressGroups = [];
    const clearedProgressGroups = [];
    Globals.config = { ai: { retryAttempts: 1 } };
    LLMClient.chatCompletion = async () => script[Math.min(calls++, script.length - 1)];
    LLMClient.logPrompt = () => '/tmp/tinybrain-events-test.log';
    LLMClient.withPromptProgressGroup = async (options, callback) => {
        progressGroups.push(options);
        return await callback();
    };
    LLMClient.clearPromptProgressGroup = (progressGroupId, options) => {
        clearedProgressGroups.push({ progressGroupId, options });
    };

    try {
        const assembled = await Events._runTinyBrainEventXmlPrompt({
            initialRenderedTemplate: rendered,
            templateContext,
            tinyBrain,
            promptEnv: env,
            parseXMLTemplate
        });

        assert.equal(calls, 8, 'seven stages plus one tracker-stage retry');
        assert.deepEqual(progressGroups, [{
            progressGroupId: state.runId,
            progressGroupTargetLabel: 'event_checks_tinybrain'
        }]);
        assert.deepEqual(clearedProgressGroups, [{
            progressGroupId: state.runId,
            options: { recordOutputCharacters: true }
        }]);
        assert.match(assembled, /^<events>/);
        assert.match(assembled, /<pickUpItem>/);
        assert.match(assembled, /<currency>/);
        assert.match(assembled, /<inCombat>/);
        assert.doesNotMatch(assembled, /updateTracker/);

        const parsed = Events._parseXmlEventCheckResponse(assembled, {});
        assert.equal(parsed.structured.parsed.currency, 5);
        assert.equal(parsed.structured.parsed.in_combat, false);
    } finally {
        Globals.config = previousConfig;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        LLMClient.withPromptProgressGroup = previousWithPromptProgressGroup;
        LLMClient.clearPromptProgressGroup = previousClearPromptProgressGroup;
    }
});

test('event sequence carries accepted section responses into the next section transcript and log', { concurrency: false }, async () => {
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const env = createEventsPromptEnv();
    const eventSequence = Events.createTinyBrainEventSequence();
    const completionMessages = [];
    const logCalls = [];
    const logFilePath = '/tmp/tinybrain-events-sequence.log';
    const scriptedResponses = [
        '<events><currency><amount>5</amount></currency></events>',
        '<events><done/></events>'
    ];
    let responseIndex = 0;

    const runSection = async (sectionKind) => {
        const templateContext = buildEventsContext({
            textToCheck: `${sectionKind} prose.`,
            tinyBrainEventSectionKind: sectionKind,
            tinyBrainEventSectionLabel: sectionKind.toUpperCase(),
            tinyBrainAcceptedEventXml: Events._buildTinyBrainAcceptedEventXml(eventSequence),
            tinyBrainEventStages: [{
                id: 'items',
                label: 'currency',
                instructions: 'Report currency changes.',
                allowedTags: ['currency'],
                requiredTags: [],
                allowedTagList: '<currency>',
                allowRegisteredXmlEvents: false
            }]
        });
        const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
        const rendered = env.render('base-context.xml.njk', templateContext);
        return Events._runTinyBrainEventXmlPrompt({
            initialRenderedTemplate: rendered,
            templateContext,
            tinyBrain,
            promptEnv: env,
            parseXMLTemplate,
            tinyBrainEventSequence: eventSequence
        });
    };

    Globals.config = { ai: { retryAttempts: 0 } };
    LLMClient.chatCompletion = async (options = {}) => {
        completionMessages.push(options.messages.map(message => ({ ...message })));
        return scriptedResponses[responseIndex++];
    };
    LLMClient.logPrompt = (options = {}) => {
        logCalls.push(options);
        return options.filePath || logFilePath;
    };

    try {
        const origin = await runSection('origin');
        const destination = await runSection('destination');

        assert.match(origin, /<currency>/);
        assert.doesNotMatch(destination, /<currency>/);
        assert.equal(completionMessages.length, 2);
        assert.ok(completionMessages[1].some(message => (
            message.role === 'assistant'
            && message.content === scriptedResponses[0]
        )));
        assert.match(completionMessages[1].at(-1).content, /<acceptedSectionEvents>/);
        assert.match(completionMessages[1].at(-1).content, /<currency><amount>5<\/amount><\/currency>/);
        assert.equal(eventSequence.continuationState.logFilePath, logFilePath);
        assert.equal(logCalls.filter(call => !call.append).length, 1);
        assert.ok(logCalls.slice(1).every(call => call.filePath === logFilePath));
    } finally {
        Globals.config = previousConfig;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
    }
});

test('runEventChecks uses category stages and applies accepted events when tinybrain is enabled', async () => {
    const previousConfig = Globals.config;
    const previousCurrentPlayer = Globals.currentPlayer;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousDeps = Events._deps;
    const previousTimeout = Events._baseTimeout;
    const previousParsers = Events._parsers;
    const previousAggregators = Events._aggregators;
    const previousHandlers = Events._handlers;

    const player = {
        isNPC: false,
        name: 'Wanderer',
        currency: 0,
        getCurrency() {
            return this.currency;
        },
        adjustCurrency(amount) {
            this.currency += amount;
        }
    };

    const script = [
        '<done/>',
        '<events><currency><amount>7</amount></currency></events>',
        '<done/>',
        '<done/>',
        '<done/>',
        '<events><inCombat><value>false</value></inCombat><anyQuestObjectivesCompleted><value>false</value></anyQuestObjectivesCompleted></events>',
        '<done/>'
    ];
    let eventStageCalls = 0;
    const loggedPrefixes = [];

    try {
        Globals.config = {
            ai: { tinybrain: true, retryAttempts: 1 },
            event_checks: { enabled: true },
            quests: { enabled: false },
            omit_npc_generation: true
        };
        Globals.currentPlayer = player;
        LLMClient.chatCompletion = async (options = {}) => {
            const lastMessage = Array.isArray(options.messages)
                ? options.messages[options.messages.length - 1]?.content || ''
                : '';
            if (lastMessage.includes('affectedNeedBars')) {
                return '<characters></characters>';
            }
            const response = script[Math.min(eventStageCalls, script.length - 1)];
            eventStageCalls += 1;
            return response;
        };
        LLMClient.logPrompt = (entry) => {
            loggedPrefixes.push(entry?.prefix || null);
            return '/tmp/tinybrain-events-runeventchecks.log';
        };

        Events.initialize({
            promptEnv: createEventsPromptEnv(),
            parseXMLTemplate,
            prepareBasePromptContext: async () => ({
                ...buildBaseRenderContext({}),
                needBarDefinitions: [],
                npcs: [],
                party: [],
                currentLocation: { name: 'Test Location' },
                regionContext: { name: 'Test Region' },
                characterName: 'Wanderer',
                experiencePointValues: [],
                config: Globals.config
            }),
            Location: { get: () => null },
            findRegionByLocationId: () => null,
            findActorByName: (name) => (name === 'Wanderer' ? player : null),
            getCurrentPlayer: () => player,
            getConfig: () => Globals.config
        });

        const result = await Events.runEventChecks({
            textToCheck: 'Wanderer finds seven coins.'
        });

        assert.equal(eventStageCalls, 7);
        assert.equal(result.currencyChanges.length, 1);
        assert.equal(result.currencyChanges[0].amount, 7);
        assert.equal(player.currency, 7);
        assert.ok(
            loggedPrefixes.includes('events_tinybrain'),
            `expected events_tinybrain log prefix, got: ${loggedPrefixes.join(', ')}`
        );
    } finally {
        Events._deps = previousDeps;
        Events._baseTimeout = previousTimeout;
        Events._parsers = previousParsers;
        Events._aggregators = previousAggregators;
        Events._handlers = previousHandlers;
        Globals.config = previousConfig;
        Globals.currentPlayer = previousCurrentPlayer;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
    }
});

test('tiny-brain event stage retry exhaustion fails explicitly without assembling invalid XML', async () => {
    const previousConfig = Globals.config;
    const previousChatCompletion = LLMClient.chatCompletion;
    const previousLogPrompt = LLMClient.logPrompt;
    const previousWithPromptProgressGroup = LLMClient.withPromptProgressGroup;
    const previousClearPromptProgressGroup = LLMClient.clearPromptProgressGroup;
    const env = createEventsPromptEnv();
    const templateContext = buildEventsContext();
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
    const rendered = env.render('base-context.xml.njk', templateContext);
    let calls = 0;

    try {
        Globals.config = { ai: { retryAttempts: 1 } };
        LLMClient.chatCompletion = async () => {
            calls += 1;
            return '<events><currency><amount>3</amount></currency></events>';
        };
        LLMClient.logPrompt = () => '/tmp/tinybrain-events-exhaustion.log';
        LLMClient.withPromptProgressGroup = async (_options, callback) => await callback();
        LLMClient.clearPromptProgressGroup = () => {};

        await assert.rejects(
            Events._runTinyBrainEventXmlPrompt({
                initialRenderedTemplate: rendered,
                templateContext,
                tinyBrain,
                promptEnv: env,
                parseXMLTemplate
            }),
            /checkpoint 1 failed to parse after 2 attempts.*does not allow <currency>/s
        );
        assert.equal(calls, 2);
        assert.equal(Object.keys(tinyBrain.renderState.completedCheckpoints).length, 0);
    } finally {
        Globals.config = previousConfig;
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        LLMClient.withPromptProgressGroup = previousWithPromptProgressGroup;
        LLMClient.clearPromptProgressGroup = previousClearPromptProgressGroup;
    }
});
