const test = require('node:test');
const assert = require('node:assert/strict');
const { compileXmlGenerationSchema } = require('../XmlGenerationSchema.js');
const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
const { LiveDeslopController } = require('../LiveDeslop.js');
const schema = compileXmlGenerationSchema('<root><first>First</first><second>Second</second></root>');
const eos = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', logprob: -0.1, top_logprobs: [{ id: 2, token: 'bogus', logprob: -0.2 }] }, stop_token_ids: [99] };
const make = () => new LiveDeslopController({ detectSlop: async () => null });
const terminal = (text, extra = {}) => ({ responseText: text, terminal: eos, finishReason: 'stop', schema, remainingTokens: 50, continuationLimit: 10, ...extra });

test('EOS closes satisfied frames deterministically and stops only at a complete schema root', async () => {
    const done = await make().inspectXmlTerminal(terminal('<root><first>one</first><second>two'));
    assert.equal(done.documentComplete, true); assert.equal(done.responseText, '<root><first>one</first><second>two</second></root>');
    assert.equal(done.syntheticTagCount, 2); assert.equal(done.alternative, undefined);
    const partial = await make().inspectXmlTerminal(terminal('<root><first>one'));
    assert.equal(partial.documentComplete, undefined); assert.equal(partial.alternative.token, '</first><second>');
    assert.equal(partial.syntheticTagCount, 2); assert.equal(partial.alternative.id, undefined);
    const rewind = await make().inspectXmlTerminal(terminal('<root><first>one</fi'));
    assert.equal(rewind.rewindOffset, '<root><first>one'.length);
    assert.equal(rewind.alternative.token, '</first><second>');
});

test('first completed root boundary is exact and respects tool-call eligibility', async () => {
    const text = '<root><first>one</first><second>two</second></root>trailing';
    const scanner = new XmlClosingTagGuard({ schema, stopAtDocumentEnd: true });
    assert.equal(scanner.inspect(text), null); assert.equal(text.slice(0, scanner.completedAt), text.slice(0, text.indexOf('trailing')));
    const stopped = await make().inspectXml({ responseText: text, tokenRecords: [], schema, canStopEarly: true });
    assert.equal(stopped.documentComplete, true); assert.equal(stopped.responseText, text.slice(0, text.indexOf('trailing')));
    assert.equal(await make().inspectXml({ responseText: text, tokenRecords: [], schema, canStopEarly: false }), null);
    assert.equal(await make().inspectXmlTerminal(terminal(text, { hasToolCalls: true, finishReason: 'tool_calls' })), null);
    const emptySchema = compileXmlGenerationSchema('<items><item optional="true" multiple="true">Item</item></items>');
    const empty = await make().inspectXml({ responseText: '<items/>junk', tokenRecords: [], schema: emptySchema, canStopEarly: true });
    assert.equal(empty.responseText, '<items/>');
});

test('EOS closure respects hard limits and preserves inner CDATA/markup order', async () => {
    const rich = compileXmlGenerationSchema('<root><content markup="true">Text</content></root>');
    const text = '<root><content><![CDATA[<b>word';
    const done = await make().inspectXmlTerminal(terminal(text, { schema: rich }));
    assert.equal(done.responseText, text + '</b>]]></content></root>');
    const deep = '<root><content>' + '<b>'.repeat(10) + 'word';
    const deepDone = await make().inspectXmlTerminal(terminal(deep, { schema: rich, continuationLimit: 1 }));
    assert.equal(deepDone.responseText, deep + '</b>'.repeat(10) + '</content></root>');
    const used = make();
    await used.inspectXmlTerminal(terminal('<root><first>one', { continuationLimit: 1 }));
    await assert.rejects(used.inspectXmlTerminal(terminal('<root><first>one</first><second>two', { continuationLimit: 1 })), /limit/i);
    await assert.rejects(make().inspectXmlTerminal(terminal(text, { schema: rich, remainingTokens: 0 })), /budget/i);
});

test('length-limited incomplete XML is not synthetically closed', async () => {
    const result = await make().inspectXmlTerminal(terminal('<root><first>one', { finishReason: 'length', terminal: { reason: 'token_limit' } }));
    assert.equal(result, null);
});
