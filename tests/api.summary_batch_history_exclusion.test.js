const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DOMParser } = require('@xmldom/xmldom');

const Utils = require('../Utils.js');
const { filterPromptHistoryEntries } = require('../base_context_history.js');

const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');

function loadRunSummaryBatch(dependencies) {
    const parserStart = apiSource.indexOf('        const parseBatchSummaryResponse = (xmlContent, expectedCount) => {');
    const runnerStart = apiSource.indexOf('        const runSummaryBatch = async (batch, { wordLength }) => {', parserStart);
    const runnerEnd = apiSource.indexOf('\n\n        let summaryQueueProcessing', runnerStart);
    assert.notEqual(parserStart, -1, 'Could not locate the production batch summary parser.');
    assert.notEqual(runnerStart, -1, 'Could not locate the production summary batch runner.');
    assert.notEqual(runnerEnd, -1, 'Could not locate the end of the production summary batch runner.');

    const context = {
        Array,
        Date,
        Map,
        Number,
        String,
        console,
        filterPromptHistoryEntries,
        shouldExcludeEntryFromPromptHistory: require('../base_context_history.js').shouldExcludeEntryFromPromptHistory,
        ...dependencies
    };
    vm.createContext(context);
    const source = [
        apiSource.slice(parserStart, runnerStart),
        apiSource.slice(runnerStart, runnerEnd),
        'this.__runSummaryBatch = runSummaryBatch;'
    ].join('\n');
    vm.runInContext(source, context, { filename: 'api.js#runSummaryBatch' });
    return context.__runSummaryBatch;
}

test('Utils summary queue rejects diagnostics before reducing candidates to queue fields', () => {
    const originalQueue = Utils.peekChatSummaryQueue();
    const debugId = 'summary-debug-candidate-test';
    const storyId = 'summary-story-candidate-test';

    try {
        Utils.enqueueChatSummaryCandidate({
            entryId: debugId,
            content: 'QUEUE_DEBUG_SENTINEL',
            type: 'tool-call-debug',
            metadata: { npcNames: ['Mira'] }
        });
        Utils.enqueueChatSummaryCandidate({
            entryId: 'summary-check-candidate-test',
            content: 'QUEUE_CHECK_SENTINEL',
            role: 'assistant',
            metadata: { checkResults: true }
        });
        assert.equal(Utils.peekChatSummaryQueue().some(candidate => [debugId, 'summary-check-candidate-test'].includes(candidate.entryId)), false);

        Utils.enqueueChatSummaryCandidate({
            entryId: storyId,
            content: 'QUEUE_STORY_SENTINEL',
            type: 'player-action',
            timestamp: '2026-10-27T12:00:00.000Z'
        });
        assert.equal(Utils.peekChatSummaryQueue().some(candidate => candidate.entryId === storyId), true);
    } finally {
        const queueAfterTest = Utils.peekChatSummaryQueue();
        if (queueAfterTest.length) Utils.dequeueChatSummaryBatch(queueAfterTest.length);
        originalQueue.forEach(candidate => Utils.enqueueChatSummaryCandidate(candidate));
    }
});

test('summary batch filters queued diagnostics and current source diagnostics before rendering and result mapping', async () => {
    const queuedDebug = {
        entryId: 'queued-debug-summary-row', content: 'QUEUED_DEBUG_SENTINEL', type: 'tool-call-debug', timestamp: null
    };
    const sourceFlaggedDebug = {
        id: 'source-flagged-debug-summary-row',
        role: 'assistant',
        type: 'player-action',
        content: 'SOURCE_DEBUG_SENTINEL',
        metadata: { debugToolCalls: true }
    };
    const safeOne = { id: 'safe-summary-one', role: 'assistant', type: 'player-action', content: 'SAFE_SUMMARY_ONE' };
    const safeTwo = { id: 'safe-summary-two', role: 'assistant', type: 'random-event', content: 'SAFE_SUMMARY_TWO' };
    const chatHistory = [sourceFlaggedDebug, safeOne, safeTwo];
    const renderedContexts = [];
    const storedSummaries = [];
    let completionCalls = 0;
    const summaryUtils = Object.create(Utils);
    summaryUtils.parseXmlDocument = (xml, mimeType) => new DOMParser().parseFromString(xml, mimeType);
    summaryUtils.setChatSummary = (entryId, payload) => storedSummaries.push({ entryId, payload });

    const runSummaryBatch = loadRunSummaryBatch({
        chatHistory,
        config: { ai: {} },
        Location: { get: () => null },
        prepareBasePromptContext: async () => ({}),
        promptEnv: {
            render(templateName, context) {
                assert.equal(templateName, 'base-context.xml.njk');
                renderedContexts.push(context);
                return '<template />';
            }
        },
        parseXMLTemplate: () => ({ systemPrompt: 'Summarize only the supplied entries.', generationPrompt: 'summary prompt' }),
        LLMClient: {
            async chatCompletion() {
                completionCalls += 1;
                return '<summaries><summary number="1">Summary one.</summary><summary number="2">Summary two.</summary></summaries>';
            },
            logPrompt() {}
        },
        Utils: summaryUtils
    });

    const success = await runSummaryBatch([
        queuedDebug,
        { entryId: sourceFlaggedDebug.id, content: 'LOSSY_SOURCE_ROW_SENTINEL', type: null },
        { entryId: safeOne.id, content: safeOne.content, type: safeOne.type },
        { entryId: safeTwo.id, content: safeTwo.content, type: safeTwo.type }
    ], { wordLength: 12 });

    assert.equal(success, true);
    assert.equal(completionCalls, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(renderedContexts[0].entries)), [
        { content: 'SAFE_SUMMARY_ONE' },
        { content: 'SAFE_SUMMARY_TWO' }
    ]);
    assert.doesNotMatch(JSON.stringify(renderedContexts[0].entries), /QUEUED_DEBUG_SENTINEL|LOSSY_SOURCE_ROW_SENTINEL|SOURCE_DEBUG_SENTINEL/);
    assert.deepEqual(storedSummaries.map(entry => entry.entryId), [safeOne.id, safeTwo.id]);
    assert.deepEqual(storedSummaries.map(entry => entry.payload.summary), ['Summary one.', 'Summary two.']);
    assert.equal(sourceFlaggedDebug.summary, undefined, 'a diagnostic source row cannot receive a summary via stale queued candidate state');
    assert.equal(safeOne.summary, 'Summary one.');
    assert.equal(safeTwo.summary, 'Summary two.');
});

