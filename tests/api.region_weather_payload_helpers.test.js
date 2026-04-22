const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadRegionPayloadHelpers() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf('        function buildRegionApiPayload(region) {');
    const end = source.indexOf('\n        function buildRegionParentOptions', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate region payload helpers in api.js');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Array,
        Boolean,
        Map,
        Number,
        Object,
        regions: new Map()
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.buildRegionApiPayload = buildRegionApiPayload;`,
        context
    );

    return context;
}

test('region API payload includes weather definition and current weather state', () => {
    const context = loadRegionPayloadHelpers();
    context.regions.set('parent-region', {
        id: 'parent-region',
        name: 'Parent Region'
    });
    const weather = {
        hasDynamicWeather: true,
        seasonWeather: [
            {
                seasonName: 'Spring',
                weatherTypes: [
                    {
                        name: 'Soft Rain',
                        description: 'A light rain mists the fields.',
                        relativeFrequency: 2,
                        durationRange: { minMinutes: 30, maxMinutes: 90 }
                    }
                ]
            }
        ]
    };
    const weatherState = {
        seasonName: 'Spring',
        name: 'Soft Rain',
        description: 'A light rain mists the fields.',
        durationMinutes: 45,
        nextChangeMinutes: 120
    };

    const payload = context.buildRegionApiPayload({
        id: 'region-1',
        name: 'Rain Vale',
        description: 'A valley with changing skies.',
        shortDescription: 'Rainy valley',
        parentRegionId: 'parent-region',
        averageLevel: 4,
        controllingFactionId: 'faction-1',
        isVehicle: false,
        vehicleInfo: null,
        secrets: ['Hidden lake'],
        weather,
        weatherState
    });

    assert.equal(payload.parentRegionName, 'Parent Region');
    assert.deepEqual(payload.weather, weather);
    assert.deepEqual(payload.weatherState, weatherState);
});
