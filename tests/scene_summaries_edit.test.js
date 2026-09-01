const test = require('node:test');
const assert = require('node:assert/strict');

const SceneSummaries = require('../SceneSummaies.js');

function buildSceneSummaries() {
    const sceneSummaries = new SceneSummaries();
    sceneSummaries.addSummaryResult({
        entryIndexMap: [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'entry-2', index: 2 },
            { entryId: 'entry-3', index: 3 }
        ],
        scenes: [
            {
                startIndex: 1,
                endIndex: 2,
                startEntryId: 'entry-1',
                endEntryId: 'entry-2',
                summary: 'The first scene begins.',
                details: ['A first detail.'],
                quotes: [{ character: 'Ari', text: 'We should go.' }]
            },
            {
                startIndex: 3,
                endIndex: 3,
                startEntryId: 'entry-3',
                endEntryId: 'entry-3',
                summary: 'The second scene begins.'
            }
        ]
    });
    return sceneSummaries;
}

test('SceneSummaries updates a scene by display number while preserving its range', () => {
    const sceneSummaries = buildSceneSummaries();

    const updated = sceneSummaries.updateSceneAtDisplayIndex(1, {
        summary: 'The crew revises the first scene.',
        details: ['New beat one.', 'New beat two.'],
        quotes: [{ character: 'Bex', text: 'Keep moving.' }]
    });

    assert.deepEqual(updated, {
        startIndex: 1,
        endIndex: 2,
        startEntryId: 'entry-1',
        endEntryId: 'entry-2',
        summary: 'The crew revises the first scene.',
        details: ['New beat one.', 'New beat two.'],
        quotes: [{ character: 'Bex', text: 'Keep moving.' }]
    });

    const scenes = sceneSummaries.getScenesInOrder();
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].summary, 'The crew revises the first scene.');
    assert.deepEqual(scenes[0].details, ['New beat one.', 'New beat two.']);
    assert.deepEqual(scenes[0].quotes, [{ character: 'Bex', text: 'Keep moving.' }]);
    assert.equal(scenes[0].startIndex, 1);
    assert.equal(scenes[0].endIndex, 2);
    assert.equal(scenes[1].summary, 'The second scene begins.');
});

test('SceneSummaries edit rejects invalid display numbers and empty summaries', () => {
    const sceneSummaries = buildSceneSummaries();

    assert.throws(
        () => sceneSummaries.updateSceneAtDisplayIndex(0, { summary: 'Nope.' }),
        /display number/i
    );
    assert.throws(
        () => sceneSummaries.updateSceneAtDisplayIndex(3, { summary: 'Nope.' }),
        /not found/i
    );
    assert.throws(
        () => sceneSummaries.updateSceneAtDisplayIndex(1, { summary: '   ' }),
        /summary/i
    );
});

test('SceneSummaries anchors generated coverage to the requested summarized range start', () => {
    const sceneSummaries = new SceneSummaries();
    sceneSummaries.addSummaryResult({
        summarizedRange: { start: 1, end: 5 },
        entryIndexMap: [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'entry-2', index: 2 },
            { entryId: 'entry-3', index: 3 },
            { entryId: 'entry-4', index: 4 },
            { entryId: 'entry-5', index: 5 }
        ],
        scenes: [
            {
                startIndex: 2,
                endIndex: 5,
                startEntryId: 'entry-2',
                endEntryId: 'entry-5',
                summary: 'The model skipped the first prompt entry as setup.'
            }
        ]
    });

    const scenes = sceneSummaries.getScenesInOrder();
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].startIndex, 1);
    assert.equal(scenes[0].startEntryId, 'entry-1');
    assert.equal(scenes[0].endIndex, 5);
    assert.equal(sceneSummaries.getFirstUnsummarizedIndex(5), null);
});

test('SceneSummaries rejects discontinuous generated coverage atomically', () => {
    const sceneSummaries = buildSceneSummaries();
    const original = sceneSummaries.serialize();

    assert.throws(
        () => sceneSummaries.addSummaryResult({
            summarizedRange: { start: 4, end: 7 },
            entryIndexMap: [
                { entryId: 'entry-4', index: 4 },
                { entryId: 'entry-5', index: 5 },
                { entryId: 'entry-6', index: 6 },
                { entryId: 'entry-7', index: 7 }
            ],
            scenes: [
                {
                    startIndex: 4,
                    endIndex: 5,
                    startEntryId: 'entry-4',
                    endEntryId: 'entry-5',
                    summary: 'The first generated scene.'
                },
                {
                    startIndex: 7,
                    endIndex: 7,
                    startEntryId: 'entry-7',
                    endEntryId: 'entry-7',
                    summary: 'The generated scene after a gap.'
                }
            ]
        }),
        /continuously cover/i
    );

    assert.deepEqual(sceneSummaries.serialize(), original);
});

test('SceneSummaries rejects a partial stored-scene overlap atomically', () => {
    const sceneSummaries = buildSceneSummaries();
    const original = sceneSummaries.serialize();

    assert.throws(
        () => sceneSummaries.addSummaryResult({
            summarizedRange: { start: 2, end: 3 },
            entryIndexMap: [
                { entryId: 'entry-2', index: 2 },
                { entryId: 'entry-3', index: 3 }
            ],
            scenes: [{
                startIndex: 2,
                endIndex: 3,
                startEntryId: 'entry-2',
                endEntryId: 'entry-3',
                summary: 'A stale narrower replacement.'
            }]
        }),
        /partially overlaps/i
    );

    assert.deepEqual(sceneSummaries.serialize(), original);
});

test('SceneSummaries reports only the contiguous summarized prefix', () => {
    const sceneSummaries = new SceneSummaries();
    sceneSummaries.addSummaryResult({
        entryIndexMap: [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'entry-2', index: 2 },
            { entryId: 'entry-4', index: 4 },
            { entryId: 'entry-5', index: 5 }
        ],
        scenes: [
            {
                startIndex: 1,
                endIndex: 2,
                startEntryId: 'entry-1',
                endEntryId: 'entry-2',
                summary: 'The contiguous opening scene.'
            },
            {
                startIndex: 4,
                endIndex: 5,
                startEntryId: 'entry-4',
                endEntryId: 'entry-5',
                summary: 'A later scene beyond a gap.'
            }
        ]
    });

    assert.equal(sceneSummaries.getContiguousSummarizedEndIndex(), 2);
    assert.equal(sceneSummaries.getFirstUnsummarizedIndex(5), 3);
});

test('SceneSummaries atomically replaces scenes and stale entry mappings', () => {
    const sceneSummaries = buildSceneSummaries();
    const original = sceneSummaries.serialize();

    assert.throws(
        () => sceneSummaries.replaceWithSummaryResult({
            entryIndexMap: [{ entryId: 'replacement-1', index: 1 }],
            scenes: []
        }),
        /must include scenes/i
    );
    assert.deepEqual(sceneSummaries.serialize(), original);

    sceneSummaries.replaceWithSummaryResult({
        summarizedRange: { start: 1, end: 2 },
        entryIndexMap: [
            { entryId: 'replacement-1', index: 1 },
            { entryId: 'replacement-2', index: 2 }
        ],
        scenes: [
            {
                startIndex: 1,
                endIndex: 2,
                startEntryId: 'replacement-1',
                endEntryId: 'replacement-2',
                summary: 'The replacement scene.'
            }
        ]
    });

    assert.deepEqual(
        sceneSummaries.getScenesInOrder().map(scene => scene.summary),
        ['The replacement scene.']
    );
    assert.deepEqual(
        sceneSummaries.serialize().entryIndexMap.map(entry => entry.entryId),
        ['replacement-1', 'replacement-2']
    );
});

test('SceneSummaries replaces every mapping in a regenerated committed range', () => {
    const sceneSummaries = buildSceneSummaries();

    sceneSummaries.addSummaryResult({
        summarizedRange: { start: 1, end: 2 },
        entryIndexMap: [
            { entryId: 'current-1', index: 1 },
            { entryId: 'current-2', index: 2 }
        ],
        scenes: [{
            startIndex: 1,
            endIndex: 2,
            startEntryId: 'current-1',
            endEntryId: 'current-2',
            summary: 'Regenerated opening scene.'
        }]
    });

    assert.deepEqual(
        sceneSummaries.serialize().entryIndexMap.map(({ entryId, index }) => ({ entryId, index })),
        [
            { entryId: 'current-1', index: 1 },
            { entryId: 'current-2', index: 2 },
            { entryId: 'entry-3', index: 3 }
        ]
    );
    assert.equal(sceneSummaries.containsEntry('entry-1'), false);
    assert.equal(sceneSummaries.containsEntry('current-1'), true);
});

test('SceneSummaries hydration removes a stale duplicate mapping without invalidating valid scenes', () => {
    const sceneSummaries = new SceneSummaries();
    const result = sceneSummaries.load({
        scenes: [
            {
                startIndex: 1,
                endIndex: 2,
                startEntryId: 'entry-1',
                endEntryId: 'entry-2',
                summary: 'Existing prefix.'
            },
            {
                startIndex: 3,
                endIndex: 4,
                startEntryId: 'current-3',
                endEntryId: 'current-4',
                summary: 'Incremental suffix.'
            }
        ],
        entryIndexMap: [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'entry-2', index: 2 },
            { entryId: 'deleted-lookahead-3', index: 3 },
            { entryId: 'current-3', index: 3 },
            { entryId: 'current-4', index: 4 }
        ]
    }, {
        authoritativeEntryIndexMap: [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'entry-2', index: 2 },
            { entryId: 'current-3', index: 3 },
            { entryId: 'current-4', index: 4 }
        ]
    });

    assert.equal(result.invalidatedFromIndex, null);
    assert.equal(result.prunedMappingCount, 1);
    assert.deepEqual(
        sceneSummaries.serialize().entryIndexMap.map(({ entryId, index }) => ({ entryId, index })),
        [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'entry-2', index: 2 },
            { entryId: 'current-3', index: 3 },
            { entryId: 'current-4', index: 4 }
        ]
    );
    assert.equal(sceneSummaries.getContiguousSummarizedEndIndex(), 4);
    assert.equal(sceneSummaries.getFirstUnsummarizedIndex(6), 5);
});

test('SceneSummaries hydration preserves the safe prefix after a genuine covered deletion', () => {
    const sceneSummaries = new SceneSummaries();
    const result = sceneSummaries.load({
        scenes: [
            {
                startIndex: 1,
                endIndex: 1,
                startEntryId: 'entry-1',
                endEntryId: 'entry-1',
                summary: 'Safe prefix.'
            },
            {
                startIndex: 2,
                endIndex: 3,
                startEntryId: 'deleted-2',
                endEntryId: 'entry-3',
                summary: 'Scene containing deleted history.'
            }
        ],
        entryIndexMap: [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'deleted-2', index: 2 },
            { entryId: 'entry-3', index: 3 }
        ]
    }, {
        authoritativeEntryIndexMap: [
            { entryId: 'entry-1', index: 1 },
            { entryId: 'entry-3', index: 2 }
        ]
    });

    assert.equal(result.invalidatedFromIndex, 2);
    assert.equal(sceneSummaries.getContiguousSummarizedEndIndex(), 1);
    assert.deepEqual(
        sceneSummaries.getScenesInOrder().map(scene => scene.summary),
        ['Safe prefix.']
    );
    assert.deepEqual(
        sceneSummaries.serialize().entryIndexMap.map(({ entryId, index }) => ({ entryId, index })),
        [{ entryId: 'entry-1', index: 1 }]
    );
});

test('SceneSummaries invalidates only the affected scene and suffix after a covered deletion', () => {
    const sceneSummaries = buildSceneSummaries();

    const invalidation = sceneSummaries.invalidateFromEntryIds(['entry-3']);

    assert.deepEqual(invalidation, {
        invalidatedFromIndex: 3,
        earliestMissingIndex: 3,
        removedSceneCount: 1,
        preservedThroughIndex: 2
    });
    assert.deepEqual(
        sceneSummaries.getScenesInOrder().map(scene => [scene.startIndex, scene.endIndex]),
        [[1, 2]]
    );
    assert.deepEqual(
        sceneSummaries.serialize().entryIndexMap.map(mapping => mapping.index),
        [1, 2]
    );
    assert.equal(sceneSummaries.getFirstUnsummarizedIndex(4), 3);
});
