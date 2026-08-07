const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('server termination paths delete router context caches', () => {
    const restartStart = serverSource.indexOf('async function requestServerRestart');
    const restartEnd = serverSource.indexOf('// Configure Nunjucks for views', restartStart);
    const restartSource = serverSource.slice(restartStart, restartEnd);
    assert.ok(restartStart >= 0 && restartEnd > restartStart);
    assert.ok(
        restartSource.indexOf('deleteRouterContextCacheFiles')
            < restartSource.indexOf('const child = spawn'),
        'self-restart must delete caches before spawning the replacement'
    );

    const mainStart = serverSource.indexOf('if (require.main === module)');
    const mainEnd = serverSource.indexOf('function getExperiencePointValues', mainStart);
    const mainSource = serverSource.slice(mainStart, mainEnd);
    assert.match(mainSource, /process\.once\('SIGINT',[\s\S]*terminateProgram/);
    assert.match(mainSource, /process\.once\('SIGTERM',[\s\S]*terminateProgram/);
    assert.match(mainSource, /deleteRouterContextCacheFiles\(\{ configOverride: config \}\)/);
    assert.match(mainSource, /process\.once\('exit',[\s\S]*deleteRouterContextCacheFilesSync/);
    assert.match(mainSource, /startServer\(\)\.catch[\s\S]*reason: 'startup failure'/);
});
