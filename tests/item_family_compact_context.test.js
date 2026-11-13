const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('async function authorStandardItemFamily(');
const end = source.indexOf('\nfunction markItemReuseProvenance(', start);
assert.ok(start >= 0 && end > start);

for (const caching of [false, true]) test(`item family prompt retains relevant context with caching=${caching}`, async () => {
    const base = buildBaseRenderContext({ promptUsesCaching: caching, overrides: {
        gameHistory: 'OLD HISTORY SECRET', recentGameHistory: 'RECENT HISTORY SECRET',
        additionalLore: 'Relevant world lore', itemContext: 'Item rules fixture', abilityContext: '',
        lorebookEntries: [], attributeDefinitions: { Strength: { description: 'Lifting power' } },
        equipmentSlots: ['head'], modSceneContext: ['Mod scene rule'],
        currentLocation: { name: 'Stub plaza', description: 'Projected stub description' },
        currentRegion: { name: 'Region', description: 'Region description' },
        party: [{ name: 'PARTY SECRET' }], trackers: [{ name: 'TRACKER SECRET' }]
    } });
    base.currentPlayer.name = 'PLAYER SECRET';
    let captured;
    const env = createPromptEnv();
    const context = {
        buildBasePromptContext: () => base,
        getLorebookManager: () => ({ findMatchingEntries: () => [{ content: 'Matched lore fixture' }] }),
        itemReuseSeedXml: seed => `<seed><material>${seed.material || ''}</material></seed>`,
        promptEnv: { render(name, values) { captured = env.render(name, values); return captured; } },
        Thing: { getAllRarityDefinitions: () => [{ key: 'common', label: 'Common', description: 'Common rarity' }] },
        attributeDefinitionsForPrompt: {}, getGearSlotTypes: () => [], getThingGeneratorPromptFields: () => [],
        getModGenerationPromptInstructions: () => [{ text: 'Mod item rule fixture' }],
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }),
        runPromptWithParseRetries: async () => ({ value: null }),
        resolveConfiguredPromptMaxAttempts: () => 1, LLMClient: { resolveEffectiveAiConfiguration: () => ({ aiConfig: {} }) },
        config: {}, Array, Object, String
    };
    vm.createContext(context);
    vm.runInContext(`${source.slice(start, end)}\nthis.author = authorStandardItemFamily;`, context);
    await context.author({ name: 'Iron sword', description: 'Reliable blade', rarity: 'common', seed: { material: 'iron' }, context: {
        location: { name: 'Stub plaza', stubMetadata: { stubDescription: 'Projected stub description' } },
        region: { name: 'Region', description: 'Region description' }, owner: { name: 'Owner name', description: 'Owner detail', goals: [] }
    } });
    for (const value of ['Test Setting', 'Projected stub description', 'Region description', 'Owner detail', 'Lifting power', 'head', 'Relevant world lore', 'Matched lore fixture', 'Iron sword', 'iron', 'Common rarity', 'Mod item rule fixture']) {
        assert.ok(captured.includes(value), `missing ${value}`);
    }
    for (const value of ['OLD HISTORY SECRET', 'RECENT HISTORY SECRET', 'PLAYER SECRET', 'PARTY SECRET', 'TRACKER SECRET']) assert.ok(!captured.includes(value), `unexpected ${value}`);
    const marker = require('../LLMClient.js').getStableContextMessageBoundaryMarker();
    if (caching) {
        const boundary = captured.indexOf(marker);
        assert.ok(boundary > captured.indexOf('Lifting power'));
        assert.ok(boundary < captured.indexOf('Projected stub description'));
        assert.equal(captured.indexOf(marker, boundary + marker.length), -1);
    } else {
        assert.equal(captured.includes(marker), false);
    }
});
