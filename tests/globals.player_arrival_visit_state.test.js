const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');
const Player = require('../Player.js');
const Region = require('../Region.js');
const Location = require('../Location.js');

function clearLocationRegistry() {
    for (const location of Location.getAll()) {
        Location.removeFromIndex(location);
    }
}

test.afterEach(() => {
    Globals.clearPlayerArrivalVisitStates();
    Globals.currentPlayer = null;
    Player.clearRuntimeRegistries();
    clearLocationRegistry();
    Region.clear();
});

test('recordPlayerArrivalVisitState snapshots pre-move lastVisitedTime', () => {
    Globals.clearPlayerArrivalVisitStates();
    try {
        const destination = {
            id: 'test-arrival-snapshot-location',
            visited: true,
            lastVisitedTime: 120
        };

        assert.equal(Globals.recordPlayerArrivalVisitState(destination), true);
        destination.lastVisitedTime = 180;

        assert.equal(Globals.getPlayerArrivalWasVisitedBeforeMove(destination.id), true);
        assert.equal(Globals.getPlayerArrivalLastVisitedTimeBeforeMove(destination.id), 120);
    } finally {
        Globals.clearPlayerArrivalVisitStates();
    }
});

test('Player.setLocation snapshots destination visit state before marking it visited', () => {
    const previousConfig = Globals.config;
    Globals.config = {
        ...(previousConfig && typeof previousConfig === 'object' ? previousConfig : {}),
        baseHealthPerLevel: Number.isFinite(previousConfig?.baseHealthPerLevel)
            ? previousConfig.baseHealthPerLevel
            : 10
    };

    try {
        const region = new Region({
            id: 'arrival-snapshot-region',
            name: 'Arrival Snapshot Region',
            description: 'A region for arrival snapshot tests.'
        });
        const origin = new Location({
            id: 'arrival-snapshot-origin',
            name: 'Origin',
            description: 'The origin.',
            regionId: region.id,
            visited: true,
            lastVisitedTime: 170
        });
        const destination = new Location({
            id: 'arrival-snapshot-destination',
            name: 'Destination',
            description: 'The destination.',
            regionId: region.id,
            visited: true,
            lastVisitedTime: 120
        });
        const player = new Player({
            id: 'arrival-snapshot-player',
            name: 'Baato',
            description: 'A test player.',
            location: origin.id,
            elapsedTime: 180
        });
        Globals.currentPlayer = player;
        Globals.clearPlayerArrivalVisitStates();

        player.setLocation(destination.id);

        assert.equal(Globals.getPlayerArrivalWasVisitedBeforeMove(destination.id), true);
        assert.equal(Globals.getPlayerArrivalLastVisitedTimeBeforeMove(destination.id), 120);
        assert.equal(destination.lastVisitedTime, 180);
    } finally {
        Globals.config = previousConfig;
    }
});
