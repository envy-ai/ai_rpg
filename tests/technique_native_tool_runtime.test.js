'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LLMClient = require('../LLMClient.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const TechniqueService = require('../TechniqueService.js');
const {
    CHAT_TOOL_DEFINITIONS,
    TINY_BRAIN_LOOKUP_TOOL_NAMES,
    createChatToolRuntime,
    getChatToolDefinitions
} = require('../chat_tool_calls.js');
const { receiptInvocation, resolveTechniqueAttemptIdentity } = require('../TechniquePrompt.js');
const { createPlayerTechniqueSession } = require('../PlayerTechniqueIntent.js');
const { writeTechniqueXmlValue, disciplineGroupSchema } = require('../TechniqueXml.js');
const { DOMImplementation, XMLSerializer } = require('@xmldom/xmldom');
const { withTechniqueWorld, mechanics, addDefinition, learn } = require('./helpers/techniqueIntegrationFixtures.js');

const byName = actors => name => actors.find(actor => actor.id === name || actor.name.toLowerCase() === String(name).toLowerCase()) || null;
const toResult = receipt => {
    const invocation = receiptInvocation(receipt, 'Native technique attempt.');
    return { content: invocation.content, metadata: invocation.metadata };
};

function createRuntime({ world, executeTechnique = null, resolveAttack = null, resolveAreaAttack = null, responses = [], config = { ai: { max_tool_rounds: 3, retryAttempts: 1 } } }) {
    const completionOptions = [];
    const runtime = createChatToolRuntime({
        getConfig: () => config,
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => world?.player || { id: 'player', name: 'Player', currentLocation: 'location' },
        createLocationFromEvent: async () => { throw new Error('Unexpected createLocationFromEvent call.'); },
        createRegionStubFromEvent: async () => { throw new Error('Unexpected createRegionStubFromEvent call.'); },
        generateItemsByNames: async () => [],
        ensureExitConnection: () => { throw new Error('Unexpected ensureExitConnection call.'); },
        findRegionByLocationId: () => null,
        executeTechnique,
        resolveAttack,
        resolveAreaAttack,
        LLMClient: {
            assertTinyBrainAllowedToolNames: () => {},
            getTinyBrainToolChoice: () => null,
            getTinyBrainToolExecutionState: () => null,
            getBaseContextEndMarker: () => LLMClient.getBaseContextEndMarker(),
            applyBaseContextToolPolicy: () => ({ sharedToolsApplied: false }),
            chatCompletion: async options => {
                completionOptions.push(options);
                const response = responses.shift();
                assert.ok(response, 'unexpected LLM completion');
                options.onResponse?.(response);
                return response;
            },
            logPrompt: () => {},
            formatMessagesForErrorLog: messages => JSON.stringify(messages),
            hasActivePromptProgressGroup: () => false,
            withPromptProgressGroup: async (_group, callback) => callback(),
            clearPromptProgressGroup: () => {}
        },
        Player,
        Thing,
        Location,
        Region,
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
    return { ...runtime, completionOptions };
}

function toolCall(id, functionName, argumentsObject) {
    return { id, name: functionName, functionName, argumentsObject };
}

function runtimeCache(roundKey) {
    return { roundKey, entries: new Map() };
}

function completion(content, calls = []) {
    return { data: { choices: [{ message: { role: 'assistant', content, tool_calls: calls.map(call => ({
        id: call.id,
        type: 'function',
        function: { name: call.functionName, arguments: JSON.stringify(call.argumentsObject) }
    })) } }] } };
}

function managedSelfHealingCandidate(actor, name = 'Field Mend') {
    return {
        name,
        description: 'Restore a practiced ally with a steady gesture.',
        semanticKey: 'field-mend',
        provenance: { kind: 'discovery', reason: 'A successful first field treatment.' },
        revisions: [{
            revision: 1,
            acquisitionRequirements: [{ kind: 'class', name: actor.class }],
            useRequirements: [],
            target: { kind: 'self', allowDead: false },
            check: { kind: 'automatic' },
            recipe: { recipeId: 'standard-healing', skillName: 'Spellcasting', attributeName: 'intelligence', resourceProfileId: 'mana', effectId: 'restore' }
        }]
    };
}

function disciplineXml(candidate) {
    const body = { ...candidate };
    delete body.id; delete body.provenance; delete body.disciplineId;
    const document = new DOMImplementation().createDocument(null, 'discipline', null);
    writeTechniqueXmlValue(document.documentElement, {
        name: 'Field Medicine', description: 'Practical restorative work.', accessRequirements: [], publicAccess: true,
        techniques: [{ candidate: body }]
    }, disciplineGroupSchema);
    return new XMLSerializer().serializeToString(document.documentElement);
}

function singleAttackArgs(actor, target, techniqueName, options = {}) {
    return {
        attacker: actor.name,
        defender: target.name,
        attackerInfo: { attackSkill: 'Melee Combat', damageAttribute: 'Strength' },
        defenderInfo: { evadeSkill: 'Dodge', deflectSkill: 'N/A' },
        ability: techniqueName,
        weapon: 'N/A',
        circumstanceModifiers: { attackerCircumstanceModifier: [], defenderCircumstanceModifier: [] },
        damageEffectiveness: 3,
        ...options
    };
}

function areaAttackArgs(actor, targets, techniqueName, options = {}) {
    return {
        attacker: actor.name,
        targets: targets.map((target, index) => ({
            name: target.name,
            position: index === 0 ? 'center' : 'edge',
            defenseInfo: { evadeSkill: 'Dodge', deflectSkill: 'N/A', toughnessAttribute: 'N/A' },
            circumstanceModifiers: [],
            damageEffectiveness: 3
        })),
        attackerInfo: { attackSkill: 'Ranged Combat', damageAttribute: 'Dexterity' },
        ability: techniqueName,
        weapon: 'N/A',
        areaShape: 'blast',
        effectDescription: 'A practiced area technique.',
        rollMode: 'sharedAttackRoll',
        circumstanceModifiers: [],
        secondaryEffect: { name: 'N/A', description: 'N/A', appliesOn: 'never' },
        ...options
    };
}

test('technique execution tool is opt-in, missing runtimes do not advertise it, and TinyBrain lookups remain frozen', async () => {
    const defaultNames = getChatToolDefinitions().map(entry => entry.function.name);
    const enabled = getChatToolDefinitions({ allowTechniqueExecution: true });
    assert.equal(defaultNames.includes('useTechnique'), false);
    assert.equal(enabled.some(entry => entry.function.name === 'useTechnique'), true);
    assert.equal(CHAT_TOOL_DEFINITIONS.some(entry => entry.function.name === 'useTechnique'), true);
    assert.deepEqual([...TINY_BRAIN_LOOKUP_TOOL_NAMES].sort(), [
        'findMysteryBoxes', 'getFullScene', 'getHistory', 'getMysteryBox', 'getMysteryThread',
        'getTravelTime', 'listLocationEntities', 'listMysteryBoxes', 'listMysteryThreads',
        'locateNpcs', 'locateThings', 'moreInfo'
    ]);
    assert.equal(TINY_BRAIN_LOOKUP_TOOL_NAMES.has('useTechnique'), false);
    const { getPlayerActionToolDefinitions } = require('../ChatToolPolicy.js');
    const actionTools = getPlayerActionToolDefinitions({
        config: { chat_tools: { request_user_input_enabled: true }, use_legacy_prompt_checks: true }
    });
    assert.equal(actionTools.some(entry => entry.function.name === 'useTechnique'), true,
        'the shared player-action schema enables the service-backed native technique tool');

    const request = { data: { choices: [{ message: { content: '', tool_calls: [{
        id: 'call-undeliverable-technique', type: 'function',
        function: { name: 'useTechnique', arguments: JSON.stringify({ actor: 'Player', techniqueId: 'unavailable', targetIds: ['player'], intent: 'Use it' }) }
    }] } }] } };
    const runtime = createRuntime({ responses: [request, { data: { choices: [{ message: { content: 'Done.', tool_calls: [] } }] } }] });
    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: { messages: [{ role: 'user', content: 'Use a technique.' }], tools: enabled },
        metadataLabel: 'technique_executor_missing'
    });
    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'tool_not_declared');
});

test('useTechnique awaits the real service and caches successful retries by mutating tool-call identity', async () => {
    await withTechniqueWorld(async world => {
        const { player } = world;
        const def = addDefinition('technique-native-use', mechanics({
            costs: [{ resource: 'health', amount: 1 }],
            effects: [{ id: 'mend', kind: 'healing', amount: 2 }]
        }));
        learn(player, def.id);
        player.setHealth(player.health - 5);
        const start = player.health;
        let completions = 0;
        const executeTechnique = async (args, { operationId }) => {
            completions += 1;
            const actor = byName([player, world.npc, world.target])(args.actor);
            const reference = resolveTechniqueAttemptIdentity({
                ...args, actor, turnId: 'native-use-turn'
            });
            const receipt = reference || await TechniqueService.execute({
                actor,
                techniqueId: args.techniqueId,
                sourceId: args.sourceId,
                targetIds: args.targetIds,
                intent: args.intent,
                operationId,
                turnId: 'native-use-turn'
            });
            assert.equal(TechniqueService.getReceipt(receipt.operationId)?.committed, true, 'the callback returns only after the service commits its receipt');
            return toResult(receipt);
        };
        const runtime = createRuntime({ world, executeTechnique });
        const cache = runtimeCache('native-use-turn');
        const args = { actor: player.name, techniqueId: def.id, targetIds: [player.id], intent: 'Mend my wounds.', newAttempt: true };
        const first = await runtime.executeChatToolCall(toolCall('use-call-one', 'useTechnique', args), { resultCache: cache });
        assert.equal(first.metadata.techniqueReceipt.committed, true);
        assert.equal(first.metadata.cached, false);
        assert.equal(player.health, start + 1, 'the health cost and heal are committed before tool result returns');

        const sameCallRetry = await runtime.executeChatToolCall(toolCall('use-call-one', 'useTechnique', args), { resultCache: cache });
        assert.equal(sameCallRetry.metadata.cached, true);
        assert.equal(sameCallRetry.metadata.techniqueReceipt.operationId, first.metadata.techniqueReceipt.operationId);
        assert.equal(completions, 1);
        assert.equal(player.health, start + 1);

        const deliberateRepeat = await runtime.executeChatToolCall(toolCall('use-call-two', 'useTechnique', args), { resultCache: cache });
        assert.notEqual(deliberateRepeat.metadata.techniqueReceipt.operationId, first.metadata.techniqueReceipt.operationId);
        assert.equal(player.health, start + 2, 'a distinct deliberate tool call is a distinct paid attempt');
        assert.equal(completions, 2);

        const referenceArgs = { ...args, newAttempt: undefined, operationId: first.metadata.techniqueReceipt.operationId };
        delete referenceArgs.newAttempt;
        const reference = await runtime.executeChatToolCall(toolCall('use-call-reference', 'useTechnique', referenceArgs), { resultCache: cache });
        assert.equal(reference.metadata.techniqueReceipt.operationId, first.metadata.techniqueReceipt.operationId);
        assert.equal(player.health, start + 2, 'an exact operation reference returns the old receipt without another debit');
        assert.equal(completions, 3, 'the service callback is awaited for the reference resolution too');

        const failure = addDefinition('technique-native-unaffordable', mechanics({
            costs: [{ resource: 'health', amount: 999 }],
            effects: [{ id: 'heal', kind: 'healing', amount: 1 }]
        }));
        learn(player, failure.id);
        const healthBeforeRejectedCall = player.health;
        const rejected = await runtime.executeChatToolCall(toolCall('use-call-unaffordable', 'useTechnique', {
            actor: player.name, techniqueId: failure.id, targetIds: [player.id], intent: 'Attempt an unaffordable technique.', newAttempt: true
        }), { resultCache: cache });
        assert.equal(rejected.metadata.error, true);
        assert.equal(rejected.metadata.code, 'tool_execution_error');
        assert.match(rejected.metadata.message, /Insufficient health/);
        assert.match(rejected.metadata.stack, /Insufficient health/);
        assert.equal(player.health, healthBeforeRejectedCall);
        assert.equal(TechniqueService.getReceipt('native-use-turn:use-call-unaffordable'), null);
    });
});

test('migrated player request reconstructs a committed explicit technique without another effect or cost', async () => {
    const { migrateOperationalIds } = require('../OperationalIdMigration.js');
    await withTechniqueWorld(async ({ player }) => {
        const def = addDefinition('technique-migrated-use', mechanics({ costs: [{ resource: 'health', amount: 1 }], effects: [{ id: 'mend', kind: 'healing', amount: 2 }] }));
        learn(player, def.id);
        player.setHealth(player.health - 5);
        const requestId = 'e581178b-cd44-4f6c-95e2-a9b90266d5dd';
        const first = await TechniqueService.execute({ actor: player, techniqueId: def.id, targetIds: [player.id], intent: 'Mend.', turnId: requestId, operationId: `${requestId}:technique:player` });
        const health = player.health;
        const migrated = migrateOperationalIds({ chatHistory: [{ id: requestId, metadata: { requestId } }], techniques: TechniqueService.toJSON() }).serialized;
        TechniqueService.hydrate(migrated.techniques);
        const mappedRequest = migrated.chatHistory[0].id;
        const replay = resolveTechniqueAttemptIdentity({ actor: player, techniqueId: def.id, targetIds: [player.id], turnId: mappedRequest, operationId: `${mappedRequest}:technique:player` });
        assert.ok(replay?.committed);
        assert.equal(replay.operationId, `${mappedRequest}:technique:player`);
        assert.equal(replay.effects.length, first.effects.length);
        assert.equal(player.health, health);
    });
});

test('standard player action corrects a prose-only escape after rejected discovery in the same tool transcript', async () => {
    await withTechniqueWorld(async ({ player }) => {
        player.setHealth(player.health - 5);
        const startingHealth = player.health;
        const startingMana = player.getNeedBarValue('mana');
        const session = createPlayerTechniqueSession({ resolveActor: byName([player]) });
        const invalid = managedSelfHealingCandidate(player);
        invalid.revisions[0].recipe.resourceProfileId = 'nonexistent-resource';
        const corrected = managedSelfHealingCandidate(player);
        const call = (id, candidate) => toolCall(id, 'useTechnique', {
            actor: player.name,
            targetIds: [player.id],
            intent: 'Restore my wounds with a field technique.',
            discoveryIntent: 'The player demonstrated a restorative practice.',
            disciplineXml: disciplineXml(candidate)
        });
        const sameSchema = getChatToolDefinitions({ allowTechniqueExecution: true });
        const runtime = createRuntime({
            world: { player },
            config: { ai: { max_tool_rounds: 4, retryAttempts: 2 } },
            executeTechnique: async (operation, { operationId }) => {
                const receipt = await TechniqueService.execute({
                    ...operation, actor: player, operationId, turnId: 'standard-integrated-player-action'
                });
                return toResult(receipt);
            },
            responses: [
                completion('', [call('recognized-attempt-invalid', invalid)]),
                completion('I used a field healing technique.', []),
                completion('', [call('corrected-call-id', corrected)]),
                completion('The practiced mend closes the wound.', [])
            ]
        });
        const result = await runtime.runChatCompletionWithToolLoop({
            requestOptions: { messages: [{ role: 'user', content: 'Use a new field technique to heal myself.' }], tools: sameSchema },
            metadataLabel: 'player_action',
            techniqueSession: session
        });

        session.assertComplete();
        assert.equal(runtime.completionOptions.length, 4);
        const transcript = runtime.completionOptions[2].messages.map(message => message.content || '').join('\n');
        assert.match(transcript, /Technique preparation remains unresolved/);
        assert.match(transcript, /same intended attempt/);
        const schemas = runtime.completionOptions.map(options => JSON.stringify(options.tools || options.additionalPayload?.tools || []));
        assert.ok(schemas.every(schema => schema === schemas[0]), 'the same static tool schema is sent through correction retries');
        const failed = result.toolInvocations.filter(invocation => invocation.metadata?.error === true);
        const committed = result.toolInvocations.filter(invocation => invocation.metadata?.techniqueReceipt?.committed === true);
        assert.equal(failed.length, 1);
        assert.equal(committed.length, 1);
        assert.equal(result.response.data.choices[0].message.content, 'The practiced mend closes the wound.');
        assert.equal(player.health, Math.min(player.maxHealth, startingHealth + 24));
        assert.equal(player.getNeedBarValue('mana'), startingMana - 83);
        assert.equal(player.techniques.filter(entry => entry.techniqueId === committed[0].metadata.techniqueReceipt.techniqueId).length, 1);
        assert.equal(TechniqueService.getReceiptsForTurn('standard-integrated-player-action').length, 1);
    }, { includeMana: true });
});

test('known technique attack shim retains its attempt lock after an unaffordable result and terminal prose', async () => {
    await withTechniqueWorld(async ({ player, target }) => {
        const definition = addDefinition('technique-shim-unaffordable', mechanics({
            costs: [{ resource: 'health', amount: 999 }],
            effects: [{ id: 'mend', kind: 'healing', amount: 2 }]
        }));
        learn(player, definition.id);
        const initialHealth = player.health;
        let ordinaryAttackCalls = 0;
        const session = createPlayerTechniqueSession({
            resolveActor: byName([player, target]),
            resolveAttackOperation: (name, args) => name === 'resolveAttack' && args.ability === definition.name
                ? { actor: args.attacker, techniqueId: definition.id, sourceId: `learned:${definition.id}`, targetIds: [player.id], intent: args.intent, newAttempt: true }
                : null
        });
        const attackArgs = {
            attacker: player.name, defender: target.name,
            attackerInfo: { attackSkill: 'Melee Combat', damageAttribute: 'Strength' },
            defenderInfo: { evadeSkill: 'Dodge', deflectSkill: 'N/A' },
            ability: definition.name, weapon: 'N/A',
            circumstanceModifiers: { attackerCircumstanceModifier: [], defenderCircumstanceModifier: [] },
            damageEffectiveness: 3,
            newTechniqueAttempt: true,
            intent: 'Use the practiced healing technique.'
        };
        const call = id => toolCall(id, 'resolveAttack', attackArgs);
        const runtime = createRuntime({
            world: { player },
            config: { ai: { max_tool_rounds: 4, retryAttempts: 1 } },
            executeTechnique: async (operation, { operationId }) => toResult(await TechniqueService.execute({
                ...operation, actor: player, operationId, turnId: 'shim-player-action'
            })),
            resolveAttack: () => { ordinaryAttackCalls += 1; return { success: true, damage: 999 }; },
            responses: [
                completion('', [call('recognized-shim-first')]),
                completion('I use the healing technique.', []),
                completion('', [call('recognized-shim-retry')]),
                completion('The healing works.', [])
            ]
        });
        const requestOptions = {
            messages: [{ role: 'user', content: 'Use the practiced healing technique.' }],
            tools: getChatToolDefinitions({ allowTechniqueExecution: true })
        };
        await assert.rejects(runtime.runChatCompletionWithToolLoop({
            requestOptions, metadataLabel: 'player_action', techniqueSession: session
        }), /insufficient health/i);
        assert.equal(ordinaryAttackCalls, 0, 'a rejected known technique cannot be reinterpreted as ordinary attack damage');
        assert.equal(player.health, initialHealth, 'the rejected attempt did not spend health or apply its effect');
        assert.equal(TechniqueService.getReceiptsForTurn('shim-player-action').length, 0);
    });
});

test('resolveAttack technique receipts await service commit, preserve exact references, and reject an unflagged cache alias', async () => {
    await withTechniqueWorld(async world => {
        const { player, target } = world;
        const def = addDefinition('technique-native-attack', mechanics({
            target: 'single',
            costs: [{ resource: 'health', amount: 1 }],
            effects: [{ id: 'aid', kind: 'healing', amount: 2 }]
        }), { name: 'Steadying Touch' });
        learn(player, def.id);
        player.setHealth(player.health - 6);
        target.setHealth(target.health - 4);
        const start = player.health;
        const targetStart = target.health;
        let resolverCalls = 0;
        const resolveAttack = async ({ attackEntry, techniqueOperationId }) => {
            resolverCalls += 1;
            const actor = byName([player, world.npc, target])(attackEntry.attacker);
            const reference = resolveTechniqueAttemptIdentity({
                actor,
                techniqueId: def.id,
                targetIds: [target.id],
                operationId: attackEntry.techniqueOperationId,
                newAttempt: attackEntry.newTechniqueAttempt,
                turnId: 'native-attack-turn'
            });
            const receipt = reference || await TechniqueService.execute({
                actor, techniqueId: def.id, targetIds: [target.id], intent: attackEntry.intent,
                operationId: techniqueOperationId, turnId: 'native-attack-turn'
            });
            assert.equal(TechniqueService.getReceipt(receipt.operationId)?.committed, true);
            return { techniqueReceipt: receipt };
        };
        const runtime = createRuntime({ world, resolveAttack });
        const cache = runtimeCache('native-attack-turn');
        const args = singleAttackArgs(player, target, def.name);
        const first = await runtime.executeChatToolCall(toolCall('attack-plain-first', 'resolveAttack', args), { resultCache: cache });
        assert.equal(first.metadata.techniqueReceipt.committed, true);
        assert.equal(first.metadata.cached, false);
        assert.equal(player.health, start - 1);
        assert.equal(target.health, targetStart + 2);

        const sameCallRetry = await runtime.executeChatToolCall(toolCall('attack-plain-first', 'resolveAttack', args), { resultCache: cache });
        assert.equal(sameCallRetry.metadata.cached, true);
        assert.equal(sameCallRetry.metadata.techniqueReceipt.operationId, first.metadata.techniqueReceipt.operationId);
        assert.equal(player.health, start - 1);
        assert.equal(target.health, targetStart + 2);

        const aliasCall = await runtime.executeChatToolCall(toolCall('attack-plain-different-id', 'resolveAttack', args), { resultCache: cache });
        assert.equal(aliasCall.metadata.error, true);
        assert.equal(aliasCall.metadata.code, 'technique_attempt_identity_required');
        assert.equal(player.health, start - 1);

        const reference = await runtime.executeChatToolCall(toolCall('attack-reference', 'resolveAttack', {
            ...args, techniqueOperationId: first.metadata.techniqueReceipt.operationId
        }), { resultCache: cache });
        assert.equal(reference.metadata.techniqueReceipt.operationId, first.metadata.techniqueReceipt.operationId);
        assert.equal(player.health, start - 1, 'receipt references do not charge or heal again');
        assert.equal(target.health, targetStart + 2);

        const deliberateArgs = { ...args, newTechniqueAttempt: true, intent: 'Use Steadying Touch again.' };
        const deliberateOne = await runtime.executeChatToolCall(toolCall('attack-deliberate-one', 'resolveAttack', deliberateArgs), { resultCache: cache });
        const deliberateOneRetry = await runtime.executeChatToolCall(toolCall('attack-deliberate-one', 'resolveAttack', deliberateArgs), { resultCache: cache });
        assert.equal(deliberateOneRetry.metadata.cached, true);
        assert.equal(deliberateOneRetry.metadata.techniqueReceipt.operationId, deliberateOne.metadata.techniqueReceipt.operationId);
        assert.notEqual(deliberateOne.metadata.techniqueReceipt.operationId, first.metadata.techniqueReceipt.operationId);
        assert.equal(player.health, start - 2);
        assert.equal(target.health, targetStart + 4);

        const deliberateTwo = await runtime.executeChatToolCall(toolCall('attack-deliberate-two', 'resolveAttack', deliberateArgs), { resultCache: cache });
        assert.notEqual(deliberateTwo.metadata.techniqueReceipt.operationId, deliberateOne.metadata.techniqueReceipt.operationId);
        assert.equal(player.health, start - 3);
        assert.equal(target.health, target.maxHealth, 'the final successful healing attempt remains bounded by the model’s health rules');
        assert.equal(resolverCalls, 4, 'same-call retries and argument-cache aliases never run the resolver twice');
    });
});

test('resolveAreaAttack applies the same exact receipt and deliberate-attempt cache rules', async () => {
    await withTechniqueWorld(async world => {
        const { player, npc, target } = world;
        const def = addDefinition('technique-native-area', mechanics({
            target: 'area',
            check: { kind: 'attack', skill: 'Ranged Combat', attribute: 'Dexterity' },
            costs: [{ resource: 'health', amount: 1 }],
            failureCosts: [{ resource: 'health', amount: 3 }],
            effects: [{ id: 'blast', kind: 'damage', amount: 2, damageMode: 'technique' }]
        }), { name: 'Renewing Wave' });
        learn(player, def.id);
        player.setHealth(player.health - 6);
        npc.setHealth(npc.health - 4);
        target.setHealth(target.health - 4);
        const start = player.health;
        let resolverCalls = 0;
        const sharedRollsByOperation = new Map();
        const resolveAreaAttack = async ({ areaAttackEntry, techniqueOperationId }) => {
            resolverCalls += 1;
            const actor = byName([player, npc, target])(areaAttackEntry.attacker);
            const targetIds = areaAttackEntry.targets.map(entry => byName([player, npc, target])(entry.name).id);
            const reference = resolveTechniqueAttemptIdentity({
                actor, techniqueId: def.id, targetIds,
                operationId: areaAttackEntry.techniqueOperationId,
                newAttempt: areaAttackEntry.newTechniqueAttempt,
                turnId: 'native-area-turn'
            });
            const receipt = reference || await TechniqueService.execute({
                actor,
                techniqueId: def.id,
                targetIds,
                intent: areaAttackEntry.intent,
                operationId: techniqueOperationId,
                turnId: 'native-area-turn',
                assessDamageEffectiveness: async ({ assessments }) => assessments.map(() => 3),
                prepareCheck: async ({ target: checkTarget, sharedAttackRoll }) => {
                    assert.ok(sharedAttackRoll, 'area attack checks receive the server-owned shared die holder');
                    const previous = sharedRollsByOperation.get(techniqueOperationId);
                    if (!previous) {
                        assert.equal(sharedAttackRoll.die, null);
                        sharedAttackRoll.die = 17;
                        sharedRollsByOperation.set(techniqueOperationId, sharedAttackRoll);
                    } else {
                        assert.strictEqual(sharedAttackRoll, previous, 'all area targets reuse one shared die holder');
                        assert.equal(sharedAttackRoll.die, 17);
                    }
                    return { success: checkTarget.id === npc.id, roll: sharedAttackRoll.die };
                }
            });
            assert.equal(TechniqueService.getReceipt(receipt.operationId)?.committed, true);
            return { techniqueReceipt: receipt };
        };
        const runtime = createRuntime({ world, resolveAreaAttack });
        const cache = runtimeCache('native-area-turn');
        const args = areaAttackArgs(player, [npc, target], def.name);
        const first = await runtime.executeChatToolCall(toolCall('area-plain-first', 'resolveAreaAttack', args), { resultCache: cache });
        assert.equal(first.metadata.techniqueReceipt.committed, true);
        assert.equal(first.metadata.techniqueReceipt.success, true);
        assert.equal(first.metadata.techniqueReceipt.costOutcome, 'normal');
        assert.deepEqual(first.metadata.techniqueReceipt.costs.map(cost => cost.amount), [1]);
        assert.deepEqual(first.metadata.techniqueReceipt.effects.map(effect => effect.success), [true, false]);
        assert.equal(player.health, start - 1);
        assert.equal(npc.health, npc.maxHealth - 6);
        assert.equal(target.health, target.maxHealth - 4);
        const sameCallRetry = await runtime.executeChatToolCall(toolCall('area-plain-first', 'resolveAreaAttack', args), { resultCache: cache });
        assert.equal(sameCallRetry.metadata.cached, true);
        assert.equal(player.health, start - 1);

        const aliasCall = await runtime.executeChatToolCall(toolCall('area-plain-alias', 'resolveAreaAttack', args), { resultCache: cache });
        assert.equal(aliasCall.metadata.error, true);
        assert.equal(aliasCall.metadata.code, 'technique_attempt_identity_required');

        const reference = await runtime.executeChatToolCall(toolCall('area-reference', 'resolveAreaAttack', {
            ...args, techniqueOperationId: first.metadata.techniqueReceipt.operationId
        }), { resultCache: cache });
        assert.equal(reference.metadata.techniqueReceipt.operationId, first.metadata.techniqueReceipt.operationId);
        assert.equal(player.health, start - 1);

        const deliberateArgs = { ...args, newTechniqueAttempt: true, intent: 'Renew the whole group again.' };
        const deliberateOne = await runtime.executeChatToolCall(toolCall('area-deliberate-one', 'resolveAreaAttack', deliberateArgs), { resultCache: cache });
        const deliberateOneRetry = await runtime.executeChatToolCall(toolCall('area-deliberate-one', 'resolveAreaAttack', deliberateArgs), { resultCache: cache });
        assert.equal(deliberateOneRetry.metadata.cached, true);
        assert.equal(player.health, start - 2);
        assert.equal(npc.health, npc.maxHealth - 8);
        const deliberateTwo = await runtime.executeChatToolCall(toolCall('area-deliberate-two', 'resolveAreaAttack', deliberateArgs), { resultCache: cache });
        assert.notEqual(deliberateTwo.metadata.techniqueReceipt.operationId, deliberateOne.metadata.techniqueReceipt.operationId);
        assert.equal(player.health, start - 3);
        assert.equal(npc.health, npc.maxHealth - 10);
        assert.equal(target.health, target.maxHealth - 4);
        assert.equal(resolverCalls, 4);
    });
});

test('standard readonly technique detail lookup returns selected facts without committing an action', async () => {
    await withTechniqueWorld(async world => {
        const selected = addDefinition('technique-lookup-selected', mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A ward.', duration: 5, maxHealthPercent: 10 } }] }), { name: 'Focused Ward', description: 'SELECTED_LOOKUP_FACT' });
        const other = addDefinition('technique-lookup-other', mechanics({ effects: [{ id: 'ward', kind: 'buff', status: { name: 'Ward', description: 'A ward.', duration: 5, maxHealthPercent: 10 } }] }), { name: 'Other Ward', description: 'UNSELECTED_LOOKUP_FACT' });
        learn(world.player, selected.id); learn(world.player, other.id);
        const before = TechniqueService.toJSON({ includePresentation: false });
        const runtime = createRuntime({ world });
        const result = await runtime.executeChatToolCall(toolCall('lookup', 'getTechniqueDetails', { actor: world.player.id, technique: selected.id }), { resultCache: runtimeCache('lookup-test') });
        assert.match(result.content, /SELECTED_LOOKUP_FACT/);
        assert.doesNotMatch(result.content, /UNSELECTED_LOOKUP_FACT/);
        assert.equal(result.metadata.readOnly, true);
        assert.deepEqual(TechniqueService.toJSON({ includePresentation: false }), before);
        assert.equal(TINY_BRAIN_LOOKUP_TOOL_NAMES.has('getTechniqueDetails'), false);
        assert.ok(getChatToolDefinitions({ allowTechniqueExecution: true }).some(entry => entry.function.name === 'getTechniqueDetails'));
    });
});

test('standard native tool loop reports ignored disabled technique and continues without an unresolved attempt', async () => {
    await withTechniqueWorld(async world => {
        const { player } = world;
        const definition = addDefinition('native-disabled-technique', mechanics({ costs: [{ resource: 'health', amount: 1 }], effects: [{ id: 'heal', kind: 'healing', amount: 2 }] }));
        learn(player, definition.id);
        player.addStatusEffect({ description: 'Incapacitated', duration: null });
        const before = player.health;
        const fs = require('node:fs');
        const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
        const start = source.indexOf('        async function executeTechniqueOperation(');
        const end = source.indexOf('        async function resolveTechniqueBeforeNarration(', start);
        assert.ok(start >= 0 && end > start);
        const nativeExecute = new Function('TechniqueService', 'resolveTechniqueActor', 'resolveTechniqueAttemptIdentity', 'ignoredTechniqueInvocation', 'receiptInvocation', 'withTechniqueDestinationContext', `${source.slice(start, end)}; return executeTechniqueOperation;`)(
            TechniqueService, () => player, resolveTechniqueAttemptIdentity, require('../TechniquePrompt.js').ignoredTechniqueInvocation, receiptInvocation, value => value
        );
        const session = createPlayerTechniqueSession({ resolveActor: byName([player]) });
        const runtime = createRuntime({ world, executeTechnique: (operation, options) => nativeExecute(operation, { ...options, turnId: 'disabled-standard-turn' }), responses: [
            completion('', [toolCall('disabled-use', 'useTechnique', { actor: player.name, techniqueId: definition.id, targetIds: [player.id], intent: 'Try the technique.' })]),
            completion('Unable to perform it, the player remains still.', [])
        ] });
        const result = await runtime.runChatCompletionWithToolLoop({ requestOptions: { messages: [{ role: 'user', content: 'Try the technique.' }], tools: getChatToolDefinitions({ allowTechniqueExecution: true }) }, metadataLabel: 'player_action', techniqueSession: session });
        session.assertComplete();
        assert.equal(runtime.completionOptions.length, 2);
        assert.match(runtime.completionOptions[1].messages.map(message => message.content || '').join('\n'), /ignored[\s\S]*dead|ignored[\s\S]*disabled/i);
        assert.equal(result.toolInvocations[0].metadata.ignored, true);
        assert.equal(result.toolInvocations[0].metadata.techniqueReceipt, undefined);
        assert.equal(player.health, before);
        assert.equal(TechniqueService.getReceiptsForTurn('disabled-standard-turn').length, 0);
        const cache = runtimeCache('disabled-cache-turn');
        const call = toolCall('same-disabled-use', 'useTechnique', { actor: player.name, techniqueId: definition.id, targetIds: [player.id], intent: 'Try the technique.' });
        const first = await runtime.executeChatToolCall(call, { resultCache: cache });
        const cached = await runtime.executeChatToolCall(call, { resultCache: cache });
        assert.equal(first.metadata.ignored, true);
        assert.equal(cached.metadata.cached, true);
        assert.match(cached.content, /ignored|blocked/i);
        assert.doesNotMatch(cached.content, /already committed/i);
        assert.equal(player.health, before);

    });
});
