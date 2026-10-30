'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Globals = require('../Globals.js');
const PromptAuditLog = require('../PromptAuditLog.js');
const PromptFailureReporter = require('../PromptFailureReporter.js');

function loadFactionStage(responses) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('    const maxFactionPromptAttempts = 3;');
    const end = source.indexOf('\n\n    const parsedCoreFactions', start);
    assert.ok(start >= 0 && end > start, 'Unable to locate the faction-stage retry helper.');
    let calls = 0;
    const context = {
        assert,
        Error,
        PromptAuditLog,
        PromptFailureReporter,
        console,
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generate' }),
        LLMClient: {
            async chatCompletion({ metadataLabel }) {
                calls += 1;
                PromptFailureReporter.transportAttempt(metadataLabel);
                const response = responses.shift();
                if (response instanceof Error) throw response;
                return response;
            }
        }
    };
    const vm = require('node:vm');
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.runStage = runFactionPromptStageWithRetries;`, context);
    return { run: context.runStage, calls: () => calls };
}

function captureFailureEvents() {
    const previousHub = Globals.realtimeHub;
    const events = [];
    Globals.realtimeHub = { emit(_room, type, payload) { if (type === 'prompt_failed') events.push(payload); } };
    return { events, restore: () => { Globals.realtimeHub = previousHub; } };
}

function stageOptions(parseResponse) {
    return {
        stageLabel: 'core generation',
        metadataLabel: 'faction_generation',
        expectedXmlRootTag: 'factions',
        renderTemplate: () => '<template/>',
        parseResponse,
        logResponse() {}
    };
}

test('faction parser exhaustion reports once with actual attempts and correction count', { concurrency: false }, async () => {
    const fixture = captureFailureEvents();
    const stage = loadFactionStage(['<factions/>', '<factions/>', '<factions/>']);
    try {
        await assert.rejects(stage.run(stageOptions(() => { throw new Error('Faction XML validation failed.'); })), /Faction core generation failed after 3 attempts/);
        assert.equal(stage.calls(), 3);
        assert.equal(fixture.events.length, 1);
        assert.equal(fixture.events[0].metadataLabel, 'faction_generation');
        assert.equal(fixture.events[0].kind, 'parse_retry');
        assert.equal(fixture.events[0].transportAttempts, 3);
        assert.equal(fixture.events[0].validationRetries, 2);
        assert.match(fixture.events[0].stack, /Faction XML validation failed/);
    } finally { fixture.restore(); }
});

test('faction parser recovery and explicit cancellation stay quiet', { concurrency: false }, async () => {
    const fixture = captureFailureEvents();
    const recoveredStage = loadFactionStage(['bad', 'good']);
    try {
        const recovered = await recoveredStage.run(stageOptions(response => {
            if (response !== 'good') throw new Error('Retry faction response.');
            return ['accepted'];
        }));
        assert.deepEqual(Array.from(recovered), ['accepted']);
        assert.equal(recoveredStage.calls(), 2);
        assert.deepEqual(fixture.events, []);

        const cancellation = new Error('Faction prompt cancelled.');
        cancellation.name = 'PromptCancellationError';
        cancellation.code = 'PROMPT_CANCELLED';
        const cancelledStage = loadFactionStage([cancellation, 'unused']);
        await assert.rejects(cancelledStage.run(stageOptions(() => { throw new Error('The parser should not run.'); })), error => error === cancellation);
        assert.equal(cancelledStage.calls(), 1);
        assert.deepEqual(fixture.events, []);
    } finally { fixture.restore(); }
});
