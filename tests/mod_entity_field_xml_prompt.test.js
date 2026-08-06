const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');

const Globals = require('../Globals.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const Utils = require('../Utils.js');
const {
    createPromptEnv: createBasePromptEnv,
    loadBuildBasePromptContext: loadBuildBasePromptContextBase
} = require('./helpers/baseContextFixtures.js');

function createPromptEnv() {
    return createBasePromptEnv({ randomWord: false });
}

function loadBuildBasePromptContext(registry) {
    return loadBuildBasePromptContextBase({
        registry,
        includeMysteryCleanup: true,
        playerAvailableSkills: new Map([['Cybernetics', {}]])
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

test('item XML prompt renders registered array seed values as JSON', () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'modules',
        entityType: 'thing',
        fieldName: 'moduleSlots',
        type: 'array',
        exposeToGeneratorPrompt: true,
        exposeToXmlParser: true,
        xmlPrompt: {
            placeholder: '[] unless this item has module slots.'
        }
    });
    const promptEnv = createPromptEnv();

    const rendered = promptEnv.render('_includes/item.njk', {
        thingSeed: {
            moduleSlots: [{ type: 'module', label: 'Top Rail' }]
        },
        thingGeneratorPromptFields: registry.getEntityFields('thing', { exposeToGeneratorPrompt: true }),
        equipmentSlots: ['hands'],
        rarityDefinitions: [{ label: 'Common' }],
        attributes: ['strength']
    });

    assert.match(rendered, /<moduleSlots>\[\{"type":"module","label":"Top Rail"\}\]<\/moduleSlots>/);
    assert.doesNotMatch(rendered, /\[object Object\]/);
});

test('base prompt context exposes registered generator fields to crafting item XML prompts', () => {
    const registry = new ModExtensionRegistry();
    registerImplantField(registry);
    const buildBasePromptContext = loadBuildBasePromptContext(registry);
    const promptEnv = createPromptEnv();
    const baseContext = buildBasePromptContext({
        locationOverride: {
            id: 'loc_1',
            name: 'Test Lab',
            description: 'A test workshop.',
            items: [],
            scenery: [],
            getDetails: () => ({
                name: 'Test Lab',
                description: 'A test workshop.',
                exits: {}
            })
        }
    });

    const rendered = promptEnv.render('_includes/plausibility-check-craft.njk', {
        ...baseContext,
        intendedItemName: 'Improvised Psionic Relay Implant',
        stationName: 'Modular Workbench',
        craftingItems: [],
        craftingNotes: '',
        craftTargetType: 'item'
    });

    assert.match(rendered, /<implantSlot><!--N\/A unless this item can be installed as an implant; otherwise use neural, dermal, ocular, skeletal, or arcane\.--><\/implantSlot>/);
});

test('base prompt context exposes registered player-action prompt steps', () => {
    const registry = new ModExtensionRegistry();
    registry.registerPlayerActionPromptStep({
        modName: 'implants',
        id: 'implant-consistency',
        step: 3,
        text: 'Check whether implant behavior stayed consistent with installed hardware.'
    });
    const buildBasePromptContext = loadBuildBasePromptContext(registry);
    const baseContext = buildBasePromptContext({
        locationOverride: {
            id: 'loc_1',
            name: 'Test Lab',
            description: 'A test workshop.',
            items: [],
            scenery: [],
            getDetails: () => ({
                name: 'Test Lab',
                description: 'A test workshop.',
                exits: {}
            })
        }
    });

    assert.deepEqual(baseContext.modPlayerActionPromptSteps, [{
        modName: 'implants',
        id: 'implant-consistency',
        fullId: 'implants:implant-consistency',
        step: 3,
        number: '3l',
        text: 'Check whether implant behavior stayed consistent with installed hardware.',
        tinyBrainText: 'Check whether implant behavior stayed consistent with installed hardware.',
        order: 1
    }]);
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

test('thing XML parser rejects nested XML emitted for a registered array field', async () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'modules',
        entityType: 'thing',
        fieldName: 'moduleSlots',
        type: 'array',
        exposeToGeneratorPrompt: true,
        exposeToXmlParser: true,
        xmlPrompt: {
            placeholder: '[] unless this item has module slots.'
        }
    });
    const previousRegistry = Globals.modExtensionRegistry;
    const previousConfig = Globals.config;
    Globals.modExtensionRegistry = registry;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parseThingsXml = loadParseThingsXml();
        await assert.rejects(
            parseThingsXml(`
<items>
  <item>
    <name>Gilded Harpy Feather Cloak</name>
    <description>A feathered cloak.</description>
    <shortDescription>Gilded harpy-feather cloak</shortDescription>
    <itemOrScenery>item</itemOrScenery>
    <type>armor</type>
    <moduleSlots><type>crystal</type></moduleSlots>
  </item>
</items>`),
            /<moduleSlots> must be a valid JSON array/
        );
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
        Globals.config = previousConfig;
    }
});
