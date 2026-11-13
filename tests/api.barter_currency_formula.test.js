'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nunjucks = require('nunjucks');
const { evaluateBarterCurrencyMultiplier, validateBarterCurrencyFormula, scaleBarterCurrency } = require('../utils/barter-currency-formula.js');

const config = formula => ({ formulas: { barter: { currency_multiplier: formula } } });

test('barter multiplier uses the configured level formula and evaluator functions', () => {
    for (const [level, expected] of [[1, 4 / 3], [3, 2], [6, 3]]) {
        assert.equal(evaluateBarterCurrencyMultiplier(config('1 + (level / 3)'), level), expected);
    }
    assert.equal(evaluateBarterCurrencyMultiplier(config('2.5'), 6), 2.5);
    assert.equal(evaluateBarterCurrencyMultiplier(config('max(2, floor(level / 2))'), 6), 3);
    assert.equal(evaluateBarterCurrencyMultiplier(config('0'), 3), 0);
    assert.equal(scaleBarterCurrency(11, evaluateBarterCurrencyMultiplier(config('1 + level / 3'), 1)), 11 * (4 / 3));
});

test('barter formula rejects malformed, unknown, nonfinite and negative values', () => {
    for (const formula of ['level +', 'unknown + 1', '1 / 0', '-1']) {
        assert.throws(() => validateBarterCurrencyFormula(config(formula)), undefined, formula);
    }
    assert.throws(() => evaluateBarterCurrencyMultiplier(config('2 - level'), 3));
    assert.throws(() => scaleBarterCurrency(1, -1));
    assert.throws(() => scaleBarterCurrency(1, Infinity));
    assert.equal(scaleBarterCurrency(10, 0), 0);
});

function loadPricing({ merchantCurrency = 10, formula = '1 + (level / 3)' } = {}) {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        async function runBarterPricingPrompt({');
    const end = source.indexOf('\n        function createBarterSession(', start);
    assert.ok(start >= 0 && end > start);
    const contexts = [];
    let nextCurrency = merchantCurrency;
    const currentPlayer = { getInventoryItems: () => [], getCurrency: () => 0 };
    const deps = {
        currentPlayer, config: { ai: {}, ...config(formula) },
        getBarterRuntimeConfig: () => ({ generatedStockMin: 0, generatedStockMax: 0 }),
        prepareBasePromptContext: async () => ({}), resolveNpcLocationForBarter: () => null,
        getStandaloneInventoryItems: items => items, serializeBarterPromptItem: item => item,
        serializeNpcForClient: npc => ({ name: npc.name }),
        promptEnv: { render: (_template, context) => { contexts.push(context); return 'rendered'; } },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'user' }),
        resolveConfiguredPromptMaxAttempts: () => 1,
        runPromptWithParseRetries: async ({ parse }) => ({ value: parse('fixture') }),
        parseBarterPricesResponse: () => ({ merchantCurrency: nextCurrency, newStock: [], merchantOffers: new Map() }),
        applyGeneratedBarterStock: async () => [],
        LLMClient: { chatCompletion: () => { throw new Error('Unexpected real completion'); }, logPrompt: () => {} },
        evaluateBarterCurrencyMultiplier, scaleBarterCurrency,
    };
    const run = vm.runInNewContext(`${source.slice(start, end)}\nrunBarterPricingPrompt`, deps);
    return { run, contexts, setCurrency: value => { nextCurrency = value; } };
}

test('pricing refresh scales only each fresh baseline and regular sessions and haggles do not compound', async () => {
    const { run, contexts, setCurrency } = loadPricing();
    const assigned = [];
    const npc = { name: 'Trader', level: 3, currency: 0, getCurrency() { return this.currency; },
        setCurrency(value) { assigned.push(value); this.currency = Math.floor(value); },
        getInventoryItems: () => [], getBarterInventoryItems: () => [] };
    await run({ npc, allowGeneratedStock: true, refreshMerchantCurrency: true });
    assert.equal(npc.currency, 20);
    setCurrency(999);
    await run({ npc, allowGeneratedStock: false, refreshMerchantCurrency: false });
    await run({ npc, allowGeneratedStock: false, refreshMerchantCurrency: false, haggle: { offer: 'Less' } });
    assert.equal(npc.currency, 20);
    assert.deepEqual(assigned, [20]);
    assert.equal(contexts[1].barter.npc.currency, 20);
    setCurrency(11);
    npc.level = 1;
    await run({ npc, allowGeneratedStock: true, refreshMerchantCurrency: true });
    assert.equal(npc.currency, 14);
    assert.equal(assigned.length, 2);
    assert.equal(assigned[1], 11 * (4 / 3));
});

test('invalid multiplier fails before pricing or currency mutation on stock refresh', async () => {
    const { run, contexts } = loadPricing({ formula: '2 - level' });
    const npc = { name: 'Trader', level: 3, currency: 20,
        setCurrency() { throw new Error('unexpected mutation'); },
        getInventoryItems: () => [], getBarterInventoryItems: () => [] };
    await assert.rejects(run({ npc, allowGeneratedStock: true, refreshMerchantCurrency: true }), /non-negative/);
    assert.equal(contexts.length, 0);
});

test('barter prompt requests level-neutral baseline only for refresh and retains XML schema', () => {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')), { autoescape: false });
    const make = refreshingStock => env.render('_includes/barter-prices.njk', { barter: {
        npc: { id: 'npc', name: 'Trader', currency: 20 }, player: { name: 'Player', currency: 1 },
        config: { generatedStockMin: 0, generatedStockMax: 0, refreshingStock },
        playerItems: [], npcInventoryItems: [], npcBarterItems: [],
    } });
    const refresh = make(true), ordinary = make(false);
    for (const rendered of [refresh, ordinary]) {
        assert.match(rendered, /<merchantCurrency>/);
        assert.match(rendered, /<barterPrices>/);
        assert.match(rendered, /<currency>20<\/currency>/);
    }
    assert.match(refresh, /unscaled|level-neutral/i);
    assert.match(ordinary, /repeat.*current currency/i);
});

test('default config supplies the level multiplier and reload rejects an invalid override before installation', () => {
    const yaml = require('js-yaml');
    const FormulaEvaluator = require('../public/js/formula-evaluator.js');
    const defaults = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'config.default.yaml'), 'utf8'));
    assert.equal(validateBarterCurrencyFormula(defaults), '1 + (level / 3)');
    const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = server.indexOf('function reloadConfigAndDefs(');
    const end = server.indexOf('\nGlobals.reloadConfigAndDefs =', start);
    assert.ok(start >= 0 && end > start);
    const original = { identity: 'installed configuration' };
    const Globals = { config: original, getGameConfigOverrideYaml: () => null };
    const context = {
        __dirname: path.join(__dirname, '..'), path, Globals, config: original,
        cliConfigOverridePath: null, sessionConfigOverridePath: null,
        loadMergedConfig: () => config('unknown + 1'),
        validateImageGenerationHandoffs() {}, validateManagedStrataRuntimeConfiguration() {},
        LLMClient: {}, PromptAuditLog: { resolveHighLatencySeconds() {} },
        validateDifficultyDcFormulas() {}, validateOutcomeMarginFormulas() {}, validateCriticalThresholdFormulas() {},
        validateBarterCurrencyFormula, FormulaEvaluator,
    };
    const reload = vm.runInNewContext(`${server.slice(start, end)}\nreloadConfigAndDefs`, context);
    assert.throws(() => reload(), /currency_multiplier.*unknown/i);
    assert.equal(Globals.config, original);
});

test('startup configuration validation reports the barter formula error', () => {
    const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const call = server.lastIndexOf('        validateBarterCurrencyFormula(config, { formulaEvaluator: FormulaEvaluator });');
    const start = server.lastIndexOf('    try {', call);
    const catchStart = server.indexOf('} catch (error) {', call);
    const end = server.indexOf('\n    }', catchStart) + '\n    }'.length;
    assert.ok(start >= 0 && call > start && end > call);
    const validationErrors = [];
    vm.runInNewContext(server.slice(start, end), {
        config: config('level + missing'), validationErrors, validateBarterCurrencyFormula,
        FormulaEvaluator: require('../public/js/formula-evaluator.js'),
    });
    assert.equal(validationErrors.length, 1);
    assert.match(validationErrors[0], /Barter currency formula:.*currency_multiplier.*missing/i);
});
