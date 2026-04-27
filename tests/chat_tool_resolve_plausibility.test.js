const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeRuntime({
    firstResponse,
    resolvePlausibilityCheck = async () => {
        throw new Error('resolvePlausibilityCheck should not be reached.');
    },
    resolveOpposedPlausibilityCheck = async () => {
        throw new Error('resolveOpposedPlausibilityCheck should not be reached.');
    },
    capturedMessagesByRound
}) {
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
        resolveAttack: async () => {
            throw new Error('resolveAttack should not be reached.');
        },
        resolvePlausibilityCheck,
        resolveOpposedPlausibilityCheck,
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
                                content: 'Check resolved.',
                                tool_calls: []
                            }
                        }]
                    }
                };
                options.onResponse?.(finalResponse);
                return 'Check resolved.';
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

function toolResponse(name, args) {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: [{
                        id: `call-${name}`,
                        type: 'function',
                        function: {
                            name,
                            arguments: JSON.stringify(args)
                        }
                    }]
                }
            }]
        }
    };
}

function toolResponseWithCalls(name, calls) {
    return {
        data: {
            choices: [{
                message: {
                    content: '',
                    tool_calls: calls.map((args, index) => ({
                        id: `call-${name}-${index}`,
                        type: 'function',
                        function: {
                            name,
                            arguments: JSON.stringify(args)
                        }
                    }))
                }
            }]
        }
    };
}

test('skill-check tool schemas expose separate unopposed and opposed check calls', () => {
    const unopposed = findToolDefinition('resolveSkillCheck');
    const opposed = findToolDefinition('resolveOpposedSkillCheck');

    assert.ok(unopposed, 'resolveSkillCheck tool definition should exist');
    assert.ok(opposed, 'resolveOpposedSkillCheck tool definition should exist');
    assert.equal(findToolDefinition('resolvePlausibilityCheck'), null);
    assert.equal(findToolDefinition('resolveOpposedPlausibilityCheck'), null);
    assert.deepEqual(unopposed.parameters.required, [
        'reason',
        'skill',
        'attribute',
        'difficultyLevel',
        'circumstanceModifiers'
    ]);
    assert.deepEqual(opposed.parameters.required, [
        'reason',
        'skill',
        'attribute',
        'opponent',
        'opponentSkill',
        'opponentAttribute',
        'circumstanceModifiers'
    ]);
});

test('resolveSkillCheck returns outcome content and action resolution metadata', async () => {
    const capturedMessagesByRound = [];
    let capturedActor = null;
    let capturedPlausibility = null;
    const actionResolution = {
        label: 'major success',
        degree: 'major_success',
        success: true,
        roll: { die: 18, total: 27 },
        difficulty: { label: 'Hard', dc: 20 },
        skill: 'Stealth',
        attribute: 'Dexterity'
    };
    const runtime = makeRuntime({
        firstResponse: toolResponse('resolveSkillCheck', {
            actor: 'player',
            reason: 'The lock is old but still complex.',
            skill: 'Lockpicking',
            attribute: 'Dexterity',
            difficultyLevel: 'Hard',
            circumstanceModifiers: [
                { amount: 2, reason: 'Good tools' },
                { amount: -1, reason: 'Poor lighting' }
            ]
        }),
        capturedMessagesByRound,
        resolvePlausibilityCheck: async ({ actor, plausibility }) => {
            capturedActor = actor;
            capturedPlausibility = plausibility;
            return { actionResolution, plausibility: { raw: null, structured: plausibility } };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Pick the lock.' }] },
        metadataLabel: 'test_resolve_plausibility_tool'
    });

    assert.equal(result.toolInvocations[0].name, 'resolveSkillCheck');
    assert.equal(result.toolInvocations[0].metadata.result, 'major success');
    assert.deepEqual(result.toolInvocations[0].metadata.actionResolution, actionResolution);
    assert.equal(capturedActor, 'player');
    assert.equal(capturedPlausibility.skillCheck.checkType, 'unopposed');
    assert.equal(capturedPlausibility.skillCheck.unopposedCheck.difficultyLevel, 'Hard');
    assert.equal(capturedPlausibility.skillCheck.circumstanceModifier, 1);
    assert.deepEqual(capturedPlausibility.skillCheck.circumstanceModifiers, [
        { amount: 2, reason: 'Good tools' },
        { amount: -1, reason: 'Poor lighting' }
    ]);

    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, 'major success');
});

test('resolveSkillCheck uses the prompt default actor when actor is omitted', async () => {
    const capturedMessagesByRound = [];
    let capturedActor = null;
    const actionResolution = {
        label: 'success',
        degree: 'success',
        success: true,
        roll: { die: 13, total: 19 },
        difficulty: { label: 'Medium', dc: 15 }
    };
    const runtime = makeRuntime({
        firstResponse: toolResponse('resolveSkillCheck', {
            reason: 'The NPC tries to slip through the crowd.',
            skill: 'Stealth',
            attribute: 'Dexterity',
            difficultyLevel: 'Medium',
            circumstanceModifiers: []
        }),
        capturedMessagesByRound,
        resolvePlausibilityCheck: async ({ actor, plausibility }) => {
            capturedActor = actor;
            return { actionResolution, plausibility: { raw: null, structured: plausibility } };
        }
    });

    await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'NPC action.' }] },
        metadataLabel: 'test_resolve_plausibility_default_actor',
        defaultToolActor: 'Rook'
    });

    assert.equal(capturedActor, 'Rook');
});

test('resolveOpposedSkillCheck builds opposed check payloads', async () => {
    const capturedMessagesByRound = [];
    let capturedPlausibility = null;
    const actionResolution = {
        label: 'barely failed',
        degree: 'barely_failed',
        success: false,
        roll: { die: 8, total: 14, opponentDie: 13, opponentTotal: 15 },
        difficulty: { label: 'Opposed vs Guard', type: 'opposed' },
        opponent: { name: 'Guard' }
    };
    const runtime = makeRuntime({
        firstResponse: toolResponse('resolveOpposedSkillCheck', {
            reason: 'The guard is actively watching for deception.',
            skill: 'Deception',
            attribute: 'Charisma',
            opponent: 'Guard',
            opponentSkill: 'Insight',
            opponentAttribute: 'Wisdom',
            circumstanceModifiers: []
        }),
        capturedMessagesByRound,
        resolveOpposedPlausibilityCheck: async ({ plausibility }) => {
            capturedPlausibility = plausibility;
            return { actionResolution, plausibility: { raw: null, structured: plausibility } };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Lie to the guard.' }] },
        metadataLabel: 'test_resolve_opposed_plausibility_tool'
    });

    assert.equal(result.toolInvocations[0].name, 'resolveOpposedSkillCheck');
    assert.equal(result.toolInvocations[0].metadata.result, 'barely failed');
    assert.equal(result.toolInvocations[0].metadata.checkType, 'opposed');
    assert.deepEqual(result.toolInvocations[0].metadata.actionResolution, actionResolution);
    assert.equal(capturedPlausibility.skillCheck.checkType, 'opposed');
    assert.deepEqual(capturedPlausibility.skillCheck.opposedCheck, {
        opponent: 'Guard',
        opponentSkill: 'Insight',
        opponentAttribute: 'Wisdom'
    });

    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, 'barely failed');
});

test('resolveOpposedSkillCheck uses the prompt default actor when actor is omitted', async () => {
    const capturedMessagesByRound = [];
    let capturedActor = null;
    const actionResolution = {
        label: 'barely succeeded',
        degree: 'barely_succeeded',
        success: true,
        roll: { die: 11, total: 18, opponentDie: 10, opponentTotal: 17 },
        difficulty: { label: 'Opposed vs Guard', type: 'opposed' }
    };
    const runtime = makeRuntime({
        firstResponse: toolResponse('resolveOpposedSkillCheck', {
            reason: 'The NPC tries to feint past the guard.',
            skill: 'Deception',
            attribute: 'Charisma',
            opponent: 'Guard',
            opponentSkill: 'Insight',
            opponentAttribute: 'Wisdom',
            circumstanceModifiers: []
        }),
        capturedMessagesByRound,
        resolveOpposedPlausibilityCheck: async ({ actor, plausibility }) => {
            capturedActor = actor;
            return { actionResolution, plausibility: { raw: null, structured: plausibility } };
        }
    });

    await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'NPC opposed action.' }] },
        metadataLabel: 'test_resolve_opposed_plausibility_default_actor',
        defaultToolActor: 'Rook'
    });

    assert.equal(capturedActor, 'Rook');
});

test('resolveSkillCheck reuses cached results for repeated same-round checks', async () => {
    const capturedMessagesByRound = [];
    let resolveCount = 0;
    const checkArgs = {
        actor: 'player',
        reason: 'The lock is old but still complex.',
        skill: 'Lockpicking',
        attribute: 'Dexterity',
        difficultyLevel: 'Hard',
        circumstanceModifiers: [
            { amount: 2, reason: 'Good tools' }
        ]
    };
    const actionResolution = {
        label: 'success',
        degree: 'success',
        success: true,
        roll: { die: 14, total: 21 },
        difficulty: { label: 'Hard', dc: 20 },
        skill: 'Lockpicking',
        attribute: 'Dexterity'
    };
    const runtime = makeRuntime({
        firstResponse: toolResponseWithCalls('resolveSkillCheck', [checkArgs, {
            ...checkArgs,
            difficultyLevel: 'Legendary',
            circumstanceModifiers: [
                { amount: -10, reason: 'Relitigated harder draft' }
            ]
        }]),
        capturedMessagesByRound,
        resolvePlausibilityCheck: async ({ plausibility }) => {
            resolveCount += 1;
            return { actionResolution, plausibility: { raw: null, structured: plausibility } };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Pick the lock.' }] },
        metadataLabel: 'test_resolve_plausibility_cache'
    });

    assert.equal(resolveCount, 1);
    assert.equal(result.toolInvocations.length, 2);
    assert.equal(result.toolInvocations[0].metadata.cached, false);
    assert.equal(result.toolInvocations[1].metadata.cached, true);
    assert.equal(result.toolInvocations[0].metadata.cacheKey, result.toolInvocations[1].metadata.cacheKey);
    assert.deepEqual(result.toolInvocations[1].metadata.actionResolution, actionResolution);
    const toolMessages = capturedMessagesByRound[1].filter(message => message.role === 'tool');
    assert.deepEqual(toolMessages.map(message => message.content), ['success', 'success']);
});

test('resolveSkillCheck cache separates different attributes', async () => {
    const capturedMessagesByRound = [];
    let resolveCount = 0;
    const firstCheck = {
        actor: 'player',
        reason: 'The climb could be handled with agility or brute force.',
        skill: 'Athletics',
        attribute: 'Dexterity',
        difficultyLevel: 'Hard',
        circumstanceModifiers: []
    };
    const secondCheck = {
        ...firstCheck,
        attribute: 'Strength'
    };
    const runtime = makeRuntime({
        firstResponse: toolResponseWithCalls('resolveSkillCheck', [firstCheck, secondCheck]),
        capturedMessagesByRound,
        resolvePlausibilityCheck: async ({ plausibility }) => {
            resolveCount += 1;
            const attribute = plausibility?.skillCheck?.attribute || 'Unknown';
            return {
                actionResolution: {
                    label: attribute.toLowerCase(),
                    degree: 'success',
                    success: true,
                    skill: 'Athletics',
                    attribute
                },
                plausibility: { raw: null, structured: plausibility }
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Climb the wall.' }] },
        metadataLabel: 'test_resolve_plausibility_attribute_cache'
    });

    assert.equal(resolveCount, 2);
    assert.equal(result.toolInvocations.length, 2);
    assert.equal(result.toolInvocations[0].metadata.cached, false);
    assert.equal(result.toolInvocations[1].metadata.cached, false);
    assert.notEqual(result.toolInvocations[0].metadata.cacheKey, result.toolInvocations[1].metadata.cacheKey);
    const toolMessages = capturedMessagesByRound[1].filter(message => message.role === 'tool');
    assert.deepEqual(toolMessages.map(message => message.content), ['dexterity', 'strength']);
});

test('resolveOpposedSkillCheck cache separates different opposing attributes', async () => {
    const capturedMessagesByRound = [];
    let resolveCount = 0;
    const firstCheck = {
        actor: 'player',
        reason: 'Bluff past the guard.',
        skill: 'Deception',
        attribute: 'Charisma',
        opponent: 'Guard',
        opponentSkill: 'Insight',
        opponentAttribute: 'Wisdom',
        circumstanceModifiers: []
    };
    const secondCheck = {
        ...firstCheck,
        opponentAttribute: 'Intelligence'
    };
    const runtime = makeRuntime({
        firstResponse: toolResponseWithCalls('resolveOpposedSkillCheck', [firstCheck, secondCheck]),
        capturedMessagesByRound,
        resolveOpposedPlausibilityCheck: async ({ plausibility }) => {
            resolveCount += 1;
            const opponentAttribute = plausibility?.skillCheck?.opposedCheck?.opponentAttribute || 'Unknown';
            return {
                actionResolution: {
                    label: opponentAttribute.toLowerCase(),
                    degree: 'success',
                    success: true,
                    skill: 'Deception',
                    attribute: 'Charisma'
                },
                plausibility: { raw: null, structured: plausibility }
            };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Talk past the guard.' }] },
        metadataLabel: 'test_resolve_opposed_plausibility_attribute_cache'
    });

    assert.equal(resolveCount, 2);
    assert.equal(result.toolInvocations.length, 2);
    assert.equal(result.toolInvocations[0].metadata.cached, false);
    assert.equal(result.toolInvocations[1].metadata.cached, false);
    assert.notEqual(result.toolInvocations[0].metadata.cacheKey, result.toolInvocations[1].metadata.cacheKey);
    const toolMessages = capturedMessagesByRound[1].filter(message => message.role === 'tool');
    assert.deepEqual(toolMessages.map(message => message.content), ['wisdom', 'intelligence']);
});
