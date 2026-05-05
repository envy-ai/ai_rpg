const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

function createPromptEnv() {
    return nunjucks.configure(path.join(process.cwd(), 'prompts'), {
        autoescape: false,
        throwOnUndefined: true
    });
}

function buildRenderContext({ promptUsesCaching, omitGameHistory }) {
    return {
        config: {
            extra_system_instructions: '',
            prompt_uses_caching: promptUsesCaching
        },
        promptType: 'question',
        question: 'What happened?',
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
            currencyName: 'Gold',
            currencyNamePlural: 'Gold',
            currencyValueNotes: '',
            writingStyleNotes: '',
            races: [],
            attributes: [],
            skills: []
        },
        rarityDefinitions: [],
        gameHistory: 'Older story entry.',
        recentGameHistory: 'Recent story entry.',
        omitGameHistory,
        worldOutline: { regions: [] },
        factions: [],
        currentRegion: {
            name: '',
            description: '',
            secrets: [],
            locations: [],
            connectedRegions: []
        },
        currentLocation: null,
        currentPlayer: {
            name: 'Tester',
            description: 'A player.',
            class: 'Adventurer',
            race: 'Human',
            currency: 0,
            statusEffects: [],
            skills: [],
            abilities: [],
            inventory: [],
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

test('base-context omits olderStoryHistory when omitGameHistory is set and prompt_uses_caching is false', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: false,
        omitGameHistory: true
    }));

    assert.doesNotMatch(rendered, /<olderStoryHistory>/);
    assert.match(rendered, /<recentStoryHistory>Recent story entry\.<\/recentStoryHistory>/);
});

test('base-context keeps olderStoryHistory when prompt_uses_caching is true', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptUsesCaching: true,
        omitGameHistory: true
    }));

    assert.match(rendered, /<olderStoryHistory>Older story entry\.<\/olderStoryHistory>/);
});

test('base-context history assembly does not append an empty recent-story separator to older history', () => {
    const serverSource = fs.readFileSync(path.join(process.cwd(), 'server.js'), 'utf8');

    assert.doesNotMatch(serverSource, /Recent story \(verbatim, not summarized\)/);
});
