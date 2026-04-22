const test = require('node:test');
const assert = require('node:assert/strict');

const Region = require('../Region.js');

test.afterEach(() => {
    Region.clear();
});

function createWeatherDefinition(name = 'Parent Rain') {
    return {
        hasDynamicWeather: true,
        seasonWeather: [
            {
                seasonName: 'Spring',
                weatherTypes: [
                    {
                        name,
                        description: `${name} falls beyond the sheltered area.`,
                        relativeFrequency: 1,
                        durationRange: {
                            minMinutes: 30,
                            maxMinutes: 30
                        }
                    }
                ]
            }
        ]
    };
}

test('region without weather inherits current weather from parent region', () => {
    const parent = new Region({
        id: 'weather-parent-region',
        name: 'Rainy Outside',
        description: 'An exterior parent region with weather.',
        weather: createWeatherDefinition('Parent Rain')
    });
    const child = new Region({
        id: 'weather-child-region',
        name: 'Windowed Interior',
        description: 'An indoor child region without its own weather.',
        parentRegionId: parent.id,
        weather: {
            hasDynamicWeather: false,
            seasonWeather: []
        }
    });

    const resolved = child.resolveCurrentWeather({
        seasonName: 'Spring',
        totalMinutes: 60
    });

    assert.equal(resolved.name, 'Parent Rain');
    assert.equal(resolved.description, 'Parent Rain falls beyond the sheltered area.');
    assert.equal(resolved.dynamic, true);
    assert.equal(child.weatherState, null);
    assert.equal(parent.weatherState.name, 'Parent Rain');
});

test('weather inheritance climbs to nearest ancestor with dynamic weather', () => {
    const grandparent = new Region({
        id: 'weather-grandparent-region',
        name: 'Stormy Outdoors',
        description: 'An exterior ancestor region with weather.',
        weather: createWeatherDefinition('Ancestor Storm')
    });
    const parent = new Region({
        id: 'weather-middle-region',
        name: 'Covered Arcade',
        description: 'A middle region without weather.',
        parentRegionId: grandparent.id,
        weather: {
            hasDynamicWeather: false,
            seasonWeather: []
        }
    });
    const child = new Region({
        id: 'weather-grandchild-region',
        name: 'Inner Shop',
        description: 'A child region without weather.',
        parentRegionId: parent.id
    });

    const resolved = child.resolveCurrentWeather({
        seasonName: 'Spring',
        totalMinutes: 60
    });

    assert.equal(resolved.name, 'Ancestor Storm');
    assert.equal(resolved.dynamic, true);
    assert.equal(child.weatherState, null);
    assert.equal(parent.weatherState, null);
    assert.equal(grandparent.weatherState.name, 'Ancestor Storm');
});

test('region without weather returns no active weather when no ancestor has weather', () => {
    const parent = new Region({
        id: 'weatherless-parent-region',
        name: 'Dry Covered District',
        description: 'A parent region without dynamic weather.',
        weather: {
            hasDynamicWeather: false,
            seasonWeather: []
        }
    });
    const child = new Region({
        id: 'weatherless-child-region',
        name: 'Dry Interior',
        description: 'A child region without dynamic weather.',
        parentRegionId: parent.id
    });

    const resolved = child.resolveCurrentWeather({
        seasonName: 'Spring',
        totalMinutes: 60
    });

    assert.equal(resolved.name, 'No active weather');
    assert.equal(resolved.description, 'Conditions are sheltered from weather effects.');
    assert.equal(resolved.dynamic, false);
    assert.equal(child.weatherState, null);
    assert.equal(parent.weatherState, null);
});

test('region without weather returns no active weather when parent region is missing', () => {
    const child = new Region({
        id: 'missing-parent-weather-child-region',
        name: 'Orphan Interior',
        description: 'A child region whose parent is not loaded.',
        parentRegionId: 'missing-parent-region'
    });

    const resolved = child.resolveCurrentWeather({
        seasonName: 'Spring',
        totalMinutes: 60
    });

    assert.equal(resolved.name, 'No active weather');
    assert.equal(resolved.description, 'Conditions are sheltered from weather effects.');
    assert.equal(resolved.dynamic, false);
    assert.equal(child.weatherState, null);
});
