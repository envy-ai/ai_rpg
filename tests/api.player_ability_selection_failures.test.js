const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

function captureRouteHandler(method, routePath, dependencies = {}) {
    const start = apiSource.indexOf(`app.${method}('${routePath}'`);
    assert.notEqual(start, -1, `Unable to locate ${method.toUpperCase()} ${routePath}.`);
    const nextRoute = /\n\s*app\.(?:get|post|put|delete|patch)\('/g;
    nextRoute.lastIndex = start + 1;
    const nextMatch = nextRoute.exec(apiSource);
    const snippet = apiSource.slice(start, nextMatch ? nextMatch.index : apiSource.length);
    let handler = null;
    const app = {
        [method]: (registeredPath, callback) => {
            assert.equal(registeredPath, routePath);
            handler = callback;
        }
    };
    const scope = {
        app,
        withGameplayRequestSettlement: callback => callback,
        ...dependencies
    };
    new Function(...Object.keys(scope), snippet)(...Object.values(scope));
    assert.equal(typeof handler, 'function', `Route handler for ${routePath} was not registered.`);
    return handler;
}

function responseRecorder() {
    return {
        statusCode: 200,
        payload: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    };
}

function getPendingIntroSaveBlock() {
    const performSave = apiSource.indexOf('async function performGameSave(');
    const start = apiSource.indexOf('const runtimeMetadata = (typeof Globals.getSaveMetadata', performSave);
    const end = apiSource.indexOf('metadata.npcAliasesGenerated = normalizeNpcAliasesGeneratedFlag(', start);
    assert.ok(performSave !== -1 && start !== -1 && end !== -1, 'Unable to locate pending intro save metadata block.');
    return apiSource.slice(start, end);
}

function getPendingIntroNormalizer() {
    const start = apiSource.indexOf('const normalizePendingGameIntroMetadata = (value) => {');
    const end = apiSource.indexOf('\n\n        const getPendingGameIntroMetadata', start);
    assert.ok(start !== -1 && end !== -1, 'Unable to locate pending intro metadata normalizer.');
    const declaration = apiSource.slice(start, end);
    return new Function(`${declaration}; return normalizePendingGameIntroMetadata;`)();
}

function getCommittedIntroAutosaveBlock() {
    const introStart = apiSource.indexOf('async function runGameIntroPrompt(');
    const start = apiSource.indexOf('const storedEntry = pushChatEntry(entry, entryCollector, resolvedLocationId);', introStart);
    const autosaveEnd = apiSource.indexOf('await runAutosaveIfEnabled();', start);
    assert.ok(introStart !== -1 && start !== -1 && autosaveEnd !== -1, 'Unable to locate committed intro/autosave block.');
    return apiSource.slice(start, autosaveEnd + 'await runAutosaveIfEnabled();'.length);
}

test('ability submit rejects an unloaded-game stale selection before calling the mutation helper', async () => {
    let applyCalls = 0;
    const handler = captureRouteHandler('post', '/api/player/ability-selection/submit', {
        Globals: { gameLoaded: false },
        currentPlayer: { isNPC: false },
        applyPlayerAbilitySelection: async () => { applyCalls += 1; }
    });
    const res = responseRecorder();

    await handler({ body: { level: 1, selectedAbilityNames: ['Old draft'] } }, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.code, 'GAME_NOT_LOADED');
    assert.match(res.payload.error, /load your saved game/i);
    assert.equal(typeof res.payload.stack, 'string');
    assert.equal(applyCalls, 0);
});

test('ability-selection GET and POST errors preserve code, stack, and the original prompt-failure envelope', async () => {
    const promptFailure = { id: 'ability-options-failure', metadataLabel: 'player_ability_options' };
    const cause = new Error('The ability options prompt failed.');
    cause.promptFailure = promptFailure;
    const failure = new Error('Ability selection could not be completed.', { cause });
    failure.code = 'ABILITY_SELECTION_FAILED';
    failure.stack = 'ABILITY_SELECTION_FAILED stack trace';
    const reporter = { getFailure: error => error?.cause?.promptFailure || error?.promptFailure || null };

    const getHandler = captureRouteHandler('get', '/api/player/ability-selection', {
        Globals: { gameLoaded: true },
        currentPlayer: { isNPC: false },
        resolvePlayerAbilitySelectionState: async () => { throw failure; },
        PromptFailureReporter: reporter
    });
    const getResponse = responseRecorder();
    await getHandler({ query: { generateOptions: '1' } }, getResponse);
    assert.equal(getResponse.statusCode, 500);
    assert.equal(getResponse.payload.code, failure.code);
    assert.equal(getResponse.payload.stack, failure.stack);
    assert.equal(getResponse.payload.promptFailure, promptFailure);

    const postHandler = captureRouteHandler('post', '/api/player/ability-selection/submit', {
        Globals: { gameLoaded: true },
        currentPlayer: { isNPC: false },
        applyPlayerAbilitySelection: async () => { throw failure; },
        PromptFailureReporter: reporter
    });
    const postResponse = responseRecorder();
    await postHandler({ body: { level: 1, selectedAbilityNames: ['A'] } }, postResponse);
    assert.equal(postResponse.statusCode, 400);
    assert.equal(postResponse.payload.code, failure.code);
    assert.equal(postResponse.payload.stack, failure.stack);
    assert.equal(postResponse.payload.promptFailure, promptFailure);
});

test('deferred game intro stays pending across the first two of three level picks and runs once after the final pick', async () => {
    const selectionResults = [
        { pending: true, selection: { level: 2 } },
        { pending: true, selection: { level: 3 } },
        { pending: false, levelsMissing: [] }
    ];
    const metadata = { source: 'new_game_ability_selection', locationId: 'entrance-1', draftToken: 'draft-token-1' };
    const introCalls = [];
    const clearedMetadata = [];
    let applyIndex = 0;
    let draftCompletionCalls = 0;
    const player = { id: 'player-1', isNPC: false };
    const handler = captureRouteHandler('post', '/api/player/ability-selection/submit', {
        Globals: { gameLoaded: true },
        currentPlayer: player,
        applyPlayerAbilitySelection: async () => selectionResults[applyIndex++],
        getPendingGameIntroMetadata: () => metadata,
        setPendingGameIntroMetadata: value => clearedMetadata.push(value),
        gameLocations: new Map([['entrance-1', { id: 'entrance-1' }]]),
        Location: { get: () => null },
        runGameIntroPrompt: async options => { introCalls.push(options); },
        modExtensionRegistry: { getNewGameDraftProvider: () => ({ complete: async () => { draftCompletionCalls += 1; } }) },
        serializeNpcForClient: value => ({ id: value.id })
    });

    const responses = [];
    for (const level of [1, 2, 3]) {
        const res = responseRecorder();
        await handler({ body: { level, selectedAbilityNames: [`Level ${level} option`] } }, res);
        assert.equal(res.statusCode, 200);
        responses.push(res.payload);
    }

    assert.equal(responses[0].pending, true);
    assert.equal(responses[0].gameIntroGenerated, false);
    assert.equal(responses[1].pending, true);
    assert.equal(responses[1].gameIntroGenerated, false);
    assert.equal(responses[2].pending, false);
    assert.equal(responses[2].gameIntroGenerated, true);
    assert.equal(introCalls.length, 1);
    assert.equal(introCalls[0].locationId, 'entrance-1');
    assert.deepEqual(clearedMetadata, [null]);
    assert.equal(draftCompletionCalls, 1);
});

test('save metadata round-trips explicit deferred intro identity alongside ordinary chat history metadata', () => {
    const normalize = getPendingIntroNormalizer();
    const saveBlock = getPendingIntroSaveBlock();
    const pendingGameIntro = {
        source: 'new_game_ability_selection',
        locationId: 'entrance-2',
        draftToken: 'story-authoring:deferred-intro-2'
    };
    const metadata = { chatHistoryLength: 2, pendingGameIntro: { locationId: 'stale-old-value' } };
    const serialized = { chatHistory: [{ type: 'check-results' }, { type: 'save-notice' }] };
    const globals = { getSaveMetadata: () => ({ pendingGameIntro }) };

    new Function('Globals', 'metadata', 'normalizePendingGameIntroMetadata', saveBlock)(globals, metadata, normalize);

    assert.equal(metadata.chatHistoryLength, 2);
    assert.deepEqual(metadata.pendingGameIntro, pendingGameIntro);
    serialized.metadata = metadata;
    const diskSnapshot = JSON.parse(JSON.stringify(serialized));
    assert.deepEqual(diskSnapshot.metadata.pendingGameIntro, pendingGameIntro);

    const clearedMetadata = { pendingGameIntro };
    new Function('Globals', 'metadata', 'normalizePendingGameIntroMetadata', saveBlock)(
        { getSaveMetadata: () => ({}) }, clearedMetadata, normalize
    );
    assert.equal(Object.hasOwn(clearedMetadata, 'pendingGameIntro'), false);
});

test('committing the deferred intro clears its matching pending marker before autosave', async () => {
    let pendingMetadata = { source: 'new_game_ability_selection', locationId: 'entrance-3', draftToken: 'draft-3' };
    let entryCount = 0;
    const autosaveSnapshots = [];
    const block = getCommittedIntroAutosaveBlock();
    const commitIntro = new Function(
        'pushChatEntry', 'entry', 'entryCollector', 'resolvedLocationId',
        'getPendingGameIntroMetadata', 'setPendingGameIntroMetadata', 'runAutosaveIfEnabled',
        'slopRemovalInfo', 'recordSlopRemovalEntry', 'notifyVisibleProseEntryStored', 'stream', 'clientId', 'requestId',
        `return async function commitIntro() { ${block}; return storedEntry; };`
    )(
        (value) => { entryCount += 1; return { ...value, id: `intro-${entryCount}` }; },
        { role: 'assistant', type: 'game-intro', locationId: 'entrance-3', content: 'Opening scene.' },
        null,
        'entrance-3',
        () => pendingMetadata,
        value => { pendingMetadata = value; },
        async () => { autosaveSnapshots.push(pendingMetadata); },
        null,
        () => {},
        () => {},
        null,
        null,
        null
    );
    await commitIntro();

    assert.equal(entryCount, 1);
    assert.deepEqual(autosaveSnapshots, [null]);
    assert.equal(pendingMetadata, null);
});

test('deferred intro failure is reported after the accepted final ability choice without undoing it', async () => {
    const promptFailure = { id: 'deferred-intro-failure', metadataLabel: 'game_intro' };
    const cause = new Error('The game intro prompt failed.');
    cause.promptFailure = promptFailure;
    const introError = new Error('Opening scene generation failed.', { cause });
    introError.code = 'GAME_INTRO_FAILED';
    introError.stack = 'Opening scene generation failed.\n    at runGameIntroPrompt (fixture.js:40:7)';
    let applyCalls = 0;
    let introCalls = 0;
    const cleared = [];
    const metadata = { source: 'new_game_ability_selection', locationId: 'entrance-4' };
    const handler = captureRouteHandler('post', '/api/player/ability-selection/submit', {
        Globals: { gameLoaded: true },
        currentPlayer: { id: 'player-4', isNPC: false },
        applyPlayerAbilitySelection: async () => { applyCalls += 1; return { pending: false, levelsMissing: [] }; },
        getPendingGameIntroMetadata: () => metadata,
        setPendingGameIntroMetadata: value => cleared.push(value),
        gameLocations: new Map([['entrance-4', { id: 'entrance-4' }]]),
        Location: { get: () => null },
        runGameIntroPrompt: async () => { introCalls += 1; throw introError; },
        PromptFailureReporter: { getFailure: error => error?.cause?.promptFailure || null },
        serializeNpcForClient: player => ({ id: player.id }),
        console: { warn() {} }
    });
    const res = responseRecorder();

    await handler({ body: { level: 3, selectedAbilityNames: ['Final choice'] } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(res.payload.pending, false);
    assert.equal(res.payload.gameIntroGenerated, false);
    assert.equal(res.payload.gameIntroError.message, introError.message);
    assert.equal(res.payload.gameIntroError.code, introError.code);
    assert.equal(res.payload.gameIntroError.stack, introError.stack);
    assert.equal(res.payload.gameIntroError.promptFailure, promptFailure);
    assert.equal(applyCalls, 1);
    assert.equal(introCalls, 1);
    assert.deepEqual(cleared, [null]);
});

test('reviewed deferred-intro or draft-provider failures retain the original error response contract', async () => {
    for (const failurePoint of ['intro', 'provider_complete']) {
        const promptFailure = { id: `reviewed-${failurePoint}-failure`, metadataLabel: 'game_intro' };
        const cause = new Error('Reviewed setup prompt failure.');
        cause.promptFailure = promptFailure;
        const failure = new Error(`Reviewed ${failurePoint} failed.`, { cause });
        failure.code = `REVIEWED_${failurePoint.toUpperCase()}_FAILED`;
        failure.stack = `${failure.message}\n    at reviewedSetup (fixture.js:50:9)`;
        const cleared = [];
        let applyCalls = 0;
        const handler = captureRouteHandler('post', '/api/player/ability-selection/submit', {
            Globals: { gameLoaded: true },
            currentPlayer: { id: 'reviewed-player', isNPC: false },
            applyPlayerAbilitySelection: async () => { applyCalls += 1; return { pending: false, levelsMissing: [] }; },
            getPendingGameIntroMetadata: () => ({
                source: 'new_game_ability_selection',
                locationId: 'reviewed-entrance',
                draftToken: 'reviewed-draft-token'
            }),
            setPendingGameIntroMetadata: value => cleared.push(value),
            gameLocations: new Map([['reviewed-entrance', { id: 'reviewed-entrance' }]]),
            Location: { get: () => null },
            runGameIntroPrompt: async () => {
                if (failurePoint === 'intro') throw failure;
            },
            modExtensionRegistry: {
                getNewGameDraftProvider: () => ({ complete: async () => { throw failure; } })
            },
            PromptFailureReporter: { getFailure: error => error?.cause?.promptFailure || null },
            serializeNpcForClient: player => ({ id: player.id }),
            console: { warn() {} }
        });
        const res = responseRecorder();

        await handler({ body: { level: 3, selectedAbilityNames: ['Final reviewed choice'] } }, res);

        assert.equal(res.statusCode, 400, `${failurePoint} must keep the reviewed error response`);
        assert.equal(res.payload.success, false);
        assert.equal(res.payload.code, failure.code);
        assert.equal(res.payload.stack, failure.stack);
        assert.equal(res.payload.promptFailure, promptFailure);
        assert.equal(Object.hasOwn(res.payload, 'gameIntroError'), false);
        assert.equal(applyCalls, 1);
        assert.deepEqual(cleared, failurePoint === 'intro' ? [] : [null]);
    }
});
