const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('NPC detail route preserves mod status sections for character view refreshes', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const route = extractBlock(
        source,
        "app.get('/api/npcs/:id'",
        "// Update an NPC's core data"
    );

    assert.match(route, /serializeNpcForClient\(npc\)/);
    assert.match(route, /status\.modStatusSections\s*=/);
    assert.match(route, /clientProfile\.modStatusSections/);
});
