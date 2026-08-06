const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');

const {
    addEvalFilter,
    addLocationInfoGlobal,
    addRandomWordGlobal
} = require('../nunjucks_filters.js');

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

test('randomword global renders a word from data/words.txt', () => {
    const env = new nunjucks.Environment(null, {
        autoescape: false,
        throwOnUndefined: true
    });
    assert.equal(typeof addRandomWordGlobal, 'function');
    addRandomWordGlobal(env);
    const originalRandom = Math.random;

    try {
        Math.random = () => 0;
        assert.equal(env.renderString('{{ randomword() }}'), 'the');
    } finally {
        Math.random = originalRandom;
    }
});

test('getLocationInfo renders an exact destination name and stub description', () => {
    const env = new nunjucks.Environment(null, {
        autoescape: false,
        throwOnUndefined: true
    });
    addLocationInfoGlobal(env, {
        getLocations: () => [{
            id: 'loc_kitchen_exterior',
            name: 'Community Kitchen Exterior',
            description: null,
            stubMetadata: {
                stubDescription: 'A broad covered terrace outside the community kitchen.'
            }
        }]
    });

    const rendered = env.renderString(
        '{% set location = getLocationInfo(name, id) %}{{ location.name }}|{{ location.description }}',
        {
            id: 'loc_kitchen_exterior',
            name: 'Community Kitchen Exterior'
        }
    );

    assert.equal(
        rendered,
        'Community Kitchen Exterior|A broad covered terrace outside the community kitchen.'
    );
});

test('getLocationInfo rejects ambiguous name-only matches', () => {
    const env = new nunjucks.Environment(null, {
        autoescape: false,
        throwOnUndefined: true
    });
    addLocationInfoGlobal(env, {
        getLocations: () => [
            { id: 'loc_north_gate', name: 'North Gate', description: 'The northern gate.' },
            { id: 'loc_south_gate', name: 'South Gate', description: 'The southern gate.' }
        ]
    });

    assert.throws(
        () => env.renderString('{{ getLocationInfo("Gate").name }}'),
        /location "Gate" is ambiguous/i
    );
});
