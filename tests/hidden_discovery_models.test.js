const test = require('node:test');
const assert = require('node:assert/strict');

const Thing = require('../Thing.js');
const LocationExit = require('../LocationExit.js');
const {
    normalizeDiscoveryDifficulty,
    runAutomaticHiddenDiscoveryForFirstEntry,
    assertThingVisibleToPlayerForInteraction,
    assertExitVisibleToPlayerForTravel
} = require('../HiddenDiscovery.js');

test.afterEach(() => Thing.clear());

test('difficulty labels normalize and hidden pairs persist atomically', () => {
    assert.equal(normalizeDiscoveryDifficulty(' very-hard '), 'Very Hard');
    assert.throws(() => new Thing({ name: 'Bad', hiddenFromPlayer: true }), /required/);
    assert.throws(() => new LocationExit({ destination: 'elsewhere', discoveryDifficulty: 'Hard' }), /must be null/);

    const thing = new Thing({ id: 'hidden-model-thing', name: 'Secret Key', description: 'A secret key.', thingType: 'item', hiddenFromPlayer: true, discoveryDifficulty: 'hard', enrichStatusEffects: false });
    const hydrated = Thing.fromJSON(thing.toJSON(), { register: false });
    assert.equal(hydrated.hiddenFromPlayer, true);
    assert.equal(hydrated.discoveryDifficulty, 'Hard');
    assert.equal(Thing.fromJSON({ id: 'legacy-model-thing', name: 'Legacy', description: 'Legacy thing.', thingType: 'item' }, { register: false }).hiddenFromPlayer, false);
    thing.setHiddenDiscovery({ hiddenFromPlayer: false, discoveryDifficulty: null });
    assert.deepEqual([thing.hiddenFromPlayer, thing.discoveryDifficulty], [false, null]);
});

test('hidden state participates in stack identity and copies', () => {
    const visible = new Thing({ name: 'Coin', description: 'A coin.', thingType: 'item', count: 1, enrichStatusEffects: false });
    const hidden = new Thing({ name: 'Coin', description: 'A coin.', thingType: 'item', count: 1, hiddenFromPlayer: true, discoveryDifficulty: 'Easy', enrichStatusEffects: false });
    assert.notEqual(visible.combinerMechanicsChecksum, hidden.combinerMechanicsChecksum);
    const copy = hidden.copy();
    assert.deepEqual([copy.hiddenFromPlayer, copy.discoveryDifficulty], [true, 'Easy']);
});

test('synthetic reverse exits default visible unless explicitly hidden', () => {
    const exit = new LocationExit({ destination: 'dest', description: 'secret door', hiddenFromPlayer: true, discoveryDifficulty: 'Hard' });
    const reverse = exit.createReverse('return door', { destination: 'origin' });
    assert.deepEqual([reverse.hiddenFromPlayer, reverse.discoveryDifficulty], [false, null]);
    const hiddenReverse = exit.createReverse('secret return', { destination: 'origin', hiddenFromPlayer: true, discoveryDifficulty: 'Legendary' });
    assert.deepEqual([hiddenReverse.hiddenFromPlayer, hiddenReverse.discoveryDifficulty], [true, 'Legendary']);
});

test('automatic first-entry discovery rolls independently and never rerolls revisits', async () => {
    const item = new Thing({ name: 'Cache', description: 'A cache.', thingType: 'item', hiddenFromPlayer: true, discoveryDifficulty: 'Easy', enrichStatusEffects: false });
    const scenery = new Thing({ name: 'Rune', description: 'A rune.', thingType: 'scenery', hiddenFromPlayer: true, discoveryDifficulty: 'Hard', enrichStatusEffects: false });
    const exit = new LocationExit({ destination: 'dest', description: 'Crack', hiddenFromPlayer: true, discoveryDifficulty: 'Legendary' });
    const location = {
        id: 'arrival', baseLevel: 7, things: [item, scenery],
        getAvailableDirections: () => ['north'], getExit: () => exit
    };
    const difficulties = [];
    const result = await runAutomaticHiddenDiscoveryForFirstEntry({
        player: { id: 'player' }, location, wasVisitedBeforeArrival: false,
        perceptionAttribute: 'Awareness', perceptionSkill: 'Notice',
        resolveActionOutcome: ({ plausibility }) => {
            difficulties.push(plausibility.skillCheck.difficulty);
            return { success: difficulties.length !== 2, reason: plausibility.reason, skill: 'Notice', locationLevel: location.baseLevel };
        }
    });
    assert.deepEqual(difficulties, ['Easy', 'Hard', 'Legendary']);
    assert.equal(result.checks.length, 3);
    assert.equal(result.locationRefreshRequested, true);
    assert.equal(item.hiddenFromPlayer, false);
    assert.equal(scenery.hiddenFromPlayer, true);
    assert.equal(exit.hiddenFromPlayer, false);
    const revisit = await runAutomaticHiddenDiscoveryForFirstEntry({ player: {}, location, wasVisitedBeforeArrival: true, perceptionAttribute: 'Awareness', resolveActionOutcome: () => { throw new Error('must not roll'); } });
    assert.equal(revisit.checks.length, 0);
    assert.throws(() => assertThingVisibleToPlayerForInteraction(scenery), /hidden Thing/);
    exit.setHiddenDiscovery({ hiddenFromPlayer: true, discoveryDifficulty: 'Easy' });
    assert.throws(() => assertExitVisibleToPlayerForTravel(exit), /hidden exit/);
});
