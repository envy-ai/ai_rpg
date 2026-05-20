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

function buildRenderContext(overrides = {}) {
    return {
        config: {
            extra_system_instructions: '',
            prompt_uses_caching: false
        },
        promptType: 'question',
        question: 'What is happening?',
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
        gameHistory: '',
        recentGameHistory: '',
        omitGameHistory: false,
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
        plotAnalysis: {
            updatedAt: '2026-05-20T12:00:00.000Z',
            plotThreads: [
                {
                    description: 'Find the missing courier before the trail goes cold.',
                    isCurrentFocus: true
                },
                {
                    description: 'Track the smugglers working the river gate.',
                    isCurrentFocus: false
                }
            ],
            currentPlotComplications: [
                { description: 'Find the missing courier.' },
                { description: 'Get access to the locked customs ledger.' }
            ],
            raw: '<response><plotThreads></plotThreads><currentPlotComplications></currentPlotComplications></response>'
        },
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
        },
        ...overrides
    };
}

test('base-context includes stored plot analysis for ordinary prompt types', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext());

    assert.match(rendered, /<plotAnalysis updatedAt="2026-05-20T12:00:00\.000Z">/);
    assert.match(rendered, /<description>Find the missing courier before the trail goes cold\.<\/description>/);
    assert.match(rendered, /<isCurrentFocus>true<\/isCurrentFocus>/);
    assert.match(rendered, /<description>Get access to the locked customs ledger\.<\/description>/);
});

test('base-context omits stored plot analysis when it has no thread or complication content', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        plotAnalysis: {
            updatedAt: '2026-05-20T12:00:00.000Z',
            plotThreads: [],
            currentPlotComplications: [],
            raw: '<response><plotThreads></plotThreads><currentPlotComplications></currentPlotComplications></response>'
        }
    }));

    assert.doesNotMatch(rendered, /<plotAnalysis\b/);
    assert.doesNotMatch(rendered, /<rawOutput>/);
});

test('base-context omits previous plot analysis when rendering the plot-analysis prompt itself', () => {
    const promptEnv = createPromptEnv();
    const rendered = promptEnv.render('base-context.xml.njk', buildRenderContext({
        promptType: 'plot-analysis'
    }));

    assert.doesNotMatch(rendered, /<plotAnalysis updatedAt=/);
    assert.doesNotMatch(rendered, /Find the missing courier before the trail goes cold/);
});
