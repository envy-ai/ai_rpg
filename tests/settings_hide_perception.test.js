const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const nunjucks = require('nunjucks');

const SettingInfo = require('../SettingInfo.js');

const baseDir = path.join(__dirname, '..');

function renderSettings(overrides = {}) {
  const env = nunjucks.configure(path.join(baseDir, 'views'), { autoescape: false });
  return env.render('settings.njk', {
    title: 'World Profiles',
    unifiedTonalScaleDefinition: {},
    unifiedTonalScaleError: '',
    attributeOptions: [
      { name: 'dexterity', label: 'Dexterity', abbreviation: 'DEX' },
      { name: 'wisdom', label: 'Wisdom', abbreviation: 'WIS' }
    ],
    ...overrides
  });
}

test('SettingInfo persists hiding and perception check selections', () => {
  SettingInfo.clear();
  const setting = new SettingInfo({
    name: 'Hidden Things Test',
    defaultExistingSkills: ['Stealth', 'Notice'],
    hidingAttribute: 'dexterity',
    hidingSkill: 'Stealth',
    perceptionAttribute: 'wisdom',
    perceptionSkill: ''
  });

  const serialized = setting.toJSON();
  assert.equal(serialized.hidingAttribute, 'dexterity');
  assert.equal(serialized.hidingSkill, 'Stealth');
  assert.equal(serialized.perceptionAttribute, 'wisdom');
  assert.equal(serialized.perceptionSkill, '');

  const loaded = SettingInfo.fromJSON(serialized);
  assert.equal(loaded.hidingAttribute, 'dexterity');
  assert.equal(loaded.hidingSkill, 'Stealth');
  assert.equal(loaded.perceptionAttribute, 'wisdom');
  assert.equal(loaded.perceptionSkill, '');

  SettingInfo.clear();
});

test('settings editor renders attribute-backed hide and perception selects', () => {
  const rendered = renderSettings();

  assert.match(rendered, /id="hidingAttribute"/);
  assert.match(rendered, /name="hidingAttribute"/);
  assert.match(rendered, /id="hidingSkill"/);
  assert.match(rendered, /name="hidingSkill"/);
  assert.match(rendered, /id="perceptionAttribute"/);
  assert.match(rendered, /name="perceptionAttribute"/);
  assert.match(rendered, /id="perceptionSkill"/);
  assert.match(rendered, /name="perceptionSkill"/);
  assert.match(rendered, /<option value="dexterity">Dexterity<\/option>/);
  assert.match(rendered, /<option value="wisdom">Wisdom<\/option>/);
});

test('settings editor repopulates hide and perception skill selects from default skills textarea', () => {
  const source = fs.readFileSync(path.join(baseDir, 'views', 'settings.njk'), 'utf8');

  assert.match(source, /function refreshHidePerceptionSkillOptions/);
  assert.match(source, /document\.getElementById\('defaultExistingSkills'\)/);
  assert.match(source, /hidingSkill/);
  assert.match(source, /perceptionSkill/);
  assert.match(source, /settingData\.hidingAttribute/);
  assert.match(source, /settingData\.perceptionAttribute/);
});

test('setting autofill prompt includes hide and perception check fields', () => {
  const env = nunjucks.configure(path.join(baseDir, 'prompts'), { autoescape: false });
  const rendered = env.render('fill-setting-form.xml.njk', {
    setting: {
      name: 'Prompt Test',
      description: '',
      theme: '',
      genre: '',
      startingLocationType: '',
      magicLevel: '',
      techLevel: '',
      tone: '',
      difficulty: '',
      currencyName: '',
      currencyNamePlural: '',
      currencyValueNotes: '',
      writingStyleNotes: '',
      baseContextPreamble: '',
      characterGenInstructions: '',
      playerStartingLevel: '',
      defaultPlayerName: '',
      defaultPlayerDescription: '',
      defaultStartingLocation: '',
      defaultStartingCurrency: '',
      defaultExistingSkills: ['Stealth', 'Notice'],
      hidingAttribute: '',
      hidingSkill: '',
      perceptionAttribute: '',
      perceptionSkill: '',
      availableClasses: [],
      availableRaces: [],
      customSlopWords: []
    },
    additionalInstructions: '',
    hasImage: false
  });

  assert.match(rendered, /<hidingAttribute><\/hidingAttribute>/);
  assert.match(rendered, /<hidingSkill><\/hidingSkill>/);
  assert.match(rendered, /<perceptionAttribute><\/perceptionAttribute>/);
  assert.match(rendered, /<perceptionSkill><\/perceptionSkill>/);
  assert.match(rendered, /available setting fields[\s\S]*hidingAttribute[\s\S]*perceptionAttribute/);
});

test('settings API normalizes/parses hide and perception fields and backfills them on game load', () => {
  const apiSource = fs.readFileSync(path.join(baseDir, 'api.js'), 'utf8');

  assert.match(apiSource, /hidingAttribute:\s*toStringValue\(raw\.hidingAttribute\)/);
  assert.match(apiSource, /hidingSkill:\s*toStringValue\(raw\.hidingSkill\)/);
  assert.match(apiSource, /perceptionAttribute:\s*toStringValue\(raw\.perceptionAttribute\)/);
  assert.match(apiSource, /perceptionSkill:\s*toStringValue\(raw\.perceptionSkill\)/);
  assert.match(apiSource, /hidingAttribute:\s*getText\('hidingAttribute'\)/);
  assert.match(apiSource, /perceptionAttribute:\s*getText\('perceptionAttribute'\)/);
  assert.match(apiSource, /setting_hide_perception/);
  assert.match(apiSource, /ensureCurrentSettingHidePerceptionSelections/);
  assert.match(apiSource, /LLMClient\.logPrompt\([\s\S]*setting_hide_perception/);
  assert.match(apiSource, /function persistLoadedGameStateAfterSettingBackfill/);
  assert.match(apiSource, /const serializedBackfill = Utils\.serializeGameState\(/);
  assert.match(apiSource, /Utils\.writeSerializedGameState\(saveDir,\s*serializedBackfill\)/);
});

test('base context exposes hide and perception selections to prompts', () => {
  const templateFiles = [
    'prompts/base-context.xml.njk',
    'prompts/_includes/setting-info.njk'
  ];

  for (const relativePath of templateFiles) {
    const source = fs.readFileSync(path.join(baseDir, relativePath), 'utf8');
    assert.match(source, /<hidingAttribute>{{ setting\.hidingAttribute \| default\('', true\) }}<\/hidingAttribute>/, `${relativePath} should include hidingAttribute`);
    assert.match(source, /<hidingSkill>{{ setting\.hidingSkill \| default\('', true\) }}<\/hidingSkill>/, `${relativePath} should include hidingSkill`);
    assert.match(source, /<perceptionAttribute>{{ setting\.perceptionAttribute \| default\('', true\) }}<\/perceptionAttribute>/, `${relativePath} should include perceptionAttribute`);
    assert.match(source, /<perceptionSkill>{{ setting\.perceptionSkill \| default\('', true\) }}<\/perceptionSkill>/, `${relativePath} should include perceptionSkill`);
  }
});
