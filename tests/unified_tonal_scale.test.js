const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SettingInfo = require('../SettingInfo.js');
const {
  buildUnifiedTonalScalePrompt,
  loadUnifiedTonalScaleDefinition,
  normalizeUnifiedTonalScaleSelections
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
    normalizeUnifiedTonalScaleSelections('{"idealism":{"level":"4","comment":"Hold onto hope."}}'),
    {
      idealism: {
        level: 4,
        comment: 'Hold onto hope.'
      }
    }
  );

  assert.throws(
    () => normalizeUnifiedTonalScaleSelections({ idealism: { comment: 'No level selected.' } }),
    /comment requires a selected level/
  );
});

test('SettingInfo persists unified tonal scale selections', () => {
  SettingInfo.clear();
  const setting = new SettingInfo({
    name: 'Tonal Test',
    unifiedTonalScale: {
      idealism: { level: 4, comment: 'Hope matters.' },
      grit: { level: 2 },
      seriousness: { level: 3 },
      focus: { level: 2 }
    }
  });

  assert.deepEqual(setting.toJSON().unifiedTonalScale, {
    idealism: { level: 4, comment: 'Hope matters.' },
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
