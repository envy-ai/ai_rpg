const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const SettingInfo = require('../SettingInfo.js');

const baseDir = path.join(__dirname, '..');

function buildCalendar(overrides = {}) {
  return {
    ...Globals.generateCalendarDefinition({ settingName: 'Calendar Test' }),
    yearName: 'Test Reckoning',
    ...overrides
  };
}

test('SettingInfo persists a normalized setting calendar definition', () => {
  SettingInfo.clear();
  const setting = new SettingInfo({
    name: 'Calendar Profile',
    calendarDefinition: buildCalendar()
  });

  const serialized = setting.toJSON();
  assert.equal(serialized.calendarDefinition.yearName, 'Test Reckoning');
  assert.equal(serialized.calendarDefinition.months[0].name, 'January');
  assert.equal(serialized.calendarDefinition.weekdays.length, 7);

  serialized.calendarDefinition.yearName = 'Mutated Outside';
  assert.equal(setting.calendarDefinition.yearName, 'Test Reckoning');

  SettingInfo.clear();
});

test('SettingInfo rejects invalid setting calendar definitions', () => {
  SettingInfo.clear();
  assert.throws(
    () => new SettingInfo({
      name: 'Invalid Calendar Profile',
      calendarDefinition: {
        yearName: 'Broken',
        months: [],
        weekdays: ['Firstday']
      }
    }),
    /Calendar definition must include at least one month/
  );
  SettingInfo.clear();
});

test('settings editor exposes a Calendar tab second from the right', () => {
  const env = nunjucks.configure(path.join(baseDir, 'views'), { autoescape: false });
  const rendered = env.render('settings.njk', {
    title: 'World Profiles',
    unifiedTonalScaleDefinition: {},
    unifiedTonalScaleError: ''
  });

  const promptIndex = rendered.indexOf('data-editor-tab="prompts"');
  const calendarIndex = rendered.indexOf('data-editor-tab="calendar"');
  const imagesIndex = rendered.indexOf('data-editor-tab="images"');

  assert.ok(calendarIndex !== -1, 'settings editor should render a Calendar tab');
  assert.ok(promptIndex < calendarIndex, 'Calendar tab should come after Prompt Guidance');
  assert.ok(calendarIndex < imagesIndex, 'Calendar tab should be second from the right before Image Prefixes');
  assert.match(rendered, /id="calendarDefinition"/);
  assert.match(rendered, /id="settingsCalendarGenerateBtn"/);
  assert.match(rendered, /id="settingsCalendarUseDefaultBtn"/);
  assert.match(rendered, /id="settingsCalendarClearBtn"/);
});

test('settings page can generate and save profile calendar definitions', () => {
  const source = fs.readFileSync(path.join(baseDir, 'views', 'settings.njk'), 'utf8');
  assert.ok(/fetch\('\/api\/settings\/calendar\/generate'/.test(source), 'settings page should call the calendar generation API');
  assert.ok(/settingData\.calendarDefinition/.test(source), 'settings form submission should include calendarDefinition');
  assert.ok(/applyCalendarDefinitionToForm/.test(source), 'settings page should render calendar definitions into the editor');
  assert.ok(/collectCalendarDefinitionFromForm/.test(source), 'settings page should collect calendar definitions from the editor');
});

test('settings calendar tab uses structured fields instead of raw JSON editing', () => {
  const env = nunjucks.configure(path.join(baseDir, 'views'), { autoescape: false });
  const rendered = env.render('settings.njk', {
    title: 'World Profiles',
    unifiedTonalScaleDefinition: {},
    unifiedTonalScaleError: ''
  });
  const source = fs.readFileSync(path.join(baseDir, 'views', 'settings.njk'), 'utf8');

  assert.doesNotMatch(rendered, /id="settingsCalendarJson"/);
  assert.doesNotMatch(rendered, /id="settingsCalendarFormatBtn"/);
  assert.match(rendered, /id="settingsCalendarYearName"/);
  assert.match(rendered, /id="settingsCalendarSubTabMonths"/);
  assert.match(rendered, /id="settingsCalendarSubTabWeekdays"/);
  assert.match(rendered, /id="settingsCalendarSubTabSeasons"/);
  assert.match(rendered, /id="settingsCalendarSubTabHolidays"/);
  assert.match(rendered, /id="settingsCalendarMonthsList"/);
  assert.match(rendered, /id="settingsCalendarWeekdaysList"/);
  assert.match(rendered, /id="settingsCalendarSeasonsList"/);
  assert.match(rendered, /id="settingsCalendarHolidaysList"/);
  assert.match(rendered, /id="settingsCalendarAddMonthBtn"/);
  assert.match(rendered, /id="settingsCalendarAddWeekdayBtn"/);
  assert.match(rendered, /id="settingsCalendarAddSeasonBtn"/);
  assert.match(rendered, /id="settingsCalendarAddHolidayBtn"/);
  assert.match(source, /refreshCalendarReferenceControls/);
  assert.match(source, /createSettingsCalendarMonthSelect/);
  assert.match(source, /populateSettingsCalendarDaySelect/);
});

test('settings API exposes calendar generation and new game prefers saved profile calendars', () => {
  const apiSource = fs.readFileSync(path.join(baseDir, 'api.js'), 'utf8');
  assert.ok(/app\.post\('\/api\/settings\/calendar\/generate'/.test(apiSource), 'API should expose setting calendar generation');
  assert.ok(/normalizeSettingPayload[\s\S]*calendarDefinition/.test(apiSource), 'settings payload normalization should include calendarDefinition');

  const resolverStart = apiSource.indexOf('async function resolveCalendarDefinitionForSetting');
  assert.ok(resolverStart !== -1, 'API should define resolveCalendarDefinitionForSetting');
  const resolverSource = apiSource.slice(resolverStart, apiSource.indexOf('// Create a new game', resolverStart));
  const storedCalendarIndex = resolverSource.indexOf('settingSnapshot?.calendarDefinition');
  const aiGenerationIndex = resolverSource.indexOf('generateCalendarDefinitionWithAi({ settingSnapshot })');
  assert.ok(storedCalendarIndex !== -1, 'calendar resolver should inspect settingSnapshot.calendarDefinition');
  assert.ok(aiGenerationIndex !== -1, 'calendar resolver should still support AI generation');
  assert.ok(storedCalendarIndex < aiGenerationIndex, 'saved setting calendars should be preferred before AI generation');
});
