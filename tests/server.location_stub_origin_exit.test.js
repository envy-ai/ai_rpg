const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadLocationStubOriginExitHelpers() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const buildStart = source.indexOf('function buildLocationEventStubMetadata({');
    const shouldStart = source.indexOf('\nfunction shouldCreateOriginExitFromStubMetadata(stubMetadata = null) {', buildStart);
    const applyStart = source.indexOf('\nfunction applyStubExpansionOverrides(location, { createOriginExit } = {}) {', shouldStart);
    const createLocationFromEventStart = source.indexOf('\nasync function createLocationFromEvent({', applyStart);
    if (buildStart < 0 || shouldStart < 0 || applyStart < 0 || createLocationFromEventStart < 0) {
        throw new Error('Unable to locate location-stub origin-exit helpers in server.js');
    }

    const functionSource = source.slice(buildStart, createLocationFromEventStart);
    const context = {
        describeSettingForPrompt: () => 'Debug setting context'
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.buildLocationEventStubMetadata = buildLocationEventStubMetadata;
this.shouldCreateOriginExitFromStubMetadata = shouldCreateOriginExitFromStubMetadata;
this.applyStubExpansionOverrides = applyStubExpansionOverrides;`,
        context
    );
    return {
        buildLocationEventStubMetadata: context.buildLocationEventStubMetadata,
        shouldCreateOriginExitFromStubMetadata: context.shouldCreateOriginExitFromStubMetadata,
        applyStubExpansionOverrides: context.applyStubExpansionOverrides
    };
}

test('buildLocationEventStubMetadata persists suppressed origin-exit intent', () => {
    const { buildLocationEventStubMetadata } = loadLocationStubOriginExitHelpers();

    const metadata = buildLocationEventStubMetadata({
        originLocation: { id: 'origin-location-id' },
        resolvedDirection: 'approach_vector_alpha',
        stubShortDescription: 'An unexplored approach corridor.',
        settingSnapshot: {},
        effectiveRegionId: 'derelict-sector-region',
        effectiveRegionName: 'Derelict Sector',
        normalizedRelativeLevel: 2,
        resolvedVehicleType: null,
        resolvedIsVehicle: false,
        normalizedImageDataUrl: '',
        createOriginExit: false
    });

    assert.equal(metadata.originLocationId, 'origin-location-id');
    assert.equal(metadata.originDirection, 'approach_vector_alpha');
    assert.equal(metadata.createOriginExit, false);
    assert.equal(metadata.regionId, 'derelict-sector-region');
});

test('shouldCreateOriginExitFromStubMetadata honors explicit suppression', () => {
    const { shouldCreateOriginExitFromStubMetadata } = loadLocationStubOriginExitHelpers();

    assert.equal(shouldCreateOriginExitFromStubMetadata(null), true);
    assert.equal(shouldCreateOriginExitFromStubMetadata({}), true);
    assert.equal(shouldCreateOriginExitFromStubMetadata({ createOriginExit: true }), true);
    assert.equal(shouldCreateOriginExitFromStubMetadata({ createOriginExit: false }), false);
});

test('applyStubExpansionOverrides stamps suppressed origin-exit intent onto existing stubs', () => {
    const { applyStubExpansionOverrides } = loadLocationStubOriginExitHelpers();
    const stubLocation = {
        isStub: true,
        stubMetadata: {
            originLocationId: 'vehicle-location-id',
            originDirection: 'the_bone_orchard'
        }
    };

    applyStubExpansionOverrides(stubLocation, { createOriginExit: false });
    assert.equal(stubLocation.stubMetadata.createOriginExit, false);

    applyStubExpansionOverrides(stubLocation, { createOriginExit: true });
    assert.equal(stubLocation.stubMetadata.createOriginExit, true);
});
