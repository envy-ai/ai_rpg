const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempPlayerDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-player-relationships-'));

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
