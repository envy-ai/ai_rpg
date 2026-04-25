const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const baseContextSlice = serverSource.slice(
    serverSource.indexOf('const buildSceneSummarySegments'),
    serverSource.indexOf('const buildHistoryLines')
);
const pushChatEntrySlice = serverSource.slice(
    serverSource.indexOf('function pushChatEntry'),
    serverSource.indexOf('function storeAndBroadcastChatEntry')
);

test('base-context scene blocks and full entries use in-world history time labels', () => {
    assert.match(baseContextSlice, /formatSceneStartWorldTimeLabel\(sceneStartEntry\)/);
    assert.match(baseContextSlice, /formatHistoryEntrySpeakerPrefix\(entry,\s*\{\s*roleLabel,\s*roleRaw\s*\}\)/s);
    assert.match(pushChatEntrySlice, /normalized\.metadata\s*=\s*\{\s*\.\.\.normalized\.metadata,\s*worldTime/s);
});
