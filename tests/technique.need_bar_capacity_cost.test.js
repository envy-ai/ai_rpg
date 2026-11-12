'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TechniqueService = require('../TechniqueService.js');
const Globals = require('../Globals.js');
const { withTechniqueWorld, addDefinition, learn, mechanics } = require('./helpers/techniqueIntegrationFixtures.js');

const needBarsYaml = `
need_bars:
  rest:
    name: Rest
    player: true
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 55
    effect_thresholds:
      0:
        name: Tired
        sentence: "%CHARACTER% is tired."
        status_effects:
          tired:
            name: Tired
            description: Tiredness reduces capacity.
            need_bar_maximums:
              stamina:
                percent_modifier: -10
      50:
        name: Rested
        sentence: "%CHARACTER% is rested."
  stamina:
    name: Stamina
    player: true
    party: true
    non_party: true
    min: 0
    max: 1000
    initial: 500
`;

test('technique pays exact fixed Rest and Stamina costs before one capacity reconciliation', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const id = 'technique_capacity_cost';
        addDefinition(id, mechanics({ costs: [{ resource: 'need', needId: 'rest', direction: 'decrease', amount: 10 },
            { resource: 'need', needId: 'stamina', direction: 'decrease', amount: 100 }],
            effects: [{ id: 'heal', kind: 'healing', amount: 1 }] }));
        learn(player, id);
        assert.equal(player.getNeedBarValue('rest'), 55);
        assert.equal(player.getNeedBarValue('stamina'), 500);
        const options = { operationId: 'capacity-cost-operation', turnId: 'capacity-cost-turn', actor: player, techniqueId: id };
        const result = await TechniqueService.execute(options);
        assert.equal(player.getNeedBarValue('rest'), 45);
        assert.ok(Math.abs(player.getNeedBarValue('stamina') - 360) < 1e-9);
        assert.equal(player.getNeedBars().find(bar => bar.id === 'stamina').max, 900);
        const stamina = result.costs.find(cost => cost.needId === 'stamina');
        assert.equal(stamina.amount, 100);
        assert.equal(stamina.newValue, 400);
        const replay = await TechniqueService.execute(options);
        assert.deepEqual(replay, result);
        assert.equal(player.getNeedBarValue('stamina'), 360);
    }, { needBarsYaml });
});

test('technique percentage health rate settles elapsed time before refresh and replay', async () => {
    await withTechniqueWorld(async ({ player }) => {
        const oldTime = Globals.worldTime;
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        Globals.config.healthRegenPercentPerMinute = 0;
        try {
            const id = 'technique_rate_refresh';
            addDefinition(id, mechanics({ effects: [{ id: 'flow', kind: 'buff', stacking: 'refresh', refreshPolicy: 'stronger',
                status: { name: 'Flow', description: 'A steady recovery.', duration: 5, needBars: [{ name: 'Health', delta: 0, percentDelta: 1 }] } }] }));
            learn(player, id);
            const maximum = player.maxHealth;
            player.setHealth(maximum * 0.4);
            await TechniqueService.execute({ operationId: 'flow-first', turnId: 'flow-turn-1', actor: player, techniqueId: id });
            Globals.worldTime = { dayIndex: 0, timeMinutes: 1 };
            const options = { operationId: 'flow-refresh', turnId: 'flow-turn-2', actor: player, techniqueId: id };
            const refreshed = await TechniqueService.execute(options);
            assert.ok(Math.abs(player.health - maximum * 0.41) < 1e-9);
            const effects = player.getIntrinsicStatusEffects().filter(effect => effect.techniqueProvenance?.techniqueId === id);
            assert.equal(effects.length, 1);
            assert.equal(effects[0].needBars[0].percentDelta, 1);
            assert.deepEqual(await TechniqueService.execute(options), refreshed);
            assert.ok(Math.abs(player.health - maximum * 0.41) < 1e-9);
        } finally {
            Globals.worldTime = oldTime;
        }
    }, { needBarsYaml });
});
