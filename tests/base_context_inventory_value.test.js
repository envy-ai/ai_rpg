const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');
const Utils = require('../Utils.js');
const Globals = require('../Globals.js');

function createPromptEnv() {
    return nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
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
