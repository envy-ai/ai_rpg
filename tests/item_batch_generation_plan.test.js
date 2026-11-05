const test = require('node:test');
const assert = require('node:assert/strict');
const { parseItemBatchPlan, validateItemBatchPlanAgainstSeeds, validateItemBatchExpansion, combineItemBatchEntries } = require('../ItemBatchGenerationPlan.js');
const rarities = [{ key: 'common', label: 'Common' }, { key: 'rare', label: 'Rare' }];

test('mixed batch preserves counts, rarity and approved order when combining reused and expanded entries', () => {
    const plan = parseItemBatchPlan('<itemsPlan><item><name>Key</name><description>A key.</description><rarity>Rare</rarity><count>2</count></item><item><name>Map</name><description>A map.</description><rarity>Common</rarity><count>1</count></item></itemsPlan>', { rarityDefinitions: rarities });
    validateItemBatchPlanAgainstSeeds(plan, [{ name: 'Key', count: 2, rarity: 'rare' }, { name: 'Map', count: 1 }], { rarityDefinitions: rarities });
    const known = { ...plan[0], description: 'Remembered key.' };
    const expanded = [{ ...plan[1], description: 'Detailed map.' }];
    validateItemBatchExpansion(expanded, [plan[1]]);
    assert.deepEqual(combineItemBatchEntries(plan, [known, null], expanded), [known, expanded[0]]);
    assert.throws(() => validateItemBatchExpansion([{ ...expanded[0], rarity: 'rare' }], [plan[1]]), /rarity/);
    assert.throws(() => validateItemBatchPlanAgainstSeeds(plan, [{ name: 'Key', count: 3 }, { name: 'Map', count: 1 }], { rarityDefinitions: rarities }), /count/);
});
