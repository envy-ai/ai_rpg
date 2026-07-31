const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    loadStartupGameFromPath,
    resolveCliStartupGamePath,
    resolveStartupGameLoadTarget
} = require('../StartupGameLoad.js');

const projectRoot = path.join(__dirname, '..');
const testArtifactRoot = path.join(projectRoot, 'tmp');

function makeTemporaryDirectory(prefix) {
    fs.mkdirSync(testArtifactRoot, { recursive: true });
    return fs.mkdtempSync(path.join(testArtifactRoot, prefix));
}

test('resolveCliStartupGamePath accepts separated and equals forms', () => {
    assert.equal(
        resolveCliStartupGamePath(['node', 'server.js', '--load-game', 'fixtures/save-one'], {
            cwd: projectRoot
        }),
        path.join(projectRoot, 'fixtures', 'save-one')
    );

    const absolutePath = path.join(projectRoot, 'tmp', 'absolute-save');
    assert.equal(
        resolveCliStartupGamePath(['node', 'server.js', `--load-game=${absolutePath}`]),
        absolutePath
    );
    assert.equal(resolveCliStartupGamePath(['node', 'server.js', '--port', '4173']), null);
});

test('resolveCliStartupGamePath rejects missing and duplicate paths', () => {
    assert.throws(
        () => resolveCliStartupGamePath(['node', 'server.js', '--load-game']),
        /requires a save directory path argument/i
    );
    assert.throws(
        () => resolveCliStartupGamePath(['node', 'server.js', '--load-game', '--port', '4173']),
        /requires a save directory path argument/i
    );
    assert.throws(
        () => resolveCliStartupGamePath([
            'node',
            'server.js',
            '--load-game=first',
            '--load-game=second'
        ]),
        /may only be provided once/i
    );
});

test('resolveStartupGameLoadTarget requires an existing save directory', () => {
    const temporaryDirectory = makeTemporaryDirectory('startup-game-target-');
    const saveDirectory = path.join(temporaryDirectory, 'external-save');
    const regularFile = path.join(temporaryDirectory, 'not-a-save');
    fs.mkdirSync(saveDirectory);
    fs.writeFileSync(regularFile, 'not a directory', 'utf8');

    try {
        assert.deepEqual(resolveStartupGameLoadTarget(saveDirectory), {
            saveDir: saveDirectory,
            saveName: 'external-save',
            saveRoot: temporaryDirectory
        });
        assert.throws(
            () => resolveStartupGameLoadTarget(path.join(temporaryDirectory, 'missing-save')),
            error => error?.code === 'STARTUP_SAVE_NOT_FOUND'
        );
        assert.throws(
            () => resolveStartupGameLoadTarget(regularFile),
            error => error?.code === 'STARTUP_SAVE_NOT_DIRECTORY'
        );
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

test('loadStartupGameFromPath delegates to the normal game-load helper', async () => {
    const temporaryDirectory = makeTemporaryDirectory('startup-game-delegate-');
    const saveDirectory = path.join(temporaryDirectory, 'browser-fixture');
    fs.mkdirSync(saveDirectory);
    const calls = [];
    const logLines = [];

    try {
        const loaded = await loadStartupGameFromPath({
            saveDirectory,
            logger: {
                log(message) {
                    logLines.push(message);
                }
            },
            async performGameLoad(saveName, options) {
                calls.push({ saveName, options });
                return { saveName, loadedData: { totalPlayers: 1 } };
            }
        });

        assert.deepEqual(calls, [{
            saveName: 'browser-fixture',
            options: { saveRoot: temporaryDirectory }
        }]);
        assert.equal(loaded.saveDir, saveDirectory);
        assert.equal(loaded.result.loadedData.totalPlayers, 1);
        assert.match(logLines[0], /Loading startup game from/i);
        assert.match(logLines[1], /Startup game loaded/i);
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

test('server loads an explicit startup game before listening and skips the dummy player', () => {
    const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
    const startupLoadIndex = serverSource.indexOf('await loadStartupGameFromPath({');
    const listenIndex = serverSource.indexOf('await listenWithPortRetry(server');

    assert.notEqual(startupLoadIndex, -1, 'server should invoke startup game loading');
    assert.notEqual(listenIndex, -1, 'server should invoke listenWithPortRetry');
    assert.ok(startupLoadIndex < listenIndex, 'startup game loading must finish before the HTTP server listens');
    assert.match(
        serverSource,
        /if \(cliStartupGamePath\) \{[\s\S]*?Skipping default player creation[\s\S]*?\} else \{\s*createDefaultPlayer\(\);/m
    );
});
