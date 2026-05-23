const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildModManagerState,
  diffEnabledMods,
  normalizeEnabledModNames,
  readPendingLoadIntent,
  updateConfigYamlModEnablement,
  writePendingLoadIntent
} = require('../ModManager.js');

function makeTempProject() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-mod-manager-'));
  fs.writeFileSync(path.join(baseDir, 'config.default.yaml'), 'server:\n  port: 7777\n', 'utf8');
  fs.writeFileSync(path.join(baseDir, 'config.yaml'), 'mods:\n  alpha:\n    enabled: true\n  beta:\n    enabled: false\n', 'utf8');
  fs.mkdirSync(path.join(baseDir, 'mods', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'mods', 'alpha', 'mod.js'), 'module.exports = { register() {} };\n', 'utf8');
  fs.mkdirSync(path.join(baseDir, 'mods', 'beta', 'defs'), { recursive: true });
  fs.mkdirSync(path.join(baseDir, 'mods', 'gamma'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'mods', 'gamma', 'mod.js'), 'module.exports = { register() {} };\n', 'utf8');
  return baseDir;
}

test('normalizeEnabledModNames returns sorted unique valid mod names', () => {
  assert.deepEqual(
    normalizeEnabledModNames([' beta ', 'alpha', '', 'alpha', null, 'gamma']),
    ['alpha', 'beta', 'gamma']
  );
});

test('diffEnabledMods reports save-required and extra active mods', () => {
  const diff = diffEnabledMods({
    activeEnabledMods: ['alpha', 'extra'],
    savedEnabledMods: ['alpha', 'beta']
  });

  assert.equal(diff.hasMismatch, true);
  assert.deepEqual(diff.missingFromActive, ['beta']);
  assert.deepEqual(diff.extraActive, ['extra']);
});

test('buildModManagerState lists all valid mods with active and configured flags', () => {
  const baseDir = makeTempProject();
  const state = buildModManagerState(baseDir, {
    runtimeConfig: {
      mods: {
        alpha: { enabled: true },
        beta: { enabled: false }
      }
    },
    activeEnabledMods: ['alpha', 'gamma']
  });

  assert.deepEqual(state.mods.map(mod => mod.name), ['alpha', 'beta', 'gamma']);
  assert.equal(state.mods.find(mod => mod.name === 'alpha').configuredEnabled, true);
  assert.equal(state.mods.find(mod => mod.name === 'alpha').activeEnabled, true);
  assert.equal(state.mods.find(mod => mod.name === 'beta').configuredEnabled, false);
  assert.equal(state.mods.find(mod => mod.name === 'beta').activeEnabled, false);
  assert.equal(state.mods.find(mod => mod.name === 'gamma').configuredEnabled, true);
  assert.equal(state.mods.find(mod => mod.name === 'gamma').activeEnabled, true);
  assert.deepEqual(state.activeEnabledMods, ['alpha', 'gamma']);
  assert.deepEqual(state.configuredEnabledMods, ['alpha', 'gamma']);
});

test('updateConfigYamlModEnablement writes explicit enabled flags for every discovered mod', () => {
  const baseDir = makeTempProject();
  const result = updateConfigYamlModEnablement(baseDir, ['beta']);
  const written = fs.readFileSync(path.join(baseDir, 'config.yaml'), 'utf8');

  assert.deepEqual(result.enabledMods, ['beta']);
  assert.match(written, /alpha:\n\s+enabled: false/);
  assert.match(written, /beta:\n\s+enabled: true/);
  assert.match(written, /gamma:\n\s+enabled: false/);
});

test('pending load intent is persisted under tmp and round-trips normalized values', () => {
  const baseDir = makeTempProject();
  const written = writePendingLoadIntent(baseDir, {
    saveName: '2026-05-23_Save',
    saveType: 'autosaves',
    reason: 'mod-config-change'
  });
  const readBack = readPendingLoadIntent(baseDir);

  assert.equal(written.saveName, '2026-05-23_Save');
  assert.equal(written.saveType, 'autosaves');
  assert.equal(readBack.saveName, '2026-05-23_Save');
  assert.equal(readBack.saveType, 'autosaves');
  assert.equal(readBack.reason, 'mod-config-change');
  assert.match(readBack.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});
