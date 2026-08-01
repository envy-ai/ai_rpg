const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

function read(relativePath) {
    return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function extractBlock(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `Unable to locate ${startNeedle}`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `Unable to locate ${endNeedle}`);
    return source.slice(start, end);
}

test('play page exposes registered Player edit fields to the client', () => {
    const serverSource = read('server.js');
    const viewSource = read('views/index.njk');

    assert.match(serverSource, /playerEditFields:\s*modExtensionRegistry\.getEntityFields\('player',\s*\{\s*exposeToEditModal:\s*true\s*\}\)/);
    assert.match(viewSource, /window\.AIRPG_CONFIG\.playerEditFields\s*=/);
});

test('NPC edit modal renders and collects registered Player mod fields', () => {
    const viewSource = read('views/index.njk');

    assert.match(viewSource, /id="npcEditModFieldsSection"[^>]*hidden/);
    assert.match(viewSource, /id="npcEditModFieldsList"/);
    assert.match(viewSource, /function getRegisteredPlayerEditFields\(\)/);
    assert.match(viewSource, /function renderNpcEditModFields\(npc = \{\}\)/);
    assert.match(viewSource, /function collectNpcEditModFieldValues\(\)/);

    const openModal = extractBlock(viewSource, 'function showNpcEditModal(npc)', 'function closeNpcEditModal');
    assert.match(openModal, /renderNpcEditModFields\(npc\)/);

    const submit = extractBlock(viewSource, "npcEditForm.addEventListener('submit'", 'const knownSkillSet');
    assert.match(submit, /Object\.assign\(payload, collectNpcEditModFieldValues\(\)\)/);
});

test('NPC update route parses and applies registered Player mod fields', () => {
    const apiSource = read('api.js');
    const route = extractBlock(
        apiSource,
        "app.put('/api/npcs/:id'",
        "app.post('/api/npcs/:id/equipment'"
    );

    assert.match(route, /getRegisteredPlayerPayloadFields\(\{ edit: true \}\)/);
    assert.match(route, /extractRegisteredPlayerPayloadFieldValues\(body, registeredPlayerFields\)/);
    assert.match(route, /applyRegisteredPlayerPayloadFieldValues\(npc, modFieldValues\)/);
    assert.match(route, /res\.status\(400\)\.json\(/);
});

test('NPC client serializer includes stored Player extension fields', () => {
    const serverSource = read('server.js');

    assert.match(serverSource, /Object\.assign\(serialized, npc\.getExtensionFields\(\)\)/);
});
