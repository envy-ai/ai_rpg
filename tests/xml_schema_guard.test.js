const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadXmlGenerationSchema } = require('../XmlGenerationSchema.js');
const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
const baseDirectory = path.join(__dirname, 'fixtures', 'xml-generation-schema');
const fragment = loadXmlGenerationSchema('extra.schema.xml', { baseDirectory });
const schema = loadXmlGenerationSchema('roster.schema.xml', { baseDirectory, extensions: { extraFields: [fragment] } });
const guard = () => new XmlClosingTagGuard({ schema });

test('schema accepts unordered children, optional omissions, repeatable children and leaf text', () => {
    for (const xml of [
        '<roster><item><name>Sword</name></item><owner>Smith</owner></roster>',
        '<roster><tag>a</tag><owner>Smith</owner><item><description>description</description><name>x</name></item><item><name>y</name></item><tag>b</tag><rarity>rare</rarity></roster>'
    ]) {
        const scanner = guard();
        for (let end = 1; end <= xml.length; end++) assert.equal(scanner.inspect(xml.slice(0, end)), null, `${xml} at ${end}`);
        assert.equal(scanner.terminalState(xml).incomplete, false);
    }
});

test('schema rejects unknown children, duplicate singleton, wrong nesting and missing required descendants', () => {
    for (const xml of [
        '<roster><unknown/>', '<roster><owner>one</owner><owner>two',
        '<roster><item><owner>wrong</owner>', '<roster><owner>x</owner></roster>',
        '<roster><owner>x</owner><item/></roster>'
    ]) assert.ok(guard().inspect(xml), xml);
});

test('deterministic structure opens missing required names, closes satisfied frames and rewinds partial markup', () => {
    assert.deepEqual(guard().nextForcedPrefix(''), { rewindOffset: 0, text: '<roster>', requirement: 'roster' });
    assert.equal(guard().nextForcedPrefix('<roster>').text, '<owner>');
    assert.equal(guard().nextForcedPrefix('<roster><owner>x').text, '</owner>');
    const partial = '<roster><owner>x</owner><it';
    const decision = guard().nextForcedPrefix(partial);
    assert.equal(decision.rewindOffset, partial.indexOf('<it'));
    assert.equal(decision.text, '<item>');
    assert.equal(guard().nextForcedPrefix('<roster><owner>x</owner><item><name>x</name></item>').text, '</roster>');
});

test('CDATA inner tags precede CDATA and outer closure in forced order', () => {
    const text = '<roster><owner><![CDATA[<inner>';
    let decision = guard().nextForcedPrefix(text);
    assert.equal(decision.text, '</inner>');
    decision = guard().nextForcedPrefix(text + '</inner>');
    assert.equal(decision.text, ']]>');
    decision = guard().nextForcedPrefix(text + '</inner>]]>');
    assert.equal(decision.text, '</owner>');
});

const { LiveDeslopController } = require('../LiveDeslop.js');
const controller = () => new LiveDeslopController({ detectSlop: async () => null });
const sampled = (text, start, top = []) => ({ id: 1, token: text, start, end: start + text.length, logprob: -0.1, top_logprobs: top });

test('sampled valid branch wins before forced required tag; opaque failures force a tag without fabricated token IDs', async () => {
    const prefix = '<roster>';
    const wrong = '<unknown/>';
    const options = { responseText: prefix + wrong, schema, remainingTokens: 50, continuationLimit: 5 };
    const chosen = await controller().inspectXml({ ...options, tokenRecords: [sampled(wrong, prefix.length, [{ id: 2, token: '<owner>', logprob: -0.2 }])] });
    assert.equal(chosen.alternative.token, '<owner>');
    assert.notEqual(chosen.forcedStructure, true);
    const forced = await controller().inspectXml({ ...options, tokenRecords: [] });
    assert.equal(forced.rewindOffset, prefix.length);
    assert.equal(forced.alternative.token, '<owner>');
    assert.equal(forced.forcedStructure, true);
    assert.equal(forced.alternative.id, undefined);
    assert.equal(forced.alternative.logprob, undefined);
    await assert.rejects(controller().inspectXml({ ...options, tokenRecords: [], remainingTokens: 0 }), /budget/i);
});

test('actual EOS with no viable sample forces only the required structural prefix', async () => {
    const text = '<roster><owner>x</owner><it';
    const terminal = { reason: 'eos_token', sample: { id: 99, token: '<|im_end|>', logprob: -0.1, top_logprobs: [] }, stop_token_ids: [99] };
    const result = await controller().inspectXmlTerminal({ responseText: text, terminal, finishReason: 'stop', schema, remainingTokens: 50, continuationLimit: 5 });
    assert.equal(result.rewindOffset, text.indexOf('<it'));
    assert.equal(result.alternative.token, '<item>');
    assert.equal(result.forcedStructure, true);
    assert.equal(result.terminalSample, true);
    const bounded = controller();
    await bounded.inspectXmlTerminal({ responseText: '<roster>', terminal, finishReason: 'stop', schema, remainingTokens: 50, continuationLimit: 1 });
    await assert.rejects(bounded.inspectXmlTerminal({ responseText: '<roster><owner>', terminal, finishReason: 'stop', schema, remainingTokens: 49, continuationLimit: 1 }), /limit|exhaust/i);
});

test('schema container CDATA cannot hide nonempty text or satisfy child requirements', async () => {
    for (const cdata of ['<![CDATA[words]]>', '<![CDATA[<owner>x</owner>]]>']) {
        const prefix = '<roster>';
        const xml = prefix + cdata + '<owner>x</owner><item><name>y</name></item></roster>';
        const result = guard().inspect(xml);
        assert.ok(result, cdata);
        assert.equal(result.rewindStart, prefix.length);
        const forced = await controller().inspectXml({ responseText: xml, tokenRecords: [], schema, remainingTokens: 30, continuationLimit: 3 });
        assert.equal(forced.rewindOffset, prefix.length);
        assert.equal(forced.alternative.token, '<owner>');
    }
    for (const empty of ['<![CDATA[]]>', '<![CDATA[ \n ]]>' ]) {
        assert.equal(guard().inspect(`<roster>${empty}<owner>x</owner><item><name>y</name></item></roster>`), null);
    }
    assert.equal(guard().inspect('<roster><owner><![CDATA[text <i>em</i>]]></owner><item><name>y</name></item></roster>'), null);
});

test('declared rich markup allows balanced nested tags only inside marked field', async () => {
    const { compileXmlGenerationSchema } = require('../XmlGenerationSchema.js');
    const richSchema = compileXmlGenerationSchema('<location><name>Name</name><description markup="true">Description</description></location>');
    const valid = '<location><name>Harbor</name><description><p>A <strong>busy</strong> wharf.</p></description></location>';
    const parsed = require('../Location.js').parseXMLSnippet(valid, { existingLocation: { id: 'stub', name: 'Harbor', isStub: true, generationHints: {} } });
    assert.match(parsed.data.description, /<strong>busy<\/strong>/);
    const scanner = new XmlClosingTagGuard({ schema: richSchema });
    for (let end = 1; end <= valid.length; end++) assert.equal(scanner.inspect(valid.slice(0, end)), null, `prefix ${end}`);
    for (const invalid of ['<location><name><em>Harbor</em></name>', '<location><name>Harbor</name><description><p></description>', '<location><name>Harbor</name><description><p></location>']) assert.ok(new XmlClosingTagGuard({ schema: richSchema }).inspect(invalid), invalid);
    const prefix = '<location><name>Harbor</name><description><p>';
    const result = await controller().inspectXml({ responseText: prefix + '</location>', tokenRecords: [], schema: richSchema, remainingTokens: 30, continuationLimit: 3 });
    assert.equal(result.rewindOffset, prefix.length);
    assert.equal(result.alternative.token, '</p>');
});

test('production location schema accepts parser-valid rich description and optional stub fields', () => {
    const locationSchema = loadXmlGenerationSchema('location.schema.xml');
    const xml = '<location><description><p>Lanterns over <em>canals</em>.</p></description><dangerLevel>1</dangerLevel><newExits/></location>';
    const parsed = require('../Location.js').parseXMLSnippet(xml, { existingLocation: { id: 'stub', name: 'Canal', isStub: true, generationHints: {} }, requireDangerLevel: true });
    assert.match(parsed.data.description, /<em>canals<\/em>/);
    assert.equal(new XmlClosingTagGuard({ schema: locationSchema }).inspect(xml), null);
});
