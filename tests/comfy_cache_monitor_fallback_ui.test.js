const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const chatSource = fs.readFileSync(path.join(root, 'public', 'js', 'chat.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const scssSource = fs.readFileSync(path.join(root, 'public', 'css', 'main.scss'), 'utf8');

test('Cache Monitor fallback is broadcast and handled as a dedicated realtime event', () => {
    assert.match(serverSource, /Globals\.emitToClient\(null, 'comfy_cache_monitor_fallback'/);
    assert.match(chatSource, /case 'comfy_cache_monitor_fallback':[\s\S]*?handleComfyCacheMonitorFallback\(payload\)/);
});

test('fallback warning recommends Cache Monitor and offers browser-local suppression', () => {
    assert.match(chatSource, /airpg:hideComfyCacheMonitorFallbackWarning/);
    assert.match(chatSource, /comfyui-cache-monitor custom nodes/);
    assert.match(chatSource, /comfy-cache-monitor-warning__checkbox/);
    assert.match(chatSource, /window\.localStorage\.setItem\(this\.comfyCacheMonitorWarningStorageKey, 'true'\)/);
    assert.match(scssSource, /\.comfy-cache-monitor-warning\s*\{/);
});
