const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const defaultConfigSource = fs.readFileSync(path.join(__dirname, '..', 'config.default.yaml'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('default config defines active mystery thread capacity', () => {
    assert.match(defaultConfigSource, /mystery_threads:\s*\n\s+max_active:\s*3\b/);
});

test('server validates mystery_threads.max_active as a nonnegative integer', () => {
    assert.match(serverSource, /mystery_threads/);
    assert.match(serverSource, /max_active/);
    assert.match(serverSource, /integer greater than or equal to 0/);
});
