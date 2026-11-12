'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectWithPromptAwareDeadline } = require('../ManagedLocalLlmController.js');

function fakeTimers() {
    const previousSet = global.setTimeout, previousClear = global.clearTimeout;
    const timers = new Set();
    global.setTimeout = (callback, delay) => { const timer = { callback, delay, unref() {} }; timers.add(timer); return timer; };
    global.clearTimeout = timer => timers.delete(timer);
    return { timers, fire() { const timer = [...timers][0]; assert.ok(timer); timers.delete(timer); timer.callback(); }, restore() { global.setTimeout = previousSet; global.clearTimeout = previousClear; } };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('idle inspection times out with the original abort failure as cause', { concurrency: false }, async () => {
    const clock = fakeTimers();
    try {
        let capturedSignal;
        const inspection = inspectWithPromptAwareDeadline(signal => {
            capturedSignal = signal;
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('underlying readiness aborted')), { once: true }));
        }, { hasActivePrompts: () => false });
        assert.equal([...clock.timers][0].delay, 5000);
        clock.fire();
        assert.equal(capturedSignal.aborted, true);
        await assert.rejects(inspection, error => {
            assert.equal(error.code, 'LOCAL_LLM_STATUS_TIMEOUT');
            assert.match(error.message, /timeout|timed out/i);
            assert.match(error.cause.message, /underlying readiness aborted/);
            return true;
        });
        assert.equal(clock.timers.size, 0);
    } finally { clock.restore(); }
});

test('active and newly active prompts waive the short status deadline', { concurrency: false }, async () => {
    const clock = fakeTimers();
    try {
        const busyGate = deferred(); let busySignal;
        const busy = inspectWithPromptAwareDeadline(signal => { busySignal = signal; return busyGate.promise; }, { hasActivePrompts: () => true });
        assert.equal(busySignal, undefined);
        assert.equal(clock.timers.size, 0);
        busyGate.resolve('ready');
        assert.equal(await busy, 'ready');
        let active = false, raceSignal;
        const raceGate = deferred();
        const race = inspectWithPromptAwareDeadline(signal => { raceSignal = signal; return raceGate.promise; }, { hasActivePrompts: () => active });
        assert.equal(clock.timers.size, 1);
        active = true;
        clock.fire();
        assert.equal(raceSignal.aborted, false);
        raceGate.resolve('ready after slow prompt');
        assert.equal(await race, 'ready after slow prompt');
        assert.equal(clock.timers.size, 0);
    } finally { clock.restore(); }
});

test('settled status checks clear timers and preserve non-timeout errors', { concurrency: false }, async () => {
    const clock = fakeTimers();
    try {
        assert.equal(await inspectWithPromptAwareDeadline(async () => 'ready', { hasActivePrompts: () => false }), 'ready');
        assert.equal(clock.timers.size, 0);
        const cause = new Error('provider status invalid');
        await assert.rejects(inspectWithPromptAwareDeadline(async () => { throw cause; }, { hasActivePrompts: () => false }), error => error === cause);
        assert.equal(clock.timers.size, 0);
    } finally { clock.restore(); }
});
