const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');
const configDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'config.md'), 'utf8');
const apiChatDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'api', 'chat.md'), 'utf8');
const serverDocs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'server_llm_notes.md'), 'utf8');

function getEnsureRandomEventSeedsSource() {
    const start = apiSource.indexOf('async function ensureRandomEventSeedsForArea');
    assert.notEqual(start, -1, 'ensureRandomEventSeedsForArea should exist.');
    const end = apiSource.indexOf('Globals.triggerRandomEvent', start);
    assert.notEqual(end, -1, 'ensureRandomEventSeedsForArea end marker should exist.');
    return apiSource.slice(start, end);
}

test('disabled random events skip seed-pool generation before checking existing seeds', () => {
    const ensureSource = getEnsureRandomEventSeedsSource();
    const disabledGateIndex = ensureSource.indexOf('frequencyConfig.enabled === false');
    const locationSeedIndex = ensureSource.indexOf('const locationSeedList = location.randomEvents');

    assert.notEqual(disabledGateIndex, -1, 'seed generation should check random_event_frequency.enabled.');
    assert.notEqual(locationSeedIndex, -1, 'seed generation should still inspect location seeds when enabled.');
    assert.ok(
        disabledGateIndex < locationSeedIndex,
        'disabled random events should return before inspecting or generating seed pools.'
    );
    assert.match(ensureSource, /Random event seed generation skipped: random_event_frequency\.enabled is false\./);
});

test('random-event docs describe disabled seed-pool behavior', () => {
    assert.match(configDocs, /`enabled: false` disables random event rolls and seed-pool generation/);
    assert.match(configDocs, /Missing location and region seed pools are generated again on the next eligible turn after random events are re-enabled/);
    assert.match(apiChatDocs, /Random-event seed pools are not generated while `random_event_frequency\.enabled` is `false`/);
    assert.match(serverDocs, /Random-event seed pools are not generated while `random_event_frequency\.enabled` is `false`/);
});
