const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const rootDir = path.join(__dirname, '..');

// Slice the two arrival-selection helpers out of server.js and evaluate them in
// an isolated context with stubbed dependencies. This exercises the fail-loud
// contract (throws instead of falling back to the entrance) without booting the
// server or calling a real LLM.
function loadArrivalHelpers({ chatCompletion, parsedName } = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('function collectRegionArrivalCandidates(region) {');
    const end = source.indexOf('async function generateRegionFromPrompt(options = {}) {', start);
    assert.notEqual(start, -1, 'collectRegionArrivalCandidates should exist');
    assert.notEqual(end, -1, 'generateRegionFromPrompt boundary should exist');

    const functionSource = source.slice(start, end);
    const logCalls = [];
    const context = {
        Math,
        Number,
        Set,
        Array,
        console: { warn() {}, log() {} },
        gameLocations: new Map(),
        normalizeDirection: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
        normalizeRegionLocationName: (value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''),
        parseRegionEntranceResponse: () => (parsedName === undefined ? null : parsedName),
        LLMClient: {
            chatCompletion: chatCompletion || (async () => ''),
            logPrompt: (payload) => { logCalls.push(payload); }
        }
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(`${functionSource}\nthis.__chooseArrival = chooseArrivalLocationForEntryStub;\nthis.__collect = collectRegionArrivalCandidates;`, context);
    return { context, logCalls };
}

function addLocation(context, { id, name, shortDescription = '', isRegionEntryStub = false }) {
    context.gameLocations.set(id, {
        id,
        name,
        shortDescription,
        stubMetadata: isRegionEntryStub ? { isRegionEntryStub: true } : {}
    });
}

test('throws when the region has no non-stub member locations', async () => {
    const { context } = loadArrivalHelpers();
    const region = { id: 'reg_1', name: 'Empty Region', locationIds: ['stub_a'] };
    addLocation(context, { id: 'stub_a', name: 'Doorway', isRegionEntryStub: true });

    await assert.rejects(
        () => context.__chooseArrival({ region }),
        /no non-stub member locations/,
        'an entry-stub-only region should fail loud, not fall back'
    );
});

test('returns the single member location without calling the LLM', async () => {
    let called = false;
    const { context, logCalls } = loadArrivalHelpers({
        chatCompletion: async () => { called = true; return '<arrival><name>x</name></arrival>'; }
    });
    const region = { id: 'reg_2', name: 'Solo Region', locationIds: ['loc_1'] };
    addLocation(context, { id: 'loc_1', name: 'Only Place' });

    const result = await context.__chooseArrival({ region });
    assert.equal(result.id, 'loc_1');
    assert.equal(called, false, 'a single-candidate region should not spend an LLM call');
    assert.equal(logCalls.length, 0);
});

test('returns the LLM-selected member and logs the prompt', async () => {
    const { context, logCalls } = loadArrivalHelpers({
        chatCompletion: async () => '<arrival><name>Riverside Gate</name></arrival>',
        parsedName: 'Riverside Gate'
    });
    const region = { id: 'reg_3', name: 'Twin Region', locationIds: ['loc_a', 'loc_b'] };
    addLocation(context, { id: 'loc_a', name: 'Old Keep' });
    addLocation(context, { id: 'loc_b', name: 'Riverside Gate' });

    const result = await context.__chooseArrival({
        region,
        originContext: { originLocationName: 'South Bridge', originDirection: 'north', description: 'a river road' }
    });
    assert.equal(result.id, 'loc_b', 'should land at the LLM-chosen border location, not the first/entrance');
    assert.equal(logCalls.length, 1, 'the arrival prompt must be logged via LLMClient.logPrompt');
    assert.equal(logCalls[0].metadataLabel, 'region_arrival_selection');
});

test('throws on an empty LLM response instead of falling back', async () => {
    const { context } = loadArrivalHelpers({ chatCompletion: async () => '   ' });
    const region = { id: 'reg_4', name: 'Twin Region', locationIds: ['loc_a', 'loc_b'] };
    addLocation(context, { id: 'loc_a', name: 'Old Keep' });
    addLocation(context, { id: 'loc_b', name: 'Riverside Gate' });

    await assert.rejects(
        () => context.__chooseArrival({ region }),
        /returned an empty response/
    );
});

test('throws when the LLM names a location that is not a region member', async () => {
    const { context } = loadArrivalHelpers({
        chatCompletion: async () => '<arrival><name>Nowhere</name></arrival>',
        parsedName: 'Nowhere'
    });
    const region = { id: 'reg_5', name: 'Twin Region', locationIds: ['loc_a', 'loc_b'] };
    addLocation(context, { id: 'loc_a', name: 'Old Keep' });
    addLocation(context, { id: 'loc_b', name: 'Riverside Gate' });

    await assert.rejects(
        () => context.__chooseArrival({ region }),
        /was not found among the locations/
    );
});
