const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(repoRoot, 'public', 'js', 'chat.js'), 'utf8');
const apiSource = fs.readFileSync(path.join(repoRoot, 'api.js'), 'utf8');

function extractClassMethod(source, methodName) {
    const candidates = [
        `    ${methodName}(`,
        `    async ${methodName}(`
    ];
    const start = candidates
        .map(candidate => source.indexOf(candidate))
        .find(index => index >= 0);
    assert.notEqual(start, undefined, `${methodName} should exist`);

    const paramsStart = source.indexOf('(', start);
    assert.notEqual(paramsStart, -1, `${methodName} should have parameters`);
    let parenDepth = 0;
    let paramsEnd = -1;
    for (let index = paramsStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '(') {
            parenDepth += 1;
        } else if (char === ')') {
            parenDepth -= 1;
            if (parenDepth === 0) {
                paramsEnd = index;
                break;
            }
        }
    }
    assert.notEqual(paramsEnd, -1, `${methodName} should close parameters`);

    const bodyStart = source.indexOf('{', paramsEnd);
    assert.notEqual(bodyStart, -1, `${methodName} should have a body`);
    let braceDepth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') {
            braceDepth += 1;
        } else if (char === '}') {
            braceDepth -= 1;
            if (braceDepth === 0) {
                return source.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Unable to extract ${methodName}`);
}

function loadChatRequestHistoryHarness() {
    const methodSources = [
        extractClassMethod(chatSource, 'isModelBoundChatRequestMessage'),
        extractClassMethod(chatSource, 'buildModelBoundChatHistory')
    ];
    const context = {};
    vm.createContext(context);
    vm.runInContext(`
class Harness {
${methodSources.join('\n')}
}
this.Harness = Harness;
`, context);
    return new context.Harness();
}

test('chat request history excludes metadata-only attachment rows before fetch', () => {
    const harness = loadChatRequestHistoryHarness();
    harness.chatHistory = [
        {
            role: 'system',
            content: 'System prompt.'
        },
        {
            role: 'assistant',
            type: 'player-action',
            content: 'Visible prose.'
        },
        {
            role: 'assistant',
            type: 'slop-remover',
            slopRemoval: {
                slopWords: ['glimmering'],
                slopRegexes: [],
                slopNgrams: []
            }
        },
        {
            role: 'assistant',
            type: 'attack-check',
            attackCheck: {
                target: 'Bandit'
            }
        },
        {
            role: 'user',
            content: 'Next action.'
        }
    ];

    const requestHistory = harness.buildModelBoundChatHistory();

    assert.deepEqual(
        requestHistory.map(entry => entry.type || entry.role),
        ['system', 'player-action', 'user']
    );
    assert.equal(
        harness.isModelBoundChatRequestMessage({
            role: 'assistant',
            type: 'slop-remover',
            slopRemoval: { slopWords: ['glimmering'] }
        }),
        false
    );
});

test('successful-turn validation returns only complete ordinary turns and preserves failure details', () => {
    const method = extractClassMethod(chatSource, 'requireSuccessfulTurnResult');
    const context = {};
    vm.createContext(context);
    vm.runInContext(`class Harness { ${method} } this.Harness = Harness;`, context);
    const harness = new context.Harness();
    const success = { response: 'The gate opens.' };
    assert.equal(harness.requireSuccessfulTurnResult(success), success);

    const failures = [
        { payload: null, message: 'completed narrative response', code: 'TURN_NOT_COMPLETED' },
        { payload: { error: 'request failed', code: 'MODEL_ERROR' }, message: 'request failed', code: 'MODEL_ERROR' },
        { payload: { response: 'Partial.', postProcessingErrors: [{ message: 'maintenance failed', stack: 'maintenance stack' }] }, message: 'maintenance failed', code: 'TURN_NOT_COMPLETED' },
        { payload: { response: 'Partial.', questCompletionErrors: [{ message: 'quest reward failed' }] }, message: 'quest reward failed', code: 'TURN_NOT_COMPLETED' },
        { payload: { response: 'Partial.', eventsSkipped: true }, message: 'review before automatic actions', code: 'TURN_RECOVERY_REQUIRED' },
        { payload: { response: '   ' }, message: 'completed narrative response', code: 'TURN_NOT_COMPLETED' }
    ];
    for (const { payload, message, code } of failures) {
        assert.throws(() => harness.requireSuccessfulTurnResult(payload), error => {
            assert.equal(error.code, code);
            assert.match(error.message, new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
            if (payload) assert.equal(error.turnPayload, payload);
            return true;
        });
    }
});

test('automated message dispatch forwards mod ownership and strict-success requirements to submission', async () => {
    const method = extractClassMethod(chatSource, 'dispatchAutomatedMessage');
    const context = {};
    vm.createContext(context);
    vm.runInContext(`class Harness { ${method} } this.Harness = Harness;`, context);
    const harness = new context.Harness();
    let call;
    harness.submitChatMessage = async (message, options) => {
        call = { message, options };
        return { response: 'Resolved.' };
    };
    const modRequest = { modName: 'story-authoring', runId: 'run-1', decisionId: 'decision-1' };
    const result = await harness.dispatchAutomatedMessage('Walk through the gate.', {
        modRequest, requireSuccessfulTurn: true
    });

    assert.deepEqual(JSON.parse(JSON.stringify(call)), {
        message: 'Walk through the gate.',
        options: {
            setButtonLoading: false, travel: false, travelMetadata: null,
            suppressTravelCompletionSound: false, allowEmptyAction: false,
            modRequest, requireSuccessfulTurn: true
        }
    });
    assert.deepEqual(result, { response: 'Resolved.' });
});

test('registered async player-input handlers can claim narrative input, defer to manual UI, and become stale on closure', async () => {
    const methods = [
        extractClassMethod(chatSource, 'normalizePlayerInputRequest'),
        extractClassMethod(chatSource, 'registerPlayerInputRequestHandler'),
        extractClassMethod(chatSource, 'handlePlayerInputRequest'),
        extractClassMethod(chatSource, 'handlePlayerInputRequestClosed')
    ];
    const context = {};
    vm.createContext(context);
    vm.runInContext(`class Harness { ${methods.join('\n')} } this.Harness = Harness;`, context);
    const harness = new context.Harness();
    harness.playerInputRequestHandlers = new Set();
    harness.playerInputRequests = new Map();
    harness.playerInputRequestQueue = [];
    harness.shownRequests = [];
    harness.showPlayerInputRequest = request => harness.shownRequests.push(request);
    harness.hidePlayerInputRequestPanel = () => {};
    harness.showNextPlayerInputRequest = () => {};
    const claimedRequest = { inputRequestId: 'claimed', question: 'Who are you?', mode: 'text' };
    let claimedPayload;
    const unsubscribe = harness.registerPlayerInputRequestHandler(async payload => {
        claimedPayload = payload;
        await Promise.resolve();
        return true;
    });
    await harness.handlePlayerInputRequest(claimedRequest);
    assert.equal(claimedPayload, claimedRequest);
    assert.equal(harness.shownRequests.length, 0);
    assert.equal(unsubscribe(), true);

    const manualRequest = { inputRequestId: 'manual', question: 'What should happen?', mode: 'text' };
    harness.registerPlayerInputRequestHandler(async () => false);
    await harness.handlePlayerInputRequest(manualRequest);
    assert.equal(harness.playerInputRequests.has('manual'), true);
    assert.equal(harness.shownRequests[0].question, 'What should happen?');

    let releaseHandler;
    let handlerStarted;
    const started = new Promise(resolve => { handlerStarted = resolve; });
    const pending = new Promise(resolve => { releaseHandler = resolve; });
    harness.registerPlayerInputRequestHandler(async () => {
        handlerStarted();
        return pending;
    });
    const staleRequest = { inputRequestId: 'closed-before-decision', question: 'Continue?', mode: 'text' };
    const shownBefore = harness.shownRequests.length;
    const handling = harness.handlePlayerInputRequest(staleRequest);
    await started;
    harness.handlePlayerInputRequestClosed({ inputRequestId: staleRequest.inputRequestId });
    releaseHandler(false);
    await handling;
    assert.equal(harness.shownRequests.length, shownBefore);
    assert.equal(harness.pendingPlayerInputHandlerRequests.has(staleRequest.inputRequestId), false);
});

test('submitChatMessage builds request payload from model-bound history only', () => {
    const submitSource = extractClassMethod(chatSource, 'submitChatMessage');

    assert.match(
        submitSource,
        /this\.buildModelBoundChatHistory\(\)/,
        'submitChatMessage should filter chat history before adding the raw user message'
    );
});

test('optimistic user entry id matches the server-persisted user entry id', () => {
    const submitSource = extractClassMethod(chatSource, 'submitChatMessage');
    const requestIdIndex = submitSource.indexOf('const requestId = this.generateRequestId();');
    const optimisticEntryIndex = submitSource.indexOf('const userEntry = this.normalizeLocalEntry({');

    assert.notEqual(requestIdIndex, -1, 'submitChatMessage should generate a request id');
    assert.notEqual(optimisticEntryIndex, -1, 'submitChatMessage should create an optimistic user entry');
    assert.ok(
        requestIdIndex < optimisticEntryIndex,
        'submitChatMessage should generate the request id before creating the optimistic user entry'
    );
    assert.match(
        submitSource,
        /const userEntry = this\.normalizeLocalEntry\(\{\s*id:\s*requestId,/,
        'the optimistic user entry should use the request id as its chat entry id'
    );

    assert.match(
        apiSource,
        /const entryPayload = \{\s*id:\s*stream\.requestId\s*\|\|\s*undefined,\s*role:\s*'user',/,
        'the server-persisted user entry should use the same request id when available'
    );
});

test('player prompt template errors abort instead of falling back to raw client messages', () => {
    assert.doesNotMatch(
        apiSource,
        /Fall back to original messages if template fails/,
        'template render errors must not fall back to raw client messages'
    );
    assert.match(
        apiSource,
        /return\s+respond\(\s*\{\s*error:\s*message\s*\}\s*,\s*500\s*\)/,
        'template render errors should return a local server error'
    );
});
