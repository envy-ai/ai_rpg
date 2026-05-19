const test = require('node:test');
const assert = require('node:assert/strict');

const Globals = require('../Globals.js');

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
