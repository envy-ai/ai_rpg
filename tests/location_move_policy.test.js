const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadLocationMovePolicyHelpers(movePolicy = 'unexplored_locations') {
    const source = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');
    const start = source.indexOf('function isUnexploredRegionExit(exit) {');
    const end = source.indexOf('\n            const locationOverlay = document.getElementById(', start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate location move policy helpers in views/index.njk');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Boolean,
        MOVE_PLAUSIBILITY_POLICY: movePolicy
    };

    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.isUnexploredRegionExit = isUnexploredRegionExit;
this.isUnexploredLocationExit = isUnexploredLocationExit;
this.shouldUseEventMove = shouldUseEventMove;
this.shouldPromptBypassMove = shouldPromptBypassMove;`,
        context
    );

    return {
        isUnexploredRegionExit: context.isUnexploredRegionExit,
        isUnexploredLocationExit: context.isUnexploredLocationExit,
        shouldUseEventMove: context.shouldUseEventMove,
        shouldPromptBypassMove: context.shouldPromptBypassMove
    };
}

test('shouldUseEventMove treats unvisited expanded locations as unexplored under unexplored_locations policy', () => {
    const { isUnexploredLocationExit, shouldUseEventMove } = loadLocationMovePolicyHelpers('unexplored_locations');
    const exit = {
        destinationIsStub: false,
        destinationIsRegionEntryStub: false,
        destinationVisited: false,
        destinationRegion: null,
        destinationRegionExpanded: true
    };

    assert.equal(isUnexploredLocationExit(exit), true);
    assert.equal(shouldUseEventMove(exit), true);
});

test('shouldUseEventMove treats visited expanded locations as explored under unexplored_locations policy', () => {
    const { isUnexploredLocationExit, shouldUseEventMove } = loadLocationMovePolicyHelpers('unexplored_locations');
    const exit = {
        destinationIsStub: false,
        destinationIsRegionEntryStub: false,
        destinationVisited: true,
        destinationRegion: null,
        destinationRegionExpanded: true
    };

    assert.equal(isUnexploredLocationExit(exit), false);
    assert.equal(shouldUseEventMove(exit), false);
});

test('shouldUseEventMove still treats unresolved region exits as unexplored', () => {
    const { isUnexploredLocationExit, shouldUseEventMove } = loadLocationMovePolicyHelpers('unexplored_locations');
    const exit = {
        destinationIsStub: false,
        destinationIsRegionEntryStub: true,
        destinationVisited: false,
        destinationRegion: 'region-unknown',
        destinationRegionExpanded: false
    };

    assert.equal(isUnexploredLocationExit(exit), true);
    assert.equal(shouldUseEventMove(exit), true);
});

test('direct bypass prose prompt is reserved for unexplored exits', () => {
    const { shouldPromptBypassMove } = loadLocationMovePolicyHelpers('never');

    assert.equal(shouldPromptBypassMove({
        destinationIsStub: false,
        destinationIsRegionEntryStub: false,
        destinationVisited: true,
        destinationRegion: null,
        destinationRegionExpanded: true
    }), false);

    assert.equal(shouldPromptBypassMove({
        destinationIsStub: false,
        destinationIsRegionEntryStub: false,
        destinationVisited: false,
        destinationRegion: null,
        destinationRegionExpanded: true
    }), true);

    assert.equal(shouldPromptBypassMove({
        destinationIsStub: false,
        destinationIsRegionEntryStub: true,
        destinationVisited: false,
        destinationRegion: 'region-unknown',
        destinationRegionExpanded: false
    }), true);
});
