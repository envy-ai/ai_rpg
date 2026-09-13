const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
    assertThingVisibleToPlayerForInteraction,
    assertExitVisibleToPlayerForTravel
} = require('../HiddenDiscovery.js');

test('central interaction and travel gates reject hidden world targets', () => {
    assert.throws(
        () => assertThingVisibleToPlayerForInteraction({ id: 'secret', name: 'Secret', hiddenFromPlayer: true }),
        /Cannot interact with hidden Thing "Secret" until it is revealed/
    );
    assert.throws(
        () => assertExitVisibleToPlayerForTravel({ id: 'secret-exit', hiddenFromPlayer: true }, { direction: 'down' }),
        /Cannot travel through hidden exit "down" until it is revealed/
    );
    assert.doesNotThrow(() => assertThingVisibleToPlayerForInteraction({ id: 'visible', hiddenFromPlayer: false }));
    assert.doesNotThrow(() => assertExitVisibleToPlayerForTravel({ id: 'visible-exit', hiddenFromPlayer: false }));
});

test('gameplay routes apply central hidden-target gates to movement and Thing operations', () => {
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    assert.match(apiSource, /assertExitVisibleToPlayerForTravel\(matchedExit, \{ direction/);
    for (const action of [
        'consume',
        'use for crafting, processing, salvage, or harvesting',
        'use to modify a location',
        'use with a module operation',
        'combine',
        'separate',
        'split',
        'merge',
        'use as a container',
        'move',
        'give'
    ]) {
        assert.match(apiSource, new RegExp(`assertThingVisibleToPlayerForInteraction\\([^;]+action: '${action}'`));
    }
});

test('ordinary destination and map serializers omit hidden exits', () => {
    const destinationSource = fs.readFileSync(require.resolve('../PlayerActionDestinationContext.js'), 'utf8');
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    assert.match(destinationSource, /entries\.filter\(\(\[, exit\]\) => exit\?\.hiddenFromPlayer !== true\)/);
    assert.match(apiSource, /const exits = availableDirections\.map\(direction => \{[\s\S]*?if \(exit\?\.hiddenFromPlayer === true\) \{\s*return null;/);
});

test('all real player-arrival surfaces invoke automatic hidden-world discovery', () => {
    const apiSource = fs.readFileSync(require.resolve('../api.js'), 'utf8');
    const callCount = (apiSource.match(/await runAutomaticHiddenWorldDiscoveryForArrival\(\{/g) || []).length;
    assert.ok(callCount >= 4, `Expected at least four automatic arrival-discovery call sites, found ${callCount}.`);
    assert.match(apiSource, /runWhileYouWereAwayOnArrivalIfNeeded[\s\S]*?runAutomaticHiddenWorldDiscoveryForArrival/);
    assert.match(apiSource, /Globals\.recordPlayerArrivalVisitState\(entranceLocation, false\);[\s\S]*?runAutomaticHiddenWorldDiscoveryForArrival\(\{[\s\S]*?wasVisitedBeforeArrival: false/);
});
