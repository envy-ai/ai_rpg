const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nunjucks = require('nunjucks');

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

function createPromptEnv() {
    return nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
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
    assert.equal(registry.getXmlEventByTagName('implant_equipped').eventKey, 'implant_equipped');
    assert.deepEqual(registry.getXmlEventParsers(), { implant_equipped: parser });
    assert.deepEqual(registry.getXmlEventHandlers(), { implant_equipped: handler });
    assert.deepEqual(registry.getXmlEventPromptSchemas(), [{
        name: 'implantEquipped',
        description: 'Install an inventory-backed implant on an actor.',
        xml: '<implantEquipped>...</implantEquipped>'
    }]);
});

test('ModExtensionRegistry registers and numbers player-action prompt steps for supported stages', () => {
    const registry = new ModExtensionRegistry();

    registry.registerPlayerActionPromptStep({
        modName: 'implants',
        id: 'implant-consistency',
        step: 3,
        text: 'Check whether implant behavior stayed consistent with installed hardware.'
    });
    registry.registerPlayerActionPromptStep({
        modName: 'need-bar-lust',
        id: 'need-awareness',
        step: 1,
        text: 'Check whether urgent lust needs should affect selected NPC initiative.',
        tinyBrainText: 'List any urgent lust needs affecting NPC initiative, or respond N/A.'
    });
    registry.registerPlayerActionPromptStep({
        modName: 'spells',
        id: 'spell-costs',
        step: 3,
        text: 'Check whether any spellcasting respected configured costs.'
    });

    assert.deepEqual([
        ...registry.getPlayerActionPromptSteps({ startStep: '1g' }),
        ...registry.getPlayerActionPromptSteps({ startStep: '3m' })
    ], [
        {
            modName: 'need-bar-lust',
            id: 'need-awareness',
            fullId: 'need-bar-lust:need-awareness',
            step: 1,
            number: '1g',
            text: 'Check whether urgent lust needs should affect selected NPC initiative.',
            tinyBrainText: 'List any urgent lust needs affecting NPC initiative, or respond N/A.',
            order: 2
        },
        {
            modName: 'implants',
            id: 'implant-consistency',
            fullId: 'implants:implant-consistency',
            step: 3,
            number: '3m',
            text: 'Check whether implant behavior stayed consistent with installed hardware.',
            tinyBrainText: 'Check whether implant behavior stayed consistent with installed hardware.',
            order: 1
        },
        {
            modName: 'spells',
            id: 'spell-costs',
            fullId: 'spells:spell-costs',
            step: 3,
            number: '3n',
            text: 'Check whether any spellcasting respected configured costs.',
            tinyBrainText: 'Check whether any spellcasting respected configured costs.',
            order: 3
        }
    ]);
    assert.deepEqual(
        registry.getPlayerActionPromptSteps({ startStep: '1g' }).map(step => step.number),
        ['1g']
    );
    assert.deepEqual(
        registry.getPlayerActionPromptSteps({ startStep: '3m' }).map(step => step.number),
        ['3m', '3n']
    );
    assert.throws(
        () => registry.registerPlayerActionPromptStep({
            modName: 'implants',
            id: 'implant-consistency',
            step: 3,
            text: 'Duplicate.'
        }),
        /already registered/i
    );
    assert.throws(
        () => registry.registerPlayerActionPromptStep({
            modName: 'implants',
            id: 'unsupported-stage',
            step: 2,
            text: 'Unsupported.'
        }),
        /step must be either 1 or 3/i
    );
});

test('ModExtensionRegistry collects generation prompt instructions dynamically by generation type', () => {
    const registry = new ModExtensionRegistry();

    registry.registerGenerationPromptInstruction({
        modName: 'modules',
        id: 'module-balance',
        generationType: 'item',
        order: 20,
        textProvider: context => context.includeModuleGuidance
            ? `Make one ${context.moduleLabel}.`
            : ''
    });
    registry.registerGenerationPromptInstruction({
        modName: 'regions',
        id: 'regional-tone',
        generationTypes: ['location', 'region'],
        order: 10,
        text: 'Keep generated places consistent with the current region.'
    });

    assert.deepEqual(registry.collectGenerationPromptInstructions('item', {
        includeModuleGuidance: true,
        moduleLabel: 'Crystal'
    }), [{
        modName: 'modules',
        id: 'module-balance',
        fullId: 'modules:module-balance',
        generationTypes: ['item'],
        text: 'Make one Crystal.',
        order: 20
    }]);
    assert.deepEqual(registry.collectGenerationPromptInstructions('item', {
        includeModuleGuidance: false,
        moduleLabel: 'Crystal'
    }), []);
    assert.deepEqual(
        registry.collectGenerationPromptInstructions('region', {}).map(entry => entry.text),
        ['Keep generated places consistent with the current region.']
    );
    assert.throws(
        () => registry.registerGenerationPromptInstruction({
            modName: 'modules',
            id: 'module-balance',
            generationType: 'item',
            text: 'Duplicate.'
        }),
        /Generation prompt instruction "modules:module-balance" is already registered/
    );
});

test('generation prompt instruction include renders registered instruction text', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/generation-prompt-instructions.njk', {
        modGenerationPromptInstructions: [
            {
                fullId: 'modules:module-balance',
                text: 'Make at least one Module.'
            }
        ]
    });

    assert.match(rendered, /Additional mod generation instructions:/);
    assert.match(rendered, /- Make at least one Module\./);
});

test('player-action prompt renders mod-registered steps at stages 1 and 3', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('_includes/player-action.njk', {
        setting: { writingStyleNotes: '' },
        config: {
            prose_length: '2 paragraphs',
            prose_instructions: '',
            prose_prompt_suffix: '',
            repetition_buster: true,
            repetition_buster_mode: 'glm',
            use_legacy_prompt_checks: false
        },
        actionText: 'I inspect the relay.',
        characterName: 'The player',
        user: 'The player',
        isAttack: false,
        currentVehicle: {
            name: '',
            destination: '',
            vehicleInfo: {
                hasArrived: false,
                isUnderway: false
            }
        },
        currentLocationLastSeenNpcs: [],
        npcs: [],
        party: [],
        modPlayerActionPromptSteps(startStep) {
            if (startStep === '1g') {
                return [{
                    step: 1,
                    number: '1g',
                    text: 'Check whether urgent lust needs should affect selected NPC initiative.'
                }];
            }
            if (startStep === '3m') {
                return [
                    {
                        step: 3,
                        number: '3m',
                        text: 'Check whether implant behavior stayed consistent with installed hardware.'
                    },
                    {
                        step: 3,
                        number: '3n',
                        text: 'Check whether spellcasting respected configured costs.'
                    }
                ];
            }
            throw new Error(`Unexpected player-action prompt start step: ${startStep}`);
        }
    });

    assert.match(rendered, /3j\. Did you create any "mystery boxes"\?/);
    assert.match(rendered, /1g\. Check whether urgent lust needs should affect selected NPC initiative\./);
    assert.match(rendered, /3m\. Check whether implant behavior stayed consistent with installed hardware\./);
    assert.match(rendered, /3n\. Check whether spellcasting respected configured costs\./);
    assert.ok(
        rendered.indexOf('1f. Is the player currently under the effects') < rendered.indexOf('1g. Check whether urgent lust needs'),
        'stage 1 mod prompt steps should render after the built-in 1f step'
    );
    assert.ok(
        rendered.indexOf('3l. Is this an exterior location') < rendered.indexOf('3m. Check whether implant behavior'),
        'stage 3 mod prompt steps should render immediately after the built-in 3l step'
    );
});

test('standard player-action quest guidance renders only above the soft quest limit', () => {
    const promptEnv = createPromptEnv();
    const renderPrompt = activeQuestCount => promptEnv.render('_includes/player-action.njk', {
        setting: { writingStyleNotes: '' },
        config: {
            prose_length: '2 paragraphs',
            repetition_buster: true,
            soft_quest_limit: 1
        },
        actionText: 'I strike the training dummy.',
        characterName: 'The player',
        currentPlayer: {
            currentQuests: Array.from({ length: activeQuestCount }, (_, index) => ({ id: `quest-${index}` }))
        },
        isAttack: true,
        attacker: {
            name: 'The player',
            weapon: 'Practice Sword'
        },
        attackOutcome: {
            hit: true,
            target: {
                name: 'Training Dummy',
                defeated: false,
                healthLostPercent: 10,
                remainingHealthPercent: 90
            }
        }
    });
    const questGuidance = /active quest count exceeds the soft quest limit/;

    assert.match(renderPrompt(2), questGuidance);
    assert.doesNotMatch(renderPrompt(1), questGuidance);
});

test('nsfw-boost mod registers tiny-brain stage 1 player-action prompt steps', () => {
    const registry = new ModExtensionRegistry();
    const lustMod = require('../mods/nsfw-boost/mod.js');

    lustMod.register({
        modDir: path.join(process.cwd(), 'mods', 'nsfw-boost'),
        registerEntityField() {},
        registerBaseContextContributor() {},
        registerSceneSummarizeContributor(contributor) {
            return registry.registerSceneSummarizeContributor({
                modName: 'nsfw-boost',
                contributor
            });
        },
        registerPlayerActionPromptStep(options = {}) {
            return registry.registerPlayerActionPromptStep({
                ...options,
                modName: 'nsfw-boost'
            });
        }
    });

    const steps = registry.getPlayerActionPromptSteps({ startStep: '1g' });
    assert.deepEqual(
        steps.map(step => ({
            fullId: step.fullId,
            step: step.step,
            number: step.number
        })),
        [
            {
                fullId: 'nsfw-boost:lustAdvance',
                step: 1,
                number: '1g'
            },
            {
                fullId: 'nsfw-boost:takeTheLead',
                step: 1,
                number: '1h'
            },
            {
                fullId: 'nsfw-boost:descriptiveness',
                step: 1,
                number: '1i'
            }
        ]
    );
    assert.match(steps[0].text, /romantic and\/or sexual advance/);
    assert.match(steps[1].text, /active participant/);
    assert.match(steps[0].tinyBrainText, /respond N\/A/);
    assert.match(steps[1].tinyBrainText, /List who will take the lead/);
    assert.match(steps[2].tinyBrainText, /list the vivid anatomical details/);
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

test('ModExtensionRegistry preserves select/action mod setting field metadata', () => {
    const registry = new ModExtensionRegistry();

    registry.registerSettingTab({
        modName: 'implants',
        id: 'implants',
        label: 'Implants'
    });
    registry.registerSettingField({
        modName: 'implants',
        namespace: 'implants',
        key: 'applyPreset',
        label: 'Apply Preset',
        type: 'select',
        defaultValue: '',
        tabId: 'implants',
        persist: false,
        action: 'applyPreset',
        options: [
            {
                value: 'implants',
                label: 'Implants',
                description: 'Use implant terminology.',
                settings: {
                    implants: {
                        displayLabel: 'implants',
                        itemLabel: 'Implant',
                        badgeImagePath: 'microchip.svg'
                    }
                },
                confirmMessage: 'Apply the Implants preset?'
            }
        ]
    });

    const field = registry.getSettingField('implants', 'applyPreset');
    assert.equal(field.persist, false);
    assert.equal(field.action, 'applyPreset');
    assert.deepEqual(field.options, [
        {
            value: 'implants',
            label: 'Implants',
            description: 'Use implant terminology.',
            settings: {
                implants: {
                    displayLabel: 'implants',
                    itemLabel: 'Implant',
                    badgeImagePath: 'microchip.svg'
                }
            },
            confirmMessage: 'Apply the Implants preset?'
        }
    ]);
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
        exposeToGeneratorPrompt: true,
        exposeToXmlParser: true,
        exposeToEditModal: true,
        clearThingSlotWhenPresent: true,
        edit: {
            label: 'Implant slot',
            placeholder: 'neural',
            description: 'Required grouping slot for implant-compatible items.',
            order: 20
        },
        xmlPrompt: {
            placeholder: 'N/A unless this item can be installed as an implant.'
        }
    });

    assert.equal(registry.getEntityField('thing', 'implantSlot').modName, 'implants');
    assert.equal(registry.getEntityField('thing', 'implantSlot').type, 'string');
    assert.deepEqual(registry.getEntityField('thing', 'implantSlot').xmlPrompt, {
        tagName: 'implantSlot',
        placeholder: 'N/A unless this item can be installed as an implant.'
    });
    assert.equal(registry.getEntityField('thing', 'implantSlot').exposeToEditModal, true);
    assert.equal(registry.getEntityField('thing', 'implantSlot').clearThingSlotWhenPresent, true);
    assert.deepEqual(registry.getEntityField('thing', 'implantSlot').edit, {
        label: 'Implant slot',
        placeholder: 'neural',
        description: 'Required grouping slot for implant-compatible items.',
        inputType: 'text',
        order: 20
    });
    assert.deepEqual(
        registry.getEntityFields('thing', { exposeToCreateTool: true }).map(field => field.fieldName),
        ['implantSlot']
    );
    assert.deepEqual(
        registry.getEntityFields('thing', { exposeToUpdateTool: true }).map(field => field.fieldName),
        ['implantSlot']
    );
    assert.deepEqual(
        registry.getEntityFields('thing', { exposeToEditModal: true }).map(field => field.fieldName),
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

test('ModExtensionRegistry registers Thing context actions with client metadata and server handlers', () => {
    const registry = new ModExtensionRegistry();
    const handler = () => ({ ok: true });

    registry.registerThingContextAction({
        modName: 'implants',
        id: 'install-implant',
        label: 'Install implant',
        fieldName: 'implantSlot',
        contexts: ['player-inventory', 'npc-inventory'],
        order: 30,
        handler
    });

    assert.deepEqual(registry.getThingContextActions(), [{
        modName: 'implants',
        id: 'install-implant',
        fullId: 'implants:install-implant',
        label: 'Install implant',
        fieldName: 'implantSlot',
        fieldValue: undefined,
        contexts: ['player-inventory', 'npc-inventory'],
        order: 30
    }]);
    assert.equal(registry.getThingContextActionRecord('implants:install-implant').handler, handler);

    assert.throws(
        () => registry.registerThingContextAction({
            modName: 'implants',
            id: 'install-implant',
            label: 'Duplicate',
            fieldName: 'implantSlot',
            handler
        }),
        /Thing context action "implants:install-implant" is already registered/
    );
    assert.throws(
        () => registry.registerThingContextAction({
            modName: 'implants',
            id: 'bad-action',
            label: 'Bad',
            fieldName: 'implantSlot'
        }),
        /requires a handler function/
    );
});

test('ModExtensionRegistry registers Thing image badges for mod-owned asset overlays', () => {
    const registry = new ModExtensionRegistry();

    registry.registerThingImageBadge({
        modName: 'implants',
        id: 'implant-chip',
        fieldName: 'implantSlot',
        label: 'Implant-compatible',
        iconUrl: '/mods/implants/assets/microchip.svg',
        renderMode: 'mask',
        position: 'top-left',
        order: 20
    });
    registry.registerThingImageBadge({
        modName: 'portrait-overlays',
        id: 'painted-badge',
        fieldName: 'portraitBadge',
        label: 'Painted Badge',
        imageUrl: '/mods/portrait-overlays/assets/badge.webp',
        renderMode: 'image',
        position: 'top-right'
    });

    assert.deepEqual(registry.getThingImageBadges().map(badge => ({
        fullId: badge.fullId,
        fieldName: badge.fieldName,
        label: badge.label,
        iconUrl: badge.iconUrl,
        imageUrl: badge.imageUrl,
        renderMode: badge.renderMode,
        position: badge.position,
        order: badge.order
    })), [
        {
            fullId: 'implants:implant-chip',
            fieldName: 'implantSlot',
            label: 'Implant-compatible',
            iconUrl: '/mods/implants/assets/microchip.svg',
            imageUrl: '',
            renderMode: 'mask',
            position: 'top-left',
            order: 20
        },
        {
            fullId: 'portrait-overlays:painted-badge',
            fieldName: 'portraitBadge',
            label: 'Painted Badge',
            iconUrl: '',
            imageUrl: '/mods/portrait-overlays/assets/badge.webp',
            renderMode: 'image',
            position: 'top-right',
            order: 1000
        }
    ]);

    assert.throws(
        () => registry.registerThingImageBadge({
            modName: 'implants',
            id: 'implant-chip',
            fieldName: 'otherField',
            iconUrl: '/mods/implants/assets/other.svg'
        }),
        /Thing image badge "implants:implant-chip" is already registered/
    );
    assert.throws(
        () => registry.registerThingImageBadge({
            modName: 'implants',
            id: 'bad-url',
            fieldName: 'implantSlot',
            iconUrl: '/assets/microchip.svg'
        }),
        /must use a mod asset URL/
    );
    assert.throws(
        () => registry.registerThingImageBadge({
            modName: 'implants',
            id: 'two-icons',
            fieldName: 'implantSlot',
            iconUrl: '/mods/implants/assets/microchip.svg',
            imageUrl: '/mods/implants/assets/microchip.png'
        }),
        /requires exactly one of iconUrl or imageUrl/
    );
});

test('ModExtensionRegistry keeps setting-driven Thing image badge asset metadata', () => {
    const registry = new ModExtensionRegistry();

    registry.registerThingImageBadge({
        modName: 'implants',
        id: 'implant-chip',
        fieldName: 'implantSlot',
        label: 'Implant-compatible',
        iconUrl: '/mods/implants/assets/microchip.svg',
        renderMode: 'mask',
        position: 'top-left',
        assetPathSetting: {
            namespace: 'implants',
            key: 'badgeImagePath',
            defaultValue: 'microchip.svg'
        },
        labelSetting: {
            namespace: 'implants',
            key: 'itemLabel',
            defaultValue: 'Implant'
        }
    });

    const [badge] = registry.getThingImageBadges();
    assert.deepEqual(badge.assetPathSetting, {
        namespace: 'implants',
        key: 'badgeImagePath',
        defaultValue: 'microchip.svg'
    });
    assert.deepEqual(badge.labelSetting, {
        namespace: 'implants',
        key: 'itemLabel',
        defaultValue: 'Implant'
    });
});

test('ModExtensionRegistry requires prompt placeholders for generated Thing XML fields', () => {
    const registry = new ModExtensionRegistry();

    assert.throws(
        () => registry.registerEntityField({
            modName: 'implants',
            entityType: 'thing',
            fieldName: 'implantSlot',
            type: 'string',
            exposeToGeneratorPrompt: true,
            exposeToXmlParser: true
        }),
        /xmlPrompt\.placeholder/
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

test('Thing applies registered extension-field value validators before persistence', () => {
    const registry = new ModExtensionRegistry();
    registry.registerEntityField({
        modName: 'modules',
        entityType: 'thing',
        fieldName: 'installedModuleIds',
        type: 'array',
        defaultValue: [],
        validateValue(value, { entity }) {
            value.forEach((entry, index) => {
                if (typeof entry !== 'string' || !entry.trim()) {
                    throw new Error(`Item "${entity?.name || 'unknown'}" installedModuleIds[${index}] must be a non-empty string.`);
                }
            });
        }
    });
    const previousRegistry = Globals.modExtensionRegistry;
    Globals.modExtensionRegistry = registry;
    try {
        assert.throws(() => new Thing({
            id: 'thing-invalid-module-link',
            name: 'Broken Visor',
            description: 'A visor with malformed module state.',
            thingType: 'item',
            installedModuleIds: [1201]
        }), /installedModuleIds\[0\].*non-empty string/i);

        const visor = new Thing({
            id: 'thing-valid-module-link',
            name: 'Working Visor',
            description: 'A visor with valid module state.',
            thingType: 'item',
            installedModuleIds: ['thing-focus-crystal']
        });
        assert.deepEqual(visor.installedModuleIds, ['thing-focus-crystal']);
        assert.throws(
            () => visor.setExtensionField('installedModuleIds', ['']),
            /installedModuleIds\[0\].*non-empty string/i
        );
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
  <implant_equipped>
    <actorName>Baato</actorName>
    <itemName>Mnemonic Lattice</itemName>
    <implantSlot>neural</implantSlot>
  </implant_equipped>
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
        registerBaseContextContributor: contributor => registry.registerBaseContextContributor({ modName: 'test', contributor }),
        registerThingImageBadge: options => registry.registerThingImageBadge({ ...options, modName: options.modName || 'test' }),
        registerThingContextAction: options => registry.registerThingContextAction({ ...options, modName: options.modName || 'test' }),
        getModAssetUrl: assetPath => `/mods/test/assets/${String(assetPath || '').replace(/^\/+/, '')}`
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
    assert.ok(registry.getSettingField('implants', 'itemLabel'));
    assert.ok(registry.getSettingField('implants', 'badgeImagePath'));
    assert.equal(registry.getSettingField('implants', 'applyPreset').action, 'applyPreset');
    assert.equal(registry.getSettingField('implants', 'applyPreset').persist, false);
    assert.deepEqual(
        registry.getSettingField('implants', 'applyPreset').options.map(option => option.value),
        ['implants', 'tattoo']
    );
    assert.equal(registry.getEntityField('thing', 'implantSlot').fieldName, 'implantSlot');
    assert.equal(registry.getEntityField('thing', 'implantSlot').exposeToEditModal, true);
    assert.equal(registry.getEntityField('thing', 'implantSlot').clearThingSlotWhenPresent, true);
    assert.deepEqual(
        registry.getThingContextActions().map(action => ({
            fullId: action.fullId,
            label: action.label,
            fieldName: action.fieldName,
            contexts: action.contexts
        })),
        [
            {
                fullId: 'test:install-implant',
                label: 'Install implant',
                fieldName: 'implantSlot',
                contexts: ['player-inventory', 'npc-inventory']
            },
            {
                fullId: 'test:uninstall-implant',
                label: 'Uninstall implant',
                fieldName: 'implantSlot',
                contexts: ['player-inventory', 'npc-inventory', 'npc-equipment']
            }
        ]
    );
    assert.ok(registry.getSettingField('spells', 'manaCostFormula'));
    assert.ok(registry.getSettingTabs().some(tab => tab.id === 'implants'));
    assert.ok(registry.getSettingTabs().some(tab => tab.id === 'spells'));
    assert.deepEqual(
        registry.getThingImageBadges().map(badge => badge.fullId),
        ['test:implant-chip']
    );
    assert.deepEqual(registry.getThingImageBadges()[0].assetPathSetting, {
        namespace: 'implants',
        key: 'badgeImagePath',
        defaultValue: 'microchip.svg'
    });
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

test('ModLoader mod scope exposes mod asset URLs and prompt-step registration', () => {
    const registry = new ModExtensionRegistry();
    const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-rpg-mod-scope-'));
    const modDir = path.join(tempBaseDir, 'mods', 'implants');
    fs.mkdirSync(modDir, { recursive: true });

    try {
        const loader = new ModLoader(tempBaseDir, { config: {} });
        const scope = loader.createModScope('implants', modDir, {
            modExtensionRegistry: registry
        });

        assert.equal(scope.getModAssetUrl('microchip.svg'), '/mods/implants/assets/microchip.svg');
        scope.registerThingImageBadge({
            id: 'implant-chip',
            fieldName: 'implantSlot',
            iconUrl: scope.getModAssetUrl('microchip.svg'),
            label: 'Implant-compatible',
            position: 'top-left'
        });

        assert.deepEqual(
            registry.getThingImageBadges().map(badge => badge.fullId),
            ['implants:implant-chip']
        );

        scope.registerPlayerActionPromptStep({
            id: 'implant-consistency',
            step: 3,
            text: 'Check whether implant behavior stayed consistent with installed hardware.'
        });

        assert.deepEqual(
            registry.getPlayerActionPromptSteps({ startStep: '3m' }).map(step => ({
                fullId: step.fullId,
                step: step.step,
                number: step.number,
                text: step.text
            })),
            [{
                fullId: 'implants:implant-consistency',
                step: 3,
                number: '3m',
                text: 'Check whether implant behavior stayed consistent with installed hardware.'
            }]
        );
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

test('registerThingPromptContributor collects per-Thing prompt fragments and enforces string output', () => {
    const registry = new ModExtensionRegistry();
    registry.registerThingPromptContributor({
        modName: 'test',
        contributor: (thing) => (thing?.flagged ? '<extra>hi</extra>' : null)
    });

    // Contributors that return null/empty contribute nothing.
    assert.deepEqual(registry.collectThingPromptContributions({ id: 'a' }), []);
    assert.deepEqual(registry.collectThingPromptContributions({ id: 'b', flagged: true }), ['<extra>hi</extra>']);

    // Non-string return values fail loud.
    registry.registerThingPromptContributor({
        modName: 'bad',
        contributor: () => ({ not: 'a string' })
    });
    assert.throws(
        () => registry.collectThingPromptContributions({ id: 'c', flagged: true }),
        /must return a string or null/
    );

    // Clearing removes registered contributors.
    registry.clear();
    assert.deepEqual(registry.getThingPromptContributors(), []);
    assert.deepEqual(registry.collectThingPromptContributions({ id: 'd', flagged: true }), []);
});
