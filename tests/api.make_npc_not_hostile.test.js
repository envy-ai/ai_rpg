'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeHarness() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf("        app.post('/api/npcs/:id/make-not-hostile'");
    const end = source.indexOf("        // Update an NPC's core data", start);
    assert.ok(start >= 0 && end > start);
    const player = { id: 'player' }, first = { id: 'npc_1', name: 'Same', isNPC: true, isHostile: true }, second = { id: 'npc_2', name: 'Same', isNPC: true, isHostile: true }, dead = { id: 'dead', isNPC: true, isDead: true };
    const players = new Map([[first.id, first], [second.id, second], [dead.id, dead], ['player', player]]);
    const calls = [], emitted = [];
    let handler;
    const context = { app: { post: (_path, callback) => { handler = callback; } }, currentPlayer: player, players,
        Events: { makeCharacterNotHostile(npc, target) { calls.push([npc, target]); if (npc.throwError) throw new Error('transition failed'); const changed = npc.isHostile; npc.isHostile = false; return changed; } },
        serializeNpcForClient: npc => ({ id: npc.id, isHostileToPlayer: npc.isHostile }), Globals: { emitToClient: (...args) => emitted.push(args) }, console: { error() {} } };
    vm.runInNewContext(source.slice(start, end), context);
    const invoke = id => { const result = { status: 200 }; const response = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } }; handler({ params: { id } }, response); return result; };
    return { invoke, calls, emitted, first, second, context };
}

test('make-not-hostile route targets exact canonical NPC and reports already-friendly state', () => {
    const h = makeHarness();
    const first = h.invoke('npc_1');
    assert.equal(first.status, 200); assert.equal(first.body.changed, true); assert.equal(first.body.npc.id, 'npc_1');
    assert.equal(h.second.isHostile, true, 'a duplicate name does not affect a different ID');
    assert.equal(h.calls[0][0], h.first);
    assert.equal(h.invoke('npc_1').body.changed, false);
    assert.equal(h.emitted.length, 2);
    assert.equal(h.emitted[0][2].locationRefreshRequested, true);
});

test('make-not-hostile route rejects missing, dead and non-NPC targets and preserves failures', () => {
    const h = makeHarness();
    assert.equal(h.invoke('missing').status, 404);
    assert.equal(h.invoke('player').status, 404);
    assert.equal(h.invoke('dead').status, 400);
    assert.equal(h.calls.length, 0);
    h.first.throwError = true;
    const failure = h.invoke('npc_1');
    assert.equal(failure.status, 500); assert.match(failure.body.error, /transition failed/); assert.match(failure.body.stack, /transition failed/);
    assert.equal(h.emitted.length, 0);
    h.context.currentPlayer = null;
    assert.equal(h.invoke('npc_1').status, 400);
});
