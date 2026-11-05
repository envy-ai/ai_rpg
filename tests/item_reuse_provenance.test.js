const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const Thing = require('../Thing.js');
const ItemCatalogue = require('../ItemCatalogue.js');

function loadNativeFunctions() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const markerStart = source.indexOf('function markItemReuseProvenance(');
    const markerEnd = source.indexOf('\nfunction createItemReuseSession(', markerStart);
    const uniqueStart = source.indexOf('async function ensureUniqueThingNames(');
    const uniqueEnd = source.indexOf('\nasync function regenerateLocationName(', uniqueStart);
    assert.ok(markerStart >= 0 && markerEnd > markerStart && uniqueStart >= 0 && uniqueEnd > uniqueStart);
    let contextCalls = 0;
    let llmCalls = 0;
    const context = {
        Thing, ItemCatalogue, createHash, config: {}, hasConfiguredAiBackend: () => true,
        prepareBasePromptContext: async () => { contextCalls++; throw new Error('stop after duplicate selection'); },
        LLMClient: { chatCompletion: async () => { llmCalls++; throw new Error('unexpected completion'); } },
        console: { warn() {} }
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(markerStart, markerEnd)}\n${source.slice(uniqueStart, uniqueEnd)}\nthis.mark = markItemReuseProvenance; this.ensure = ensureUniqueThingNames;`, context);
    return { ...context, get contextCalls() { return contextCalls; }, get llmCalls() { return llmCalls; } };
}

test('canonical standard copies skip duplicate prompting; modified copies return to duplicate handling', async () => {
    Thing.clear();
    try {
        const makeItem = () => new Thing({ name: 'Iron Sword', description: 'A forged sword.', thingType: 'item', rarity: 'common' });
        const first = makeItem();
        const second = makeItem();
        const unmarked = makeItem();
        const native = loadNativeFunctions();
        assert.equal(Thing.canMergeStacks(first, second), true);
        native.mark(first, { itemReuseFamilyName: 'Iron Sword' });
        native.mark(second, { itemReuseFamilyName: 'Iron Sword' });
        assert.equal(Thing.canMergeStacks(first, second), true);
        assert.equal(Thing.canMergeStacks(first, unmarked), true, 'engine provenance must not change stack equivalence');
        await native.ensure({ things: [first, second] });
        assert.equal(native.contextCalls, 0);
        assert.equal(native.llmCalls, 0);
        second.description = 'A personalized sword.';
        await native.ensure({ things: [second] });
        assert.equal(native.contextCalls, 1, 'changed mechanics or description must return to ordinary duplicate processing');
        assert.equal(native.llmCalls, 0, 'the context spy stops this test before the completion');
    } finally { Thing.clear(); }
});
