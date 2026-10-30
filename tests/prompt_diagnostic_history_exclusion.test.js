const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
    filterPromptHistoryEntries,
    shouldExcludeEntryFromPromptHistory
} = require('../base_context_history.js');
const {
    buildBaseRenderContext,
    createPromptEnv
} = require('./helpers/baseContextFixtures.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({ prefix: 'ai-rpg-prompt-history-exclusion-' }, run);
}

function makeStoryHistory(count = 11) {
    return Array.from({ length: count }, (_unused, index) => ({
        id: `memory-story-${index}`,
        role: index % 2 ? 'user' : 'assistant',
        type: index % 2 ? 'player-action' : 'npc-action',
        content: `MEMORY_STORY_${index}`,
        metadata: { npcNames: ['Mira'] }
    }));
}

function makeDiagnosticHistory() {
    return [
        { id: 'diagnostic-type', role: 'assistant', type: 'tool-call-debug', content: 'DEBUG_TYPE_SENTINEL', metadata: { npcNames: ['Mira'] } },
        { id: 'diagnostic-meta', role: 'assistant', type: 'player-action', content: 'DEBUG_META_SENTINEL', metadata: { npcNames: ['Mira'], debugToolCalls: true } },
        { id: 'diagnostic-structured', role: 'assistant', content: 'DEBUG_STRUCTURED_SENTINEL', metadata: { npcNames: ['Mira'] }, toolCalls: [{ name: 'updateObjectFields' }] },
        { id: 'diagnostic-legacy', role: 'assistant', content: 'Tool call debug: 1 call\nDEBUG_LEGACY_SENTINEL', metadata: { npcNames: ['Mira'] } },
        { id: 'check-type', role: 'assistant', type: 'check-results', content: 'CHECK_TYPE_SENTINEL', metadata: { npcNames: ['Mira'] } },
        { id: 'check-meta', role: 'assistant', content: 'CHECK_META_SENTINEL', metadata: { npcNames: ['Mira'], checkResults: true } },
        { id: 'check-structured', role: 'assistant', content: 'CHECK_STRUCTURED_SENTINEL', metadata: { npcNames: ['Mira'] }, checkResults: [{ result: 'failed' }] },
        { id: 'check-legacy', role: 'assistant', content: 'Checks: 1 check\nCHECK_LEGACY_SENTINEL', metadata: { npcNames: ['Mira'] } },
        { id: 'ephemeral', role: 'assistant', content: 'EPHEMERAL_SENTINEL', metadata: { npcNames: ['Mira'] }, ephemeral: true }
    ];
}

function renderNpcMemory(entries) {
    const context = buildBaseRenderContext({
        overrides: {
            promptType: 'npc-memories',
            dispositionTypes: [],
            currentNpc: {
                id: 'npc_mira',
                name: 'Mira',
                description: 'Mira is a scout.',
                class: 'ranger',
                race: 'human',
                disposition: null,
                personality: { type: '', traits: '', goals: [], notes: '', aiNotes: '' },
                aiNotes: '',
                health: 10,
                maxHealth: 10,
                dispositionsTowardsPlayer: [],
                importantMemories: [],
                inventory: [],
                skills: [],
                abilities: [],
                statusEffects: [],
                needBars: []
            },
            historyEntries: entries
        }
    });
    return createPromptEnv().render('base-context.xml.njk', context);
}

function assertHistoryWindowHasOnlyNewestTenStoryEntries(rendered) {
    const history = rendered.match(/<recentNpcHistory>([\s\S]*?)<\/recentNpcHistory>/)?.[1] || '';
    assert.equal((history.match(/<historyEntry>/g) || []).length, 10);
    for (const sentinel of [
        'DEBUG_TYPE_SENTINEL', 'DEBUG_META_SENTINEL', 'DEBUG_STRUCTURED_SENTINEL', 'DEBUG_LEGACY_SENTINEL',
        'CHECK_TYPE_SENTINEL', 'CHECK_META_SENTINEL', 'CHECK_STRUCTURED_SENTINEL', 'CHECK_LEGACY_SENTINEL',
        'EPHEMERAL_SENTINEL', 'MEMORY_STORY_0'
    ]) {
        assert.equal(history.includes(sentinel), false, `${sentinel} must not appear in the ten-entry prompt window`);
    }
    for (let index = 1; index <= 10; index += 1) {
        assert.ok(history.includes(`MEMORY_STORY_${index}`), `story entry ${index} should fill the recent prompt window`);
    }
}

test('shared NPC memory history policy removes diagnostics before the real template selects its ten-entry window', () => {
    const raw = [...makeStoryHistory(), ...makeDiagnosticHistory()];
    const snapshot = structuredClone(raw);
    const safePromptHistory = filterPromptHistoryEntries(raw);

    assertHistoryWindowHasOnlyNewestTenStoryEntries(renderNpcMemory(safePromptHistory));
    assert.deepEqual(raw, snapshot, 'prompt projection leaves raw chat history untouched');
});

test('prompt history projection requires an array and returns a detached safe list without rewriting rows', () => {
    const raw = [...makeStoryHistory(2), ...makeDiagnosticHistory()];
    const snapshot = structuredClone(raw);
    const filtered = filterPromptHistoryEntries(raw);

    assert.notEqual(filtered, raw);
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0], raw[0], 'projection keeps story rows intact without lossy mapping');
    assert.deepEqual(raw, snapshot);
    assert.throws(() => filterPromptHistoryEntries(null), /requires an array/);
});

test('persisted party memory segments filter diagnostics at read time without rewriting saved rows', () => {
    withTempPlayerEnvironment(() => {
        const persistedSegment = [...makeStoryHistory(), ...makeDiagnosticHistory()];
        const saved = {
            id: 'mira-party-memory',
            name: 'Mira',
            isNPC: true,
            partyMemoryHistorySegments: [persistedSegment]
        };
        const npc = Player.fromJSON(structuredClone(saved));
        const hydratedRawBuffer = structuredClone(npc.toJSON().partyMemoryHistorySegments);
        assert.equal(hydratedRawBuffer[0].some(entry => entry.type === 'tool-call-debug'), true, 'hydration retains saved diagnostic provenance in the backing buffer');

        const promptSegments = npc.getPartyMemoryHistorySegments();
        assert.equal(promptSegments.length, 1);
        assertHistoryWindowHasOnlyNewestTenStoryEntries(renderNpcMemory(promptSegments.flat()));
        assert.deepEqual(npc.toJSON().partyMemoryHistorySegments, hydratedRawBuffer, 'prompt reads must not mutate the hydrated backing buffer');

        const newSegment = [...makeStoryHistory(2), ...makeDiagnosticHistory()];
        npc.addPartyMemoryHistorySegment(newSegment);
        const savedAfterAppend = npc.toJSON().partyMemoryHistorySegments;
        assert.equal(savedAfterAppend.at(-1).some(entry => entry.id === 'diagnostic-type'), false, 'new memory segments never persist diagnostic rows');
        assert.equal(savedAfterAppend.at(-1).some(entry => entry.id === 'memory-story-1'), true);
        assert.deepEqual(savedAfterAppend[0], hydratedRawBuffer[0], 'old persisted rows remain unchanged after appending a new segment');

        const limited = Player.fromJSON({
            id: 'mira-party-memory-window',
            name: 'Mira Window',
            isNPC: true,
            partyMemoryHistorySegments: [makeStoryHistory(1), makeDiagnosticHistory()]
        });
        assert.deepEqual(
            limited.getPartyMemoryHistorySegments(1).map(segment => segment.map(entry => entry.id)),
            [['memory-story-0']],
            'an all-diagnostic legacy segment does not consume or evict the eligible story segment window'
        );
    });
});

