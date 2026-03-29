const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

function loadVehicleEditorHelpers() {
    const source = fs.readFileSync(require.resolve('../views/index.njk'), 'utf8');
    const start = source.indexOf('function normalizePendingVehicleDestinationSnapshot(pendingDestination = null) {');
    const end = source.indexOf("\n        const UNKNOWN_LEVEL_DISPLAY = '—';", start);
    if (start < 0 || end < 0) {
        throw new Error('Unable to locate vehicle editor helpers in views/index.njk');
    }

    const functionSource = source.slice(start, end);
    const context = {
        Map,
        Set,
        Array,
        Number,
        JSON
    };
    vm.createContext(context);
    vm.runInContext(
        `${functionSource}
this.normalizePendingVehicleDestinationSnapshot = normalizePendingVehicleDestinationSnapshot;
this.normalizeVehicleInfoSnapshot = normalizeVehicleInfoSnapshot;
this.normalizeNamedLocationOption = normalizeNamedLocationOption;
this.buildVehiclePendingRegionDestinationSnapshot = buildVehiclePendingRegionDestinationSnapshot;
this.buildVehiclePendingRegionRouteEntry = buildVehiclePendingRegionRouteEntry;
this.parseVehiclePendingRegionRouteEntry = parseVehiclePendingRegionRouteEntry;
this.buildVehiclePendingRegionRouteOption = buildVehiclePendingRegionRouteOption;
this.buildVehiclePendingDestinationOption = buildVehiclePendingDestinationOption;
this.buildVehiclePendingDestinationPayload = buildVehiclePendingDestinationPayload;
this.collectVehicleInfoFromEditor = collectVehicleInfoFromEditor;`,
        context
    );

    return {
        normalizePendingVehicleDestinationSnapshot: context.normalizePendingVehicleDestinationSnapshot,
        normalizeVehicleInfoSnapshot: context.normalizeVehicleInfoSnapshot,
        normalizeNamedLocationOption: context.normalizeNamedLocationOption,
        buildVehiclePendingRegionDestinationSnapshot: context.buildVehiclePendingRegionDestinationSnapshot,
        buildVehiclePendingRegionRouteEntry: context.buildVehiclePendingRegionRouteEntry,
        parseVehiclePendingRegionRouteEntry: context.parseVehiclePendingRegionRouteEntry,
        buildVehiclePendingRegionRouteOption: context.buildVehiclePendingRegionRouteOption,
        buildVehiclePendingDestinationOption: context.buildVehiclePendingDestinationOption,
        buildVehiclePendingDestinationPayload: context.buildVehiclePendingDestinationPayload,
        collectVehicleInfoFromEditor: context.collectVehicleInfoFromEditor
    };
}

function createVehicleEditorStub({
    currentDestinationOption = null,
    destinations = [],
    ETA = null,
    vehicleExitId = null,
    icon = '🚗'
} = {}) {
    return {
        isVehicleInput: { checked: true },
        currentDestinationOption,
        currentDestinationInput: { value: currentDestinationOption?.id || '' },
        currentDestinationSearchInput: { value: '' },
        iconInput: { value: icon },
        destinationSelections: new Map(destinations.map(locationId => [locationId, { id: locationId }])),
        destinationsInput: { value: '' },
        etaInput: { value: ETA === null ? '' : String(ETA) },
        vehicleExitIdInput: { value: vehicleExitId || '' }
    };
}

function toPlainJson(value) {
    return JSON.parse(JSON.stringify(value));
}

test('collectVehicleInfoFromEditor preserves pendingDestination for unchanged underway trips', () => {
    const { collectVehicleInfoFromEditor } = loadVehicleEditorHelpers();
    const fallbackSnapshot = {
        icon: '🚗',
        pendingDestination: {
            rawText: 'Harbor District|Dock 9',
            regionName: 'Harbor District',
            locationName: 'Dock 9',
            regionId: 'region-harbor',
            locationId: 'dock-9'
        },
        destinations: ['dock-9', 'dock-10'],
        ETA: 150,
        departureTime: 100,
        vehicleExitId: 'vehicle-exit'
    };
    const editor = createVehicleEditorStub({
        currentDestinationOption: {
            id: 'dock-9',
            name: 'Dock 9',
            regionName: 'Harbor District',
            label: 'Dock 9'
        },
        destinations: ['dock-9', 'dock-10'],
        ETA: 150,
        vehicleExitId: 'vehicle-exit'
    });

    const result = collectVehicleInfoFromEditor(editor, fallbackSnapshot);

    assert.equal(result.error, null);
    assert.equal(result.vehicleInfo.currentDestination, null);
    assert.deepEqual(toPlainJson(result.vehicleInfo.pendingDestination), fallbackSnapshot.pendingDestination);
    assert.equal(result.vehicleInfo.departureTime, 100);
});

test('collectVehicleInfoFromEditor retargets underway trips through pendingDestination', () => {
    const { collectVehicleInfoFromEditor } = loadVehicleEditorHelpers();
    const fallbackSnapshot = {
        icon: '🚗',
        pendingDestination: {
            rawText: 'Harbor District|Dock 9',
            regionName: 'Harbor District',
            locationName: 'Dock 9',
            regionId: 'region-harbor',
            locationId: 'dock-9'
        },
        destinations: ['dock-9', 'dock-10'],
        ETA: 150,
        departureTime: 100,
        vehicleExitId: 'vehicle-exit'
    };
    const editor = createVehicleEditorStub({
        currentDestinationOption: {
            id: 'dock-10',
            name: 'Dock 10',
            regionName: 'Harbor District',
            label: 'Dock 10'
        },
        destinations: ['dock-9', 'dock-10'],
        ETA: 150,
        vehicleExitId: 'vehicle-exit'
    });

    const result = collectVehicleInfoFromEditor(editor, fallbackSnapshot);

    assert.equal(result.error, null);
    assert.equal(result.vehicleInfo.currentDestination, null);
    assert.deepEqual(toPlainJson(result.vehicleInfo.pendingDestination), {
        rawText: 'Harbor District|Dock 10',
        regionName: 'Harbor District',
        locationName: 'Dock 10',
        regionId: null,
        locationId: 'dock-10'
    });
    assert.equal(result.vehicleInfo.departureTime, 100);
});

test('buildVehiclePendingDestinationOption exposes unresolved named pending destinations for display and save preservation', () => {
    const { buildVehiclePendingDestinationOption, collectVehicleInfoFromEditor } = loadVehicleEditorHelpers();
    const fallbackSnapshot = {
        icon: '🚗',
        pendingDestination: {
            rawText: 'Coreward Shipping Lane|Derelict Bulk Hauler',
            regionName: 'Coreward Shipping Lane',
            regionId: 'region-coreward',
            locationName: 'Derelict Bulk Hauler',
            locationId: null
        },
        destinations: [],
        ETA: 240,
        departureTime: 180,
        vehicleExitId: 'vehicle-exit'
    };
    const currentDestinationOption = buildVehiclePendingDestinationOption(fallbackSnapshot.pendingDestination);
    assert.equal(currentDestinationOption?.name, 'Derelict Bulk Hauler');
    assert.equal(currentDestinationOption?.regionName, 'Coreward Shipping Lane');
    assert.equal(currentDestinationOption?.resolvedLocationId, null);

    const editor = createVehicleEditorStub({
        currentDestinationOption,
        destinations: [],
        ETA: 240,
        vehicleExitId: 'vehicle-exit'
    });

    const result = collectVehicleInfoFromEditor(editor, fallbackSnapshot);

    assert.equal(result.error, null);
    assert.equal(result.vehicleInfo.currentDestination, null);
    assert.deepEqual(toPlainJson(result.vehicleInfo.pendingDestination), fallbackSnapshot.pendingDestination);
    assert.equal(result.vehicleInfo.departureTime, 180);
});

test('buildVehiclePendingDestinationOption preserves region-only pending destinations', () => {
    const { buildVehiclePendingDestinationOption, collectVehicleInfoFromEditor } = loadVehicleEditorHelpers();
    const fallbackSnapshot = {
        icon: '🚗',
        pendingDestination: {
            rawText: 'Skyreach',
            regionName: 'Skyreach',
            regionId: 'region-skyreach',
            locationName: null,
            locationId: null
        },
        destinations: [],
        ETA: 240,
        departureTime: 180,
        vehicleExitId: 'vehicle-exit'
    };
    const currentDestinationOption = buildVehiclePendingDestinationOption(fallbackSnapshot.pendingDestination);
    assert.equal(currentDestinationOption?.name, 'Skyreach');
    assert.equal(currentDestinationOption?.regionName, '');
    assert.equal(currentDestinationOption?.resolvedLocationId, null);

    const editor = createVehicleEditorStub({
        currentDestinationOption,
        destinations: [],
        ETA: 240,
        vehicleExitId: 'vehicle-exit'
    });

    const result = collectVehicleInfoFromEditor(editor, fallbackSnapshot);

    assert.equal(result.error, null);
    assert.equal(result.vehicleInfo.currentDestination, null);
    assert.deepEqual(toPlainJson(result.vehicleInfo.pendingDestination), fallbackSnapshot.pendingDestination);
    assert.equal(result.vehicleInfo.departureTime, 180);
});

test('collectVehicleInfoFromEditor treats cleared unresolved pending destinations as missing', () => {
    const { collectVehicleInfoFromEditor } = loadVehicleEditorHelpers();
    const fallbackSnapshot = {
        icon: '🚗',
        pendingDestination: {
            rawText: 'Coreward Shipping Lane|Derelict Bulk Hauler',
            regionName: 'Coreward Shipping Lane',
            regionId: 'region-coreward',
            locationName: 'Derelict Bulk Hauler',
            locationId: null
        },
        destinations: [],
        ETA: 240,
        departureTime: 180,
        vehicleExitId: 'vehicle-exit'
    };
    const editor = createVehicleEditorStub({
        currentDestinationOption: null,
        destinations: [],
        ETA: 240,
        vehicleExitId: 'vehicle-exit'
    });

    const result = collectVehicleInfoFromEditor(editor, fallbackSnapshot);

    assert.equal(result.vehicleInfo, null);
    assert.equal(result.error, 'Vehicle destination is required when ETA is set.');
});

test('buildVehiclePendingRegionRouteEntry encodes fixed-route new-region destinations', () => {
    const {
        buildVehiclePendingRegionRouteEntry,
        parseVehiclePendingRegionRouteEntry,
        buildVehiclePendingRegionRouteOption
    } = loadVehicleEditorHelpers();

    const routeEntry = buildVehiclePendingRegionRouteEntry('Skyreach');
    assert.equal(routeEntry, 'pending-region:Skyreach');

    const parsed = toPlainJson(parseVehiclePendingRegionRouteEntry(routeEntry));
    assert.deepEqual(parsed, {
        entry: 'pending-region:Skyreach',
        regionName: 'Skyreach',
        comparisonName: 'skyreach',
        pendingDestinationSnapshot: {
            rawText: 'Skyreach|',
            regionName: 'Skyreach',
            locationName: null,
            regionId: null,
            locationId: null
        }
    });

    const option = toPlainJson(buildVehiclePendingRegionRouteOption('Skyreach'));
    assert.deepEqual(option, {
        id: 'pending-region:Skyreach',
        name: 'Skyreach',
        regionName: 'New region',
        label: 'Skyreach',
        normalizedName: 'skyreach',
        normalizedLabel: 'skyreach',
        pendingDestinationSnapshot: {
            rawText: 'Skyreach|',
            regionName: 'Skyreach',
            locationName: null,
            regionId: null,
            locationId: null
        },
        routeKind: 'pending-region'
    });
});

test('collectVehicleInfoFromEditor creates a new unresolved pending destination without fallback state', () => {
    const {
        buildVehiclePendingRegionDestinationSnapshot,
        buildVehiclePendingDestinationOption,
        collectVehicleInfoFromEditor
    } = loadVehicleEditorHelpers();
    const pendingDestination = buildVehiclePendingRegionDestinationSnapshot('Skyreach');
    const editor = createVehicleEditorStub({
        currentDestinationOption: buildVehiclePendingDestinationOption(pendingDestination),
        destinations: [],
        ETA: 240,
        vehicleExitId: 'vehicle-exit'
    });

    const result = collectVehicleInfoFromEditor(editor, null);

    assert.equal(result.error, null);
    assert.equal(result.vehicleInfo.currentDestination, null);
    assert.deepEqual(toPlainJson(result.vehicleInfo.pendingDestination), {
        rawText: 'Skyreach|',
        regionName: 'Skyreach',
        locationName: null,
        regionId: null,
        locationId: null
    });
    assert.equal(result.vehicleInfo.departureTime, null);
});

test('collectVehicleInfoFromEditor accepts fixed-route new-region destinations for matching pending destinations', () => {
    const {
        buildVehiclePendingRegionRouteEntry,
        buildVehiclePendingRegionDestinationSnapshot,
        buildVehiclePendingDestinationOption,
        collectVehicleInfoFromEditor
    } = loadVehicleEditorHelpers();
    const pendingDestination = buildVehiclePendingRegionDestinationSnapshot('Skyreach');
    const editor = createVehicleEditorStub({
        currentDestinationOption: buildVehiclePendingDestinationOption(pendingDestination),
        destinations: [buildVehiclePendingRegionRouteEntry('Skyreach')],
        ETA: 240,
        vehicleExitId: 'vehicle-exit'
    });

    const result = collectVehicleInfoFromEditor(editor, null);

    assert.equal(result.error, null);
    assert.deepEqual(toPlainJson(result.vehicleInfo.destinations), ['pending-region:Skyreach']);
    assert.deepEqual(toPlainJson(result.vehicleInfo.pendingDestination), {
        rawText: 'Skyreach|',
        regionName: 'Skyreach',
        locationName: null,
        regionId: null,
        locationId: null
    });
});

test('collectVehicleInfoFromEditor rejects pending destinations outside fixed-route new-region entries', () => {
    const {
        buildVehiclePendingRegionRouteEntry,
        buildVehiclePendingRegionDestinationSnapshot,
        buildVehiclePendingDestinationOption,
        collectVehicleInfoFromEditor
    } = loadVehicleEditorHelpers();
    const pendingDestination = buildVehiclePendingRegionDestinationSnapshot('Skyreach');
    const editor = createVehicleEditorStub({
        currentDestinationOption: buildVehiclePendingDestinationOption(pendingDestination),
        destinations: [buildVehiclePendingRegionRouteEntry('Elsewhere')],
        ETA: 240,
        vehicleExitId: 'vehicle-exit'
    });

    const result = collectVehicleInfoFromEditor(editor, null);

    assert.equal(result.vehicleInfo, null);
    assert.equal(result.error, 'Vehicle destination must be one of the listed destinations.');
});
