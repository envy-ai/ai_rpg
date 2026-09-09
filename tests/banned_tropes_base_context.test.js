const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadBannedTropes } = require('../BannedTropes.js');
const {
    buildBaseRenderContext,
    createPromptEnv,
    loadBuildBasePromptContext
} = require('./helpers/baseContextFixtures.js');

function makeDefinitionRoot(yaml) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-banned-tropes-'));
    fs.mkdirSync(path.join(rootDir, 'defs'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'defs', 'banned_tropes.yaml'), yaml, 'utf8');
    return rootDir;
}

test('banned tropes load from defs/banned_tropes.yaml', () => {
    const rootDir = makeDefinitionRoot(`
banned_tropes:
  - Debt ledgers
  - Cryptic guardians
`);

    try {
        assert.deepEqual(loadBannedTropes({ baseDir: rootDir }), [
            'Debt ledgers',
            'Cryptic guardians'
        ]);
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('banned trope definitions reject invalid entries', () => {
    const rootDir = makeDefinitionRoot(`
banned_tropes:
  - valid
  - "   "
`);

    try {
        assert.throws(
            () => loadBannedTropes({ baseDir: rootDir }),
            /entry at index 1 must not be empty/
        );
    } finally {
        fs.rmSync(rootDir, { recursive: true, force: true });
    }
});

test('base prompt context exposes and renders the loaded banned tropes', () => {
    const bannedTropes = ['Debt ledgers', 'Cryptic guardians'];
    const buildBasePromptContext = loadBuildBasePromptContext({ bannedTropes });
    const baseContext = buildBasePromptContext();

    assert.deepEqual(Array.from(baseContext.bannedTropes), bannedTropes);

    const rendered = createPromptEnv().render('base-context.xml.njk', buildBaseRenderContext({
        allNpcs: true,
        trackers: true,
        overrides: {
            bannedTropes,
            partyMemberIds: []
        }
    }));
    assert.match(rendered, /<bannedTropes>/);
    assert.match(rendered, /- Debt ledgers/);
    assert.match(rendered, /- Cryptic guardians/);
});
