const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Utils = require('../Utils.js');
const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('function parseEquipBestAssignments(');
const end = source.indexOf('\nPlayer.setLevelUpHandler(', start);
assert.ok(start >= 0 && end > start);
function harness(response) {
    const requests = [], equipped = [], item = { name: 'Sword', slot: 'hand', description: 'A sword.' };
    const character = { name: 'Ada', getGear: () => ({ rightHand: { slotType: 'hand' } }), getInventoryItems: () => [item], equipItemInSlot: (chosen, slot) => { equipped.push([chosen.name, slot]); return true; } };
    const context = { Utils, console, getDefaultRarityLabel: () => 'Common', renderEquipBestPrompt: () => 'mock template', parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'choose' }), formatDurationLine: () => 'duration', findThingByName: () => null, LLMClient: { chatCompletion: async options => { requests.push(options); options.responseValidator(response); return response; }, logPrompt() {} } };
    vm.createContext(context); vm.runInContext(`${source.slice(start, end)}\nthis.parse = parseEquipBestAssignments; this.equip = equipBestGearForCharacter;`, context);
    return { context, requests, equipped, character };
}

test('equip-best named schema accepts actual parser-valid assignments, omissions and empty lists', () => {
    const { context } = harness(''); const schema = loadXmlGenerationSchema('equip-best.schema.xml');
    for (const xml of ['<items/>', '<items><item><itemName>Sword</itemName><slotName>rightHand</slotName></item></items>', '<items><item><itemName>Sword</itemName></item><item><slotName>rightHand</slotName></item></items>']) {
        assert.ok(Array.isArray(context.parse(xml, { strict: true })));
        assert.equal(new XmlClosingTagGuard({ schema }).inspect(xml), null, xml);
    }
    const invalid = '<items><equippableItems><item><itemName>Sword</itemName><slotName>rightHand</slotName></item></equippableItems></items>';
    assert.ok(new XmlClosingTagGuard({ schema }).inspect(invalid));
});

test('actual equip helper supplies dedicated schema and applies a validated assignment', async () => {
    const h = harness('<items><item><itemName>Sword</itemName><slotName>rightHand</slotName></item></items>');
    await h.context.equip({ character: h.character });
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].xmlSchema, 'equip-best.schema.xml');
    assert.deepEqual(h.equipped, [['Sword', 'rightHand']]);
});

test('conditional memory-selection schema preserves its actual parser treatment of entries', () => {
    assert.match(source, /metadataLabel:\s*'choose_important_memories',\s*xmlSchema:\s*'memories-to-recall\.schema\.xml'/);
    const start = source.indexOf('function extractIndicesFromText('), end = source.indexOf('\nfunction kickOffChooseImportantMemoriesJob(', start);
    assert.ok(start >= 0 && end > start);
    const Globals = require('../Globals.js'), previous = Globals.config; Globals.config = { ai: {} };
    try {
        const context = { Utils, console }; vm.createContext(context);
        vm.runInContext(`${source.slice(start, end)}\nthis.parse = parseChooseImportantMemoriesResponse;`, context);
        const schema = loadXmlGenerationSchema('memories-to-recall.schema.xml');
        for (const xml of ['<memoriesToRecall/>', '<memoriesToRecall><npc><name>Ada</name><recalledMemories>1, 3</recalledMemories></npc></memoriesToRecall>', '<memoriesToRecall><npc><recalledMemories>1</recalledMemories></npc></memoriesToRecall>']) {
            assert.ok(context.parse(xml, 2) instanceof Map || typeof context.parse(xml, 2).get === 'function');
            assert.equal(new XmlClosingTagGuard({ schema }).inspect(xml), null, xml);
        }
    } finally { Globals.config = previous; }
});
