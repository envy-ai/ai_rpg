const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const ModelCommand = require('../slashcommands/model.js');
const ModelOverrideCommand = require('../slashcommands/model_override.js');

function createInteraction() {
  const replies = [];
  return {
    replies,
    reply: async payload => replies.push(payload)
  };
}

function buildConfig() {
  return {
    ai: { model: 'root-before' },
    ai_model_overrides: {
      prose: { model: 'prose-before', prompts: ['player_action'] },
      fast: { model: 'fast-before', prompts: ['event_checks'] }
    }
  };
}

test('model updates the runtime main AI model without changing override routes', async () => {
  const previousConfig = Globals.config;
  Globals.config = buildConfig();
  try {
    const interaction = createInteraction();
    await ModelCommand.execute(interaction, { model: '"root-after"' });

    assert.equal(Globals.config.ai.model, 'root-after');
    assert.equal(Globals.config.ai_model_overrides.prose.model, 'prose-before');
    assert.match(interaction.replies[0].content, /root-after/);
  } finally {
    Globals.config = previousConfig;
  }
});

test('model reports the configured main AI model when called without arguments', async () => {
  const previousConfig = Globals.config;
  Globals.config = buildConfig();
  try {
    const interaction = createInteraction();
    await ModelCommand.execute(interaction);

    assert.deepEqual(interaction.replies, [{
      content: 'Main AI model: `root-before`',
      ephemeral: false
    }]);
  } finally {
    Globals.config = previousConfig;
  }
});

test('model_override updates an existing override category case-insensitively', async () => {
  const previousConfig = Globals.config;
  Globals.config = buildConfig();
  try {
    const interaction = createInteraction();
    await ModelOverrideCommand.execute(interaction, {
      category: 'PROSE',
      model: 'Qwen Example'
    });

    assert.equal(Globals.config.ai_model_overrides.prose.model, 'Qwen Example');
    assert.deepEqual(Globals.config.ai_model_overrides.prose.prompts, ['player_action']);
    assert.match(interaction.replies[0].content, /`prose`/);
  } finally {
    Globals.config = previousConfig;
  }
});

test('model_override lists the configured override models when called without arguments', async () => {
  const previousConfig = Globals.config;
  Globals.config = buildConfig();
  try {
    const interaction = createInteraction();
    await ModelOverrideCommand.execute(interaction);

    assert.deepEqual(interaction.replies, [{
      content: '**AI model overrides:**\n- `fast`: `fast-before`\n- `prose`: `prose-before`',
      ephemeral: false
    }]);
  } finally {
    Globals.config = previousConfig;
  }
});

test('model_override rejects unknown categories without creating a dead configuration route', async () => {
  const previousConfig = Globals.config;
  Globals.config = buildConfig();
  try {
    await assert.rejects(
      ModelOverrideCommand.execute(createInteraction(), { category: 'missing', model: 'model-x' }),
      /Unknown AI model override category "missing". Available categories: fast, prose\./
    );
    assert.equal(Globals.config.ai_model_overrides.missing, undefined);
  } finally {
    Globals.config = previousConfig;
  }
});

test('model_override rejects a partial update request', async () => {
  const previousConfig = Globals.config;
  Globals.config = buildConfig();
  try {
    await assert.rejects(
      ModelOverrideCommand.execute(createInteraction(), { category: 'prose' }),
      /Specify both an AI model override category and a model name, or neither to list overrides\./
    );
  } finally {
    Globals.config = previousConfig;
  }
});
