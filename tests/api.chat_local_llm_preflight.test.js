const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { ManagedLocalLlmController } = require('../ManagedLocalLlmController.js');

const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
const routeMarker = "app.post('/api/chat', withTurnPromptAudit('/api/chat', async (req, res) => {";
const start = source.indexOf(routeMarker);
const bodyStart = start + routeMarker.length;
const bodyEnd = source.indexOf('            const releaseActiveChatTurn = trackActiveChatTurn();', bodyStart);
assert.ok(start >= 0 && bodyEnd > bodyStart, 'chat preflight must precede active turn registration');
const preamble = source.slice(bodyStart, bodyEnd);

function controller(kind, desiredOn) {
    return new ManagedLocalLlmController({
        desiredOn,
        resolveConfiguration: () => kind ? { kind } : null,
        inspect: async () => false,
        start: async () => {}, stop: async () => {},
        withExclusiveModelLifecycle: task => task()
    });
}
async function invoke({ kind = 'llama', desiredOn = false, text = 'Travel north', travel = false, getController } = {}) {
    const effects = [];
    const scope = { getManagedLocalLlmController: getController || (() => controller(kind, desiredOn)) };
    const handler = vm.runInNewContext(`(async (req, res) => {${preamble}\n return proceed(); })`, {
        scope, proceed: () => { effects.push('active turn and subsequent gameplay processing'); return 'continued'; }
    });
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const result = await handler({ body: { messages: [{ role: 'user', content: text }], travel } }, response);
    return { effects, response, result };
}

for (const kind of ['llama', 'strata']) {
    for (const [text, travel] of [['Travel north', true], ['# Mira moved north.', true], ['Act', false], ['? Where am I?', false]]) {
        test(`${kind} off rejects ${JSON.stringify(text)}, travel=${travel} before gameplay`, async () => {
            const { effects, response } = await invoke({ kind, text, travel });
            assert.deepEqual(effects, []);
            assert.equal(response.statusCode, 409);
            assert.equal(response.body.code, 'LOCAL_LLM_OFF');
            assert.match(response.body.error, /switched off/i);
            assert.match(response.body.stack, /assertPromptAllowed/);
        });
    }
}

test('ordinary comment proceeds even when the managed model is off', async () => {
    const { effects, result } = await invoke({ text: '  # A comment', travel: false });
    assert.equal(result, 'continued');
    assert.equal(effects.length, 1);
});
for (const [kind, desiredOn] of [['llama', true], ['strata', true], [null, false]]) {
    test(`${kind || 'unconfigured remote-only'} ${desiredOn ? 'on' : 'off'} proceeds`, async () => {
        const { effects, result } = await invoke({ kind, desiredOn });
        assert.equal(result, 'continued');
        assert.equal(effects.length, 1);
    });
}
test('unexpected controller failures retain stack and do not begin a turn', async () => {
    const { response, effects } = await invoke({ getController: () => { throw new Error('Controller unavailable'); } });
    assert.equal(response.statusCode, 500);
    assert.match(response.body.stack, /Controller unavailable/);
    assert.deepEqual(effects, []);
});
