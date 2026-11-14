const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');

const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('function itemFamilyPromptInputError(');
const end = source.indexOf('\nfunction markItemReuseProvenance(', start);
assert.ok(start >= 0 && end > start);

for (const caching of [false, true]) test(`item family prompt uses the shared base context with its item context after the end marker, caching=${caching}`, async () => {
    const base = buildBaseRenderContext({ promptUsesCaching: caching, overrides: {
        gameHistory: 'OLD HISTORY SHARED', recentGameHistory: 'RECENT HISTORY SHARED',
        additionalLore: 'Relevant world lore', itemContext: 'Item rules fixture', abilityContext: '',
        lorebookEntries: [], attributeDefinitions: { Strength: { description: 'Lifting power' } },
        equipmentSlots: ['head'], modSceneContext: ['Mod scene rule'],
        currentLocation: { name: 'Stub plaza', description: 'Projected stub description' },
        currentRegion: { name: 'Region', description: 'Region description' }
    } });
    let captured;
    const env = createPromptEnv();
    const context = {
        prepareBasePromptContext: async () => base,
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
    const endMarker = '[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]';
    const endIndex = captured.indexOf(endMarker);
    assert.ok(endIndex > 0);
    const shared = captured.slice(0, endIndex);
    const task = captured.slice(endIndex);
    // The shared part is the ordinary base context, story history included.
    assert.ok(shared.includes('OLD HISTORY SHARED'));
    assert.ok(shared.includes('RECENT HISTORY SHARED'));
    const plain = env.render('base-context.xml.njk', { ...base, promptType: 'item-family', itemFamilyRequest: { name: 'Other', description: '' },
        itemFamilyContext: {}, attributeDefinitions: {}, equipmentSlots: [], lorebookEntries: [] });
    assert.equal(shared, plain.slice(0, plain.indexOf(endMarker)), 'the item-family prefix is byte-identical to another prompt on the same base');
    for (const value of ['Projected stub description', 'Owner detail', 'Lifting power', 'head', 'Relevant world lore', 'Matched lore fixture', 'Iron sword', 'iron']) {
        assert.ok(task.includes(value), `missing ${value} in the task section`);
    }
});

test('item family renders absent optional context and numeric owner levels without weakening XML escaping', async () => {
    const base = buildBaseRenderContext({ overrides: {
        currentLocation: { name: 'Plaza', description: 'Stone plaza' },
        currentRegion: { name: 'Region', description: 'Region description' },
        lorebookEntries: []
    } });
    const env = createPromptEnv();
    const rendered = [];
    const sandbox = {
        prepareBasePromptContext: async () => base,
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
    // Absent optional item-family texts: explicit nulls on the request context.
    const request = { name: 'Lantern', description: 'A lantern', rarity: 'common', seed: {}, context: {
        location: base.currentLocation, region: base.currentRegion, lorebookEntries: [],
        additionalLore: null, itemContext: null, abilityContext: null
    } };
    await sandbox.author(request);
    assert.match(rendered[0], /<name>Plaza<\/name>/);
    const familyBlock = rendered[0].match(/<itemFamilyContext>[\s\S]*<\/itemFamilyContext>/)[0];
    for (const tag of ['additionalLore', 'itemContext', 'abilityContext']) assert.doesNotMatch(familyBlock, new RegExp(`<${tag}>`));
    for (const level of [0, 12]) {
        await sandbox.author({ ...request, context: { ...request.context, owner: {
            name: 'A & B', description: 'Owner', goals: [], level
        } } });
        assert.match(rendered.at(-1), new RegExp(`<level>${level}</level>`));
        assert.match(rendered.at(-1), /A &amp; B/);
    }
    for (const [field, value] of [['additionalLore', {}], ['itemContext', false], ['abilityContext', 0]]) {
        await assert.rejects(sandbox.author({ ...request, context: { ...request.context, [field]: value } }), error => {
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
