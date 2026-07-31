const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ModExtensionRegistry = require('../ModExtensionRegistry.js');
const ModLoader = require('../ModLoader.js');
const { getChatToolDefinitions } = require('../chat_tool_calls.js');

function createModulesScope(registry, options = {}) {
    const loader = new ModLoader(path.join(__dirname, '..'), { config: { mods: { modules: { enabled: true } } } });
    const scopeBase = {
        modExtensionRegistry: registry,
        things: options.things || new Map(),
        getCurrentPlayer: () => null,
        getActiveSettingSnapshot: () => ({
            modSettings: {
                modules: {
                    displayLabel: 'Modules',
                    itemLabel: 'Module',
                    slotTypes: [
                        { id: 'core', label: 'Core', description: 'Main module socket.' },
                        { id: 'edge', label: 'Edge', description: 'Secondary socket.' }
                    ]
                }
            }
        }),
        findActorByName: () => null
    };
    return loader.createModScope(
        'modules',
        path.join(__dirname, '..', 'mods', 'modules'),
        scopeBase,
        { mod: {}, modConfig: {} }
    );
}

function item(overrides = {}) {
    return {
        id: overrides.id || `item_${Math.random().toString(36).slice(2)}`,
        name: overrides.name || 'Item',
        thingType: 'item',
        slot: null,
        count: 1,
        moduleSlots: [],
        installedModuleIds: [],
        moduleType: null,
        moduleInstalledOnItemId: null,
        metadata: {},
        ...overrides
    };
}

function actorWith(items) {
    return {
        id: 'actor_1',
        name: 'Tester',
        inventory: items,
        getInventoryItems() {
            return this.inventory;
        },
        hasInventoryItem(id) {
            return this.inventory.some(entry => entry?.id === id);
        },
        addInventoryItem(thing) {
            if (!thing?.id || this.hasInventoryItem(thing.id)) {
                return false;
            }
            this.inventory.push(thing);
            thing.metadata = { ...(thing.metadata || {}), ownerId: this.id };
            delete thing.metadata.locationId;
            return true;
        },
        removeInventoryItem(idOrThing) {
            const id = typeof idOrThing === 'string' ? idOrThing : idOrThing?.id;
            const before = this.inventory.length;
            this.inventory = this.inventory.filter(entry => entry?.id !== id);
            return this.inventory.length !== before;
        },
        withHealthRatioPreserved(mutator) {
            mutator();
        }
    };
}

function locationWith(things, allThings = things) {
    return {
        id: 'loc_1',
        name: 'Workshop Floor',
        thingIds: things.map(thing => thing.id),
        get things() {
            return this.thingIds.map(id => allThings.find(thing => thing.id === id)).filter(Boolean);
        },
        addThingId(id) {
            if (!this.thingIds.includes(id)) {
                this.thingIds.push(id);
            }
            const thing = allThings.find(entry => entry.id === id);
            if (thing) {
                thing.metadata = { ...(thing.metadata || {}), locationId: this.id };
                delete thing.metadata.ownerId;
            }
            return true;
        },
        removeThingId(id) {
            const before = this.thingIds.length;
            this.thingIds = this.thingIds.filter(existing => existing !== id);
            const thing = allThings.find(entry => entry.id === id);
            if (thing?.metadata?.locationId === this.id) {
                delete thing.metadata.locationId;
            }
            return this.thingIds.length !== before;
        }
    };
}

test('bundled modules mod registers settings, Thing fields, badges, actions, tools, and contributors', () => {
    const registry = new ModExtensionRegistry();
    const modulesMod = require('../mods/modules/mod.js');

    modulesMod.register(createModulesScope(registry));

    const tab = registry.getSettingTabs().find(entry => entry.id === 'modules');
    assert.ok(tab, 'modules settings tab should be registered');
    assert.deepEqual(
        tab.fields.map(field => field.key),
        ['applyPreset', 'displayLabel', 'itemLabel', 'slotTypes']
    );
    assert.equal(tab.fields.find(field => field.key === 'slotTypes')?.type, 'array');

    const fields = registry.getEntityFields('thing');
    assert.deepEqual(
        fields.map(field => field.fieldName).sort(),
        ['installedModuleIds', 'moduleInstalledOnItemId', 'moduleSlots', 'moduleType']
    );
    assert.ok(fields.every(field => field.exposeToCreateTool));
    assert.ok(fields.every(field => field.exposeToUpdateTool));
    assert.ok(fields.every(field => field.exposeToXmlParser));
    const installedModuleIdsField = fields.find(field => field.fieldName === 'installedModuleIds');
    assert.equal(typeof installedModuleIdsField?.validateValue, 'function');
    assert.throws(
        () => installedModuleIdsField.validateValue([1201], { entity: { name: 'Broken Visor' } }),
        /installedModuleIds\[0\].*non-empty string/i
    );

    assert.ok(registry.getThingImageBadges().some(badge => badge.fullId === 'modules:module-compatible'));
    assert.ok(registry.getThingImageBadges().some(badge => badge.fullId === 'modules:module-type'));
    const modularBadge = registry.getThingImageBadges().find(badge => badge.fullId === 'modules:module-compatible');
    const moduleBadge = registry.getThingImageBadges().find(badge => badge.fullId === 'modules:module-type');
    assert.equal(modularBadge?.position, 'top-left');
    assert.match(modularBadge?.iconUrl || modularBadge?.imageUrl || '', /\/mods\/modules\/assets\/modular\.svg$/);
    assert.equal(moduleBadge?.position, 'top-left');
    assert.match(moduleBadge?.iconUrl || moduleBadge?.imageUrl || '', /\/mods\/modules\/assets\/module\.svg$/);

    assert.deepEqual(
        registry.getThingContextActions().map(action => action.fullId).sort(),
        ['modules:install-module', 'modules:remove-module']
    );
    assert.ok(
        registry.getThingContextActions()
            .find(action => action.fullId === 'modules:install-module')
            ?.contexts.includes('location')
    );
    assert.equal(
        registry.getThingContextActions().find(action => action.fullId === 'modules:remove-module')?.fieldName,
        'installedModuleIds'
    );

    const toolNames = registry.getChatToolDefinitions().map(tool => tool.function.name);
    assert.ok(toolNames.includes('installModule'));
    assert.ok(toolNames.includes('removeModule'));
    assert.equal(registry.getXmlEventByTagName('moduleInstalled')?.eventKey, 'module_installed');
    assert.equal(registry.getXmlEventByTagName('moduleRemoved')?.eventKey, 'module_removed');
    assert.equal(registry.getAttributeModifierContributors().length, 1);
    assert.equal(registry.getStatusEffectContributors().length, 1);
    assert.equal(registry.getInventorySyncContributors().length, 1);
    assert.equal(registry.getActorStatusContributors().length, 1);
    assert.equal(registry.getBaseContextContributors().length, 1);
    assert.equal(registry.getThingTargetStatusEffectContributors().length, 1);
    assert.equal(registry.collectGenerationPromptInstructions('item', {}).length, 0);
});

test('modules mod adds item generation guidance when module items lag modular items', () => {
    const registry = new ModExtensionRegistry();
    const modulesMod = require('../mods/modules/mod.js');
    const things = new Map([
        ['sword_1', item({ id: 'sword_1', name: 'Socketed Sword', moduleSlots: [{ type: 'core' }] })],
        ['armor_1', item({ id: 'armor_1', name: 'Socketed Armor', moduleSlots: [{ type: 'edge' }] })],
        ['core_1', item({ id: 'core_1', name: 'Core Crystal', moduleType: 'core' })],
        ['edge_1', item({ id: 'edge_1', name: 'Edge Crystal', moduleType: 'edge' })],
        ['edge_2', item({ id: 'edge_2', name: 'Second Edge Crystal', moduleType: 'edge' })]
    ]);

    modulesMod.register(createModulesScope(registry, { things }));

    const [instruction] = registry.collectGenerationPromptInstructions('item', {});
    assert.equal(
        instruction.text,
        'There are currently 2 modular items and only 3 modules. There should be at least 4 modules. If generating items, make at least one of them a module to help close that gap.'
    );

    things.set('core_2', item({ id: 'core_2', name: 'Second Core Crystal', moduleType: 'core' }));
    assert.deepEqual(registry.collectGenerationPromptInstructions('item', {}), []);
});

test('modules createThing schema describes module slot object shape', () => {
    const registry = new ModExtensionRegistry();
    const modulesMod = require('../mods/modules/mod.js');

    modulesMod.register(createModulesScope(registry));

    const createThing = getChatToolDefinitions({
        modExtensionRegistry: registry,
        getActiveSettingSnapshot: () => ({
            modSettings: {
                modules: {
                    slotTypes: [{ id: 'module', label: 'Module', description: 'General-purpose module slot.' }]
                }
            }
        })
    }).find(entry => entry?.function?.name === 'createThing')?.function || null;

    const moduleSlotsSchema = createThing?.parameters?.properties?.moduleSlots;
    assert.equal(moduleSlotsSchema?.type, 'array');
    assert.equal(moduleSlotsSchema?.items?.type, 'object');
    assert.deepEqual(moduleSlotsSchema?.items?.required, ['type']);
    assert.equal(moduleSlotsSchema?.items?.additionalProperties, false);
    assert.equal(moduleSlotsSchema?.items?.properties?.type?.type, 'string');
    assert.equal(moduleSlotsSchema?.items?.properties?.label, undefined);
});

test('module presets include comfortable terminology options', () => {
    const modulesMod = require('../mods/modules/mod.js');
    const presets = modulesMod.loadPresetDefinitions();
    const presetLabels = presets.map(preset => preset.itemLabel);

    assert.deepEqual(presetLabels, ['Module', 'Crystal', 'Mod', 'Materia']);
    assert.ok(presets.every(preset => Array.isArray(preset.slotTypes) && preset.slotTypes.length > 0));
});

test('module action can install a loose location module into an inventory base item', () => {
    const registry = new ModExtensionRegistry();
    const modulesMod = require('../mods/modules/mod.js');

    modulesMod.register(createModulesScope(registry));

    const sword = item({
        id: 'sword_1',
        name: 'Socketed Sword',
        slot: 'weapon',
        moduleSlots: [{ type: 'core' }]
    });
    const crystal = item({
        id: 'crystal_1',
        name: 'Loose Core Crystal',
        moduleType: 'core',
        metadata: { locationId: 'loc_1' }
    });
    const actor = actorWith([sword]);
    const location = locationWith([crystal]);
    const things = new Map([
        [sword.id, sword],
        [crystal.id, crystal]
    ]);
    const action = registry.getThingContextActionRecord('modules:install-module');

    const result = action.handler({
        thing: sword,
        actor,
        currentPlayer: actor,
        requestBody: {
            context: 'player-inventory',
            baseItemId: sword.id,
            baseItemSource: 'inventory',
            moduleItemId: crystal.id,
            moduleItemSource: 'location',
            locationId: location.id,
            slotType: 'core'
        },
        things,
        locations: new Map([[location.id, location]])
    });

    assert.deepEqual(sword.installedModuleIds, [crystal.id]);
    assert.equal(crystal.moduleInstalledOnItemId, sword.id);
    assert.ok(actor.hasInventoryItem(crystal.id));
    assert.equal(location.thingIds.includes(crystal.id), false);
    assert.equal(result.actor, actor);
    assert.equal(result.location, location);
});

test('module action installs one item from a loose location module stack', () => {
    const registry = new ModExtensionRegistry();
    const modulesMod = require('../mods/modules/mod.js');

    modulesMod.register(createModulesScope(registry));

    const sword = item({
        id: 'sword_1',
        name: 'Socketed Sword',
        slot: 'weapon',
        moduleSlots: [{ type: 'core' }]
    });
    const crystalStack = item({
        id: 'crystal_stack_1',
        name: 'Loose Core Crystal',
        moduleType: 'core',
        count: 3,
        metadata: { locationId: 'loc_1' }
    });
    const actor = actorWith([sword]);
    const allThings = [sword, crystalStack];
    const location = locationWith([crystalStack], allThings);
    const things = new Map([
        [sword.id, sword],
        [crystalStack.id, crystalStack]
    ]);
    const action = registry.getThingContextActionRecord('modules:install-module');

    const result = action.handler({
        thing: sword,
        actor,
        currentPlayer: actor,
        requestBody: {
            context: 'player-inventory',
            baseItemId: sword.id,
            baseItemSource: 'inventory',
            moduleItemId: crystalStack.id,
            moduleItemSource: 'location',
            locationId: location.id,
            slotType: 'core'
        },
        things,
        locations: new Map([[location.id, location]])
    });

    const installedModuleId = sword.installedModuleIds[0];
    const installedModule = things.get(installedModuleId);
    assert.equal(crystalStack.count, 2);
    assert.notEqual(installedModule.id, crystalStack.id);
    assert.deepEqual(sword.installedModuleIds, [installedModule.id]);
    assert.equal(installedModule.moduleInstalledOnItemId, sword.id);
    assert.equal(installedModule.count, 1);
    assert.ok(actor.hasInventoryItem(installedModule.id));
    assert.ok(location.thingIds.includes(crystalStack.id));
    assert.equal(location.thingIds.includes(installedModule.id), false);
    assert.equal(things.get(installedModule.id), installedModule);
    assert.equal(result.metadata.moduleItemId, installedModule.id);
});

test('module action can install an inventory module into a loose location base item', () => {
    const registry = new ModExtensionRegistry();
    const modulesMod = require('../mods/modules/mod.js');

    modulesMod.register(createModulesScope(registry));

    const sword = item({
        id: 'sword_1',
        name: 'Socketed Sword',
        slot: 'weapon',
        moduleSlots: [{ type: 'core' }],
        metadata: { locationId: 'loc_1' }
    });
    const crystal = item({
        id: 'crystal_1',
        name: 'Inventory Core Crystal',
        moduleType: 'core'
    });
    const actor = actorWith([crystal]);
    const location = locationWith([sword], [sword, crystal]);
    const things = new Map([
        [sword.id, sword],
        [crystal.id, crystal]
    ]);
    const action = registry.getThingContextActionRecord('modules:install-module');

    const result = action.handler({
        thing: sword,
        actor,
        currentPlayer: actor,
        requestBody: {
            context: 'location',
            baseItemId: sword.id,
            baseItemSource: 'location',
            moduleItemId: crystal.id,
            moduleItemSource: 'inventory',
            locationId: location.id,
            slotType: 'core'
        },
        things,
        locations: new Map([[location.id, location]])
    });

    assert.deepEqual(sword.installedModuleIds, [crystal.id]);
    assert.equal(crystal.moduleInstalledOnItemId, sword.id);
    assert.equal(actor.hasInventoryItem(crystal.id), false);
    assert.ok(location.thingIds.includes(crystal.id));
    assert.equal(result.actor, actor);
    assert.equal(result.location, location);
});

test('module action can remove the only installed module from a loose location base item', () => {
    const registry = new ModExtensionRegistry();
    const modulesMod = require('../mods/modules/mod.js');

    modulesMod.register(createModulesScope(registry));

    const sword = item({
        id: 'sword_1',
        name: 'Socketed Sword',
        slot: 'weapon',
        moduleSlots: [{ type: 'core' }],
        installedModuleIds: ['crystal_1'],
        metadata: { locationId: 'loc_1' }
    });
    const crystal = item({
        id: 'crystal_1',
        name: 'Installed Core Crystal',
        moduleType: 'core',
        moduleInstalledOnItemId: sword.id,
        metadata: { locationId: 'loc_1' }
    });
    const actor = actorWith([]);
    const location = locationWith([sword, crystal]);
    const things = new Map([
        [sword.id, sword],
        [crystal.id, crystal]
    ]);
    const action = registry.getThingContextActionRecord('modules:remove-module');

    const result = action.handler({
        thing: sword,
        actor,
        currentPlayer: actor,
        requestBody: {
            context: 'location',
            baseItemId: sword.id,
            baseItemSource: 'location',
            locationId: location.id
        },
        things,
        locations: new Map([[location.id, location]])
    });

    assert.deepEqual(sword.installedModuleIds, []);
    assert.equal(crystal.moduleInstalledOnItemId, null);
    assert.equal(actor.hasInventoryItem(crystal.id), false);
    assert.ok(location.thingIds.includes(crystal.id));
    assert.equal(result.actor, actor);
    assert.equal(result.location, location);
});

test('modules mod contributes installed-module XML for full base-context item output', () => {
    const registry = new ModExtensionRegistry();
    const modulesMod = require('../mods/modules/mod.js');
    modulesMod.register(createModulesScope(registry));

    const moduleItem = item({
        id: 'mod_core_1',
        name: 'Overclock Chip',
        moduleType: 'core',
        shortDescription: 'Boosts processing speed.'
    });
    const baseItem = item({ id: 'base_1', name: 'Cyberdeck', installedModuleIds: ['mod_core_1'] });
    const resolveThing = (id) => (id === 'mod_core_1' ? moduleItem : null);

    const fragments = registry.collectThingPromptContributions(baseItem, { resolveThing });
    assert.equal(fragments.length, 1, 'a base item with an installed module should contribute one fragment');
    const xml = fragments[0];
    assert.match(xml, /<installedModules>/);
    assert.match(xml, /<name>Overclock Chip<\/name>/);
    assert.match(xml, /<slot>core<\/slot>/);
    assert.match(xml, /<description>Boosts processing speed\.<\/description>/);

    // Items without installed modules contribute nothing.
    assert.deepEqual(
        registry.collectThingPromptContributions(item({ id: 'plain_1', name: 'Rock' }), { resolveThing }),
        []
    );

    // Installed ids that cannot be resolved are skipped, not crashed on.
    assert.deepEqual(
        registry.collectThingPromptContributions(
            item({ id: 'base_2', name: 'Cyberdeck 2', installedModuleIds: ['missing'] }),
            { resolveThing }
        ),
        []
    );

    // Dynamic module text is XML-escaped.
    const spicyModule = item({ id: 'mod_x', name: 'A & B <chip>', moduleType: 'edge', shortDescription: '' });
    const spicyBase = item({ id: 'base_3', name: 'Deck 3', installedModuleIds: ['mod_x'] });
    const spicyXml = registry.collectThingPromptContributions(spicyBase, {
        resolveThing: (id) => (id === 'mod_x' ? spicyModule : null)
    })[0];
    assert.match(spicyXml, /<name>A &amp; B &lt;chip&gt;<\/name>/);
});
