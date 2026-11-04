const test = require('node:test');
const assert = require('node:assert/strict');
const { XmlClosingTagGuard } = require('../XmlClosingTagGuard.js');
const { LiveDeslopController } = require('../LiveDeslop.js');
const eos = alternatives => ({ reason: 'eos_token', sample: { id: 248046, token: '<|im_end|>', bytes: [], logprob: -0.1, top_logprobs: alternatives }, stop_token_ids: [248046] });
const alternative = (token, id = 7) => ({ id, token, bytes: [...Buffer.from(token)], logprob: -0.2 });

test('EOS with only forbidden tool-call alternatives fails explicitly', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    await assert.rejects(controller.inspectXmlTerminal({ responseText: '<root>', terminal: eos([alternative('<tool_call/>')]), finishReason: 'stop', remainingTokens: 100, allowToolCalls: false }), /alternative|exhaust/i);
});

test('terminal state detects open roots and unfinished lexical markup while allowing completed XML or prose', () => {
    for (const text of ['<root>', '<root><child/>', '<root attr="unfinished', '<root><!-- unfinished', '<root></ro', '<']) {
        const status = new XmlClosingTagGuard({ mode: true }).terminalState(text);
        assert.equal(status.incomplete, true, text);
    }
    assert.equal(new XmlClosingTagGuard({ mode: true }).terminalState('<root><child/></root>').incomplete, false);
    assert.equal(new XmlClosingTagGuard({ mode: 'auto' }).terminalState('Ordinary prose.').incomplete, false);
    assert.equal(new XmlClosingTagGuard({ mode: 'auto' }).terminalState('<root>').incomplete, true);
});

test('terminal EOS appends a valid non-EOS branch only while XML is incomplete', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    const text = '<root><child/>';
    const result = await controller.inspectXmlTerminal({ responseText: text, terminal: eos([alternative('<|endoftext|>', 8), alternative('</root>')]), finishReason: 'stop', remainingTokens: 100 });
    assert.equal(result.rewindOffset, text.length);
    assert.equal(result.alternative.token, '</root>');
    assert.equal(result.allowAppend, true);
    assert.equal(result.disableTools, false);
    await assert.rejects(controller.inspectXmlTerminal({ responseText: text, terminal: eos([alternative('</root>')]), finishReason: 'stop', remainingTokens: 100 }), /alternative|exhaust/i);
    assert.equal(await controller.inspectXmlTerminal({ responseText: '<root/>', terminal: eos([alternative('</root>')]), finishReason: 'stop' }), null);
    assert.equal(await controller.inspectXmlTerminal({ responseText: 'Plain text.', terminal: eos([alternative('!')]), finishReason: 'stop', mode: 'auto' }), null);
});

test('incomplete XML with no viable EOS branch fails explicitly; length and tool calls are not invented EOS', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    await assert.rejects(controller.inspectXmlTerminal({ responseText: '<root>', terminal: eos([]), finishReason: 'stop', remainingTokens: 100 }), /alternative|eos/i);
    assert.equal(await controller.inspectXmlTerminal({ responseText: '<root>', terminal: null, finishReason: 'length' }), null);
    assert.equal(await controller.inspectXmlTerminal({ responseText: '<root>', terminal: eos([]), finishReason: 'tool_calls', hasToolCalls: true }), null);
});

test('incomplete XML with stop but unknown terminal metadata fails explicitly', async () => {
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    await assert.rejects(controller.inspectXmlTerminal({ responseText: '<root>', terminal: null, finishReason: 'stop' }), /terminal|eos|metadata/i);
});

test('EOS continuation requires remaining budget, valid metadata and a bounded retry count', async () => {
    const input = { responseText: '<root>', terminal: eos([alternative('</root>')]), finishReason: 'stop' };
    await assert.rejects(new LiveDeslopController({ detectSlop: async () => null }).inspectXmlTerminal({ ...input, remainingTokens: 0 }), /budget/i);
    await assert.rejects(new LiveDeslopController({ detectSlop: async () => null }).inspectXmlTerminal({ ...input, remainingTokens: 3, terminal: { ...input.terminal, stop_token_ids: [42] } }), /invalid.*metadata/i);
    const controller = new LiveDeslopController({ detectSlop: async () => null });
    await controller.inspectXmlTerminal({ ...input, remainingTokens: 3, continuationLimit: 1 });
    await assert.rejects(controller.inspectXmlTerminal({ ...input, remainingTokens: 2, continuationLimit: 1 }), /limit.*exhaust/i);
    const pending = await new LiveDeslopController({ detectSlop: async () => null }).inspectXmlTerminal({ responseText: '<', terminal: eos([alternative('root/>')]), finishReason: 'stop', remainingTokens: 3, mode: 'auto' });
    assert.equal(pending.alternative.token, 'root/>');
});
