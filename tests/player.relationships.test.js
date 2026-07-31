const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../Player.js');
const {
    withTempPlayerEnvironment: withTempPlayerEnvironmentBase
} = require('./helpers/needBarFixtures.js');

function withTempPlayerEnvironment(run) {
    return withTempPlayerEnvironmentBase({
        prefix: 'ai-rpg-player-relationships-',
        attributes: [
            { id: 'insight', label: 'Insight', default: 10 }
        ],
        configStyle: 'standard-force-health'
    }, run);
}

test('relationships persist as sparse target-id to short-label mappings', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'char-npc',
            name: 'Mira',
            isNPC: true,
            relationships: {
                'char-rival': 'old rival',
                'char-patron': 'trusted patron'
            }
        });

        assert.deepEqual(npc.getRelationships(), {
            'char-rival': 'old rival',
            'char-patron': 'trusted patron'
        });
        assert.equal(npc.relationships['char-rival'], 'old rival');
        assert.equal(npc.getRelationship('char-patron'), 'trusted patron');

        const snapshot = npc.getRelationships();
        snapshot['char-rival'] = 'mutated elsewhere';
        assert.equal(npc.getRelationship('char-rival'), 'old rival');

        const status = npc.getStatus();
        assert.deepEqual(status.relationships, {
            'char-rival': 'old rival',
            'char-patron': 'trusted patron'
        });

        const saved = npc.toJSON();
        assert.deepEqual(saved.relationships, {
            'char-rival': 'old rival',
            'char-patron': 'trusted patron'
        });

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.deepEqual(loaded.getRelationships(), {
            'char-rival': 'old rival',
            'char-patron': 'trusted patron'
        });
    });
});

test('relationship mutators set and remove individual target labels', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'char-npc',
            name: 'Mira',
            isNPC: true
        });
        const ally = new Player({
            id: 'char-ally',
            name: 'Sera',
            isNPC: true
        });

        assert.equal(npc.getRelationship(ally), null);
        assert.equal(npc.setRelationship(ally, 'former rival from old academy days'), 'former rival from old academy days');
        assert.equal(npc.getRelationship('char-ally'), 'former rival from old academy days');
        assert.equal(npc.removeRelationship(ally), true);
        assert.equal(npc.getRelationship(ally), null);
        assert.equal(npc.removeRelationship(ally), false);
    });
});

test('relationship labels must be six words or fewer', () => {
    withTempPlayerEnvironment(() => {
        assert.throws(
            () => new Player({
                id: 'char-npc',
                name: 'Mira',
                isNPC: true,
                relationships: {
                    'char-target': 'too many words for a relationship label'
                }
            }),
            /six words or fewer/i
        );
    });
});

test('relationships cannot target the owning character', () => {
    withTempPlayerEnvironment(() => {
        assert.throws(
            () => new Player({
                id: 'char-npc',
                name: 'Mira',
                isNPC: true,
                relationships: {
                    'char-npc': 'self'
                }
            }),
            /cannot target the owning character/i
        );
    });
});
