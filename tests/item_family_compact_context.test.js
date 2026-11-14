const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('function itemFamilyPromptInputError(');
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

test('item family renders absent optional context and numeric owner levels without weakening XML escaping', async () => {
    const base = buildBaseRenderContext({ overrides: {
        currentLocation: { name: 'Plaza', description: 'Stone plaza' },
        currentRegion: { name: 'Region', description: 'Region description' },
        lorebookEntries: []
    } });
    delete base.additionalLore;
    delete base.itemContext;
    delete base.abilityContext;
    const env = createPromptEnv();
    const rendered = [];
    const sandbox = {
        buildBasePromptContext: () => base,
        getLorebookManager: () => null,
        itemReuseSeedXml: () => '<seed/>',
        promptEnv: { render(name, values) { const result = env.render(name, values); rendered.push(result); return result; } },
        Thing: { getAllRarityDefinitions: () => [] }, attributeDefinitionsForPrompt: {},
        getGearSlotTypes: () => [], getThingGeneratorPromptFields: () => [],
        getModGenerationPromptInstructions: () => [],
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'generation' }),
        runPromptWithParseRetries: async () => ({ value: null }),
        resolveConfiguredPromptMaxAttempts: () => 1,
        LLMClient: { resolveEffectiveAiConfiguration: () => ({ aiConfig: {} }) }, config: {}, Array, Object, String
    };
    vm.createContext(sandbox);
    vm.runInContext(`${source.slice(start, end)}\nthis.author = authorStandardItemFamily;`, sandbox);
    const request = { name: 'Lantern', description: 'A lantern', rarity: 'common', seed: {}, context: {
        location: base.currentLocation, region: base.currentRegion, lorebookEntries: []
    } };
    await sandbox.author(request);
    assert.match(rendered[0], /<name>Plaza<\/name>/);
    for (const level of [0, 12]) {
        await sandbox.author({ ...request, context: { ...request.context, owner: {
            name: 'A & B', description: 'Owner', goals: [], level
        } } });
        assert.match(rendered.at(-1), new RegExp(`<level>${level}</level>`));
        assert.match(rendered.at(-1), /A &amp; B/);
    }
    for (const [field, value] of [['additionalLore', {}], ['itemContext', false], ['abilityContext', 0]]) {
        await assert.rejects(sandbox.author({ ...request, context: { ...request.context, baseContext: { ...base, [field]: value } } }), error => {
            assert.match(error.message, /item.family|XML text escaping|context/i);
            assert.equal(error.fatalTinyBrainExecution, true);
            return true;
        }, `${field} must reject a non-string value`);
    }
    await assert.rejects(sandbox.author({ ...request, context: { ...request.context, owner: {
        name: 'Owner', description: 'Owner', goals: [], level: { invalid: true }
    } } }), error => {
        assert.match(error.message, /item.family|level|XML text escaping/i);
        assert.equal(error.fatalTinyBrainExecution, true);
        return true;
    });
});
