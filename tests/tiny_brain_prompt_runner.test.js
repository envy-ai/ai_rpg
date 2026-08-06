const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');
const LLMClient = require('../LLMClient.js');
const {
    TinyBrainPromptExtension,
    TinyBrainPromptRunner,
    parseResponseOrNa,
    parseYesNo
} = require('../TinyBrainPromptRunner.js');

class MemoryLoader extends nunjucks.Loader {
    constructor(templates) {
        super();
        this.templates = templates;
    }

    getSource(name) {
        const src = this.templates[name];
        return typeof src === 'string'
            ? { src, path: name, noCache: true }
            : null;
    }
}

function createEnvironment(programTemplate) {
    const environment = new nunjucks.Environment(new MemoryLoader({
        'wrapper.xml.njk': [
            '<template>',
            '<systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
            '<generationPrompt><![CDATA[Fixed base context. ',
            '{{ __tinyBrainState.programStartMarker }}',
            '{% include "program.njk" %}',
            ']]></generationPrompt>',
            '</template>'
        ].join(''),
        'program.njk': programTemplate
    }), { autoescape: false });
    environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return environment;
}

function parseTemplate(rendered) {
    const systemMatch = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/);
    const generationMatch = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/);
    if (!systemMatch || !generationMatch) {
        throw new Error('Test wrapper did not render both prompt fields.');
    }
    return {
        systemPrompt: systemMatch[1],
        generationPrompt: generationMatch[1]
    };
}

test('tiny-brain runner keeps tool results and retries only the failed checkpoint or final step', async () => {
    const environment = createEnvironment([
        'Decide travel. ',
        "{% llmparse('travel_with_reason', 'expected parser argument') as travel %}",
        '{% if travel %}Travel branch YES.{% else %}Travel branch NO.{% endif %} ',
        'Analyze the scene now. {% llm_dummy_action %}',
        'Write final XML now.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const completionCalls = [];
    const logCalls = [];
    const parseFailures = [];
    const logFilePath = '/test/logs/tinybrain.log';

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 1,
        parsers: {
            travel_with_reason(response, parserArgument) {
                assert.equal(parserArgument, 'expected parser argument');
                assert.match(response, /yes/i);
                return { value: true };
            }
        },
        onParseFailure(failure) {
            parseFailures.push(failure);
        },
        finalParser(response) {
            assert.match(response, /<turnResult>/);
            return { value: true };
        },
        logPrompt(options) {
            logCalls.push(options);
            return options.filePath || logFilePath;
        },
        async complete({
            messages,
            checkpoint,
            attempt,
            isFinal,
            logFilePath: activeLogFile,
            appendLogSection
        }) {
            assert.equal(activeLogFile, logFilePath);
            completionCalls.push({ messages, checkpoint, attempt, isFinal });
            if (completionCalls.length === 1) {
                appendLogSection({
                    title: 'checkpoint 1 live token stream fallback',
                    content: 'Live token streaming failed: test diagnostic.'
                });
                const aiResponse = '<travel>yes</travel>';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
            if (completionCalls.length === 2) {
                const aiResponse = '   ';
                return {
                    aiResponse,
                    conversationMessages: [
                        ...messages,
                        {
                            role: 'assistant',
                            content: '',
                            tool_calls: [{ id: 'tool_1', type: 'function', function: { name: 'moreInfo', arguments: '{}' } }]
                        },
                        { role: 'tool', tool_call_id: 'tool_1', name: 'moreInfo', content: 'Useful retained result.' },
                        { role: 'assistant', content: aiResponse }
                    ],
                    toolInvocations: [{ id: 'tool_1', name: 'moreInfo' }]
                };
            }
            if (completionCalls.length === 3) {
                assert.equal(attempt, 1);
                assert.ok(messages.some(message => message.role === 'tool' && message.content === 'Useful retained result.'));
                assert.ok(!messages.some(message => message.role === 'assistant' && message.content === '   '));
                const checkpointPrompt = completionCalls[1].messages.at(-1).content;
                assert.equal(
                    messages.filter(message => message.role === 'user' && message.content === checkpointPrompt).length,
                    1
                );
                assert.ok(!messages.some(message => (
                    message.role === 'user'
                    && /parser error|previous response could not be parsed/i.test(message.content)
                )));
                const aiResponse = 'Scene analysis complete.';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
            if (completionCalls.length === 4) {
                assert.equal(isFinal, true);
                assert.equal(attempt, 0);
                assert.match(messages[messages.length - 1].content, /Write final XML now\./);
                const aiResponse = 'Malformed final response.';
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
            assert.equal(completionCalls.length, 5);
            assert.equal(isFinal, true);
            assert.equal(attempt, 1);
            assert.match(messages[messages.length - 1].content, /Write final XML now\./);
            assert.ok(!messages.some(message => (
                message.role === 'assistant'
                && message.content === 'Malformed final response.'
            )));
            const finalPrompt = completionCalls[3].messages.at(-1).content;
            assert.equal(
                messages.filter(message => message.role === 'user' && message.content === finalPrompt).length,
                1
            );
            const aiResponse = '<turnResult><prose>Done.</prose><timePassed><reasoning>Talk.</reasoning><duration>1 minute</duration></timePassed></turnResult>';
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
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(completionCalls.length, 5);
    assert.match(completionCalls[1].messages.at(-1).content, /Travel branch YES/);
    assert.equal(result.toolInvocations.length, 1);
    assert.equal(result.logFilePath, logFilePath);
    assert.ok(logCalls.every(call => !call.filePath || call.filePath === logFilePath));
    const responseLogCalls = logCalls.filter(call => call.markResponseBoundaries);
    assert.equal(responseLogCalls.length, 5);
    assert.ok(responseLogCalls.every(call => /LLM response/i.test(call.responseLabel)));
    const transportDiagnosticLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'checkpoint 1 live token stream fallback'
    ));
    assert.equal(
        transportDiagnosticLog?.sections?.[0]?.content,
        'Live token streaming failed: test diagnostic.'
    );
    const initialCheckpointPromptLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'Tiny-brain checkpoint 2 prompt'
    ));
    const retryCheckpointPromptLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'Tiny-brain checkpoint 2 prompt retry 1'
    ));
    assert.equal(
        retryCheckpointPromptLog?.sections?.[0]?.content,
        initialCheckpointPromptLog?.sections?.[0]?.content
    );
    const initialFinalPromptLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'Tiny-brain final response prompt'
    ));
    const retryFinalPromptLog = logCalls.find(call => (
        call.sections?.[0]?.title === 'Tiny-brain final response prompt retry 1'
    ));
    assert.equal(
        retryFinalPromptLog?.sections?.[0]?.content,
        initialFinalPromptLog?.sections?.[0]?.content
    );
    assert.equal(parseFailures.length, 2);
    assert.equal(parseFailures[0].response, '   ');
    assert.equal(parseFailures[0].checkpoint.index, 1);
    assert.equal(parseFailures[0].attempt, 0);
    assert.equal(parseFailures[0].isFinal, false);
    assert.equal(parseFailures[1].response, 'Malformed final response.');
    assert.equal(parseFailures[1].checkpoint.kind, 'final');
    assert.equal(parseFailures[1].attempt, 0);
    assert.equal(parseFailures[1].isFinal, true);
});

test('tiny-brain accept_or_reject parser terminates the program on rejection', async () => {
    const environment = createEnvironment([
        'Accept or reject now. {% llmparse(\'accept_or_reject\') %}',
        'This instruction must never run. {% llm_dummy_action %}',
        'This final instruction must never run.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    let completionCount = 0;

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        logPrompt(options) {
            return options.filePath || '/test/logs/rejected.log';
        },
        async complete({ messages }) {
            completionCount += 1;
            const aiResponse = '<rejected>Incomplete action.</rejected>';
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
        renderState,
        programTemplateName: 'program.njk'
    });

    assert.equal(completionCount, 1);
    assert.equal(result.aiResponse, '<rejected>Incomplete action.</rejected>');
    assert.equal(result.terminatedAtCheckpoint, 0);
    assert.equal(result.recordProgressOutput, false);
});

test('tiny-brain runner warns and continues when prompt log appends fail', { concurrency: false }, async () => {
    const environment = createEnvironment([
        'Check the scene. {% llm_dummy_action %}',
        'Write the final response.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const logFilePath = '/test/logs/nonfatal-append.log';
    const warnings = [];
    const originalWarn = console.warn;
    let appendCount = 0;
    let completionCount = 0;

    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            logPrompt(options) {
                if (!options.append) {
                    return logFilePath;
                }
                appendCount += 1;
                if (appendCount === 1) {
                    throw new Error('simulated append exception');
                }
                return null;
            },
            async complete({ messages, isFinal }) {
                completionCount += 1;
                const aiResponse = isFinal ? 'Finished response.' : 'Checkpoint response.';
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
            renderState,
            programTemplateName: 'program.njk'
        });

        assert.equal(result.aiResponse, 'Finished response.');
        assert.equal(completionCount, 2);
        assert.equal(appendCount, 3);
        assert.equal(warnings.length, 3);
        assert.ok(warnings.every(warning => /running turn will continue/i.test(warning)));
        assert.match(warnings[0], /simulated append exception/);
        assert.ok(warnings.every(warning => warning.includes(logFilePath)));
    } finally {
        console.warn = originalWarn;
    }
});

test('tiny-brain runner owns one reusable progress group and aggregate-average lifecycle', { concurrency: false }, async () => {
    const environment = createEnvironment('Write the final response.');
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const originalWithQueueReservation = LLMClient.withPromptQueueReservation;
    const originalWithProgressGroup = LLMClient.withPromptProgressGroup;
    const originalClearProgressGroup = LLMClient.clearPromptProgressGroup;
    const queueReservation = Object.freeze({ test: 'future-tinybrain-reservation' });
    const progressGroups = [];
    const clearedGroups = [];
    let completionReservation = null;

    LLMClient.withPromptQueueReservation = async (callback) => callback(queueReservation);
    LLMClient.withPromptProgressGroup = async (options, callback) => {
        progressGroups.push(options);
        return await callback();
    };
    LLMClient.clearPromptProgressGroup = (progressGroupId, options) => {
        clearedGroups.push({ progressGroupId, options });
    };

    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            metadataLabel: 'future_prompt',
            logPrefix: 'future_tinybrain',
            logPrompt(options) {
                return options.filePath || '/test/logs/future-tinybrain.log';
            },
            async complete({ messages, queueReservation: activeReservation }) {
                completionReservation = activeReservation;
                const aiResponse = 'Finished future prompt.';
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
            renderState,
            programTemplateName: 'program.njk'
        });

        assert.equal(result.recordProgressOutput, true);
        assert.equal(completionReservation, queueReservation);
        assert.deepEqual(progressGroups, [{
            progressGroupId: renderState.runId,
            progressGroupTargetLabel: 'future_prompt_tinybrain'
        }]);
        assert.deepEqual(clearedGroups, [{
            progressGroupId: renderState.runId,
            options: { recordOutputCharacters: true }
        }]);
    } finally {
        LLMClient.withPromptQueueReservation = originalWithQueueReservation;
        LLMClient.withPromptProgressGroup = originalWithProgressGroup;
        LLMClient.clearPromptProgressGroup = originalClearProgressGroup;
    }
});

test('tiny-brain short-response parsers normalize N/A and yes/no answers', () => {
    for (const response of [
        'N/A',
        'n.a.',
        'not applicable',
        'None identified.',
        'No issues found.',
        'N/A - no revision is needed.',
        'No revision is needed: n/a',
        'NA because the draft is already clear.',
        'The draft is already clear — n.a.'
    ]) {
        assert.equal(parseResponseOrNa(response).value, false, response);
    }
    assert.equal(parseResponseOrNa('The draft reveals the outcome before the player can act.').value, true);
    assert.equal(parseResponseOrNa('Narrative continuity needs work.').value, true);
    assert.equal(parseResponseOrNa('The banana example is substantive.').value, true);
    assert.throws(() => parseResponseOrNa('   '), /non-whitespace/i);

    assert.equal(parseYesNo('Yes.').value, true);
    assert.equal(parseYesNo('Answer: no, the player remains here.').value, false);
    assert.throws(() => parseYesNo('Maybe.'), /begin with yes or no/i);
});

test('real tiny-brain player-action template renders conditional parser branches in sequence', async () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());

    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = {
        __tinyBrainState: renderState,
        actionText: 'Walk through the archway.',
        characterName: 'Tester',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentVehicle: {
            destination: '',
            name: '',
            timeToDestination: '',
            vehicleInfo: {
                hasArrived: false,
                isUnderway: false
            }
        },
        isAttack: false,
        modPlayerActionPromptSteps: [],
        npcs: [],
        party: [],
        setting: {
            writingStyleNotes: 'Keep it concrete.'
        }
    };
    const programTemplateName = '_includes/player-action.tinybrain.njk';
    const renderedProgram = promptEnv.render(programTemplateName, templateContext);
    const initialRenderedTemplate = [
        '<template>',
        '<systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
        '<generationPrompt><![CDATA[Fixed base context.',
        renderState.programStartMarker,
        renderedProgram,
        ']]></generationPrompt>',
        '</template>'
    ].join('');
    const completionPrompts = [];
    let responseOrNaCount = 0;

    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        finalParser: response => ({ value: /<moveTurnResult>/.test(response) }),
        logPrompt(options) {
            return options.filePath || '/test/logs/real-template.log';
        },
        async complete({ messages, checkpoint, isFinal }) {
            completionPrompts.push(messages.at(-1).content);
            let aiResponse = 'Done.';
            if (isFinal) {
                aiResponse = '<moveTurnResult><playerDestination><location>Beyond the Archway</location><travelTime>1 minute</travelTime></playerDestination><destinationProse>Tester crosses the threshold.</destinationProse></moveTurnResult>';
            } else if (checkpoint.parserName === 'accept_or_reject') {
                aiResponse = '<accepted></accepted>';
            } else if (checkpoint.parserName === 'player_is_traveling') {
                aiResponse = '<travel>no</travel>';
            } else if (checkpoint.parserName === 'response_or_na') {
                responseOrNaCount += 1;
                aiResponse = responseOrNaCount === 1
                    ? 'The draft resolves the scene before the player can respond.'
                    : 'N/A';
            } else if (checkpoint.parserName === 'yes_no') {
                aiResponse = 'Yes.';
            }
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
        renderState,
        programTemplateName
    });

    assert.equal(responseOrNaCount, 8);
    assert.ok(completionPrompts.some(prompt => /addresses the railroading issue/i.test(prompt)));
    assert.ok(!completionPrompts.some(prompt => /addresses the superfluous dialogue issue/i.test(prompt)));
    assert.match(completionPrompts.at(-1), /<moveTurnResult>/);
    assert.match(result.aiResponse, /<moveTurnResult>/);
});
