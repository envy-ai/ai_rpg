const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

function getSourceSlice(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    const end = source.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    assert.notEqual(end, -1, `Unable to locate end marker ${endNeedle}`);
    return source.slice(start, end);
}

test('base-context important-memory chooser skips dead actors', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const registrationSource = getSourceSlice(
        source,
        'const registerActor = (actor, groupLabel) => {',
        '\n    if (Array.isArray(baseContext.npcs))'
    );

    assert.match(registrationSource, /actor\.isDead\s*===\s*true/);
    assert.match(registrationSource, /actor\.selectedImportantMemories\s*=\s*createSelectedEntries\(selectedIndices,\s*important\);/);
    assert.ok(
        registrationSource.indexOf('actor.isDead === true')
            < registrationSource.indexOf('const actorId ='),
        'Expected dead actors to be handled before they are registered for chooser scheduling'
    );
});
