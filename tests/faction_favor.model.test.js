const test = require('node:test');
const assert = require('node:assert/strict');

const Faction = require('../Faction.js');
const Globals = require('../Globals.js');
const Player = require('../Player.js');
const { normalizeFavorList } = require('../FactionFavor.js');

const TIERS = [
    { threshold: -20, label: 'Distrusted' },
    { threshold: 0, label: 'Neutral' },
    { threshold: 20, label: 'Friend' },
    { threshold: 60, label: 'Ally' }
];

const favor = (overrides = {}) => ({
    name: 'Safe Lodging',
    shortDescription: 'A night in a guild house.',
    description: 'The guild puts you up for the night.',
    minThreshold: 20,
    cooldown: '3 days',
    presence: 'faction-presence',
    effect: { type: 'restore-needs', params: { bars: [{ needBar: 'Rest', percentage: 100 }] } },
    ...overrides
});

test.afterEach(() => Faction.clear());

test('favors validate, allocate ids, and round-trip through toJSON/fromJSON', () => {
    const faction = new Faction({ name: 'Ashen Guild', reputationTiers: TIERS, favors: [favor()] });
    const [stored] = faction.favors;
    assert.match(stored.id, /^favor_safe_lodging/);
    assert.equal(stored.cooldownMinutes, 3 * 24 * 60);
    assert.equal(stored.requiresTarget, false);
    const json = faction.toJSON();
    Faction.clear();
    const restored = Faction.fromJSON(json);
    assert.deepEqual(restored.favors, json.favors);
    assert.equal(Faction.findFavor(stored.id).faction, restored);
});

test('older factions without favors load with an empty list', () => {
    const restored = Faction.fromJSON({ id: 'faction_old', name: 'Old Order', reputationTiers: TIERS });
    assert.deepEqual(restored.favors, []);
});

test('favor validation names the faction, favor, field and valid values', () => {
    assert.throws(
        () => new Faction({ name: 'Ashen Guild', reputationTiers: TIERS, favors: [favor({ minThreshold: 40 })] }),
        /favor "Safe Lodging"\.minThreshold 40 does not match a reputation tier above 0\. Valid thresholds: 20, 60/
    );
    assert.throws(() => normalizeFavorList([favor({ minThreshold: 0 })], { tiers: TIERS }), /Valid thresholds: 20, 60/);
    assert.throws(() => normalizeFavorList([favor({ cooldown: 'soon' })], { tiers: TIERS, register: false }), /not a valid duration/);
    assert.throws(() => normalizeFavorList([favor({ requiresTarget: true })], { tiers: TIERS, register: false }), /targetPrompt is required/);
    assert.throws(() => normalizeFavorList([favor({ presence: 'nearby' })], { tiers: TIERS, register: false }), /Use one of: anywhere, faction-presence/);
    assert.throws(() => normalizeFavorList([favor({ effect: { type: 'teleport' } })], { tiers: TIERS, register: false }), /Unknown favor effect type "teleport"/);
    assert.throws(() => normalizeFavorList([favor({ effect: { type: 'grant-currency', params: { amount: 0 } } })], { tiers: TIERS, register: false }), /amount must be a positive whole number/);
    assert.throws(() => normalizeFavorList([favor(), favor()], { tiers: TIERS, register: false }), /more than one favor named "Safe Lodging"/);
});

test('a tier edit that would orphan a favor throws; combined replacement validates together', () => {
    const faction = new Faction({ name: 'Ashen Guild', reputationTiers: TIERS, favors: [favor()] });
    assert.throws(() => { faction.reputationTiers = [{ threshold: 0 }, { threshold: 50 }]; }, /Valid thresholds: 50/);
    assert.equal(faction.reputationTiers.length, 4, 'tiers stay unchanged after a rejected edit');
    const [stored] = faction.favors;
    faction.setReputationTiersAndFavors(
        [{ threshold: 0 }, { threshold: 50 }],
        [{ ...stored, minThreshold: 50 }]
    );
    assert.equal(faction.favors[0].id, stored.id);
    assert.equal(faction.favors[0].minThreshold, 50);
});

test('setFavor updates presentation fields without changing the id', () => {
    const faction = new Faction({ name: 'Ashen Guild', reputationTiers: TIERS, favors: [favor()] });
    const [stored] = faction.favors;
    faction.setFavor(stored.id, { imageId: 'img_1', imagePrompt: 'A brass key.' });
    assert.equal(faction.getFavor(stored.id).imageId, 'img_1');
    assert.throws(() => faction.setFavor(stored.id, { id: 'favor_other' }), /cannot be changed/);
    assert.equal(faction.removeFavor(stored.id), true);
    assert.equal(faction.getFavor(stored.id), null);
});

test('player favor usage round-trips and validates', () => {
    const previousConfig = Globals.config;
    Player.clearRuntimeRegistries();
    const yaml = require('js-yaml');
    const fs = require('node:fs');
    const path = require('node:path');
    Globals.config = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'config.default.yaml'), 'utf8'));
    try {
        const player = new Player({ id: 'favor-usage-player', name: 'Baato', favorUsage: { favor_a: { lastUsedWorldMinute: 10 } } });
        player.recordFavorUse('favor_b', 25);
        assert.deepEqual(player.getFavorUsageMap(), {
            favor_a: { lastUsedWorldMinute: 10 },
            favor_b: { lastUsedWorldMinute: 25 }
        });
        const json = player.toJSON();
        assert.deepEqual(json.favorUsage, player.getFavorUsageMap());
        assert.equal(player.removeFavorUsage('favor_a'), true);
        assert.equal(player.getFavorUsage('favor_a'), null);
        assert.throws(() => player.recordFavorUse('favor_c', -1), /non-negative whole world minute/);
        assert.throws(() => new Player({ id: 'favor-usage-bad', name: 'Bad', favorUsage: { favor_a: { lastUsedWorldMinute: 'x' } } }),
            /lastUsedWorldMinute must be a non-negative whole number/);
    } finally {
        Player.clearRuntimeRegistries();
        Globals.config = previousConfig;
    }
});
