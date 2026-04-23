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
    assert.match(viewSource, /id="calendarEditYearName"/);
    assert.match(viewSource, /openCalendarEditModal/);
    assert.match(viewSource, /submitCalendarEditForm/);
});

test('calendar editor uses dedicated calendar API routes', () => {
    assert.match(apiSource, /app\.get\('\/api\/calendar'/);
    assert.match(apiSource, /app\.put\('\/api\/calendar'/);
    assert.match(viewSource, /fetch\('\/api\/calendar'/);
    assert.match(viewSource, /method: 'PUT'/);
});

test('calendar editor exposes structured field tabs instead of the JSON textarea', () => {
    assert.match(viewSource, /id="calendarEditTabMonths"/);
    assert.match(viewSource, /id="calendarEditTabWeekdays"/);
    assert.match(viewSource, /id="calendarEditTabSeasons"/);
    assert.match(viewSource, /id="calendarEditTabHolidays"/);
    assert.match(viewSource, /id="calendarEditMonthsList"/);
    assert.match(viewSource, /id="calendarEditWeekdaysList"/);
    assert.match(viewSource, /id="calendarEditSeasonTabs"/);
    assert.match(viewSource, /id="calendarEditSeasonPanels"/);
    assert.match(viewSource, /id="calendarEditHolidaysList"/);
    assert.doesNotMatch(viewSource, /id="calendarEditJson"/);
    assert.doesNotMatch(viewSource, />Format JSON</);
});

test('calendar editor has render and collect helpers for every calendar section', () => {
    assert.match(viewSource, /renderCalendarEditorFromDefinition/);
    assert.match(viewSource, /collectCalendarDefinitionFromEditor/);
    assert.match(viewSource, /createCalendarMonthRow/);
    assert.match(viewSource, /createCalendarWeekdayRow/);
    assert.match(viewSource, /createCalendarSeasonEditor/);
    assert.match(viewSource, /createCalendarTimeDescriptionRow/);
    assert.match(viewSource, /createCalendarHolidayRow/);
});

test('calendar editor exposes add and reorder controls for ordered sections', () => {
    assert.match(viewSource, /id="calendarEditAddMonthBtn"/);
    assert.match(viewSource, /id="calendarEditAddWeekdayBtn"/);
    assert.match(viewSource, /id="calendarEditAddSeasonBtn"/);
    assert.match(viewSource, /id="calendarEditAddHolidayBtn"/);
    assert.match(viewSource, /calendar-edit-move-up/);
    assert.match(viewSource, /calendar-edit-move-down/);
    assert.match(viewSource, /calendar-edit-time-add/);
});

test('calendar editor has dedicated field-based styling hooks', () => {
    assert.match(scssSource, /\.calendar-edit-modal/);
    assert.match(scssSource, /\.calendar-edit-tabs/);
    assert.match(scssSource, /\.calendar-edit-row/);
    assert.match(scssSource, /\.calendar-edit-season-tabs/);
    assert.match(scssSource, /\.calendar-edit-time-row/);
});
