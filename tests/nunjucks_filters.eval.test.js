const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');

const { addEvalFilter } = require('../nunjucks_filters.js');

function createEnv() {
    const env = new nunjucks.Environment(null, {
        autoescape: false,
        throwOnUndefined: true
    });
    addEvalFilter(env);
    return env;
}

test('eval filter renders a string template with the current context', () => {
    const env = createEnv();

    const rendered = env.renderString('{{ templateText|eval }}', {
        name: 'Ada',
        templateText: 'Hello {{ name }}'
    });

    assert.equal(rendered, 'Hello Ada');
});

test('eval filter accepts explicit locals for scoped values', () => {
    const env = createEnv();

    const rendered = env.renderString(
        '{% for item in items %}{{ templateText|eval({ item: item }) }} {% endfor %}',
        {
            items: ['red', 'blue'],
            templateText: '{{ item }} {{ suffix }}',
            suffix: 'gem'
        }
    ).trim();

    assert.equal(rendered, 'red gem blue gem');
});

test('eval filter rejects non-object locals', () => {
    const env = createEnv();

    assert.throws(
        () => env.renderString('{{ templateText|eval("bad") }}', {
            templateText: 'Hello'
        }),
        /eval filter locals must be an object/
    );
});
