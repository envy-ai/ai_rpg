const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function makeTempRoot(prefix) {
    const tmpRoot = path.join(PROJECT_ROOT, 'tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    return fs.mkdtempSync(path.join(tmpRoot, prefix));
}

test('scenario validation rejects unknown fields and assertion types before execution', { concurrency: false }, async () => {
    const { validateScenarioDefinition } = await import('../scripts/lib/followup_api_playtest/scenario.mjs');
    assert.throws(
        () => validateScenarioDefinition({
            version: 1,
            scenario: 'synthetic',
            case: 'unknown-field',
            steps: [{ type: 'snapshot', name: 'one', surprise: true }]
        }),
        /Unknown scenario\.steps\[0\].*field "surprise"/
    );
    assert.throws(
        () => validateScenarioDefinition({
            version: 1,
            scenario: 'synthetic',
            case: 'unknown-assertion',
            steps: [{ type: 'assert', assertions: [{ type: 'proseContains', value: 'forbidden' }] }]
        }),
        /Unknown assertion type "proseContains"/
    );
    assert.throws(
        () => validateScenarioDefinition({
            version: 1,
            scenario: 'synthetic',
            case: 'missing-chat-policy',
            steps: [{ type: 'chat', text: 'Wait.' }]
        }),
        /interactive is required.*roll, questAccepted, and confirmed/i
    );
    assert.throws(
        () => validateScenarioDefinition({
            version: 1,
            scenario: 'synthetic',
            case: 'partial-request-policy',
            steps: [{
                type: 'request',
                method: 'POST',
                route: '/api/example',
                interactive: { roll: null, questAccepted: false }
            }]
        }),
        /interactive\.confirmed is required/i
    );
    assert.throws(
        () => validateScenarioDefinition({
            version: 1,
            scenario: 'synthetic',
            case: 'early-cassette-consumption',
            steps: [{ type: 'assert', assertions: [{ type: 'cassetteConsumed' }] }]
        }),
        /cassetteConsumed may only be used in scenario\.assertions/
    );
    assert.throws(
        () => validateScenarioDefinition({
            version: 1,
            scenario: 'synthetic',
            case: 'duplicate-step-name',
            steps: [
                { type: 'snapshot', name: 'same' },
                { type: 'request', name: 'same', method: 'GET', route: '/api/example' }
            ]
        }),
        /Duplicate scenario step name "same"/
    );
});

test('mechanical assertions compare exact selected state without prose inspection', { concurrency: false }, async () => {
    const { evaluateAssertions } = await import('../scripts/lib/followup_api_playtest/assertions.mjs');
    const context = {
        before: {
            calendar: { payload: { totalMinutes: 40 } },
            player: { payload: { player: { currentLocation: 'loc_1' } } },
            history: { payload: { history: [{ id: 'old', type: 'player-action' }] } }
        },
        after: {
            calendar: { payload: { totalMinutes: 47 } },
            player: { payload: { player: { currentLocation: 'loc_1' } } },
            history: {
                payload: {
                    history: [
                        { id: 'old', type: 'player-action' },
                        { id: 'new-user', type: 'user' }
                    ]
                }
            }
        },
        response: { status: 409, ok: false },
        realtime: [],
        changedLogs: [],
        cassetteStatus: { replay: { active: true, version: 2, allConsumed: true, total: 3 } }
    };
    const results = evaluateAssertions([
        { type: 'httpStatus', equals: 409 },
        { type: 'exactDelta', path: 'calendar.payload.totalMinutes', delta: 7 },
        { type: 'stateUnchanged', paths: ['player.payload.player.currentLocation'] },
        { type: 'noRealtimeErrors' },
        { type: 'noUnexpectedErrorLogs' },
        { type: 'historyAddedTypeCount', entryType: 'player-action', equals: 0 },
        {
            type: 'historyAddedNestedObjectCount',
            entryWhere: { type: 'event-summary' },
            path: 'summaryItems',
            where: {
                sourceType: 'need_bar_change',
                metadata: {
                    needBarChange: {
                        actorId: 'char_1',
                        needBarId: 'stamina',
                        delta: -100
                    }
                }
            },
            equals: 1
        },
        {
            type: 'entityArrayObjectCount',
            collection: 'players',
            id: 'char_1',
            path: 'abilities',
            where: { name: 'Shield Bash', type: 'Active' },
            equals: 1
        },
        {
            type: 'arrayObjectCount',
            source: 'response',
            path: 'payload.toolInvocations',
            where: {
                name: 'resolveAttack',
                metadata: {
                    attacker: 'Shieldhand',
                    summary: {
                        hit: true
                    }
                }
            },
            equals: 1
        },
        {
            type: 'entityField',
            collection: 'players',
            id: 'char_1',
            path: 'health',
            equalsFrom: {
                source: 'response',
                path: 'payload.expectedHealth'
            }
        },
        { type: 'cassetteConsumed' }
    ], {
        ...context,
        response: {
            ...context.response,
            payload: {
                expectedHealth: 9,
                toolInvocations: [{
                    name: 'resolveAttack',
                    metadata: {
                        attacker: 'Shieldhand',
                        defender: 'Ash Beetle',
                        summary: { hit: true, roll: { die: 12 } }
                    }
                }]
            }
        },
        after: {
            ...context.after,
            history: {
                payload: {
                    history: [
                        { id: 'old', type: 'player-action' },
                        { id: 'new-user', type: 'user' },
                        {
                            id: 'new-summary',
                            type: 'event-summary',
                            summaryItems: [{
                                sourceType: 'need_bar_change',
                                metadata: {
                                    needBarChange: {
                                        actorId: 'char_1',
                                        needBarId: 'stamina',
                                        delta: -100,
                                        reason: 'Structured fixture reason.'
                                    }
                                }
                            }]
                        }
                    ]
                }
            },
            players: {
                payload: {
                    players: [{
                        id: 'char_1',
                        health: 9,
                        abilities: [{ name: 'Shield Bash', type: 'Active', description: 'Test.' }]
                    }]
                }
            }
        }
    });
    assert.equal(results.every(entry => entry.passed), true);

    const recoveredRetry = evaluateAssertions([{
        type: 'noUnexpectedErrorLogs',
        allowedPrefixes: ['ERROR_chatCompletionError_region_stub_locations_']
    }], {
        ...context,
        changedLogs: [{ name: 'ERROR_chatCompletionError_region_stub_locations_123.log' }]
    });
    assert.equal(recoveredRetry[0].passed, true);
    assert.equal(evaluateAssertions([{ type: 'noUnexpectedErrorLogs' }], {
        ...context,
        changedLogs: [{ name: 'ERROR_chatCompletionError_region_stub_locations_123.log' }]
    })[0].passed, false);
});

test('state capture includes live region summaries', { concurrency: false }, async () => {
    const { FollowupApiClient } = await import('../scripts/lib/followup_api_playtest/core.mjs');
    const client = new FollowupApiClient({ baseUrl: 'http://127.0.0.1:1' });
    const requestedRoutes = [];
    client.fetchJson = async (method, route) => {
        requestedRoutes.push(route);
        if (route === '/api/player') {
            return { status: 200, ok: true, payload: { player: { id: 'char_1', locationId: 'loc_1' } } };
        }
        if (route === '/api/regions') {
            return { status: 200, ok: true, payload: { regions: [{ id: 'region_1' }] } };
        }
        return { status: 200, ok: true, payload: {} };
    };

    const state = await client.captureState();
    assert.deepEqual(state.regions.payload.regions, [{ id: 'region_1' }]);
    assert.equal(requestedRoutes.includes('/api/regions'), true);
});

test('attack result assertions normalize single-target and area-attack tool results', { concurrency: false }, async () => {
    const { evaluateAssertions } = await import('../scripts/lib/followup_api_playtest/assertions.mjs');
    const toolInvocations = [
        {
            name: 'resolveAreaAttack',
            metadata: {
                attacker: 'QA Shieldhand',
                summary: { sharedRoll: { die: 12 } },
                results: [{
                    target: 'QA Ash Beetle',
                    targetId: 'char_34',
                    hit: true,
                    damageApplied: 26,
                    application: {
                        targetId: 'char_34',
                        targetName: 'QA Ash Beetle',
                        damageApplied: 26,
                        startingHealth: 35,
                        endingHealth: 9
                    },
                    attackSummary: {
                        hit: true,
                        attacker: { name: 'QA Shieldhand' },
                        defender: { name: 'QA Ash Beetle' },
                        roll: { die: 12 },
                        damage: { effectiveness: 4, multiplier: 2 }
                    }
                }]
            }
        },
        {
            name: 'resolveAttack',
            metadata: {
                attacker: 'QA Ash Beetle',
                defender: 'player',
                application: {
                    targetId: 'char_2',
                    targetName: 'Baato',
                    damageApplied: 4,
                    startingHealth: 39,
                    endingHealth: 35
                },
                summary: {
                    hit: true,
                    attacker: { name: 'QA Ash Beetle' },
                    defender: { name: 'Baato' },
                    roll: { die: 12 },
                    damage: { effectiveness: 2, multiplier: 0.5 }
                }
            }
        }
    ];
    const context = {
        response: { payload: { toolInvocations } },
        before: {
            players: {
                payload: {
                    players: [
                        { id: 'char_2', health: 39 },
                        { id: 'char_34', health: 35 }
                    ]
                }
            }
        },
        after: {
            players: {
                payload: {
                    players: [
                        { id: 'char_2', health: 35 },
                        { id: 'char_34', health: 9 }
                    ]
                }
            }
        }
    };
    const assertions = [
        {
            type: 'attackResultCount',
            source: 'response',
            path: 'payload.toolInvocations',
            where: {},
            equals: 2
        },
        {
            type: 'attackResultCount',
            source: 'response',
            path: 'payload.toolInvocations',
            where: { attacker: 'QA Shieldhand', targetId: 'char_34', hit: true, die: 12 },
            equals: 1
        },
        {
            type: 'attackResultCount',
            source: 'response',
            path: 'payload.toolInvocations',
            where: { attacker: 'QA Ash Beetle', targetId: 'char_2', hit: true, die: 12 },
            equals: 1
        },
        {
            type: 'attackResultApplied',
            source: 'response',
            path: 'payload.toolInvocations',
            where: { attacker: 'QA Shieldhand', targetId: 'char_34' },
            expectHealthLoss: true
        },
        {
            type: 'attackResultApplied',
            source: 'response',
            path: 'payload.toolInvocations',
            where: { attacker: 'QA Ash Beetle', targetId: 'char_2' },
            expectHealthLoss: true
        },
        {
            type: 'attackResultCompare',
            source: 'response',
            path: 'payload.toolInvocations',
            leftWhere: { attacker: 'QA Shieldhand', targetId: 'char_34' },
            rightWhere: { attacker: 'QA Ash Beetle', targetId: 'char_2' },
            field: 'damageEffectiveness',
            operator: 'greaterThan'
        },
        {
            type: 'attackResultCompare',
            source: 'response',
            path: 'payload.toolInvocations',
            leftWhere: { attacker: 'QA Shieldhand', targetId: 'char_34' },
            rightWhere: { attacker: 'QA Ash Beetle', targetId: 'char_2' },
            field: 'damageApplied',
            operator: 'notEquals'
        }
    ];
    assert.equal(evaluateAssertions(assertions, context).every(entry => entry.passed), true);

    const mismatchedState = structuredClone(context);
    mismatchedState.after.players.payload.players[1].health = 10;
    assert.equal(evaluateAssertions([assertions[3]], mismatchedState)[0].passed, false);
});

test('single-target miss normalization retains the canonical defender id from its summary', { concurrency: false }, async () => {
    const { evaluateAssertions } = await import('../scripts/lib/followup_api_playtest/assertions.mjs');
    const context = {
        response: {
            payload: {
                toolInvocations: [{
                    name: 'resolveAttack',
                    metadata: {
                        attacker: 'QA Veiled Scout',
                        defender: 'Baato',
                        hit: false,
                        summary: {
                            hit: false,
                            attacker: { name: 'QA Veiled Scout' },
                            defender: { id: 'char_2', name: 'Baato' },
                            roll: { die: 1 },
                            target: { startingHealth: 39, remainingHealth: 39 }
                        }
                    }
                }]
            }
        }
    };
    const [result] = evaluateAssertions([{
        type: 'attackResultCount',
        source: 'response',
        path: 'payload.toolInvocations',
        where: {
            attacker: 'QA Veiled Scout',
            targetId: 'char_2',
            targetName: 'Baato',
            hit: false,
            die: 1
        },
        equals: 1
    }], context);

    assert.equal(result.passed, true);
});

test('state-only declarative scenario uses one realtime connection and writes focused triage', { concurrency: false }, async () => {
    const { runScenario } = await import('../scripts/lib/followup_api_playtest/scenario.mjs');
    const root = makeTempRoot('followup-scenario-');
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    let totalMinutes = 100;
    let connections = 0;
    const apiClient = {
        async fetchJson(method, route) {
            if (route === '/mutate') {
                totalMinutes += 1;
                return { method, route, status: 409, ok: false, durationMs: 1, payload: { error: 'Expected test rejection.' } };
            }
            if (route === '/api/llm-completion-cassette/status') {
                return {
                    method,
                    route,
                    status: 200,
                    ok: true,
                    durationMs: 1,
                    payload: {
                        success: true,
                        replay: { active: false, version: null },
                        recording: { active: false, version: null }
                    }
                };
            }
            throw new Error(`Unexpected synthetic route ${method} ${route}.`);
        },
        async captureState() {
            return {
                player: { payload: { player: { id: 'char_1', locationId: 'loc_1' } } },
                players: { payload: { players: [{ id: 'char_1', currentLocation: 'loc_1' }] } },
                locations: { payload: { locations: [{ id: 'loc_1' }] } },
                things: { payload: { things: [] } },
                history: { payload: { history: [] } },
                calendar: { payload: { totalMinutes } }
            };
        }
    };
    const realtimeSession = {
        clientId: 'synthetic-client',
        events: [],
        async connect() { connections += 1; },
        async close() {}
    };
    try {
        const output = await runScenario({
            root,
            mode: 'state-only',
            apiClient,
            realtimeSession,
            definition: {
                version: 1,
                scenario: 'synthetic',
                case: 'state-delta',
                trackedPaths: ['calendar.payload.totalMinutes'],
                steps: [
                    { type: 'request', method: 'GET', route: '/mutate' },
                    {
                        type: 'assert',
                        assertions: [
                            { type: 'httpStatus', equals: 409 },
                            { type: 'exactDelta', path: 'calendar.payload.totalMinutes', delta: 1 },
                            { type: 'noRealtimeErrors' }
                        ]
                    }
                ],
                assertions: [{ type: 'responseOk', equals: false }],
                humanReview: ['Confirm no narrative review is needed for this state-only probe.']
            }
        });
        assert.equal(output.result.ok, true);
        assert.equal(output.result.status, 200);
        assert.equal(output.response.ok, false);
        assert.equal(output.triage.assertions.failed.length, 0);
        assert.equal(output.triage.selectedStateChanges.length, 1);
        assert.equal(connections, 1);
        assert.equal(fs.existsSync(path.join(output.attemptDir, 'triage.json')), true);
        const markdown = fs.readFileSync(path.join(output.attemptDir, 'triage.md'), 'utf8');
        assert.match(markdown, /4 passed, 0 failed/);
        assert.match(markdown, /Human review/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('named snapshots and responses drive later requests and structured comparisons', { concurrency: false }, async () => {
    const { runScenario } = await import('../scripts/lib/followup_api_playtest/scenario.mjs');
    const root = makeTempRoot('followup-named-state-');
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    let totalMinutes = 100;
    let health = 10;
    const apiClient = {
        async fetchJson(method, route, body) {
            if (route === '/api/llm-completion-cassette/status') {
                return {
                    method,
                    route,
                    status: 200,
                    ok: true,
                    payload: {
                        success: true,
                        replay: { active: false, version: null },
                        recording: { active: false, version: null }
                    }
                };
            }
            if (route === '/mutate/char_1') {
                totalMinutes += 4;
                health += 4;
                return {
                    method,
                    route,
                    status: 200,
                    ok: true,
                    payload: { result: { id: 'char_1', delta: 4 } }
                };
            }
            if (route === '/inspect/char_1') {
                assert.deepEqual(body, { baselineHealth: 10, appliedDelta: 4 });
                return { method, route, status: 200, ok: true, payload: { seen: 'char_1' } };
            }
            throw new Error(`Unexpected synthetic route ${method} ${route}.`);
        },
        async captureState() {
            return {
                player: { payload: { player: { id: 'char_1', health } } },
                players: { payload: { players: [{ id: 'char_1', health }] } },
                locations: { payload: { locations: [] } },
                things: { payload: { things: [] } },
                history: { payload: { history: [] } },
                calendar: { payload: { totalMinutes } }
            };
        }
    };
    const realtimeSession = {
        clientId: 'synthetic-client',
        events: [],
        async connect() {},
        async close() {}
    };
    try {
        const output = await runScenario({
            root,
            mode: 'state-only',
            apiClient,
            realtimeSession,
            definition: {
                version: 1,
                scenario: 'synthetic',
                case: 'named-state',
                steps: [
                    { type: 'snapshot', name: 'baseline' },
                    {
                        type: 'request',
                        name: 'mutation',
                        method: 'POST',
                        route: '/mutate/char_1'
                    },
                    {
                        type: 'request',
                        name: 'inspection',
                        method: 'POST',
                        route: '/inspect/$response.mutation.payload.result.id',
                        body: {
                            baselineHealth: '$snapshot.baseline.players.payload.players.0.health',
                            appliedDelta: '$response.mutation.payload.result.delta'
                        }
                    },
                    {
                        type: 'assert',
                        assertions: [
                            {
                                type: 'equals',
                                source: 'responses.inspection',
                                path: 'payload.seen',
                                equals: 'char_1'
                            },
                            {
                                type: 'exactDelta',
                                beforeSource: 'snapshots.baseline',
                                path: 'calendar.payload.totalMinutes',
                                delta: 4
                            },
                            {
                                type: 'greaterThan',
                                source: 'after',
                                path: 'players.payload.players.0.health',
                                valueFrom: {
                                    source: 'snapshots.baseline',
                                    path: 'players.payload.players.0.health'
                                }
                            },
                            {
                                type: 'arrayObjectCount',
                                source: 'after',
                                path: 'players.payload.players',
                                where: { id: 'char_1', health: 14 },
                                equals: 1
                            }
                        ]
                    }
                ]
            }
        });
        assert.equal(output.triage.assertions.failed.length, 0);
        assert.equal(fs.existsSync(path.join(output.attemptDir, 'snapshot-baseline.json')), true);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('cassette recording finalization waits for an active logical completion to end', { concurrency: false }, async () => {
    const { waitForCompletionCassetteRecordingIdle } = await import('../scripts/lib/followup_api_playtest/scenario.mjs');
    let statusReads = 0;
    const apiClient = {
        async fetchJson(method, route) {
            assert.equal(method, 'GET');
            assert.equal(route, '/api/llm-completion-cassette/status');
            statusReads += 1;
            return {
                status: 200,
                ok: true,
                payload: {
                    success: true,
                    replay: { active: false, version: null },
                    recording: {
                        active: true,
                        version: 2,
                        completionActive: statusReads < 3
                    }
                }
            };
        }
    };
    const status = await waitForCompletionCassetteRecordingIdle(apiClient, {
        timeoutMs: 100,
        pollIntervalMs: 1,
        quietPeriodMs: 0
    });
    assert.equal(statusReads, 3);
    assert.equal(status.recording.completionActive, false);

    await assert.rejects(
        () => waitForCompletionCassetteRecordingIdle({
            async fetchJson() {
                return {
                    status: 200,
                    ok: true,
                    payload: {
                        success: true,
                        replay: { active: false, version: null },
                        recording: { active: true, version: 2, completionActive: true }
                    }
                };
            }
        }, { timeoutMs: 0, pollIntervalMs: 1, quietPeriodMs: 0 }),
        /Timed out after 0ms/
    );
});

test('cassette replay finalization waits for background consumption and stable idle', { concurrency: false }, async () => {
    const { waitForCompletionCassetteReplayConsumed } = await import('../scripts/lib/followup_api_playtest/scenario.mjs');
    let statusReads = 0;
    const apiClient = {
        async fetchJson(method, route) {
            assert.equal(method, 'GET');
            assert.equal(route, '/api/llm-completion-cassette/status');
            statusReads += 1;
            return {
                status: 200,
                ok: true,
                payload: {
                    success: true,
                    replay: {
                        active: true,
                        version: 2,
                        total: 2,
                        consumed: statusReads < 3 ? 1 : 2,
                        remaining: statusReads < 3 ? 1 : 0,
                        allConsumed: statusReads >= 3,
                        completionActive: statusReads === 2
                    },
                    recording: { active: false, version: null }
                }
            };
        }
    };
    const status = await waitForCompletionCassetteReplayConsumed(apiClient, {
        timeoutMs: 100,
        pollIntervalMs: 1,
        quietPeriodMs: 2
    });
    assert.equal(statusReads >= 4, true);
    assert.equal(status.replay.allConsumed, true);
    assert.equal(status.replay.completionActive, false);

    await assert.rejects(
        () => waitForCompletionCassetteReplayConsumed({
            async fetchJson() {
                return {
                    status: 200,
                    ok: true,
                    payload: {
                        success: true,
                        replay: {
                            active: true,
                            version: 2,
                            total: 2,
                            consumed: 2,
                            remaining: 0,
                            allConsumed: true,
                            completionActive: false,
                            failureCount: 1,
                            lastFailure: { message: 'Synthetic caught mismatch.' }
                        },
                        recording: { active: false, version: null }
                    }
                };
            }
        }, { timeoutMs: 100, pollIntervalMs: 1, quietPeriodMs: 0 }),
        /Synthetic caught mismatch/
    );

    await assert.rejects(
        () => waitForCompletionCassetteReplayConsumed({
            async fetchJson() {
                return {
                    status: 200,
                    ok: true,
                    payload: {
                        success: true,
                        replay: {
                            active: true,
                            version: 2,
                            total: 2,
                            consumed: 1,
                            remaining: 1,
                            allConsumed: false,
                            completionActive: false
                        },
                        recording: { active: false, version: null }
                    }
                };
            }
        }, { timeoutMs: 0, pollIntervalMs: 1, quietPeriodMs: 0 }),
        /consumed=1, total=2/
    );
});

test('scenario fixture variables fail before realtime connection or API mutation', { concurrency: false }, async () => {
    const { runScenario } = await import('../scripts/lib/followup_api_playtest/scenario.mjs');
    const root = makeTempRoot('followup-variable-preflight-');
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
    let connections = 0;
    let mutations = 0;
    const apiClient = {
        async fetchJson(method, route) {
            if (route === '/api/llm-completion-cassette/status') {
                return {
                    method,
                    route,
                    status: 200,
                    ok: true,
                    payload: {
                        success: true,
                        replay: { active: false, version: null },
                        recording: { active: false, version: null }
                    }
                };
            }
            mutations += 1;
            throw new Error(`Unexpected mutation ${method} ${route}.`);
        }
    };
    const realtimeSession = {
        clientId: 'synthetic-client',
        events: [],
        async connect() { connections += 1; },
        async close() {}
    };
    try {
        await assert.rejects(
            () => runScenario({
                root,
                mode: 'state-only',
                apiClient,
                realtimeSession,
                definition: {
                    version: 1,
                    scenario: 'synthetic',
                    case: 'fixture-variable-preflight',
                    fixture: {
                        saveName: 'existing-save',
                        entities: { playerId: 'char_1' }
                    },
                    steps: [{
                        type: 'request',
                        method: 'POST',
                        route: '/api/npcs/$fixture.missingId'
                    }]
                }
            }),
            /Unresolved fixture variable \$fixture\.missingId/
        );
        assert.equal(connections, 0);
        assert.equal(mutations, 0);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('config profiles inherit into a deterministic temporary CLI override', { concurrency: false }, async () => {
    const {
        buildCassetteConfigValues,
        configProfileToObject,
        loadConfigProfile,
        writeConfigProfileOverride
    } = await import('../scripts/lib/followup_api_playtest/config_profiles.mjs');
    const profile = await loadConfigProfile(PROJECT_ROOT, 'vehicle-mechanics');
    assert.equal(profile.values['imagegen.enabled'], false);
    assert.equal(profile.values.stagger_concurrent_prompts, 1);
    assert.equal(profile.values['event_checks.enabled'], true);
    const nested = configProfileToObject(profile);
    assert.equal(nested.imagegen.enabled, false);
    assert.equal(nested.event_checks.enabled, true);
    const replayProfile = await loadConfigProfile(PROJECT_ROOT, 'vehicle-mechanics-replay');
    assert.equal(replayProfile.values['imagegen.enabled'], false);
    assert.equal(replayProfile.values['ai.local_startup_script_path'], '');
    assert.equal(replayProfile.values['ai.unload_during_image_generation'], false);
    assert.equal(replayProfile.values.router_preload_model, '');
    assert.equal(replayProfile.values.unload_model_on_switch, false);
    assert.deepEqual(
        buildCassetteConfigValues('live-record', 'tmp/cassettes/vehicle.json'),
        {
            'ai.record_outputs_file': 'tmp/cassettes/vehicle.json',
            'ai.force_outputs_file': ''
        }
    );
    assert.deepEqual(
        buildCassetteConfigValues('live-verify'),
        {
            'ai.record_outputs_file': '',
            'ai.force_outputs_file': ''
        }
    );
    assert.throws(
        () => buildCassetteConfigValues('replay'),
        /requires a cassette path/i
    );
    const filename = `tmp/profile-test-${Date.now()}.yaml`;
    const baseOverrideFilename = `tmp/profile-base-${Date.now()}.yaml`;
    fs.writeFileSync(
        path.join(PROJECT_ROOT, baseOverrideFilename),
        'ai:\n  model: test-router-model\nimagegen:\n  enabled: true\n',
        'utf8'
    );
    const output = await writeConfigProfileOverride(PROJECT_ROOT, profile, filename, {
        additionalValues: buildCassetteConfigValues('replay', 'tmp/cassettes/vehicle.json'),
        baseOverridePath: baseOverrideFilename
    });
    try {
        const yaml = fs.readFileSync(output, 'utf8');
        assert.match(yaml, /imagegen:\n  enabled: false/);
        assert.match(yaml, /event_checks:\n  enabled: true/);
        assert.match(yaml, /force_outputs_file: tmp\/cassettes\/vehicle\.json/);
        assert.match(yaml, /model: test-router-model/);
    } finally {
        fs.rmSync(output, { force: true });
        fs.rmSync(path.join(PROJECT_ROOT, baseOverrideFilename), { force: true });
    }
});

test('fixture promotion hashes an immutable save and prepares a disposable autosave copy', { concurrency: false }, async () => {
    const {
        loadFixtureManifest,
        prepareRuntimeFixture,
        promoteFixture,
        removeRuntimeFixture
    } = await import('../scripts/lib/followup_api_playtest/fixtures.mjs');
    const root = makeTempRoot('followup-fixture-');
    const sourceName = 'source-save';
    const source = path.join(root, 'saves', sourceName);
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'metadata.json'), JSON.stringify({
        saveName: sourceName,
        source: 'saves',
        currentSettingName: 'Test Setting',
        playerName: 'Tester'
    }), 'utf8');
    fs.writeFileSync(path.join(source, 'world.json'), '{"location":"loc_1"}\n', 'utf8');
    try {
        const promoted = await promoteFixture(root, {
            name: 'test-fixture',
            sourceSaveName: sourceName,
            manifestInput: {
                description: 'Synthetic fixture.',
                setupCommand: '@@ create it',
                configProfile: 'isolated-base',
                entities: { playerId: 'char_1', locationId: 'loc_1' },
                invariants: [{ type: 'entityField', collection: 'players', id: 'char_1' }],
                validation: { passed: true }
            }
        });
        assert.match(promoted.manifest.integrity, /^sha256:[a-f0-9]{64}$/);
        const loaded = await loadFixtureManifest(root, 'test-fixture');
        assert.equal(loaded.entities.locationId, 'loc_1');
        const runtime = await prepareRuntimeFixture(root, 'test-fixture');
        const runtimeMetadata = JSON.parse(fs.readFileSync(path.join(runtime.runtimeDirectory, 'metadata.json'), 'utf8'));
        assert.equal(runtimeMetadata.saveName, runtime.runtimeName);
        assert.equal(runtimeMetadata.source, 'autosaves');
        await removeRuntimeFixture(runtime);
        assert.equal(fs.existsSync(runtime.runtimeDirectory), false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
