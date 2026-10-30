const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SceneSummaries = require('../SceneSummaies.js');
const { findDeletedCoveredSceneSummaryEntryIds } = require('../scene_summary_index.js');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

function registerDeleteRoute({ history, sceneSummaries }) {
    const invalidationStart = apiSource.indexOf('        const invalidateSceneSummariesForDeletedHistoryEntries = (reason) => {');
    const invalidationEnd = apiSource.indexOf('\n        const parseBatchSummaryResponse =', invalidationStart);
    const routeStart = apiSource.indexOf("        app.delete('/api/chat/message', (req, res) => {");
    const routeEnd = apiSource.indexOf('\n        // Player management API endpoints', routeStart);
    assert.ok(invalidationStart >= 0, 'actual scene-summary invalidation helper should exist');
    assert.ok(invalidationEnd > invalidationStart, 'scene-summary invalidation helper boundary should exist');
    assert.ok(routeStart >= 0, 'actual chat message DELETE route should exist');
    assert.ok(routeEnd > routeStart, 'chat message DELETE route boundary should exist');

    const routeSource = apiSource.slice(routeStart, routeEnd);
    const handlers = new Map();
    const app = {
        delete(route, handler) {
            handlers.set(route, handler);
        }
    };
    const context = {
        app,
        chatHistory: history,
        Globals: { getSceneSummaries: () => sceneSummaries },
        findDeletedCoveredSceneSummaryEntryIds,
        console: { warn() {} },
        findChatEntryIndexById(id) {
            return history.findIndex(entry => entry && entry.id === id);
        },
        findChatEntryIndexByTimestamp(timestamp) {
            return history.findIndex(entry => entry && entry.timestamp === timestamp);
        },
        filterHiddenNotesForAdventurePayload: payload => payload
    };

    vm.createContext(context);
    vm.runInContext(
        `${apiSource.slice(invalidationStart, invalidationEnd)}\n${routeSource}`,
        context,
        { filename: 'api.js chat message DELETE route' }
    );
    const handler = handlers.get('/api/chat/message');
    assert.equal(typeof handler, 'function', 'route registration should install a callable handler');
    return handler;
}

function storeSafePrefixAndSuffixCoverage(sceneSummaries, entries, prefixEnd) {
    sceneSummaries.addSummaryResult({
        summarizedRange: { start: 1, end: entries.length },
        entryIndexMap: entries.map((entry, index) => ({ entryId: entry.id, index: index + 1 })),
        scenes: [
            {
                startIndex: 1,
                endIndex: prefixEnd,
                startEntryId: entries[0].id,
                endEntryId: entries[prefixEnd - 1].id,
                summary: 'Safe prefix summary.'
            },
            {
                startIndex: prefixEnd + 1,
                endIndex: entries.length,
                startEntryId: entries[prefixEnd].id,
                endEntryId: entries[entries.length - 1].id,
                summary: 'Summary containing the deleted reply.'
            }
        ]
    });
}

function callDelete(handler, body) {
    let statusCode = 200;
    let payload;
    handler({ body }, {
        status(code) {
            statusCode = code;
            return this;
        },
        json(value) {
            payload = value;
            return value;
        }
    });
    return { statusCode, payload };
}

test('deleting a chat parent detaches WYWA entries and preserves their attached subtrees', () => {
    const history = [
        { id: 'safe-prefix', role: 'assistant', type: 'player-action', content: 'Earlier scene.' },
        { id: 'deleted-parent', role: 'assistant', type: 'player-action', content: 'The deleted reply.' },
        // Deliberately put a grandchild before its parent to exercise iterative cascade ordering.
        { id: 'hidden-grandchild', role: 'system', type: 'quest-offer', parentId: 'hidden-child', content: 'Offer.' },
        { id: 'hidden-child', role: 'system', type: 'event-summary', parentId: 'wywa-hidden', content: 'Hidden update summary.' },
        { id: 'wywa-hidden', role: 'system', type: 'while-you-were-away', parentId: 'deleted-parent', content: 'Private update.' },
        { id: 'visible-child', role: 'assistant', type: 'while-you-were-away-player', parentId: 'deleted-parent', content: 'The player sees the changed room.' },
        { id: 'visible-descendant', role: 'system', type: 'event-summary', parentId: 'visible-child', content: 'Arrival changes.' },
        { id: 'ordinary-child', role: 'system', type: 'tool-call-debug', parentId: 'deleted-parent', content: 'Diagnostic.' },
        { id: 'ordinary-grandchild', role: 'system', type: 'event-summary', parentId: 'ordinary-child', content: 'Attached diagnostic summary.' },
        { id: 'unrelated', role: 'assistant', type: 'user-question', content: 'Unrelated later entry.' }
    ];
    const sceneSummaries = new SceneSummaries();
    storeSafePrefixAndSuffixCoverage(sceneSummaries, history, 1);
    const handler = registerDeleteRoute({ history, sceneSummaries });

    const { statusCode, payload } = callDelete(handler, { id: 'deleted-parent' });

    assert.equal(statusCode, 200);
    assert.equal(payload.removed.id, 'deleted-parent');
    assert.deepEqual(Array.from(payload.orphaned, entry => entry.id).sort(), [
        'ordinary-child',
        'ordinary-grandchild'
    ]);
    assert.deepEqual(history.map(entry => entry.id), [
        'safe-prefix',
        'hidden-grandchild',
        'hidden-child',
        'wywa-hidden',
        'visible-child',
        'visible-descendant',
        'unrelated'
    ]);
    assert.equal(history.find(entry => entry.id === 'wywa-hidden').parentId, undefined);
    assert.equal(history.find(entry => entry.id === 'visible-child').parentId, undefined);
    assert.equal(history.find(entry => entry.id === 'hidden-child').parentId, 'wywa-hidden');
    assert.equal(history.find(entry => entry.id === 'visible-descendant').parentId, 'visible-child');
    assert.deepEqual(
        sceneSummaries.getScenesInOrder().map(scene => ({
            startIndex: scene.startIndex,
            endIndex: scene.endIndex,
            summary: scene.summary
        })),
        [{ startIndex: 1, endIndex: 1, summary: 'Safe prefix summary.' }],
        'deletion invalidates the covered scene suffix and retains safe prefix coverage'
    );
});

test('deleting a WYWA entry directly still removes its attached subtree only', () => {
    const history = [
        { id: 'safe-prefix', role: 'assistant', type: 'player-action', content: 'Keep.' },
        { id: 'hidden', role: 'system', type: 'while-you-were-away', content: 'Private update.' },
        { id: 'hidden-child', role: 'system', type: 'event-summary', parentId: 'hidden', content: 'Attached summary.' },
        { id: 'visible', role: 'assistant', type: 'while-you-were-away-player', content: 'Visible arrival.' },
        { id: 'visible-child', role: 'system', type: 'event-summary', parentId: 'visible', content: 'Attached arrival summary.' },
        { id: 'unrelated', role: 'assistant', type: 'player-action', content: 'Keep too.' }
    ];
    const sceneSummaries = new SceneSummaries();
    const handler = registerDeleteRoute({ history, sceneSummaries });

    const { payload } = callDelete(handler, { id: 'hidden' });

    assert.deepEqual(Array.from(payload.orphaned, entry => entry.id), ['hidden-child']);
    assert.deepEqual(history.map(entry => entry.id), ['safe-prefix', 'visible', 'visible-child', 'unrelated']);

    const visibleDelete = callDelete(handler, { id: 'visible' });
    assert.deepEqual(Array.from(visibleDelete.payload.orphaned, entry => entry.id), ['visible-child']);
    assert.deepEqual(history.map(entry => entry.id), ['safe-prefix', 'unrelated']);
});

test('ordinary parent deletion retains the existing attachment cascade', () => {
    const history = [
        { id: 'parent', role: 'assistant', type: 'player-action', content: 'Delete.' },
        { id: 'child', role: 'system', type: 'event-summary', parentId: 'parent', content: 'Attached.' },
        { id: 'grandchild', role: 'system', type: 'quest-offer', parentId: 'child', content: 'Nested attachment.' },
        { id: 'unrelated', role: 'assistant', type: 'user-question', content: 'Preserve.' }
    ];
    const handler = registerDeleteRoute({ history, sceneSummaries: new SceneSummaries() });

    const { payload } = callDelete(handler, { id: 'parent' });

    assert.deepEqual(Array.from(payload.orphaned, entry => entry.id).sort(), ['child', 'grandchild']);
    assert.deepEqual(history.map(entry => entry.id), ['unrelated']);
});

test('chat deletion accepts timestamp lookup in the real route handler', () => {
    const timestamp = '2026-10-26T12:00:00.000Z';
    const history = [
        { id: 'timestamp-target', timestamp, role: 'assistant', type: 'player-action', content: 'Delete by timestamp.' },
        { id: 'keep', role: 'assistant', type: 'user-question', content: 'Keep.' }
    ];
    const handler = registerDeleteRoute({ history, sceneSummaries: new SceneSummaries() });

    const { statusCode, payload } = callDelete(handler, { timestamp });

    assert.equal(statusCode, 200);
    assert.equal(payload.removed.id, 'timestamp-target');
    assert.deepEqual(history.map(entry => entry.id), ['keep']);
});
