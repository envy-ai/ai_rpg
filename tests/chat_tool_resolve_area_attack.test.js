const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

const CACHED_CHECK_TOOL_CALL_NOTE = 'You already made this tool call. Do not re-run tool calls for the same checks that you made in earlier drafts.';

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeRuntime({ firstResponse, resolveAreaAttack, capturedMessagesByRound, characters = [], currentPlayer = null }) {
    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => currentPlayer || { id: 'player-1', name: 'Exis', currentLocation: 'loc-1' },
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
        resolveAreaAttack,
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
                                content: 'Area attack resolved.',
                                tool_calls: []
                            }
                        }]
                    }
                };
                options.onResponse?.(finalResponse);
                return 'Area attack resolved.';
            },
            logPrompt: () => {},
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => characters },
        Thing: { getAll: () => [] },
        Location: { getAll: () => [], get: () => null },
        Region: { getAll: () => [] },
        getGameLocations: () => new Map(),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
}

function resolveAreaAttackToolResponse(args) {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: [{
                        id: 'call-resolve-area-attack',
                        type: 'function',
                        function: {
                            name: 'resolveAreaAttack',
                            arguments: JSON.stringify(args)
                        }
                    }]
                }
            }]
        }
    };
}

function resolveAreaAttackToolResponseWithCalls(calls) {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: calls.map((args, index) => ({
                        id: `call-resolve-area-attack-${index}`,
                        type: 'function',
                        function: {
                            name: 'resolveAreaAttack',
                            arguments: JSON.stringify(args)
                        }
                    }))
                }
            }]
        }
    };
}

const areaAttackArgs = {
    attacker: 'player',
    targets: [
        {
            name: 'Commander Razorclaw',
            position: 'center',
            defenseInfo: {
                evadeSkill: 'Dodge',
                deflectSkill: 'N/A',
                toughnessAttribute: 'endurance'
            },
            circumstanceModifiers: [],
            damageEffectiveness: 3
        },
        {
            name: 'Goblin Sapper',
            position: 'edge',
            defenseInfo: {
                evadeSkill: 'Dodge',
                deflectSkill: 'N/A',
                toughnessAttribute: 'endurance'
            },
            circumstanceModifiers: [
                { amount: 2, reason: 'Half behind a barricade' }
            ],
            damageEffectiveness: 2
        },
        {
            name: 'Shield Adept',
            position: 'behind cover',
            defenseInfo: {
                evadeSkill: 'Dodge',
                deflectSkill: 'Shield Block',
                toughnessAttribute: 'endurance'
            },
            circumstanceModifiers: [],
            damageEffectiveness: 3
        }
    ],
    attackerInfo: {
        attackSkill: 'Ranged Combat',
        damageAttribute: 'dexterity'
    },
    ability: 'N/A',
    weapon: 'Concussion Grenade',
    areaShape: 'blast',
    effectDescription: 'A grenade detonates among the barricades.',
    rollMode: 'sharedAttackRoll',
    circumstanceModifiers: [
        { amount: 1, reason: 'Thrown from an elevated landing' }
    ],
    secondaryEffect: {
        name: 'Concussed',
        description: 'Ears ringing and balance disrupted.',
        appliesOn: 'hit'
    }
};

test('resolveAreaAttack tool schema describes one shared area effect with per-target defenses', () => {
    const resolveAreaAttack = findToolDefinition('resolveAreaAttack');
    assert.ok(resolveAreaAttack, 'resolveAreaAttack tool definition should exist');
    assert.deepEqual(resolveAreaAttack.parameters.required, [
        'attacker',
        'targets',
        'attackerInfo',
        'ability',
        'weapon',
        'areaShape',
        'effectDescription',
        'rollMode',
        'circumstanceModifiers',
        'secondaryEffect'
    ]);
    assert.deepEqual(resolveAreaAttack.parameters.properties.attackerInfo.required, ['attackSkill', 'damageAttribute']);
    assert.deepEqual(resolveAreaAttack.parameters.properties.targets.items.required, [
        'name',
        'position',
        'defenseInfo',
        'circumstanceModifiers',
        'damageEffectiveness'
    ]);
    assert.deepEqual(resolveAreaAttack.parameters.properties.targets.items.properties.defenseInfo.required, [
        'evadeSkill',
        'deflectSkill',
        'toughnessAttribute'
    ]);
});

test('resolveAreaAttack returns grouped per-target content and metadata', async () => {
    const capturedMessagesByRound = [];
    const debugEvents = [];
    let capturedAreaAttackEntry = null;
    const areaSummary = {
        kind: 'area-attack',
        attacker: 'Exis',
        weapon: 'Concussion Grenade',
        ability: 'N/A',
        areaShape: 'blast',
        rollMode: 'sharedAttackRoll',
        sharedRoll: {
            die: 13,
            total: 31,
            attackSkill: 'Ranged Combat',
            damageAttribute: 'dexterity'
        },
        results: [
            {
                target: 'Commander Razorclaw',
                hit: true,
                damageApplied: 14,
                remainingHealthPercent: 62,
                position: 'center',
                secondaryEffectApplied: false,
                secondaryEffect: 'Concussed'
            },
            {
                target: 'Goblin Sapper',
                hit: true,
                damageApplied: 8,
                remainingHealthPercent: 41,
                position: 'edge',
                secondaryEffectApplied: false,
                secondaryEffect: 'Concussed'
            },
            {
                target: 'Shield Adept',
                hit: false,
                damageApplied: 0,
                remainingHealthPercent: 100,
                position: 'behind cover',
                secondaryEffectApplied: false,
                secondaryEffect: 'Concussed'
            }
        ]
    };
    const runtime = makeRuntime({
        firstResponse: resolveAreaAttackToolResponse(areaAttackArgs),
        capturedMessagesByRound,
        resolveAreaAttack: async ({ areaAttackEntry }) => {
            capturedAreaAttackEntry = areaAttackEntry;
            return {
                hitCount: 2,
                targetCount: 3,
                locationRefreshRequested: true,
                summary: areaSummary,
                results: areaSummary.results
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Throw the grenade.' }] },
        metadataLabel: 'test_resolve_area_attack_tool',
        onToolCallEvent: event => {
            debugEvents.push(structuredClone(event));
        }
    });

    assert.equal(result.rounds, 2);
    assert.equal(result.toolInvocations[0].name, 'resolveAreaAttack');
    assert.equal(result.toolInvocations[0].metadata.kind, 'area-attack');
    assert.equal(result.toolInvocations[0].metadata.hitCount, 2);
    assert.equal(result.toolInvocations[0].metadata.targetCount, 3);
    assert.equal(result.toolInvocations[0].metadata.locationRefreshRequested, true);
    assert.deepEqual(result.toolInvocations[0].metadata.summary, areaSummary);
    assert.equal(capturedAreaAttackEntry.attacker, 'player');
    assert.equal(capturedAreaAttackEntry.targets[1].position, 'edge');
    assert.deepEqual(capturedAreaAttackEntry.targets[1].circumstanceModifiers, [
        { amount: -2, reason: 'Half behind a barricade' }
    ]);
    assert.deepEqual(capturedAreaAttackEntry.circumstanceModifiers, [
        { amount: 1, reason: 'Thrown from an elevated landing' }
    ]);

    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, [
        'Area attack results:',
        '- Commander Razorclaw: hit, Damage: 14%, Remaining health: 62%, Defeated by this attack: NO — the target remains alive and is not incapacitated or defeated by this attack.',
        '- Goblin Sapper: hit, Damage: 8%, Remaining health: 41%, Defeated by this attack: NO — the target remains alive and is not incapacitated or defeated by this attack.',
        '- Shield Adept: miss, no damage'
    ].join('\n'));
    assert.equal(debugEvents[1].phase, 'completed');
    assert.equal(debugEvents[1].result.metadata.kind, 'area-attack');
    assert.deepEqual(debugEvents[1].result.metadata.summary.results.map(entry => entry.target), [
        'Commander Razorclaw',
        'Goblin Sapper',
        'Shield Adept'
    ]);
});

test('resolveAreaAttack reveals a hidden attacker immediately', async () => {
    const capturedMessagesByRound = [];
    const hiddenAttacker = {
        id: 'npc-shade',
        name: 'Shade',
        isNPC: true,
        hiddenFromPlayer: true,
        currentLocation: 'loc-1'
    };
    const args = {
        ...areaAttackArgs,
        attacker: 'Shade'
    };
    const runtime = makeRuntime({
        firstResponse: resolveAreaAttackToolResponse(args),
        capturedMessagesByRound,
        characters: [hiddenAttacker],
        resolveAreaAttack: async () => ({
            hitCount: 0,
            targetCount: 3,
            locationRefreshRequested: false,
            summary: {
                kind: 'area-attack',
                attacker: 'Shade',
                weapon: 'Concussion Grenade',
                ability: 'N/A',
                areaShape: 'blast',
                rollMode: 'sharedAttackRoll',
                results: [
                    { target: 'Commander Razorclaw', hit: false, damageApplied: 0, remainingHealthPercent: 100, position: 'center' },
                    { target: 'Goblin Sapper', hit: false, damageApplied: 0, remainingHealthPercent: 100, position: 'edge' },
                    { target: 'Shield Adept', hit: false, damageApplied: 0, remainingHealthPercent: 100, position: 'behind cover' }
                ]
            }
        })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Shade attacks the group.' }] },
        metadataLabel: 'test_resolve_area_attack_hidden_attacker'
    });

    assert.equal(hiddenAttacker.hiddenFromPlayer, false);
    assert.equal(result.toolInvocations[0].metadata.locationRefreshRequested, true);
});

test('resolveAreaAttack marks all-hit area results distinctly', async () => {
    const capturedMessagesByRound = [];
    const allHitArgs = structuredClone(areaAttackArgs);
    allHitArgs.targets = allHitArgs.targets.slice(0, 2);
    const runtime = makeRuntime({
        firstResponse: resolveAreaAttackToolResponse(allHitArgs),
        capturedMessagesByRound,
        resolveAreaAttack: async () => ({
            hitCount: 2,
            targetCount: 2,
            locationRefreshRequested: true,
            summary: {
                kind: 'area-attack',
                attacker: 'Exis',
                weapon: 'Concussion Grenade',
                ability: 'N/A',
                areaShape: 'blast',
                rollMode: 'sharedAttackRoll',
                sharedRoll: { die: 18, total: 36 },
                results: [
                    {
                        target: 'Commander Razorclaw',
                        hit: true,
                        damageApplied: 14,
                        remainingHealthPercent: 62,
                        position: 'center'
                    },
                    {
                        target: 'Goblin Sapper',
                        hit: true,
                        damageApplied: 8,
                        remainingHealthPercent: 41,
                        position: 'edge'
                    }
                ]
            }
        })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Throw the grenade.' }] },
        metadataLabel: 'test_resolve_area_attack_all_hit'
    });

    assert.equal(result.toolInvocations[0].metadata.result, 'all-hit');
    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, [
        'Area attack results:',
        '- Commander Razorclaw: hit, Damage: 14%, Remaining health: 62%, Defeated by this attack: NO — the target remains alive and is not incapacitated or defeated by this attack.',
        '- Goblin Sapper: hit, Damage: 8%, Remaining health: 41%, Defeated by this attack: NO — the target remains alive and is not incapacitated or defeated by this attack.'
    ].join('\n'));
});

test('resolveAreaAttack rejects duplicate target names before resolver execution', async () => {
    const capturedMessagesByRound = [];
    let resolveCount = 0;
    const duplicateArgs = structuredClone(areaAttackArgs);
    duplicateArgs.targets = [duplicateArgs.targets[0], structuredClone(duplicateArgs.targets[0])];
    const runtime = makeRuntime({
        firstResponse: resolveAreaAttackToolResponse(duplicateArgs),
        capturedMessagesByRound,
        resolveAreaAttack: async () => {
            resolveCount += 1;
            throw new Error('resolveAreaAttack should not be reached.');
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Throw the grenade.' }] },
        metadataLabel: 'test_resolve_area_attack_duplicate'
    });

    assert.equal(resolveCount, 0);
    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'invalid_arguments');
    assert.match(result.toolInvocations[0].metadata.message, /duplicate target/i);
});

test('resolveAreaAttack rejects missing target names before resolver execution', async () => {
    const capturedMessagesByRound = [];
    let resolveCount = 0;
    const missingTargetArgs = structuredClone(areaAttackArgs);
    missingTargetArgs.targets[0].name = '';
    const runtime = makeRuntime({
        firstResponse: resolveAreaAttackToolResponse(missingTargetArgs),
        capturedMessagesByRound,
        resolveAreaAttack: async () => {
            resolveCount += 1;
            throw new Error('resolveAreaAttack should not be reached.');
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Throw the grenade.' }] },
        metadataLabel: 'test_resolve_area_attack_missing_target'
    });

    assert.equal(resolveCount, 0);
    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'invalid_arguments');
    assert.match(result.toolInvocations[0].metadata.message, /targets\[0\]\.name/);
});

test('resolveAreaAttack caches repeated same-round area effects with sorted target names', async () => {
    const capturedMessagesByRound = [];
    let resolveCount = 0;
    const reversedArgs = structuredClone(areaAttackArgs);
    reversedArgs.targets = [...reversedArgs.targets].reverse();
    const runtime = makeRuntime({
        firstResponse: resolveAreaAttackToolResponseWithCalls([areaAttackArgs, reversedArgs]),
        capturedMessagesByRound,
        resolveAreaAttack: async () => {
            resolveCount += 1;
            return {
                hitCount: 1,
                targetCount: 3,
                locationRefreshRequested: true,
                summary: {
                    kind: 'area-attack',
                    attacker: 'Exis',
                    weapon: 'Concussion Grenade',
                    ability: 'N/A',
                    areaShape: 'blast',
                    rollMode: 'sharedAttackRoll',
                    sharedRoll: { die: 13, total: 31 },
                    results: [
                        {
                            target: 'Commander Razorclaw',
                            hit: true,
                            damageApplied: 14,
                            remainingHealthPercent: 62,
                            position: 'center'
                        },
                        {
                            target: 'Goblin Sapper',
                            hit: false,
                            damageApplied: 0,
                            remainingHealthPercent: 100,
                            position: 'edge'
                        },
                        {
                            target: 'Shield Adept',
                            hit: false,
                            damageApplied: 0,
                            remainingHealthPercent: 100,
                            position: 'behind cover'
                        }
                    ]
                }
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Repeat the grenade draft.' }] },
        metadataLabel: 'test_resolve_area_attack_cache'
    });

    assert.equal(resolveCount, 1);
    assert.equal(result.toolInvocations.length, 2);
    assert.equal(result.toolInvocations[0].metadata.cached, false);
    assert.equal(result.toolInvocations[1].metadata.cached, true);
    assert.equal(result.toolInvocations[0].metadata.cacheKey, result.toolInvocations[1].metadata.cacheKey);

    const toolMessages = capturedMessagesByRound[1].filter(message => message.role === 'tool');
    assert.deepEqual(toolMessages.map(message => message.content), [
        [
            'Area attack results:',
            '- Commander Razorclaw: hit, Damage: 14%, Remaining health: 62%, Defeated by this attack: NO — the target remains alive and is not incapacitated or defeated by this attack.',
            '- Goblin Sapper: miss, no damage',
            '- Shield Adept: miss, no damage'
        ].join('\n'),
        [
            'Area attack results:',
            '- Commander Razorclaw: hit, Damage: 14%, Remaining health: 62%, Defeated by this attack: NO — the target remains alive and is not incapacitated or defeated by this attack.',
            '- Goblin Sapper: miss, no damage',
            '- Shield Adept: miss, no damage',
            '',
            CACHED_CHECK_TOOL_CALL_NOTE
        ].join('\n')
    ]);
});

test('resolveAreaAttack forwards a fixed prompt die-roll override to the resolver', async () => {
    const capturedMessagesByRound = [];
    let capturedDieRollOverride = null;
    const runtime = makeRuntime({
        firstResponse: resolveAreaAttackToolResponse(areaAttackArgs),
        capturedMessagesByRound,
        resolveAreaAttack: async ({ dieRollOverride }) => {
            capturedDieRollOverride = dieRollOverride;
            return {
                hitCount: 0,
                targetCount: 3,
                locationRefreshRequested: false,
                summary: {
                    kind: 'area-attack',
                    attacker: 'Exis',
                    weapon: 'Concussion Grenade',
                    ability: 'N/A',
                    areaShape: 'blast',
                    rollMode: 'sharedAttackRoll',
                    sharedRoll: { die: 20, total: 38 },
                    results: areaAttackArgs.targets.map(target => ({
                        target: target.name,
                        hit: false,
                        damageApplied: 0,
                        remainingHealthPercent: 100,
                        position: target.position
                    }))
                }
            };
        }
    });

    await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Throw the grenade.' }] },
        metadataLabel: 'test_resolve_area_attack_fixed_roll',
        dieRollOverride: 20
    });

    assert.equal(capturedDieRollOverride, 20);
});
