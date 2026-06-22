const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const rootDir = path.join(__dirname, '..');
const defaultConfig = yaml.load(fs.readFileSync(path.join(rootDir, 'config.default.yaml'), 'utf8'));
const serverSource = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');

test('default config sets short string tracker word limit to four', () => {
    assert.equal(defaultConfig.trackers?.short_string_max_words, 4);
});

test('server validates short string tracker word limit as a positive integer', () => {
    assert.match(serverSource, /trackers must be an object when provided/);
    assert.match(serverSource, /trackers\.short_string_max_words must be an integer greater than or equal to 1 when provided/);
});
