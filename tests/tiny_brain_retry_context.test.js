const test = require('node:test');
const assert = require('node:assert/strict');
const nunjucks = require('nunjucks');

const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const {
    TinyBrainPromptExtension,
    TinyBrainPromptRunner,
    createTinyBrainContinuationState
} = require('../TinyBrainPromptRunner.js');
const { executeDeterministicScheduledEventToolPlan } = require('../scheduled_event_runtime.js');

class TestLoader extends nunjucks.Loader {
    constructor(program) {
        super();
        this.templates = {
            'wrapper.xml.njk': [
                '<template><systemPrompt><![CDATA[Retry context test system.]]></systemPrompt>',
                '<generationPrompt><![CDATA[Fixed prefix. {{ __tinyBrainState.programStartMarker }}',
                '{% include "program.njk" %}]]></generationPrompt></template>'
            ].join(''),
            'program.njk': program
        };
    }

    getSource(name) {
        const src = this.templates[name];
        return typeof src === 'string' ? { src, path: name, noCache: true } : null;
    }
}

function createEnvironment(program) {
    const env = new nunjucks.Environment(new TestLoader(program), { autoescape: false });
    env.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return env;
}

function parseTemplate(rendered) {
    const systemPrompt = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/)?.[1];
    const generationPrompt = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/)?.[1];
    assert.ok(systemPrompt && generationPrompt, 'test wrapper must provide both prompt sections');
    return { systemPrompt, generationPrompt };
}

function toolCall(id, name, args) {
    return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function toolInvocation(id, name, args, metadata = {}) {
    return { id, name, argumentsObject: args, metadata };
}

function transcriptWithCalls(messages, calls, results, terminal) {
    return [
        ...messages.map(message => ({ ...message })),
        { role: 'assistant', content: '', tool_calls: calls },
        ...results,
        { role: 'assistant', content: terminal }
    ];
}

test('accepted TinyBrain sections clean failed attempts while retaining authored instructions, normalized answers and successful tool pairs', { concurrency: false }, async () => {
    const program = [
        "Original opening. {% llmparse('opening') as opening %}",
        "Section B original instruction mentions WORLD_LOCK_ERROR_RECEIPT as a literal game term. {% llmparse('section_b') as sectionB %}",
        "Future section original instruction. {% llmparse('future') as future %}",
        'Final answer instruction.'
    ].join(' ');
    const env = createEnvironment(program);
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = env.render('wrapper.xml.njk', templateContext);
    const completionCalls = [];
    const logCalls = [];
    const failures = [];
    const progressFailures = [];
    const continuationState = createTinyBrainContinuationState();
    const originalProgressFailure = LLMClient.recordPromptProgressGroupFailure;
    LLMClient.recordPromptProgressGroupFailure = (groupId, response) => progressFailures.push({ groupId, response });
    let sideEffectCount = 0;

    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: env,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 1,
            toolDefinitions: [],
            metadataLabel: 'retry_context_test',
            logPrompt(options) {
                logCalls.push(options);
                return options.filePath || '/tmp/tiny-brain-retry-context.log';
            },
            onParseFailure(failure) {
                failures.push(failure);
            },
            parsers: {
                opening(response) {
                    return { value: 'opening-value', normalizedResponse: `Accepted opening: ${response}` };
                },
                section_b(response) {
                    if (response !== 'SECTION_B_RAW_ACCEPTED') throw new Error('Section B response failed semantic validation.');
                    return { value: 'section-b-value', normalizedResponse: 'Accepted section B normalized answer.' };
                },
                future(response) {
                    return { value: 'future-value', normalizedResponse: `Accepted future: ${response}` };
                }
            },
            finalParser(response) {
                if (response === 'FINAL_REJECTED_RAW') throw new Error('Final response failed exact root validation.');
                return { value: true, normalizedResponse: 'Accepted final normalized response.' };
            },
            async complete({ messages, checkpoint, attempt, isFinal }) {
                const call = { messages: messages.map(message => ({ ...message })), checkpoint, attempt, isFinal };
                completionCalls.push(call);

                if (checkpoint.index === 0) {
                    const aiResponse = 'OPENING_RAW';
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                }

                if (checkpoint.index === 1 && attempt === 0) {
                    sideEffectCount += 1;
                    const aiResponse = 'FAILED_SECTION_B_RAW';
                    return {
                        aiResponse,
                        conversationMessages: transcriptWithCalls(messages, [
                            toolCall('tool-success-1', 'commitWorldChange', { record: 'once' }),
                            toolCall('tool-failure-1', 'lookupWorldTarget', { target: 'missing' })
                        ], [
                            { role: 'tool', tool_call_id: 'tool-success-1', name: 'commitWorldChange', content: 'Committed world change once.' },
                            { role: 'tool', tool_call_id: 'tool-failure-1', name: 'lookupWorldTarget', content: 'WORLD_LOCK_ERROR_RECEIPT: target missing.' }
                        ], aiResponse),
                        toolInvocations: [
                            toolInvocation('tool-success-1', 'commitWorldChange', { record: 'once' }),
                            toolInvocation('tool-failure-1', 'lookupWorldTarget', { target: 'missing' }, {
                                error: true,
                                code: 'target_not_found',
                                message: 'WORLD_LOCK_ERROR_RECEIPT: target missing.'
                            })
                        ]
                    };
                }

                if (checkpoint.index === 1 && attempt === 1) {
                    assert.equal(isFinal, false);
                    assert.ok(messages.some(message => message.role === 'tool' && message.content === 'WORLD_LOCK_ERROR_RECEIPT: target missing.'), 'active retry retains the failed receipt');
                    assert.ok(messages.some(message => message.role === 'tool' && message.content === 'Committed world change once.'), 'active retry retains successful tool outcome');
                    assert.match(messages.at(-1).content, /lookupWorldTarget: WORLD_LOCK_ERROR_RECEIPT: target missing/i);
                    assert.doesNotMatch(messages.at(-1).content, /\bDONE\b/);
                    assert.equal(sideEffectCount, 1, 'the committed effect must not execute again during correction');
                    const aiResponse = 'SECTION_B_RAW_ACCEPTED';
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                }

                if (checkpoint.index === 2) {
                    const flattened = messages.map(message => `${message.role}:${message.content || ''}:${JSON.stringify(message.tool_calls || [])}`).join('\n');
                    assert.ok(flattened.includes('Section B original instruction mentions WORLD_LOCK_ERROR_RECEIPT as a literal game term.'), 'original authored instruction must stay verbatim');
                    assert.equal((flattened.match(/Section B original instruction mentions/g) || []).length, 1);
                    assert.ok(flattened.includes('OPENING_RAW'), 'clean accepted sections preserve the ordinary completion transcript');
                    assert.ok(flattened.includes('Accepted section B normalized answer.'));
                    assert.doesNotMatch(flattened, /FAILED_SECTION_B_RAW|target missing|lookupWorldTarget:|previous response failed validation|Section B response failed semantic validation/);
                    const successCallMessages = messages.filter(message => message.role === 'assistant' && Array.isArray(message.tool_calls));
                    assert.equal(successCallMessages.length, 1);
                    assert.deepEqual(successCallMessages[0].tool_calls.map(call => call.id), ['tool-success-1']);
                    assert.equal(messages.filter(message => message.role === 'tool' && message.tool_call_id === 'tool-success-1').length, 1);
                    assert.equal(messages.some(message => message.role === 'tool' && message.tool_call_id === 'tool-failure-1'), false);
                    const aiResponse = 'FUTURE_RAW';
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                }

                if (isFinal && attempt === 0) {
                    return { aiResponse: 'FINAL_REJECTED_RAW', conversationMessages: [...messages, { role: 'assistant', content: 'FINAL_REJECTED_RAW' }], toolInvocations: [] };
                }

                assert.equal(isFinal, true);
                assert.ok(messages.some(message => message.role === 'assistant' && message.content === 'FINAL_REJECTED_RAW'));
                assert.ok(messages.at(-1).content.includes('Final response failed exact root validation.'));
                assert.doesNotMatch(messages.at(-1).content, /\bDONE\b/);
                const aiResponse = '<final>accepted</final>';
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });

        const result = await runner.run({
            initialRenderedTemplate,
            templateContext,
            renderState,
            programTemplateName: 'program.njk',
            continuationState
        });

        assert.equal(result.aiResponse, 'Accepted final normalized response.');
        assert.equal(sideEffectCount, 1);
        assert.deepEqual(result.toolInvocations.map(invocation => invocation.id), ['tool-success-1']);
        assert.equal(completionCalls.length, 6);
        assert.deepEqual(completionCalls.map(call => call.isFinal), [false, false, false, false, true, true]);
        const continuationMessages = continuationState.conversationMessages;
        const continuationText = continuationMessages.map(message => `${message.role}:${message.content || ''}:${JSON.stringify(message.tool_calls || [])}`).join('\n');
        assert.doesNotMatch(continuationText, /FAILED_SECTION_B_RAW|FINAL_REJECTED_RAW|target missing|lookupWorldTarget:|previous response failed validation|Section B response failed semantic validation/);
        assert.ok(continuationText.includes('Accepted section B normalized answer.'));
        assert.ok(continuationText.includes('Accepted final normalized response.'));
        assert.equal(continuationMessages.filter(message => message.role === 'tool' && message.tool_call_id === 'tool-success-1').length, 1);
        assert.equal(continuationMessages.some(message => message.role === 'tool' && message.tool_call_id === 'tool-failure-1'), false);
        assert.equal(progressFailures.length, 2, 'recoverable failures remain visible while the section/final is active');
        assert.deepEqual(progressFailures.map(entry => entry.response), ['FAILED_SECTION_B_RAW', 'FINAL_REJECTED_RAW']);
        assert.ok(logCalls.some(call => call.response === 'FAILED_SECTION_B_RAW'), 'the rejected response remains in the run log');
        assert.ok(logCalls.some(call => call.response === 'FINAL_REJECTED_RAW'), 'the rejected final response remains in the run log');
        assert.equal(failures.length, 2);
        assert.deepEqual(result.conversationMessages, continuationState.conversationMessages);
    } finally {
        LLMClient.recordPromptProgressGroupFailure = originalProgressFailure;
    }
});

test('afterParse partial retries honor keyed receipts and tinyBrainRetryConversationMessages overrides', { concurrency: false }, async () => {
    const program = [
        "Prior section instruction. {% llmparse('prior') as prior %}",
        "Resolution plan instruction. {% llmparse('plan') as plan %}",
        "Next section instruction. {% llmparse('next') as next %}",
        'Final instruction.'
    ].join(' ');
    const env = createEnvironment(program);
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = env.render('wrapper.xml.njk', templateContext);
    const completionCalls = [];
    const progressFailures = [];
    const priorFailureHook = LLMClient.recordPromptProgressGroupFailure;
    LLMClient.recordPromptProgressGroupFailure = (groupId, response) => progressFailures.push(response);
    const sideEffects = { partialCommit: 0, acceptedHook: 0 };
    let afterParseCalls = 0;

    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: env,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 1,
            toolDefinitions: [],
            metadataLabel: 'after_parse_retry_context_test',
            logPrompt(options) { return options.filePath || '/tmp/tiny-brain-after-parse-context.log'; },
            parsers: {
                prior(response) { return { value: true, normalizedResponse: `Prior accepted: ${response}` }; },
                plan(response) { return { value: response, normalizedResponse: 'Accepted plan normalized response.' }; },
                next(response) { return { value: true, normalizedResponse: `Next accepted: ${response}` }; }
            },
            async afterParse({ attempt, messages, checkpoint }) {
                afterParseCalls += 1;
                if (checkpoint.index !== 1) {
                    if (checkpoint.index === 0) {
                        const receipt = { role: 'user', content: 'Prior committed receipt.' };
                        return {
                            conversationMessages: [...messages, receipt],
                            retainedMessages: [{ key: 'prior-section-receipt', message: receipt }]
                        };
                    }
                    return null;
                }

                if (attempt === 0) {
                    sideEffects.partialCommit += 1;
                    const receipt = { role: 'user', content: 'Partial operation receipt v1.' };
                    const retryMessages = [
                        ...messages,
                        {
                            role: 'assistant',
                            content: '',
                            tool_calls: [toolCall('hook-partial-1', 'commitPartialEffect', { effect: 'once' })]
                        },
                        { role: 'tool', tool_call_id: 'hook-partial-1', name: 'commitPartialEffect', content: 'Partial effect committed once.' },
                        receipt
                    ];
                    const error = new Error('One remaining post-parse operation failed.');
                    error.tinyBrainRetryConversationMessages = retryMessages;
                    error.tinyBrainRetainedMessages = [{ key: 'plan-effects', message: receipt }];
                    error.tinyBrainRetryToolInvocations = [toolInvocation('hook-partial-1', 'commitPartialEffect', { effect: 'once' })];
                    throw error;
                }

                sideEffects.acceptedHook += 1;
                const receipt = { role: 'user', content: 'Partial operation receipt v2: all operations committed.' };
                const call = toolCall('hook-final-2', 'commitFinalEffect', { effect: 'final' });
                return {
                    conversationMessages: [
                        ...messages,
                        { role: 'assistant', content: '', tool_calls: [call] },
                        { role: 'tool', tool_call_id: 'hook-final-2', name: 'commitFinalEffect', content: 'Final hook effect committed.' },
                        receipt
                    ],
                    retainedMessages: [{ key: 'plan-effects', message: receipt }],
                    toolInvocations: [toolInvocation('hook-final-2', 'commitFinalEffect', { effect: 'final' })]
                };
            },
            async complete({ messages, checkpoint, attempt, isFinal }) {
                completionCalls.push({ messages: messages.map(message => ({ ...message })), checkpoint, attempt, isFinal });
                if (checkpoint.index === 0) {
                    const aiResponse = 'PRIOR_RAW';
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                }
                if (checkpoint.index === 1 && attempt === 0) {
                    const aiResponse = 'PLAN_RAW_FIRST';
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                }
                if (checkpoint.index === 1 && attempt === 1) {
                    const activeContext = messages.map(message => `${message.role}:${message.content || ''}:${JSON.stringify(message.tool_calls || [])}`).join('\n');
                    assert.ok(activeContext.includes('Partial operation receipt v1.'), 'custom retry conversation includes the first committed receipt');
                    assert.ok(activeContext.includes('Partial effect committed once.'));
                    assert.ok(activeContext.includes('One remaining post-parse operation failed.'));
                    assert.equal(sideEffects.partialCommit, 1, 'partial post-parse side effect is not repeated');
                    const aiResponse = 'PLAN_RAW_ACCEPTED';
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                }
                if (checkpoint.index === 2) {
                    const flattened = messages.map(message => `${message.role}:${message.content || ''}:${JSON.stringify(message.tool_calls || [])}`).join('\n');
                    assert.ok(flattened.includes('Prior committed receipt.'));
                    assert.ok(flattened.includes('Partial operation receipt v2: all operations committed.'));
                    assert.ok(!flattened.includes('Partial operation receipt v1.'), 'same-key accepted receipt replaces its earlier partial value');
                    assert.ok(flattened.includes('Accepted plan normalized response.'));
                    assert.ok(!flattened.includes('PLAN_RAW_FIRST|PLAN_RAW_ACCEPTED|One remaining post-parse operation failed|previous response failed validation'));
                    assert.equal(messages.filter(message => message.role === 'assistant' && message.tool_calls?.some(call => call.id === 'hook-partial-1')).length, 1);
                    assert.equal(messages.filter(message => message.role === 'tool' && message.tool_call_id === 'hook-partial-1').length, 1);
                    assert.equal(messages.filter(message => message.role === 'assistant' && message.tool_calls?.some(call => call.id === 'hook-final-2')).length, 1);
                    const aiResponse = 'NEXT_RAW';
                    return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
                }
                assert.equal(isFinal, true);
                return { aiResponse: '<done/>', conversationMessages: [...messages, { role: 'assistant', content: '<done/>' }], toolInvocations: [] };
            }
        });

        const result = await runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' });
        assert.equal(sideEffects.partialCommit, 1);
        assert.equal(sideEffects.acceptedHook, 1);
        assert.equal(afterParseCalls, 4, 'one prior hook, two retry-position hooks, and one future hook ran');
        assert.equal(completionCalls.length, 5);
        assert.equal(progressFailures.length, 1);
        assert.deepEqual(result.toolInvocations.map(invocation => invocation.id), ['hook-partial-1', 'hook-final-2']);
        const secondSection = completionCalls[3].messages;
        assert.equal(secondSection.at(-1).content, 'Next section instruction.');
    } finally {
        LLMClient.recordPromptProgressGroupFailure = priorFailureHook;
    }
});

test('failed malformed tool arguments are discarded before JSON parsing when the same call id is later corrected', { concurrency: false }, async () => {
    const env = createEnvironment("First tool plan. {% llm_dummy_action %} Next section. {% llm_dummy_action %} Final.");
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = env.render('wrapper.xml.njk', templateContext);
    const calls = [];
    const originalProgressFailure = LLMClient.recordPromptProgressGroupFailure;
    LLMClient.recordPromptProgressGroupFailure = () => {};

    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: env,
            parseXMLTemplate: parseTemplate,
            retryAttempts: 1,
            toolDefinitions: [],
            metadataLabel: 'retry_context_malformed_tool_test',
            logPrompt(options) { return options.filePath || '/tmp/tiny-brain-malformed-tool.log'; },
            async complete({ messages, checkpoint, attempt }) {
                calls.push({ messages: messages.map(message => ({ ...message })), checkpoint, attempt });
                if (checkpoint.index === 0 && attempt === 0) {
                    const response = 'Tool call needs correction.';
                    return {
                        aiResponse: response,
                        conversationMessages: transcriptWithCalls(messages, [
                            { id: 'reused-call-id', type: 'function', function: { name: 'updateObjectFields', arguments: '{"objectId":' } }
                        ], [
                            { role: 'tool', tool_call_id: 'reused-call-id', name: 'updateObjectFields', content: 'Arguments must be valid JSON.' }
                        ], response),
                        toolInvocations: [toolInvocation('reused-call-id', 'updateObjectFields', {}, {
                            error: true,
                            code: 'invalid_arguments',
                            message: 'Arguments must be valid JSON.'
                        })]
                    };
                }
                if (checkpoint.index === 0 && attempt === 1) {
                    assert.ok(messages.some(message => message.role === 'tool' && message.content === 'Arguments must be valid JSON.'));
                    const response = 'Tool call corrected.';
                    return {
                        aiResponse: response,
                        conversationMessages: transcriptWithCalls(messages, [
                            toolCall('reused-call-id', 'updateObjectFields', { objectId: 'target-1', updates: { shortDescription: 'Fixed' } })
                        ], [
                            { role: 'tool', tool_call_id: 'reused-call-id', name: 'updateObjectFields', content: 'Updated target-1.' }
                        ], response),
                        toolInvocations: [toolInvocation('reused-call-id', 'updateObjectFields', {
                            objectId: 'target-1', updates: { shortDescription: 'Fixed' }
                        })]
                    };
                }
                if (checkpoint.index === 1) {
                    const toolCalls = messages.filter(message => message.role === 'assistant' && message.tool_calls);
                    assert.equal(toolCalls.length, 1);
                    assert.equal(toolCalls[0].tool_calls[0].id, 'reused-call-id');
                    assert.deepEqual(JSON.parse(toolCalls[0].tool_calls[0].function.arguments), {
                        objectId: 'target-1', updates: { shortDescription: 'Fixed' }
                    });
                    assert.equal(messages.filter(message => message.role === 'tool' && message.tool_call_id === 'reused-call-id').length, 1);
                    assert.equal(messages.some(message => message.role === 'tool' && message.content === 'Arguments must be valid JSON.'), false);
                    const response = 'Next section accepted.';
                    return { aiResponse: response, conversationMessages: [...messages, { role: 'assistant', content: response }], toolInvocations: [] };
                }
                return { aiResponse: 'Final accepted.', conversationMessages: [...messages, { role: 'assistant', content: 'Final accepted.' }], toolInvocations: [] };
            }
        });

        const result = await runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' });
        assert.equal(calls.length, 4);
        assert.deepEqual(result.toolInvocations.map(invocation => invocation.id), ['reused-call-id']);
    } finally {
        LLMClient.recordPromptProgressGroupFailure = originalProgressFailure;
    }
});

test('accepted-context cleanup preserves the ordinary exhausted-final error', { concurrency: false }, async () => {
    const env = createEnvironment('Write a final answer.');
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = env.render('wrapper.xml.njk', templateContext);
    const logCalls = [];

    const runner = new TinyBrainPromptRunner({
        promptEnv: env,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 0,
        finalParser() { throw new Error('The final result must have the expected root.'); },
        logPrompt(options) {
            logCalls.push(options);
            return options.filePath || '/tmp/tiny-brain-final-error.log';
        },
        async complete({ messages }) {
            const response = 'Wrong final root';
            return { aiResponse: response, conversationMessages: [...messages, { role: 'assistant', content: response }], toolInvocations: [] };
        }
    });

    await assert.rejects(
        runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' }),
        /Tiny-brain final response failed to parse after 1 attempt: The final result must have the expected root\./
    );
    assert.ok(logCalls.some(call => call.response === 'Wrong final root'));
});

test('accepted scheduled plans preserve reordered positional tool receipts with transcript-only id remapping', { concurrency: false }, async () => {
    const env = createEnvironment("Plan scheduled changes. {% llmparse('scheduled_plan') as plan %} Final answer.");
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = env.render('wrapper.xml.njk', templateContext);
    const sideEffects = [];
    const resultCache = new Map();
    const planA = {
        stateChangeRequired: true,
        directUpdates: [{ objectType: 'thing', object: 'thing-A', field: 'description', value: 'A committed.' }],
        otherTools: []
    };
    const planWithInsertedB = {
        stateChangeRequired: true,
        directUpdates: [
            { objectType: 'thing', object: 'thing-B', field: 'description', value: 'B committed.' },
            ...planA.directUpdates
        ],
        otherTools: []
    };

    async function execute(plan) {
        return executeDeterministicScheduledEventToolPlan(plan, {
            resultCache,
            validateToolCall() {},
            async executeChatToolCall(call) {
                sideEffects.push(call.argumentsObject.object);
                return {
                    content: `Committed ${call.argumentsObject.object}.`,
                    metadata: { status: 'success', object: call.argumentsObject.object }
                };
            }
        });
    }

    function transcriptWithExecution(messages, execution) {
        const calls = execution.toolCalls.map(call => ({
            id: call.id,
            type: 'function',
            function: { name: call.functionName, arguments: call.argumentsText }
        }));
        const results = execution.invocations.map(invocation => ({
            role: 'tool',
            tool_call_id: invocation.id,
            name: invocation.name,
            content: invocation.content
        }));
        return [
            ...messages,
            { role: 'assistant', content: '', tool_calls: calls },
            ...results
        ];
    }

    const runner = new TinyBrainPromptRunner({
        promptEnv: env,
        parseXMLTemplate: parseTemplate,
        retryAttempts: 1,
        toolDefinitions: [],
        metadataLabel: 'scheduled_retry_context_test',
        logPrompt(options) { return options.filePath || '/tmp/tiny-brain-scheduled-retry-context.log'; },
        parsers: {
            scheduled_plan(response) {
                const plan = JSON.parse(response);
                return { value: plan, normalizedResponse: `Accepted plan for ${plan.directUpdates.map(update => update.object).join(', ')}.` };
            }
        },
        async afterParse({ parsed, messages, attempt }) {
            const execution = await execute(parsed.value);
            const conversationMessages = transcriptWithExecution(messages, execution);
            if (attempt === 0) {
                const error = new Error('The scheduled plan needs one correction.');
                error.tinyBrainRetryConversationMessages = conversationMessages;
                error.tinyBrainRetryToolInvocations = execution.invocations;
                return Promise.reject(error);
            }
            conversationMessages.push({ role: 'user', content: 'All scheduled operations were committed.' });
            return {
                conversationMessages,
                toolInvocations: execution.invocations,
                retainedMessages: [{ key: 'scheduled-plan-receipt', message: conversationMessages.at(-1) }]
            };
        },
        finalParser(response) {
            assert.equal(response, '<done/>');
            return { value: true };
        },
        async complete({ messages, attempt, isFinal }) {
            if (isFinal) {
                const flattened = JSON.stringify(messages);
                assert.match(flattened, /Accepted plan for thing-B, thing-A\./);
                assert.match(flattened, /Committed thing-A\./);
                assert.match(flattened, /Committed thing-B\./);
                assert.match(flattened, /All scheduled operations were committed\./);
                assert.doesNotMatch(flattened, /The scheduled plan needs one correction/);
            const acceptedPlanIndex = messages.findIndex(message => message.role === 'assistant' && message.content === 'Accepted plan for thing-B, thing-A.');
            const afterParseCallsIndex = messages.findIndex(message => message.role === 'assistant' && message.tool_calls?.some(call => call.function.name === 'updateObjectFields' && JSON.parse(call.function.arguments).object === 'thing-B'));
            const receiptIndex = messages.findIndex(message => message.role === 'user' && message.content === 'All scheduled operations were committed.');
            assert.ok(acceptedPlanIndex >= 0 && acceptedPlanIndex < afterParseCallsIndex, 'normalized accepted plan precedes accepted afterParse execution receipts');
            assert.ok(afterParseCallsIndex < receiptIndex, 'authoritative keyed receipt follows accepted tool results');
            const toolCallMessages = messages.filter(message => message.role === 'assistant' && Array.isArray(message.tool_calls));
            const allCalls = toolCallMessages.flatMap(message => message.tool_calls);
            assert.deepEqual(allCalls.map(call => call.id), [
                'scheduled_event_plan_1',
                'scheduled_event_plan_1_tinybrain_1',
                'scheduled_event_plan_2'
            ]);
            const toolResultIds = messages.filter(message => message.role === 'tool').map(message => message.tool_call_id);
            assert.deepEqual(toolResultIds, allCalls.map(call => call.id));
                return { aiResponse: '<done/>', conversationMessages: [...messages, { role: 'assistant', content: '<done/>' }], toolInvocations: [] };
            }
            const plan = attempt === 0 ? planA : planWithInsertedB;
            const aiResponse = JSON.stringify(plan);
            return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
        }
    });

    const result = await runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' });
    assert.deepEqual(sideEffects, ['thing-A', 'thing-B'], 'cached A is not executed again when its positional id changes');
    assert.deepEqual(result.toolInvocations.map(invocation => invocation.id), [
        'scheduled_event_plan_1',
        'scheduled_event_plan_1',
        'scheduled_event_plan_2'
    ], 'execution ledger ids remain the original deterministic plan ids');
});

test('unclosed XML checkpoint and final each get one DONE correction without leaking previous retries', { concurrency: false }, async () => {
    const Utils = require('../Utils.js');
    const env = createEnvironment("Generate items. {% llmparse('items') as items %} Generate final XML.");
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = env.render('wrapper.xml.njk', templateContext);
    const calls = [], logs = [], failures = [];
    const original = LLMClient.recordPromptProgressGroupFailure;
    LLMClient.recordPromptProgressGroupFailure = () => {};
    const parse = response => ({ value: Utils.parseXmlDocumentStrict(response).documentElement.tagName, normalizedResponse: response });
    try {
        const runner = new TinyBrainPromptRunner({
            promptEnv: env, parseXMLTemplate: parseTemplate, retryAttempts: 2, toolDefinitions: [], metadataLabel: 'tinybrain_done_retry',
            logPrompt(options) { logs.push(options); return options.filePath || '/tmp/tinybrain-done.log'; },
            onParseFailure(failure) { failures.push(failure); },
            parsers: { items: parse }, finalParser: parse,
            async complete({ messages, attempt, isFinal }) {
                calls.push({ messages: messages.map(message => ({ ...message })), attempt, isFinal });
                const aiResponse = attempt < 2 ? '<items><item>' : '<items><item/></items>\nDONE';
                return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
            }
        });
        await runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' });
        assert.equal(calls.length, 6);
        assert.equal(failures.length, 4);
        for (const index of [1, 2, 4, 5]) {
            const correction = calls[index].messages.at(-1).content;
            assert.match(correction, /unclosed/i);
            assert.match(correction, /clos(?:e|ing)[\s\S]*tag/i);
            assert.equal((correction.match(/\bDONE\b/g) || []).length, 1);
        }
        for (const index of [1, 4]) assert.doesNotMatch(calls[index].messages.at(-1).content, /Insanity/);
        for (const index of [2, 5]) assert.match(calls[index].messages.at(-1).content, /"Insanity is doing the same thing over and over again and expecting different results\."/);
        assert.doesNotMatch(calls[3].messages.at(-1).content, /previous response failed validation|close all|Insanity/i);
        assert.ok(logs.length >= 2);
    } finally { LLMClient.recordPromptProgressGroupFailure = original; }
});

test('TinyBrain expected-root error does not treat a different unfinished root as an unclosed expected root', { concurrency: false }, async () => {
    const env = createEnvironment('Generate final items XML.');
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = env.render('wrapper.xml.njk', templateContext);
    const calls = [];
    const runner = new TinyBrainPromptRunner({
        promptEnv: env, parseXMLTemplate: parseTemplate, retryAttempts: 1, toolDefinitions: [], metadataLabel: 'tinybrain_wrong_root',
        logPrompt(options) { return options.filePath || '/tmp/tinybrain-wrong-root.log'; },
        finalParser(response) { if (response !== '<items/>') throw new Error('Expected one complete <items>...</items> XML root block.'); return { value: true }; },
        async complete({ messages, attempt }) {
            calls.push(messages.map(message => ({ ...message })));
            const aiResponse = attempt === 0 ? '<wrong><item>' : '<items/>';
            return { aiResponse, conversationMessages: [...messages, { role: 'assistant', content: aiResponse }], toolInvocations: [] };
        }
    });
    await runner.run({ initialRenderedTemplate, templateContext, renderState, programTemplateName: 'program.njk' });
    assert.equal(calls.length, 2);
    assert.match(calls[1].at(-1).content, /Expected one complete <items>/);
    assert.doesNotMatch(calls[1].at(-1).content, /\bDONE\b/);
});
