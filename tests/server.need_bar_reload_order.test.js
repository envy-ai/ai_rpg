'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Globals = require('../Globals.js');
const Player = require('../Player.js');
const { withTempPlayerEnvironment } = require('./helpers/needBarFixtures.js');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('function reloadConfigAndDefs('), end = source.indexOf('\nGlobals.reloadConfigAndDefs =', start);
assert.ok(start >= 0 && end > start);

test('config reload settles elapsed health using the old rate before installing the new one', () => {
    withTempPlayerEnvironment({ prefix: 'need-reload-order-', manageWorldTime: true,
        needBarsYaml: 'need_bars: {}\n', attributes: [{ id: 'constitution', label: 'Constitution', default: 10 }],
        configOverrides: { baseHealthPerLevel: 90, healthRegenPercentPerMinute: 1 } }, () => {
        const priorOverride = Globals.getGameConfigOverrideYaml();
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        const actor = new Player({ id: 'reload-rate-actor', name: 'Reload Actor' });
        actor.setHealth(50);
        Player.applyStatusEffectNeedBarsToAll();
        Globals.worldTime = { dayIndex: 0, timeMinutes: 10 };
        const merged = { ...Globals.config, healthRegenPercentPerMinute: 2 };
        const context = { __dirname: path.resolve(__dirname, '..'), path, Globals, Player, config: Globals.config,
            cliConfigOverridePath: null, sessionConfigOverridePath: null,
            loadMergedConfig: () => merged, validateImageGenerationHandoffs: () => {}, validateManagedStrataRuntimeConfiguration: () => {},
            LLMClient: {}, PromptAuditLog: { resolveHighLatencySeconds() {} }, TechniqueBalancePolicy: { resolvePolicy() {} },
            validateDifficultyDcFormulas() {}, validateOutcomeMarginFormulas() {}, validateCriticalThresholdFormulas() {}, validateBarterCurrencyFormula() {}, FormulaEvaluator: {},
            diffFrozenEnabledModDirectoryNames: () => ({}), validateDefinitionOverlays() {}, loadLocationDangerDefinition() {},
            viewsEnv: null, promptEnv: null, imagePromptEnv: null, Thing: { loadRarityDefinitions() {} }, structuredClone, Date };
        vm.createContext(context);
        vm.runInContext(`${source.slice(start, end)}\nthis.reload = reloadConfigAndDefs;`, context);
        try {
            context.reload();
            assert.ok(Math.abs(actor.health - 60) < 1e-9, `old-rate settlement: ${actor.health}`);
            Globals.worldTime = { dayIndex: 0, timeMinutes: 11 };
            Player.applyStatusEffectNeedBarsToAll();
            assert.ok(Math.abs(actor.health - 62) < 1e-9, `new-rate settlement: ${actor.health}`);
        } finally {
            Globals.setGameConfigOverrideYaml(priorOverride);
        }
    });
});

test('invalid capacity during config reload restores all actor values, clocks and old configuration', () => {
    const definitions = amount => `need_bars:\n  stamina:\n    name: Stamina\n    player: true\n    party: true\n    non_party: true\n    min: 0\n    max: 100\n    initial: 50\n    effect_thresholds:\n      0:\n        name: Recovering\n        sentence: "%CHARACTER% recovers."\n        status_effects:\n          capacity:\n            name: Capacity\n            description: A capacity modifier.\n            need_bar_maximums:\n              stamina:\n                percent_modifier: ${amount}\n`;
    withTempPlayerEnvironment({ prefix: 'need-reload-rollback-', manageWorldTime: true, needBarsYaml: definitions(0),
        attributes: [{ id: 'constitution', label: 'Constitution', default: 10 }],
        configOverrides: { baseHealthPerLevel: 90, healthRegenPercentPerMinute: 1 } }, () => {
        const priorOverride = Globals.getGameConfigOverrideYaml();
        Globals.worldTime = { dayIndex: 0, timeMinutes: 0 };
        const actors = [new Player({ id: 'reload-first', name: 'First' }), new Player({ id: 'reload-second', name: 'Second', isNPC: true })];
        actors.forEach(actor => actor.setHealth(50));
        Player.applyStatusEffectNeedBarsToAll();
        const before = actors.map(actor => actor.toJSON());
        Globals.worldTime = { dayIndex: 0, timeMinutes: 10 };
        fs.writeFileSync(path.join(Globals.baseDir, 'defs/need_bars.yaml'), definitions(-100));
        const context = { __dirname: path.resolve(__dirname, '..'), path, Globals, Player, config: Globals.config,
            cliConfigOverridePath: null, sessionConfigOverridePath: null,
            loadMergedConfig: () => ({ ...Globals.config, healthRegenPercentPerMinute: 2 }), validateImageGenerationHandoffs() {}, validateManagedStrataRuntimeConfiguration() {},
            LLMClient: {}, PromptAuditLog: { resolveHighLatencySeconds() {} }, TechniqueBalancePolicy: { resolvePolicy() {} },
            validateDifficultyDcFormulas() {}, validateOutcomeMarginFormulas() {}, validateCriticalThresholdFormulas() {}, validateBarterCurrencyFormula() {}, FormulaEvaluator: {},
            diffFrozenEnabledModDirectoryNames: () => ({}), validateDefinitionOverlays() {}, loadLocationDangerDefinition() {},
            viewsEnv: null, promptEnv: null, imagePromptEnv: null, Thing: { loadRarityDefinitions() {} }, structuredClone, Date };
        vm.createContext(context);
        vm.runInContext(`${source.slice(start, end)}\nthis.reload = reloadConfigAndDefs;`, context);
        try {
            assert.throws(() => context.reload(), /stamina.*(?:capacity|maximum|range)/i);
            assert.equal(Globals.config.healthRegenPercentPerMinute, 1);
            assert.deepEqual(actors.map(actor => actor.toJSON()), before);
        } finally {
            Globals.setGameConfigOverrideYaml(priorOverride);
            fs.writeFileSync(path.join(Globals.baseDir, 'defs/need_bars.yaml'), definitions(0));
        }
    });
});
