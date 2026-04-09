const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Thing = require('../Thing.js');
const Utils = require('../Utils.js');

function makeTempSaveDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-thing-save-'));
}

test.afterEach(() => {
    Thing.clear();
});

test('Thing records deduped successful harvest history and formats last harvested age', () => {
    const node = new Thing({
        name: 'Berry Bush',
        description: 'A bush covered in edible berries.',
        thingType: 'scenery',
        isHarvestable: true
    });

    node.recordSuccessfulHarvest(['Red Berry', 'Blue Berry', 'Red Berry'], { harvestedAtMinutes: 1500 });
    node.recordSuccessfulHarvest(['Blue Berry', 'Golden Berry'], { harvestedAtMinutes: 3124 });

    assert.deepEqual(node.previouslyHarvestedItems, ['Red Berry', 'Blue Berry', 'Golden Berry']);
    assert.equal(node.lastHarvested, 3124);
    assert.equal(
        node.getLastHarvestedAgoText({ currentTotalMinutes: 4564 }),
        '1 day ago'
    );
});

test('Thing harvest history persists through toJSON/fromJSON and defaults missing legacy fields', () => {
    const node = new Thing({
        name: 'Mushroom Log',
        description: 'A damp log cultivated with edible mushrooms.',
        thingType: 'scenery',
        isHarvestable: true
    });

    node.recordSuccessfulHarvest(['Glowcap', 'Duskhat'], { harvestedAtMinutes: 987 });
    const saved = node.toJSON();
    const restored = Thing.fromJSON(saved);

    assert.deepEqual(restored.previouslyHarvestedItems, ['Glowcap', 'Duskhat']);
    assert.equal(restored.lastHarvested, 987);

    const legacyRestored = Thing.fromJSON({
        id: 'thing-legacy',
        name: 'Legacy Herb Patch',
        description: 'An older save entry without harvest history.',
        thingType: 'scenery',
        metadata: {
            isHarvestable: true
        }
    });

    assert.deepEqual(legacyRestored.previouslyHarvestedItems, []);
    assert.equal(legacyRestored.lastHarvested, null);
    assert.equal(legacyRestored.getLastHarvestedAgoText({ currentTotalMinutes: 500 }), null);
});

test('Thing harvest history persists through save-file write/load', () => {
    const saveDir = makeTempSaveDir();

    try {
        const node = new Thing({
            name: 'Silverleaf Patch',
            description: 'A medicinal herb patch cultivated beside the path.',
            thingType: 'scenery',
            isHarvestable: true
        });

        node.recordSuccessfulHarvest(['Silverleaf', 'Moon Dew'], { harvestedAtMinutes: 2468 });

        Utils.writeSerializedGameState(saveDir, {
            gameWorld: {},
            chatHistory: [],
            generatedImages: {},
            things: {
                [node.id]: node.toJSON()
            },
            players: {},
            factions: {},
            skills: [],
            metadata: {},
            pendingRegionStubs: {},
            worldTime: null,
            calendarDefinition: null,
            gameConfigOverrideYaml: '',
            chatSummaries: {},
            sceneSummaries: {}
        });

        const reloaded = Utils.loadSerializedGameState(saveDir);
        assert.deepEqual(reloaded.things[node.id].previouslyHarvestedItems, ['Silverleaf', 'Moon Dew']);
        assert.equal(reloaded.things[node.id].lastHarvested, 2468);

        const restored = Thing.fromJSON(reloaded.things[node.id]);
        assert.deepEqual(restored.previouslyHarvestedItems, ['Silverleaf', 'Moon Dew']);
        assert.equal(restored.lastHarvested, 2468);
    } finally {
        fs.rmSync(saveDir, { recursive: true, force: true });
    }
});
