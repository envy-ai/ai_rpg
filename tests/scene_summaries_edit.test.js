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
