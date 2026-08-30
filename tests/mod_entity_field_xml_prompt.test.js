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

function registerStructuredModuleSlotsField(registry) {
    registry.registerEntityField({
        modName: 'modules',
        entityType: 'thing',
        fieldName: 'moduleSlots',
        type: 'array',
        exposeToGeneratorPrompt: true,
        exposeToXmlParser: true,
        xmlPrompt: {
            placeholder: 'Add one moduleSlot per configured slot.',
            collection: {
                itemTagName: 'moduleSlot',
                fields: [
                    { fieldName: 'type', tagName: 'type', type: 'string', required: true },
                    { fieldName: 'label', tagName: 'label', type: 'string' }
                ]
            }
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

test('item XML prompt renders structured module slots as nested XML', () => {
    const registry = new ModExtensionRegistry();
    registerStructuredModuleSlotsField(registry);
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/item.njk', {
        thingSeed: {
            moduleSlots: [{ type: 'mod', label: 'Receiver' }]
        },
        thingGeneratorPromptFields: registry.getEntityFields('thing', { exposeToGeneratorPrompt: true }),
        equipmentSlots: ['hand'],
        rarityDefinitions: [{ label: 'Common' }],
        attributes: ['strength']
    });

    assert.match(rendered, /<moduleSlots>[\s\S]*<moduleSlot>[\s\S]*<type>mod<\/type>[\s\S]*<label>Receiver<\/label>[\s\S]*<\/moduleSlot>[\s\S]*<\/moduleSlots>/);
    assert.doesNotMatch(rendered, /\{"type":"mod"/);
});

test('item XML prompt preserves seeded core structured fields', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/item.njk', {
        thingSeed: {
            shortDescription: 'locked chest of marked keys',
            count: 2,
            containerContents: [{ name: 'Brass Key', count: 1 }],
            attributeBonuses: [{ attribute: 'luck', bonus: 2 }],
            causeStatusEffectOnTarget: {
                name: 'Marked',
                description: 'The target glows.',
                duration: '5 minutes',
                attributes: [{ name: 'dexterity', modifier: -1 }],
                skills: [{ name: 'Stealth', modifier: -2 }],
                needBars: [{ name: 'energy', delta: -5 }]
            },
            causeStatusEffectOnEquipper: {
                name: 'Keyed In',
                description: 'The equipper senses nearby locks.',
                duration: 'permanent'
            },
            properties: 'The lock remembers failed keys.'
        },
        thingGeneratorPromptFields: [],
        equipmentSlots: ['hands'],
        rarityDefinitions: [{ label: 'Common' }],
        attributes: ['luck', 'dexterity']
    });

    assert.match(rendered, /<count>2<\/count>/);
    assert.match(rendered, /<name>Brass Key<\/name>\s*<count>1<\/count>/);
    assert.match(rendered, /<attribute>luck<\/attribute>\s*<bonus>2<\/bonus>/);
    assert.match(rendered, /<name>Marked<\/name>/);
    assert.match(rendered, /<attribute><name>dexterity<\/name><modifier>-1<\/modifier><\/attribute>/);
    assert.match(rendered, /<skill><name>Stealth<\/name><modifier>-2<\/modifier><\/skill>/);
    assert.match(rendered, /<needBar><name>energy<\/name><delta>-5<\/delta><\/needBar>/);
    assert.match(rendered, /<name>Keyed In<\/name>/);
    assert.match(rendered, /<duration>permanent<\/duration>/);
    assert.match(rendered, /<properties>The lock remembers failed keys\.<\/properties>/);
    assert.match(rendered, /<shortDescription>locked chest of marked keys<\/shortDescription>/);
    assert.doesNotThrow(() => Utils.parseXmlDocumentStrict(`<items>${rendered}</items>`, 'text/xml'));
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

test('base prompt context leaves player-action prompt numbering to Nunjucks', () => {
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

    assert.equal(Object.hasOwn(baseContext, 'modPlayerActionPromptSteps'), false);
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

test('thing XML parser accepts only the registered nested module-slot structure', async () => {
    const registry = new ModExtensionRegistry();
    registerStructuredModuleSlotsField(registry);
    const previousRegistry = Globals.modExtensionRegistry;
    const previousConfig = Globals.config;
    Globals.modExtensionRegistry = registry;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    try {
        const parseThingsXml = loadParseThingsXml();
        const parsed = await parseThingsXml(`
<items>
  <item>
    <name>Socketed Carbine</name>
    <description>A carbine with two receiver sockets.</description>
    <shortDescription>Two-socket receiver carbine</shortDescription>
    <itemOrScenery>item</itemOrScenery>
    <type>weapon</type>
    <slot>hand</slot>
    <moduleSlots>
      <moduleSlot><type>mod</type><label>Upper</label></moduleSlot>
      <moduleSlot><type>mod</type></moduleSlot>
    </moduleSlots>
  </item>
</items>`);
        assert.deepEqual(JSON.parse(JSON.stringify(parsed[0].moduleSlots)), [
            { type: 'mod', label: 'Upper' },
            { type: 'mod' }
        ]);

        const empty = await parseThingsXml(`
<items><item>
  <name>Plain Carbine</name>
  <description>A carbine without module sockets.</description>
  <itemOrScenery>item</itemOrScenery>
  <type>weapon</type><slot>hand</slot>
  <moduleSlots></moduleSlots>
</item></items>`);
        assert.deepEqual(JSON.parse(JSON.stringify(empty[0].moduleSlots)), []);

        await assert.rejects(parseThingsXml(`
<items><item>
  <name>Malformed Carbine</name>
  <description>A malformed carbine.</description>
  <itemOrScenery>item</itemOrScenery>
  <type>weapon</type><slot>hand</slot>
  <moduleSlots>[{"type":"mod"}]</moduleSlots>
</item></items>`), /must contain <moduleSlot> child elements/);

        await assert.rejects(parseThingsXml(`
<items><item>
  <name>Typeless Carbine</name>
  <description>A malformed carbine.</description>
  <itemOrScenery>item</itemOrScenery>
  <type>weapon</type><slot>hand</slot>
  <moduleSlots><moduleSlot><label>Upper</label></moduleSlot></moduleSlots>
</item></items>`), /requires .*<type>/);

        await assert.rejects(parseThingsXml(`
<items><item>
  <name>Overdescribed Carbine</name>
  <description>A malformed carbine.</description>
  <itemOrScenery>item</itemOrScenery>
  <type>weapon</type><slot>hand</slot>
  <moduleSlots><moduleSlot><type>mod</type><capacity>2</capacity></moduleSlot></moduleSlots>
</item></items>`), /unexpected <capacity>/);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
        Globals.config = previousConfig;
    }
});
