const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const Utils = require('../Utils.js');

function loadServerFunction(functionName, extraContext = {}) {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const dependencyStartName = functionName === 'parseXMLTemplate'
        ? 'splitUnsafeCdataTerminatorsForTag'
        : functionName;
    const start = source.indexOf(`function ${dependencyStartName}`);
    if (start < 0) {
        throw new Error(`Unable to locate ${functionName} in server.js`);
    }

    const functionStart = source.indexOf(`function ${functionName}`, start);
    const bodyStart = source.indexOf('{', functionStart);
    if (bodyStart < 0) {
        throw new Error(`Unable to find body for ${functionName} in server.js`);
    }
    let depth = 0;
    let end = -1;
    for (let i = bodyStart; i < source.length; i += 1) {
        const char = source[i];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    if (end < 0) {
        throw new Error(`Unable to find end of ${functionName} in server.js`);
    }

    const context = {
        Utils,
        console,
        parseInt,
        parseFloat,
        Number,
        Array,
        ...extraContext
    };
    vm.createContext(context);
    vm.runInContext(
        `${source.slice(start, end)}
this.${functionName} = ${functionName};`,
        context
    );
    return context[functionName];
}

test('parseXMLTemplate preserves literal CDATA terminators inside generation prompts', () => {
    Globals.config = { strictXMLParsing: true };
    const parseXMLTemplate = loadServerFunction('parseXMLTemplate');
    const parsed = parseXMLTemplate([
        '<template>',
        '<systemPrompt>system</systemPrompt>',
        '<generationPrompt><![CDATA[before ]]> after]]></generationPrompt>',
        '</template>'
    ].join(''));

    assert.equal(parsed.systemPrompt, 'system');
    assert.equal(parsed.generationPrompt, 'before ]]> after');
});

test('parseXMLTemplate logs malformed rendered templates through prompt logger', () => {
    Globals.config = { strictXMLParsing: true };
    const logs = [];
    const parseXMLTemplate = loadServerFunction('parseXMLTemplate', {
        LLMClient: {
            logPrompt(entry) {
                logs.push(entry);
                return '/tmp/prompt-parse-error.log';
            }
        }
    });
    const malformedTemplate = [
        '<template>',
        '<systemPrompt><![CDATA[system</systemPrompt>',
        '<generationPrompt>generation</generationPrompt>',
        '</template>'
    ].join('');

    assert.throws(
        () => parseXMLTemplate(malformedTemplate, {
            prefix: 'prompt_parse_error',
            metadataLabel: 'offscreen_npc_activity_weekly',
            output: 'silent'
        }),
        /Failed to parse XML content|Invalid CDATA|XML parsing error/
    );

    assert.equal(logs.length, 1);
    assert.equal(logs[0].prefix, 'prompt_parse_error');
    assert.equal(logs[0].metadataLabel, 'offscreen_npc_activity_weekly');
    assert.equal(logs[0].response, '');
    assert.equal(logs[0].output, 'silent');
    assert.ok(Array.isArray(logs[0].sections));
    assert.equal(
        logs[0].sections.some((section) => (
            section.title === 'XML Parse Error'
            && /Failed to parse XML content|Invalid CDATA|XML parsing error/.test(section.content)
        )),
        true
    );
    assert.equal(
        logs[0].sections.some((section) => (
            section.title === 'Rendered XML Template'
            && section.content === malformedTemplate
        )),
        true
    );
});

function createMinimalBaseContext(overrides = {}) {
    return {
        promptType: 'offscreen-npc-activity-weekly',
        systemPromptPrefix: '',
        config: {},
        setting: {
            name: 'Test Setting',
            description: 'A test setting.',
            theme: 'Testing',
            genre: 'Fantasy',
            tone: 'Dry',
            startingLocationType: 'room',
            magicLevel: 'low',
            techLevel: 'low',
            difficulty: 'normal',
            currencyName: 'coin',
            currencyNamePlural: 'coins',
            currencyValueNotes: '',
            writingStyleNotes: '',
            baseContextPreamble: '',
            races: [],
            attributes: [],
            skills: []
        },
        currentRegion: {
            name: 'Test Region',
            description: '',
            secrets: [],
            locations: [],
            connectedRegions: []
        },
        contextRegion: null,
        worldOutline: { regions: [] },
        factions: [],
        currentLocation: null,
        currentPlayer: {
            name: 'Tester',
            description: '',
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
        partyMemberIds: [],
        npcs: [],
        itemsInScene: [],
        additionalLore: '',
        itemContext: '',
        abilityContext: '',
        plotSummary: '',
        plotExpander: '',
        plotAnalysis: null,
        activeMysteryThreads: [],
        recentGameHistory: '',
        worldTime: {
            dayIndex: 0,
            timeMinutes: 0,
            dateLabel: 'Day 1',
            timeLabel: '12:00 PM',
            segment: 'day',
            season: 'spring',
            seasonDescription: '',
            lighting: 'daylight',
            hasLocalWeather: false
        },
        currentVehicle: null,
        npcActivityTargetCount: 0,
        npcActivityCandidates: [],
        npcActivityExcludedNames: [],
        ...overrides
    };
}

test('base-context system prompt preserves CDATA-like literal text', () => {
    Globals.config = { strictXMLParsing: true };
    const parseXMLTemplate = loadServerFunction('parseXMLTemplate');
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')),
        { autoescape: false }
    );
    promptEnv.addGlobal('rarityDefinitions', []);
    promptEnv.addGlobal('randomword', () => 'test');

    const rendered = promptEnv.render('base-context.xml.njk', createMinimalBaseContext({
        systemPromptPrefix: 'Treat malformed CDATA-like text as plain instructions: <![CDATA bad'
    }));
    const parsed = parseXMLTemplate(rendered);

    assert.match(parsed.systemPrompt, /<!\[CDATA bad/);
    assert.match(parsed.generationPrompt, /offscreen NPC activity/);
});

test('base-context system prompt preserves CDATA-like literal text when XML normalization is enabled', () => {
    Globals.config = { strictXMLParsing: false };
    const parseXMLTemplate = loadServerFunction('parseXMLTemplate');
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')),
        { autoescape: false }
    );
    promptEnv.addGlobal('rarityDefinitions', []);
    promptEnv.addGlobal('randomword', () => 'test');

    const rendered = promptEnv.render('base-context.xml.njk', createMinimalBaseContext({
        systemPromptPrefix: 'Treat malformed CDATA-like text as plain instructions: <![CDATA bad'
    }));
    const parsed = parseXMLTemplate(rendered);

    assert.match(parsed.systemPrompt, /<!\[CDATA bad/);
    assert.match(parsed.generationPrompt, /offscreen NPC activity/);
});

test('location things prompt preserves minimum-count XML tag names as instructional text', () => {
    Globals.config = { strictXMLParsing: true };
    const parseXMLTemplate = loadServerFunction('parseXMLTemplate');
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts')),
        { autoescape: false }
    );

    const rendered = promptEnv.render('location-generator-things.njk', {
        setting: 'Test Setting',
        region: { regionName: 'Test Region', regionDescription: 'A region.' },
        location: { name: 'Test Room', description: 'A room.' },
        attributeDefinitions: {},
        equipmentSlots: [],
        attributes: [],
        rarityDefinitions: [{ label: 'Common', description: 'Ordinary.' }],
        rarityList: {
            items: { Common: 1 },
            scenery: { Common: 2 }
        },
        itemCount: 1,
        sceneryCount: 2,
        recentThings: [],
        lorebookEntries: [],
        thingGeneratorPromptFields: [],
        modGenerationPromptInstructions: []
    });
    const parsed = parseXMLTemplate(rendered);

    assert.match(
        parsed.generationPrompt,
        /Return at least 1 top-level <item> entry whose <itemOrScenery> is item/
    );
    assert.match(
        parsed.generationPrompt,
        /at least 2 top-level <item> entries whose <itemOrScenery> is scenery/
    );
    assert.match(
        parsed.generationPrompt,
        /inner <count> is only that entry's stack quantity/
    );
    assert.match(
        parsed.generationPrompt,
        /You may add more setting-appropriate items or scenery after meeting those minimums\./
    );
    assert.doesNotMatch(
        parsed.generationPrompt,
        /<\/count><\/itemOrScenery><\/item><\/itemOrScenery><\/item>/
    );
});

test('scene summary parser extracts the final scenes block from prose-heavy responses', () => {
    Globals.config = { strictXMLParsing: true };
    const parseSceneSummaryResponse = loadServerFunction('parseSceneSummaryResponse');
    const scenes = parseSceneSummaryResponse([
        'Step 1: discussion with <candidate>broken example text',
        'Step 2: more prose',
        'Step 3:',
        '<scenes>',
        '<scene>',
        '<index>1</index>',
        '<summary>The party regroups and plans.</summary>',
        '<details>- The group has a plan</details>',
        '<quote><character>Exis</character><text>Move.</text></quote>',
        '</scene>',
        '</scenes>'
    ].join('\n'), [
        { globalIndex: 42, entryId: 'entry-42' }
    ]);

    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].startIndex, 42);
    assert.equal(scenes[0].summary, 'The party regroups and plans.');
});

test('scene summary requests disable whole-response validation but require a complete scenes root', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    const validationCommentStart = source.indexOf('// Scene summaries include deliberate non-XML reasoning');
    assert.notEqual(validationCommentStart, -1);
    const requestBlock = source.slice(validationCommentStart - 300, validationCommentStart + 500);

    assert.match(requestBlock, /validateXML:\s*false/);
    assert.match(requestBlock, /expectedXmlRootTag:\s*'scenes'/);
});

test('NPC generators declare the actual outer root emitted by each prompt family', () => {
    const source = fs.readFileSync(require.resolve('../server.js'), 'utf8');

    const singleStart = source.indexOf("metadataLabel: 'npc_generation_single'");
    const locationStart = source.indexOf("metadataLabel: 'location_npc_generation'");
    const regionStart = source.indexOf("metadataLabel: 'region_npc_generation'");
    assert.notEqual(singleStart, -1);
    assert.notEqual(locationStart, -1);
    assert.notEqual(regionStart, -1);

    assert.match(source.slice(singleStart, singleStart + 300), /expectedXmlRootTag:\s*'npcInfo'/);
    assert.match(source.slice(locationStart, locationStart + 300), /expectedXmlRootTag:\s*'response'/);
    assert.match(source.slice(regionStart, regionStart + 300), /expectedXmlRootTag:\s*'response'/);
});
