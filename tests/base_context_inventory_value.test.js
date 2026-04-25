const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const nunjucks = require('nunjucks');

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
