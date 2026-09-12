const test = require('node:test');
const assert = require('node:assert/strict');

const Events = require('../Events.js');
const Location = require('../Location.js');
const Region = require('../Region.js');

function setup() {
    Location.clear();
    Region.clear();
    const region = new Region({ id: 'danger-event-region', name: 'Ash March', description: 'A test region.', dangerModifier: 1 });
    const location = new Location({ id: 'danger-event-location', name: 'Broken Gate', description: 'A test location.', regionId: region.id, dangerLevel: 3 });
    const gameLocations = new Map([[location.id, location]]);
    const regions = new Map([[region.id, region]]);
    Events.initialize({ Location, gameLocations, regions });
    return { region, location };
}

test('danger_level_change XML strictly parses repeatable location and region entries', () => {
    setup();
    const parsed = Events._parseXmlEventCheckResponse(`
      <events>
        <dangerLevelChange><targetType>location</targetType><target>Broken Gate</target><direction>increase</direction><amount>4</amount><reason>The seal broke.</reason></dangerLevelChange>
        <dangerLevelChange><targetType>region</targetType><target>Ash March</target><direction>decrease</direction><amount>2</amount><reason>The storm ended.</reason></dangerLevelChange>
      </events>`);
    assert.deepEqual(parsed.structured.parsed.danger_level_change.map(entry => entry.delta), [4, -2]);

    assert.throws(() => Events._parseXmlEventCheckResponse(
        '<events><dangerLevelChange><targetType>world</targetType><target>X</target><direction>increase</direction><amount>1</amount><reason>R</reason></dangerLevelChange></events>'
    ), /targetType/);
    assert.throws(() => Events._parseXmlEventCheckResponse(
        '<events><dangerLevelChange><targetType>region</targetType><target>X</target><direction>increase</direction><amount>0</amount><reason>R</reason></dangerLevelChange></events>'
    ), /positive integer/);
    assert.throws(() => Events._parseXmlEventCheckResponse(
        '<events><dangerLevelChange><targetType>region</targetType><target>X</target><direction>increase</direction><amount>1</amount></dangerLevelChange></events>'
    ), /exactly one non-empty <reason>/);
});

test('danger_level_change mutates only the requested stored value and reports effective values', () => {
    const { region, location } = setup();
    const entries = [
        { targetType: 'location', target: location.id, direction: 'increase', amount: 9, delta: 9, reason: 'Rift' },
        { targetType: 'region', target: region.name, direction: 'decrease', amount: 4, delta: -4, reason: 'Ward' }
    ];
    const context = { location, dangerLevelChanges: [] };
    Events._handlers.danger_level_change.call(Events, entries, context);
    assert.equal(location.dangerLevel, 12);
    assert.equal(region.dangerModifier, -3);
    assert.equal(context.dangerLevelChanges.length, 2);
    assert.deepEqual(context.dangerLevelChanges.map(entry => [entry.storedBefore, entry.storedAfter]), [[3, 12], [1, -3]]);
    assert.deepEqual(context.dangerLevelChanges.map(entry => [entry.effectiveBefore, entry.effectiveAfter]), [[4, 5], [5, 5]]);
});

test('danger_level_change resolves all targets before mutation', () => {
    const { location } = setup();
    const entries = [
        { targetType: 'location', target: location.id, direction: 'increase', amount: 1, delta: 1, reason: 'Valid' },
        { targetType: 'region', target: 'Missing', direction: 'increase', amount: 1, delta: 1, reason: 'Invalid' }
    ];
    assert.throws(() => Events._handlers.danger_level_change.call(Events, entries, { location }), /unknown region/);
    assert.equal(location.dangerLevel, 3);
});

test('danger_level_change applies repeated same-target entries cumulatively after whole-batch validation', () => {
    const { region, location } = setup();
    const entries = [
        { targetType: 'location', target: location.id, direction: 'increase', amount: 4, delta: 4, reason: 'Breach' },
        { targetType: 'location', target: location.name, direction: 'decrease', amount: 2, delta: -2, reason: 'Patrol' },
        { targetType: 'region', target: region.id, direction: 'increase', amount: 3, delta: 3, reason: 'War' },
        { targetType: 'region', target: region.name, direction: 'decrease', amount: 1, delta: -1, reason: 'Treaty' }
    ];
    const context = { location, dangerLevelChanges: [] };

    Events._handlers.danger_level_change.call(Events, entries, context);

    assert.equal(location.dangerLevel, 5);
    assert.equal(region.dangerModifier, 3);
    assert.deepEqual(
        context.dangerLevelChanges.map(entry => [entry.storedBefore, entry.storedAfter]),
        [[3, 7], [7, 5], [1, 4], [4, 3]]
    );
});
