const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const RpCommand = require('../slashcommands/rp.js');

function createInteraction() {
  const replies = [];
  return {
    replies,
    reply: async (payload) => {
      replies.push(payload);
    }
  };
}

function createRpConfig() {
  return {
    event_checks: { enabled: true },
    plausibility_checks: { enabled: true },
    random_event_frequency: { enabled: true },
    npc_turns: { enabled: true },
    plot_analysis: { enabled: true }
  };
}

test('/rp toggles plot analysis with the other automated post-action systems', async () => {
  const previousConfig = Globals.config;
  Globals.config = createRpConfig();

  try {
    const enableInteraction = createInteraction();
    await RpCommand.execute(enableInteraction, {});

    assert.equal(Globals.config.event_checks.enabled, false);
    assert.equal(Globals.config.plausibility_checks.enabled, false);
    assert.equal(Globals.config.random_event_frequency.enabled, false);
    assert.equal(Globals.config.npc_turns.enabled, false);
    assert.equal(Globals.config.plot_analysis.enabled, false);
    assert.match(enableInteraction.replies[0].content, /plot analysis/i);

    const restoreInteraction = createInteraction();
    await RpCommand.execute(restoreInteraction, {});

    assert.equal(Globals.config.event_checks.enabled, true);
    assert.equal(Globals.config.plausibility_checks.enabled, true);
    assert.equal(Globals.config.random_event_frequency.enabled, true);
    assert.equal(Globals.config.npc_turns.enabled, true);
    assert.equal(Globals.config.plot_analysis.enabled, true);
    assert.match(restoreInteraction.replies[0].content, /plot analysis/i);
  } finally {
    Globals.config = previousConfig;
  }
});
