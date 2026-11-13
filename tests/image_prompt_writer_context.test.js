const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createPromptEnv, buildBaseRenderContext } = require('./helpers/baseContextFixtures.js');
const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const start = source.indexOf('function buildImagePromptWriterContext(');
const end = source.indexOf('\nasync function generateImagePromptFromTemplateInternal(', start);
const marker = '[[[AI_RPG_INTERNAL_BASE_CONTEXT_END_V1]]]';
assert.ok(start >= 0 && end > start);

test('image writer uses a canonical shared context and retains each original task', () => {
    const context = {
        splitImagePromptBatchGenerationPrompt: prompt => ({ hasBaseContext: prompt.includes(marker) }),
        buildBasePromptContext: () => buildBaseRenderContext({ promptUsesCaching: true }),
        promptEnv: createPromptEnv(),
        parseXMLTemplate: text => ({ systemPrompt: text.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/)[1], generationPrompt: text.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/)[1] })
    };
    vm.runInNewContext(`${source.slice(start, end)}\nthis.build = buildImagePromptWriterContext;`, context);
    const item = context.build({ systemPrompt: 'Item writer instruction', generationPrompt: 'Iron sword visual' });
    const scenery = context.build({ systemPrompt: 'Scenery writer instruction', generationPrompt: 'Ancient hall visual' });
    assert.equal(item.systemPrompt, scenery.systemPrompt);
    assert.equal(item.generationPrompt.split(marker).length, 2);
    assert.equal(scenery.generationPrompt.split(marker).length, 2);
    assert.equal(item.generationPrompt.split(marker)[0], scenery.generationPrompt.split(marker)[0]);
    assert.match(item.generationPrompt.split(marker)[1], /Item writer instruction[\s\S]*Iron sword visual/);
    assert.match(scenery.generationPrompt.split(marker)[1], /Scenery writer instruction[\s\S]*Ancient hall visual/);
    const alreadyWrapped = { systemPrompt: 'existing', generationPrompt: `base ${marker} faction task` };
    assert.equal(context.build(alreadyWrapped), alreadyWrapped);
    assert.throws(() => context.build({ generationPrompt: '  ' }), /nonempty/);
});
