const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempPlayerDefs() {
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-player-declined-abilities-'));

  const writeFile = (relativePath, content) => {
    const targetPath = path.join(tempBaseDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
  };

  writeFile('defs/attributes.yaml', `
attributes:
  insight:
    label: Insight
    default: 10
`);
  writeFile('defs/gear_slots.yaml', 'gear_slots: {}\n');
  writeFile('defs/dispositions.yaml', 'dispositions: {}\nrange: {}\n');
  writeFile('defs/need_bars.yaml', 'need_bars: {}\n');

  return tempBaseDir;
}

function withTempPlayerEnvironment(run) {
  const tempBaseDir = createTempPlayerDefs();
  const previousBaseDir = Globals.baseDir;
  const previousConfig = Globals.config;

  Player.clearRuntimeRegistries();
  Globals.baseDir = tempBaseDir;
  Globals.config = {
    ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
    baseHealthPerLevel: 10,
    formulas: {
      character_creation: {
        attribute_pool_formula: '0',
        skill_pool_formula: '0',
        max_attribute: '18',
        max_skill: '10'
      }
    }
  };
  Player.reloadDefinitionCaches({ refreshInstances: false });

  try {
    run();
  } finally {
    Player.clearRuntimeRegistries();
    Globals.baseDir = previousBaseDir;
    Globals.config = previousConfig;
    Player.reloadDefinitionCaches({ refreshInstances: false });
    fs.rmSync(tempBaseDir, { recursive: true, force: true });
  }
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
