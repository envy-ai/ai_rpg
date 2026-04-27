const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

function loadParseThingsXml() {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function parseThingsXml');
    const end = source.indexOf('\nasync function parseThingSeparateResponse', start);
    assert.notEqual(start, -1, 'Could not locate parseThingsXml');
    assert.notEqual(end, -1, 'Could not locate parseThingSeparateResponse');

    const context = {
        Array,
        Boolean,
        Error,
        Number,
        Object,
        String,
        Utils,
        console,
        getDefaultRarityLabel: () => 'Common'
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.parseThingsXml = parseThingsXml;`,
        context
    );
    return context.parseThingsXml;
}

test('thing XML parser treats omitted and empty status-effect tags as absent effects', async () => {
    const parseThingsXml = loadParseThingsXml();
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parsed = await parseThingsXml(`
<item>
  <name>Chromatic Echo Mantle of the Deep Narrows</name>
  <count>1</count>
  <description>Shoulder armor with redirected echo spores.</description>
  <shortDescription>Echo-spore shoulder armor</shortDescription>
  <itemOrScenery>item</itemOrScenery>
  <type>armor</type>
  <slot>shoulders</slot>
  <rarity>Rare</rarity>
  <relativeLevel>5</relativeLevel>
  <causeStatusEffectOnTarget>
  </causeStatusEffectOnTarget>
</item>`);

        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].causeStatusEffectOnTarget, null);
        assert.equal(parsed[0].causeStatusEffectOnEquipper, null);
    } finally {
        Globals.config = previousConfig;
    }
});

test('thing XML parser parses populated equipper status-effect tags', async () => {
    const parseThingsXml = loadParseThingsXml();
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parsed = await parseThingsXml(`
<item>
  <name>Chromatic Echo Mantle of the Deep Narrows</name>
  <count>1</count>
  <description>Shoulder armor with redirected echo spores.</description>
  <shortDescription>Echo-spore shoulder armor</shortDescription>
  <itemOrScenery>item</itemOrScenery>
  <type>armor</type>
  <slot>shoulders</slot>
  <rarity>Rare</rarity>
  <relativeLevel>5</relativeLevel>
  <causeStatusEffectOnEquipper>
    <name>Narrows Echo Disorientation</name>
    <description>Creates phantom auditory duplicates around the wearer.</description>
  </causeStatusEffectOnEquipper>
</item>`);

        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].causeStatusEffectOnTarget, null);
        assert.equal(parsed[0].causeStatusEffectOnEquipper.name, 'Narrows Echo Disorientation');
        assert.equal(
            parsed[0].causeStatusEffectOnEquipper.description,
            'Creates phantom auditory duplicates around the wearer.'
        );
    } finally {
        Globals.config = previousConfig;
    }
});

test('alterThingByPrompt treats parsed target/equipper effect scopes as authoritative', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const start = source.indexOf('async function alterThingByPrompt');
    const end = source.indexOf('\nfunction renderLocationNpcPrompt', start);
    assert.notEqual(start, -1, 'Could not locate alterThingByPrompt');
    assert.notEqual(end, -1, 'Could not locate function after alterThingByPrompt');

    const functionSource = source.slice(start, end);
    assert.match(functionSource, /causeStatusEffectOnTarget:\s*effectiveTargetStatusEffect/);
    assert.match(functionSource, /causeStatusEffectOnEquipper:\s*effectiveEquipperStatusEffect/);
    assert.match(functionSource, /await enrichAlteredThingStatusEffects\(\{/);
    assert.match(functionSource, /thing\.setCauseStatusEffects\(\{\s*target:\s*normalizedType === 'item' \? effectiveTargetStatusEffect : null,\s*equipper:\s*normalizedType === 'item' \? effectiveEquipperStatusEffect : null\s*\}\);/);
    assert.match(source, /StatusEffect\.generateFromDescriptions\(seeds,/);
    assert.doesNotMatch(functionSource, /thing\.causeStatusEffect\s*=\s*normalizedType === 'item'/);
    assert.doesNotMatch(functionSource, /previousTargetEffect/);
    assert.doesNotMatch(functionSource, /previousEquipperEffect/);
    assert.doesNotMatch(functionSource, /targetEffectWasSpecified/);
});
