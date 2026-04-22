const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');

function renderLocationImagePromptTemplate({ hasLocalWeather = true, weatherScope = hasLocalWeather ? 'yes' : 'no' } = {}) {
    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'templates'), { noCache: true }),
        {
            autoescape: false,
            throwOnUndefined: false,
            trimBlocks: true,
            lstripBlocks: true
        }
    );

    return env.render('location-image-prompt.njk', {
        image: {
            prompt: 'wide establishing shot of a winding creek path'
        },
        location: {
            id: 'location-1',
            name: 'Winding Creek Path',
            generationHints: {
                hasWeather: hasLocalWeather
            }
        },
        hasLocalWeather,
        weatherScope
    }).replace(/\n{3,}/g, '\n\n').trim();
}

test('location image prompt template appends the neutral baseline time and weather', () => {
    assert.equal(
        renderLocationImagePromptTemplate({ hasLocalWeather: true }),
        'wide establishing shot of a winding creek path\n\nTime: noon\nWeather: clear'
    );
});

test('location image prompt template omits weather for sheltered locations', () => {
    assert.equal(
        renderLocationImagePromptTemplate({ hasLocalWeather: false }),
        'wide establishing shot of a winding creek path\n\nTime: noon'
    );
});

test('location image prompt template labels outside-visible weather', () => {
    assert.equal(
        renderLocationImagePromptTemplate({ hasLocalWeather: true, weatherScope: 'outside' }),
        'wide establishing shot of a winding creek path\n\nTime: noon\nWeather outside: clear'
    );
});
