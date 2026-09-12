const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const Utils = require('../Utils.js');
const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');
const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
const actionSuggestionsPrompt = fs.readFileSync(
    require.resolve('../prompts/_includes/action-suggestions.njk'),
    'utf8'
);

function loadActionSuggestionsParser() {
    const start = apiSource.indexOf('        function parseActionSuggestionsResponse(response) {');
    const end = apiSource.indexOf("        app.post('/api/chat/action-suggestions'", start);
    assert.notEqual(start, -1, 'Missing action suggestions parser.');
    assert.notEqual(end, -1, 'Missing action suggestions route.');
    const context = { Utils, Array, Error, Intl, Set, String };
    vm.createContext(context);
    vm.runInContext(`${apiSource.slice(start, end)}\nthis.parseActionSuggestionsResponse = parseActionSuggestionsResponse;`, context);
    return context.parseActionSuggestionsResponse;
}

function actionSuggestionsRouteSource() {
    const start = apiSource.indexOf("        app.post('/api/chat/action-suggestions'");
    const end = apiSource.indexOf("        // Chat API endpoint", start);
    assert.notEqual(start, -1, 'Missing action suggestions route.');
    assert.notEqual(end, -1, 'Missing action suggestions route end.');
    return apiSource.slice(start, end);
}

function loadActionSuggestionsRoute({ gameLoaded = true, loading = false, tinybrain = false, responses = [] } = {}) {
    let handler;
    const logs = [];
    const app = { post(path, callback) { if (path === '/api/chat/action-suggestions') handler = callback; } };
    const context = {
        app,
        Utils,
        Array,
        Error,
        Intl,
        Set,
        String,
        console: { error() {} },
        currentPlayer: gameLoaded ? { name: 'Tester' } : null,
        gameLoadInProgress: loading,
        Globals: { gameLoaded },
        config: { ai: { tinybrain } },
        prepareBasePromptContext: async () => ({
            currentLocation: { name: 'Square', items: [], scenery: [], exits: [] },
            currentRegion: { name: 'Town', secrets: ['not exposed'] },
            npcs: [],
            trackers: []
        }),
        promptEnv: { render: () => '<prompt />' },
        parseXMLTemplate: () => ({ systemPrompt: 'System context', generationPrompt: 'Suggest three actions.' }),
        resolveConfiguredPromptMaxAttempts: () => 2,
        runPromptWithParseRetries,
        LLMClient: {
            chatCompletion: async () => responses.shift(),
            logPrompt: entry => logs.push(entry)
        }
    };
    vm.createContext(context);
    vm.runInContext(apiSource.slice(apiSource.indexOf('        function parseActionSuggestionsResponse(response) {'), apiSource.indexOf('        // Chat API endpoint', apiSource.indexOf("        app.post('/api/chat/action-suggestions'"))), context);
    assert.equal(typeof handler, 'function', 'Action suggestions route was not registered.');
    return { handler, logs };
}

async function invokeRoute(handler) {
    const result = { status: 200, body: undefined };
    const res = {
        status(code) { result.status = code; return this; },
        json(body) { result.body = body; return this; }
    };
    await handler({}, res);
    return result;
}

test('action suggestions parser accepts exactly three direct, distinct complete actions', () => {
    const parse = loadActionSuggestionsParser();
    const suggestions = parse([
        '<actionSuggestions>',
        '<action>Ask the guard about the closed gate.</action>',
        '<action>Examine the muddy footprints by the archway.</action>',
        '<action>Offer the merchant a fair trade for local news.</action>',
        '</actionSuggestions>'
    ].join(''));

    assert.deepEqual(JSON.parse(JSON.stringify(suggestions)), [
        'Ask the guard about the closed gate.',
        'Examine the muddy footprints by the archway.',
        'Offer the merchant a fair trade for local news.'
    ]);
});

test('action suggestions explicitly forbid recommendations based on player-hidden information', () => {
    assert.match(
        actionSuggestionsPrompt,
        /Do not base any recommendation on information that is explicitly hidden from the player/i
    );
});

test('action suggestions parser rejects malformed, duplicate, blank, and command-like actions', () => {
    const parse = loadActionSuggestionsParser();
    const invalidResponses = [
        '<actionSuggestions><action>One.</action><action>Two.</action></actionSuggestions>',
        '<actionSuggestions><action>One.</action><action>one.</action><action>Three.</action></actionSuggestions>',
        '<actionSuggestions><action>One.</action><action> </action><action>Three.</action></actionSuggestions>',
        '<actionSuggestions><action>/save now.</action><action>Two.</action><action>Three.</action></actionSuggestions>',
        '<actionSuggestions><action>One</action><action>Two.</action><action>Three.</action></actionSuggestions>',
        '<actionSuggestions><action>One. Then two.</action><action>Two.</action><action>Three.</action></actionSuggestions>',
        '<actionSuggestions><action><verb>Ask.</verb></action><action>Two.</action><action>Three.</action></actionSuggestions>',
        '<actionSuggestions>stray text<action>One.</action><action>Two.</action><action>Three.</action></actionSuggestions>',
        'Preface <actionSuggestions><action>One.</action><action>Two.</action><action>Three.</action></actionSuggestions>'
    ];

    invalidResponses.forEach(response => assert.throws(() => parse(response)));
});

test('action suggestions retry rejected XML without accepting malformed output', async () => {
    const parse = loadActionSuggestionsParser();
    const responses = [
        '<actionSuggestions><action>Only one.</action></actionSuggestions>',
        '<actionSuggestions><action>Ask the guard about the closed gate.</action><action>Examine the muddy footprints by the archway.</action><action>Offer the merchant a fair trade for local news.</action></actionSuggestions>'
    ];
    const calls = [];
    const result = await runPromptWithParseRetries({
        messages: [{ role: 'user', content: 'Suggest actions.' }],
        maxAttempts: 2,
        complete: ({ messages }) => {
            calls.push(messages);
            return responses.shift();
        },
        parse,
        buildRetryInstruction: error => `Correct: ${error.message}`
    });

    assert.equal(result.attempts, 2);
    assert.equal(result.value.length, 3);
    assert.match(calls[1].at(-1).content, /exactly three direct <action>/);
});

test('action suggestions route gates unloaded games, uses the shared prompt retry/log path, and does not start a turn', () => {
    const route = actionSuggestionsRouteSource();
    assert.match(route, /!currentPlayer \|\| !Globals\.gameLoaded/);
    assert.match(route, /if \(gameLoadInProgress\)/);
    assert.match(route, /status\(409\).*Load or start a game/s);
    assert.match(route, /promptType:\s*'action-suggestions'/);
    assert.match(route, /metadataLabel:\s*'action_suggestions'/);
    assert.match(route, /runPromptWithParseRetries\(/);
    assert.match(route, /parse:\s*parseActionSuggestionsResponse/);
    assert.match(route, /LLMClient\.logPrompt\(/);
    assert.match(route, /preserveBaseContextToolDefinitions:\s*true/);
    assert.doesNotMatch(route, /runAutosaveIfEnabled|trackActiveChatTurn|currentTurnToken|chatHistory\.push/);
});

test('action suggestions route invokes the shared completion path, retries malformed output, and works for ordinary and TinyBrain config', async () => {
    const valid = '<actionSuggestions><action>Ask the guard about the closed gate.</action><action>Examine the muddy footprints by the archway.</action><action>Offer the merchant a fair trade for local news.</action></actionSuggestions>';
    for (const tinybrain of [false, true]) {
        const route = loadActionSuggestionsRoute({
            tinybrain,
            responses: ['<actionSuggestions><action>Only one.</action></actionSuggestions>', valid]
        });
        const result = await invokeRoute(route.handler);
        assert.equal(result.status, 200);
        assert.equal(result.body.suggestions.length, 3);
        assert.equal(route.logs.length, 2, 'Each rejected and accepted response must be prompt-logged.');
        assert.match(route.logs[0].sections[0].content, /rejected/);
        assert.match(route.logs[1].sections[0].content, /accepted/);
    }
});

test('action suggestions route returns 409 without invoking completion while a game is absent or loading', async () => {
    for (const options of [{ gameLoaded: false }, { gameLoaded: true, loading: true }]) {
        const route = loadActionSuggestionsRoute(options);
        const result = await invokeRoute(route.handler);
        assert.equal(result.status, 409);
        assert.match(result.body.error, /game load|Load or start a game/i);
        assert.equal(route.logs.length, 0);
    }
});

test('action suggestions route returns the retry failure and stack after malformed responses exhaust attempts', async () => {
    const route = loadActionSuggestionsRoute({
        responses: [
            '<actionSuggestions><action>Only one.</action></actionSuggestions>',
            '<actionSuggestions><action>Still only one.</action></actionSuggestions>'
        ]
    });
    const result = await invokeRoute(route.handler);
    assert.equal(result.status, 500);
    assert.match(result.body.error, /exactly three direct <action>/);
    assert.equal(typeof result.body.stack, 'string');
    assert.ok(result.body.stack.length > 0);
    assert.equal(route.logs.length, 2);
});
