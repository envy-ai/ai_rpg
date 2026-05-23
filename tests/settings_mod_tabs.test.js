const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const nunjucks = require('nunjucks');

const baseDir = path.join(__dirname, '..');

function renderSettings(overrides = {}) {
  const env = nunjucks.configure(path.join(baseDir, 'views'), { autoescape: false });
  return env.render('settings.njk', {
    title: 'World Profiles',
    unifiedTonalScaleDefinition: {},
    unifiedTonalScaleError: '',
    attributeOptions: [],
    modSettingFields: [],
    modSettingTabs: [],
    ...overrides
  });
}

test('settings editor renders registered mod setting tabs with their fields', () => {
  const rendered = renderSettings({
    modSettingTabs: [
      {
        id: 'implants',
        label: 'Implants',
        description: 'Configure the implant system.',
        fields: [
          {
            namespace: 'implants',
            key: 'displayLabel',
            label: 'Display Label',
            type: 'string',
            defaultValue: 'implants'
          },
          {
            namespace: 'implants',
            key: 'applyPreset',
            label: 'Apply Preset',
            type: 'select',
            defaultValue: '',
            persist: false,
            action: 'applyPreset',
            options: [
              {
                value: 'implants',
                label: 'Implants',
                settings: {
                  implants: {
                    displayLabel: 'implants',
                    itemLabel: 'Implant',
                    badgeImagePath: 'microchip.svg'
                  }
                },
                confirmMessage: 'Apply the Implants preset?'
              },
              {
                value: 'tattoo',
                label: 'Tattoo',
                settings: {
                  implants: {
                    displayLabel: 'tattoos',
                    itemLabel: 'Tattoo Design',
                    badgeImagePath: 'image.svg'
                  }
                },
                confirmMessage: 'Apply the Tattoo preset?'
              }
            ]
          }
        ]
      },
      {
        id: 'spells',
        label: 'Spells',
        description: 'Configure spell mana costs.',
        fields: [
          {
            namespace: 'spells',
            key: 'manaUsageBaseCosts',
            label: 'Mana Usage Base Costs',
            type: 'object',
            defaultValue: { low: 10, medium: 25, high: 50 }
          }
        ]
      }
    ]
  });

  const promptsIndex = rendered.indexOf('data-editor-tab="prompts"');
  const implantsIndex = rendered.indexOf('data-editor-tab="mod-implants"');
  const spellsIndex = rendered.indexOf('data-editor-tab="mod-spells"');
  const calendarIndex = rendered.indexOf('data-editor-tab="calendar"');

  assert.ok(promptsIndex !== -1, 'Prompt Guidance tab should still render');
  assert.ok(implantsIndex !== -1, 'Implants mod tab should render');
  assert.ok(spellsIndex !== -1, 'Spells mod tab should render');
  assert.ok(promptsIndex < implantsIndex, 'Mod tabs should appear after Prompt Guidance');
  assert.ok(implantsIndex < spellsIndex, 'Mod tabs should preserve registry order');
  assert.ok(spellsIndex < calendarIndex, 'Mod tabs should appear before Calendar');
  assert.match(rendered, /data-editor-panel="mod-implants"/);
  assert.match(rendered, /data-editor-panel="mod-spells"/);
  assert.match(rendered, /data-mod-setting-namespace="implants"/);
  assert.match(rendered, /data-mod-setting-key="displayLabel"/);
  assert.match(rendered, /data-mod-setting-action="applyPreset"/);
  assert.match(rendered, /data-mod-setting-persist="false"/);
  assert.match(rendered, /data-mod-setting-preset-values=/);
  assert.match(rendered, /Tattoo Design/);
  assert.match(rendered, /image\.svg/);
  assert.match(rendered, /data-mod-setting-namespace="spells"/);
  assert.match(rendered, /data-mod-setting-key="manaUsageBaseCosts"/);
});

test('legacy ungrouped mod setting fields still render under Prompt Guidance', () => {
  const rendered = renderSettings({
    modSettingFields: [
      {
        namespace: 'legacy',
        key: 'flag',
        label: 'Legacy Flag',
        type: 'string',
        defaultValue: 'yes'
      }
    ]
  });

  const promptsPanelStart = rendered.indexOf('data-editor-panel="prompts"');
  const calendarPanelStart = rendered.indexOf('data-editor-panel="calendar"');
  const promptsPanel = rendered.slice(promptsPanelStart, calendarPanelStart);

  assert.match(promptsPanel, /<h3>Mod Settings<\/h3>/);
  assert.match(promptsPanel, /data-mod-setting-namespace="legacy"/);
  assert.match(promptsPanel, /data-mod-setting-key="flag"/);
});

test('settings editor resets mod fields to defaults and opens the owning tab for invalid JSON', () => {
  const source = fs.readFileSync(path.join(baseDir, 'views', 'settings.njk'), 'utf8');

  assert.match(source, /function getModSettingFieldDefaultValue/);
  assert.match(source, /field\.dataset\.modSettingDefault/);
  assert.match(source, /field\.closest\('\.editor-tab-panel'\)\?\.dataset\?\.editorPanel/);
  assert.match(source, /setActiveEditorTab\(error\.editorTab \|\| 'prompts'\)/);
});

test('settings editor applies mod presets with confirmation without persisting the action select', () => {
  const source = fs.readFileSync(path.join(baseDir, 'views', 'settings.njk'), 'utf8');

  assert.match(source, /function applyModSettingPreset/);
  assert.match(source, /window\.confirm\(confirmMessage\)/);
  assert.match(source, /findModSettingField\(namespace,\s*key\)/);
  assert.match(source, /selector\.value = ''/);
  assert.ok(source.includes('querySelectorAll(\'[data-mod-setting-action="applyPreset"]\')'));
  assert.match(source, /if \(field\.dataset\.modSettingPersist === 'false'\)/);
});
