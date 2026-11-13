const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const nunjucks = require('nunjucks');
const Thing = require('../Thing.js');
const { TinyBrainPromptExtension, createTinyBrainRenderState } = require('../TinyBrainPromptRunner.js');

function captureRouteContext(recoveredThingInstances, selectedResult, mode = 'harvest') {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('                const producedItemDescriptor = (() => {');
    const end = source.indexOf('\n                const actorName =', start);
    const contextStart = source.indexOf('                        const craftNarrativeContext = {', end);
    const contextEnd = source.indexOf('\n                        const tinyBrain =', contextStart);
    assert.ok(start >= 0 && end > start && contextStart > end && contextEnd > contextStart);
    const sandbox = {
        isSalvageAction: mode === 'salvage', isHarvestAction: mode === 'harvest',
        recoveredThingInstances, craftedThingInstances: [], selectedResult,
        salvageTargetThing: { name: 'Bush' }, baseContext: {}, actorName: 'Tester',
        salvageItemName: '', intendedItemName: '', stationName: '', craftingItemsForPrompt: [],
        actionOutcome: { label: 'Success' }, consumedThings: [], consumedQuantities: new Map(),
        craftingNotes: '', craftingMode: mode, effectiveCraftTargetType: 'item', appliedTimeTakenMinutes: 2,
    };
    return vm.runInNewContext(`${source.slice(start, end)}\n${source.slice(contextStart, contextEnd)}\ncraftNarrativeContext`, sandbox);
}

function promptEnv() {
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }), { autoescape: false });
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

test('harvest narration renders finalized recovered names and stack quantities in both prompt modes', () => {
    const thing = new Thing({ id: 'harvest-test', name: 'Unripe Berries', description: 'Fruit.', thingType: 'item', count: 3 });
    thing.name = 'Ripe Berries'; // Name validation has already renamed the instantiated output.
    const second = new Thing({ id: 'harvest-test-2', name: 'Green Leaf', description: 'A leaf.', thingType: 'item', count: 2 });
    second.name = 'Silver Leaf';
    const context = captureRouteContext([thing, second], { itemsRecovered: [{ name: 'Unripe Berries', count: 3 }, { name: 'Green Leaf', count: 2 }], other: null });
    const env = promptEnv();
    const standard = env.render('_includes/player-action-craft.njk', { ...context, npcs: [], party: [] });
    const staged = env.render('_includes/player-action-craft.tinybrain.njk', { ...context, __tinyBrainState: createTinyBrainRenderState() });
    for (const prompt of [standard, staged]) {
        assert.match(prompt, /3x Ripe Berries/);
        assert.match(prompt, /2x Silver Leaf/);
        assert.doesNotMatch(prompt, /Unripe Berries|Green Leaf/);
    }
    assert.doesNotMatch(staged, /Produced:/);
    assert.equal((staged.match(/Ripe Berries/g) || []).length, 1);
});

test('empty harvest result does not resurrect a blueprint as a produced item', () => {
    const context = captureRouteContext([], { itemsRecovered: [{ name: 'Old Blueprint' }], other: null });
    const env = promptEnv();
    const staged = env.render('_includes/player-action-craft.tinybrain.njk', { ...context, __tinyBrainState: createTinyBrainRenderState() });
    assert.match(staged, /Recovered: none/);
    assert.doesNotMatch(staged, /Old Blueprint|Produced:/);
});
