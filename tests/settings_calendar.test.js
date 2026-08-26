const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');
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
  assert.match(serialized.calendarDefinition.seasons[0].vegetationDescription, /\S/);
  assert.match(serialized.calendarDefinition.seasons[0].interiorDescription, /\S/);

  serialized.calendarDefinition.yearName = 'Mutated Outside';
  assert.equal(setting.calendarDefinition.yearName, 'Test Reckoning');

  SettingInfo.clear();
});

test('SettingInfo persists world-profile default start date and time', () => {
  SettingInfo.clear();
  const setting = new SettingInfo({
    name: 'Spring Start Profile',
    defaultStartMonth: 4,
    defaultStartDay: 15,
    defaultStartTime: 13
  });

  const serialized = setting.toJSON();
  assert.equal(serialized.defaultStartMonth, 4);
  assert.equal(serialized.defaultStartDay, 15);
  assert.equal(serialized.defaultStartTime, 13);

  const restored = SettingInfo.fromJSON(serialized);
  assert.equal(restored.defaultStartMonth, 4);
  assert.equal(restored.defaultStartDay, 15);
  assert.equal(restored.defaultStartTime, 13);

  const legacy = new SettingInfo({ name: 'Legacy Profile' });
  assert.equal(legacy.defaultStartMonth, 1);
  assert.equal(legacy.defaultStartDay, 1);
  assert.equal(legacy.defaultStartTime, 9);
  SettingInfo.clear();
});

test('SettingInfo rejects invalid world-profile default start values', () => {
  SettingInfo.clear();
  assert.throws(
    () => new SettingInfo({ name: 'Bad Month', defaultStartMonth: 0 }),
    /defaultStartMonth must be an integer at least 1/
  );
  assert.throws(
    () => new SettingInfo({ name: 'Bad Day', defaultStartDay: 1.5 }),
    /defaultStartDay must be an integer at least 1/
  );
  assert.throws(
    () => new SettingInfo({ name: 'Bad Time', defaultStartTime: 24 }),
    /defaultStartTime must be an integer between 0 and 23/
  );
  const setting = new SettingInfo({ name: 'Valid Start Defaults' });
  assert.throws(
    () => setting.update({ defaultStartTime: -1 }),
    /defaultStartTime must be an integer between 0 and 23/
  );
  assert.equal(setting.defaultStartTime, 9);
  SettingInfo.clear();
});

test('SettingInfo persists per-world image prompt generation instructions', () => {
  SettingInfo.clear();
  const setting = new SettingInfo({
    name: 'Image Prompt Profile',
    imagePromptInstructionsCharacter: 'Prefer inked portraits.',
    imagePromptInstructionsLocation: 'Favor wide establishing shots.',
    imagePromptInstructionsItem: 'Keep objects isolated on plain backdrops.',
    imagePromptInstructionsScenery: 'Emphasize environmental storytelling.'
  });

  const serialized = setting.toJSON();
  assert.equal(serialized.imagePromptInstructionsCharacter, 'Prefer inked portraits.');
  assert.equal(serialized.imagePromptInstructionsLocation, 'Favor wide establishing shots.');
  assert.equal(serialized.imagePromptInstructionsItem, 'Keep objects isolated on plain backdrops.');
  assert.equal(serialized.imagePromptInstructionsScenery, 'Emphasize environmental storytelling.');

  setting.imagePromptInstructionsItem = 'Use product-photography framing.';
  assert.equal(setting.getPromptVariables().imagePromptInstructionsItem, 'Use product-photography framing.');
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

test('settings editor exposes Calendar, image-prompt-generation, and image-prefix tabs', () => {
  const env = nunjucks.configure(path.join(baseDir, 'views'), { autoescape: false });
  const rendered = env.render('settings.njk', {
    title: 'World Profiles',
    unifiedTonalScaleDefinition: {},
    unifiedTonalScaleError: ''
  });

  const promptIndex = rendered.indexOf('data-editor-tab="prompts"');
  const calendarIndex = rendered.indexOf('data-editor-tab="calendar"');
  const imagePromptGenerationIndex = rendered.indexOf('data-editor-tab="image-prompt-generation"');
  const imagesIndex = rendered.indexOf('data-editor-tab="images"');

  assert.ok(calendarIndex !== -1, 'settings editor should render a Calendar tab');
  assert.ok(imagePromptGenerationIndex !== -1, 'settings editor should render an Image Prompt Generation tab');
  assert.ok(promptIndex < calendarIndex, 'Calendar tab should come after Prompt Guidance');
  assert.ok(calendarIndex < imagePromptGenerationIndex, 'Calendar should come before Image Prompt Generation');
  assert.ok(imagePromptGenerationIndex < imagesIndex, 'Image Prompt Generation should come before Image Prefixes');
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

test('settings editor exposes and validates world-profile default start date and time', () => {
  const rendered = nunjucks.configure(path.join(baseDir, 'views'), { autoescape: false }).render('settings.njk', {
    title: 'World Profiles',
    unifiedTonalScaleDefinition: {},
    unifiedTonalScaleError: ''
  });
  const source = fs.readFileSync(path.join(baseDir, 'views', 'settings.njk'), 'utf8');
  const serverSource = fs.readFileSync(path.join(baseDir, 'server.js'), 'utf8');
  const apiSource = fs.readFileSync(path.join(baseDir, 'api.js'), 'utf8');

  assert.match(rendered, /name="defaultStartMonth"/);
  assert.match(rendered, /name="defaultStartDay"/);
  assert.match(rendered, /name="defaultStartTime"/);
  assert.match(source, /function populateDefaultStartDateControls/);
  assert.match(source, /collectDefaultStartDateFromForm\(settingData\.calendarDefinition\)/);
  assert.match(serverSource, /defaults\.startMonth = settingSnapshot\.defaultStartMonth/);
  assert.match(serverSource, /defaults\.startDay = settingSnapshot\.defaultStartDay/);
  assert.match(serverSource, /defaults\.startTime = settingSnapshot\.defaultStartTime/);
  assert.match(apiSource, /defaultStartMonth: toBoundedIntegerString/);
  assert.match(apiSource, /defaultStartDay: toBoundedIntegerString/);
  assert.match(apiSource, /defaultStartTime: toBoundedIntegerString/);
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
  assert.match(source, /settings-calendar-season-vegetation-description/);
  assert.match(source, /settings-calendar-season-interior-description/);
});

test('settings editor exposes all per-world image prompt generation instruction fields', () => {
  const source = fs.readFileSync(path.join(baseDir, 'views', 'settings.njk'), 'utf8');
  assert.match(source, /name="imagePromptInstructionsCharacter"/);
  assert.match(source, /name="imagePromptInstructionsLocation"/);
  assert.match(source, /name="imagePromptInstructionsItem"/);
  assert.match(source, /name="imagePromptInstructionsScenery"/);
  assert.match(source, /imagegen\.image_prompt_instructions/);
});

test('settings API exposes calendar generation and new game prefers saved profile calendars', () => {
  const apiSource = fs.readFileSync(path.join(baseDir, 'api.js'), 'utf8');
  assert.ok(/app\.post\('\/api\/settings\/calendar\/generate'/.test(apiSource), 'API should expose setting calendar generation');
  assert.ok(/normalizeSettingPayload[\s\S]*calendarDefinition/.test(apiSource), 'settings payload normalization should include calendarDefinition');
  assert.ok(/normalizeSettingPayload[\s\S]*imagePromptInstructionsCharacter/.test(apiSource), 'settings payload normalization should include image prompt instructions');

  const resolverStart = apiSource.indexOf('async function resolveCalendarDefinitionForSetting');
  assert.ok(resolverStart !== -1, 'API should define resolveCalendarDefinitionForSetting');
  const resolverSource = apiSource.slice(resolverStart, apiSource.indexOf('// Create a new game', resolverStart));
  const storedCalendarIndex = resolverSource.indexOf('settingSnapshot?.calendarDefinition');
  const aiGenerationIndex = resolverSource.indexOf('generateCalendarDefinitionWithAi({ settingSnapshot })');
  assert.ok(storedCalendarIndex !== -1, 'calendar resolver should inspect settingSnapshot.calendarDefinition');
  assert.ok(aiGenerationIndex !== -1, 'calendar resolver should still support AI generation');
  assert.ok(storedCalendarIndex < aiGenerationIndex, 'saved setting calendars should be preferred before AI generation');
  assert.match(apiSource, /season_image_descriptions/);
  const defaultConfig = yaml.load(fs.readFileSync(path.join(baseDir, 'config.default.yaml'), 'utf8'));
  assert.equal(defaultConfig.prompt_progress?.character_targets?.season_image_descriptions, 5000);
});

test('new game applies the selected calendar date before destructive reset and persists it in form profiles', () => {
  const apiSource = fs.readFileSync(path.join(baseDir, 'api.js'), 'utf8');
  const routeStart = apiSource.indexOf("app.post('/api/new-game'");
  const routeEnd = apiSource.indexOf("app.post('/api/new-game/settings/save'", routeStart);
  assert.ok(routeStart !== -1 && routeEnd > routeStart, 'new-game route should be present');
  const routeSource = apiSource.slice(routeStart, routeEnd);

  const dateValidationIndex = routeSource.indexOf('Globals.getCalendarDayIndex({');
  const destructiveResetIndex = routeSource.indexOf('resetNewGameRuntimeState({');
  assert.ok(dateValidationIndex !== -1, 'new-game route should resolve the selected calendar date');
  assert.ok(destructiveResetIndex !== -1, 'new-game route should reset old runtime state');
  assert.ok(
    dateValidationIndex < destructiveResetIndex,
    'selected calendar date should be validated before old runtime state is cleared'
  );
  assert.match(
    routeSource,
    /Globals\.elapsedTime\s*=\s*\(startingDayIndex \* cycleLengthMinutes\) \+ \(resolvedStartTime \* 60\)/
  );
  assert.match(apiSource, /startMonth:\s*hasStartMonth \? parsedStartMonth : 1/);
  assert.match(apiSource, /startDay:\s*hasStartDay \? parsedStartDay : 1/);
});
