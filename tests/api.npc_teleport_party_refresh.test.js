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
    const originRecomputeIndex = route.indexOf("const originLocationId = typeof npc.currentLocation === 'string'", removePartyIndex);
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

test('character menu teleport sends story-tool flag through the teleport helper', () => {
    const source = fs.readFileSync(path.join(rootDir, 'views', 'index.njk'), 'utf8');
    const helper = extractBlock(source, 'async function teleportNpcToLocation', 'async function showTeleportLocationModal');
    const modal = extractBlock(source, 'async function showTeleportLocationModal', 'function registerThingContextMenu');

    assert.match(helper, /storyToolTeleport = false/);
    assert.match(helper, /storyToolTeleport: storyToolTeleport === true/);
    assert.match(modal, /teleportNpcToLocation\(resolvedNpc,\s*entry\.id,\s*\{[\s\S]*?storyToolTeleport:\s*true/);
});

test('player menu teleport route returns after setting location only when story-tool requested', () => {
    const source = fs.readFileSync(path.join(rootDir, 'api.js'), 'utf8');
    const route = extractBlock(source, "app.post('/api/npcs/:id/teleport'", '// Delete an NPC entirely');
    const storyToolMatch = route.match(/if \(!isNpc && storyToolTeleport\) \{[\s\S]*?npc\.setLocation\(destinationLocation\.id\);[\s\S]*?res\.json\(responsePayload\);[\s\S]*?return;[\s\S]*?\n\s*\}/);

    assert.ok(storyToolMatch, 'player teleports should use a direct story-tool fast path');
    const storyToolBlock = storyToolMatch[0];

    assert.match(route, /const storyToolTeleport = body\.storyToolTeleport === true;/);
    assert.match(storyToolBlock, /npc\.setLocation\(destinationLocation\.id\);/);
    assert.match(storyToolBlock, /res\.json\(responsePayload\);[\s\S]*?return;/);
    assert.doesNotMatch(storyToolBlock, /runWhileYouWereAwayPrompt/);
    assert.doesNotMatch(storyToolBlock, /runAutomaticHiddenNpcChecksForCurrentPlayer/);
    assert.doesNotMatch(storyToolBlock, /Player\.recordNpcSightingsForCurrentPlayer/);
    assert.doesNotMatch(storyToolBlock, /adjustWorldTimeByMinutes/);
    assert.doesNotMatch(storyToolBlock, /recordEventSummaryEntry/);

    const normalPlayerProcessingIndex = route.indexOf('if (!isNpc && typeof Globals.recordPlayerArrivalVisitState');
    const storyToolIndex = route.indexOf('if (!isNpc && storyToolTeleport)');
    assert.notEqual(normalPlayerProcessingIndex, -1, 'non-story player teleports should keep normal arrival processing');
    assert.ok(storyToolIndex < normalPlayerProcessingIndex, 'story-tool fast path should be before normal player processing');
});
