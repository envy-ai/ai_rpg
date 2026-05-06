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

test('NPC teleport route removes current party members before moving them', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const route = extractBlock(source, "app.post('/api/npcs/:id/teleport'", '// Delete an NPC entirely');

    const partyReadIndex = route.indexOf('currentPlayer.getPartyMembers()');
    const removePartyIndex = route.indexOf('currentPlayer.removePartyMember(npcId)');
    const originRecomputeIndex = route.indexOf("const originLocationId = typeof npc.currentLocation === 'string'");
    const originRemoveIndex = route.indexOf('originLocation.removeNpcId(npcId)');

    assert.ok(partyReadIndex !== -1, 'teleport route should inspect the current player party');
    assert.ok(removePartyIndex !== -1, 'teleport route should remove party NPCs from the party');
    assert.ok(originRecomputeIndex !== -1, 'teleport route should recompute origin after party removal');
    assert.ok(originRemoveIndex !== -1, 'teleport route should remove the NPC from their origin location');
    assert.ok(removePartyIndex < originRecomputeIndex, 'party removal must happen before origin recomputation');
    assert.ok(originRecomputeIndex < originRemoveIndex, 'origin recomputation must happen before origin removal');
    assert.match(route, /removedFromParty/);
});

test('NPC teleport client reloads location display for NPC teleports', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views/index.njk'), 'utf8');
    const helper = extractBlock(source, 'async function teleportNpcToLocation', 'async function showTeleportLocationModal');

    assert.match(helper, /const isTeleportedNpc = Boolean\(updatedNpc && updatedNpc\.isNPC\);/);
    assert.match(helper, /const shouldReload = isTeleportedNpc \|\|/);

    const shouldReloadIndex = helper.indexOf('const shouldReload = isTeleportedNpc ||');
    const loadIndex = helper.indexOf('await window.loadCurrentLocation();', shouldReloadIndex);
    const partyRefreshIndex = helper.indexOf('await window.refreshParty?.();', loadIndex);

    assert.ok(loadIndex !== -1, 'NPC teleport should reload the current location');
    assert.ok(partyRefreshIndex !== -1, 'NPC teleport should refresh party state after the reload path');
});
