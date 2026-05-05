const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

const CACHED_CHECK_TOOL_CALL_NOTE = 'You already made this tool call. Do not re-run tool calls for the same checks that you made in earlier drafts.';

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeRuntime({ firstResponse, resolveAttack, capturedMessagesByRound }) {
    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ id: 'player-1', name: 'Player', currentLocation: 'loc-1' }),
        createLocationFromEvent: async () => {
            throw new Error('createLocationFromEvent should not be reached.');
        },
        createRegionStubFromEvent: async () => {
            throw new Error('createRegionStubFromEvent should not be reached.');
        },
        generateItemsByNames: async () => [],
        ensureExitConnection: () => {
            throw new Error('ensureExitConnection should not be reached.');
        },
        findRegionByLocationId: () => null,
        resolveAttack,
        LLMClient: {
            chatCompletion: async (options) => {
                capturedMessagesByRound.push(structuredClone(options.messages));
                if (capturedMessagesByRound.length === 1) {
                    options.onResponse?.(firstResponse);
                    return '';
                }
                const finalResponse = {
                    data: {
                        choices: [{
                            message: {
                                content: 'Attack resolved.',
                                tool_calls: []
                            }
                        }]
                    }
                };
                options.onResponse?.(finalResponse);
                return 'Attack resolved.';
            },
            logPrompt: () => {},
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => [] },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
}

function resolveAttackToolResponse(args) {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: [{
                        id: 'call-resolve-attack',
                        type: 'function',
                        function: {
                            name: 'resolveAttack',
                            arguments: JSON.stringify(args)
                        }
                    }]
                }
            }]
        }
    };
}

function resolveAttackToolResponseWithCalls(calls) {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: calls.map((args, index) => ({
                        id: `call-resolve-attack-${index}`,
                        type: 'function',
                        function: {
                            name: 'resolveAttack',
                            arguments: JSON.stringify(args)
                        }
                    }))
                }
            }]
        }
    };
}

const attackArgs = {
    attacker: 'player',
    defender: 'Hollow Sentinel Valdrus',
    attackerInfo: {
        attackSkill: 'Melee Combat',
        damageAttribute: 'strength'
    },
    defenderInfo: {
        evadeSkill: 'Dodge',
        deflectSkill: 'Melee Combat'
    },
    ability: 'N/A',
    weapon: 'Worn Iron Longsword',
    circumstanceModifiers: {
        attackerCircumstanceModifier: [
            { amount: 2, reason: 'Good footing' }
        ],
        defenderCircumstanceModifier: [
            { amount: 3, reason: 'Prepared guard' }
        ]
    },
    damageEffectiveness: 3
};

test('resolveAttack tool schema mirrors attack-check attack fields', () => {
    const resolveAttack = findToolDefinition('resolveAttack');
    assert.ok(resolveAttack, 'resolveAttack tool definition should exist');
    assert.deepEqual(resolveAttack.parameters.required, [
        'attacker',
        'defender',
        'attackerInfo',
        'defenderInfo',
        'ability',
        'weapon',
        'circumstanceModifiers',
        'damageEffectiveness'
    ]);
    assert.deepEqual(resolveAttack.parameters.properties.attackerInfo.required, ['attackSkill', 'damageAttribute']);
    assert.deepEqual(resolveAttack.parameters.properties.defenderInfo.required, ['evadeSkill', 'deflectSkill']);
});

test('resolveAttack returns applied damage health percentages and preserves attack-check modifier semantics', async () => {
    const capturedMessagesByRound = [];
    let capturedAttackEntry = null;
    const attackSummary = {
        hit: true,
        attacker: { name: 'The player' },
        defender: { name: 'Hollow Sentinel Valdrus' },
        damage: { total: 9, applied: 7 },
        target: {
            startingHealth: 50,
            remainingHealth: 43,
            healthLostPercent: 14,
            remainingHealthPercent: 86
        }
    };
    const runtime = makeRuntime({
        firstResponse: resolveAttackToolResponse(attackArgs),
        capturedMessagesByRound,
        resolveAttack: async ({ attackEntry }) => {
            capturedAttackEntry = attackEntry;
            return {
                hit: true,
                declaredDamage: 9,
                damage: 7,
                application: {
                    targetId: 'npc-1',
                    targetName: 'Hollow Sentinel Valdrus',
                    damageDeclared: 9,
                    damageApplied: 7,
                    startingHealth: 50,
                    endingHealth: 43,
                    rawRemainingHealth: 43,
                    maxHealthBefore: 50,
                    maxHealthAfter: 50,
                    healthLostPercent: 14,
                    remainingHealthPercent: 86
                },
                locationRefreshRequested: true,
                summary: attackSummary
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Attack.' }] },
        metadataLabel: 'test_resolve_attack_tool'
    });

    assert.equal(result.rounds, 2);
    assert.equal(result.toolInvocations[0].name, 'resolveAttack');
    assert.equal(result.toolInvocations[0].metadata.damage, 7);
    assert.equal(result.toolInvocations[0].metadata.declaredDamage, 9);
    assert.equal(result.toolInvocations[0].metadata.locationRefreshRequested, true);
    assert.equal(result.toolInvocations[0].metadata.application.damageApplied, 7);
    assert.deepEqual(result.toolInvocations[0].metadata.summary, attackSummary);
    assert.equal(capturedAttackEntry.attacker, 'player');
    assert.equal(capturedAttackEntry.defender, 'Hollow Sentinel Valdrus');
    assert.deepEqual(capturedAttackEntry.circumstanceModifiers, [
        { amount: 2, reason: 'Good footing' },
        { amount: -3, reason: 'Prepared guard' }
    ]);

    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, 'Damage: 14%\nRemaining health: 86%');
});

test('resolveAttack marks zero remaining health as incapacitated or dead', async () => {
    const capturedMessagesByRound = [];
    const runtime = makeRuntime({
        firstResponse: resolveAttackToolResponse(attackArgs),
        capturedMessagesByRound,
        resolveAttack: async () => {
            return {
                hit: true,
                declaredDamage: 25,
                damage: 25,
                application: {
                    targetId: 'npc-1',
                    targetName: 'Hollow Sentinel Valdrus',
                    damageDeclared: 25,
                    damageApplied: 25,
                    startingHealth: 20,
                    endingHealth: 0,
                    rawRemainingHealth: -5,
                    maxHealthBefore: 100,
                    maxHealthAfter: 100,
                    healthLostPercent: 25,
                    remainingHealthPercent: 0
                },
                locationRefreshRequested: true,
                summary: {
                    hit: true,
                    attacker: { name: 'The player' },
                    defender: { name: 'Hollow Sentinel Valdrus' },
                    damage: { total: 25, applied: 25 },
                    target: {
                        startingHealth: 20,
                        remainingHealth: 0,
                        rawRemainingHealth: -5,
                        healthLostPercent: 25,
                        remainingHealthPercent: 0,
                        defeated: true
                    }
                }
            };
        }
    });

    await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Attack.' }] },
        metadataLabel: 'test_resolve_attack_defeated_tool'
    });

    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, 'Damage: 25%\nRemaining health: 0% (incapacitated or dead)');
});

test('resolveAttack returns miss content when the attack misses', async () => {
    const capturedMessagesByRound = [];
    const attackSummary = {
        hit: false,
        attacker: { name: 'The player' },
        defender: { name: 'Hollow Sentinel Valdrus' },
        roll: { die: 2, total: 6 }
    };
    const runtime = makeRuntime({
        firstResponse: resolveAttackToolResponse(attackArgs),
        capturedMessagesByRound,
        resolveAttack: async () => ({ hit: false, summary: attackSummary })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Attack.' }] },
        metadataLabel: 'test_resolve_attack_miss_tool'
    });

    assert.equal(result.toolInvocations[0].metadata.result, 'miss');
    assert.deepEqual(result.toolInvocations[0].metadata.summary, attackSummary);
    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, 'miss');
});

test('resolveAttack reuses cached results for repeated same-round attacks', async () => {
    const capturedMessagesByRound = [];
    const debugEvents = [];
    let resolveCount = 0;
    const runtime = makeRuntime({
        firstResponse: resolveAttackToolResponseWithCalls([attackArgs, attackArgs]),
        capturedMessagesByRound,
        resolveAttack: async () => {
            resolveCount += 1;
            return {
                hit: true,
                declaredDamage: 9,
                damage: 7,
                application: {
                    targetId: 'npc-1',
                    targetName: 'Hollow Sentinel Valdrus',
                    damageDeclared: 9,
                    damageApplied: 7,
                    startingHealth: 50,
                    endingHealth: 43,
                    rawRemainingHealth: 43,
                    maxHealthBefore: 50,
                    maxHealthAfter: 50,
                    healthLostPercent: 14,
                    remainingHealthPercent: 86
                },
                locationRefreshRequested: true,
                summary: {
                    hit: true,
                    attacker: { name: 'The player' },
                    defender: { name: 'Hollow Sentinel Valdrus' },
                    damage: { total: 9, applied: 7 },
                    target: {
                        startingHealth: 50,
                        remainingHealth: 43,
                        healthLostPercent: 14,
                        remainingHealthPercent: 86
                    }
                }
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Attack twice in drafts.' }] },
        metadataLabel: 'test_resolve_attack_cache',
        onToolCallDebug: event => {
            debugEvents.push(structuredClone(event));
        }
    });

    assert.equal(resolveCount, 1);
    assert.equal(result.toolInvocations.length, 2);
    assert.equal(result.toolInvocations[0].metadata.cached, false);
    assert.equal(result.toolInvocations[1].metadata.cached, true);
    assert.equal(result.toolInvocations[0].metadata.cacheKey, result.toolInvocations[1].metadata.cacheKey);
    const toolMessages = capturedMessagesByRound[1].filter(message => message.role === 'tool');
    assert.deepEqual(toolMessages.map(message => message.content), [
        'Damage: 14%\nRemaining health: 86%',
        `Damage: 14%\nRemaining health: 86%\n\n${CACHED_CHECK_TOOL_CALL_NOTE}`
    ]);
    assert.equal(debugEvents.length, 4);
    assert.equal(debugEvents[1].phase, 'completed');
    assert.equal(debugEvents[1].cacheHit, false);
    assert.equal(debugEvents[3].phase, 'completed');
    assert.equal(debugEvents[3].cacheHit, true);
    assert.equal(debugEvents[3].cacheKey, result.toolInvocations[1].metadata.cacheKey);
    assert.equal(debugEvents[3].result.metadata.cached, true);
});
