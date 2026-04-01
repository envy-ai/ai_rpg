const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ModLoader = require('../ModLoader.js');
const {
    clearFrozenEnabledModManifests,
    freezeEnabledModManifests
} = require('../ModDiscovery.js');
const {
    getOverlayModDirectories,
    loadMergedDefinitionFile,
    validateDefinitionOverlays
} = require('../DefinitionLoader.js');

function makeTempGameDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-defs-'));
}

function writeFile(rootDir, relativePath, content) {
    const targetPath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
}

test('definition overlays deep-merge maps, append lists, and apply mods in alphabetical order', () => {
    const rootDir = makeTempGameDir();

    try {
        writeFile(rootDir, 'defs/example.yaml', `
outer:
  alpha: base
  list:
    - base
  nested:
    count: 1
flag: true
`);
        writeFile(rootDir, 'mods/alpha/defs/example.yaml', `
outer:
  list:
    - alpha
  nested:
    alphaOnly: yes
flag: false
`);
        writeFile(rootDir, 'mods/bravo/defs/example.yaml', `
outer:
  alpha: bravo
  list:
    - bravo
`);

        assert.deepEqual(getOverlayModDirectories(rootDir), ['alpha', 'bravo']);

        const { value } = loadMergedDefinitionFile({
            baseDir: rootDir,
            filename: 'example.yaml'
        });

        assert.deepEqual(JSON.parse(JSON.stringify(value)), {
            outer: {
                alpha: 'bravo',
                list: ['base', 'alpha', 'bravo'],
                nested: {
                    count: 1,
                    alphaOnly: 'yes'
                }
            },
            flag: false
        });
    } finally {
        clearFrozenEnabledModManifests(rootDir);
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('validateDefinitionOverlays rejects unknown defs overlay filenames', () => {
    const rootDir = makeTempGameDir();

    try {
        writeFile(rootDir, 'defs/known.yaml', 'value: 1\n');
        writeFile(rootDir, 'mods/bad/defs/unknown.yaml', 'value: 2\n');

        assert.throws(
            () => validateDefinitionOverlays({ baseDir: rootDir }),
            /unknown defs overlay "unknown\.yaml"/
        );
    } finally {
        clearFrozenEnabledModManifests(rootDir);
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('ModLoader treats defs-only directories as valid mods', () => {
    const rootDir = makeTempGameDir();

    try {
        writeFile(rootDir, 'mods/defs_only/defs/example.yaml', 'value: 1\n');

        const loader = new ModLoader(rootDir);
        assert.deepEqual(loader.getModDirectories(), ['defs_only']);

        const results = loader.loadMods({});
        assert.deepEqual(results.loaded, ['defs_only']);
        assert.equal(results.failed.length, 0);
        assert.equal(results.total, 1);
    } finally {
        clearFrozenEnabledModManifests(rootDir);
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('mod discovery assumes enabled when omitted and skips enabled=false mods', () => {
    const rootDir = makeTempGameDir();

    try {
        writeFile(rootDir, 'defs/example.yaml', 'value: [base]\n');
        writeFile(rootDir, 'mods/enabled_by_default/defs/example.yaml', 'value: [default]\n');
        writeFile(rootDir, 'mods/disabled/defs/example.yaml', 'value: [disabled]\n');
        writeFile(rootDir, 'mods/disabled/config.json', JSON.stringify({ enabled: false }, null, 2));

        assert.deepEqual(getOverlayModDirectories(rootDir), ['enabled_by_default']);

        const { value } = loadMergedDefinitionFile({
            baseDir: rootDir,
            filename: 'example.yaml'
        });

        assert.deepEqual(JSON.parse(JSON.stringify(value)), {
            value: ['base', 'default']
        });

        const loader = new ModLoader(rootDir);
        assert.deepEqual(loader.getModDirectories(), ['enabled_by_default']);
    } finally {
        clearFrozenEnabledModManifests(rootDir);
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('frozen enabled mod set does not hot-toggle until the process restarts', () => {
    const rootDir = makeTempGameDir();

    try {
        writeFile(rootDir, 'defs/example.yaml', 'value: [base]\n');
        writeFile(rootDir, 'mods/frozen/defs/example.yaml', 'value: [overlay]\n');

        assert.deepEqual(freezeEnabledModManifests(rootDir).map(mod => mod.name), ['frozen']);

        writeFile(rootDir, 'mods/frozen/config.json', JSON.stringify({ enabled: false }, null, 2));

        assert.deepEqual(getOverlayModDirectories(rootDir), ['frozen']);

        clearFrozenEnabledModManifests(rootDir);
        assert.deepEqual(getOverlayModDirectories(rootDir), []);
    } finally {
        clearFrozenEnabledModManifests(rootDir);
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('merged YAML mod enabled flags override per-mod config.json enabled flags', () => {
    const rootDir = makeTempGameDir();

    try {
        writeFile(rootDir, 'config.yaml', `
mods:
  yaml_disables:
    enabled: false
  yaml_enables:
    enabled: true
`);
        writeFile(rootDir, 'defs/example.yaml', 'value: [base]\n');
        writeFile(rootDir, 'mods/yaml_disables/defs/example.yaml', 'value: [yaml_disables]\n');
        writeFile(rootDir, 'mods/yaml_disables/config.json', JSON.stringify({ enabled: true }, null, 2));
        writeFile(rootDir, 'mods/yaml_enables/defs/example.yaml', 'value: [yaml_enables]\n');
        writeFile(rootDir, 'mods/yaml_enables/config.json', JSON.stringify({ enabled: false }, null, 2));

        assert.deepEqual(getOverlayModDirectories(rootDir), ['yaml_enables']);

        const { value } = loadMergedDefinitionFile({
            baseDir: rootDir,
            filename: 'example.yaml'
        });

        assert.deepEqual(JSON.parse(JSON.stringify(value)), {
            value: ['base', 'yaml_enables']
        });

        const loader = new ModLoader(rootDir);
        assert.deepEqual(loader.getModDirectories(), ['yaml_enables']);
    } finally {
        clearFrozenEnabledModManifests(rootDir);
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});
