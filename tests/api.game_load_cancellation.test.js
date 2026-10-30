const test = require('node:test');
const assert = require('node:assert/strict');

const { abortRuntimeWorkBeforeGameLoad } = require('../api.js');

test('game-load cancellation invalidates runtime work and drains turns before hydration can continue', async () => {
    const calls = [];
    let promptCancellationPass = 0;

    const result = await abortRuntimeWorkBeforeGameLoad({
        reason: 'restore requested',
        timeoutMs: 1000,
        advanceRuntimeGeneration: label => {
            calls.push(`advance:${label}`);
            return 7;
        },
        clearCurrentTurnToken: () => calls.push('clear-turn-token'),
        cancelAllPrompts: reason => {
            promptCancellationPass += 1;
            calls.push(`cancel-prompts:${promptCancellationPass}:${reason}`);
            return { canceledCount: promptCancellationPass };
        },
        waitForPromptDrain: async () => {
            calls.push('drain-prompts');
            return { drained: true };
        },
        waitForActiveTurns: async ({ onPoll }) => {
            calls.push('drain-turns:start');
            onPoll();
            calls.push('drain-turns:complete');
        },
        cancelAllImageJobs: async reason => {
            calls.push(`cancel-images:${reason}`);
            return { canceledCount: 3 };
        },
        cancelPendingPlayerInputRequests: reason => {
            calls.push(`cancel-input:${reason}`);
            return 2;
        },
        rejectQuestConfirmations: reason => {
            calls.push(`cancel-quests:${reason}`);
            return 1;
        },
        clearPlayerMoveLocks: () => calls.push('clear-move-locks'),
        settleRuntimeTick: async () => calls.push('settle-runtime')
    });

    assert.equal(result.runtimeGenerationId, 7);
    assert.equal(result.cancelledPlayerInputRequests, 2);
    assert.equal(result.rejectedQuestConfirmations, 1);
    assert.equal(result.imageCancellation.canceledCount, 3);
    assert.equal(result.cancellationPasses.length, 4);
    assert.ok(calls.indexOf('advance:game-load') < calls.indexOf('drain-turns:start'));
    assert.ok(calls.indexOf('drain-turns:complete') < calls.indexOf('drain-prompts'));
    assert.ok(calls.indexOf('settle-runtime') < calls.lastIndexOf('drain-prompts'));
    assert.ok(calls.indexOf('clear-move-locks') < calls.length);
});

test('game-load cancellation propagates image cancellation failures after prompt drains', async () => {
    const calls = [];

    await assert.rejects(() => abortRuntimeWorkBeforeGameLoad({
        advanceRuntimeGeneration: () => 1,
        clearCurrentTurnToken: () => {},
        cancelAllPrompts: () => ({ canceledCount: 0 }),
        waitForPromptDrain: async () => calls.push('prompt-drained'),
        waitForActiveTurns: async () => calls.push('turn-drained'),
        cancelAllImageJobs: async () => {
            throw new Error('ComfyUI interrupt failed');
        },
        cancelPendingPlayerInputRequests: () => 0,
        rejectQuestConfirmations: () => 0,
        clearPlayerMoveLocks: () => {},
        settleRuntimeTick: async () => {}
    }), /ComfyUI interrupt failed/);

    assert.deepEqual(calls, ['turn-drained', 'prompt-drained', 'prompt-drained']);
});

test('game-load cancellation settles mod turn-context work after prompt drains and before move locks clear', async () => {
    const calls = [];
    await abortRuntimeWorkBeforeGameLoad({
        advanceRuntimeGeneration: () => 5,
        clearCurrentTurnToken: () => {},
        cancelAllPrompts: () => ({ canceledCount: 0 }),
        waitForPromptDrain: async () => calls.push('prompts-drained'),
        waitForActiveTurns: async () => calls.push('turns-drained'),
        cancelAllImageJobs: async () => ({ canceledCount: 0 }),
        cancelPendingPlayerInputRequests: () => 0,
        rejectQuestConfirmations: () => 0,
        waitForContextWork: async ({ timeoutMs }) => {
            assert.equal(timeoutMs, 1000);
            calls.push('context-work-settled');
        },
        clearPlayerMoveLocks: () => calls.push('move-locks-cleared'),
        settleRuntimeTick: async () => calls.push('runtime-settled'),
        timeoutMs: 1000
    });

    assert.equal(calls.indexOf('context-work-settled'), calls.lastIndexOf('context-work-settled'));
    assert.ok(calls.indexOf('prompts-drained') < calls.indexOf('context-work-settled'));
    assert.ok(calls.indexOf('context-work-settled') < calls.indexOf('move-locks-cleared'));
});

test('game-load cancellation propagates mod turn-context settlement errors before hydration cleanup', async () => {
    const calls = [];
    await assert.rejects(() => abortRuntimeWorkBeforeGameLoad({
        advanceRuntimeGeneration: () => 5,
        clearCurrentTurnToken: () => {},
        cancelAllPrompts: () => ({ canceledCount: 0 }),
        waitForPromptDrain: async () => {},
        waitForActiveTurns: async () => {},
        cancelAllImageJobs: async () => ({ canceledCount: 0 }),
        cancelPendingPlayerInputRequests: () => 0,
        rejectQuestConfirmations: () => 0,
        waitForContextWork: async () => { throw new Error('mod context work failed'); },
        clearPlayerMoveLocks: () => calls.push('move-locks-cleared'),
        settleRuntimeTick: async () => {},
        timeoutMs: 1000
    }), /mod context work failed/);
    assert.deepEqual(calls, []);
});

test('game load and emergency rollback route share the runtime cancellation boundary', () => {
    const fs = require('fs');
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const loadStart = apiSource.indexOf('async function performGameLoad');
    const loadEnd = apiSource.indexOf('\n        scope.performGameSave', loadStart);
    const loadSource = apiSource.slice(loadStart, loadEnd);

    assert.match(loadSource, /cancelRuntimeForReplacement/);
    assert.match(loadSource, /activeImageJobs\.clear\(\)/);
    const cancellationIndex = loadSource.indexOf('cancelRuntimeForReplacement(');
    const configReloadIndex = loadSource.indexOf('Globals.reloadConfigAndDefs({');
    assert.ok(cancellationIndex >= 0 && configReloadIndex > cancellationIndex,
        'runtime cancellation and drain must finish before saved config and world hydration');
    const replacementStart = apiSource.indexOf('function cancelRuntimeForReplacement(');
    const replacementEnd = apiSource.indexOf('\n\n        async function performGameLoad', replacementStart);
    const replacementSource = apiSource.slice(replacementStart, replacementEnd);
    assert.match(replacementSource, /abortRuntimeWorkBeforeGameLoad/);
    assert.match(replacementSource, /cancelAllImageJobs/);
    assert.match(replacementSource, /waitForActiveTurns: waitForActiveChatTurnDrain/);
    assert.match(replacementSource, /clearPlayerMoveLocks: \(\) => activePlayerMoveLocks\.clear\(\)/);
    assert.match(apiSource, /app\.post\('\/api\/turn\/cancel-and-rollback'/);
    assert.match(apiSource, /loadLatest: true/);
});
