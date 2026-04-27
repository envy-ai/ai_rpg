const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

function getCraftRouteSource() {
    const source = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const start = source.indexOf("        app.post('/api/craft'");
    const end = source.indexOf("        app.post('/api/locations/:id/modify'", start);

    assert.notEqual(start, -1, 'Could not locate /api/craft route');
    assert.notEqual(end, -1, 'Could not locate route following /api/craft');

    return source.slice(start, end);
}

test('/api/craft autosaves after successful craft/harvest mutations', () => {
    const route = getCraftRouteSource();

    const preActionSave = route.indexOf('Autosave before crafting failed');
    const timeAdvance = route.indexOf('const craftingTimeProgress = Globals.advanceTime');
    const arrivals = route.indexOf('await processDueVehicleArrivals();', timeAdvance);
    const sightings = route.indexOf('Player.recordNpcSightingsForCurrentPlayer', arrivals);
    const postActionSaveCall = route.indexOf('await runAutosaveIfEnabled();', sightings);
    const postActionSaveWarning = route.indexOf('Autosave after crafting failed', postActionSaveCall);
    const response = route.indexOf('res.json({', sightings);

    assert.ok(preActionSave > -1, 'Expected existing pre-action autosave warning path');
    assert.ok(timeAdvance > preActionSave, 'Expected action state changes after the pre-action save');
    assert.ok(arrivals > timeAdvance, 'Expected vehicle arrivals to resolve before post-action save');
    assert.ok(sightings > arrivals, 'Expected NPC sighting updates before post-action save');
    assert.ok(postActionSaveCall > sightings, 'Expected post-action autosave after NPC sightings');
    assert.ok(postActionSaveWarning > postActionSaveCall, 'Expected post-action autosave warning path');
    assert.ok(response > postActionSaveWarning, 'Expected post-action autosave before the success response');
});
