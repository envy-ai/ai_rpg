const test = require('node:test');
const assert = require('node:assert/strict');

const {
  initializeSlashCommands,
  getSlashCommandModule
} = require('../SlashCommandRegistry.js');

function getCommand(name = 'housekeeping') {
  initializeSlashCommands();
  const command = getSlashCommandModule(name);
  assert.ok(command, `${name} command should be registered`);
  return command;
}

function createInteraction({
  argsText = '',
  clientId = 'client-housekeeping-test',
  runHousekeepingPrompt = async () => ({ response: '<housekeeping></housekeeping>', toolInvocations: [] }),
  requestClientRefresh = () => {}
} = {}) {
  const replies = [];
  return {
    argsText,
    clientId,
    replies,
    runHousekeepingPrompt,
    requestClientRefresh,
    reply: async payload => {
      replies.push(payload);
    }
  };
}

test('housekeeping command is registered with runhousekeeping alias', () => {
  const command = getCommand();
  const alias = getCommand('runhousekeeping');

  assert.equal(alias, command);
  assert.equal(command.usage, '/housekeeping [instructions...]');
});

test('housekeeping command passes raw instructions to the prompt runner', async () => {
  const command = getCommand();
  const calls = [];
  const refreshRequests = [];
  const interaction = createInteraction({
    argsText: '  refresh trackers for recent rumors only  ',
    runHousekeepingPrompt: async payload => {
      calls.push(payload);
      return {
        response: '<housekeeping><trackers></trackers></housekeeping>',
        toolInvocations: [{ name: 'updateTracker' }, { name: 'setRelationship' }]
      };
    },
    requestClientRefresh: payload => {
      refreshRequests.push(payload);
    }
  });

  await command.execute(interaction, {});

  assert.deepEqual(calls, [{ instructions: 'refresh trackers for recent rumors only' }]);
  assert.deepEqual(refreshRequests, [{
    locationRefreshRequested: true,
    relationshipGraphRefreshRequested: true
  }]);
  assert.deepEqual(interaction.replies, [{
    content: 'Housekeeping completed. Applied 2 housekeeping tool executions.',
    ephemeral: false
  }]);
});

test('housekeeping command sends blank instructions when no text is provided', async () => {
  const command = getCommand();
  const calls = [];
  const interaction = createInteraction({
    argsText: '   ',
    runHousekeepingPrompt: async payload => {
      calls.push(payload);
      return { response: '<housekeeping></housekeeping>', toolInvocations: [] };
    }
  });

  await command.execute(interaction, {});

  assert.deepEqual(calls, [{ instructions: '' }]);
  assert.equal(interaction.replies[0].content, 'Housekeeping completed. Applied 0 housekeeping tool executions.');
});

test('housekeeping command fails loudly without a prompt runner', async () => {
  const command = getCommand();
  const interaction = createInteraction({ runHousekeepingPrompt: null });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Housekeeping execution is unavailable in this command context\./
  );
});

test('housekeeping command fails loudly without a client connection', async () => {
  const command = getCommand();
  const interaction = createInteraction({ clientId: null });

  await assert.rejects(
    () => command.execute(interaction, {}),
    /Housekeeping slash command requires an active client connection\./
  );
});
