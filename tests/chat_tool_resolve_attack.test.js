const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

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

test('resolveAttack returns damage content and preserves attack-check modifier semantics', async () => {
    const capturedMessagesByRound = [];
    let capturedAttackEntry = null;
    const runtime = makeRuntime({
        firstResponse: resolveAttackToolResponse(attackArgs),
        capturedMessagesByRound,
        resolveAttack: async ({ attackEntry }) => {
            capturedAttackEntry = attackEntry;
            return { hit: true, damage: 7 };
        }
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Attack.' }] },
        metadataLabel: 'test_resolve_attack_tool'
    });

    assert.equal(result.rounds, 2);
    assert.equal(result.toolInvocations[0].name, 'resolveAttack');
    assert.equal(result.toolInvocations[0].metadata.damage, 7);
    assert.equal(capturedAttackEntry.attacker, 'player');
    assert.equal(capturedAttackEntry.defender, 'Hollow Sentinel Valdrus');
    assert.deepEqual(capturedAttackEntry.circumstanceModifiers, [
        { amount: 2, reason: 'Good footing' },
        { amount: -3, reason: 'Prepared guard' }
    ]);

    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, '7');
});

test('resolveAttack returns miss content when the attack misses', async () => {
    const capturedMessagesByRound = [];
    const runtime = makeRuntime({
        firstResponse: resolveAttackToolResponse(attackArgs),
        capturedMessagesByRound,
        resolveAttack: async () => ({ hit: false })
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Attack.' }] },
        metadataLabel: 'test_resolve_attack_miss_tool'
    });

    assert.equal(result.toolInvocations[0].metadata.result, 'miss');
    const toolMessage = capturedMessagesByRound[1].find(message => message.role === 'tool');
    assert.equal(toolMessage.content, 'miss');
});
