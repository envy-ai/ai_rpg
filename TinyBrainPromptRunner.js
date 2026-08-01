const { randomUUID } = require('crypto');
const LLMClient = require('./LLMClient.js');

const MARKER_PREFIX = '[[TINYBRAIN_CHECKPOINT:';

function requireNonWhitespaceResponse(response, label = 'Tiny-brain checkpoint') {
    if (typeof response !== 'string' || !response.trim()) {
        throw new Error(`${label} requires a non-whitespace LLM response.`);
    }
    return response;
}

function parseAcceptOrReject(response) {
    const normalized = requireNonWhitespaceResponse(response, 'accept_or_reject parser');
    const rejectedMatch = normalized.match(/<rejected\b[^>]*>[\s\S]*?<\/rejected\s*>/i);
    const acceptedMatch = normalized.match(/<accepted\b[^>]*>[\s\S]*?<\/accepted\s*>/i);

    if (rejectedMatch && acceptedMatch) {
        throw new Error('accept_or_reject response cannot contain both <accepted> and <rejected>.');
    }
    if (rejectedMatch) {
        return {
            terminate: true,
            response: rejectedMatch[0].trim(),
            value: false
        };
    }
    if (acceptedMatch) {
        return { value: true };
    }
    throw new Error('accept_or_reject response must contain <accepted></accepted> or <rejected>...</rejected>.');
}

function parsePlayerIsTraveling(response) {
    const normalized = requireNonWhitespaceResponse(response, 'player_is_traveling parser');
    const match = normalized.match(/<travel\b[^>]*>\s*(yes|no)\s*<\/travel\s*>/i);
    if (!match) {
        throw new Error('player_is_traveling response must contain <travel>yes</travel> or <travel>no</travel>.');
    }
    return { value: match[1].toLowerCase() === 'yes' };
}

function normalizeShortParserResponse(response, label) {
    return requireNonWhitespaceResponse(response, label)
        .trim()
        .replace(/^```(?:text)?\s*/i, '')
        .replace(/\s*```$/, '')
        .replace(/^[*_`~]+|[*_`~]+$/g, '')
        .trim()
        .toLowerCase();
}

function parseResponseOrNa(response) {
    const normalized = normalizeShortParserResponse(response, 'response_or_na parser')
        .replace(/[.!]+$/g, '')
        .trim();
    const naToken = 'n\\s*(?:[/._-]\\s*)?a';
    const startsOrEndsWithNa = new RegExp(
        `^(?:${naToken})(?=\\W|$)|(?:^|\\W)(?:${naToken})$`,
        'i'
    ).test(normalized);
    if (startsOrEndsWithNa) {
        return { value: false };
    }
    const compact = normalized.replace(/[\s/_.-]+/g, '');
    const noResponseValues = new Set([
        'na',
        'notapplicable',
        'none',
        'noneidentified',
        'nonefound',
        'no',
        'noissue',
        'noissues',
        'noissuesidentified',
        'noissuesfound',
        'nothing',
        'nothingidentified',
        'nothingfound'
    ]);
    return { value: !noResponseValues.has(compact) };
}

function parseYesNo(response) {
    const normalized = normalizeShortParserResponse(response, 'yes_no parser');
    const match = normalized.match(/^(?:answer\s*:\s*)?(yes|no)\b/i);
    if (!match) {
        throw new Error('yes_no response must begin with yes or no.');
    }
    return { value: match[1].toLowerCase() === 'yes' };
}

function parseModStep(response) {
    return { value: requireNonWhitespaceResponse(response, 'mod step parser').trim() };
}

function cloneMessage(message) {
    if (!message || typeof message !== 'object') {
        throw new Error('Tiny-brain completion returned an invalid conversation message.');
    }
    return JSON.parse(JSON.stringify(message));
}

function createTinyBrainRenderState() {
    const runId = randomUUID();
    return {
        runId,
        programStartMarker: `[[TINYBRAIN_PROGRAM_START:${runId}]]`,
        nextCheckpointIndex: 0,
        checkpoints: [],
        completedCheckpoints: Object.create(null)
    };
}

class TinyBrainPromptExtension {
    constructor() {
        this.tags = ['llm_dummy_action', 'llmparse'];
    }

    parse(parser, nodes) {
        const token = parser.nextToken();
        if (token.value === 'llm_dummy_action') {
            parser.advanceAfterBlockEnd(token.value);
            return new nodes.CallExtension(this, 'renderDummyCheckpoint');
        }

        const args = parser.parseSignature(null, false);
        let target = null;
        if (parser.skipSymbol('as')) {
            const targetNode = parser.parsePrimary();
            if (!(targetNode instanceof nodes.Symbol)) {
                parser.fail('llmparse assignment target must be a variable name.', targetNode.lineno, targetNode.colno);
            }
            target = targetNode.value;
        }
        parser.advanceAfterBlockEnd(token.value);
        args.addChild(new nodes.Literal(token.lineno, token.colno, JSON.stringify({ target })));
        return new nodes.CallExtension(this, 'renderParserCheckpoint', args);
    }

    renderDummyCheckpoint(context) {
        return this.#renderCheckpoint(context, {
            kind: 'dummy',
            parserName: null,
            parserArgs: [],
            target: null
        });
    }

    renderParserCheckpoint(context, parserName, ...runtimeArgs) {
        const descriptorText = runtimeArgs.pop();
        let descriptor = null;
        try {
            descriptor = JSON.parse(descriptorText);
        } catch (error) {
            throw new Error(`llmparse received an invalid assignment descriptor: ${error.message}`);
        }
        if (typeof parserName !== 'string' || !parserName.trim()) {
            throw new Error('llmparse requires a non-empty parser name as its first argument.');
        }
        return this.#renderCheckpoint(context, {
            kind: 'parse',
            parserName: parserName.trim(),
            parserArgs: runtimeArgs,
            target: descriptor?.target || null
        });
    }

    #renderCheckpoint(context, checkpoint) {
        const state = typeof context?.lookup === 'function'
            ? context.lookup('__tinyBrainState')
            : context?.ctx?.__tinyBrainState;
        if (!state || typeof state !== 'object' || typeof state.runId !== 'string') {
            throw new Error('Tiny-brain prompt tags require a __tinyBrainState render context.');
        }
        if (!Number.isInteger(state.nextCheckpointIndex) || !Array.isArray(state.checkpoints)) {
            throw new Error('Tiny-brain prompt render state is malformed.');
        }

        const index = state.nextCheckpointIndex;
        state.nextCheckpointIndex += 1;
        const resolvedCheckpoint = {
            index,
            ...checkpoint
        };
        state.checkpoints.push(resolvedCheckpoint);

        const completed = state.completedCheckpoints?.[index];
        if (completed && checkpoint.target) {
            context.setVariable(checkpoint.target, completed.value);
        }

        return `${MARKER_PREFIX}${state.runId}:${index}]]`;
    }
}

class TinyBrainPromptRunner {
    constructor({
        promptEnv,
        parseXMLTemplate,
        complete,
        retryAttempts,
        parsers = {},
        finalParser = null,
        onParseFailure = null,
        logPrompt = LLMClient.logPrompt.bind(LLMClient),
        metadataLabel = 'player_action_tinybrain',
        logPrefix = 'player_action_tinybrain'
    } = {}) {
        if (!promptEnv || typeof promptEnv.render !== 'function') {
            throw new Error('TinyBrainPromptRunner requires a Nunjucks prompt environment.');
        }
        if (typeof parseXMLTemplate !== 'function') {
            throw new Error('TinyBrainPromptRunner requires parseXMLTemplate.');
        }
        if (typeof complete !== 'function') {
            throw new Error('TinyBrainPromptRunner requires a completion callback.');
        }
        if (!Number.isInteger(retryAttempts) || retryAttempts < 0) {
            throw new Error('TinyBrainPromptRunner retryAttempts must be a non-negative integer.');
        }
        if (!parsers || typeof parsers !== 'object' || Array.isArray(parsers)) {
            throw new Error('TinyBrainPromptRunner parsers must be an object.');
        }
        if (finalParser !== null && typeof finalParser !== 'function') {
            throw new Error('TinyBrainPromptRunner finalParser must be a function when provided.');
        }
        if (onParseFailure !== null && typeof onParseFailure !== 'function') {
            throw new Error('TinyBrainPromptRunner onParseFailure must be a function when provided.');
        }
        if (typeof logPrompt !== 'function') {
            throw new Error('TinyBrainPromptRunner requires a prompt logger.');
        }

        this.promptEnv = promptEnv;
        this.parseXMLTemplate = parseXMLTemplate;
        this.complete = complete;
        this.retryAttempts = retryAttempts;
        this.parsers = {
            accept_or_reject: parseAcceptOrReject,
            player_is_traveling: parsePlayerIsTraveling,
            response_or_na: parseResponseOrNa,
            yes_no: parseYesNo,
            ...parsers
        };
        this.finalParser = finalParser;
        this.onParseFailure = onParseFailure;
        this.logPrompt = logPrompt;
        this.metadataLabel = metadataLabel;
        this.logPrefix = logPrefix;
    }

    static createRenderState() {
        return createTinyBrainRenderState();
    }

    async run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName = '_includes/player-action.tinybrain.njk'
    } = {}) {
        if (typeof initialRenderedTemplate !== 'string' || !initialRenderedTemplate.trim()) {
            throw new Error('TinyBrainPromptRunner requires the initially rendered prompt template.');
        }
        if (!templateContext || typeof templateContext !== 'object') {
            throw new Error('TinyBrainPromptRunner requires the template context.');
        }
        if (!renderState || typeof renderState !== 'object' || typeof renderState.programStartMarker !== 'string') {
            throw new Error('TinyBrainPromptRunner requires its initial render state.');
        }

        const promptData = this.parseXMLTemplate(initialRenderedTemplate);
        const systemPrompt = typeof promptData.systemPrompt === 'string' ? promptData.systemPrompt.trim() : '';
        const initialGenerationPrompt = typeof promptData.generationPrompt === 'string'
            ? promptData.generationPrompt
            : '';
        if (!systemPrompt) {
            throw new Error('Tiny-brain prompt is missing its system prompt.');
        }
        const programStartIndex = initialGenerationPrompt.indexOf(renderState.programStartMarker);
        if (programStartIndex < 0) {
            throw new Error('Tiny-brain prompt is missing its program start marker.');
        }
        if (initialGenerationPrompt.indexOf(renderState.programStartMarker, programStartIndex + 1) >= 0) {
            throw new Error('Tiny-brain prompt contains more than one program start marker.');
        }

        const fixedGenerationPrefix = initialGenerationPrompt.slice(0, programStartIndex);
        let renderedProgram = initialGenerationPrompt.slice(
            programStartIndex + renderState.programStartMarker.length
        );
        let checkpoints = renderState.checkpoints.map(checkpoint => ({ ...checkpoint }));
        let completedCount = 0;
        const completedCheckpointDefinitions = [];
        let messages = [{ role: 'system', content: systemPrompt }];
        let logFilePath = null;
        const allToolInvocations = [];

        while (true) {
            const split = this.#splitProgram({
                generationPrompt: fixedGenerationPrefix + renderedProgram,
                checkpoints,
                renderState
            });

            if (completedCount < checkpoints.length) {
                const checkpoint = checkpoints[completedCount];
                const promptSegment = split.segments[completedCount];
                const parser = this.#resolveCheckpointParser(checkpoint);
                const stepResult = await this.#runCompletionStep({
                    messages,
                    promptSegment,
                    checkpoint,
                    parser,
                    logFilePath,
                    systemPrompt,
                    isFinal: false
                });
                messages = stepResult.messages;
                logFilePath = stepResult.logFilePath;
                allToolInvocations.push(...stepResult.toolInvocations);

                if (stepResult.parsed.terminate) {
                    return {
                        aiResponse: stepResult.parsed.response,
                        conversationMessages: messages,
                        toolInvocations: allToolInvocations,
                        logFilePath,
                        terminatedAtCheckpoint: completedCount
                    };
                }

                renderState.completedCheckpoints[completedCount] = {
                    value: stepResult.parsed.value
                };
                completedCheckpointDefinitions.push({ ...checkpoint });
                completedCount += 1;
                const rerendered = this.#renderProgram({
                    programTemplateName,
                    templateContext,
                    renderState
                });
                renderedProgram = rerendered.renderedProgram;
                checkpoints = rerendered.checkpoints;
                this.#validateCompletedCheckpoints(checkpoints, completedCheckpointDefinitions);
                continue;
            }

            const finalPromptSegment = split.segments[split.segments.length - 1];
            const finalResult = await this.#runCompletionStep({
                messages,
                promptSegment: finalPromptSegment,
                checkpoint: {
                    index: completedCount,
                    kind: 'final',
                    parserName: 'final_response',
                    parserArgs: [],
                    target: null
                },
                parser: this.finalParser || (response => ({
                    value: requireNonWhitespaceResponse(response, 'Tiny-brain final response')
                })),
                logFilePath,
                systemPrompt,
                isFinal: true
            });
            allToolInvocations.push(...finalResult.toolInvocations);
            return {
                aiResponse: finalResult.aiResponse,
                conversationMessages: finalResult.messages,
                toolInvocations: allToolInvocations,
                logFilePath: finalResult.logFilePath,
                terminatedAtCheckpoint: null
            };
        }
    }

    #renderProgram({ programTemplateName, templateContext, renderState }) {
        renderState.nextCheckpointIndex = 0;
        renderState.checkpoints = [];
        const renderedProgram = this.promptEnv.render(programTemplateName, {
            ...templateContext,
            __tinyBrainState: renderState
        });
        return {
            renderedProgram,
            checkpoints: renderState.checkpoints.map(checkpoint => ({ ...checkpoint }))
        };
    }

    #splitProgram({ generationPrompt, checkpoints, renderState }) {
        const markerPattern = new RegExp(
            `\\[\\[TINYBRAIN_CHECKPOINT:${renderState.runId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)\\]\\]`,
            'g'
        );
        const segments = [];
        const markerIndexes = [];
        let cursor = 0;
        let match = null;
        while ((match = markerPattern.exec(generationPrompt)) !== null) {
            segments.push(generationPrompt.slice(cursor, match.index));
            markerIndexes.push(Number(match[1]));
            cursor = markerPattern.lastIndex;
        }
        segments.push(generationPrompt.slice(cursor));

        if (markerIndexes.length !== checkpoints.length) {
            throw new Error(
                `Tiny-brain prompt rendered ${markerIndexes.length} markers for ${checkpoints.length} checkpoints.`
            );
        }
        markerIndexes.forEach((markerIndex, index) => {
            if (markerIndex !== index || checkpoints[index]?.index !== index) {
                throw new Error(`Tiny-brain checkpoint markers are out of sequence at index ${index}.`);
            }
        });
        return { segments };
    }

    #validateCompletedCheckpoints(checkpoints, completedCheckpointDefinitions) {
        if (checkpoints.length < completedCheckpointDefinitions.length) {
            throw new Error('Tiny-brain prompt rerender removed an already completed checkpoint.');
        }
        for (let index = 0; index < completedCheckpointDefinitions.length; index += 1) {
            if (!checkpointsMatch(checkpoints[index], completedCheckpointDefinitions[index])) {
                throw new Error(`Tiny-brain prompt rerender changed completed checkpoint ${index}.`);
            }
        }
    }

    #resolveCheckpointParser(checkpoint) {
        if (checkpoint.kind === 'dummy') {
            return response => ({
                value: requireNonWhitespaceResponse(response, `Tiny-brain checkpoint ${checkpoint.index + 1}`)
            });
        }
        const parser = this.parsers[checkpoint.parserName]
            || (checkpoint.parserName.startsWith('mod_step_') ? parseModStep : null);
        if (typeof parser !== 'function') {
            throw new Error(`No tiny-brain parser is registered for "${checkpoint.parserName}".`);
        }
        return (response) => parser(response, ...checkpoint.parserArgs);
    }

    async #runCompletionStep({
        messages,
        promptSegment,
        checkpoint,
        parser,
        logFilePath,
        systemPrompt,
        isFinal
    }) {
        const trimmedPrompt = typeof promptSegment === 'string' ? promptSegment.trim() : '';
        if (!trimmedPrompt) {
            throw new Error(
                `${isFinal ? 'Tiny-brain final response' : `Tiny-brain checkpoint ${checkpoint.index + 1}`} has no prompt text.`
            );
        }

        let workingMessages = messages.map(cloneMessage);
        workingMessages.push({ role: 'user', content: trimmedPrompt });
        let currentLogPath = logFilePath;
        const toolInvocations = [];

        for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
            currentLogPath = this.#logPromptSegment({
                logFilePath: currentLogPath,
                systemPrompt,
                promptText: trimmedPrompt,
                checkpoint,
                attempt,
                isFinal
            });

            const completion = await this.complete({
                messages: workingMessages.map(cloneMessage),
                checkpoint: { ...checkpoint },
                attempt,
                isFinal,
                logFilePath: currentLogPath
            });
            const aiResponse = completion?.aiResponse;
            if (typeof aiResponse !== 'string') {
                throw new Error('Tiny-brain completion callback must return aiResponse as a string.');
            }
            const conversationMessages = Array.isArray(completion?.conversationMessages)
                ? completion.conversationMessages.map(cloneMessage)
                : null;
            if (!conversationMessages || !conversationMessages.length) {
                throw new Error('Tiny-brain completion callback must return conversationMessages.');
            }
            if (Array.isArray(completion.toolInvocations)) {
                toolInvocations.push(...completion.toolInvocations);
            }

            this.#logResponse({
                logFilePath: currentLogPath,
                response: aiResponse,
                checkpoint,
                attempt,
                isFinal
            });

            try {
                const rawParsed = await parser(aiResponse);
                const parsed = rawParsed && typeof rawParsed === 'object' && !Array.isArray(rawParsed)
                    ? rawParsed
                    : { value: rawParsed };
                return {
                    aiResponse,
                    parsed,
                    messages: conversationMessages,
                    toolInvocations,
                    logFilePath: currentLogPath
                };
            } catch (error) {
                if (this.onParseFailure) {
                    await this.onParseFailure({
                        response: aiResponse,
                        checkpoint: { ...checkpoint },
                        attempt,
                        isFinal,
                        error
                    });
                }
                this.#appendLog({
                    logFilePath: currentLogPath,
                    sections: [{
                        title: `${this.#stepLabel(checkpoint, isFinal)} parse failure`,
                        content: error?.stack || error?.message || String(error)
                    }]
                });
                if (attempt >= this.retryAttempts) {
                    throw new Error(
                        `${this.#stepLabel(checkpoint, isFinal)} failed to parse after ${attempt + 1} attempt${attempt === 0 ? '' : 's'}: ${error?.message || error}`
                    );
                }
                workingMessages = this.#discardMalformedTerminalResponse({
                    conversationMessages,
                    aiResponse
                });
            }
        }

        throw new Error('Tiny-brain completion retry loop exited unexpectedly.');
    }

    #discardMalformedTerminalResponse({ conversationMessages, aiResponse }) {
        const retainedMessages = conversationMessages.map(cloneMessage);
        const terminal = retainedMessages[retainedMessages.length - 1];
        if (!terminal || terminal.role !== 'assistant') {
            throw new Error('Tiny-brain completion transcript is missing its terminal assistant response.');
        }
        const terminalContent = typeof terminal.content === 'string' ? terminal.content : '';
        if (terminalContent !== aiResponse) {
            throw new Error('Tiny-brain completion transcript terminal response does not match aiResponse.');
        }
        retainedMessages.pop();
        return retainedMessages;
    }

    #stepLabel(checkpoint, isFinal) {
        return isFinal ? 'Tiny-brain final response' : `Tiny-brain checkpoint ${checkpoint.index + 1}`;
    }

    #logPromptSegment({ logFilePath, systemPrompt, promptText, checkpoint, attempt, isFinal }) {
        const title = `${this.#stepLabel(checkpoint, isFinal)} prompt${attempt > 0 ? ` retry ${attempt}` : ''}`;
        if (!logFilePath) {
            const createdPath = this.logPrompt({
                prefix: this.logPrefix,
                metadataLabel: this.metadataLabel,
                systemPrompt,
                sections: [{ title, content: promptText }],
                output: 'silent'
            });
            if (typeof createdPath !== 'string' || !createdPath.trim()) {
                throw new Error('Failed to create the tiny-brain prompt log.');
            }
            return createdPath;
        }
        this.#appendLog({
            logFilePath,
            sections: [{ title, content: promptText }]
        });
        return logFilePath;
    }

    #logResponse({ logFilePath, response, checkpoint, attempt, isFinal }) {
        const responseLabel = [
            this.#stepLabel(checkpoint, isFinal),
            `attempt ${attempt + 1}`,
            'LLM response'
        ].join(' ');
        const result = this.logPrompt({
            filePath: logFilePath,
            append: true,
            response,
            responseLabel,
            markResponseBoundaries: true,
            output: 'silent'
        });
        if (result !== logFilePath) {
            throw new Error('Failed to append the tiny-brain LLM response to its prompt log.');
        }
    }

    #appendLog({ logFilePath, sections }) {
        const result = this.logPrompt({
            filePath: logFilePath,
            append: true,
            sections,
            output: 'silent'
        });
        if (result !== logFilePath) {
            throw new Error('Failed to append to the tiny-brain prompt log.');
        }
    }
}

function checkpointsMatch(actual, expected) {
    if (!actual || !expected) {
        return false;
    }
    return actual.index === expected.index
        && actual.kind === expected.kind
        && actual.parserName === expected.parserName
        && actual.target === expected.target
        && JSON.stringify(actual.parserArgs) === JSON.stringify(expected.parserArgs);
}

module.exports = {
    TinyBrainPromptExtension,
    TinyBrainPromptRunner,
    createTinyBrainRenderState,
    parseAcceptOrReject,
    parsePlayerIsTraveling,
    parseResponseOrNa,
    parseYesNo,
    requireNonWhitespaceResponse
};
