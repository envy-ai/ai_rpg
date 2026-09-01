const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const SceneSummaries = require('../SceneSummaies.js');

function createEntries(count) {
    return Array.from({ length: count }, (_unused, index) => ({
        id: `entry-${index + 1}`,
        role: 'assistant',
        content: `Entry ${index + 1}`
    }));
}

function addStoredScene(sceneSummaries, startIndex, endIndex, summary = 'Existing summary.') {
    const entryIndexMap = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
        entryIndexMap.push({ entryId: `entry-${index}`, index });
    }
    sceneSummaries.addSummaryResult({
        summarizedRange: { start: startIndex, end: endIndex },
        entryIndexMap,
        scenes: [{
            startIndex,
            endIndex,
            startEntryId: `entry-${startIndex}`,
            endEntryId: `entry-${endIndex}`,
            summary
        }]
    });
}

function loadSummarizer({
    sceneSummaries,
    localSceneStarts,
    onRequest = null,
    useTinyBrain = false,
    onTinyBrainRun = null
}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function summarizeScenesForHistoryRange');
    const end = source.indexOf('Globals.summarizeScenesForHistoryRange = summarizeScenesForHistoryRange;', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate summarizeScenesForHistoryRange in server.js.');
    }

    const context = {
        config: { ai: { tinybrain: useTinyBrain, retryAttempts: 1 } },
        SceneSummaries,
        modExtensionRegistry: {
            collectSceneSummarizeContributions: () => []
        },
        Globals: {
            getSceneSummaries: () => sceneSummaries
        },
        LLMClient: {
            async chatCompletion() {
                if (onRequest) {
                    onRequest();
                }
                return '<scenes></scenes>';
            },
            logPrompt() {}
        },
        hasConfiguredAiBackend: () => true,
        buildSceneSummaryIndex: chatHistory => chatHistory.map((entry, index) => ({
            index: index + 1,
            entryId: entry.id,
            name: 'Storyteller',
            text: entry.content,
            entry
        })),
        resolveSceneSummaryMaxEntries: () => 20,
        isTinyBrainPromptEnabled: () => useTinyBrain,
        configureTinyBrainPromptContext: templateContext => ({
            family: 'scene_summarize',
            programTemplateName: '_includes/scene-summarize.tinybrain.njk',
            renderState: {},
            templateContext
        }),
        runTinyBrainPromptProgram: async options => {
            if (onTinyBrainRun) {
                onTinyBrainRun(options);
            }
            return { aiResponse: '<scenes></scenes>' };
        },
        buildSceneSummaryResult: () => '<scenes></scenes>',
        formatSceneSummaryRangeError: () => 'Invalid scene summary range.',
        promptEnv: {
            render: () => '<template></template>'
        },
        parseXMLTemplate: () => ({
            systemPrompt: 'System prompt.',
            generationPrompt: 'Generation prompt.'
        }),
        parseSceneSummaryResponse: (_responseText, indexMap) => localSceneStarts.map((localIndex, index) => {
            const mapping = indexMap[localIndex - 1];
            return {
                localStartIndex: localIndex,
                startIndex: mapping.globalIndex,
                startEntryId: mapping.entryId,
                summary: `Generated scene ${index + 1}.`,
                details: [],
                quotes: []
            };
        }),
        console: {
            log() {},
            warn() {}
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}\nthis.summarizeScenesForHistoryRange = summarizeScenesForHistoryRange;`,
        context
    );
    return context.summarizeScenesForHistoryRange;
}

test('scene summarization anchors a model scene starting at local entry two to the requested start', async () => {
    const sceneSummaries = new SceneSummaries();
    addStoredScene(sceneSummaries, 1, 2);
    const summarizeScenesForHistoryRange = loadSummarizer({
        sceneSummaries,
        localSceneStarts: [2, 5]
    });

    const result = await summarizeScenesForHistoryRange({
        chatHistory: createEntries(7),
        startIndex: 3,
        endIndex: 7
    });

    assert.deepEqual(
        { ...result.summarizedRange },
        { start: 3, end: 6 }
    );
    assert.equal(result.scenes[0].startIndex, 3);
    assert.equal(result.scenes[0].startEntryId, 'entry-3');
    assert.equal(sceneSummaries.getContiguousSummarizedEndIndex(), 6);
    assert.deepEqual(
        sceneSummaries.serialize().entryIndexMap.map(mapping => mapping.index),
        [1, 2, 3, 4, 5, 6]
    );
});

test('scene summarization uses the staged TinyBrain family when its root family flag is enabled', async () => {
    const sceneSummaries = new SceneSummaries();
    let tinyBrainRun = null;
    const summarizeScenesForHistoryRange = loadSummarizer({
        sceneSummaries,
        localSceneStarts: [1, 5],
        useTinyBrain: true,
        onTinyBrainRun(options) {
            tinyBrainRun = options;
        }
    });

    const result = await summarizeScenesForHistoryRange({
        chatHistory: createEntries(7),
        startIndex: 1,
        endIndex: 7
    });

    assert.ok(tinyBrainRun);
    assert.equal(tinyBrainRun.tinyBrain.family, 'scene_summarize');
    assert.equal(tinyBrainRun.runnerOptions.metadataLabel, 'scene_summarize');
    assert.equal(typeof tinyBrainRun.runnerOptions.resultBuilders.scene_summary_result, 'function');
    assert.deepEqual({ ...result.summarizedRange }, { start: 1, end: 4 });
});

test('scene summary redo uses following context and preserves the old scene on insufficient coverage', async () => {
    const sceneSummaries = new SceneSummaries();
    addStoredScene(sceneSummaries, 1, 5);
    const original = sceneSummaries.serialize();
    let observedStoredSummary = null;
    const summarizeScenesForHistoryRange = loadSummarizer({
        sceneSummaries,
        localSceneStarts: [1, 5],
        onRequest() {
            observedStoredSummary = sceneSummaries.getScenesInOrder()[0]?.summary || null;
        }
    });

    await assert.rejects(
        summarizeScenesForHistoryRange({
            chatHistory: createEntries(10),
            startIndex: 1,
            endIndex: 5,
            redo: true
        }),
        /following-scene boundary/i
    );

    assert.equal(observedStoredSummary, 'Existing summary.');
    assert.deepEqual(sceneSummaries.serialize(), original);
});

test('scene summary redo commits only its original range after reading following context', async () => {
    const sceneSummaries = new SceneSummaries();
    addStoredScene(sceneSummaries, 1, 5);
    addStoredScene(sceneSummaries, 6, 10, 'Following stored scene.');
    const summarizeScenesForHistoryRange = loadSummarizer({
        sceneSummaries,
        localSceneStarts: [1, 6]
    });

    const result = await summarizeScenesForHistoryRange({
        chatHistory: createEntries(10),
        startIndex: 1,
        endIndex: 5,
        redo: true
    });

    assert.deepEqual(
        { ...result.range },
        { start: 1, end: 10 }
    );
    assert.deepEqual(
        { ...result.summarizedRange },
        { start: 1, end: 5 }
    );
    assert.deepEqual(
        sceneSummaries.getScenesInOrder().map(scene => ({
            start: scene.startIndex,
            end: scene.endIndex,
            summary: scene.summary
        })),
        [
            { start: 1, end: 5, summary: 'Generated scene 1.' },
            { start: 6, end: 10, summary: 'Following stored scene.' }
        ]
    );
});
