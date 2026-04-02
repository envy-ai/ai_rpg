const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Utils = require('../Utils.js');

function makeTempSaveDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-save-'));
}

test('writeSerializedGameState persists per-game config override YAML alongside save data', () => {
    const saveDir = makeTempSaveDir();

    try {
        Utils.writeSerializedGameState(saveDir, {
            gameWorld: {},
            chatHistory: [],
            generatedImages: {},
            things: {},
            players: {},
            factions: {},
            skills: [],
            metadata: {},
            pendingRegionStubs: {},
            worldTime: null,
            calendarDefinition: null,
            gameConfigOverrideYaml: 'mods:\n  sample:\n    enabled: false\n'
        });

        const reloaded = Utils.loadSerializedGameState(saveDir);
        assert.equal(reloaded.gameConfigOverrideYaml, 'mods:\n  sample:\n    enabled: false\n');
    } finally {
        fs.rmSync(saveDir, { recursive: true, force: true });
    }
});
