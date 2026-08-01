const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const {
    resolveBatchedRecentHistoryTurnCount,
    resolveRecentHistoryBatchInterval,
    shouldIncludeEntryInBaseContextHistory
} = require('../base_context_history.js');

test('recent history grows between deterministic batch rollovers', () => {
    const options = {
        minimumRecentTurns: 10,
        batchInterval: 10
    };

    assert.equal(resolveBatchedRecentHistoryTurnCount({ ...options, totalTurns: 9 }), 9);
    assert.equal(resolveBatchedRecentHistoryTurnCount({ ...options, totalTurns: 10 }), 10);
    assert.equal(resolveBatchedRecentHistoryTurnCount({ ...options, totalTurns: 11 }), 11);
    assert.equal(resolveBatchedRecentHistoryTurnCount({ ...options, totalTurns: 19 }), 19);
    assert.equal(resolveBatchedRecentHistoryTurnCount({ ...options, totalTurns: 20 }), 10);
    assert.equal(resolveBatchedRecentHistoryTurnCount({ ...options, totalTurns: 21 }), 11);
    assert.equal(resolveBatchedRecentHistoryTurnCount({ ...options, totalTurns: 29 }), 19);
    assert.equal(resolveBatchedRecentHistoryTurnCount({ ...options, totalTurns: 30 }), 10);
});

test('recent-history batch interval one preserves per-turn rollover', () => {
    assert.equal(resolveBatchedRecentHistoryTurnCount({
        totalTurns: 27,
        minimumRecentTurns: 10,
        batchInterval: 1
    }), 10);
});

test('recent-history batch interval resolves defaults and rejects invalid config', () => {
    assert.equal(resolveRecentHistoryBatchInterval(undefined), 10);
    assert.equal(resolveRecentHistoryBatchInterval(null), 10);
    assert.equal(resolveRecentHistoryBatchInterval(''), 10);
    assert.equal(resolveRecentHistoryBatchInterval('4'), 4);
    assert.equal(resolveRecentHistoryBatchInterval(1), 1);

    for (const value of [0, -1, 1.5, 'later']) {
        assert.throws(
            () => resolveRecentHistoryBatchInterval(value),
            /recent_history_batch_interval must be an integer greater than or equal to 1/
        );
    }
});

test('recent-history batch settings reject invalid values', () => {
    assert.throws(
        () => resolveBatchedRecentHistoryTurnCount({
            totalTurns: -1,
            minimumRecentTurns: 10,
            batchInterval: 10
        }),
        /total.*non-negative integer/i
    );
    assert.throws(
        () => resolveBatchedRecentHistoryTurnCount({
            totalTurns: 10,
            minimumRecentTurns: -1,
            batchInterval: 10
        }),
        /minimum recent.*non-negative integer/i
    );
    assert.throws(
        () => resolveBatchedRecentHistoryTurnCount({
            totalTurns: 10,
            minimumRecentTurns: 5,
            batchInterval: 0
        }),
        /batch interval.*greater than or equal to 1/i
    );
});

test('base-context history includes prompt-excluded log entries only when all entry types are requested', () => {
    const hiddenGenericEntry = {
        type: 'generic-prompt-response',
        role: 'assistant',
        content: 'Prior generic prompt response.',
        metadata: {
            excludeFromBaseContextHistory: true
        }
    };

    assert.equal(
        shouldIncludeEntryInBaseContextHistory(hiddenGenericEntry, {
            hasRenderableContent: true
        }),
        false
    );
    assert.equal(
        shouldIncludeEntryInBaseContextHistory(hiddenGenericEntry, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        true
    );
});

test('base-context history all-entry mode includes status and level-up entries with renderable text', () => {
    assert.equal(
        shouldIncludeEntryInBaseContextHistory({
            type: 'status-summary',
            role: 'assistant',
            content: 'Status changed.'
        }, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        true
    );
    assert.equal(
        shouldIncludeEntryInBaseContextHistory({
            type: 'level-up',
            role: 'assistant',
            content: 'Level up.'
        }, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        true
    );
    assert.equal(
        shouldIncludeEntryInBaseContextHistory({
            type: 'tool-call-debug',
            role: 'system',
            content: ''
        }, {
            includeAllEntryTypes: true,
            hasRenderableContent: false
        }),
        false
    );
});

test('base-context history all-entry mode excludes system and diagnostic entries', () => {
    const entries = [
        {
            type: 'tool-call-debug',
            role: 'system',
            content: 'Tool calls for player_action\n\n1. resolveSkillCheck\nStatus: completed',
            summary: 'Tool call debug: 1 call, 1 complete, 0 errors.'
        },
        {
            type: 'check-results',
            role: 'assistant',
            content: 'Checks for player_action\n\n1. Test: Success',
            summary: 'Checks: 1 check, 1 complete, 0 errors.'
        },
        {
            role: 'system',
            content: 'Time-based effects adjusted needs for 3 actors.'
        }
    ];

    for (const entry of entries) {
        assert.equal(
            shouldIncludeEntryInBaseContextHistory(entry, {
                includeAllEntryTypes: true,
                hasRenderableContent: true
            }),
            false
        );
    }

    assert.equal(
        shouldIncludeEntryInBaseContextHistory({
            type: 'generic-prompt-response',
            role: 'assistant',
            content: 'Prior generic prompt response.',
            metadata: {
                excludeFromBaseContextHistory: true
            }
        }, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        true
    );
});

test('game improvement suggestions are excluded even in all-entry mode', () => {
    const entry = {
        type: 'game-improvement-suggestions',
        role: 'assistant',
        content: 'Game improvement suggestions\n\n- Add better travel planning.'
    };

    assert.equal(
        shouldIncludeEntryInBaseContextHistory(entry, {
            hasRenderableContent: true
        }),
        false
    );
    assert.equal(
        shouldIncludeEntryInBaseContextHistory(entry, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        false
    );
});

test('tonal scale evaluation entries are excluded even in all-entry mode', () => {
    const entry = {
        type: 'tonal-scale-evaluation',
        role: 'assistant',
        content: 'Tonal scale evaluation\n\nIdealism:\n  Current State: Hope is fragile.'
    };

    assert.equal(
        shouldIncludeEntryInBaseContextHistory(entry, {
            hasRenderableContent: true
        }),
        false
    );
    assert.equal(
        shouldIncludeEntryInBaseContextHistory(entry, {
            includeAllEntryTypes: true,
            hasRenderableContent: true
        }),
        false
    );
});

test('housekeeping tracker and relationship update entries are excluded even in all-entry mode', () => {
    const entries = [
        {
            type: 'tracker-updates',
            role: 'assistant',
            content: '## Tracker Updates\n\n- Added **Gate Stability**: 60%'
        },
        {
            type: 'relationship-updates',
            role: 'assistant',
            content: '## Relationship Updates\n\n- Added **Mira** -> **Neka**: trusted ally'
        }
    ];

    for (const entry of entries) {
        assert.equal(
            shouldIncludeEntryInBaseContextHistory(entry, {
                hasRenderableContent: true
            }),
            false
        );
        assert.equal(
            shouldIncludeEntryInBaseContextHistory(entry, {
                includeAllEntryTypes: true,
                hasRenderableContent: true
            }),
            false
        );
    }
});

test('generic prompt route requests full-entry-type base context while no-context prompt stays isolated', () => {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    assert.match(
        source,
        /prepareBasePromptContext\(\{\s*locationOverride:\s*location,\s*includeAllHistoryEntryTypes:\s*isGenericPromptAction\s*&&\s*!isNoContextPromptAction\s*\}\)/
    );
});
