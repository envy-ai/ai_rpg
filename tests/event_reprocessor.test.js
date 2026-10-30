'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const EventReprocessor = require('../EventReprocessor.js');
const { initializeSlashCommands, getSlashCommandModule } = require('../SlashCommandRegistry.js');

function serializeHistory(chatHistory) {
    const Globals = require('../Globals.js');
    const previous = Globals.sceneSummaries;
    Globals.sceneSummaries = { serialize: () => ({}) };
    try { return require('../Utils.js').serializeGameState({ chatHistory }); }
    finally { Globals.sceneSummaries = previous; }
}

const user = (id, content) => ({ id, role: 'user', content, metadata: {} });
const prose = (id, content) => ({ id, role: 'assistant', type: 'player-action', content, locationId: 'loc1' });
const pass = (source, state, xml = '') => ({
    sourceEntryId: source.id, sourceContent: source.content, textToCheck: source.content,
    actionText: 'Open the gate.', locationId: 'loc1', eventSectionKind: 'current', eventMode: 'events',
    options: {}, techniqueOperationIds: [], preResolvedHiddenNpcChecks: [], state,
    phase: state === 'applied' ? 'complete' : 'extracting', acceptedXml: xml
});
const harness = (history, overrides = {}) => {
    const calls = [], appended = [];
    const options = {
        history, player: { id: 'player1' }, resolveLocation: id => id === 'loc1' ? { id } : null,
        runEventChecks: async value => { calls.push(value); return { raw: '<events><done/></events>' }; },
        appendResult: async (result, info) => appended.push({ result, info }),
        getRuntimeGeneration: () => 1, isBusy: () => false, ...overrides
    };
    return { calls, appended, run: () => EventReprocessor.replayLatest(options) };
};

test('registered no-argument command delegates latest replay and displays untracked warning', async () => {
    initializeSlashCommands();
    const command = getSlashCommandModule('reprocess_events');
    assert.ok(command);
    let calls = 0;
    const replies = [], refreshes = [];
    const interaction = {
        argsText: '', reprocessLatestEvents: async () => { calls++; return { processedPasses: 1, warnings: ['Previously applied events may be applied again.'] }; },
        reply: async reply => replies.push(reply), requestClientRefresh: payload => refreshes.push(payload)
    };
    await command.execute(interaction);
    assert.equal(calls, 1);
    assert.match(replies[0].content, /Previously applied events may be applied again/);
    assert.equal(refreshes.length, 1);
    await assert.rejects(() => command.execute({ ...interaction, argsText: 'force' }), /no arguments/i);
});

test('replay selects latest gameplay turn, skips completed passes and suppresses unrelated turn effects', async () => {
    const previous = user('old', 'Earlier action');
    const latest = user('latest', 'Open the gate.');
    const done = prose('p1', 'The gate opens.');
    const pending = prose('p2', 'The sentry appears.');
    latest.metadata.eventReplay = { version: 1, playerId: 'player1', passes: [
        pass(done, 'applied', '<events><currency><amount>2</amount></currency></events>'), pass(pending, 'failed')
    ] };
    const history = [previous, prose('oldprose', 'Earlier story.'), latest, done, pending,
        { role: 'user', content: '/reprocess_events', type: 'slash-command' },
        { role: 'assistant', type: 'system', content: 'A system message.' }];
    const h = harness(history);
    const result = await h.run();
    assert.equal(result.processedPasses, 1);
    assert.equal(result.skippedPasses, 1);
    assert.equal(h.calls[0].textToCheck, pending.content);
    assert.equal(h.calls[0].actionText, 'Open the gate.');
    for (const key of ['suppressMoveEvents', 'suppressTimeAdvance', 'suppressNeedBarEventChecks', 'suppressHousekeeping', 'suppressFollowupEventChecks']) assert.equal(h.calls[0][key], true);
    assert.ok(h.calls[0].ignoredEventKeys.includes('needbar_change'));
    assert.ok(h.calls[0].ignoredEventKeys.includes('time_passed'));
    assert.match(h.calls[0].tinyBrainAcceptedEventXml, /<currency>/);
    assert.equal(latest.metadata.eventReplay.passes[1].state, 'applied');
    assert.equal(h.appended[0].info.source.id, pending.id);
});

test('untracked historical turns are replayed with explicit duplication warning and persisted anchor', async () => {
    const input = user('untracked', 'Inspect the machine.');
    const output = prose('story', 'The machine emits sparks.');
    const h = harness([input, output]);
    const result = await h.run();
    assert.equal(result.untracked, true);
    assert.match(result.warnings.join(' '), /previously applied events may be applied again/i);
    assert.equal(h.calls[0].textToCheck, output.content);
    assert.equal(h.calls[0].actionText, input.content);
    const restored = JSON.parse(JSON.stringify(input.metadata.eventReplay));
    assert.equal(restored.passes[0].state, 'applied');
});

test('tracked turn interrupted before extraction replays its saved prose', async () => {
    const input = user('input', 'Open the gate.');
    const output = prose('story', 'The gate opens.');
    input.metadata.eventReplay = { version: 1, playerId: 'player1', passes: [] };
    const h = harness([input, output]);
    const result = await h.run();
    assert.equal(result.untracked, false);
    assert.equal(result.processedPasses, 1);
    assert.equal(h.calls[0].textToCheck, output.content);
    assert.equal(input.metadata.eventReplay.passes[0].state, 'applied');
});

test('failed replay remains recorded and retryable; changed source or runtime is rejected', async () => {
    const input = user('input', 'Open the gate.');
    const output = prose('story', 'The gate opens.');
    input.metadata.eventReplay = { version: 1, playerId: 'player1', passes: [pass(output, 'failed')] };
    let fail = true;
    const h = harness([input, output], { runEventChecks: async () => {
        if (fail) throw new Error('Parser failed.');
        return { raw: '<events><done/></events>' };
    } });
    await assert.rejects(h.run, /Parser failed/);
    assert.equal(input.metadata.eventReplay.passes[0].state, 'failed');
    assert.match(input.metadata.eventReplay.passes[0].error, /Parser failed/);
    fail = false;
    assert.equal((await h.run()).processedPasses, 1);
    input.metadata.eventReplay.passes[0].state = 'failed';
    output.content = 'Changed story.';
    await assert.rejects(h.run, /prose changed/i);
    output.content = 'The gate opens.';
    let epoch = 0;
    const stale = harness([input, output], { getRuntimeGeneration: () => epoch,
        runEventChecks: async () => { epoch++; return { raw: '<events><done/></events>' }; } });
    await assert.rejects(stale.run, /game changed/i);
});

test('partial application is retryable with an explicit warning and without a confirmation gate', async () => {
    const input = user('input', 'Open the gate.');
    const output = prose('story', 'The gate opens.');
    input.metadata.eventReplay = { version: 1, playerId: 'player1', passes: [pass(output, 'failed')] };
    let attempt = 0;
    const h = harness([input, output], { runEventChecks: async () => {
        attempt++;
        return attempt === 1 ? { raw: '<events/>', postProcessingErrors: [{ message: 'Item generation failed.' }] } : { raw: '<events/>' };
    } });
    await assert.rejects(h.run, /Item generation failed/);
    assert.equal(input.metadata.eventReplay.passes[0].state, 'partial');
    assert.equal(input.metadata.eventReplay.passes[0].phase, 'complete');
    const result = await h.run();
    assert.match(result.warnings.join(' '), /retrying may repeat changes/i);
    assert.equal(result.processedPasses, 1);
});

test('recorded event-handler failures surface as partial and can recover on retry', async () => {
    const input = user('input', 'Open the gate.');
    const output = prose('story', 'The gate opens.');
    input.metadata.eventReplay = { version: 1, playerId: 'player1', passes: [pass(output, 'failed')] };
    let attempts = 0;
    const h = harness([input, output], {
        runEventChecks: options => EventReprocessor.runPass(options.eventReplayPass, async () => {
            EventReprocessor.markApplying();
            if (++attempts === 1) EventReprocessor.recordApplicationFailure(new Error('Item effect failed.'));
            return { raw: '<events/>' };
        }, options.beforeEventMutation)
    });
    await assert.rejects(h.run, /Item effect failed/);
    assert.equal(input.metadata.eventReplay.passes[0].state, 'partial');
    const result = await h.run();
    assert.equal(result.processedPasses, 1);
    assert.match(result.warnings.join(' '), /retrying may repeat changes/i);
    assert.equal(input.metadata.eventReplay.passes[0].state, 'applied');
});

test('a report failure after applied events preserves the completed marker and never reapplies effects', async () => {
    const input = user('input', 'Open the gate.');
    const output = prose('story', 'The gate opens.');
    input.metadata.eventReplay = { version: 1, playerId: 'player1', passes: [pass(output, 'failed')] };
    let effectCalls = 0;
    const h = harness([input, output], {
        runEventChecks: async () => { effectCalls++; return { raw: '<events/>' }; },
        appendResult: async () => { throw new Error('Unable to append report.'); }
    });
    await assert.rejects(h.run, /Unable to append report/);
    assert.equal(input.metadata.eventReplay.passes[0].state, 'applied');
    const retry = await h.run();
    assert.equal(retry.processedPasses, 0);
    assert.equal(retry.skippedPasses, 1);
    assert.equal(effectCalls, 1);
});

test('tracked pass metadata survives a JSON save round trip', () => {
    const input = user('input', 'Open the gate.');
    const output = prose('story', 'The gate opens.');
    EventReprocessor.runTurn({ getHistory: () => [input, output], playerId: 'player1' }, () => {
        EventReprocessor.attachTurnEntry(input);
        const tracked = EventReprocessor.beginPass({ textToCheck: output.content, actionText: input.content });
        EventReprocessor.failPass(tracked, new Error('Incomplete XML'));
    });
    const serialized = serializeHistory([input]);
    const restored = JSON.parse(JSON.stringify(serialized.chatHistory))[0];
    assert.equal(restored.metadata.eventReplay.playerId, 'player1');
    assert.equal(restored.metadata.eventReplay.passes[0].sourceEntryId, 'story');
    assert.equal(restored.metadata.eventReplay.passes[0].error, 'Incomplete XML');
});

test('server strips replay internals from client DTOs while retaining saved history metadata', () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function stripServerOnlyChatMetadata(');
    const end = source.indexOf('\nGlobals.stripHiddenNotesFromText =', start);
    assert.ok(start >= 0 && end > start);
    const context = { shouldShowHiddenNotes: config => config.show, stripHiddenNotesFromText: text => text };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.filterEntry = filterHiddenNotesFromChatEntryForClient; this.filterPayload = filterHiddenNotesFromClientPayload;`, context);
    const input = user('input', 'Open the gate.');
    input.metadata = { eventReplay: { version: 1, secret: 'private replay XML' }, requestId: 'request1' };
    for (const show of [false, true]) {
        const entry = context.filterEntry(input, { show });
        assert.equal(entry.metadata.eventReplay, undefined);
        assert.equal(entry.metadata.requestId, 'request1');
        const dto = context.filterPayload({ history: [input], entry: input }, { show });
        assert.equal(dto.history[0].metadata.eventReplay, undefined);
        assert.equal(dto.entry.metadata.eventReplay, undefined);
    }
    const saved = serializeHistory([input]);
    assert.equal(saved.chatHistory[0].metadata.eventReplay.secret, 'private replay XML');
    assert.equal(input.metadata.eventReplay.secret, 'private replay XML');
});

test('active gameplay blocks replay before event extraction or mutation', async () => {
    const input = user('input', 'Open the gate.');
    const output = prose('story', 'The gate opens.');
    const h = harness([input, output], { isBusy: () => true });
    await assert.rejects(h.run, /active gameplay/i);
    assert.equal(h.calls.length, 0);
    assert.equal(input.metadata.eventReplay, undefined);
});

test('world or source changes during extraction block the event mutation boundary', async () => {
    for (const change of ['epoch', 'source']) {
        const input = user('input', 'Open the gate.');
        const output = prose('story', 'The gate opens.');
        input.metadata.eventReplay = { version: 1, playerId: 'player1', passes: [pass(output, 'failed')] };
        let epoch = 1, mutations = 0;
        const h = harness([input, output], {
            getRuntimeGeneration: () => epoch,
            runEventChecks: async options => {
                if (change === 'epoch') epoch++;
                else output.content = 'Edited during extraction.';
                return EventReprocessor.runPass(options.eventReplayPass, async () => {
                    EventReprocessor.markApplying();
                    mutations++;
                    return { raw: '<events/>' };
                }, options.beforeEventMutation);
            }
        });
        await assert.rejects(h.run, /game changed|stored turn changed/i);
        assert.equal(mutations, 0);
        assert.equal(input.metadata.eventReplay.passes[0].phase, 'extracting');
    }
});

test('API command context serializes replay and releases its gameplay locks', async () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('async function reprocessLatestTurnEvents(');
    const end = source.indexOf('\n        function buildSlashCommandInteractionContext(', start);
    assert.ok(start >= 0 && end > start);
    const input = user('input', 'Open the gate.');
    const output = prose('story', 'The gate opens.');
    input.metadata.eventReplay = { version: 1, playerId: 'player1', passes: [pass(output, 'failed')] };
    let releaseMove = 0, releaseTurn = 0, wake;
    const waiting = new Promise(resolve => { wake = resolve; });
    const context = {
        eventReprocessingInProgress: false, currentPlayer: { id: 'player1' },
        scope: { isGameplayBusy: () => false },
        tryAcquirePlayerMoveLock: () => () => { releaseMove++; },
        trackActiveChatTurn: () => () => { releaseTurn++; },
        createStreamEmitter: () => null,
        EventReprocessor, chatHistory: [input, output],
        gameLocations: new Map([['loc1', { id: 'loc1' }]]),
        Location: { get: () => null }, findLocationByNameLoose: () => null,
        Events: { runEventChecks: async () => { await waiting; return { raw: '<events/>' }; } },
        getContextRuntimeGeneration: () => 1,
        appendEventSummariesToChat() {}, appendPendingQuestOffersToChat() {}, recordHiddenNpcCheckResults() {},
        Globals: { emitToClient() {} }, console
    };
    vm.createContext(context);
    const run = vm.runInContext(`${source.slice(start, end)}\nreprocessLatestTurnEvents;`, context);
    const first = run({ clientId: 'client1' });
    await assert.rejects(run({ clientId: 'client2' }), /active gameplay work/i);
    wake();
    assert.equal((await first).processedPasses, 1);
    assert.equal(releaseMove, 1);
    assert.equal(releaseTurn, 1);
    assert.equal(context.eventReprocessingInProgress, false);
});
