const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
    createTempDefsDir,
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function createTempNeedBarDefs(needBarsYaml) {
    return createTempDefsDir({
        prefix: 'ai-rpg-need-applicability-',
        needBarsYaml
    });
}

function withTempNeedBarEnvironment(tempBaseDir, run) {
    return withTempPlayerEnvironmentBase({ tempBaseDir }, run);
}

test('need bar applicability persists explicit true/false values across save and load', () => {
    const tempBaseDir = createTempNeedBarDefs(`
need_bars:
  hunger:
    name: Hunger
    player: false
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 25
  rest:
    name: Rest
    player: false
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 50
`);

    withTempNeedBarEnvironment(tempBaseDir, () => {
        const npc = new Player({
            id: 'need-applicability-npc',
            name: 'Quartermaster Vale',
            isNPC: true,
            needBars: [
                { id: 'rest', value: 35 }
            ],
            needBarApplicability: {
                hunger: false,
                rest: true
            }
        });

        assert.deepEqual(npc.getNeedBarApplicability(), {
            hunger: false,
            rest: true
        });
        assert.deepEqual(
            npc.getNeedBars({ scope: 'stored' }).map(bar => bar.id),
            ['rest']
        );
        assert.equal(npc.getNeedBarValue('rest'), 35);

        const saved = npc.toJSON();

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.deepEqual(loaded.getNeedBarApplicability(), {
            hunger: false,
            rest: true
        });
        assert.deepEqual(
            loaded.getNeedBars({ scope: 'stored' }).map(bar => bar.id),
            ['rest']
        );
        assert.equal(loaded.getNeedBarValue('rest'), 35);
        assert.equal(loaded.getNeedBarValue('hunger'), null);
    });
});

test('legacy saves missing need bar state load storable bars as 100 and applicable', () => {
    const tempBaseDir = createTempNeedBarDefs(`
need_bars:
  food:
    name: Food
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 20
  rest:
    name: Rest
    player: true
    party: false
    non_party: false
    min: 0
    max: 100
    initial: 35
`);

    withTempNeedBarEnvironment(tempBaseDir, () => {
        const player = new Player({
            id: 'legacy-need-player',
            name: 'Baato'
        });
        const legacySave = player.toJSON();
        delete legacySave.needBars;
        delete legacySave.needBarApplicability;

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(legacySave);
        assert.deepEqual(loaded.getNeedBarApplicability(), {
            food: true,
            rest: true
        });
        assert.equal(loaded.getNeedBarValue('food'), 100);
        assert.equal(loaded.getNeedBarValue('rest'), 100);
    });
});

test('setNeedBarApplicability preserves kept values, drops disabled bars, and restores re-enabled bars at 100', () => {
    const tempBaseDir = createTempNeedBarDefs(`
need_bars:
  hunger:
    name: Hunger
    player: false
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 20
  rest:
    name: Rest
    player: false
    party: true
    non_party: true
    min: 0
    max: 100
    initial: 50
`);

    withTempNeedBarEnvironment(tempBaseDir, () => {
        const npc = new Player({
            id: 'need-applicability-edit-npc',
            name: 'Cabnia Slatherbottom',
            isNPC: true,
            needBars: [
                { id: 'hunger', value: 42 },
                { id: 'rest', value: 77 }
            ],
            needBarApplicability: {
                hunger: true,
                rest: true
            }
        });

        npc.setNeedBarApplicability({
            hunger: false,
            rest: true
        });

        assert.deepEqual(npc.getNeedBarApplicability(), {
            hunger: false,
            rest: true
        });
        assert.equal(npc.getNeedBarValue('hunger'), null);
        assert.equal(npc.getNeedBarValue('rest'), 77);

        npc.setNeedBarApplicability({
            hunger: true,
            rest: true
        });

        assert.deepEqual(npc.getNeedBarApplicability(), {
            hunger: true,
            rest: true
        });
        assert.equal(npc.getNeedBarValue('hunger'), 100);
        assert.equal(npc.getNeedBarValue('rest'), 77);
    });
});
