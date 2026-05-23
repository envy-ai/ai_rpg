const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const baseDir = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(baseDir, relativePath), 'utf8');
}

function assertContains(source, snippet) {
  assert.ok(source.includes(snippet), `Expected source to contain ${JSON.stringify(snippet)}`);
}

test('api exposes mod manager pending load and save config application endpoints', () => {
  const source = read('api.js');

  assertContains(source, "app.get('/api/mods/manager'");
  assertContains(source, "app.put('/api/mods/enabled'");
  assertContains(source, "app.post('/api/mods/apply-save-config'");
  assertContains(source, "app.get('/api/pending-load'");
  assertContains(source, "app.delete('/api/pending-load'");
  assertContains(source, 'writePendingLoadIntent');
  assertContains(source, 'requestServerRestart');
});

test('load API reports enabled mod mismatches before hydrating saves', () => {
  const source = read('api.js');

  assertContains(source, 'MOD_ENABLEMENT_MISMATCH');
  assertContains(source, 'metadata?.enabledMods');
  assertContains(source, 'diffEnabledMods');
  assertContains(source, "modMismatchChoice === 'keep-current'");
  assertContains(source, 'statusCode = 409');
});

test('server supports guarded self restart and port retry startup', () => {
  const source = read('server.js');

  assertContains(source, 'spawn(process.execPath');
  assertContains(source, 'function requestServerRestart');
  assertContains(source, 'allowSelfRestart');
  assertContains(source, 'function listenWithPortRetry');
  assertContains(source, 'EADDRINUSE');
  assertContains(source, 'selfRestartPortRetrySeconds');
});
