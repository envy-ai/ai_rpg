const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const ReloadConfigCommand = require('../slashcommands/reload_config.js');

function createInteraction() {
  const replies = [];
  return {
    replies,
    reply: async (payload) => {
      replies.push(payload);
    }
  };
}

test('reload_config exposes an optional override file argument', () => {
  assert.deepEqual(ReloadConfigCommand.args, [
    { name: 'override_file', type: 'string', required: false }
  ]);
  assert.equal(ReloadConfigCommand.usage, '/reload_config [override_file]');
});

test('reload_config passes a selected override file to the runtime reloader', async () => {
  const previousReload = Globals.reloadConfigAndDefs;
  const calls = [];
  Globals.reloadConfigAndDefs = (options) => {
    calls.push(options);
    return {
      timestamp: '2026-08-14T12:00:00.000Z',
      configOverridePath: '/home/bart/ai_rpg/config.yaml.qwen-combo-router'
    };
  };

  try {
    const interaction = createInteraction();
    await ReloadConfigCommand.execute(interaction, {
      override_file: '"config.yaml.qwen-combo-router"'
    });

    assert.deepEqual(calls, [
      { configOverridePath: 'config.yaml.qwen-combo-router' }
    ]);
    assert.equal(interaction.replies.length, 1);
    assert.equal(interaction.replies[0].ephemeral, false);
    assert.match(interaction.replies[0].content, /Session override: \/home\/bart\/ai_rpg\/config\.yaml\.qwen-combo-router\./);
  } finally {
    Globals.reloadConfigAndDefs = previousReload;
  }
});

test('bare reload_config reuses the current runtime reload state', async () => {
  const previousReload = Globals.reloadConfigAndDefs;
  const calls = [];
  Globals.reloadConfigAndDefs = (options) => {
    calls.push(options);
    return { timestamp: '2026-08-14T12:00:00.000Z' };
  };

  try {
    const interaction = createInteraction();
    await ReloadConfigCommand.execute(interaction);

    assert.deepEqual(calls, [{}]);
    assert.equal(interaction.replies.length, 1);
    assert.equal(interaction.replies[0].ephemeral, false);
  } finally {
    Globals.reloadConfigAndDefs = previousReload;
  }
});

test('reload_config reports override validation errors without a success reply', async () => {
  const previousReload = Globals.reloadConfigAndDefs;
  Globals.reloadConfigAndDefs = () => {
    throw new Error('Session config override file not found: /missing.yaml');
  };

  try {
    const interaction = createInteraction();
    await ReloadConfigCommand.execute(interaction, { override_file: '/missing.yaml' });

    assert.deepEqual(interaction.replies, [{
      content: 'Reload failed: Session config override file not found: /missing.yaml',
      ephemeral: true
    }]);
  } finally {
    Globals.reloadConfigAndDefs = previousReload;
  }
});
