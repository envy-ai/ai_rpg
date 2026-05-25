const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

function loadParseThingsXml({ warnings = [] } = {}) {
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
        console: {
            warn: (...args) => warnings.push(args.join(' ')),
            trace: () => {}
        },
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

test('thing XML parser reads containedItem seeds and promotes non-container contents', async () => {
    const warnings = [];
    const parseThingsXml = loadParseThingsXml({ warnings });
    const previousConfig = Globals.config;

    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parsed = await parseThingsXml(`
<items>
  <item>
    <name>Unmarked Supply Crate</name>
    <count>1</count>
    <description>A dented crate with a sealed lid.</description>
    <shortDescription>Dented sealed supply crate</shortDescription>
    <itemOrScenery>scenery</itemOrScenery>
    <type>crate</type>
    <isContainer>false</isContainer>
    <containerContents>
      <containedItem>
        <name>Signal Flares</name>
        <count>3 flares</count>
      </containedItem>
      <containedItem>
        <name>Folded Map</name>
      </containedItem>
    </containerContents>
  </item>
</items>`);

        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].name, 'Unmarked Supply Crate');
        assert.equal(parsed[0].isContainer, true);
        assert.deepEqual(JSON.parse(JSON.stringify(parsed[0].containerContents)), [
            { name: 'Signal Flares', count: 3 },
            { name: 'Folded Map', count: 1 }
        ]);
        assert.match(warnings.join('\n'), /container contents/i);
    } finally {
        Globals.config = previousConfig;
    }
});

test('thing XML parser treats omitted and empty containerContents as empty', async () => {
    const parseThingsXml = loadParseThingsXml();
    const previousConfig = Globals.config;

    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parsed = await parseThingsXml(`
<items>
  <item>
    <name>Empty Satchel</name>
    <description>An empty satchel.</description>
    <shortDescription>Empty canvas satchel</shortDescription>
    <itemOrScenery>item</itemOrScenery>
    <type>bag</type>
    <isContainer>true</isContainer>
    <containerContents></containerContents>
  </item>
  <item>
    <name>Plain Rock</name>
    <description>A plain rock.</description>
    <shortDescription>Plain grey rock</shortDescription>
    <itemOrScenery>item</itemOrScenery>
    <type>junk</type>
  </item>
</items>`);

        assert.equal(parsed.length, 2);
        assert.deepEqual(JSON.parse(JSON.stringify(parsed[0].containerContents)), []);
        assert.deepEqual(JSON.parse(JSON.stringify(parsed[1].containerContents)), []);
        assert.equal(parsed[1].isContainer, false);
    } finally {
        Globals.config = previousConfig;
    }
});

test('thing XML parser ignores empty container content sentinels and zero-count seeds', async () => {
    const parseThingsXml = loadParseThingsXml();
    const previousConfig = Globals.config;

    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parsed = await parseThingsXml(`
<items>
  <item>
    <name>Mostly Empty Pouch</name>
    <description>A pouch with a misleading manifest.</description>
    <shortDescription>Mostly empty pouch</shortDescription>
    <itemOrScenery>item</itemOrScenery>
    <type>pouch</type>
    <isContainer>true</isContainer>
    <containerContents>
      <containedItem>
        <name>empty</name>
      </containedItem>
      <containedItem>
        <name>N/A</name>
      </containedItem>
      <containedItem>
        <name>Signal Flares</name>
        <count>0</count>
      </containedItem>
      <containedItem>
        <name>Empty Vial</name>
        <count>1</count>
      </containedItem>
    </containerContents>
  </item>
</items>`);

        assert.equal(parsed.length, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(parsed[0].containerContents)), [
            { name: 'Empty Vial', count: 1 }
        ]);
    } finally {
        Globals.config = previousConfig;
    }
});

test('thing XML parser reads requiresCheckToOpen for containers', async () => {
    const parseThingsXml = loadParseThingsXml();
    const previousConfig = Globals.config;

    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parsed = await parseThingsXml(`
<items>
  <item>
    <name>Combination Safe</name>
    <description>A safe with a stiff dial.</description>
    <shortDescription>Dial-locked metal safe</shortDescription>
    <itemOrScenery>scenery</itemOrScenery>
    <type>safe</type>
    <isContainer>true</isContainer>
    <requiresCheckToOpen>true</requiresCheckToOpen>
    <containerContents></containerContents>
  </item>
</items>`);

        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].isContainer, true);
        assert.equal(parsed[0].requiresCheckToOpen, true);
    } finally {
        Globals.config = previousConfig;
    }
});
