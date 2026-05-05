const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempPlayerDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-player-ai-notes-'));

    const writeFile = (relativePath, content) => {
        const targetPath = path.join(tempBaseDir, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    };

    writeFile('defs/attributes.yaml', `
attributes:
  strength:
    label: Strength
    default: 5
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
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10,
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

test('aiNotes persist and appear in player status', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'ai-notes-npc',
            name: 'Mira',
            isNPC: true,
            aiNotes: 'Mira will intervene if an ally is bleeding.'
        });

        assert.equal(npc.aiNotes, 'Mira will intervene if an ally is bleeding.');

        const status = npc.getStatus();
        assert.equal(status.aiNotes, 'Mira will intervene if an ally is bleeding.');
        assert.equal(status.personality.aiNotes, 'Mira will intervene if an ally is bleeding.');

        const saved = npc.toJSON();
        assert.equal(saved.aiNotes, 'Mira will intervene if an ally is bleeding.');
        assert.equal(saved.personality.aiNotes, 'Mira will intervene if an ally is bleeding.');

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.aiNotes, 'Mira will intervene if an ally is bleeding.');
        assert.equal(loaded.toJSON().aiNotes, 'Mira will intervene if an ally is bleeding.');
    });
});

test('legacy nested personality aiNotes hydrate when top-level aiNotes is missing', () => {
    withTempPlayerEnvironment(() => {
        const loaded = Player.fromJSON({
            id: 'nested-ai-notes-npc',
            name: 'Tovan',
            isNPC: true,
            personality: {
                aiNotes: 'Tovan flees if outnumbered.'
            }
        });

        assert.equal(loaded.aiNotes, 'Tovan flees if outnumbered.');
    });
});
