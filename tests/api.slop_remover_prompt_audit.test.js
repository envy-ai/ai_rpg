const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadSlopRemover() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        const applySlopRemoval = async (prose, {');
    const end = source.indexOf('\n\n        Globals.applySlopRemoval = applySlopRemoval;', start);
    if (start < 0 || end < 0) throw new Error('Unable to locate applySlopRemoval in api.js');

    let acceptedStages = 0;
    let attempt = 0;
    const context = {
        Globals: { scrubGeneratedBrackets: text => text },
        config: { slop_remover_base_attempts: 1 },
        PromptAuditLog: {
            runPrompt: (_options, callback) => callback(),
            runStage: (_options, callback) => callback(),
            captureFailureBoundary: () => new Map(),
            setAttempt(value) { attempt = value; },
            recordFailure() {},
            acceptStage() { acceptedStages += 1; }
        },
        Utils: {
            extractFinalXmlBlockFromResponse: text => text,
            parseXmlDocumentStrict: () => ({
                getElementsByTagName(name) {
                    return name === 'editedText' ? [{ content: 'Clean prose.' }] : [];
                }
            })
        },
        LLMClient: {
            chatCompletion: async () => '<editedText>Clean prose.</editedText>',
            logPrompt() {}
        },
        promptEnv: { render: () => '<prompt />' },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }),
        stripHiddenNotesFromText: text => text,
        getFilteredSlopWords: async text => text.includes('forbidden') ? ['forbidden'] : [],
        getFilteredSlopRegexes: async () => [],
        collectSlopNgrams: async () => [],
        buildSlopContextText: () => 'Recent story context.',
        loadForbiddenTropesForSlopPrompt: () => [],
        parseXmlDocumentStrict: () => ({
            getElementsByTagName(name) {
                return name === 'editedText' ? [{ content: 'Clean prose.' }] : [];
            }
        }),
        extractProseNodeContentPreservingTags: node => node.content,
        console: { warn() {} },
        Set,
        Array,
        String,
        Number,
        Object,
        Map,
        Error,
        TypeError
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.applySlopRemoval = applySlopRemoval;`, context);
    return { applySlopRemoval: context.applySlopRemoval, acceptedStages: () => acceptedStages, attempt: () => attempt };
}

test('applySlopRemoval accepts a valid correction after its retry loop and settles the audit stage', async () => {
    const runtime = loadSlopRemover();

    const result = await runtime.applySlopRemoval('A forbidden phrase.', { returnDiagnostics: true });

    assert.equal(result.text, 'Clean prose.');
    assert.equal(result.ran, true);
    assert.equal(runtime.acceptedStages(), 1);
    assert.equal(runtime.attempt(), 1);
});
