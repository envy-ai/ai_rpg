const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const Utils = require('../Utils.js');

function createPromptEnv() {
    return nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
}

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
        JSON,
        Number,
        Object,
        String,
        Utils,
        Globals,
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

function registerImplantField(registry) {
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        exposeToCreateTool: true,
        exposeToUpdateTool: true,
        exposeToGeneratorPrompt: true,
        exposeToXmlParser: true,
        clearThingSlotWhenPresent: true,
        xmlPrompt: {
            placeholder: 'N/A unless this item can be installed as an implant; otherwise use neural, dermal, ocular, skeletal, or arcane.'
        }
    });
}

test('item XML prompt renders registered generator fields with placeholders and seed values', () => {
    const registry = new ModExtensionRegistry();
    registerImplantField(registry);
    const promptEnv = createPromptEnv();
    const baseContext = {
        thingSeed: {},
        thingGeneratorPromptFields: registry.getEntityFields('thing', { exposeToGeneratorPrompt: true }),
        equipmentSlots: ['head', 'body'],
        rarityDefinitions: [{ label: 'Common' }],
        attributes: ['strength']
    };

    const emptySeed = promptEnv.render('_includes/item.njk', baseContext);
    assert.match(emptySeed, /<implantSlot><!--N\/A unless this item can be installed as an implant; otherwise use neural, dermal, ocular, skeletal, or arcane\.--><\/implantSlot>/);

    const seeded = promptEnv.render('_includes/item.njk', {
        ...baseContext,
        thingSeed: {
            implantSlot: 'neural'
        }
    });
    assert.match(seeded, /<implantSlot>neural<\/implantSlot>/);
});

test('thing XML parser maps registered item prompt fields onto first-class parsed properties', async () => {
    const registry = new ModExtensionRegistry();
    registerImplantField(registry);
    const previousRegistry = Globals.modExtensionRegistry;
    const previousConfig = Globals.config;
    Globals.modExtensionRegistry = registry;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parseThingsXml = loadParseThingsXml();
        const parsed = await parseThingsXml(`
<items>
  <item>
    <name>Mnemonic Lattice</name>
    <count>1</count>
    <description>A silver lattice of mnemonic fibers.</description>
    <shortDescription>Silver mnemonic neural lattice</shortDescription>
    <itemOrScenery>item</itemOrScenery>
    <type>implant</type>
    <slot>N/A</slot>
    <implantSlot>neural</implantSlot>
  </item>
</items>`);

        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].implantSlot, 'neural');
        assert.equal(parsed[0].slot, null);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
        Globals.config = previousConfig;
    }
});
