'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
const { LiveDeslopController } = require('../LiveDeslop.js');
const { getThingGenerationSchemaExtensions } = require('../ThingGenerationSchema.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const eos = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', bytes: [], logprob: -0.1, top_logprobs: [] }, stop_token_ids: [99] };

test('degree schemas enforce their result wrappers while preserving partial outputs and optional lists', () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({ modName: 'implants', entityType: 'thing', fieldName: 'implantSlot', type: 'string', exposeToXmlParser: true, xmlPrompt: { placeholder: 'Implant slot' } });
    const extensions = getThingGenerationSchemaExtensions({ registry });
    for (const [file, wrapper, output] of [['craft-success-degree.schema.xml', 'craftingResults', 'itemsCrafted'], ['salvage-success-degree.schema.xml', 'salvageResults', 'itemsRecovered'], ['harvest-success-degree.schema.xml', 'harvestResults', 'itemsRecovered']]) {
        const schema = loadXmlGenerationSchema(file, { extensions });
        const guard = () => new XmlClosingTagGuard({ schema });
        const xml = `<response><${wrapper}><result><level>success</level><itemsConsumed/><${output}><item><rarity>Rare</rarity><implantSlot>arm</implantSlot></item></${output}></result></${wrapper}></response>`;
        assert.equal(guard().inspect(xml), null, file);
        assert.ok(guard().inspect(xml.replace('<result>', '<result><result>')), 'nested result rejected');
        assert.ok(guard().inspect(xml.replace('<response>', '<response><plausibility/><plausibility/>')), 'duplicate plausibility rejected');
        assert.ok(guard().inspect(xml.replace(`<${wrapper}>`, `<${wrapper}><plausibility/>`)), 'wrong result child rejected');
        assert.ok(guard().inspect(xml.replace('</response>', `<${wrapper}/></response>`)), 'duplicate wrapper rejected');
        assert.ok(guard().inspect(xml.replace('<rarity>Rare</rarity>', '<chargePool><amount>0</amount></chargePool>')), 'partial item keeps nested requirements');
    }
});

test('degree schema EOS completes closed structures and requests missing level without inventing a value', async () => {
    const schema = loadXmlGenerationSchema('craft-success-degree.schema.xml', { extensions: getThingGenerationSchemaExtensions({ registry: null }) });
    const controller = () => new LiveDeslopController({ detectSlop: async () => null });
    const open = '<response><craftingResults><result>';
    const needed = await controller().inspectXmlTerminal({ responseText: open, terminal: eos, finishReason: 'stop', schema, remainingTokens: 100, continuationLimit: 5 });
    assert.equal(needed.alternative.token, '<level>');
    const prefix = open + '<level>success</level>';
    const completed = await controller().inspectXmlTerminal({ responseText: prefix, terminal: eos, finishReason: 'stop', schema, remainingTokens: 100, continuationLimit: 5 });
    assert.equal(completed.documentComplete, true);
    assert.equal(completed.responseText, prefix + '</result></craftingResults></response>');
});
