const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Utils = require('../Utils.js');
const IdGenerator = require('../IdGenerator.js');
const Globals = require('../Globals.js');
const MysteryBox = require('../MysteryBox.js');

function makeTempSaveDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-mystery-box-save-'));
}

test('MysteryBox creates searchable free-form mystery notes with aliases', () => {
    IdGenerator.reset();
    MysteryBox.clear();

    const box = new MysteryBox({
        name: 'Captain Ellison',
        keys: ['ELLISON-SEVEN', 'Omega-7 captain'],
        text: 'Ellison used the protocol as a dead-man switch for buried evidence.',
        mentions: [
            {
                name: 'ELLISON-SEVEN',
                context: 'Siggy recovered the protocol phrase.',
                sourceEntryId: 'entry_1',
                worldTime: { dayIndex: 2, timeMinutes: 930 }
            }
        ]
    });

    assert.equal(box.id, 'mystery_1');
    assert.equal(MysteryBox.getByKey('captain ellison'), box);
    assert.equal(MysteryBox.getByKey('Omega-7 Captain'), box);
    assert.equal(MysteryBox.getByKey('ELLISON SEVEN'), box);
    assert.deepEqual(box.toJSON().keys, [
        'Captain Ellison',
        'ELLISON-SEVEN',
        'Omega-7 captain'
    ]);
    assert.match(box.toJSON().text, /dead-man switch/);
    assert.equal(box.toJSON().mentions[0].sourceEntryId, 'entry_1');
});

test('MysteryBox update merges aliases and appends mention records without erasing text', () => {
    IdGenerator.reset();
    MysteryBox.clear();

    const box = new MysteryBox({
        name: 'Captain Ellison',
        text: 'Initial private note.'
    });

    box.applyUpdate({
        keys: ['Ellison', 'ELLISON-SEVEN'],
        text: 'Expanded private note.',
        mention: {
            name: 'ELLISON-SEVEN',
            context: 'The armory terminal accepted the protocol.'
        }
    });

    assert.equal(box.text, 'Expanded private note.');
    assert.equal(MysteryBox.getByKey('Ellison'), box);
    assert.equal(MysteryBox.getByKey('ELLISON SEVEN'), box);
    assert.equal(box.mentions.length, 1);
    assert.equal(box.mentions[0].context, 'The armory terminal accepted the protocol.');
});

test('MysteryBox manual edit replaces editable keys and text', () => {
    IdGenerator.reset();
    MysteryBox.clear();

    const box = new MysteryBox({
        name: 'Captain Ellison',
        keys: ['ELLISON-SEVEN', 'Omega-7 Captain'],
        text: 'Initial private note.'
    });

    box.applyManualEdit({
        name: 'Director Ellison',
        keys: ['Meridian Traitor'],
        text: ''
    });

    assert.equal(box.name, 'Director Ellison');
    assert.deepEqual(box.keys, ['Director Ellison', 'Meridian Traitor']);
    assert.equal(box.text, '');
    assert.equal(MysteryBox.getByKey('Director Ellison'), box);
    assert.equal(MysteryBox.getByKey('Meridian Traitor'), box);
    assert.equal(MysteryBox.getByKey('ELLISON-SEVEN'), null);
    assert.equal(MysteryBox.getByKey('Omega-7 Captain'), null);
});

test('serialized game state writes and loads mystery boxes', () => {
    IdGenerator.reset();
    MysteryBox.clear();
    const saveDir = makeTempSaveDir();
    const previousSceneSummaries = Globals.sceneSummaries;

    try {
        Globals.sceneSummaries = {
            serialize: () => ({}),
            load: () => {}
        };
        const box = new MysteryBox({
            name: 'The Red-Circled Photo',
            keys: ['Velikka photo'],
            text: 'The red circle marks Ellison choosing Velikka before the cascade.'
        });
        box.markResolved();

        Utils.writeSerializedGameState(saveDir, Utils.serializeGameState({
            gameLocations: new Map(),
            gameLocationExits: new Map(),
            regions: new Map(),
            chatHistory: [],
            generatedImages: new Map(),
            things: new Map(),
            players: new Map(),
            skills: new Map(),
            factions: new Map(),
            pendingRegionStubs: new Map()
        }));

        MysteryBox.clear();
        const reloaded = Utils.loadSerializedGameState(saveDir);
        Utils.hydrateGameState(reloaded, {
            gameLocations: new Map(),
            gameLocationExits: new Map(),
            regions: new Map(),
            chatHistoryRef: [],
            generatedImages: new Map(),
            things: new Map(),
            players: new Map(),
            skills: new Map(),
            factions: new Map(),
            pendingRegionStubs: new Map()
        });

        const restored = MysteryBox.getByKey('Velikka photo');
        assert.ok(restored);
        assert.equal(restored.name, 'The Red-Circled Photo');
        assert.equal(restored.resolved, true);
        assert.equal(restored.toJSON().resolved, true);
        assert.match(restored.text, /choosing Velikka/);
    } finally {
        Globals.sceneSummaries = previousSceneSummaries;
        fs.rmSync(saveDir, { recursive: true, force: true });
        MysteryBox.clear();
    }
});
