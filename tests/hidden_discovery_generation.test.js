const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');
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
        Globals,
        console,
        getDefaultRarityLabel: () => 'Common',
        ...context
    };
    vm.createContext(sandbox);
    vm.runInContext(`${source.slice(start, end)}\nthis.result = ${exportName};`, sandbox);
    return sandbox.result;
}

test('location Thing XML accepts canonical hidden pairs and requires the pair in hidden-capable generation', async () => {
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

    await assert.rejects(
        parseThingsXml(xml.replace(/\s*<discoveryDifficulty>[\s\S]*?<\/discoveryDifficulty>/, ''), {
            strictXml: true,
            expectedThingType: 'scenery',
            allowHiddenDiscovery: true
        }),
        /both <hiddenFromPlayer> and <discoveryDifficulty>/
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
        /exactly one <hiddenFromPlayer> and one <discoveryDifficulty>/
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

test('generation prompts and creation wiring preserve directed hidden exit metadata', () => {
    const prompt = fs.readFileSync(require.resolve('../prompts/_includes/region-generator.njk'), 'utf8');
    const serverSource = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    assert.match(prompt, /<stubRegion type="connectedRegion">[\s\S]*?<hiddenFromPlayer>/);
    assert.match(prompt, /<stubRegion type="connectedRegion">[\s\S]*?<discoveryDifficulty>/);
    assert.match(serverSource, /hiddenFromPlayer:\s*definition\.hiddenFromPlayer/);
    assert.match(serverSource, /discoveryDifficulty:\s*definition\.discoveryDifficulty/);
    assert.match(serverSource, /Generated connected-region exit[^`]+missing hidden-discovery fields/);
});
