const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolveExplicitLocationWeatherExposure,
    resolveEffectiveLocationWeatherExposure
} = require('../LocationWeatherExposure.js');

test('explicit location weather exposure overrides automatic interior inference', () => {
    const location = {
        id: 'balcony',
        name: 'Open Balcony',
        generationHints: { hasWeather: 'sheltered' }
    };
    const region = { name: 'Castle Interior' };

    assert.equal(resolveExplicitLocationWeatherExposure(location), 'sheltered');
    assert.equal(resolveEffectiveLocationWeatherExposure(location, { region }), 'sheltered');
});

test('legacy null exposure resolves enclosed locations from their interior region', () => {
    const location = {
        id: 'loft',
        name: 'Loft',
        generationHints: { hasWeather: null }
    };

    assert.equal(
        resolveEffectiveLocationWeatherExposure(location, {
            region: { name: 'Herbal Alchemy Shop Interior' }
        }),
        'no'
    );
});

test('explicitly named exterior wins over an interior-region legacy fallback', () => {
    assert.equal(
        resolveEffectiveLocationWeatherExposure(
            { name: 'Roof Exterior', generationHints: { hasWeather: null } },
            { region: { name: 'Tower Interior' } }
        ),
        'yes'
    );
});
