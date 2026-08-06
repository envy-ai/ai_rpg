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
        textToCheck: 'Exis picks up the lantern and hands Mira 5 credits before leaving for the Observatory.',
        omitGameHistory: true,
        currentLocation: { name: 'Test Location' },
        regionContext: { name: 'Test Region' },
        npcs: [],
        party: [],
        characterName: 'Exis',
        experiencePointValues: [],
        config: {},
        ...overrides
    };
}

test('tiny-brain event chunk parser handles done, N/A, and valid chunks', () => {
    const done = Events.parseTinyBrainEventXmlChunk('<done/>');
    assert.equal(done.terminate, true);
    assert.equal(done.value, false);

    const doneSpelledOut = Events.parseTinyBrainEventXmlChunk('<done></done>');
    assert.equal(doneSpelledOut.terminate, true);

    const na = Events.parseTinyBrainEventXmlChunk('N/A');
    assert.equal(na.terminate, true);

    const one = Events.parseTinyBrainEventXmlChunk(
        '<events><currency><amount>5</amount></currency></events>'
    );
    assert.equal(one.terminate, undefined);
    assert.match(one.value.xml, /<currency>/);
    assert.doesNotMatch(one.value.xml, /<events>/);

    const two = Events.parseTinyBrainEventXmlChunk(
        '```xml\n<events><currency><amount>5</amount></currency><healRecover><characterName>Exis</characterName><amount>10</amount></healRecover></events>\n```'
    );
    assert.match(two.value.xml, /<healRecover>/);

    const three = Events.parseTinyBrainEventXmlChunk(
        '<events><currency><amount>1</amount></currency><currency><amount>2</amount></currency><currency><amount>3</amount></currency></events>'
    );
    assert.equal((three.value.xml.match(/<currency>/g) || []).length, 3);
});

test('tiny-brain event chunk parser rejects empty and malformed chunks', () => {
    assert.throws(
        () => Events.parseTinyBrainEventXmlChunk('<events></events>'),
        /no event elements/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlChunk('<events><currency></events>'),
        /Failed to parse/
    );
    assert.throws(
        () => Events.parseTinyBrainEventXmlChunk('   '),
        /non-whitespace/
    );
});

test('events tiny-brain template registers brainstorm plus five chunk checkpoints', () => {
    const env = createEventsPromptEnv();
    const ctx = buildEventsContext();

    const templateContext = { ...ctx };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'event_checks');
    const state = tinyBrain.renderState;
    const full = env.render('base-context.xml.njk', templateContext);

    assert.ok(full.includes(state.programStartMarker), 'program start marker missing');
    assert.equal(state.checkpoints.length, 6);
    assert.equal(state.checkpoints[0].kind, 'dummy');
    for (const checkpoint of state.checkpoints.slice(1)) {
        assert.equal(checkpoint.kind, 'parse');
        assert.equal(checkpoint.parserName, 'event_xml_chunk');
    }
    assert.match(full, /# Events XML Event Schema/, 'schema include missing');
    assert.match(full, /at most 2/);

    // Program text after the marker must equal the standalone program render
    // (the runner re-renders the program template by itself). The runner
    // operates on the extracted generationPrompt, not the raw render.
    const marker = state.programStartMarker;
    const generationPrompt = parseXMLTemplate(full).generationPrompt;
    const programInFull = generationPrompt.slice(generationPrompt.indexOf(marker) + marker.length);
    const state2 = createTinyBrainRenderState();
    const standalone = env.render('_includes/events-xml.tinybrain.njk', {
        ...ctx,
        __tinyBrainState: state2
    });
    const markerPattern = /\[\[TINYBRAIN_CHECKPOINT:[a-f0-9-]+:/g;
    assert.equal(
        programInFull.replace(markerPattern, '[[TINYBRAIN_CHECKPOINT:').trimEnd(),
        standalone.replace(markerPattern, '[[TINYBRAIN_CHECKPOINT:').trimEnd()
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
});

test('staged tiny-brain run assembles chunks that parse identically to the monolithic block', async () => {
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
        'Analysis: Exis picks up the lantern; Mira receives 5 credits; Exis travels to the Observatory.',
        '<events><pickUpItem><actorName>Exis</actorName><fullItemName>lantern</fullItemName><quantity>1</quantity></pickUpItem></events>',
        '<events><currency><actorName>Mira</actorName><amount>5</amount></currency><moveLocation><destinationName>Observatory</destinationName></moveLocation></events>',
        '<events><arriveAtLocation/></events>',
        '<done/>'
    ];
    let calls = 0;
    const progressGroups = [];
    const clearedProgressGroups = [];
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

        assert.equal(calls, 5, 'brainstorm + 3 chunks + done should use 5 completions');
        assert.deepEqual(progressGroups, [{
            progressGroupId: state.runId,
            progressGroupTargetLabel: 'event_checks_tinybrain'
        }]);
        assert.deepEqual(clearedProgressGroups, [{
            progressGroupId: state.runId,
            options: { recordOutputCharacters: true }
        }]);

        const monolithic = `<events>
  <pickUpItem><actorName>Exis</actorName><fullItemName>lantern</fullItemName><quantity>1</quantity></pickUpItem>
  <currency><actorName>Mira</actorName><amount>5</amount></currency>
  <moveLocation><destinationName>Observatory</destinationName></moveLocation>
  <arriveAtLocation/>
</events>`;

        const stagedParsed = Events._parseXmlEventCheckResponse(assembled, {});
        const monolithicParsed = Events._parseXmlEventCheckResponse(monolithic, {});

        assert.equal(stagedParsed.hasTravelBoundary, monolithicParsed.hasTravelBoundary);
        assert.deepEqual(
            Object.keys(stagedParsed.structured.parsed).sort(),
            Object.keys(monolithicParsed.structured.parsed).sort()
        );
        assert.deepEqual(stagedParsed.structured.parsed.currency, monolithicParsed.structured.parsed.currency);
        assert.deepEqual(
            stagedParsed.beforeTravel.structured.parsed.pick_up_item,
            monolithicParsed.beforeTravel.structured.parsed.pick_up_item
        );
        assert.deepEqual(
            Object.keys(stagedParsed.afterTravel.structured.parsed).sort(),
            Object.keys(monolithicParsed.afterTravel.structured.parsed).sort()
        );
    } finally {
        LLMClient.chatCompletion = previousChatCompletion;
        LLMClient.logPrompt = previousLogPrompt;
        LLMClient.withPromptProgressGroup = previousWithPromptProgressGroup;
        LLMClient.clearPromptProgressGroup = previousClearPromptProgressGroup;
    }
});

test('runEventChecks uses the staged tiny-brain pipeline when ai.tinybrain is enabled', async () => {
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
        'Analysis: Wanderer finds seven coins.',
        '<events><currency><amount>7</amount></currency></events>',
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

        assert.equal(eventStageCalls, 3, 'brainstorm + 1 chunk + done should use 3 completions');
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
