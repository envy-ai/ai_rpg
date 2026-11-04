const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');
const HiddenDiscovery = require('../HiddenDiscovery.js');
const { parseLocationExitSuggestions } = require('../LocationExitSuggestions.js');

function extractServerFunction(startMarker, endMarker, exportName, context = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, `Could not locate ${startMarker}`);
    assert.notEqual(end, -1, `Could not locate ${endMarker}`);
    const sandbox = {
        Array,
        Boolean,
        Error,
        JSON,
        Map,
        Number,
        Object,
        String,
        Utils,
        ...HiddenDiscovery,
        Globals,
        console,
        getDefaultRarityLabel: () => 'Common',
        ...context
    };
    vm.createContext(sandbox);
    vm.runInContext(`${source.slice(start, end)}\nthis.result = ${exportName};`, sandbox);
    return sandbox.result;
}

test('location Thing XML defaults omitted fields visible and validates any explicit hidden discovery fields', async () => {
    const parseThingsXml = extractServerFunction(
        'async function parseThingsXml',
        '\nasync function parseThingSeparateResponse',
        'parseThingsXml'
    );
    const xml = `
<items>
  <item>
    <name>Loose Hearthstone</name>
    <description>A soot-dark stone conceals a narrow cache.</description>
    <shortDescription>Soot-dark loose hearthstone</shortDescription>
    <itemOrScenery>scenery</itemOrScenery>
    <hiddenFromPlayer>true</hiddenFromPlayer>
    <discoveryDifficulty>very-hard</discoveryDifficulty>
  </item>
</items>`;
    const parsed = await parseThingsXml(xml, {
        strictXml: true,
        expectedThingType: 'scenery',
        allowHiddenDiscovery: true
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].hiddenFromPlayer, true);
    assert.equal(parsed[0].discoveryDifficulty, 'Very Hard');

    const visibleWithoutFields = await parseThingsXml(xml.replace(
        /\s*<hiddenFromPlayer>true<\/hiddenFromPlayer>\s*<discoveryDifficulty>[\s\S]*?<\/discoveryDifficulty>/,
        ''
    ), {
        strictXml: true,
        expectedThingType: 'scenery',
        allowHiddenDiscovery: true
    });
    assert.deepEqual(JSON.parse(JSON.stringify({
        hiddenFromPlayer: visibleWithoutFields[0].hiddenFromPlayer,
        discoveryDifficulty: visibleWithoutFields[0].discoveryDifficulty
    })), { hiddenFromPlayer: false, discoveryDifficulty: null });

    const visibleWithBlankDifficulty = await parseThingsXml(xml.replace(
        '<hiddenFromPlayer>true</hiddenFromPlayer>',
        '<hiddenFromPlayer>false</hiddenFromPlayer>'
    ).replace('<discoveryDifficulty>very-hard</discoveryDifficulty>', ''), {
        strictXml: true,
        expectedThingType: 'scenery',
        allowHiddenDiscovery: false
    });
    assert.equal(visibleWithBlankDifficulty[0].hiddenFromPlayer, false);
    assert.equal(visibleWithBlankDifficulty[0].discoveryDifficulty, null);

    const visibleWithEmptyDifficulty = await parseThingsXml(xml.replace(
        '<hiddenFromPlayer>true</hiddenFromPlayer>',
        ''
    ).replace('<discoveryDifficulty>very-hard</discoveryDifficulty>', '<discoveryDifficulty></discoveryDifficulty>'), {
        strictXml: true,
        expectedThingType: 'scenery',
        allowHiddenDiscovery: true
    });
    assert.equal(visibleWithEmptyDifficulty[0].hiddenFromPlayer, false);
    assert.equal(visibleWithEmptyDifficulty[0].discoveryDifficulty, null);

    await assert.rejects(
        parseThingsXml(xml.replace(/\s*<discoveryDifficulty>[\s\S]*?<\/discoveryDifficulty>/, ''), {
            strictXml: true,
            expectedThingType: 'scenery',
            allowHiddenDiscovery: true
        }),
        /discoveryDifficulty is required for a hidden target/
    );
    await assert.rejects(
        parseThingsXml(xml.replace('<discoveryDifficulty>very-hard</discoveryDifficulty>', '<discoveryDifficulty>   </discoveryDifficulty>'), {
            strictXml: true,
            expectedThingType: 'scenery',
            allowHiddenDiscovery: true
        }),
        /discoveryDifficulty is required for a hidden target/
    );
    await assert.rejects(
        parseThingsXml(xml.replace(
            '<hiddenFromPlayer>true</hiddenFromPlayer>',
            '<hiddenFromPlayer>true</hiddenFromPlayer><hiddenFromPlayer>false</hiddenFromPlayer>'
        ), {
            strictXml: true,
            expectedThingType: 'scenery',
            allowHiddenDiscovery: true
        }),
        /at most one <hiddenFromPlayer> and one <discoveryDifficulty>/
    );
    await assert.rejects(
        parseThingsXml(xml.replace('<discoveryDifficulty>very-hard</discoveryDifficulty>', '<discoveryDifficulty>hard</discoveryDifficulty><discoveryDifficulty>easy</discoveryDifficulty>'), {
            strictXml: true,
            expectedThingType: 'scenery',
            allowHiddenDiscovery: true
        }),
        /at most one <hiddenFromPlayer> and one <discoveryDifficulty>/
    );
    await assert.rejects(
        parseThingsXml(xml.replace('<hiddenFromPlayer>true</hiddenFromPlayer>', '<hiddenFromPlayer>sometimes</hiddenFromPlayer>'), {
            strictXml: true,
            expectedThingType: 'scenery',
            allowHiddenDiscovery: true
        }),
        /<hiddenFromPlayer> must be true or false/
    );
    await assert.rejects(
        parseThingsXml(xml.replace('<hiddenFromPlayer>true</hiddenFromPlayer>', '<hiddenFromPlayer>false</hiddenFromPlayer>'), {
            strictXml: true,
            expectedThingType: 'scenery',
            allowHiddenDiscovery: true
        }),
        /discoveryDifficulty must be null when hiddenFromPlayer is false/
    );
    await assert.rejects(
        parseThingsXml(xml, {
            strictXml: true,
            expectedThingType: 'scenery',
            allowHiddenDiscovery: false
        }),
        /cannot be hidden in this generation scope/
    );
});

test('Thing count and relative level distinguish omission, blank, and explicit zero', async () => {
    const parseThingsXml = extractServerFunction(
        'async function parseThingsXml',
        '\nasync function parseThingSeparateResponse',
        'parseThingsXml'
    );
    const xml = '<items><item><name>Stone</name><description>A stone.</description>'
        + '<shortDescription>Stone</shortDescription><itemOrScenery>item</itemOrScenery>'
        + '</item></items>';
    const parse = value => parseThingsXml(value, {
        strictXml: true,
        expectedThingType: 'item',
        allowHiddenDiscovery: false
    });
    const scalarValues = async value => JSON.parse(JSON.stringify(
        (await parse(value)).map(({ count, relativeLevel }) => ({ count, relativeLevel }))
    ));
    assert.deepEqual(await scalarValues(xml), [{ count: 1, relativeLevel: null }]);
    assert.deepEqual(await scalarValues(xml.replace(
        '</itemOrScenery>', '</itemOrScenery><count> </count><relativeLevel/>'
    )), [{ count: 1, relativeLevel: null }]);
    assert.deepEqual(await scalarValues(xml.replace(
        '</itemOrScenery>', '</itemOrScenery><count>0</count><relativeLevel>0</relativeLevel>'
    )), [{ count: 0, relativeLevel: 0 }]);
});

test('location and connected-region exit parsers canonicalize hidden declarations', () => {
    const suggestions = parseLocationExitSuggestions(`
<location><newExits><exit>
  <destinationType>location</destinationType>
  <name>Priest Hole</name>
  <description>A concealed panel opens into a cramped recess.</description>
  <travelTime>1 minute</travelTime>
  <hiddenFromPlayer>true</hiddenFromPlayer>
  <discoveryDifficulty>legendary</discoveryDifficulty>
</exit></newExits></location>`, {
        required: true,
        requireHiddenDiscoveryFields: true
    });
    assert.equal(suggestions[0].hiddenFromPlayer, true);
    assert.equal(suggestions[0].discoveryDifficulty, 'Legendary');

    const parseRegionExitsResponse = extractServerFunction(
        'function parseRegionExitsResponse(xmlSnippet) {',
        '\nasync function renderRegionStubPrompt({',
        'parseRegionExitsResponse'
    );
    const previousConfig = Globals.config;
    let exits;
    try {
        Globals.config = { ...(Globals.config || {}), strictXMLParsing: true };
        exits = parseRegionExitsResponse(`
<region><locations><location><name>Old Courtyard</name><regionExits>
  <stubRegion type="connectedRegion">
    <regionName>Buried Cloister</regionName>
    <regionDescription>A sealed monastery beneath the hill.</regionDescription>
    <relativeLevel>1</relativeLevel>
    <relationshipToCurrentRegion>Within</relationshipToCurrentRegion>
    <travelTime>5 minutes</travelTime>
    <hiddenFromPlayer>true</hiddenFromPlayer>
    <discoveryDifficulty>hard</discoveryDifficulty>
  </stubRegion>
</regionExits></location></locations></region>`);
    } finally {
        Globals.config = previousConfig;
    }
    assert.equal(exits.length, 1);
    assert.equal(exits[0].hiddenFromPlayer, true);
    assert.equal(exits[0].discoveryDifficulty, 'Hard');
});

test('location suggestions and connected-region stubs default omitted declarations to visible', () => {
    const suggestions = parseLocationExitSuggestions(`
<location><newExits><exit>
  <destinationType>location</destinationType><name>Old Vault</name><description>A low iron door.</description><travelTime>2 minutes</travelTime>
</exit></newExits></location>`, { required: true });
    assert.equal(suggestions[0].hiddenFromPlayer, false);
    assert.equal(suggestions[0].discoveryDifficulty, null);

    const parseRegionExitsResponse = extractServerFunction(
        'function parseRegionExitsResponse(xmlSnippet) {',
        '\nasync function renderRegionStubPrompt({',
        'parseRegionExitsResponse'
    );
    const exits = parseRegionExitsResponse(`
<region><locations><location><name>Old Courtyard</name><regionExits>
  <stubRegion type="connectedRegion">
    <regionName>Buried Cloister</regionName>
    <regionDescription>A sealed monastery beneath the hill.</regionDescription>
    <relativeLevel>1</relativeLevel>
    <relationshipToCurrentRegion>Within</relationshipToCurrentRegion>
    <travelTime>5 minutes</travelTime>
  </stubRegion>
</regionExits></location></locations></region>`);
    assert.equal(exits[0].hiddenFromPlayer, false);
    assert.equal(exits[0].discoveryDifficulty, null);
});

test('generation prompts and creation wiring preserve directed hidden exit metadata', () => {
    const prompt = fs.readFileSync(require.resolve('../prompts/_includes/region-generator.njk'), 'utf8');
    const serverSource = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    assert.match(prompt, /<stubRegion type="connectedRegion">[\s\S]*?<hiddenFromPlayer>/);
    assert.match(prompt, /<stubRegion type="connectedRegion">[\s\S]*?<discoveryDifficulty>/);
    assert.match(serverSource, /hiddenFromPlayer:\s*definition\.hiddenFromPlayer/);
    assert.match(serverSource, /discoveryDifficulty:\s*definition\.discoveryDifficulty/);
    assert.match(serverSource, /Generated connected-region exit[^`]+missing hidden-discovery fields/);
});
