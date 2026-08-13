const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const { createChatToolRuntime } = require('../chat_tool_calls.js');
const { buildHousekeepingUpdateLogEntries } = require('../housekeeping_update_log.js');
const { shouldIncludeEntryInBaseContextHistory } = require('../base_context_history.js');

function makeCharacter({ id, name, isNPC = true } = {}) {
    return {
        id,
        name,
        aliases: [],
        isNPC,
        currentLocation: 'loc_marker',
        relationships: {},
        setRelationship(target, label) {
            const targetId = typeof target === 'string' ? target : target?.id;
            const normalized = String(label || '').trim();
            if (!targetId || !normalized) {
                throw new Error('Relationship target and label are required.');
            }
            this.relationships[targetId] = normalized;
            return normalized;
        },
        getRelationship(target) {
            const targetId = typeof target === 'string' ? target : target?.id;
            return this.relationships[targetId] || null;
        },
        removeRelationship(target) {
            const targetId = typeof target === 'string' ? target : target?.id;
            const existed = Object.prototype.hasOwnProperty.call(this.relationships, targetId);
            delete this.relationships[targetId];
            return existed;
        }
    };
}

function createRelationshipRuntime(characters) {
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

test('REL-7 housekeeping add, update, and remove execute in order and stay out of future prompt history', async () => {
    const player = makeCharacter({ id: 'player_baato', name: 'Baato', isNPC: false });
    const lantern = makeCharacter({ id: 'npc_lantern', name: 'QA Lantern Witness' });
    const cinder = makeCharacter({ id: 'npc_cinder', name: 'QA Cinder Witness' });
    const runtime = createRelationshipRuntime([player, lantern, cinder]);

    const applied = await Events._applyHousekeepingXmlResponse(`
<housekeeping>
  <relationships>
    <relationship>
      <action>add</action>
      <characterA>QA Lantern Witness</characterA>
      <characterB>QA Cinder Witness</characterB>
      <relationshipLabel>cautious colleague</relationshipLabel>
    </relationship>
    <relationship>
      <action>update</action>
      <characterA>QA Lantern Witness</characterA>
      <characterB>QA Cinder Witness</characterB>
      <relationshipLabel>trusted colleague</relationshipLabel>
    </relationship>
    <relationship>
      <action>remove</action>
      <characterA>QA Lantern Witness</characterA>
      <characterB>QA Cinder Witness</characterB>
    </relationship>
  </relationships>
</housekeeping>`, {
        executeChatToolCall: (toolCall, options) => runtime.executeChatToolCall(toolCall, options)
    });

    assert.deepEqual(lantern.relationships, {});
    assert.deepEqual(cinder.relationships, {});
    assert.equal(applied.toolInvocations.length, 1);
    assert.equal(applied.toolInvocations[0].name, 'setRelationship');
    assert.equal(applied.toolInvocations[0].metadata.status, 'success');
    assert.deepEqual(
        applied.toolInvocations[0].metadata.items.map(item => item.relationshipAction),
        ['added', 'updated', 'deleted']
    );

    const logEntries = buildHousekeepingUpdateLogEntries(applied.toolInvocations, {
        locationId: 'loc_marker',
        requestId: 'rel7-request'
    });
    assert.equal(logEntries.length, 1);

    const relationshipEntry = logEntries[0];
    assert.equal(relationshipEntry.type, 'relationship-updates');
    assert.equal(relationshipEntry.metadata.excludeFromBaseContextHistory, true);
    assert.deepEqual(
        relationshipEntry.metadata.relationshipUpdates.map(update => update.action),
        ['added', 'updated', 'deleted']
    );
    assert.match(relationshipEntry.content, /Added \*\*QA Lantern Witness\*\* -> \*\*QA Cinder Witness\*\*: cautious colleague/);
    assert.match(relationshipEntry.content, /Updated \*\*QA Lantern Witness\*\* -> \*\*QA Cinder Witness\*\*: trusted colleague/);
    assert.match(relationshipEntry.content, /Deleted \*\*QA Lantern Witness\*\* -> \*\*QA Cinder Witness\*\*/);
    assert.equal(shouldIncludeEntryInBaseContextHistory(relationshipEntry, {
        hasRenderableContent: true
    }), false);
    assert.equal(shouldIncludeEntryInBaseContextHistory(relationshipEntry, {
        includeAllEntryTypes: true,
        hasRenderableContent: true
    }), false);
});
