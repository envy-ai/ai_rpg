'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { migrateOperationalIds } = require('../OperationalIdMigration.js');

test('migrated receipt notification sees the existing check-result identity and refreshes without duplicating it', () => {
    const oldId = 'e581178b-cd44-4f6c-95e2-a9b90266d5dd';
    const snapshot = { techniques: { receipts: [{ operationId: oldId, actorId: 'actor', turnId: 'turn', techniqueChanges: [] }] },
        chatHistory: [{ id: 'chat_1', checkResults: [{ techniqueRecordId: `${oldId}:use` }] }] };
    const migrated = migrateOperationalIds(snapshot).serialized;
    const receipt = migrated.techniques.receipts[0], entry = migrated.chatHistory[0];
    assert.match(receipt.operationId, /^operation_\d+$/);
    assert.equal(entry.checkResults[0].techniqueRecordId, `${receipt.operationId}:use`);
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function recordTechniqueReceipt('), end = source.indexOf('        function resolveTechniqueActor(', start);
    assert.ok(start >= 0 && end > start);
    const events = [];
    let duplicateSuppressed = false;
    const actor = { id: 'actor', currentLocation: 'room' };
    const record = vm.runInNewContext(`${source.slice(start, end)}\nrecordTechniqueReceipt;`, {
        techniqueHistoryContexts: new Map(), activeTechniqueTurnId: null,
        players: new Map([[actor.id, actor]]), Player: { getById: () => null }, currentPlayer: actor,
        effectiveTechniqueLocation: () => 'room', chatHistory: [entry],
        createCheckResultsRecorder: () => ({
            recordTechnique: (value, ids) => { duplicateSuppressed = ids.has(`${value.operationId}:use`); },
            hasEntry: () => false
        }),
        Globals: { emitToClient: (...args) => events.push(args) }
    });
    record(receipt);
    assert.equal(duplicateSuppressed, true);
    assert.equal(events.length, 1);
    assert.equal(events[0][2].entryId, 'chat_1');
    assert.equal(migrated.chatHistory.length, 1);
});
