const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');

function findToolDefinition(name) {
    return CHAT_TOOL_DEFINITIONS.find(entry => entry?.function?.name === name)?.function || null;
}

function makeLocation(id, name) {
    const npcIds = new Set();
    return {
        id,
        name,
        addNpcId(npcId) {
            npcIds.add(npcId);
        },
        removeNpcId(npcId) {
            npcIds.delete(npcId);
        },
        hasNpc(npcId) {
            return npcIds.has(npcId);
        }
    };
}

function makeCharacter({ id, name, location = null, aliases = [], isNPC = true }, locations) {
    return {
        id,
        name,
        isNPC,
        aliases,
        currentLocation: location?.id || null,
        getAliases() {
            return Array.from(this.aliases);
        },
        get currentLocationObject() {
            return locations.get(this.currentLocation) || null;
        },
        setLocation(nextLocation) {
            this.currentLocation = typeof nextLocation === 'object'
                ? (nextLocation?.id || null)
                : (nextLocation || null);
            return this.currentLocation;
        }
    };
}

function makeRuntime({ toolArgs, characters, currentPlayer, locations }) {
    let completionCalls = 0;
    const LLMClient = {
        async chatCompletion(options) {
            completionCalls += 1;
            if (completionCalls === 1) {
                options.onResponse?.({
                    data: {
                        choices: [{
                            message: {
                                content: '',
                                tool_calls: [{
                                    id: 'call-update-party',
                                    type: 'function',
                                    function: {
                                        name: 'updatePartyMembers',
                                        arguments: JSON.stringify(toolArgs)
                                    }
                                }]
                            }
                        }]
                    }
                });
                return '';
            }

            options.onResponse?.({
                data: {
                    choices: [{
                        message: {
                            content: 'Party updated.',
                            tool_calls: []
                        }
                    }]
                }
            });
            return 'Party updated.';
        },
        logPrompt() {},
        formatMessagesForErrorLog(messages) {
            return JSON.stringify(messages);
        }
    };

    return createChatToolRuntime({
        getConfig: () => ({ ai: { max_tool_rounds: 3 } }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: value => value,
        buildLocationResponse: value => value,
        getCurrentPlayer: () => currentPlayer,
        createLocationFromEvent: async () => {
            throw new Error('createLocationFromEvent should not be reached for this test.');
        },
        createRegionStubFromEvent: async () => {
            throw new Error('createRegionStubFromEvent should not be reached for this test.');
        },
        generateItemsByNames: async () => [],
        ensureExitConnection: async () => ({}),
        findRegionByLocationId: () => null,
        LLMClient,
        Player: { getAll: () => characters },
        Thing: { getAll: () => [] },
        Location: {
            get: id => locations.get(id) || null,
            getAll: () => Array.from(locations.values())
        },
        Region: { getAll: () => [] },
        getGameLocations: () => locations,
        getFactions: () => new Map(),
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });
}

function makePartyFixture() {
    const origin = makeLocation('loc-origin', 'Camp');
    const remote = makeLocation('loc-remote', 'Distant Tower');
    const other = makeLocation('loc-other', 'Dockyard');
    const locations = new Map([
        [origin.id, origin],
        [remote.id, remote],
        [other.id, other]
    ]);

    const remoteRecruit = makeCharacter({
        id: 'npc-remote',
        name: 'Rhea',
        aliases: ['tower scout'],
        location: remote
    }, locations);
    const localRecruit = makeCharacter({
        id: 'npc-local',
        name: 'Maro',
        location: origin
    }, locations);
    const leavingMember = makeCharacter({
        id: 'npc-leaving',
        name: 'Jun',
        location: null
    }, locations);
    leavingMember.isInPlayerParty = true;
    const nonPartyNpc = makeCharacter({
        id: 'npc-nonparty',
        name: 'Pax',
        location: other
    }, locations);

    origin.addNpcId(localRecruit.id);
    remote.addNpcId(remoteRecruit.id);
    other.addNpcId(nonPartyNpc.id);

    const partyIds = new Set([leavingMember.id]);
    const characters = [remoteRecruit, localRecruit, leavingMember, nonPartyNpc];
    const currentPlayer = {
        id: 'player-1',
        name: 'Player',
        currentLocation: origin.id,
        get currentLocationObject() {
            return origin;
        },
        getPartyMembers() {
            return Array.from(partyIds);
        },
        addPartyMember(memberId) {
            if (partyIds.has(memberId)) {
                return false;
            }
            const member = characters.find(character => character.id === memberId);
            partyIds.add(memberId);
            member.isInPlayerParty = true;
            for (const location of locations.values()) {
                location.removeNpcId(memberId);
            }
            member.setLocation(null);
            return true;
        },
        removePartyMember(memberId) {
            if (!partyIds.has(memberId)) {
                return false;
            }
            const member = characters.find(character => character.id === memberId);
            partyIds.delete(memberId);
            member.isInPlayerParty = false;
            member.setLocation(origin);
            origin.addNpcId(memberId);
            return true;
        }
    };

    return {
        currentPlayer,
        locations,
        characters,
        origin,
        remote,
        localRecruit,
        remoteRecruit,
        leavingMember,
        nonPartyNpc
    };
}

test('updatePartyMembers tool schema accepts add and remove arrays', () => {
    const definition = findToolDefinition('updatePartyMembers');

    assert.ok(definition, 'Expected updatePartyMembers chat tool definition.');
    assert.match(definition.description, /party/i);
    assert.deepEqual(Object.keys(definition.parameters.properties).sort(), ['add', 'remove']);
    assert.equal(definition.parameters.properties.add.type, 'array');
    assert.equal(definition.parameters.properties.remove.type, 'array');
    assert.equal(definition.parameters.additionalProperties, false);
});

test('updatePartyMembers adds remote characters and removes members to the current location', async () => {
    const fixture = makePartyFixture();
    const runtime = makeRuntime({
        toolArgs: {
            add: ['tower scout', 'Maro'],
            remove: ['Jun']
        },
        characters: fixture.characters,
        currentPlayer: fixture.currentPlayer,
        locations: fixture.locations
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: '@Update the party.' }],
            tools: CHAT_TOOL_DEFINITIONS
        },
        metadataLabel: 'test_update_party_members_tool'
    });

    assert.equal(result.rounds, 2);
    assert.equal(result.toolInvocations[0].metadata.status, 'success');
    assert.deepEqual(result.toolInvocations[0].metadata.added.map(entry => entry.id).sort(), ['npc-local', 'npc-remote']);
    assert.deepEqual(result.toolInvocations[0].metadata.removed.map(entry => entry.id), ['npc-leaving']);
    assert.deepEqual(fixture.currentPlayer.getPartyMembers().sort(), ['npc-local', 'npc-remote']);

    assert.equal(fixture.remoteRecruit.currentLocation, null);
    assert.equal(fixture.remote.hasNpc(fixture.remoteRecruit.id), false);
    assert.equal(fixture.localRecruit.currentLocation, null);
    assert.equal(fixture.origin.hasNpc(fixture.localRecruit.id), false);

    assert.equal(fixture.leavingMember.currentLocation, fixture.origin.id);
    assert.equal(fixture.origin.hasNpc(fixture.leavingMember.id), true);
});

test('updatePartyMembers rejects invalid requests before mutating party membership', async () => {
    const fixture = makePartyFixture();
    const runtime = makeRuntime({
        toolArgs: {
            add: ['Rhea'],
            remove: ['Pax']
        },
        characters: fixture.characters,
        currentPlayer: fixture.currentPlayer,
        locations: fixture.locations
    });

    const result = await runtime.runChatCompletionWithToolLoop({
        requestOptions: {
            messages: [{ role: 'user', content: '@Update the party.' }],
            tools: CHAT_TOOL_DEFINITIONS
        },
        metadataLabel: 'test_update_party_members_tool_reject'
    });

    assert.equal(result.toolInvocations[0].metadata.error, true);
    assert.equal(result.toolInvocations[0].metadata.code, 'not_in_party');
    assert.deepEqual(fixture.currentPlayer.getPartyMembers(), ['npc-leaving']);
    assert.equal(fixture.remoteRecruit.currentLocation, fixture.remote.id);
    assert.equal(fixture.remote.hasNpc(fixture.remoteRecruit.id), true);
});
