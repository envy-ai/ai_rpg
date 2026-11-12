const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('views/index.njk', 'utf8');
function loadFunction(name, endMarker, context) {
    const start = source.indexOf(`async function ${name}`);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    return vm.runInNewContext(`(${source.slice(start, end).trim()})`, context);
}

for (const result of [{ error: 'model unavailable' }, undefined, { eventsSkipped: true }, { travelTimeSkipped: true }, {}]) {
    test(`direct exit only moves after successful narration: ${JSON.stringify(result)}`, async () => {
        let moves = 0;
        let hidden = 0;
        const context = {
            window: { currentPlayerData: { name: 'Mira' }, AIRPG_CHAT: { dispatchAutomatedMessage: async () => result } },
            resolveDestinationNameStrict: () => 'Gate', shouldUseEventMove: () => false,
            shouldPromptBypassMove: () => true, ensureLocationRegionMembershipReadyForMovement: async () => true,
            showLocationOverlay() {}, hideLocationOverlay() { hidden++; },
            performDirectMove: async () => { moves++; return false; }, console, alert() {}
        };
        const move = loadFunction('moveToLocation', 'async function performDirectMove', context);
        await move({ exit: { destination: 'gate' } });
        assert.equal(moves, result && !result.error && !result.eventsSkipped && !result.travelTimeSkipped ? 1 : 0);
        if (!moves) assert.equal(hidden, 1);
    });
}

for (const actionText of ['', 'Travel carefully']) {
    for (const result of [{ error: 'model unavailable' }, undefined, {}]) {
        test(`map travel ${actionText ? 'action' : 'comment'} stops on failure: ${JSON.stringify(result)}`, async () => {
            let teleports = 0;
            const context = {
                window: { currentPlayerData: { id: 'player', name: 'Mira' }, AIRPG_CHAT: { dispatchAutomatedMessage: async () => result } },
                lastRenderedLocation: null, ensureLocationNameCached: async () => ({ name: 'Gate' }),
                ensureLocationRegionMembershipReadyForMovement: async () => true,
                fetchMapFastTravelPreview: async () => ({ travelTimeMinutes: 5 }),
                confirmMapFastTravel: async () => ({ confirmed: true, actionText }),
                buildMapFastTravelMetadata: () => ({}), showLocationOverlay() {}, hideLocationOverlay() {},
                teleportNpcToLocation: async () => { teleports++; }, document: { querySelector: () => null }, console, alert() {}
            };
            const travel = loadFunction('travelToAdjacentLocationFromMap', 'window.travelToAdjacentLocationFromMap', context);
            const moved = await travel('gate');
            assert.equal(teleports, result && !result.error ? 1 : 0);
            assert.equal(moved, Boolean(result && !result.error));
        });
    }
}
