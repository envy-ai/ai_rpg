const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.njk'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'main.scss'), 'utf8');

test('location context menus expose an edit calendar action and modal', () => {
    assert.match(viewSource, /id="locationCalendarEditButton"/);
    assert.match(viewSource, /id="mapLocationMenuCalendarButton"/);
    assert.match(viewSource, /id="calendarEditModal"/);
    assert.match(viewSource, /id="calendarEditForm"/);
    assert.match(viewSource, /id="calendarEditJson"/);
    assert.match(viewSource, /openCalendarEditModal/);
    assert.match(viewSource, /submitCalendarEditForm/);
});

test('calendar editor uses dedicated calendar API routes', () => {
    assert.match(apiSource, /app\.get\('\/api\/calendar'/);
    assert.match(apiSource, /app\.put\('\/api\/calendar'/);
    assert.match(viewSource, /fetch\('\/api\/calendar'/);
    assert.match(viewSource, /method: 'PUT'/);
});

test('calendar editor has dedicated styling hooks', () => {
    assert.match(scssSource, /\.calendar-edit-modal/);
    assert.match(scssSource, /\.calendar-edit-json/);
});
