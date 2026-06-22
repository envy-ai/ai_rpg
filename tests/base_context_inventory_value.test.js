const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');
const Utils = require('../Utils.js');
const Globals = require('../Globals.js');

function createPromptEnv() {
    const env = nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
    env.addGlobal('randomword', () => 'test');
    return env;
}

function buildRenderContext() {
    return {
        config: {
            extra_system_instructions: '',
            prompt_uses_caching: false
        },
        promptType: 'question',
        question: 'What is here?',
        setting: {
            baseContextPreamble: '',
            name: 'Test Setting',
            description: 'A test setting.',
            theme: 'Test',
            genre: 'Fantasy',
            startingLocationType: 'Town',
            magicLevel: 'Low',
            techLevel: 'Low',
            tone: 'Neutral',
            difficulty: 'Normal',
            currencyName: 'gold',
            currencyNamePlural: 'gold',
            currencyValueNotes: '',
            writingStyleNotes: '',
            races: [],
            attributes: [],
            skills: []
        },
        rarityDefinitions: [],
        gameHistory: '',
        recentGameHistory: '',
        omitGameHistory: false,
        worldOutline: { regions: [] },
        factions: [],
        trackers: [],
        currentRegion: {
            name: 'Test Region',
            description: '',
            secrets: [],
            locations: [],
            connectedRegions: []
        },
        currentLocation: {
            name: 'Test Location',
            description: '',
            shortDescription: '',
            statusEffects: [],
            exits: [],
            items: [
                {
                    name: 'Fractured Sorcerous Orb',
                    rarity: 'Uncommon',
                    level: 2,
                    value: 24,
                    shortDescription: 'Fractured obsidian orb pulsing with unstable violet magical energy.',
                    description: 'Fractured obsidian orb pulsing with unstable violet magical energy.',
                    statusEffects: []
                }
            ],
            npcs: []
        },
        currentPlayer: {
            name: 'Tester',
            description: 'A player.',
            class: 'Adventurer',
            race: 'Human',
            currency: 0,
            statusEffects: [],
            skills: [],
            abilities: [],
            inventory: [
                {
                    name: 'Brass Compass',
                    rarity: 'Common',
                    level: 1,
                    value: 3,
                    shortDescription: 'Points toward the nearest open road.',
                    description: 'Points toward the nearest open road.',
                    statusEffects: []
                }
            ],
            needs: [],
            currentQuests: []
        },
        party: [],
        npcs: [],
        additionalLore: '',
        itemContext: '',
        abilityContext: '',
        plotSummary: '',
        plotExpander: '',
        worldTime: {
            dayIndex: 0,
            timeMinutes: 720,
            dateLabel: 'Day 1',
            timeLabel: '12:00 PM',
            segment: 'Noon',
            season: 'Spring',
            seasonDescription: '',
            holiday: null,
            lighting: 'Daylight',
            hasLocalWeather: false,
            weatherName: '',
            weatherDescription: '',
            lightLevelDescription: 'Bright'
        },
        currentVehicle: null,
        omitInventoryItems: false,
        omitAbilities: false,
        suppressQuestList: false,
        saveFileSaveVersion: 1,
        Globals: {
            saveFileSaveVersion: 1
        }
    };
}

test('base-context compact inventory item lines include value before description', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext());

    assert.match(
        rendered,
        /Fractured Sorcerous Orb: Uncommon level 2 \(24 gold\) - Fractured obsidian orb pulsing with unstable violet magical energy\./
    );
    assert.match(
        rendered,
        /Brass Compass: Common level 1 \(3 gold\) - Points toward the nearest open road\./
    );
});

test('base-context status effect XML includes effect names', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext();
    context.saveFileSaveVersion = 0;
    context.Globals.saveFileSaveVersion = 0;
    context.currentLocation.statusEffects = [{
        name: 'Bleeding Wounds',
        description: 'Open cuts continue to bleed.',
        duration: 45
    }];
    context.currentPlayer.statusEffects = [{
        name: 'Shaken',
        description: 'Hands tremble after the ambush.',
        duration: 10
    }];
    context.currentPlayer.inventory[0].statusEffects = [{
        name: 'True North',
        description: 'The needle refuses to point anywhere else.',
        duration: -1
    }];

    const rendered = promptEnv.render('base-context.xml.njk', context);

    assert.match(rendered, /<effect>\s*<name>Bleeding Wounds<\/name>\s*<description>Open cuts continue to bleed\.<\/description>/);
    assert.match(rendered, /<effect>\s*<name>Shaken<\/name>\s*<description>Hands tremble after the ambush\.<\/description>/);
    assert.match(rendered, /<effect>\s*<name>True North<\/name>\s*<description>The needle refuses to point anywhere else\.<\/description>/);
});

test('base-context inventory omits installed modules as standalone items', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext();
    context.currentPlayer.inventory = [
        {
            id: 'blade_1',
            name: 'Socketed Blade',
            rarity: 'Rare',
            level: 3,
            value: 50,
            shortDescription: 'A sword with a bright module installed.',
            description: 'A sword with a bright module installed.',
            installedModuleIds: ['ruby_core_1'],
            statusEffects: []
        },
        {
            id: 'ruby_core_1',
            name: 'Ruby Core',
            rarity: 'Rare',
            level: 3,
            value: 25,
            shortDescription: 'An installed module that should not be listed as loose inventory.',
            description: 'An installed module that should not be listed as loose inventory.',
            moduleType: 'core',
            moduleInstalledOnItemId: 'blade_1',
            statusEffects: []
        }
    ];

    const rendered = promptEnv.render('base-context.xml.njk', context);

    assert.match(rendered, /Socketed Blade/);
    assert.doesNotMatch(rendered, /Ruby Core/);
});

test('base-context generationPrompt CDATA preserves literal XML-shaped instructions', () => {
    const promptEnv = createPromptEnv();
    const context = {
        ...buildRenderContext(),
        promptType: 'events-xml',
        textToCheck: 'Nothing happens.',
        actionText: '',
        includePlayerActionBlock: false,
        characterName: 'Tester',
        experiencePointValues: [],
        needBarDefinitions: []
    };
    const rendered = promptEnv.render('base-context.xml.njk', context);
    const previousConfig = Globals.config;
    Globals.config = { ...(previousConfig || {}), strictXMLParsing: false };
    let generationPrompt;
    try {
        const doc = Utils.parseXmlDocument(rendered, 'text/xml');
        const generationPromptNode = doc.getElementsByTagName('generationPrompt')[0];
        generationPrompt = Utils.extractXmlNodeContent(generationPromptNode);
    } finally {
        Globals.config = previousConfig;
    }

    assert.match(rendered, /<generationPrompt>\s*<!\[CDATA\[/);
    assert.doesNotMatch(generationPrompt, /<!\[CDATA\[|\]\]>/);
    assert.match(generationPrompt, /<gameState>/);
    assert.match(generationPrompt, /<events>/);
});

test('base-context renders inventory-generator as an include prompt', () => {
    const promptEnv = createPromptEnv();
    const context = {
        ...buildRenderContext(),
        promptType: 'inventory-generator',
        character: {
            name: 'Tessa',
            role: 'guide',
            description: 'A cautious trail guide.',
            class: 'Ranger',
            level: 3,
            race: 'Elf'
        },
        attributeDefinitions: {
            Might: { description: 'Physical strength.' },
            Wits: { description: 'Quick thinking.' }
        },
        attributes: ['Might', 'Wits'],
        gearSlots: ['weapon', 'armor'],
        equipmentSlots: ['weapon', 'armor'],
        lorebookEntries: [{ content: 'Trail guides in this region carry storm charms.' }],
        thingSeed: {}
    };

    const rendered = promptEnv.render('base-context.xml.njk', context);

    assert.match(rendered, /<gameState>/);
    assert.match(rendered, /<name>Tessa<\/name>/);
    assert.match(rendered, /generate a set of 1 to 5 items/);
    assert.match(rendered, /Trail guides in this region carry storm charms\./);
    assert.doesNotMatch(rendered, /<generationPrompt><!\[CDATA\[[\s\S]*<template>/);
});

test('base-context current location NPC list omits party members', () => {
    const promptEnv = createPromptEnv();
    const partyMember = {
        id: 'party-mira',
        name: 'Mira',
        description: 'A party member.',
        class: 'Cleric',
        race: 'Human',
        personality: { type: '', traits: '', goals: [], notes: '', aiNotes: '' },
        dispositionsTowardsPlayer: [],
        selectedImportantMemories: [],
        inventory: [],
        skills: [],
        abilities: [],
        statusEffects: [],
        needs: ['Mira needs rest.']
    };
    const locationNpc = {
        id: 'npc-tessa',
        name: 'Tessa',
        description: 'A local guide.',
        class: 'Ranger',
        race: 'Elf',
        personality: { type: '', traits: '', goals: [], notes: '', aiNotes: '' },
        dispositionsTowardsPlayer: [],
        selectedImportantMemories: [],
        inventory: [],
        skills: [],
        abilities: [],
        statusEffects: [],
        needs: ['Tessa needs water.']
    };
    const context = {
        ...buildRenderContext(),
        npcs: [partyMember, locationNpc],
        party: [partyMember],
        partyMemberIds: [partyMember.id]
    };

    const rendered = promptEnv.render('base-context.xml.njk', context);
    const currentLocationNpcBlock = rendered.match(/<currentLocation>[\s\S]*?<npcs>([\s\S]*?)<\/npcs>/)?.[1] || '';

    assert.doesNotMatch(currentLocationNpcBlock, /<name>Mira<\/name>/);
    assert.match(currentLocationNpcBlock, /<name>Tessa<\/name>/);
});

test('base-context renders character relationship sections with comments', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext();
    context.npcs = [
        {
            id: 'npc-alice',
            name: 'Alice',
            description: 'A visible ally.',
            class: 'Guide',
            race: 'Human',
            resistances: '',
            vulnerabilities: '',
            hiddenFromPlayer: false,
            personality: { type: '', traits: '', goals: [], notes: '', aiNotes: '' },
            aiNotes: '',
            dispositionsTowardsPlayer: [],
            selectedImportantMemories: [],
            inventory: [],
            skills: [],
            abilities: [],
            statusEffects: [],
            needs: [],
            relationships: [
                { targetId: 'npc-bob', name: 'Bob', label: 'bitter rival' }
            ],
            reciprocalRelationships: [
                { sourceId: 'npc-carol', name: 'Carol', label: 'mentor' }
            ]
        }
    ];

    const rendered = promptEnv.render('base-context.xml.njk', context);

    assert.match(rendered, /<relationships>\s*<!-- This is how this character relates to other characters -->\s*Bob: bitter rival\s*<\/relationships>/);
    assert.match(rendered, /<reciprocalRelationships>\s*<!-- This is how other characters relate to this character -->\s*Carol: mentor\s*<\/reciprocalRelationships>/);
    assert.doesNotMatch(rendered, /recipricalRelationships/);
});

test('base-context omits empty character relationship sections', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext();
    context.npcs = [
        {
            id: 'npc-empty',
            name: 'Empty',
            description: 'A character with no relationship labels.',
            class: 'Guide',
            race: 'Human',
            resistances: '',
            vulnerabilities: '',
            hiddenFromPlayer: false,
            personality: { type: '', traits: '', goals: [], notes: '', aiNotes: '' },
            aiNotes: '',
            dispositionsTowardsPlayer: [],
            selectedImportantMemories: [],
            inventory: [],
            skills: [],
            abilities: [],
            statusEffects: [],
            needs: [],
            relationships: [],
            reciprocalRelationships: []
        }
    ];

    const rendered = promptEnv.render('base-context.xml.njk', context);
    const emptyNpcBlock = rendered.match(/<npc>\s*<id>npc-empty<\/id>[\s\S]*?<\/npc>/)?.[0] || '';

    assert.doesNotMatch(emptyNpcBlock, /<relationships>/);
    assert.doesNotMatch(emptyNpcBlock, /<reciprocalRelationships>/);
});

test('base-context includes character hidden field only when true', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext();
    context.npcs = [
        {
            id: 'npc-hidden',
            name: 'Shade',
            description: 'A hidden observer.',
            class: 'Scout',
            race: 'Human',
            resistances: '',
            vulnerabilities: '',
            hiddenFromPlayer: true,
            personality: { type: '', traits: '', goals: [], notes: '', aiNotes: '' },
            aiNotes: '',
            dispositionsTowardsPlayer: [],
            selectedImportantMemories: [],
            inventory: [],
            skills: [],
            abilities: []
        },
        {
            id: 'npc-visible',
            name: 'Ada',
            description: 'A visible ally.',
            class: 'Guide',
            race: 'Human',
            resistances: '',
            vulnerabilities: '',
            hiddenFromPlayer: false,
            personality: { type: '', traits: '', goals: [], notes: '', aiNotes: '' },
            aiNotes: '',
            dispositionsTowardsPlayer: [],
            selectedImportantMemories: [],
            inventory: [],
            skills: [],
            abilities: []
        }
    ];
    context.currentLocation.npcs = context.npcs;

    const rendered = promptEnv.render('base-context.xml.njk', context);

    assert.match(
        rendered,
        /<npc>\s*<id>npc-hidden<\/id>\s*<name>Shade<\/name>\s*<hidden>true<\/hidden>/
    );
    assert.doesNotMatch(
        rendered,
        /<npc>\s*<id>npc-visible<\/id>\s*<name>Ada<\/name>\s*<hidden>false<\/hidden>/
    );
});

test('base-context includes active mystery threads and contained boxes only', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext();
    context.activeMysteryThreads = [
        {
            id: 'mthread_1',
            name: 'Skyhawk Furnace Siphoning',
            status: 'active',
            summary: 'Drask is stealing vitality from the furnace.',
            constraints: ['Drask is the siphoner.'],
            mysteryBoxes: [
                {
                    id: 'mystery_1',
                    name: 'Siphon Saboteur Identity',
                    keys: ['Drask'],
                    text: 'Kellen Drask is the siphoner.'
                },
                {
                    id: 'mystery_2',
                    name: 'Resolved Furnace Password',
                    keys: ['furnace password'],
                    text: 'The password was spoken in the council chamber.',
                    resolved: true
                }
            ]
        }
    ];
    context.mysteryThreadMaxActive = 2;

    const rendered = promptEnv.render('base-context.xml.njk', context);

    assert.match(rendered, /<activeMysteryThreads max="2">/);
    assert.match(rendered, /<name>Skyhawk Furnace Siphoning<\/name>/);
    assert.match(rendered, /<summary>Drask is stealing vitality from the furnace\.<\/summary>/);
    assert.match(rendered, /<constraint>Drask is the siphoner\.<\/constraint>/);
    assert.match(rendered, /<name>Siphon Saboteur Identity<\/name>/);
    assert.match(rendered, /<text>Kellen Drask is the siphoner\.<\/text>/);
    assert.doesNotMatch(rendered, /Resolved Furnace Password/);
    assert.doesNotMatch(rendered, /The password was spoken in the council chamber\./);
});

test('base-context includes trackers as compact plain text lines', () => {
    const promptEnv = createPromptEnv();
    const context = buildRenderContext();
    context.trackers = [
        {
            id: 'tracker_1',
            name: 'Ritual Completion',
            type: 'countdown',
            value: '3 hours',
            hidden: true,
            lastUpdated: '12 minutes ago',
            guidance: 'Update when the cult ritual advances, stalls, or is interrupted.',
            note: 'Three hours remain because the first bell has already sounded.'
        },
        {
            id: 'tracker_2',
            name: 'Guard Alert',
            type: 'percentage',
            value: '45%',
            hidden: false,
            lastUpdated: 'just now',
            guidance: 'Update when the guards gain or lose evidence.',
            note: 'Alert is below half because the patrol found footprints but no intruder.'
        }
    ];

    const rendered = promptEnv.render('base-context.xml.njk', context);

    assert.match(rendered, /<trackers>/);
    assert.match(
        rendered,
        /tracker_1 \| Ritual Completion \| type=countdown \| value=3 hours \| hidden=true \| lastUpdated=12 minutes ago \| guidance=Update when the cult ritual advances, stalls, or is interrupted\. \| note=Three hours remain because the first bell has already sounded\./
    );
    assert.match(
        rendered,
        /tracker_2 \| Guard Alert \| type=percentage \| value=45% \| hidden=false \| lastUpdated=just now \| guidance=Update when the guards gain or lose evidence\. \| note=Alert is below half because the patrol found footprints but no intruder\./
    );
    assert.doesNotMatch(rendered, /<tracker id=/);
});
