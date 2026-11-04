const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const axios = require('axios');
const nunjucks = require('nunjucks');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');
const PromptAuditLog = require('../PromptAuditLog.js');
const PromptFailureReporter = require('../PromptFailureReporter.js');
const { CHAT_TOOL_DEFINITIONS, createChatToolRuntime } = require('../chat_tool_calls.js');
const { runPromptWithParseRetries } = require('../PromptRetryPolicy.js');
const { TinyBrainPromptExtension, TinyBrainPromptRunner } = require('../TinyBrainPromptRunner.js');
const Player = require('../Player.js');
const Thing = require('../Thing.js');
const Location = require('../Location.js');
const Region = require('../Region.js');
const Utils = require('../Utils.js');

const tempRoot = path.resolve(__dirname, '..', 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'api.js'), 'utf8');

function makeLogDirectory() {
    return fs.mkdtempSync(path.join(tempRoot, 'prompt-audit-log-'));
}

function promptLogReference(name) {
    return name === 'turn-a'
        ? `/tmp/${'nested-directory/'.repeat(16)}turn-a [region roster].prompt.log`
        : `/tmp/${name}-prompt.log`;
}

function deferred() {
    let resolve;
    const promise = new Promise(res => { resolve = res; });
    return { promise, resolve };
}

class MemoryLoader extends nunjucks.Loader {
    constructor(templates) {
        super();
        this.templates = templates;
    }

    getSource(name) {
        const src = this.templates[name];
        return typeof src === 'string' ? { src, path: name, noCache: true } : null;
    }
}

function makePromptEnvironment(program) {
    const environment = new nunjucks.Environment(new MemoryLoader({
        'wrapper.xml.njk': '<template><systemPrompt><![CDATA[Test system.]]></systemPrompt><generationPrompt><![CDATA[Fixed context. {{ __tinyBrainState.programStartMarker }}{% include "program.njk" %}]]></generationPrompt></template>',
        'program.njk': program
    }), { autoescape: false });
    environment.addExtension('TinyBrainPromptExtension', new TinyBrainPromptExtension());
    return environment;
}

function parsePromptWrapper(rendered) {
    const systemPrompt = rendered.match(/<systemPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/systemPrompt>/)?.[1];
    const generationPrompt = rendered.match(/<generationPrompt><!\[CDATA\[([\s\S]*?)\]\]><\/generationPrompt>/)?.[1];
    if (typeof systemPrompt !== 'string' || typeof generationPrompt !== 'string') {
        throw new Error('Test wrapper did not render both prompt fields.');
    }
    return { systemPrompt, generationPrompt };
}

function makeProviderResponse(payload, message) {
    return {
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
        data: {
            id: 'prompt-audit-test',
            model: payload.model,
            choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }]
        }
    };
}

test('interleaved turn owners isolate same-label tracked background work until both logs flush', { concurrency: false }, async () => {
    const snapshots = new Map();
    const turnStates = await Promise.all(['turn-a', 'turn-b'].map(async name => {
        const gate = deferred();
        let endLocation = { id: `${name}-end`, name: `${name} end` };
        const state = await PromptAuditLog.runTurn({
            requestId: name,
            route: 'chat',
            startLocation: { id: `${name}-start`, name: `${name} start` },
            getLocation: () => endLocation,
            logDirectory: makeLogDirectory()
        }, async () => {
            const owner = PromptAuditLog.currentTurn();
            const background = (async () => {
                await PromptAuditLog.runPrompt({ metadataLabel: 'same-family', kind: 'memory' }, async () => {
                    await PromptAuditLog.runStage({ stage: 'npc-memory-selection', parser: 'history', checkpoint: 2 }, async () => {
                        await gate.promise;
                        PromptAuditLog.setAttempt(2);
                        PromptAuditLog.addLogReference(promptLogReference(name));
                        PromptAuditLog.recordFailure(new Error(`${name} validation failed sk-audit-secret-${name}`), {
                            phase: 'validation',
                            attempt: 2,
                            source: `Authorization: Bearer sk-audit-source-${name}`
                        });
                    });
                });
                snapshots.set(name, PromptAuditLog.snapshot(owner));
            })();
            PromptAuditLog.trackWork(background);
            endLocation = { id: `${name}-end`, name: `${name} end` };
            return { name, owner, background, release: gate.resolve };
        });
        return state;
    }));

    for (const {owner} of turnStates) {
        assert.equal(owner.foregroundDone, true);
        assert.equal(owner.finalized, false, 'foreground completion must wait for tracked background work before flushing');
        assert.ok(owner.active > 0);
    }

    turnStates.forEach(state => state.release());
    await Promise.all(turnStates.map(state => state.background));
    const files = await Promise.all(turnStates.map(({owner}) => PromptAuditLog.waitForFinalization(owner)));

    for (const state of turnStates) {
        const snapshot = snapshots.get(state.name);
        assert.equal(snapshot.requestId, state.name);
        assert.equal(snapshot.errorCount, 1);
        assert.equal(snapshot.rows.length, 1);
        assert.equal(snapshot.rows[0].metadataLabel, 'same-family');
        assert.equal(snapshot.rows[0].stage, 'npc-memory-selection');
        assert.equal(snapshot.rows[0].parser, 'history');
        assert.equal(snapshot.rows[0].checkpoint, 2);
        assert.equal(snapshot.rows[0].phase, 'validation');
        assert.equal(snapshot.rows[0].count, 1);
        assert.equal(snapshot.rows[0].outcome, 'recovered');
        assert.deepEqual(snapshot.rows[0].attempts, [2]);
        assert.deepEqual(snapshot.rows[0].logPaths, [promptLogReference(state.name)]);
        assert.equal(snapshot.endLocation.id, `${state.name}-end`);
        assert.equal(state.owner.rows.size, 0, 'finalized in-memory error rows should be released');
        assert.equal(state.owner.prompts.size, 0, 'finalized logical prompt owners should be released');
    }

    const [contentA, contentB] = await Promise.all(files.map(file => fs.promises.readFile(file, 'utf8')));
    assert.match(contentA, /1 x recovered \(1 recovered, 0 failed\)/);
    assert.match(contentB, /1 x recovered \(1 recovered, 0 failed\)/);
    assert.ok(contentA.includes(promptLogReference('turn-a')));
    assert.doesNotMatch(contentA, /turn-b|sk-audit-secret-turn-a|sk-audit-source-turn-a/);
    assert.match(contentB, /turn-b-prompt\.log/);
    assert.doesNotMatch(contentB, /turn-a|sk-audit-secret-turn-b|sk-audit-source-turn-b/);
});

test('shared background work fans out to only its reserved turn owners with independent outcomes', { concurrency: false }, async () => {
    const createOwner = async (name, failStage) => {
        let handle;
        const state = await PromptAuditLog.runTurn({
            requestId: name,
            route: 'image-prompt',
            logDirectory: makeLogDirectory()
        }, async () => {
            const owner = PromptAuditLog.currentTurn();
            try {
                await PromptAuditLog.runPrompt({ metadataLabel: 'image_prompt_generation', kind: 'image' }, async () => (
                    PromptAuditLog.runStage({ stage: 'image-text', parser: 'prompt' }, async () => {
                        handle = PromptAuditLog.reserveWork();
                        if (failStage) throw new Error(`${name} own validation failed.`);
                    })
                ));
            } catch (error) {
                assert.match(error.message, new RegExp(`${name} own validation failed`));
            }
            return { owner, handle };
        });
        return state;
    };

    const [recoveredOwner, failedOwner] = await Promise.all([
        createOwner('image-owner-a', false),
        createOwner('image-owner-b', true)
    ]);
    const sharedError = new Error('Shared image prompt transport failed.');
    let detachedTurn;
    await PromptAuditLog.withoutTurn(async () => {
        detachedTurn = PromptAuditLog.currentTurn();
        PromptAuditLog.addLogReference('/tmp/shared-image-prompt.log');
        PromptAuditLog.recordFailure(sharedError, {
            phase: 'transport',
            source: 'shared_image_prompt',
            logPath: '/tmp/shared-image-prompt.log'
        });
    }, { failureContexts: [recoveredOwner.handle, failedOwner.handle] });

    assert.equal(detachedTurn, null, 'shared work must run without selecting one request as the current owner');
    const recoveredSnapshot = PromptAuditLog.snapshot(recoveredOwner.owner);
    const failedSnapshot = PromptAuditLog.snapshot(failedOwner.owner);
    const recoveredRow = recoveredSnapshot.rows.find(row => row.message === sharedError.message);
    const failedSharedRow = failedSnapshot.rows.find(row => row.message === sharedError.message);
    assert.ok(recoveredRow);
    assert.ok(failedSharedRow);
    assert.equal(recoveredRow.count, 1);
    assert.equal(recoveredRow.recoveredCount, 1);
    assert.equal(recoveredRow.outcome, 'recovered');
    assert.equal(failedSharedRow.count, 1);
    assert.equal(failedSharedRow.failedCount, 1);
    assert.equal(failedSharedRow.outcome, 'failed');
    assert.ok(recoveredRow.logPaths.includes('/tmp/shared-image-prompt.log'));
    assert.ok(failedSharedRow.logPaths.includes('/tmp/shared-image-prompt.log'));
    assert.equal(recoveredSnapshot.rows.some(row => row.message.includes('image-owner-b own')), false);
    assert.equal(failedSnapshot.rows.some(row => row.message.includes('image-owner-a own')), false);

    recoveredOwner.handle.release();
    failedOwner.handle.release();
    const [recoveredFile, failedFile] = await Promise.all([
        PromptAuditLog.waitForFinalization(recoveredOwner.owner),
        PromptAuditLog.waitForFinalization(failedOwner.owner)
    ]);
    const [recoveredContent, failedContent] = await Promise.all([
        fs.promises.readFile(recoveredFile, 'utf8'),
        fs.promises.readFile(failedFile, 'utf8')
    ]);
    assert.match(recoveredContent, /1 x recovered \(1 recovered, 0 failed\).*Shared image prompt transport failed/s);
    assert.match(failedContent, /image-owner-b own validation failed/);
    assert.match(failedContent, /1 x failed \(0 recovered, 1 failed\).*Shared image prompt transport failed/s);
});

test('parse retries retain recovered checkpoint rows and a later terminal cause is counted once', { concurrency: false }, async () => {
    const logDirectory = makeLogDirectory();
    const recoveredError = new Error('Checkpoint A rejected malformed XML.');
    const terminalError = new Error('Checkpoint B rejected malformed XML.');
    let owner;
    let beforeFlush;
    let checkpointAAttempts = 0;
    let checkpointBAttempts = 0;

    await assert.rejects(PromptAuditLog.runTurn({
        requestId: 'parse-recovery-then-terminal',
        route: 'world-generation',
        logDirectory
    }, async () => {
        owner = PromptAuditLog.currentTurn();
        const checkpointA = await runPromptWithParseRetries({
            metadataLabel: 'region_generation',
            stage: 'checkpoint_A',
            parser: 'region-plan',
            messages: [{ role: 'user', content: 'PRIVATE_PROMPT_BODY_A' }],
            maxAttempts: 2,
            async complete({attempt}) {
                checkpointAAttempts += 1;
                PromptAuditLog.addLogReference('/tmp/region-plan.prompt.log');
                if (attempt === 1) {
                    PromptAuditLog.recordFailure(new Error('Legacy completion returned an empty response after transport failure.'), {
                        phase: 'transport',
                        attempt,
                        source: 'completion',
                        terminal: true
                    });
                    return '';
                }
                return 'VALID_A';
            },
            parse(response) {
                if (response !== 'VALID_A') throw recoveredError;
                return { approved: true };
            },
            buildRetryInstruction(error) { return `Correct checkpoint A: ${error.message}`; }
        });
        assert.deepEqual(checkpointA.value, { approved: true });
        assert.equal(checkpointA.attempts, 2);

        try {
            await runPromptWithParseRetries({
                metadataLabel: 'region_generation',
                stage: 'checkpoint_B',
                parser: 'region-document',
                messages: [{ role: 'user', content: 'PRIVATE_PROMPT_BODY_B' }],
                maxAttempts: 1,
                async complete() {
                    checkpointBAttempts += 1;
                    PromptAuditLog.addLogReference('/tmp/region-document.prompt.log');
                    return 'INVALID_B';
                },
                parse() { throw terminalError; },
                buildRetryInstruction(error) { return `Correct checkpoint B: ${error.message}`; }
            });
        } catch (error) {
            beforeFlush = PromptAuditLog.snapshot(owner);
            throw error;
        }
    }), /failed to parse after 1 attempt/i);

    assert.equal(checkpointAAttempts, 2);
    assert.equal(checkpointBAttempts, 1);
    assert.equal(beforeFlush.promptCount, 2);
    assert.equal(beforeFlush.errorCount, 3, 'legacy completion failure, one A parse failure, and one B failure; propagated causes are deduplicated');
    const rowA = beforeFlush.rows.find(row => row.stage === 'checkpoint_A' && row.phase === 'validation');
    const rowACompletion = beforeFlush.rows.find(row => row.stage === 'checkpoint_A' && row.phase === 'transport');
    const rowB = beforeFlush.rows.find(row => row.stage === 'checkpoint_B');
    assert.ok(rowA);
    assert.ok(rowB);
    assert.equal(rowA.parser, 'region-plan');
    assert.equal(rowA.count, 1);
    assert.equal(rowA.recoveredCount, 1);
    assert.equal(rowA.failedCount, 0);
    assert.equal(rowA.outcome, 'recovered');
    assert.deepEqual(rowA.attempts, [1]);
    assert.deepEqual(rowA.logPaths, ['/tmp/region-plan.prompt.log']);
    assert.ok(rowACompletion, 'the legacy completion failure remains visible after the parse helper recovers');
    assert.equal(rowACompletion.count, 1);
    assert.equal(rowACompletion.recoveredCount, 1);
    assert.equal(rowACompletion.outcome, 'recovered');
    assert.deepEqual(rowACompletion.attempts, [1]);
    assert.equal(rowB.parser, 'region-document');
    assert.equal(rowB.count, 1, 'terminal wrappers must not add another row for the same parse error');
    assert.equal(rowB.failedCount, 1);
    assert.equal(rowB.outcome, 'failed');
    assert.deepEqual(rowB.attempts, [1]);
    assert.deepEqual(rowB.logPaths, ['/tmp/region-document.prompt.log']);

    const filePath = await PromptAuditLog.waitForFinalization(owner);
    const content = await fs.promises.readFile(filePath, 'utf8');
    assert.match(content, /1 x recovered \(1 recovered, 0 failed\).*region_generation \| checkpoint_A\/region-plan/s);
    assert.match(content, /1 x failed \(0 recovered, 1 failed\).*region_generation \| checkpoint_B\/region-document/s);
    assert.doesNotMatch(content, /PRIVATE_PROMPT_BODY_[AB]|INVALID_[AB]/);
    assert.equal(PromptAuditLog.snapshot(owner).rows.length, 0);
});

test('real TinyBrain stages and mocked LLMClient traffic produce one redacted per-turn audit', { concurrency: false }, async () => {
    const baseDir = makeLogDirectory();
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRealtimeHub = Globals.realtimeHub;
    const providerPayloads = [];
    const realtimeEvents = [];
    const providerMessages = [
        'INVALID_A_1', 'INVALID_A_2', 'VALID_A',
        'INVALID_B_1', 'INVALID_B_2', 'INVALID_B_3'
    ];
    const checkpointError = new Error('Checkpoint A parser rejected the response.');
    const finalError = new Error('Final checkpoint parser rejected the response.');
    let owner;
    let beforeFlush;

    Globals.baseDir = baseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'prompt-audit-test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            supress_seed: true,
            prefill: null
        },
        chat_tools: { request_user_input_enabled: false }
    };
    Globals.realtimeHub = { emit(_room, type, payload) { if (type === 'prompt_failed') realtimeEvents.push(payload); } };
    axios.post = async (_endpoint, payload) => {
        providerPayloads.push(structuredClone(payload));
        const content = providerMessages.shift();
        assert.notEqual(content, undefined, 'The mocked provider must cover every staged completion.');
        return makeProviderResponse(payload, { role: 'assistant', content });
    };

    const promptEnv = makePromptEnvironment('Plan the region. {% llmparse("region_plan") as plan %} Write the final region document.');
    const renderState = TinyBrainPromptRunner.createRenderState();
    const templateContext = { __tinyBrainState: renderState };
    const initialRenderedTemplate = promptEnv.render('wrapper.xml.njk', templateContext);
    const runner = new TinyBrainPromptRunner({
        promptEnv,
        parseXMLTemplate: parsePromptWrapper,
        metadataLabel: 'audit_region_tinybrain',
        logPrefix: 'audit_region_tinybrain',
        retryAttempts: 2,
        toolDefinitions: [],
        parsers: {
            region_plan(response) {
                if (response !== 'VALID_A') throw checkpointError;
                return { value: 'approved-plan' };
            }
        },
        finalParser() { throw finalError; },
        async complete({messages}) {
            const aiResponse = await LLMClient.chatCompletion({
                messages,
                metadataLabel: 'audit_region_tinybrain',
                validateXML: false,
                stream: false,
                retryAttempts: 0,
                output: 'silent'
            });
            return {
                aiResponse,
                conversationMessages: [...messages, { role: 'assistant', content: aiResponse }],
                toolInvocations: []
            };
        }
    });

    try {
        await assert.rejects(PromptAuditLog.runTurn({
            requestId: 'tinybrain-audit-integration',
            route: 'region-generation',
            startLocation: { id: 'region-source', name: 'Source Region' },
            logDirectory: path.join(baseDir, 'turn-logs')
        }, async () => {
            owner = PromptAuditLog.currentTurn();
            try {
                await runner.run({
                    initialRenderedTemplate,
                    templateContext,
                    renderState,
                    programTemplateName: 'program.njk'
                });
            } catch (error) {
                beforeFlush = PromptAuditLog.snapshot(owner);
                throw error;
            }
        }), /failed to parse after 3 attempts/i);

        assert.equal(providerPayloads.length, 6);
        assert.equal(providerMessages.length, 0);
        assert.equal(realtimeEvents.length, 1);
        assert.equal(realtimeEvents[0].metadataLabel, 'audit_region_tinybrain');
        assert.equal(beforeFlush.promptCount, 1, 'TinyBrain and its same-label completions share one logical prompt owner');
        assert.equal(beforeFlush.errorCount, 5, 'two A parser failures plus three terminal parser attempts');

        const checkpointA = beforeFlush.rows.find(row => row.stage === 'checkpoint_1');
        const finalStage = beforeFlush.rows.find(row => row.stage === 'final');
        assert.ok(checkpointA);
        assert.ok(finalStage);
        assert.equal(checkpointA.parser, 'region_plan');
        assert.equal(checkpointA.checkpoint, 1);
        assert.equal(checkpointA.count, 2);
        assert.equal(checkpointA.recoveredCount, 2);
        assert.equal(checkpointA.outcome, 'recovered');
        assert.equal(finalStage.parser, 'final_response');
        assert.equal(finalStage.checkpoint, null);
        assert.equal(finalStage.count, 3);
        assert.equal(finalStage.failedCount, 3);
        assert.equal(finalStage.outcome, 'failed');
        assert.ok([...checkpointA.logPaths, ...finalStage.logPaths].some(logPath => logPath.includes(`${path.sep}logs${path.sep}`)));
        assert.ok(JSON.stringify(providerPayloads[1]).includes('INVALID_A_1'), 'first correction retains the rejected response');
        assert.ok(JSON.stringify(providerPayloads[2]).includes('INVALID_A_1'), 'same-checkpoint retries retain previous rejected responses until progress');

        const auditFile = await PromptAuditLog.waitForFinalization(owner);
        const auditContent = await fs.promises.readFile(auditFile, 'utf8');
        assert.match(auditContent, /2 x recovered \(2 recovered, 0 failed\).*audit_region_tinybrain \| checkpoint_1\/region_plan/s);
        assert.match(auditContent, /3 x failed \(0 recovered, 3 failed\).*audit_region_tinybrain \| final\/final_response/s);
        assert.doesNotMatch(auditContent, /INVALID_[AB]_[123]|VALID_A|Test system|Fixed context/);
        assert.equal(PromptAuditLog.snapshot(owner).rows.length, 0);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.realtimeHub = originalRealtimeHub;
    }
});

test('native tool failures from the real tool loop are retained as one recovered tool occurrence', { concurrency: false }, async () => {
    const baseDir = makeLogDirectory();
    const originalAxiosPost = axios.post;
    const originalConfig = Globals.config;
    const originalBaseDir = Globals.baseDir;
    const originalRealtimeHub = Globals.realtimeHub;
    const providerMessages = [
        {
            role: 'assistant',
            content: null,
            tool_calls: [{
                id: 'audit-invalid-more-info',
                type: 'function',
                function: { name: 'moreInfo', arguments: '{"name":17}' }
            }]
        },
        { role: 'assistant', content: 'I can continue with the available information.' }
    ];
    const providerPayloads = [];
    let owner;
    let insideSnapshot;

    Globals.baseDir = baseDir;
    Globals.config = {
        ai: {
            backend: 'openai_compatible',
            endpoint: 'https://example.invalid/v1/chat/completions',
            apiKey: 'test-key',
            model: 'prompt-audit-tool-test-model',
            stream: false,
            retryAttempts: 0,
            max_concurrent_requests: 1,
            max_tool_rounds: 2,
            supress_seed: true,
            prefill: null
        },
        chat_tools: { request_user_input_enabled: false }
    };
    Globals.realtimeHub = { emit() {} };
    axios.post = async (_endpoint, payload) => {
        providerPayloads.push(structuredClone(payload));
        const message = providerMessages.shift();
        assert.ok(message, 'The real tool loop should use both canned responses.');
        return makeProviderResponse(payload, message);
    };

    const runtime = createChatToolRuntime({
        getConfig: () => ({ ai: Globals.config.ai, max_tool_calls: 2 }),
        getChatHistory: () => [],
        isAssistantProseLikeEntry: () => true,
        serializeNpcForClient: () => ({}),
        buildLocationResponse: () => ({}),
        getCurrentPlayer: () => ({ currentLocation: 'audit-location' }),
        createLocationFromEvent: async () => { throw new Error('Unexpected world write.'); },
        createRegionStubFromEvent: async () => { throw new Error('Unexpected region write.'); },
        generateItemsByNames: async () => { throw new Error('Unexpected item write.'); },
        ensureExitConnection: () => { throw new Error('Unexpected exit write.'); },
        findRegionByLocationId: () => null,
        LLMClient,
        Player,
        Thing,
        Location,
        Region,
        getGameLocations: () => new Map(),
        getFactions: () => [],
        getRegionsMap: () => new Map(),
        getPendingRegionStubs: () => new Map()
    });

    try {
        const result = await PromptAuditLog.runTurn({
            requestId: 'native-tool-audit',
            route: 'chat',
            logDirectory: path.join(baseDir, 'turn-logs')
        }, async () => {
            owner = PromptAuditLog.currentTurn();
            const response = await runtime.runChatCompletionWithToolLoop({
                requestOptions: {
                    messages: [{ role: 'user', content: 'Look up an invalidly typed name.' }],
                    metadataLabel: 'audit_native_tool',
                    additionalPayload: {
                        tools: [CHAT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'moreInfo')],
                        tool_choice: 'auto'
                    },
                    validateXML: false,
                    stream: false,
                    retryAttempts: 0,
                    output: 'silent'
                },
                metadataLabel: 'audit_native_tool',
                allowedToolNames: ['moreInfo']
            });
            insideSnapshot = PromptAuditLog.snapshot(owner);
            return response;
        });

        assert.equal(result.aiResponse, 'I can continue with the available information.');
        assert.equal(providerMessages.length, 0);
        assert.equal(providerPayloads.length, 2);
        assert.equal(insideSnapshot.errorCount, 1);
        assert.equal(insideSnapshot.promptCount, 1);
        assert.equal(insideSnapshot.rows.length, 1);
        assert.equal(insideSnapshot.rows[0].metadataLabel, 'audit_native_tool');
        assert.equal(insideSnapshot.rows[0].phase, 'tool');
        assert.equal(insideSnapshot.rows[0].category, 'tool');
        assert.equal(insideSnapshot.rows[0].toolName, 'moreInfo');
        assert.equal(insideSnapshot.rows[0].source, 'native_tool');
        assert.equal(insideSnapshot.rows[0].count, 1);
        assert.equal(insideSnapshot.rows[0].outcome, 'recovered');

        const auditFile = await PromptAuditLog.waitForFinalization(owner);
        const auditContent = await fs.promises.readFile(auditFile, 'utf8');
        assert.match(auditContent, /1 x recovered \(1 recovered, 0 failed\).*audit_native_tool \| completion \| checkpoint=- attempts=- \| tool\/tool/);
        assert.match(auditContent, /moreInfo/);
        assert.doesNotMatch(auditContent, /"name":17|Look up an invalidly typed name/);
    } finally {
        axios.post = originalAxiosPost;
        Globals.config = originalConfig;
        Globals.baseDir = originalBaseDir;
        Globals.realtimeHub = originalRealtimeHub;
    }
});

test('context-limit classification takes precedence and quoted JSON credentials are redacted', { concurrency: false }, async () => {
    const logDirectory = makeLogDirectory();
    let owner;
    let snapshot;
    const message = 'Context length exceeds the model token limit; payload {"api_key":"sk-quoted-secret","authorization":"Bearer quoted-bearer-secret","password":"quoted-password-secret"}';
    await PromptAuditLog.runTurn({
        requestId: 'redaction-and-category',
        route: 'chat',
        logDirectory
    }, async () => {
        owner = PromptAuditLog.currentTurn();
        await PromptAuditLog.runPrompt({ metadataLabel: 'context_limited_lookup' }, async () => {
            await PromptAuditLog.runStage({ stage: 'lookup', parser: 'entity' }, async () => {
                PromptAuditLog.recordFailure(new Error(message), {
                    phase: 'tool',
                    toolName: 'moreInfo',
                    source: 'native_tool'
                });
                snapshot = PromptAuditLog.snapshot(owner);
            });
        });
    });

    assert.equal(snapshot.errorCount, 1);
    assert.equal(snapshot.rows[0].phase, 'tool');
    assert.equal(snapshot.rows[0].category, 'context-limit');
    const auditFile = await PromptAuditLog.waitForFinalization(owner);
    const content = await fs.promises.readFile(auditFile, 'utf8');
    assert.match(content, /tool\/context-limit/);
    assert.doesNotMatch(content, /sk-quoted-secret|quoted-bearer-secret|quoted-password-secret/);
});

test('the API route audit wrapper captures request id and start/end locations around its handler', { concurrency: false }, async () => {
    const helperStart = apiSource.indexOf('        function withTurnPromptAudit(route, handler) {');
    const helperEnd = apiSource.indexOf('        scope.waitForTurnContextWork =', helperStart);
    assert.notEqual(helperStart, -1, 'Could not locate the API turn wrapper');
    assert.notEqual(helperEnd, -1, 'Could not locate the API helper after the turn wrapper');

    const originalBaseDir = Globals.baseDir;
    const baseDir = makeLogDirectory();
    Globals.baseDir = baseDir;
    const player = { currentLocation: 'start-location' };
    const locations = new Map([
        ['start-location', { id: 'start-location', name: 'Starting Location' }],
        ['end-location', { id: 'end-location', name: 'Ending Location' }]
    ]);
    const context = {
        PromptAuditLog,
        currentPlayer: player,
        gameLocations: locations,
        chatHistory: [],
        EventReprocessor: { runTurn: (_options, callback) => callback() }
    };
    try {
        vm.runInNewContext(`${apiSource.slice(helperStart, helperEnd)}\nglobalThis.withTurnPromptAudit = withTurnPromptAudit;`, context);
        let owner;
        const handler = context.withTurnPromptAudit('/api/chat', async (req, res) => {
            owner = PromptAuditLog.currentTurn();
            assert.equal(owner.requestId, 'audit-request-123');
            assert.equal(owner.route, '/api/chat');
            assert.deepEqual(owner.startLocation, { id: 'start-location', name: 'Starting Location' });
            player.currentLocation = 'end-location';
            await PromptAuditLog.runPrompt({ metadataLabel: 'api_handler_prompt' }, async () => {
                await PromptAuditLog.runStage({ stage: 'response', parser: 'test' }, async () => {
                    PromptAuditLog.recordFailure(new Error('Route-owned recoverable parser issue.'), { phase: 'validation' });
                });
            });
            return { requestId: req.body.requestId, status: res.statusCode || 200 };
        });

        const result = await handler({ body: { requestId: 'audit-request-123' } }, { statusCode: 200 });
        assert.deepEqual(result, { requestId: 'audit-request-123', status: 200 });
        const auditFile = await PromptAuditLog.waitForFinalization(owner);
        const content = await fs.promises.readFile(auditFile, 'utf8');
        assert.match(content, /Turn: audit-request-123/);
        assert.match(content, /Route: \/api\/chat/);
        assert.match(content, /Starting Location \[start-location\] -> Ending Location \[end-location\]/);
        assert.match(content, /api_handler_prompt \| response\/test/);
    } finally {
        Globals.baseDir = originalBaseDir;
    }
});

test('a swallowed supplemental-story parser failure is retained by its audited background owner', { concurrency: false }, async () => {
    const completionHelperStart = apiSource.indexOf('async function completeWithValidatedResponse(options, parseResponse) {');
    const completionHelperEnd = apiSource.indexOf('\nconst PromptAuditLog = require(', completionHelperStart);
    const helperStart = apiSource.indexOf('        function runAuditedBackgroundPrompt(metadataLabel, operation) {');
    const helperEnd = apiSource.indexOf('        function runOffscreenNpcActivityPrompt(', helperStart);
    const parserStart = apiSource.indexOf('        function parseSupplementalStoryInfoResponse(rawResponse) {');
    const parserEnd = apiSource.indexOf('        function parseGameIntroResponse(', parserStart);
    const sanitizerStart = apiSource.indexOf('        function sanitizeForXml(input) {');
    const sanitizerEnd = apiSource.indexOf('        const playerActionProseRegex =', sanitizerStart);
    const stripperStart = apiSource.indexOf('        function stripToXmlPayload(input) {');
    const stripperEnd = apiSource.indexOf('        function extractPlayerActionXmlPayload(', stripperStart);
    const supplementalStart = apiSource.indexOf('        function runSupplementalStoryInfo(options) {');
    const supplementalEnd = apiSource.indexOf('        async function runGameIntroPrompt(', supplementalStart);
    for (const [start, end, label] of [
        [completionHelperStart, completionHelperEnd, 'validated completion helper'],
        [helperStart, helperEnd, 'audited-background helper'],
        [parserStart, parserEnd, 'supplemental parser'],
        [sanitizerStart, sanitizerEnd, 'XML sanitizer'],
        [stripperStart, stripperEnd, 'XML payload stripper'],
        [supplementalStart, supplementalEnd, 'supplemental-story prompt']
    ]) {
        assert.notEqual(start, -1, `Could not locate ${label}`);
        assert.notEqual(end, -1, `Could not locate the end of ${label}`);
    }

    const contextErrors = [];
    const warnings = [];
    const context = {
        PromptAuditLog,
        trackTurnContextWork: work => PromptAuditLog.trackWork(work),
        getContextRuntimeGeneration: () => 1,
        recordTurnContextError: error => contextErrors.push(error),
        config: { ai: {} },
        LLMClient: {
            async chatCompletion(options = {}) {
                const response = 'PRIVATE_SUPPLEMENTAL_RESPONSE_BODY';
                if (options.responseValidator) {
                    try { await options.responseValidator(response); }
                    catch (error) {
                        await this.logPrompt({ prefix: options.metadataLabel, metadataLabel: options.metadataLabel, response });
                        PromptAuditLog.recordFailure(error, {
                            metadataLabel: options.metadataLabel,
                            phase: 'validation',
                            source: 'completion'
                        });
                        throw error;
                    }
                }
                return response;
            },
            logPrompt() {
                PromptAuditLog.addLogReference('/tmp/supplemental-story-info.prompt.log');
                return '/tmp/supplemental-story-info.prompt.log';
            }
        },
        Utils,
        prepareBasePromptContext: async () => ({ player: { name: 'Fixture Player' } }),
        promptEnv: { render: () => '<template />' },
        parseXMLTemplate: () => ({ systemPrompt: 'system', generationPrompt: 'request' }),
        currentPlayer: { currentLocation: 'supplemental-location' },
        requireLocationId: value => value,
        pushChatEntry() { throw new Error('A failed parser must not write a chat entry.'); },
        console: { warn: (...args) => warnings.push(args.join(' ')), info() {} }
    };

    vm.runInNewContext([
        apiSource.slice(completionHelperStart, completionHelperEnd),
        'let supplementalStoryInfoInProgress = false;',
        apiSource.slice(sanitizerStart, sanitizerEnd),
        apiSource.slice(stripperStart, stripperEnd),
        apiSource.slice(parserStart, parserEnd),
        apiSource.slice(helperStart, helperEnd),
        apiSource.slice(supplementalStart, supplementalEnd),
        'globalThis.runSupplementalStoryInfo = runSupplementalStoryInfo;'
    ].join('\n'), context);

    let owner;
    let backgroundWork;
    const baseDir = makeLogDirectory();
    await PromptAuditLog.runTurn({
        requestId: 'swallowed-background-parser-error',
        route: 'chat',
        logDirectory: path.join(baseDir, 'turn-logs')
    }, async () => {
        owner = PromptAuditLog.currentTurn();
        backgroundWork = context.runSupplementalStoryInfo({});
    });

    assert.equal(await backgroundWork, null, 'the existing API contract swallows this auxiliary prompt failure');
    assert.equal(contextErrors.length, 1);
    assert.match(contextErrors[0].message, /missing XML content/i);
    assert.ok(warnings.some(message => /Failed to run supplemental story info prompt/.test(message)));
    const auditFile = await PromptAuditLog.waitForFinalization(owner);
    const auditContent = await fs.promises.readFile(auditFile, 'utf8');
    assert.match(auditContent, /1 x failed \(0 recovered, 1 failed\).*supplemental_story_info \| response\/supplemental_story_info \| checkpoint=- attempts=- \| validation\/xml/s);
    assert.match(auditContent, /supplemental-story-info\.prompt\.log/);
    assert.doesNotMatch(auditContent, /PRIVATE_SUPPLEMENTAL_RESPONSE_BODY/);
});

test('clean and caller-cancelled turns write compact summaries without prompt errors', { concurrency: false }, async () => {
    const cleanDirectory = makeLogDirectory();
    let cleanOwner;
    const cleanResult = await PromptAuditLog.runTurn({
        requestId: 'clean-turn',
        route: 'chat',
        logDirectory: cleanDirectory
    }, async () => {
        cleanOwner = PromptAuditLog.currentTurn();
        return 'clean response';
    });
    assert.equal(cleanResult, 'clean response');
    const cleanFile = await PromptAuditLog.waitForFinalization(cleanOwner);
    const cleanContent = await fs.promises.readFile(cleanFile, 'utf8');
    assert.match(cleanContent, /Error occurrences: 0 \| Cancelled prompts: 0/);
    assert.match(cleanContent, /Clean turn: no prompt errors\./);

    const cancelledDirectory = makeLogDirectory();
    const controller = new AbortController();
    controller.abort(new DOMException('Caller ended the request.', 'AbortError'));
    let cancelledOwner;
    await PromptAuditLog.runTurn({
        requestId: 'cancelled-turn',
        route: 'chat',
        logDirectory: cancelledDirectory
    }, async () => {
        cancelledOwner = PromptAuditLog.currentTurn();
        await assert.rejects(PromptFailureReporter.run({
            metadataLabel: 'cancelled_prompt',
            signal: controller.signal
        }, async () => { throw controller.signal.reason; }), error => error === controller.signal.reason);
    });
    const cancelledSnapshot = PromptAuditLog.snapshot(cancelledOwner);
    assert.equal(cancelledSnapshot.errorCount, 0);
    assert.equal(cancelledSnapshot.cancelledCount, 1);
    const cancelledFile = await PromptAuditLog.waitForFinalization(cancelledOwner);
    const cancelledContent = await fs.promises.readFile(cancelledFile, 'utf8');
    assert.match(cancelledContent, /Error occurrences: 0 \| Cancelled prompts: 1/);
    assert.match(cancelledContent, /Clean turn: no prompt errors\./);
});

test('turn audit writer failures reject finalization and release retained rows', { concurrency: false }, async () => {
    const blockerDirectory = makeLogDirectory();
    const blockerPath = path.join(blockerDirectory, 'not-a-directory');
    fs.writeFileSync(blockerPath, 'fixture');
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(' '));
    let owner;
    try {
        await PromptAuditLog.runTurn({
            requestId: 'audit-write-failure',
            logDirectory: path.join(blockerPath, 'logs')
        }, async () => {
            owner = PromptAuditLog.currentTurn();
            await PromptAuditLog.runPrompt({ metadataLabel: 'write_failure' }, async () => {
                await PromptAuditLog.runStage({ stage: 'writer', parser: 'test' }, async () => {
                    PromptAuditLog.recordFailure(new Error('Writer fixture error.'), { phase: 'validation' });
                });
            });
        });
        await assert.rejects(PromptAuditLog.waitForFinalization(owner), /ENOTDIR|EEXIST/);
        assert.equal(owner.finalized, true);
        assert.equal(owner.rows.size, 0);
        assert.ok(warnings.some(line => /Failed to write turn prompt audit/.test(line)));
    } finally {
        console.warn = originalWarn;
    }
});

test('new-game route uses the turn audit wrapper and owns XML enforcement', async () => {
    assert.match(apiSource, /app\.post\('\/api\/new-game',\s*withTurnPromptAudit\('\/api\/new-game'/);
    const helperStart = apiSource.indexOf('        function withTurnPromptAudit(route, handler) {');
    const helperEnd = apiSource.indexOf('        scope.waitForTurnContextWork =', helperStart);
    const original = Globals.baseDir; Globals.baseDir = makeLogDirectory();
    const ctx = { PromptAuditLog, currentPlayer: null, gameLocations: new Map(), chatHistory: [], EventReprocessor: { runTurn: (_args, callback) => callback() } };
    try {
        vm.runInNewContext(`${apiSource.slice(helperStart, helperEnd)}\nglobalThis.wrap = withTurnPromptAudit;`, ctx);
        let owner;
        await ctx.wrap('/api/new-game', async () => {
            owner = PromptAuditLog.currentTurn();
            assert.equal(owner.requestId, 'new-game-audit');
            const observer = PromptAuditLog.beginXmlEnforcement({ metadataLabel: 'region_generation', schema: 'region.schema.xml' });
            observer.generationStarted({ attempt: 1 });
        })({ body: { requestId: 'new-game-audit' } }, {});
        const file = await PromptAuditLog.waitForFinalization(owner);
        const text = await fs.promises.readFile(file, 'utf8');
        assert.match(text, /Route: \/api\/new-game/);
        assert.match(text, /region_generation.*schema=region\.schema\.xml/);
    } finally { Globals.baseDir = original; }
});
