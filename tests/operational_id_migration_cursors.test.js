'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { migrateOperationalIds } = require('../OperationalIdMigration.js');

test('migrated chat identities remain consistent with housekeeping and saved scene boundaries', () => {
    const first = 'e581178b-cd44-4f6c-95e2-a9b90266d5dd';
    const second = 'a2c66c12-8b4f-420f-a9fd-ea24e1d12cb1';
    const source = { chatHistory: [{ id: first, content: `Original prose ${first}` }, { id: second, content: 'Later prose' }],
        sceneSummaries: { scenes: [{ startEntryId: first, endEntryId: second, entryId: first, timestamp: '2026-11-08T10:00:00Z', summary: `Scene ${second}` }] },
        housekeeping: { lastHousekeepingTurnId: first, lastReviewedTurnId: second } };
    const migrated = migrateOperationalIds(source).serialized;
    const [newFirst, newSecond] = migrated.chatHistory.map(entry => entry.id);
    assert.match(newFirst, /^chat_\d+$/);
    assert.match(newSecond, /^chat_\d+$/);
    assert.notEqual(newFirst, newSecond);
    assert.equal(migrated.housekeeping.lastHousekeepingTurnId, newFirst);
    assert.equal(migrated.housekeeping.lastReviewedTurnId, newSecond);
    const scene = migrated.sceneSummaries.scenes[0];
    assert.equal(scene.startEntryId, newFirst);
    assert.equal(scene.endEntryId, newSecond);
    assert.equal(scene.entryId, newFirst);
    assert.equal(scene.timestamp, '2026-11-08T10:00:00Z');
    assert.equal(scene.summary, `Scene ${second}`);
    assert.equal(migrated.chatHistory[0].content, `Original prose ${first}`);
    assert.equal(source.chatHistory[0].id, first);
});
