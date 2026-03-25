const test = require('node:test');
const assert = require('node:assert/strict');

const LocationExit = require('../LocationExit.js');

test('LocationExit captures a runtime creation backtrace and does not serialize it', () => {
    const exit = new LocationExit({
        id: 'location-exit-backtrace-test',
        description: 'Airlock',
        destination: 'destination-location-id',
        bidirectional: true
    });

    assert.equal(typeof exit.backtrace, 'string');
    assert.match(exit.backtrace, /LocationExit creation backtrace/);
    assert.match(exit.backtrace, /location_exit\.backtrace\.test\.js|LocationExit\.js/);

    const serialized = exit.toJSON();
    assert.equal(Object.prototype.hasOwnProperty.call(serialized, 'backtrace'), false);
});
