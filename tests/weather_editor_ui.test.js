const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');
const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');

test('location menus expose a region weather editor action and modal', () => {
    assert.match(viewSource, /id="locationWeatherEditButton"/);
    assert.match(viewSource, /id="mapLocationMenuWeatherButton"/);
    assert.match(viewSource, /id="regionWeatherEditModal"/);
    assert.match(viewSource, /id="regionWeatherEditForm"/);
    assert.match(viewSource, /openRegionWeatherEditModal/);
    assert.match(viewSource, /submitRegionWeatherEditForm/);
});

test('location edit modal exposes the hasWeather selector', () => {
    assert.match(viewSource, /id="locationEditHasWeather"/);
    assert.match(viewSource, /value="outside">Weather visible outside/);
    assert.match(viewSource, /payload\.hasWeather/);
});

test('weather editor has dedicated styling hooks', () => {
    assert.match(scssSource, /\.region-weather-edit-modal/);
    assert.match(scssSource, /\.region-weather-season/);
    assert.match(scssSource, /\.region-weather-type-row/);
});
