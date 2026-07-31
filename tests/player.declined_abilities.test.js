const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
  withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
  return withTempPlayerEnvironmentBase({
    prefix: 'ai-rpg-player-declined-abilities-',
    attributes: [
      { id: 'insight', label: 'Insight', default: 10 }
    ],
    configStyle: 'standard-force-health'
  }, run);
}

test('declined abilities persist as normalized ability records', () => {
  withTempPlayerEnvironment(() => {
    const player = new Player({
      id: 'char-player',
      name: 'Baato',
      declinedAbilities: [
        {
          name: 'Ash Veil',
          description: 'Raise a veil of smoke to hide movement.',
          shortDescription: 'Conceals movement behind conjured smoke',
          type: 'active',
          level: 3
        },
        'Moon Loop'
      ]
    });

    const expected = [
      {
        name: 'Ash Veil',
        description: 'Raise a veil of smoke to hide movement.',
        shortDescription: 'Conceals movement behind conjured smoke',
        type: 'Active',
        level: 3
      },
      {
        name: 'Moon Loop',
        description: '',
        shortDescription: '',
        type: 'Passive',
        level: 1
      }
    ];

    assert.deepEqual(player.getDeclinedAbilities(), expected);
    assert.deepEqual(player.getStatus().declinedAbilities, expected);
    assert.deepEqual(player.toJSON().declinedAbilities, expected);

    const clone = player.getDeclinedAbilities();
    clone[0].name = 'Mutated Elsewhere';
    assert.equal(player.getDeclinedAbilities()[0].name, 'Ash Veil');

    const saved = player.toJSON();
    Player.clearRuntimeRegistries();
    Player.reloadDefinitionCaches({ refreshInstances: false });

    const loaded = Player.fromJSON(saved);
    assert.deepEqual(loaded.getDeclinedAbilities(), expected);
  });
});

test('declined ability mutators deduplicate by case-insensitive ability name', () => {
  withTempPlayerEnvironment(() => {
    const player = new Player({
      id: 'char-player',
      name: 'Baato'
    });

    assert.equal(player.addDeclinedAbility({
      name: 'Ash Veil',
      description: 'Raise a veil of smoke to hide movement.',
      type: 'Active',
      level: 2
    }), true);
    assert.equal(player.addDeclinedAbility({
      name: ' ash veil ',
      description: 'Duplicate entry should be ignored.',
      type: 'Triggered',
      level: 4
    }), false);
    assert.equal(player.addDeclinedAbilities([
      {
        name: 'Moon Loop',
        description: 'Repeat a failed moonlit step.',
        type: 'Triggered',
        level: 2
      },
      {
        name: 'ASH VEIL',
        description: 'Duplicate entry should still be ignored.',
        type: 'Passive',
        level: 2
      }
    ]), 1);

    assert.deepEqual(player.getDeclinedAbilityNames(), ['Ash Veil', 'Moon Loop']);
    assert.deepEqual(player.getDeclinedAbilities(), [
      {
        name: 'Ash Veil',
        description: 'Raise a veil of smoke to hide movement.',
        shortDescription: '',
        type: 'Active',
        level: 2
      },
      {
        name: 'Moon Loop',
        description: 'Repeat a failed moonlit step.',
        shortDescription: '',
        type: 'Triggered',
        level: 2
      }
    ]);
  });
});
