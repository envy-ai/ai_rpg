const test = require('node:test');
const assert = require('node:assert/strict');

const Location = require('../Location.js');
const LocationExit = require('../LocationExit.js');
const Region = require('../Region.js');
const { questRewardBenefitRegistry } = require('../QuestRewardBenefitRegistry.js');
const { revealHiddenExit } = require('../HiddenDiscovery.js');

function makeWorld(prefix = 'route-reward') {
    Region.clear();
    const region = new Region({ id: `${prefix}-region`, name: 'Archive Ward', description: 'Test region.' });
    const source = new Location({ id: `${prefix}-source`, name: 'Old Gatehouse', description: 'Source.', regionId: region.id });
    const destination = new Location({ id: `${prefix}-destination`, name: 'Hidden Garden', description: 'Destination.', regionId: region.id });
    const exit = new LocationExit({
        id: `${prefix}-exit`, description: 'A concealed stair.', destination: destination.id,
        travelTimeMinutes: 4, hiddenFromPlayer: true, discoveryDifficulty: 'Hard'
    });
    const reverse = new LocationExit({
        id: `${prefix}-reverse`, description: 'The return stair.', destination: source.id,
        travelTimeMinutes: 4, hiddenFromPlayer: true, discoveryDifficulty: 'Medium'
    });
    source.addExit('down', exit);
    destination.addExit('up', reverse);
    const locations = new Map([[source.id, source], [destination.id, destination]]);
    const entry = {
        id: `knowledge-route:${source.id}:${exit.id}`,
        type: 'knowledge', subtype: 'route', targetId: exit.id,
        sourceLocationId: source.id, destinationLocationId: destination.id,
        label: 'The concealed stair into the garden', description: 'The archivist teaches the catch.'
    };
    return { source, destination, exit, reverse, entry, context: {
        player: { id: `${prefix}-player` }, findLocationById: id => locations.get(id) || null
    }};
}

function cleanup(world) {
    Location.removeFromIndex(world.source);
    Location.removeFromIndex(world.destination);
    Region.clear();
}

test('knowledge/route normalization rejects unsupported subtypes and preserves only canonical fields', () => {
    const world = makeWorld('normalize-route');
    try {
        const normalized = questRewardBenefitRegistry.normalize({ ...world.entry, ignored: 'drop me' });
        assert.deepEqual(normalized, world.entry);
        assert.throws(() => questRewardBenefitRegistry.normalize({ ...world.entry, subtype: 'lore' }), /Unsupported.*subtype/);
    } finally { cleanup(world); }
});

test('knowledge/route reveals exactly one directed exit without visiting or revealing reverse', () => {
    const world = makeWorld('apply-route');
    try {
        const result = questRewardBenefitRegistry.apply(world.entry, world.context);
        assert.equal(world.exit.hiddenFromPlayer, false);
        assert.equal(world.exit.discoveryDifficulty, null);
        assert.equal(world.reverse.hiddenFromPlayer, true);
        assert.equal(world.destination.visited, false);
        assert.equal(result.summary.destinationLocationName, 'Hidden Garden');
        assert.equal(result.summary.alreadySatisfied, false);
        assert.deepEqual(result.summary.refresh.locationIds, [world.source.id]);
    } finally { cleanup(world); }
});

test('knowledge/route accepts independent early discovery idempotently', () => {
    const world = makeWorld('already-route');
    try {
        revealHiddenExit({
            sourceLocation: world.source, exitId: world.exit.id,
            expectedDestinationLocationId: world.destination.id,
            findLocationById: world.context.findLocationById
        });
        const result = questRewardBenefitRegistry.apply(world.entry, world.context);
        assert.equal(result.alreadySatisfied, true);
        assert.equal(result.summary.alreadySatisfied, true);
        assert.match(result.summary.rewardLine, /Route already known/);
    } finally { cleanup(world); }
});

test('knowledge/route fails loudly for deleted or retargeted exact exits', () => {
    const world = makeWorld('broken-route');
    try {
        const wrong = { ...world.entry, targetId: 'replacement-exit', id: 'knowledge-route:broken-route-source:replacement-exit' };
        assert.throws(() => questRewardBenefitRegistry.apply(wrong, world.context), /no outgoing exit/);
        world.exit.destination = world.source.id;
        assert.throws(() => questRewardBenefitRegistry.apply(world.entry, world.context), /not pinned destination/);
        assert.equal(world.exit.hiddenFromPlayer, true);
    } finally { cleanup(world); }
});
