const test = require('node:test');
const assert = require('node:assert/strict');
const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');

test('tool_call policy recognizes actual elements across splits and ignores XML text constructs', () => {
    assert.throws(() => new XmlClosingTagGuard({ allowToolCalls: 'false' }), TypeError);
    assert.throws(() => new XmlClosingTagGuard({ checkStructure: 'false' }), TypeError);
    const guard = new XmlClosingTagGuard({ mode: true, allowToolCalls: false });
    assert.equal(guard.inspect('<root><tool_cal'), null);
    const problem = guard.inspect('<root><tool_call ');
    assert.equal(problem.kind, 'xml-tool-call-policy');
    assert.equal(problem.actualName, 'tool_call');
    assert.match(problem.path, /root\/tool_call/);
    for (const text of ['<root>&lt;tool_call/&gt;</root>', '<root><!-- <tool_call/> --></root>', '<root><![CDATA[<tool_call/>]]></root>', '<root value="<tool_call/>"/>', '<root><tool_callback/></root>']) {
        assert.equal(new XmlClosingTagGuard({ mode: true, allowToolCalls: false }).inspect(text), null, text);
    }
    assert.equal(new XmlClosingTagGuard({ mode: true, allowToolCalls: true }).inspect('<root><tool_call/></root>'), null);
});

test('scanner accepts properly nested XML, markup literals and split valid closes', () => {
    const guard = new XmlClosingTagGuard();
    const text = '<?xml version="1.0"?><ns:根 attr="</wrong> >"><!-- </bad> --><![CDATA[<inner>text</inner>]]><?work a="</wrong>"?><self/><child>text</child></ns:根>';
    for (let end = 1; end <= text.length; end++) assert.equal(guard.inspect(text.slice(0, end)), null, `prefix ${end}`);
});

test('scanner identifies duplicate, wrong-ancestor, case-sensitive and empty-stack closes', () => {
    const guard = new XmlClosingTagGuard();
    for (const [text, actual, expected] of [
        ['<item><isVehicle>false</isVehicle><!-- copied --> </isVehicle>', 'isVehicle', 'item'],
        ['<root><child></root>', 'root', 'child'],
        ['<Root></root>', 'root', 'Root'],
        ['</orphan>', 'orphan', null],
        ['<ns:根><ns:子/></ns:wrong>', 'ns:wrong', 'ns:根']
    ]) {
        const detection = guard.inspect(text);
        assert.ok(detection, text);
        assert.equal(detection.actualName, actual);
        assert.equal(detection.expectedName, expected);
        assert.equal(text.slice(detection.start, detection.end), `</${actual}>`);
    }
});

test('scanner recomputes state from retained prefill after rejected suffix', () => {
    const guard = new XmlClosingTagGuard();
    const prefix = '<root><child><leaf/>';
    assert.equal(guard.inspect(prefix), null);
    assert.equal(guard.inspect(`${prefix}</root>`).expectedName, 'child');
    assert.equal(guard.inspect(`${prefix}</child><next/></root>`), null);
    assert.equal(guard.inspect(`${prefix}</ch`), null);
});

const { LiveDeslopController } = require('../LiveDeslop.js');
const record = (id, token, start, alternatives = []) => ({ id, token, start, end: start + token.length, logprob: -0.1, top_logprobs: [{ id, token, logprob: -0.1 }, ...alternatives] });

test('wrong-close alternatives cannot introduce forbidden tool calls', async () => {
    const prefix = '<root>';
    const tokenRecords = [record(1, prefix, 0), record(2, '</wrong>', prefix.length, [
        { id: 3, token: '<tool_call/>', logprob: -0.11 },
        { id: 4, token: '</root>', logprob: -0.2 }
    ])];
    const result = await new LiveDeslopController({ detectSlop: async () => null }).inspectXml({ responseText: `${prefix}</wrong>`, tokenRecords, allowToolCalls: false });
    assert.equal(result.alternative.token, '</root>');
    const onlyForbidden = [record(1, prefix, 0), record(2, '<tool_call/>', prefix.length, [{ id: 3, token: '<tool_call name="x"/>', logprob: -0.2 }])];
    await assert.rejects(new LiveDeslopController({ detectSlop: async () => null }).inspectXml({ responseText: `${prefix}<tool_call/>`, tokenRecords: onlyForbidden, allowToolCalls: false }), error => {
        assert.match(error.message, /no native tools/i);
        assert.match(error.message, /without <tool_call>/i);
        return true;
    });
});

test('raw XML branch rejects control tokens and chooses viable markup alternative', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    const prefix = '<root><item/>';
    const text = `${prefix}</wrong>`;
    const tokens = [record(1, prefix, 0), record(2, '</wrong>', prefix.length, [
        { id: 10, token: '<|im_end|>', logprob: -0.11 },
        { id: 11, token: '<|endoftext|>', logprob: -0.12 },
        { id: 12, token: '</root>', logprob: -0.13 }
    ])];
    const result = await controller.inspectXml({ responseText: text, tokenRecords: tokens });
    assert.equal(result.rewindOffset, prefix.length);
    assert.equal(result.alternative.token, '</root>');
    assert.equal(result.disableTools, false);
    assert.equal(result.diagnostic.matchType, 'xml-closing-tag');
    await assert.rejects(controller.inspectXml({ responseText: text, tokenRecords: tokens }), /no sampled token alternative/i);
});

test('wrong close without usable sampled alternatives fails explicitly without altering text', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    const text = '<root><item/></wrong>';
    await assert.rejects(controller.inspectXml({ responseText: text, tokenRecords: [] }), /no sampled token alternative/i);
    assert.equal(text, '<root><item/></wrong>');
});

test('auto mode recognizes leading XML and leaves ordinary prose untouched', () => {
    for (const text of ['<root></wrong>', '  ```xml\n<root></wrong>', '<!-- example --><root></wrong>', '<?xml version="1.0"?><root></wrong>', '</orphan>']) {
        const guard = new XmlClosingTagGuard({ mode: 'auto' });
        let found = null;
        for (let end = 1; end <= text.length; end++) found = guard.inspect(text.slice(0, end)) || found;
        assert.ok(found, text);
    }
    for (const text of ['A sentence mentions </wrong>.', '<3 a heart and </wrong>.']) {
        const guard = new XmlClosingTagGuard({ mode: 'auto' });
        for (let end = 1; end <= text.length; end++) assert.equal(guard.inspect(text.slice(0, end)), null, text);
    }
});

test('split closing token can rewind to a valid partial-name alternative', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    const text = '<root></wrong>';
    const tokens = [record(1, '<root>', 0), record(2, '</', 6), record(3, 'wrong', 8, [{ id: 4, token: 'root', logprob: -0.2 }]), record(5, '>', 13)];
    const decision = await controller.inspectXml({ responseText: text, tokenRecords: tokens });
    assert.equal(decision.rewindOffset, 8);
    assert.equal(decision.alternative.token, 'root');
    assert.equal(new XmlClosingTagGuard().inspect('<root></root>'), null);
});

test('guard does not fabricate missing closing tags or replace final strict parser', () => {
    const { parseXmlDocumentStrict } = require('../Utils.js');
    const incomplete = '<root><item>';
    assert.equal(new XmlClosingTagGuard().inspect(incomplete), null);
    assert.throws(() => parseXmlDocumentStrict(incomplete, 'text/xml'));
});

test('DOCTYPE internal comments do not affect subset or quote state at any chunk boundary', () => {
    const xml = '<!DOCTYPE root [<!-- owner\'s note ] --> <!ELEMENT root ANY>]><root><child/></root>';
    for (const mode of [true, 'auto']) {
        const guard = new XmlClosingTagGuard({ mode });
        for (let end = 1; end <= xml.length; end++) assert.equal(guard.inspect(xml.slice(0, end)), null, `${mode}: ${end}`);
        const wrong = `${xml}</orphan>`;
        assert.equal(guard.inspect(wrong)?.actualName, 'orphan');
    }
});

test('raw branch rejects malformed opening alternatives before accepting a viable close', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    const prefix = '<root>';
    const text = `${prefix}</wrong>`;
    const decision = await controller.inspectXml({ responseText: text, tokenRecords: [record(1, prefix, 0), record(2, '</wrong>', prefix.length, [{ id: 3, token: '<1bad>', logprob: -0.11 }, { id: 5, token: '</root>', logprob: -0.2 }])] });
    assert.equal(decision.alternative.token, '</root>');
});

test('CDATA boundaries allow balanced inner markup but reject closing its outer element or an open inner element', () => {
    const valid = '<root><description><![CDATA[<arbitrary><nested/><b>text</b></arbitrary>]]></description></root>';
    const guard = new XmlClosingTagGuard({ mode: true });
    for (let end = 1; end <= valid.length; end++) assert.equal(guard.inspect(valid.slice(0, end)), null, `valid prefix ${end}`);
    for (const invalid of [
        '<root><description><![CDATA[</description>',
        '<root><description><![CDATA[<inner><deep></inner>',
        '<root><description><![CDATA[<inner>]]>'
    ]) assert.ok(new XmlClosingTagGuard({ mode: true }).inspect(invalid), invalid);
    const prefix = '<root><description><![CDATA[<inner>';
    const rewound = new XmlClosingTagGuard({ mode: true });
    assert.ok(rewound.inspect(`${prefix}</description>`));
    assert.equal(rewound.inspect(`${prefix}</inner>]]></description></root>`), null);
});

test('CDATA treats non-tag less-than as text and respects a real terminator inside partial markup', () => {
    const guard = new XmlClosingTagGuard({ mode: true });
    const valid = '<root><![CDATA[x <3 > 1]]></root>';
    assert.equal(guard.inspect(valid), null);
    assert.equal(guard.isViablePrefix(valid), true);
    const partial = '<root><![CDATA[<em title="]]>';
    const problem = new XmlClosingTagGuard({ mode: true }).inspect(partial);
    assert.ok(problem, 'actual CDATA end cannot hide unfinished inner opening markup');
    assert.equal(problem.rewindStart, partial.indexOf('<em'));
});

test('declared root scopes inspection to the first matching document at every prefix', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const logged = fs.readFileSync(path.join(__dirname, 'fixtures/housekeeping-root-scope-response.txt'), 'utf8');
    const guard = new XmlClosingTagGuard({ mode: true, expectedRootTags: ['housekeeping'], allowToolCalls: false });
    for (let end = 1; end <= logged.length; end++) assert.equal(guard.inspect(logged.slice(0, end)), null, `logged prefix ${end}`);
    assert.equal(guard.terminalState(logged).incomplete, false);
    assert.equal(guard.inspect(`${logged}<tool_call><unclosed>`), null);
    assert.equal(guard.terminalState(`${logged}<tool_call><unclosed>`).incomplete, false);
});

test('declared roots retain strict inner nesting, raw offsets, and rewind state', () => {
    const guard = new XmlClosingTagGuard({ mode: true, expectedRootTags: ['root'], allowToolCalls: false });
    const prefix = '```xml\n<unrelated><root attr="a > b"><!-- </wrong> --><![CDATA[<inside/>]]><root>';
    const valid = `${prefix}</root></root>\n\`\`\`<unclosed>`;
    for (let end = 1; end <= valid.length; end++) assert.equal(guard.inspect(valid.slice(0, end)), null, `prefix ${end}`);
    const bad = `${prefix}</wrong>`;
    const problem = guard.inspect(bad);
    assert.equal(problem.actualName, 'wrong');
    assert.equal(problem.expectedName, 'root');
    assert.equal(problem.start, bad.lastIndexOf('</wrong>'));
    assert.equal(guard.inspect(valid), null);
    assert.equal(guard.inspect('<noise><root><tool_call/></root>').kind, 'xml-tool-call-policy');
});

test('declared roots report a missing wrapper and accept either allowed root', () => {
    for (const text of ['', 'explanation <unrelated>', '<turnResult']) {
        const state = new XmlClosingTagGuard({ mode: true, expectedRootTags: ['turnResult', 'moveTurnResult'] }).terminalState(text);
        assert.equal(state.missingRoot, true, text);
        assert.equal(state.incomplete, true, text);
    }
    for (const root of ['turnResult', 'moveTurnResult']) {
        const text = `preface <other><${root}/><trailing>`;
        const guard = new XmlClosingTagGuard({ mode: true, expectedRootTags: ['turnResult', 'moveTurnResult'] });
        assert.equal(guard.inspect(text), null);
        assert.equal(guard.terminalState(text).incomplete, false);
    }
    assert.ok(new XmlClosingTagGuard({ mode: true }).inspect('<other></wrong>'));
});
