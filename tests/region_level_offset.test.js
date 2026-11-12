'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRegionLevelOffsetResponse } = require('../RegionLevelOffset.js');
const fs = require('node:fs');
const vm = require('node:vm');

test('new region offset accepts exactly one plain XML integer from one through four', () => {
    for (const value of [1, 2, 3, 4]) assert.equal(parseRegionLevelOffsetResponse(`<regionLevelOffset>${value}</regionLevelOffset>`), value);
    for (const xml of [
        '<regionLevelOffset/>', '<regionLevelOffset> </regionLevelOffset>', '<regionLevelOffset>0</regionLevelOffset>',
        '<regionLevelOffset>5</regionLevelOffset>', '<regionLevelOffset>1.5</regionLevelOffset>',
        '<regionLevelOffset>false</regionLevelOffset>', '<regionLevelOffset><value>1</value></regionLevelOffset>',
        '<regionLevelOffset unit="level">2</regionLevelOffset>', '<other>2</other>',
        '<regionLevelOffset>2</regionLevelOffset><regionLevelOffset>3</regionLevelOffset>'
    ]) assert.throws(() => parseRegionLevelOffsetResponse(xml), /regionLevelOffset|XML/i, xml);
});

test('region offset prompt retries malformed XML locally and logs each attempt with strict tool-free options', async () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const from = source.indexOf('async function requestRegionLevelOffset('), to = source.indexOf('\nfunction resolveEventRegionStubLevelData(', from);
    assert.ok(from >= 0 && to > from);
    const calls = [], logs = [], responses = ['<regionLevelOffset>1.5</regionLevelOffset>', '<regionLevelOffset>3</regionLevelOffset>'];
    const { runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts } = require('../PromptRetryPolicy.js');
    const context = {
        promptEnv: { render: () => 'rendered' }, parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'offset' }),
        describeSettingForPrompt: () => 'setting', getActiveSettingSnapshot: () => ({}), config: { ai: { retryAttempts: 1 } },
        runPromptWithParseRetries, resolveConfiguredPromptMaxAttempts, parseRegionLevelOffsetResponse,
        runGenerationPromptCompletion: async ({ requestOptions }) => { calls.push(requestOptions); return responses.shift(); },
        formatGenerationPromptMessageForLog: message => message.content,
        LLMClient: { logPrompt: entry => logs.push(entry) }
    };
    vm.createContext(context);
    const request = vm.runInContext(`${source.slice(from, to)}\nrequestRegionLevelOffset;`, context);
    assert.equal(await request({ regionName: 'Far', regionDescription: 'Far away.', sourceRegionName: 'Near', sourceRegionDescription: 'Near.', sourceAverageLevel: 4 }), 3);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.metadataLabel === 'region_level_offset' && call.xmlSchema === 'region-level-offset.schema.xml' && call.throwOnError && call.validateXML === false && call.allowToolCalls === false));
    assert.match(calls[1].messages.at(-1).content, /regionLevelOffset/i);
    assert.equal(logs.length, 2);
});

function createStubHarness() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const extract = (start, end) => {
        const from = source.indexOf(start), to = source.indexOf(end, from);
        assert.ok(from >= 0 && to > from, `Missing ${start}`);
        return source.slice(from, to);
    };
    const pending = new Map(), locations = new Map(), regions = new Map();
    let serial = 0, calls = 0, request = async () => 2;
    const normal = value => String(value || '').trim().toLowerCase();
    const context = { console, pendingRegionStubs: pending, gameLocations: locations, regions, currentPlayer: { level: 30 }, runtimeGenerationId: 1,
        normalizeDuplicateName: normal, clampLevel: value => Math.max(1, Math.round(value)),
        findRegionByNameLoose: name => [...regions.values()].find(region => normal(region.name) === normal(name)) || null,
        findLocationByNameLoose: () => null, findPendingRegionByNameLoose: name => [...pending.values()].find(region => normal(region.originalName) === normal(name)) || null,
        findRegionByLocationId: id => regions.get(locations.get(id)?.regionId) || null,
        requestRegionLevelOffset: options => { calls++; return request(options); },
        createAbortError: message => Object.assign(new Error(message), { name: 'AbortError' }),
        generateRegionStubId: () => `pending_${++serial}`, directionKeyFromName: (_name, fallback) => fallback,
        getActiveSettingSnapshot: () => ({}), describeSettingForPrompt: () => '', ensureLocationNameAllowed: async () => {},
        ensureExitConnection: () => {}, saveUploadedLocationImage: async () => { throw new Error('unexpected image save'); },
        Location: class { constructor(fields) { Object.assign(this, fields, { id: `location_${++serial}` }); } }
    };
    vm.createContext(context);
    vm.runInContext(`${extract('function resolveEventRegionStubLevelData(', '\nfunction shouldCreateOriginExitFromStubMetadata(')}\n${extract('async function createRegionStubFromEvent(', '\nfunction collectPendingRegionLocationsForExpansion(')}\nthis.create = createRegionStubFromEvent;`, context);
    const origin = (id, level) => {
        const region = { id: `region_${id}`, name: `Source ${id}`, averageLevel: level };
        const location = { id, name: id, regionId: region.id, getAvailableDirections: () => [] };
        regions.set(region.id, region); locations.set(id, location);
        return { region, location };
    };
    return { context, pending, locations, regions, origin, setRequest: fn => { request = fn; }, calls: () => calls };
}

test('new region captures source level before selection and sibling doorways retain canonical anchor and offset', async () => {
    const fixture = createStubHarness();
    const first = fixture.origin('first', 1), sibling = fixture.origin('sibling', 8);
    fixture.setRequest(async options => { assert.equal(options.sourceAverageLevel, 1); first.region.averageLevel = 9; return 2; });
    const entry = await fixture.context.create({ name: 'Far Harbor', originLocation: first.location, createOriginExit: false });
    assert.equal(entry.baseLevel, 3);
    assert.equal(entry.stubMetadata.regionAverageLevel, 1);
    assert.equal(entry.stubMetadata.targetRegionRelativeLevel, 2);
    const next = await fixture.context.create({ name: 'Far Harbor', originLocation: sibling.location, createOriginExit: false });
    assert.equal(next.baseLevel, 3);
    assert.equal(next.stubMetadata.regionAverageLevel, 1);
    assert.equal(next.stubMetadata.targetRegionRelativeLevel, 2);
    assert.equal(fixture.calls(), 1, 'pending sibling must not ask for another offset');
});

test('explicit zero and already-known region never request a new offset', async () => {
    const fixture = createStubHarness();
    const origin = fixture.origin('source', 4);
    const entry = await fixture.context.create({ name: 'Station', originLocation: origin.location, relativeLevel: 0, createOriginExit: false });
    assert.equal(entry.baseLevel, 4);
    assert.equal(entry.stubMetadata.targetRegionRelativeLevel, 0);
    fixture.regions.set('known', { id: 'known', name: 'Existing' });
    fixture.context.chooseArrivalLocationForEntryStub = async () => ({ id: 'known-entry' });
    const known = await fixture.context.create({ name: 'Existing', originLocation: origin.location, createOriginExit: false });
    assert.equal(known.id, 'known-entry');
    assert.equal(fixture.calls(), 0);
});

test('stale origin during offset selection aborts without creating a pending region', async () => {
    const fixture = createStubHarness();
    const origin = fixture.origin('source', 4);
    fixture.setRequest(async () => { fixture.locations.delete(origin.location.id); return 2; });
    await assert.rejects(fixture.context.create({ name: 'Far Harbor', originLocation: origin.location, createOriginExit: false }), /origin changed|cancelled/i);
    assert.equal(fixture.pending.size, 0);
});
