const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    loadMergedConfig,
    parseYamlOverrideObject
} = require('../ConfigLoader.js');

function makeTempGameDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-config-'));
}

function writeFile(rootDir, relativePath, content) {
    const targetPath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
}

test('runtime game YAML override merges above config.default, config.yaml, and cli override', () => {
    const rootDir = makeTempGameDir();

    try {
        writeFile(rootDir, 'config.default.yaml', `
feature:
  enabled: false
  nested:
    fromDefault: true
value: default
`);
        writeFile(rootDir, 'config.yaml', `
feature:
  enabled: true
value: config
`);
        writeFile(rootDir, 'tmp.override.yaml', `
value: cli
`);

        const merged = loadMergedConfig(rootDir, path.join(rootDir, 'tmp.override.yaml'), {
            runtimeOverrideYaml: `
feature:
  nested:
    fromGame: true
value: game
`
        });

        assert.equal(merged.feature.enabled, true);
        assert.equal(merged.feature.nested.fromDefault, true);
        assert.equal(merged.feature.nested.fromGame, true);
        assert.equal(merged.value, 'game');
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('parseYamlOverrideObject rejects non-object game override YAML', () => {
    assert.throws(
        () => parseYamlOverrideObject('- item\n', 'Game configuration override YAML'),
        /must contain a YAML object/
    );
});
