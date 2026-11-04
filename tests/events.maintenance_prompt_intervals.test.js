const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const Events = require('../Events.js');

test('maintenance prompt intervals default to every eligible check and validate configured values', () => {
    assert.equal(Events.resolveHousekeepingInterval({}), 1);
    assert.equal(Events.resolveQuestCheckInterval({}), 1);
    assert.equal(Events.resolveFactionHousekeepingInterval({}), 11);
    assert.equal(Events.resolveFactionHousekeepingInterval({ faction_housekeeping: { interval: '7' } }), 7);
    assert.equal(Events.resolveHousekeepingInterval({ housekeeping: { interval: '3' } }), 3);
    assert.equal(Events.resolveQuestCheckInterval({ quest_checks: { interval: 4 } }), 4);

    for (const invalid of [0, -1, 1.5, 'invalid']) {
        assert.throws(
            () => Events.resolveHousekeepingInterval({ housekeeping: { interval: invalid } }),
            /housekeeping\.interval must be an integer greater than or equal to 1/i
        );
        assert.throws(
            () => Events.resolveFactionHousekeepingInterval({ faction_housekeeping: { interval: invalid } }),
            /faction_housekeeping\.interval must be an integer greater than or equal to 1/i
        );
        assert.throws(
            () => Events.resolveQuestCheckInterval({ quest_checks: { interval: invalid } }),
            /quest_checks\.interval must be an integer greater than or equal to 1/i
        );
    }
});

test('default config and config page expose both maintenance intervals', () => {
    const rootDir = path.join(__dirname, '..');
    const defaultConfig = yaml.load(fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8'));
    const configView = fs.readFileSync(path.join(rootDir, 'views', 'config.njk'), 'utf8');

    assert.equal(defaultConfig.housekeeping.interval, 4);
    assert.equal(defaultConfig.faction_housekeeping.interval, 11);
    const currentConfig = yaml.load(fs.readFileSync(path.join(rootDir, 'config.yaml'), 'utf8'));
    assert.equal(currentConfig.faction_housekeeping.interval, 11);
    const activeProfile = yaml.load(fs.readFileSync(path.join(rootDir, 'config.yaml.strata-davidau'), 'utf8'));
    assert.equal(activeProfile.faction_housekeeping.interval, 11);
    assert.match(configView, /name="faction_housekeeping\.interval::int"[^>]*min="1"/);
    assert.equal(defaultConfig.quest_checks.interval, 5);
    assert.match(configView, /name="housekeeping\.interval::int"[^>]*min="1"/);
    assert.match(configView, /name="quest_checks\.interval::int"[^>]*min="1"/);
});

test('maintenance prompt counters hydrate and reset independently', () => {
    const original = Events.getMaintenancePromptTurnCounters();
    try {
        assert.deepEqual(Events.hydrateMaintenancePromptTurnCounters({
            housekeepingTurnCounter: 7,
            questCheckTurnCounter: 11
        }), {
            housekeepingTurnCounter: 7,
            questCheckTurnCounter: 11
        });

        Events.resetMaintenancePromptTurnCounters();
        assert.deepEqual(Events.getMaintenancePromptTurnCounters(), {
            housekeepingTurnCounter: 0,
            questCheckTurnCounter: 0
        });
    } finally {
        Events.hydrateMaintenancePromptTurnCounters(original);
    }
});

test('automatic housekeeping interval gate advances once per eligible turn', () => {
    const original = Events.getMaintenancePromptTurnCounters();
    try {
        Events.resetMaintenancePromptTurnCounters();
        const config = { housekeeping: { interval: 2 } };

        assert.equal(Events.shouldRunAutomaticHousekeepingThisTurn(config), false);
        assert.equal(Events.shouldRunAutomaticHousekeepingThisTurn(config), true);
        assert.equal(Events.getMaintenancePromptTurnCounters().housekeepingTurnCounter, 2);
    } finally {
        Events.hydrateMaintenancePromptTurnCounters(original);
    }
});

test('event-signaled quest checks force once, reuse existing results, and reset cadence', async () => {
    const originalCounters = Events.getMaintenancePromptTurnCounters();
    const originalRunQuestChecks = Events.runQuestChecks;
    const trueEventResult = {
        structured: { parsed: { any_quest_objectives_completed: true } }
    };
    let runCalls = 0;

    try {
        Events.hydrateMaintenancePromptTurnCounters({ questCheckTurnCounter: 3 });
        Events.runQuestChecks = async (options) => {
            runCalls += 1;
            assert.deepEqual(options, { bypassInterval: true });
            return '<quests></quests>';
        };

        assert.equal(
            await Events.resolveEventSignaledQuestCheck({ eventResult: trueEventResult }),
            '<quests></quests>'
        );
        assert.equal(runCalls, 1);
        assert.equal(Events.getMaintenancePromptTurnCounters().questCheckTurnCounter, 0);

        Events.hydrateMaintenancePromptTurnCounters({ questCheckTurnCounter: 4 });
        assert.equal(
            await Events.resolveEventSignaledQuestCheck({
                eventResult: trueEventResult,
                existingQuestResult: '<quests><quest/></quests>'
            }),
            '<quests><quest/></quests>'
        );
        assert.equal(runCalls, 1, 'an existing same-turn quest result must suppress a second run');
        assert.equal(Events.getMaintenancePromptTurnCounters().questCheckTurnCounter, 0);

        Events.hydrateMaintenancePromptTurnCounters({ questCheckTurnCounter: 2 });
        assert.equal(
            await Events.resolveEventSignaledQuestCheck({
                eventResult: {
                    structured: { parsed: { any_quest_objectives_completed: false } }
                },
                existingQuestResult: null
            }),
            null
        );
        assert.equal(runCalls, 1);
        assert.equal(Events.getMaintenancePromptTurnCounters().questCheckTurnCounter, 2);
    } finally {
        Events.runQuestChecks = originalRunQuestChecks;
        Events.hydrateMaintenancePromptTurnCounters(originalCounters);
    }
});

test('maintenance prompt counters are wired into new-game reset and save/load metadata', () => {
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');

    assert.match(apiSource, /Events\.resetMaintenancePromptTurnCounters\(\);/);
    assert.match(apiSource, /metadata\.housekeepingTurnCounter = maintenancePromptTurnCounters\.housekeepingTurnCounter;/);
    assert.match(apiSource, /metadata\.questCheckTurnCounter = maintenancePromptTurnCounters\.questCheckTurnCounter;/);
    assert.match(apiSource, /metadata\.lastHousekeepingTurnId = lastHousekeepingTurnId;/);
    assert.match(apiSource, /metadata\.lastHousekeepingTurnTimestamp = lastHousekeepingTurnTimestamp;/);
    assert.match(apiSource, /lastRunTurnId:\s*getLastHousekeepingTurnId\(\)/);
    assert.match(apiSource, /lastRunTurnTimestamp:\s*getLastHousekeepingTurnTimestamp\(\)/);
    assert.match(apiSource, /Events\.hydrateMaintenancePromptTurnCounters\(metadata\);/);
});

test('faction review uses its own interval for first history window and keeps the shared counter', () => {
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = apiSource.indexOf('Events.setFactionHousekeepingPromptRunner(');
    const end = apiSource.indexOf('async function runAutomaticMaintenancePrompts', start);
    assert.ok(start >= 0 && end > start);
    assert.match(apiSource.slice(start, end), /interval:\s*Events\.resolveFactionHousekeepingInterval\(config\)/);
    const counters = Events.getMaintenancePromptTurnCounters();
    assert.deepEqual(Object.keys(counters).sort(), ['housekeepingTurnCounter', 'questCheckTurnCounter']);
});
