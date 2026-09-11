const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../views/index.njk'), 'utf8');
const start = source.indexOf('        const TOUCH_TOOLTIP_SUPPRESS_MS =');
const end = source.indexOf('        function wireContextMenuButtonTooltipSuppression', start);
assert.ok(start >= 0 && end > start);

function setup({ mobile = false, touch = false } = {}) {
    const listeners = new Map();
    const hidden = [];
    let now = 10000;
    const context = vm.createContext({
        Date: { now: () => now },
        window: {
            matchMedia: query => ({ matches: query === '(max-width: 768px)' ? mobile : touch }),
            navigator: { maxTouchPoints: touch ? 1 : 0 },
            floatingTooltipController: { hide: () => hidden.push('item/text') },
            hidePartyTooltip: () => hidden.push('NPC')
        },
        document: {
            querySelector: () => null,
            addEventListener: (type, handler, options) => listeners.set(type, { handler, options })
        }
    });
    vm.runInContext(source.slice(start, end), context);
    return { context, listeners, hidden, advance: ms => { now += ms; } };
}

for (const options of [{ mobile: true }, { touch: true }]) {
    test(`tap dismisses all shared tooltips and suppresses reopening: ${JSON.stringify(options)}`, () => {
        const fixture = setup(options);
        const click = fixture.listeners.get('click');
        assert.equal(click.options.capture, true);
        assert.equal(click.options.passive, true);
        // No event cancellation methods: dismissal must not consume the control's action.
        click.handler({});
        assert.deepEqual(fixture.hidden, ['item/text', 'NPC']);
        assert.equal(fixture.context.shouldSuppressContextTooltips(), true);
        fixture.advance(1401);
        assert.equal(fixture.context.shouldSuppressContextTooltips(), false);
    });
}

test('desktop mouse clicks preserve hover tooltips', () => {
    const fixture = setup();
    fixture.listeners.get('click').handler({});
    assert.deepEqual(fixture.hidden, []);
    assert.equal(fixture.context.shouldSuppressContextTooltips(), false);
});
