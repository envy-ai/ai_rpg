const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const Globals = require('../Globals.js');
const Player = require('../Player.js');

function writeFile(rootDir, relativePath, content) {
    const targetPath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
}

function makeTempDispositionDefs() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-dispositions-'));
    writeFile(rootDir, 'defs/dispositions.yaml', `
range:
  min: -200
  max: 200
  typical_step: 4
  typical_big_step: 50
dispositions:
  trust:
    description: Trust toward the player.
    icon: T
    move_up:
      - kept a promise
    move_down:
      - lied
    move_way_down:
      - betrayed trust
    min_thresholds:
      0: neutral
      20: trusting
`);
    return rootDir;
}

function withDispositionConfig(config, run) {
    const rootDir = makeTempDispositionDefs();
    const previousBaseDir = Globals.baseDir;
    const previousConfig = Globals.config;

    Player.clearRuntimeRegistries();
    Globals.baseDir = rootDir;
    Globals.config = {
        baseHealthPerLevel: 10,
        ...(config && typeof config === 'object' ? config : {})
    };
    Player.reloadDefinitionCaches({ refreshInstances: false });

    try {
        run();
    } finally {
        Player.clearRuntimeRegistries();
        Globals.baseDir = previousBaseDir;
        Globals.config = previousConfig;
        Player.reloadDefinitionCaches({ refreshInstances: false });
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
}

test('disposition first impression multiplier is loaded from merged config', () => {
    withDispositionConfig({
        dispositions: {
            first_impression_multiplier: 7
        }
    }, () => {
        assert.equal(Player.getDispositionDefinitions().firstImpressionMultiplier, 7);
    });
});

test('default config owns disposition first impression multiplier', () => {
    const defaultConfig = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'config.default.yaml'), 'utf8'));
    const dispositionDefs = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'defs', 'dispositions.yaml'), 'utf8'));

    assert.equal(defaultConfig.dispositions.first_impression_multiplier, 3);
    assert.equal(Object.hasOwn(dispositionDefs, 'first_impression_multiplier'), false);
});

test('disposition first impression multiplier rejects invalid config values', () => {
    withDispositionConfig({
        dispositions: {
            first_impression_multiplier: 'large'
        }
    }, () => {
        assert.throws(
            () => Player.getDispositionDefinitions(),
            /dispositions\.first_impression_multiplier must be a finite number/
        );
    });
});
