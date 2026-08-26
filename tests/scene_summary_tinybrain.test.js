const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');

const {
    TinyBrainPromptExtension,
    TinyBrainPromptRunner
} = require('../TinyBrainPromptRunner.js');
const {
    configureTinyBrainPromptContext
} = require('../TinyBrainPromptFamilies.js');
const {
    parseSceneSummaryBoundaries,
    parseSceneSummaryEntry
} = require('../TinyBrainPromptParsers.js');
const {
    buildSceneSummaryResult
} = require('../TinyBrainResultBuilders.js');

function createPromptEnv() {
    const env = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

function parseTemplate(rendered) {
    const systemMatch = rendered.match(/<systemPrompt>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/systemPrompt>/);
    const generationMatch = rendered.match(/<generationPrompt>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/generationPrompt>/);
    if (!systemMatch || !generationMatch) {
        throw new Error('Scene-summary test prompt did not render both prompt fields.');
    }
    return {
        systemPrompt: systemMatch[1],
        generationPrompt: generationMatch[1]
    };
}

function boundaryXml(boundaries) {
    return '<sceneBoundaries>'
        + boundaries.map(({ index, reason }) => (
            `<boundary><index>${index}</index><reason>${reason}</reason></boundary>`
        )).join('')
        + '</sceneBoundaries>';
}

test('scene-summary TinyBrain parsers enforce boundaries and assigned scene ranges', () => {
    const boundaries = parseSceneSummaryBoundaries(boundaryXml([
        { index: 1, reason: 'The party enters the market.' },
        { index: 5, reason: 'A confrontation starts.' },
        { index: 9, reason: 'The newest scene begins.' }
    ]), 10);
    assert.deepEqual(boundaries.value.map(boundary => boundary.index), [1, 5, 9]);

    assert.throws(
        () => parseSceneSummaryBoundaries(boundaryXml([
            { index: 1, reason: 'First.' },
            { index: 1, reason: 'Duplicate.' }
        ]), 10),
        /strictly ascending/i
    );
    assert.throws(
        () => parseSceneSummaryBoundaries(boundaryXml([
            { index: 1, reason: 'First.' },
            { index: 11, reason: 'Outside.' }
        ]), 10),
        /outside entries 1-10/i
    );

    const scene = parseSceneSummaryEntry([
        '<scene>',
        '<index>1</index>',
        '<summary>The party bargains for passage and gains the ferryman\'s trust.</summary>',
        '<details>- Mira owes the ferryman one favor\n- The northern bridge remains closed</details>',
        '<quote><character>Mira</character><text>Then we have a bargain.</text></quote>',
        '</scene>'
    ].join(''), 1, 4).value;
    assert.equal(scene.localStartIndex, 1);
    assert.equal(scene.localEndIndex, 4);
    assert.deepEqual(scene.details, [
        'Mira owes the ferryman one favor',
        'The northern bridge remains closed'
    ]);
    assert.deepEqual(scene.quotes, [{
        character: 'Mira',
        text: 'Then we have a bargain.'
    }]);
    assert.throws(
        () => parseSceneSummaryEntry(
            '<scene><index>2</index><summary>Wrong range.</summary><details/></scene>',
            1,
            4
        ),
        /assigned start index 1/i
    );
});

test('scene-summary TinyBrain program stages boundaries and assembles accepted scenes locally', async () => {
    const promptEnv = createPromptEnv();
    const templateContext = {
        fullHistoryLines: Array.from({ length: 10 }, (_, index) => ({
            name: index % 2 === 0 ? 'Baato' : 'Storyteller',
            text: `Narrative entry ${index + 1}.`
        })),
        modSceneSummarizeContributions: [{
            modName: 'summary-mod',
            text: 'Keep the mod-specific consequence.'
        }]
    };
    const tinyBrain = configureTinyBrainPromptContext(templateContext, 'scene_summarize');
    const initialRenderedTemplate = promptEnv.render('scene-summarize.xml.njk', templateContext);
    const responses = [
        boundaryXml([
            { index: 1, reason: 'The market scene starts.' },
            { index: 5, reason: 'The bridge scene starts.' },
            { index: 9, reason: 'The newest scene starts.' }
        ]),
        boundaryXml([
            { index: 1, reason: 'The market scene starts.' },
            { index: 5, reason: 'The bridge scene starts.' },
            { index: 9, reason: 'The newest scene starts.' }
        ]),
        '<scene><index>1</index><summary>The party negotiates at the market.</summary>'
            + '<details>- Baato promises prompt payment</details></scene>',
        '<scene><index>5</index><summary>The party crosses the damaged bridge.</summary>'
            + '<details></details><quote><character>Baato</character><text>One step at a time.</text></quote></scene>'
    ];
    const seenCheckpoints = [];
    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        metadataLabel: 'scene_summarize',
        logPrefix: 'scene_summarize_tinybrain',
        resultBuilders: {
            scene_summary_result: buildSceneSummaryResult
        },
        logPrompt(options) {
            return options.filePath || '/test/logs/scene-summary-tinybrain.log';
        },
        async complete({ messages, checkpoint }) {
            seenCheckpoints.push({
                parserName: checkpoint.parserName,
                parserArgs: checkpoint.parserArgs,
                prompt: messages.at(-1).content
            });
            const aiResponse = responses.shift();
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    const result = await runner.run({
        initialRenderedTemplate,
        templateContext,
        renderState: tinyBrain.renderState,
        programTemplateName: tinyBrain.programTemplateName
    });

    assert.equal(responses.length, 0);
    assert.deepEqual(
        seenCheckpoints.map(checkpoint => checkpoint.parserName),
        [
            'scene_summary_boundaries',
            'scene_summary_boundaries',
            'scene_summary_entry',
            'scene_summary_entry'
        ]
    );
    assert.deepEqual(seenCheckpoints[2].parserArgs, [1, 4]);
    assert.deepEqual(seenCheckpoints[3].parserArgs, [5, 8]);
    assert.match(seenCheckpoints[2].prompt, /When writing this scene's durable details, also follow these enabled-mod instructions/);
    assert.match(seenCheckpoints[2].prompt, /Keep the mod-specific consequence\./);
    assert.match(result.aiResponse, /<index>1<\/index>/);
    assert.match(result.aiResponse, /<index>5<\/index>/);
    assert.match(result.aiResponse, /<index>9<\/index>/);
    assert.match(result.aiResponse, /Following scene boundary marker/);
    assert.equal((result.aiResponse.match(/<scene>/g) || []).length, 3);
});
