const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Utils = require('../Utils.js');
const { parseGameIntroResult } = require('../TinyBrainPromptParsers.js');
const { buildGameIntroResult } = require('../TinyBrainResultBuilders.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

function extract(startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start !== -1 && end !== -1, `Unable to locate ${startMarker}`);
    return source.slice(start, end);
}

function createHarness({ tinyBrain = true, response } = {}) {
    const calls = { slop: [], history: [], autosave: 0, notifications: [], log: [], runner: 0 };
    let pending = { locationId: 'entrance' };
    const scope = {
        Utils: { parseXmlDocument: Utils.parseXmlDocumentStrict },
        config: { ai: {} },
        Globals: { config: { slop_buster: true } },
        prepareBasePromptContext: async () => ({}),
        isTinyBrainPromptEnabled: () => tinyBrain,
        configureTinyBrainPromptContext: () => ({}),
        promptEnv: { render: () => 'rendered' },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'prompt' }),
        buildGameIntroResult,
        parseGameIntroResult,
        runTinyBrainNarrativePrompt: async options => {
            calls.runner += 1;
            // llmresult builds the final XML locally and never invokes finalParser.
            const assembled = options.resultBuilders.game_intro_result({ checkpointValues: [
                { checkpoint: { kind: 'dummy', parserName: 'dummy' }, value: 'The gate opens as dawn breaks.' },
                { checkpoint: { kind: 'parse', parserName: 'revision_decision' }, value: { revise: false } }
            ] });
            return { result: { aiResponse: response === undefined ? assembled : response } };
        },
        completeWithValidatedResponse: async (_options, parser) => {
            const raw = response ?? '<gameIntro><introProse>Standard intro.</introProse></gameIntro>';
            return { response: raw, parsed: parser(raw) };
        },
        LLMClient: { logPrompt: value => calls.log.push(value) },
        applySlopRemoval: async text => {
            calls.slop.push(text);
            return { text, ran: false };
        },
        currentPlayer: { currentLocation: 'entrance' },
        requireLocationId: value => value,
        pushChatEntry: entry => { const stored = { ...entry, id: 'intro-1' }; calls.history.push(stored); return stored; },
        getPendingGameIntroMetadata: () => pending,
        setPendingGameIntroMetadata: value => { pending = value; },
        recordSlopRemovalEntry: () => { throw new Error('Unexpected slop diagnostics'); },
        notifyVisibleProseEntryStored: entry => calls.notifications.push(entry),
        runAutosaveIfEnabled: async () => { calls.autosave += 1; assert.equal(pending, null); }
    };
    const helpers = [
        extract('function sanitizeForXml(input)', '\n\n        const playerActionProseRegex'),
        extract('function stripToXmlPayload(input)', '\n\n        function extractPlayerActionXmlPayload'),
        extract('function trimLeadingParagraphSpaces(text)', '\n\n        function '),
        extract('function parseGameIntroResponse(rawResponse)', '\n\n        function normalizeNpcNameKey'),
        extract('async function runGameIntroPrompt(', '\n\n        Globals.generateGameIntro')
    ].join('\n');
    const run = new Function(...Object.keys(scope), `${helpers}\nreturn runGameIntroPrompt;`)(...Object.values(scope));
    return { run, calls, getPending: () => pending };
}

test('locally assembled TinyBrain intro is parsed, cleaned, stored and autosaved once', async () => {
    const { run, calls, getPending } = createHarness();
    const entry = await run({ locationId: 'entrance' });
    assert.equal(calls.runner, 1);
    assert.deepEqual(calls.slop, ['The gate opens as dawn breaks.']);
    assert.deepEqual(calls.history, [{ id: 'intro-1', role: 'assistant', content: 'The gate opens as dawn breaks.', summary: 'The gate opens as dawn breaks.', type: 'game-intro', locationId: 'entrance' }]);
    assert.equal(entry, calls.history[0]);
    assert.deepEqual(calls.notifications, [entry]);
    assert.equal(calls.autosave, 1);
    assert.equal(getPending(), null);
});

test('malformed or blank TinyBrain intro fails before cleanup, history, or autosave', async () => {
    for (const response of ['<gameIntro><introProse>broken</gameIntro>', '<gameIntro><introProse>   </introProse></gameIntro>']) {
        const { run, calls, getPending } = createHarness({ response });
        let expected;
        try { parseGameIntroResult(response); } catch (error) { expected = error; }
        if (!expected) expected = new Error('Game intro response missing <introProse>.');
        await assert.rejects(run(), error => {
            assert.equal(error.message, expected.message);
            assert.equal(error.constructor, expected.constructor);
            return true;
        });
        assert.deepEqual(calls.slop, []);
        assert.deepEqual(calls.history, []);
        assert.deepEqual(calls.notifications, []);
        assert.equal(calls.autosave, 0);
        assert.deepEqual(getPending(), { locationId: 'entrance' });
    }
});

test('standard intro still uses validated completion and logs the response', async () => {
    const { run, calls } = createHarness({ tinyBrain: false });
    const entry = await run();
    assert.equal(entry.content, 'Standard intro.');
    assert.deepEqual(calls.slop, ['Standard intro.']);
    assert.equal(calls.runner, 0);
    assert.equal(calls.log.length, 1);
    assert.equal(calls.log[0].prefix, 'game_intro');
    assert.equal(calls.autosave, 1);
});
