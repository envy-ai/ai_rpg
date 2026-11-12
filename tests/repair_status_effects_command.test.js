'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeSlashCommands, getSlashCommandModule } = require('../SlashCommandRegistry.js');

test('repair slash command is registered, refreshes after persisted results, and surfaces errors', async () => {
    initializeSlashCommands();
    const command = getSlashCommandModule('repair_status_effects');
    assert.ok(command);
    assert.deepEqual(command.args, []);
    const refreshes = [], replies = [];
    const interaction = {
        repairStatusEffects: async () => ({ inspected: 2, repaired: 1, unchanged: 1, duplicatesRemoved: 0, storedEntries: [{ id: 'summary' }] }),
        requestClientRefresh: value => refreshes.push(value),
        reply: async value => replies.push(value)
    };
    await command.execute(interaction);
    assert.deepEqual(refreshes, [{ locationRefreshRequested: true }]);
    assert.deepEqual(replies, [{ content: '' }]);
    const failure = new Error('original repair failure');
    interaction.repairStatusEffects = async () => { throw failure; };
    await assert.rejects(command.execute(interaction), error => error === failure);
    assert.equal(refreshes.length, 1);
    interaction.repairStatusEffects = async () => ({ storedEntries: [] });
    await assert.rejects(command.execute(interaction), /store.*summary/i);
    assert.equal(refreshes.length, 1);
});
