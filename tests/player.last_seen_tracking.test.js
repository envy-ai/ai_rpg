const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function createTempPlayerDefs() {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-last-seen-'));

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
    const previousCurrentPlayer = Globals.currentPlayer;

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
        Globals.currentPlayer = previousCurrentPlayer;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
}

test('NPC last-seen fields update only for NPCs sharing the player location', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'last-seen-player',
            name: 'Baato',
            location: 'town-square'
        });
        const presentNpc = new Player({
            id: 'last-seen-present',
            name: 'Mira',
            isNPC: true,
            location: 'town-square'
        });
        const absentNpc = new Player({
            id: 'last-seen-absent',
            name: 'Orrin',
            isNPC: true,
            location: 'old-road'
        });

        const updated = Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 135,
            locationId: 'town-square'
        });

        assert.deepEqual(updated.map(actor => actor.id), ['last-seen-present']);
        assert.equal(presentNpc.last_seen_time, 135);
        assert.equal(presentNpc.last_seen_location, 'town-square');
        assert.equal(presentNpc.was_in_player_location_previous_round, true);
        assert.equal(absentNpc.last_seen_time, null);
        assert.equal(absentNpc.last_seen_location, null);
        assert.equal(absentNpc.was_in_player_location_previous_round, false);

        presentNpc.setLocation(null);
        const secondUpdate = Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 180,
            locationId: 'town-square'
        });

        assert.deepEqual(secondUpdate, []);
        assert.equal(presentNpc.last_seen_time, 135);
        assert.equal(presentNpc.last_seen_location, 'town-square');
        assert.equal(presentNpc.was_in_player_location_previous_round, false);
    });
});

test('NPC last-seen previous-round flag stays false for newly encountered NPCs', () => {
    withTempPlayerEnvironment(() => {
        const player = new Player({
            id: 'last-seen-moving-player',
            name: 'Baato',
            location: 'old-road'
        });
        const originNpc = new Player({
            id: 'last-seen-origin',
            name: 'Orrin',
            isNPC: true,
            location: 'old-road'
        });
        const destinationNpc = new Player({
            id: 'last-seen-destination',
            name: 'Mira',
            isNPC: true,
            location: 'town-square',
            last_seen_time: 60,
            last_seen_location: 'market'
        });

        const sharedAtTurnStart = Player.getNpcIdsSharingPlayerLocation({
            player,
            locationId: 'old-road'
        });
        assert.deepEqual(sharedAtTurnStart, ['last-seen-origin']);

        Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 135,
            locationId: 'town-square',
            previouslySharedNpcIds: sharedAtTurnStart
        });

        assert.equal(originNpc.was_in_player_location_previous_round, false);
        assert.equal(destinationNpc.last_seen_time, 135);
        assert.equal(destinationNpc.last_seen_location, 'town-square');
        assert.equal(destinationNpc.was_in_player_location_previous_round, false);

        const sharedAtNextTurnStart = Player.getNpcIdsSharingPlayerLocation({
            player,
            locationId: 'town-square'
        });
        assert.deepEqual(sharedAtNextTurnStart, ['last-seen-destination']);

        Player.recordNpcSightingsForCurrentPlayer({
            player,
            worldTimeMinutes: 180,
            locationId: 'town-square',
            previouslySharedNpcIds: sharedAtNextTurnStart
        });

        assert.equal(destinationNpc.last_seen_time, 180);
        assert.equal(destinationNpc.last_seen_location, 'town-square');
        assert.equal(destinationNpc.was_in_player_location_previous_round, true);
    });
});

test('NPC last-seen fields persist through Player JSON', () => {
    withTempPlayerEnvironment(() => {
        const npc = new Player({
            id: 'last-seen-save',
            name: 'Kess',
            isNPC: true,
            last_seen_time: 240,
            last_seen_location: 'dockside',
            was_in_player_location_previous_round: true
        });

        const saved = npc.toJSON();
        assert.equal(saved.last_seen_time, 240);
        assert.equal(saved.last_seen_location, 'dockside');
        assert.equal(saved.was_in_player_location_previous_round, true);

        Player.clearRuntimeRegistries();
        Player.reloadDefinitionCaches({ refreshInstances: false });

        const loaded = Player.fromJSON(saved);
        assert.equal(loaded.last_seen_time, 240);
        assert.equal(loaded.last_seen_location, 'dockside');
        assert.equal(loaded.was_in_player_location_previous_round, true);

        const legacyLoaded = Player.fromJSON({
            id: 'last-seen-legacy',
            name: 'Legacy NPC',
            isNPC: true
        });
        assert.equal(legacyLoaded.last_seen_time, null);
        assert.equal(legacyLoaded.last_seen_location, null);
        assert.equal(legacyLoaded.was_in_player_location_previous_round, false);
    });
});
