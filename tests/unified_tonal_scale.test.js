const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const nunjucks = require('nunjucks');

const SettingInfo = require('../SettingInfo.js');
const {
  buildUnifiedTonalScalePrompt,
  loadUnifiedTonalScaleDefinition,
  normalizeUnifiedTonalScaleSelections,
  resolveTonalScaleLevel
} = require('../UnifiedTonalScale.js');

const baseDir = path.join(__dirname, '..');

test('builds a system-prompt tonal scale block from setting selections', () => {
  const definition = loadUnifiedTonalScaleDefinition({ baseDir });
  const prompt = buildUnifiedTonalScalePrompt({
    definition,
    selections: {
      idealism: { level: 4, comment: 'Villains can be dangerous without making hope pointless.' },
      grit: { level: 2 },
      seriousness: { level: 3 },
      focus: { level: 2 }
    }
  });

  assert.match(prompt, /## Unified Tonal Scale/);
  assert.match(prompt, /### THIS STORY: I4-G2-S3-F2/);
  assert.match(prompt, /Villains can be dangerous without making hope pointless\./);
  assert.match(prompt, /\| \*\*Idealism\*\* \| 4 \(Hopeful\) \|/);
});

test('normalizes and validates setting tonal scale selections', () => {
  assert.deepEqual(
    normalizeUnifiedTonalScaleSelections('{"idealism":{"level":"3.5","comment":"Hold onto hope."}}'),
    {
      idealism: {
        level: 3.5,
        comment: 'Hold onto hope.'
      }
    }
  );

  assert.throws(
    () => normalizeUnifiedTonalScaleSelections({ idealism: { comment: 'No level selected.' } }),
    /comment requires a selected level/
  );
});

test('tonal scale definitions expose half-step selection options', () => {
  const definition = loadUnifiedTonalScaleDefinition({ baseDir });
  const idealismOptions = definition.axes.idealism.selectionOptions;

  assert.ok(Array.isArray(idealismOptions));
  assert.deepEqual(
    idealismOptions.map(option => `${option.level} - ${option.name}`),
    [
      '1 - Grimdark',
      '1.5 - Cynical/Grimdark',
      '2 - Cynical',
      '2.5 - Mixed/Cynical',
      '3 - Mixed',
      '3.5 - Hopeful/Mixed',
      '4 - Hopeful',
      '4.5 - Idealistic/Hopeful',
      '5 - Idealistic'
    ]
  );
});

test('builds prompt rows for half-step tonal selections', () => {
  const definition = loadUnifiedTonalScaleDefinition({ baseDir });
  const prompt = buildUnifiedTonalScalePrompt({
    definition,
    selections: {
      idealism: { level: 3.5, comment: 'Hope wins often, but not cheaply.' },
      grit: { level: 2 },
      seriousness: { level: 3 },
      focus: { level: 2 }
    }
  });

  assert.match(prompt, /### THIS STORY: I3\.5-G2-S3-F2/);
  assert.match(prompt, /\| \*\*Idealism\*\* \| 3\.5 \(Hopeful\/Mixed\) \|/);
  assert.match(prompt, /Between Mixed and Hopeful:/);
  assert.match(prompt, /Hope wins often, but not cheaply\./);
});

test('rejects tonal selections that are not defined levels or half-steps', () => {
  const definition = loadUnifiedTonalScaleDefinition({ baseDir });

  assert.throws(
    () => resolveTonalScaleLevel(definition.axes.idealism, 3.25),
    /not defined and is not a half-step/
  );
});

test('settings template renders half-step tonal dropdown options', () => {
  const definition = loadUnifiedTonalScaleDefinition({ baseDir });
  const env = nunjucks.configure(path.join(baseDir, 'views'), { autoescape: false });
  const rendered = env.render('settings.njk', {
    title: 'World Profiles',
    unifiedTonalScaleDefinition: definition,
    unifiedTonalScaleError: ''
  });

  assert.match(
    rendered,
    /<option value="3\.5">3\.5 - Hopeful\/Mixed<\/option>/
  );
});

test('SettingInfo persists unified tonal scale selections', () => {
  SettingInfo.clear();
  const setting = new SettingInfo({
    name: 'Tonal Test',
    unifiedTonalScale: {
      idealism: { level: 3.5, comment: 'Hope matters.' },
      grit: { level: 2 },
      seriousness: { level: 3 },
      focus: { level: 2 }
    }
  });

  assert.deepEqual(setting.toJSON().unifiedTonalScale, {
    idealism: { level: 3.5, comment: 'Hope matters.' },
    grit: { level: 2 },
    seriousness: { level: 3 },
    focus: { level: 2 }
  });
  SettingInfo.clear();
});

test('base system prompt templates insert tonal guidance before extra config instructions', () => {
  const templateFiles = [
    'prompts/base-context.xml.njk',
    'prompts/generic-prompt-nocontext.xml.njk',
    'prompts/slop-remover.xml.njk',
    'prompts/_includes/slop-remover.njk'
  ];

  for (const relativePath of templateFiles) {
    const contents = fs.readFileSync(path.join(baseDir, relativePath), 'utf8');
    const tonalIndex = contents.indexOf('setting.unifiedTonalScalePrompt');
    const extraIndex = contents.indexOf('config.extra_system_instructions');
    assert.ok(tonalIndex !== -1, `${relativePath} should reference setting.unifiedTonalScalePrompt`);
    assert.ok(extraIndex !== -1, `${relativePath} should reference config.extra_system_instructions`);
    assert.ok(tonalIndex < extraIndex, `${relativePath} should insert tonal guidance before extra instructions`);
  }
});
