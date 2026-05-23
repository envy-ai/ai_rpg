const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Globals = require('../Globals.js');
const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const ModLoader = require('../ModLoader.js');
const Player = require('../Player.js');
const SettingInfo = require('../SettingInfo.js');
const Thing = require('../Thing.js');
const Events = require('../Events.js');
const { createChatToolRuntime } = require('../chat_tool_calls.js');
const ActorAttachmentSystem = require('../modding/ActorAttachmentSystem.js');
const ActorActivatableSystem = require('../modding/ActorActivatableSystem.js');

Globals.config = {
    ...(Globals.config && typeof Globals.config === 'object' ? Globals.config : {}),
    baseHealthPerLevel: Number.isFinite(Globals.config?.baseHealthPerLevel)
        ? Globals.config.baseHealthPerLevel
        : 10,
    formulas: {
        ...((Globals.config && typeof Globals.config === 'object' && Globals.config.formulas && typeof Globals.config.formulas === 'object')
            ? Globals.config.formulas
            : {}),
        character_creation: {
            attribute_pool_formula: 'level * number_of_attributes',
            skill_pool_formula: 'level * number_of_skills',
            max_attribute: '20',
            max_skill: '20',
            ...((Globals.config?.formulas?.character_creation && typeof Globals.config.formulas.character_creation === 'object')
                ? Globals.config.formulas.character_creation
                : {})
        }
    }
};

function makeActor(name = 'Baato') {
    return new Player({
        id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-test`,
        name,
        level: 3,
        health: 24,
        attributes: {
            strength: 5,
            intelligence: 6
        }
    });
}

function makeThing(options = {}) {
    return new Thing({
        id: options.id,
        name: options.name || 'Test Thing',
        description: options.description || 'A test thing.',
        thingType: 'item',
        metadata: options.metadata || {},
        implantSlot: options.implantSlot,
        attributeBonuses: options.attributeBonuses || [],
        causeStatusEffectOnEquipper: options.causeStatusEffectOnEquipper || null
    });
}

test('ModExtensionRegistry rejects duplicate chat tools and exposes live filters', () => {
    const registry = new ModExtensionRegistry();
    const tool = {
        type: 'function',
        function: {
            name: 'equipImplant',
            description: 'Install an implant.',
            parameters: { type: 'object', properties: {} }
        }
    };

    registry.registerChatTool({
        modName: 'implants',
        definition: tool,
        executor: () => ({ ok: true }),
        allowedInRegularProse: true,
        allowedInGenericPrompt: false
    });

    assert.equal(registry.getChatToolRecord('equipImplant').modName, 'implants');
    assert.deepEqual(registry.getChatToolDefinitions({ regularProseOnly: true }), [tool]);
    assert.deepEqual(registry.getChatToolDefinitions({ genericPromptOnly: true }), []);
    assert.throws(
        () => registry.registerChatTool({
            modName: 'other',
            definition: tool,
            executor: () => ({ ok: true })
        }),
        /already registered/i
    );
});

test('ModExtensionRegistry maps XML tags to parser and handler records', () => {
    const registry = new ModExtensionRegistry();
    const parser = raw => JSON.parse(raw);
    const handler = () => ({ handled: true });

    registry.registerXmlEvent({
        modName: 'implants',
        tagName: 'implantEquipped',
        eventKey: 'implant_equipped',
        promptSchema: {
            name: 'implantEquipped',
            description: 'Install an inventory-backed implant on an actor.',
            xml: '<implantEquipped>...</implantEquipped>'
        },
        parser,
        handler
    });

    assert.equal(registry.getXmlEventByTagName('implantEquipped').eventKey, 'implant_equipped');
    assert.equal(registry.getXmlEventByTagName('implantequipped').eventKey, 'implant_equipped');
    assert.equal(registry.getXmlEventByKey('implant_equipped').tagName, 'implantEquipped');
    assert.deepEqual(registry.getXmlEventParsers(), { implant_equipped: parser });
    assert.deepEqual(registry.getXmlEventHandlers(), { implant_equipped: handler });
    assert.deepEqual(registry.getXmlEventPromptSchemas(), [{
        name: 'implantEquipped',
        description: 'Install an inventory-backed implant on an actor.',
        xml: '<implantEquipped>...</implantEquipped>'
    }]);
});

test('ModExtensionRegistry registers world setting tabs and groups fields by tab', () => {
    const registry = new ModExtensionRegistry();

    registry.registerSettingTab({
        modName: 'implants',
        id: 'implants',
        label: 'Implants',
        description: 'Configure implant terminology.',
        order: 20
    });
    registry.registerSettingField({
        modName: 'implants',
        namespace: 'implants',
        key: 'displayLabel',
        label: 'Display Label',
        type: 'string',
        defaultValue: 'implants',
        tabId: 'implants'
    });
    registry.registerSettingField({
        modName: 'legacy',
        namespace: 'legacy',
        key: 'flag',
        label: 'Legacy Flag',
        type: 'string',
        defaultValue: 'yes'
    });

    const tabs = registry.getSettingTabs();
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].id, 'implants');
    assert.equal(tabs[0].label, 'Implants');
    assert.equal(tabs[0].fields.length, 1);
    assert.equal(tabs[0].fields[0].namespace, 'implants');
    assert.equal(tabs[0].fields[0].key, 'displayLabel');

    assert.deepEqual(
        registry.getSettingFields({ includeTabbed: false }).map(field => `${field.namespace}.${field.key}`),
        ['legacy.flag']
    );

    assert.throws(
        () => registry.registerSettingTab({ modName: 'other', id: 'implants', label: 'Duplicate' }),
        /Setting tab "implants" is already registered/
    );
    assert.throws(
        () => registry.registerSettingField({
            modName: 'spells',
            namespace: 'spells',
            key: 'displayLabel',
            label: 'Display Label',
            type: 'string',
            defaultValue: 'spells',
            tabId: 'missing'
        }),
        /references unknown setting tab "missing"/
    );
});

test('ModExtensionRegistry registers first-class entity fields for live tool schemas', () => {
    const registry = new ModExtensionRegistry();

    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        description: 'Implant grouping slot.',
        exposeToCreateTool: true,
        exposeToUpdateTool: true,
        exposeToGeneratorPrompt: true
    });

    assert.equal(registry.getEntityField('thing', 'implantSlot').modName, 'implants');
    assert.equal(registry.getEntityField('thing', 'implantSlot').type, 'string');
    assert.deepEqual(
        registry.getEntityFields('thing', { exposeToCreateTool: true }).map(field => field.fieldName),
        ['implantSlot']
    );
    assert.deepEqual(
        registry.getEntityFields('thing', { exposeToUpdateTool: true }).map(field => field.fieldName),
        ['implantSlot']
    );

    assert.throws(
        () => registry.registerEntityField({
            modName: 'other',
            entityType: 'thing',
            fieldName: 'implantSlot'
        }),
        /Entity field "thing\.implantSlot" is already registered/
    );
});

test('Thing persists registered first-class mod fields at the top level', () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        exposeToCreateTool: true,
        exposeToUpdateTool: true
    });
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    try {
        const implant = makeThing({
            id: 'thing-first-class-implant',
            name: 'Mnemonic Lattice',
            implantSlot: 'neural'
        });

        assert.equal(implant.getExtensionField('implantSlot'), 'neural');
        assert.equal(implant.implantSlot, 'neural');
        assert.equal(implant.toJSON().implantSlot, 'neural');
        assert.equal(implant.toJSON().metadata?.implantSlot, undefined);

        implant.implantSlot = 'dermal';
        assert.equal(implant.getExtensionField('implantSlot'), 'dermal');

        const roundTripped = Thing.fromJSON(implant.toJSON());
        assert.equal(roundTripped.getExtensionField('implantSlot'), 'dermal');
        assert.equal(roundTripped.implantSlot, 'dermal');
        assert.equal(roundTripped.toJSON().implantSlot, 'dermal');
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('chat tool runtime executes registry tools through live lookup', async () => {
    const registry = new ModExtensionRegistry();
    registry.registerChatTool({
        modName: 'implants',
        definition: {
            type: 'function',
            function: {
                name: 'equipImplant',
                description: 'Install an implant.',
                parameters: { type: 'object', properties: {} }
            }
        },
        executor: async (args, context) => ({
            content: `installed ${args.itemName} for ${context.defaultActorName}`,
            metadata: { tool: 'equipImplant' }
        }),
        allowedInRegularProse: true,
        allowedInGenericPrompt: true
    });

    const runtime = createChatToolRuntime({
        getConfig: () => Globals.config,
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => null,
        createLocationFromEvent: () => null,
        createRegionStubFromEvent: () => null,
        generateItemsByNames: () => [],
        ensureExitConnection: () => null,
        findRegionByLocationId: () => null,
        LLMClient: { chat: async () => ({ choices: [] }) },
        Player,
        Thing,
        Location: {},
        Region: {},
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map(),
        getModExtensionRegistry: () => registry
    });

    const result = await runtime.executeChatToolCall({
        functionName: 'equipImplant',
        argumentsObject: { itemName: 'Mnemonic Lattice' }
    }, {
        defaultActorName: 'Baato'
    });

    assert.equal(result.content, 'installed Mnemonic Lattice for Baato');
});

test('XML event parser accepts registered mod event tags', () => {
    const registry = new ModExtensionRegistry();
    registry.registerXmlEvent({
        modName: 'implants',
        tagName: 'implantEquipped',
        eventKey: 'implant_equipped',
        promptSchema: {
            name: 'implantEquipped',
            description: 'Install an inventory-backed implant on an actor.',
            xml: '<implantEquipped>...</implantEquipped>'
        },
        parser: raw => JSON.parse(raw),
        handler: () => ({ handled: true })
    });
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    try {
        const parsed = Events._parseXmlEventCheckResponse(`
<events>
  <implantEquipped>
    <actorName>Baato</actorName>
    <itemName>Mnemonic Lattice</itemName>
    <implantSlot>neural</implantSlot>
  </implantEquipped>
</events>
`);
        assert.deepEqual(parsed.structured.parsed.implant_equipped, [{
            actorName: 'Baato',
            itemName: 'Mnemonic Lattice',
            implantSlot: 'neural'
        }]);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('bundled implant and spell mods register independent hook surfaces', () => {
    const registry = new ModExtensionRegistry();
    const scope = {
        currentPlayer: null,
        getActiveSettingSnapshot: () => null,
        registerSettingTab: options => registry.registerSettingTab({ ...options, modName: options.modName || 'test' }),
        registerSettingField: options => registry.registerSettingField({ ...options, modName: options.modName || 'test' }),
        registerEntityField: options => registry.registerEntityField({ ...options, modName: options.modName || 'test' }),
        registerChatTool: options => registry.registerChatTool({ ...options, modName: options.modName || 'test' }),
        registerXmlEvent: options => registry.registerXmlEvent({ ...options, modName: options.modName || 'test' }),
        registerStartupValidator: validator => registry.registerStartupValidator({ modName: 'test', validator }),
        registerInventorySyncContributor: contributor => registry.registerInventorySyncContributor({ modName: 'test', contributor }),
        registerAttributeModifierContributor: contributor => registry.registerAttributeModifierContributor({ modName: 'test', contributor }),
        registerStatusEffectContributor: contributor => registry.registerStatusEffectContributor({ modName: 'test', contributor }),
        registerActorStatusContributor: contributor => registry.registerActorStatusContributor({ modName: 'test', contributor }),
        registerBaseContextContributor: contributor => registry.registerBaseContextContributor({ modName: 'test', contributor })
    };

    require('../mods/implants/mod.js').register(scope);
    require('../mods/spells/mod.js').register(scope);

    assert.ok(registry.getChatToolRecord('equipImplant'));
    assert.ok(registry.getChatToolRecord('unequipImplant'));
    assert.ok(registry.getChatToolRecord('generateSpell'));
    assert.ok(registry.getChatToolRecord('castSpell'));
    assert.equal(registry.getXmlEventByTagName('implantEquipped').eventKey, 'implant_equipped');
    assert.equal(registry.getXmlEventByTagName('spellCast').eventKey, 'spell_cast');
    assert.deepEqual(
        registry.getXmlEventPromptSchemas().map(schema => schema.name),
        ['implantEquipped', 'implantUnequipped', 'spellLearned', 'spellCast']
    );
    assert.ok(registry.getXmlEventPromptSchemas().every(schema => schema.description && schema.xml));
    assert.ok(registry.getSettingField('implants', 'displayLabel'));
    assert.equal(registry.getEntityField('thing', 'implantSlot').fieldName, 'implantSlot');
    assert.ok(registry.getSettingField('spells', 'manaCostFormula'));
    assert.ok(registry.getSettingTabs().some(tab => tab.id === 'implants'));
    assert.ok(registry.getSettingTabs().some(tab => tab.id === 'spells'));
});

test('ModLoader provides config defaults during mod registration', () => {
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-mod-loader-'));
    const modDir = path.join(tempBaseDir, 'mods', 'config-reader');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'mod.js'), `
module.exports = {
  configSchema: {
    label: { default: 'configured label' }
  },
  register(scope) {
    if (scope.modConfig.label !== 'configured label') {
      throw new Error('registration-time modConfig was not populated');
    }
  }
};
`, 'utf8');

    try {
        const loader = new ModLoader(tempBaseDir, { config: {} });
        const result = loader.loadMods({
            nunjucks: null,
            addEvalFilter: null,
            app: { get() {}, post() {}, put() {}, delete() {}, patch() {} },
            modExtensionRegistry: new ModExtensionRegistry()
        });
        assert.deepEqual(result.failed, []);
        assert.deepEqual(result.loaded, ['config-reader']);
    } finally {
        fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
});

test('Player mod state persists and missing old-save state reads as empty', () => {
    const oldSaveActor = Player.fromJSON({
        id: 'old-save-no-mod-state',
        name: 'Old Save Actor',
        attributes: { strength: 5 },
        inventory: []
    });

    assert.deepEqual(oldSaveActor.getModState('implants'), {});

    oldSaveActor.setModState('implants', {
        slots: {
            neural: ['implant-a']
        }
    });

    const serialized = oldSaveActor.toJSON();
    assert.deepEqual(serialized.modState.implants.slots.neural, ['implant-a']);

    const roundTripped = Player.fromJSON(serialized);
    assert.deepEqual(roundTripped.getModState('implants').slots.neural, ['implant-a']);
});

test('SettingInfo mod settings persist by namespace', () => {
    const setting = new SettingInfo({
        id: 'setting-mod-state',
        name: 'Mod State Setting',
        modSettings: {
            implants: {
                displayLabel: 'tattoos'
            }
        }
    });

    assert.equal(setting.getModSetting('implants', 'displayLabel'), 'tattoos');
    setting.setModSetting('spells', 'manaCostFormula', 'baseCost * level');

    const serialized = setting.toJSON();
    assert.equal(serialized.modSettings.implants.displayLabel, 'tattoos');
    assert.equal(serialized.modSettings.spells.manaCostFormula, 'baseCost * level');

    const roundTripped = SettingInfo.fromJSON(serialized);
    assert.equal(roundTripped.getModSetting('spells', 'manaCostFormula'), 'baseCost * level');
});

test('ActorAttachmentSystem installs, removes, syncs, and rejects invalid implant state', () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string',
        exposeToCreateTool: true,
        exposeToUpdateTool: true
    });
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    const actor = makeActor('Implant Tester');
    try {
        const implant = makeThing({
            id: 'implant-neural-1',
            name: 'Mnemonic Lattice',
            implantSlot: 'neural',
            attributeBonuses: [{ attribute: 'intelligence', bonus: 2 }]
        });
        const otherImplant = makeThing({
            id: 'implant-neural-2',
            name: 'Reflex Mesh',
            implantSlot: 'neural'
        });
        actor.addInventoryItem(implant);
        actor.addInventoryItem(otherImplant);

        const system = new ActorAttachmentSystem({
            namespace: 'implants',
            displayLabel: 'implants',
            itemSlotFieldName: 'implantSlot'
        });

        const installed = system.install({ actor, itemName: 'Mnemonic Lattice' });
        assert.equal(installed.slot, 'neural');
        assert.deepEqual(actor.getModState('implants').slots.neural, ['implant-neural-1']);
        assert.equal(system.list(actor)[0].item.name, 'Mnemonic Lattice');
        assert.equal(system.getAttributeModifierContributions(actor, 'intelligence'), 2);

        system.install({ actor, itemName: 'Reflex Mesh', implantSlot: 'neural' });
        assert.deepEqual(actor.getModState('implants').slots.neural, ['implant-neural-1', 'implant-neural-2']);

        assert.throws(
            () => system.install({ actor, itemName: 'Mnemonic Lattice' }),
            /already installed/i
        );
        assert.throws(
            () => system.install({ actor, itemName: 'Reflex Mesh', implantSlot: 'dermal' }),
            /slot mismatch/i
        );
        assert.throws(
            () => system.install({ actor, itemName: 'Missing Item' }),
            /inventory/i
        );

        const removed = system.remove({ actor, itemName: 'Mnemonic Lattice' });
        assert.equal(removed.item.name, 'Mnemonic Lattice');
        assert.deepEqual(actor.getModState('implants').slots.neural, ['implant-neural-2']);

        actor.removeInventoryItem(otherImplant);
        system.syncWithInventory(actor);
        assert.deepEqual(actor.getModState('implants').slots.neural, []);
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('ActorAttachmentSystem rejects Thing.slot-only items so inventory equipment UI stays separate', () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'implants',
        entityType: 'thing',
        fieldName: 'implantSlot',
        type: 'string'
    });
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    const actor = makeActor('Slot Tester');
    try {
        const normalGear = makeThing({
            id: 'normal-gear-1',
            name: 'Iron Helm',
            metadata: {},
        });
        normalGear.slot = 'head';
        actor.addInventoryItem(normalGear);

        const system = new ActorAttachmentSystem({
            namespace: 'implants',
            displayLabel: 'implants',
            itemSlotFieldName: 'implantSlot'
        });

        assert.throws(
            () => system.install({ actor, itemName: 'Iron Helm' }),
            /implantSlot/i
        );
    } finally {
        Globals.modExtensionRegistry = previousRegistry;
    }
});

test('ActorActivatableSystem learns spells and spends mana from a formula without clamping', () => {
    const actor = makeActor('Spell Tester');
    actor.setNeedBarValue('mana', 50, { allowPlayerOnly: false });

    const system = new ActorActivatableSystem({
        namespace: 'spells',
        displayLabel: 'spells',
        resourceNeedBarId: 'mana',
        usageBaseCosts: { low: 3, medium: 7, high: 11 },
        costFormula: 'baseCost * level'
    });

    const learned = system.learn({
        actor,
        record: {
            id: 'spell-spark',
            name: 'Spark',
            description: 'A focused ignition spell.',
            level: 2,
            manaUsage: 'medium',
            effectSummary: 'Ignites a small object.'
        }
    });

    assert.equal(learned.record.name, 'Spark');
    assert.equal(system.getCost(learned.record), 14);

    const cast = system.activate({ actor, name: 'Spark' });
    assert.equal(cast.cost, 14);
    assert.equal(actor.getNeedBarValue('mana'), 36);

    assert.throws(
        () => system.activate({ actor, name: 'Missing Spell' }),
        /unknown spell/i
    );
});
