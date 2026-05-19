const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

test('location generation spinner uses concise location wording for NPC pass', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const conciseText = 'Generating location ${location.name || location.id}...';
    const oldText = 'Generating NPCs for location ${location.name || location.id}...';

    assert.equal(source.includes(conciseText), true, `server.js should include "${conciseText}"`);
    assert.equal(source.includes(oldText), false, `server.js should not include "${oldText}"`);
});
