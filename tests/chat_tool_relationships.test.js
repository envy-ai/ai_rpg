const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeCharacter({ id, name, aliases = [], isNPC = true } = {}) {
    return {
        id,
        name,
        aliases,
        isNPC,
        currentLocation: 'loc-1',
        relationships: {},
        setRelationship(target, label) {
            const targetId = typeof target === 'string' ? target : target?.id;
            if (!targetId) {
                throw new Error('Relationship target id is required.');
            }
            const normalizedLabel = String(label || '').trim();
            if (!normalizedLabel) {
                throw new Error('Relationship label is required.');
            }
            if (normalizedLabel.split(/\s+/).length > 6) {
                throw new Error('Relationship labels must be six words or fewer.');
            }
            this.relationships[targetId] = normalizedLabel;
            return normalizedLabel;
        },
        getRelationship(target) {
            const targetId = typeof target === 'string' ? target : target?.id;
            return this.relationships[targetId] || null;
        },
        removeRelationship(target) {
            const targetId = typeof target === 'string' ? target : target?.id;
            if (!targetId) {
                return false;
            }
            const existed = Object.prototype.hasOwnProperty.call(this.relationships, targetId);
            delete this.relationships[targetId];
            return existed;
        }
    };
}

function createRuntime(characters) {
    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 1 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => characters.find(character => character.isNPC === false) || null,
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
        LLMClient: {
            chatCompletion: async () => '',
            logPrompt: () => {},
            formatMessagesForErrorLog: messages => JSON.stringify(messages)
        },
        Player: { getAll: () => characters },
        Thing: { getAll: () => [] },
        Location: {},
        Region: {},
        getGameLocations: () => new Map(),
        getFactions: () => new Map(),
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
}

async function executeTool(runtime, functionName, argumentsObject, options = {}) {
    return runtime.executeChatToolCall({
        id: `call-${functionName}`,
        functionName,
        argumentsObject,
        argumentsText: JSON.stringify(argumentsObject)
    }, options);
}

test('setRelationship tool definition accepts two characters and optional reciprocal label', () => {
    const definition = findToolDefinition('setRelationship');

    assert.ok(definition, 'Expected setRelationship definition.');
    assert.match(definition.description, /Neither character may be the current player\./);
    assert.deepEqual(definition.parameters.required || [], []);
    assert.ok(definition.parameters.properties.characterA);
    assert.ok(definition.parameters.properties.characterB);
    assert.ok(definition.parameters.properties.relationship);
    assert.ok(definition.parameters.properties.reciprocalRelationship);
    assert.equal(definition.parameters.properties.items.type, 'array');
    assert.deepEqual(definition.parameters.properties.items.items.required, ['characterA', 'characterB', 'relationship']);
});

test('setRelationship persists directed and reciprocal NPC relationship labels', async () => {
    const player = makeCharacter({ id: 'player-1', name: 'Ari', isNPC: false });
    const npc = makeCharacter({ id: 'npc-1', name: 'Neka', aliases: ['Patch'] });
    const rival = makeCharacter({ id: 'npc-2', name: 'Mira' });
    const runtime = createRuntime([player, npc, rival]);

    const result = await executeTool(runtime, 'setRelationship', {
        characterA: 'Mira',
        characterB: 'Neka',
        relationship: 'trusted ally from old war days',
        reciprocalRelationship: 'reluctant patron with guarded old debts'
    });

    assert.match(result.content, /<setRelationshipResult>/);
    assert.equal(result.metadata.status, 'success');
    assert.equal(result.metadata.characterA.id, 'npc-2');
    assert.equal(result.metadata.characterB.id, 'npc-1');
    assert.equal(result.metadata.relationship, 'trusted ally from old war days');
    assert.equal(result.metadata.previousRelationship, null);
    assert.equal(result.metadata.relationshipAction, 'added');
    assert.equal(result.metadata.reciprocalRelationship, 'reluctant patron with guarded old debts');
    assert.equal(result.metadata.previousReciprocalRelationship, null);
    assert.equal(result.metadata.reciprocalRelationshipAction, 'added');
    assert.deepEqual(player.relationships, {});
    assert.deepEqual(rival.relationships, { 'npc-1': 'trusted ally from old war days' });
    assert.deepEqual(npc.relationships, { 'npc-2': 'reluctant patron with guarded old debts' });
});

test('setRelationship batch attempts every item and reports per-item failures', async () => {
    const player = makeCharacter({ id: 'player-1', name: 'Ari', isNPC: false });
    const npc = makeCharacter({ id: 'npc-1', name: 'Neka', aliases: ['Patch'] });
    const rival = makeCharacter({ id: 'npc-2', name: 'Mira' });
    const witness = makeCharacter({ id: 'npc-3', name: 'Toma' });
    const runtime = createRuntime([player, npc, rival, witness]);

    const result = await executeTool(runtime, 'setRelationship', {
        items: [
            {
                characterA: 'Mira',
                characterB: 'Neka',
                relationship: 'trusted ally from old war days',
                reciprocalRelationship: 'reluctant patron with guarded debts'
            },
            {
                characterA: 'Ari',
                characterB: 'Toma',
                relationship: 'old rival'
            },
            {
                characterA: 'Toma',
                characterB: 'Mira',
                relationship: 'quiet informant'
            }
        ]
    });

    assert.match(result.content, /<setRelationshipBatchResult>/);
    assert.equal(result.metadata.status, 'partial_success');
    assert.equal(result.metadata.successCount, 2);
    assert.equal(result.metadata.failureCount, 1);
    assert.deepEqual(result.metadata.items.map(entry => entry.status), ['success', 'error', 'success']);
    assert.equal(result.metadata.items[1].code, 'invalid_relationship');
    assert.match(result.metadata.items[1].message, /current player/);
    assert.deepEqual(player.relationships, {});
    assert.deepEqual(rival.relationships, { 'npc-1': 'trusted ally from old war days' });
    assert.deepEqual(npc.relationships, { 'npc-2': 'reluctant patron with guarded debts' });
    assert.deepEqual(witness.relationships, { 'npc-2': 'quiet informant' });
});

test('setRelationship batch returns item errors for ambiguous names and continues', async () => {
    const one = makeCharacter({ id: 'npc-1', name: 'Alex' });
    const two = makeCharacter({ id: 'npc-2', name: 'Alex' });
    const target = makeCharacter({ id: 'npc-3', name: 'Mira' });
    const witness = makeCharacter({ id: 'npc-4', name: 'Toma' });
    const runtime = createRuntime([one, two, target, witness]);

    const result = await executeTool(runtime, 'setRelationship', {
        items: [
            {
                characterA: 'Alex',
                characterB: 'Mira',
                relationship: 'old rival'
            },
            {
                characterA: 'Toma',
                characterB: 'Mira',
                relationship: 'quiet informant'
            }
        ]
    });

    assert.equal(result.metadata.status, 'partial_success');
    assert.equal(result.metadata.successCount, 1);
    assert.equal(result.metadata.failureCount, 1);
    assert.equal(result.metadata.items[0].code, 'ambiguous_character');
    assert.equal(result.metadata.items[0].candidates.length, 2);
    assert.deepEqual(one.relationships, {});
    assert.deepEqual(two.relationships, {});
    assert.deepEqual(witness.relationships, { 'npc-3': 'quiet informant' });
});

test('setRelationship omits reverse edge when reciprocal label is not provided', async () => {
    const player = makeCharacter({ id: 'player-1', name: 'Ari', isNPC: false });
    const npc = makeCharacter({ id: 'npc-1', name: 'Neka' });
    const rival = makeCharacter({ id: 'npc-2', name: 'Mira' });
    const runtime = createRuntime([player, npc, rival]);

    const result = await executeTool(runtime, 'setRelationship', {
        characterA: 'npc-2',
        characterB: 'npc-1',
        relationship: 'old rival'
    });

    assert.equal(result.metadata.status, 'success');
    assert.equal(result.metadata.reciprocalRelationship, null);
    assert.deepEqual(player.relationships, {});
    assert.deepEqual(rival.relationships, { 'npc-1': 'old rival' });
    assert.deepEqual(npc.relationships, {});
});

test('setRelationship metadata reports updated relationship labels', async () => {
    const player = makeCharacter({ id: 'player-1', name: 'Ari', isNPC: false });
    const npc = makeCharacter({ id: 'npc-1', name: 'Neka' });
    const rival = makeCharacter({ id: 'npc-2', name: 'Mira' });
    rival.relationships['npc-1'] = 'old rival';
    npc.relationships['npc-2'] = 'uneasy contact';
    const runtime = createRuntime([player, npc, rival]);

    const result = await executeTool(runtime, 'setRelationship', {
        characterA: 'Mira',
        characterB: 'Neka',
        relationship: 'trusted ally',
        reciprocalRelationship: 'guarded patron'
    });

    assert.equal(result.metadata.status, 'success');
    assert.equal(result.metadata.previousRelationship, 'old rival');
    assert.equal(result.metadata.relationshipAction, 'updated');
    assert.equal(result.metadata.previousReciprocalRelationship, 'uneasy contact');
    assert.equal(result.metadata.reciprocalRelationshipAction, 'updated');
    assert.deepEqual(rival.relationships, { 'npc-1': 'trusted ally' });
    assert.deepEqual(npc.relationships, { 'npc-2': 'guarded patron' });
});

test('setRelationship removes a directed relationship when action is remove', async () => {
    const player = makeCharacter({ id: 'player-1', name: 'Ari', isNPC: false });
    const npc = makeCharacter({ id: 'npc-1', name: 'Neka' });
    const rival = makeCharacter({ id: 'npc-2', name: 'Mira' });
    rival.relationships['npc-1'] = 'old rival';
    npc.relationships['npc-2'] = 'uneasy contact';
    const runtime = createRuntime([player, npc, rival]);

    const result = await executeTool(runtime, 'setRelationship', {
        action: 'remove',
        characterA: 'Mira',
        characterB: 'Neka'
    }, {
        allowRelationshipRemoval: true
    });

    assert.equal(result.metadata.status, 'success');
    assert.equal(result.metadata.previousRelationship, 'old rival');
    assert.equal(result.metadata.relationship, null);
    assert.equal(result.metadata.relationshipAction, 'deleted');
    assert.equal(result.metadata.reciprocalRelationship, null);
    assert.deepEqual(rival.relationships, {});
    assert.deepEqual(npc.relationships, { 'npc-2': 'uneasy contact' });
});

test('setRelationship rejects remove action unless the housekeeping parser allows it', async () => {
    const player = makeCharacter({ id: 'player-1', name: 'Ari', isNPC: false });
    const npc = makeCharacter({ id: 'npc-1', name: 'Neka' });
    const rival = makeCharacter({ id: 'npc-2', name: 'Mira' });
    rival.relationships['npc-1'] = 'old rival';
    const runtime = createRuntime([player, npc, rival]);

    const result = await executeTool(runtime, 'setRelationship', {
        action: 'remove',
        characterA: 'Mira',
        characterB: 'Neka'
    });

    assert.equal(result.metadata.error, true);
    assert.equal(result.metadata.code, 'unsupported_relationship_action');
    assert.deepEqual(rival.relationships, { 'npc-1': 'old rival' });
});

test('setRelationship returns a visible error when characterA is the current player', async () => {
    const player = makeCharacter({ id: 'player-1', name: 'Ari', isNPC: false });
    const npc = makeCharacter({ id: 'npc-1', name: 'Neka' });
    const runtime = createRuntime([player, npc]);

    const result = await executeTool(runtime, 'setRelationship', {
        characterA: 'Ari',
        characterB: 'Neka',
        relationship: 'old rival'
    });

    assert.equal(result.metadata.error, true);
    assert.equal(result.metadata.code, 'invalid_relationship');
    assert.match(result.content, /current player/);
    assert.deepEqual(player.relationships, {});
    assert.deepEqual(npc.relationships, {});
});

test('setRelationship returns a visible error when characterB is the current player', async () => {
    const player = makeCharacter({ id: 'player-1', name: 'Ari', isNPC: false });
    const npc = makeCharacter({ id: 'npc-1', name: 'Neka' });
    const runtime = createRuntime([player, npc]);

    const result = await executeTool(runtime, 'setRelationship', {
        characterA: 'Neka',
        characterB: 'player-1',
        relationship: 'old rival',
        reciprocalRelationship: 'uneasy contact'
    });

    assert.equal(result.metadata.error, true);
    assert.equal(result.metadata.code, 'invalid_relationship');
    assert.match(result.content, /current player/);
    assert.deepEqual(player.relationships, {});
    assert.deepEqual(npc.relationships, {});
});

test('setRelationship returns a visible error for ambiguous character names', async () => {
    const one = makeCharacter({ id: 'npc-1', name: 'Alex' });
    const two = makeCharacter({ id: 'npc-2', name: 'Alex' });
    const target = makeCharacter({ id: 'npc-3', name: 'Mira' });
    const runtime = createRuntime([one, two, target]);

    const result = await executeTool(runtime, 'setRelationship', {
        characterA: 'Alex',
        characterB: 'Mira',
        relationship: 'old rival'
    });

    assert.equal(result.metadata.error, true);
    assert.equal(result.metadata.code, 'ambiguous_character');
    assert.equal(result.metadata.candidates.length, 2);
    assert.deepEqual(one.relationships, {});
    assert.deepEqual(two.relationships, {});
    assert.deepEqual(target.relationships, {});
});
