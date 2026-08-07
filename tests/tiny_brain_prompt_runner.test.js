const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const nunjucks = require('nunjucks');
const LLMClient = require('../LLMClient.js');
const { buildPlayerActionTinyBrainResult } = require('../PlayerActionTinyBrainResult.js');
const {
    TinyBrainPromptExtension,
    TinyBrainPromptRunner,
    createTinyBrainContinuationState,
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
                    toolInvocations: [{ id: 'tool_1', name: 'moreInfo', metadata: { error: true } }]
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

test('tiny-brain dummy checkpoints accept blank text after a successful tool call and finals return normalized responses', async () => {
    const environment = createEnvironment([
        'Use the lookup tool now. {% llm_dummy_action %}',
        'Return the final result now.'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const completionCalls = [];

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        finalParser(response, parseContext) {
            assert.equal(parseContext.toolInvocations.length, 1);
            assert.equal(parseContext.toolInvocations[0].name, 'moreInfo');
            assert.equal(response, 'wrapped final');
            return { value: true, normalizedResponse: '<final>clean</final>' };
        },
        logPrompt(options) {
            return options.filePath || '/test/logs/tinybrain-normalized.log';
        },
        async complete({ messages, isFinal }) {
            completionCalls.push({ messages, isFinal });
            if (!isFinal) {
                const aiResponse = '';
                return {
                    aiResponse,
                    conversationMessages: [
                        ...messages,
                        {
                            role: 'assistant',
                            content: '',
                            tool_calls: [{
                                id: 'tool_1',
                                type: 'function',
                                function: { name: 'moreInfo', arguments: '{}' }
                            }]
                        },
                        { role: 'tool', tool_call_id: 'tool_1', name: 'moreInfo', content: 'Found it.' },
                        { role: 'assistant', content: aiResponse }
                    ],
                    toolInvocations: [{ id: 'tool_1', name: 'moreInfo', metadata: {} }]
                };
            }
            const aiResponse = 'wrapped final';
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

    assert.equal(completionCalls.length, 2);
    assert.equal(result.aiResponse, '<final>clean</final>');
    assert.equal(result.toolInvocations.length, 1);
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

test('tiny-brain llmresult composes a terminal response without another completion', async () => {
    const environment = createEnvironment([
        'Choose now. {% llmparse(\'yes_no\') as approved %}',
        '{% if approved %}Write prose. {% llmparse(\'required_text\') as prose %}{% endif %}',
        '{% llmresult(\'test_result\') %}'
    ].join(''));
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState, stableValue: 'stable' };
    const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
    const logCalls = [];
    let completionCount = 0;
    let builderCall = null;

    const runner = new TinyBrainPromptRunner({
        promptEnv: environment,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        parsers: {
            required_text(response) {
                return { value: response.trim() };
            }
        },
        resultBuilders: {
            test_result(input) {
                builderCall = input;
                return `<local>${input.assignments.prose}</local>`;
            }
        },
        logPrompt(options) {
            logCalls.push(options);
            return options.filePath || '/test/logs/composed.log';
        },
        async complete({ messages, checkpoint }) {
            completionCount += 1;
            const aiResponse = checkpoint.parserName === 'yes_no' ? 'Yes.' : 'Locally composed prose.';
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

    assert.equal(completionCount, 2);
    assert.equal(result.aiResponse, '<local>Locally composed prose.</local>');
    assert.deepEqual({ ...builderCall.assignments }, {
        approved: true,
        prose: 'Locally composed prose.'
    });
    assert.equal(builderCall.templateContext.stableValue, 'stable');
    assert.ok(Object.isFrozen(builderCall.assignments));
    assert.ok(logCalls.some(call => (
        call.sections?.[0]?.title === 'Tiny-brain assembled final response'
        && call.sections[0].content === '<local>Locally composed prose.</local>'
    )));
});

test('tiny-brain llmresult rejects missing builders and trailing prompt text', async () => {
    for (const [program, expectedError] of [
        [
            'Answer. {% llmparse(\'yes_no\') as answer %}{% llmresult(\'missing\') %}',
            /No tiny-brain result builder is registered/
        ],
        [
            'Answer. {% llmparse(\'yes_no\') as answer %}{% llmresult(\'known\') %} extra',
            /must be the only content/
        ]
    ]) {
        const environment = createEnvironment(program);
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState };
        const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            resultBuilders: { known: () => 'known' },
            logPrompt(options) {
                return options.filePath || '/test/logs/invalid-result.log';
            },
            async complete({ messages }) {
                return {
                    aiResponse: 'Yes.',
                    conversationMessages: [...messages, { role: 'assistant', content: 'Yes.' }],
                    toolInvocations: []
                };
            }
        });
        await assert.rejects(
            runner.run({
                initialRenderedTemplate,
                templateContext,
                renderState,
                programTemplateName: 'program.njk'
            }),
            expectedError
        );
    }
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

test('tiny-brain continuation state appends sequential programs to one transcript and prompt log', async () => {
    const environment = createEnvironment(
        'Review the {{ sectionLabel }} section. {% llm_dummy_action %}{% llmresult(\'test_result\') %}'
    );
    const continuationState = createTinyBrainContinuationState();
    const logFilePath = '/test/logs/sequential-tinybrain.log';
    const completionCalls = [];
    const logCalls = [];

    const runSection = async (sectionLabel) => {
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = { __tinyBrainState: renderState, sectionLabel };
        const initialRenderedTemplate = environment.render('wrapper.xml.njk', templateContext);
        const runner = new TinyBrainPromptRunner({
            promptEnv: environment,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            resultBuilders: {
                test_result: () => `<result>${sectionLabel}</result>`
            },
            logPrompt(options) {
                logCalls.push(options);
                return options.filePath || logFilePath;
            },
            async complete({ messages }) {
                completionCalls.push({
                    sectionLabel,
                    messages: messages.map(message => ({ ...message }))
                });
                const aiResponse = `Accepted ${sectionLabel}.`;
                return {
                    aiResponse,
                    conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                    toolInvocations: []
                };
            }
        });
        return runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk',
            continuationState
        });
    };

    const originResult = await runSection('origin');
    const destinationResult = await runSection('destination');

    assert.equal(originResult.aiResponse, '<result>origin</result>');
    assert.equal(destinationResult.aiResponse, '<result>destination</result>');
    assert.equal(completionCalls.length, 2);
    assert.ok(completionCalls[1].messages.some(message => (
        message.role === 'assistant' && message.content === 'Accepted origin.'
    )));
    assert.match(completionCalls[1].messages.at(-1).content, /Review the destination section/);
    assert.equal(
        completionCalls[1].messages.filter(message => (
            message.role === 'user' && message.content.includes('Fixed base context.')
        )).length,
        2
    );
    assert.equal(continuationState.logFilePath, logFilePath);
    assert.equal(logCalls.filter(call => !call.append).length, 1);
    assert.ok(logCalls.slice(1).every(call => call.filePath === logFilePath));
    assert.equal(continuationState.conversationMessages.at(-1).content, 'Accepted destination.');
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
        currentVehicle: null,
        isAttack: false,
        modPlayerActionPromptSteps: [],
        npcs: [],
        party: [],
        playerActionAccompanyingCharacters: [{ name: 'Mira Vale', aliases: ['Mira'] }],
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
    const completionCheckpoints = [];
    let proseCount = 0;
    let finalCompletionCount = 0;

    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        resultBuilders: {
            player_action_result: buildPlayerActionTinyBrainResult
        },
        logPrompt(options) {
            return options.filePath || '/test/logs/real-template.log';
        },
        async complete({ messages, checkpoint, isFinal }) {
            completionPrompts.push(messages.at(-1).content);
            completionCheckpoints.push(checkpoint);
            if (isFinal) {
                finalCompletionCount += 1;
            }
            let aiResponse = 'Done.';
            if (checkpoint.parserName === 'accept_or_reject') {
                aiResponse = '<accepted></accepted>';
            } else if (checkpoint.parserName === 'player_action_movement') {
                aiResponse = 'DESTINATION';
            } else if (checkpoint.parserName === 'player_action_destination') {
                aiResponse = 'Location: Beyond the Archway\nRegion: N/A';
            } else if (checkpoint.parserName === 'player_action_duration') {
                aiResponse = '1 minute';
            } else if (checkpoint.parserName === 'player_action_accompanying_characters') {
                aiResponse = 'Mira';
            } else if (checkpoint.parserName === 'player_action_prose_scope') {
                aiResponse = 'ORIGIN, DESTINATION';
            } else if (checkpoint.parserName === 'player_action_required_prose') {
                proseCount += 1;
                aiResponse = proseCount === 1
                    ? 'Tester steps beneath the arch.'
                    : 'Tester emerges beyond it.';
            } else if (checkpoint.parserName === 'player_action_hidden_notes') {
                aiResponse = 'N/A';
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

    assert.equal(finalCompletionCount, 0);
    assert.equal(proseCount, 2);
    const editingAuditQuestionPatterns = [
        /1\. Railroading\./,
        /2\. Did any character say anything superfluous/,
        /3\. List any instances where a character says basically the same thing/,
        /4\. Trust the reader\./,
        /5\. Is the plot \(conversation, etc\) going in two directions at once/,
        /6\. Characters are NOT OMNIECNENT\./,
        /7\. Look at each one of your answers to the previous question/,
        /8\. Did you use any tropes you're not supposed to use/,
        /9\. Did you create any "mystery boxes"/
    ];
    const editingAuditCheckpointIndexes = editingAuditQuestionPatterns.map(pattern => {
        const matchingIndexes = completionPrompts
            .map((prompt, index) => pattern.test(prompt) ? index : -1)
            .filter(index => index >= 0);
        assert.equal(matchingIndexes.length, 1, `expected one checkpoint for ${pattern}`);
        return matchingIndexes[0];
    });
    assert.equal(new Set(editingAuditCheckpointIndexes).size, 9);
    for (const checkpointIndex of editingAuditCheckpointIndexes) {
        assert.equal(completionCheckpoints[checkpointIndex].kind, 'dummy');
    }
    assert.ok(completionPrompts.some(prompt => /Answer with exactly one keyword/i.test(prompt)));
    assert.ok(completionPrompts.some(prompt => /State the player's destination using exactly two lines/i.test(prompt)));
    assert.ok(completionPrompts.some(prompt => /Mira Vale/.test(prompt) && /accompany the player/i.test(prompt)));
    assert.ok(!completionPrompts.some(prompt => /inside the moveTurnResult tags/i.test(prompt)));
    assert.match(result.aiResponse, /<moveTurnResult>/);
    assert.match(result.aiResponse, /<location>Beyond the Archway<\/location>/);
    assert.match(result.aiResponse, /<accompanyingCharacters>[\s\S]*<name>Mira Vale<\/name>/);
    assert.match(result.aiResponse, /<originProse>/);
    assert.match(result.aiResponse, /<destinationProse>/);
});

test('real player-action template passes committed travel movement to terminal result assembly', async () => {
    const promptEnv = new nunjucks.Environment(
        new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
        { autoescape: false }
    );
    promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());

    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = {
        __tinyBrainState: renderState,
        actionText: 'Walk down to the Stairwell.',
        characterName: 'Tester',
        config: {
            prose_instructions: 'Write clear prose.',
            prose_length: 'three paragraphs',
            prose_prompt_suffix: '',
            repetition_buster: true,
            use_legacy_prompt_checks: false
        },
        currentLocationLastSeenNpcs: [],
        currentVehicle: null,
        isAttack: false,
        isExterior: false,
        modPlayerActionPromptSteps: [],
        npcs: [],
        party: [],
        playerActionTravelDestination: {
            location: 'Stairwell',
            region: 'Herbal Alchemy Shop Interior',
            travelTimeMinutes: 1
        },
        playerActionTravelMovementKind: 'destination',
        playerActionAccompanyingCharacters: [],
        setting: { writingStyleNotes: 'Keep it concrete.' }
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
    const parserNames = [];
    let finalCompletionCount = 0;
    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        resultBuilders: { player_action_result: buildPlayerActionTinyBrainResult },
        logPrompt(options) {
            return options.filePath || '/test/logs/committed-travel.log';
        },
        async complete({ messages, checkpoint, isFinal }) {
            parserNames.push(checkpoint.parserName);
            finalCompletionCount += isFinal ? 1 : 0;
            let aiResponse = 'Done.';
            if (checkpoint.parserName === 'accept_or_reject') {
                aiResponse = '<accepted></accepted>';
            } else if (checkpoint.parserName === 'player_action_accompanying_characters') {
                aiResponse = 'NONE';
            } else if (checkpoint.parserName === 'player_action_prose_scope') {
                aiResponse = 'DESTINATION';
            } else if (checkpoint.parserName === 'player_action_required_prose') {
                aiResponse = 'Tester descends into the Stairwell.';
            } else if (checkpoint.parserName === 'player_action_hidden_notes') {
                aiResponse = 'N/A';
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

    assert.equal(finalCompletionCount, 0);
    assert.ok(!parserNames.includes('player_action_movement'));
    assert.match(result.aiResponse, /<moveTurnResult>/);
    assert.match(result.aiResponse, /<location>Stairwell<\/location>/);
    assert.match(result.aiResponse, /<region>Herbal Alchemy Shop Interior<\/region>/);
    assert.match(result.aiResponse, /<travelTime>1 minutes<\/travelTime>/);
    assert.match(result.aiResponse, /<destinationProse><!\[CDATA\[Tester descends into the Stairwell\.\]\]><\/destinationProse>/);
});

test('real player-action template preserves underway vehicle normal and redirect control flow', async () => {
    const runScenario = async ({ vehicleAnswer, expectedRoot }) => {
        const promptEnv = new nunjucks.Environment(
            new nunjucks.FileSystemLoader(path.join(__dirname, '..', 'prompts'), { noCache: true }),
            { autoescape: false }
        );
        promptEnv.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
        const renderState = TinyBrainPromptRunner.createRenderState();
        const templateContext = {
            __tinyBrainState: renderState,
            actionText: vehicleAnswer === 'UNCHANGED'
                ? 'Talk while the train keeps moving.'
                : 'Tell the conductor to divert to New Harbor.',
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
                destination: 'Old Port',
                name: 'Night Train',
                timeToDestination: '20 minutes',
                vehicleInfo: {
                    hasArrived: false,
                    isUnderway: true
                }
            },
            isAttack: false,
            modPlayerActionPromptSteps: [],
            npcs: [],
            party: [],
            playerActionTravelDestination: null,
            playerActionAccompanyingCharacters: [],
            setting: { writingStyleNotes: 'Keep it concrete.' }
        };
        const renderedProgram = promptEnv.render('_includes/player-action.tinybrain.njk', templateContext);
        const initialRenderedTemplate = [
            '<template>',
            '<systemPrompt><![CDATA[Test system prompt.]]></systemPrompt>',
            '<generationPrompt><![CDATA[Fixed base context.',
            renderState.programStartMarker,
            renderedProgram,
            ']]></generationPrompt>',
            '</template>'
        ].join('');
        const prompts = [];
        let finalCompletionCount = 0;
        const runner = new TinyBrainPromptRunner({
            promptEnv,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 0,
            resultBuilders: { player_action_result: buildPlayerActionTinyBrainResult },
            logPrompt(options) {
                return options.filePath || `/test/logs/vehicle-${vehicleAnswer.toLowerCase()}.log`;
            },
            async complete({ messages, checkpoint, isFinal }) {
                prompts.push(messages.at(-1).content);
                finalCompletionCount += isFinal ? 1 : 0;
                let aiResponse = 'Done.';
                if (checkpoint.parserName === 'accept_or_reject') {
                    aiResponse = '<accepted></accepted>';
                } else if (checkpoint.parserName === 'player_action_movement') {
                    aiResponse = 'NONE';
                } else if (checkpoint.parserName === 'player_action_vehicle_decision') {
                    aiResponse = vehicleAnswer;
                } else if (checkpoint.parserName === 'player_action_destination') {
                    aiResponse = 'Location: New Harbor Station\nRegion: New Harbor';
                } else if (checkpoint.parserName === 'player_action_duration') {
                    aiResponse = vehicleAnswer === 'UNCHANGED' ? '3 minutes' : '30 minutes';
                } else if (checkpoint.parserName === 'player_action_prose_scope') {
                    aiResponse = 'BETWEEN';
                } else if (checkpoint.parserName === 'player_action_required_prose') {
                    aiResponse = vehicleAnswer === 'UNCHANGED'
                        ? 'The conversation continues over the clatter of the rails.'
                        : 'The train changes tracks toward New Harbor.';
                } else if (checkpoint.parserName === 'player_action_hidden_notes') {
                    aiResponse = 'N/A';
                } else if (checkpoint.parserName === 'player_action_time_reasoning') {
                    aiResponse = 'A brief conversation passes during the ride.';
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
            programTemplateName: '_includes/player-action.tinybrain.njk'
        });
        assert.equal(finalCompletionCount, 0);
        assert.match(result.aiResponse, new RegExp(`<${expectedRoot}>`));
        assert.ok(prompts.some(prompt => /Night Train/.test(prompt) && /20 minutes/.test(prompt)));
        assert.ok(prompts.some(prompt => /Ordinary riding, waiting, or talking aboard is UNCHANGED/i.test(prompt)));
        return { result, prompts };
    };

    const unchanged = await runScenario({ vehicleAnswer: 'UNCHANGED', expectedRoot: 'turnResult' });
    assert.doesNotMatch(unchanged.result.aiResponse, /<vehicleInfo>/);

    const redirect = await runScenario({ vehicleAnswer: 'REDIRECT', expectedRoot: 'moveTurnResult' });
    assert.match(redirect.result.aiResponse, /<name>Night Train<\/name>/);
    assert.match(redirect.result.aiResponse, /<vehicleDestination>/);
    assert.doesNotMatch(redirect.result.aiResponse, /<playerDestination>/);
});
