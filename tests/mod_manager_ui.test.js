const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const baseDir = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(baseDir, relativePath), 'utf8');
}

test('config defaults disable self restart while local config enables it', () => {
  assert.match(read('config.default.yaml'), /allowSelfRestart:\s*false/);
  assert.match(read('config.yaml'), /allowSelfRestart:\s*true/);
});

test('top navigation exposes a Mods page', () => {
  const source = read('views/_includes/app-header.njk');
  assert.match(source, /appNavLink\('\/mods', 'mods', 'Mods'/);
});

test('mods manager page renders checkboxes and calls manager APIs', () => {
  const source = read('views/mods.njk');
  assert.match(source, /data-mod-enabled-checkbox/);
  assert.match(source, /fetch\('\/api\/mods\/manager'/);
  assert.match(source, /fetch\('\/api\/mods\/enabled'/);
  assert.match(source, /restartRequired/);
});

test('load game UI includes mod mismatch modal with accept keep and cancel choices', () => {
  const source = read('views/index.njk');
  assert.match(source, /id="loadModMismatchModal"/);
  assert.match(source, /id="loadModMismatchAcceptBtn"/);
  assert.match(source, /id="loadModMismatchKeepBtn"/);
  assert.match(source, /id="loadModMismatchCancelBtn"/);
  assert.match(source, /modMismatchChoice:\s*'keep-current'/);
  assert.match(source, /fetch\('\/api\/mods\/apply-save-config'/);
});

test('global pending-load script checks and consumes pending load intents', () => {
  const head = read('views/_includes/head-common.njk');
  const script = read('public/js/pending-load.js');
  assert.match(head, /\/js\/pending-load\.js/);
  assert.match(script, /fetch\('\/api\/pending-load'/);
  assert.match(script, /fetch\('\/api\/load'/);
  assert.match(script, /fetch\('\/api\/pending-load'/);
});
