const { randomUUID } = require('crypto');
const LLMClient = require('./LLMClient.js');
const {
    parseAllowedCharacterSelection,
    parseExactXmlRoot,
    parseNeedBarCharactersResult,
    parseNarrativeScope,
    parseOutcomeAcknowledgement,
    parsePlayerActionDestination,
    parsePlayerActionVehicleDestination,
    parsePlayerActionDestinationChanges,
    parsePlayerActionExplicitDuration,
    parsePlayerActionDuration,
    parsePlayerActionAccompanyingCharacters,
    parsePlayerActionHiddenNotes,
    parsePlayerActionMoreInfoOrNa,
    parsePlayerActionMovement,
    parsePlayerActionProseScope,
    parsePlayerActionRequiredProse,
    parsePlayerActionTimeReasoning,
    parsePlayerActionVehicleDecision,
    parseRevisionDecision,
    parseScheduledEventApplicability,
    parseScheduledEventToolPlan,
    parseScheduledEventToolExecution,
    parseScheduledEventSummary,
    parseWhileAwayArrivalUpdates,
    parseWhileAwayCharacterUpdate
} = require('./TinyBrainPromptParsers.js');

const MARKER_PREFIX = '[[TINYBRAIN_CHECKPOINT:';
const RESULT_MARKER_PREFIX = '[[TINYBRAIN_RESULT:';

function requireNonWhitespaceResponse(response, label = 'Tiny-brain checkpoint') {
    if (typeof response !== 'string' || !response.trim()) {
        throw new Error(`${label} requires a non-whitespace LLM response.`);
    }
    return response;
}

function buildParseRetryInstruction(error) {
    const validationMessage = typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'The response did not satisfy this checkpoint\'s parser.';
    return [
        'Your previous response failed validation. Correct it and answer the same checkpoint again.',
        `Validation feedback: ${validationMessage}`,
        'Return only what the checkpoint requests. Do not repeat any successful tool calls whose results are already present in the conversation unless the validation feedback explicitly requires a corrective call.'
    ].join('\n');
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
            value: false,
            recordProgressOutput: false
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

function cloneToolInvocation(invocation) {
    if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) {
        throw new Error('Tiny-brain continuation state contains an invalid tool invocation.');
    }
    return JSON.parse(JSON.stringify(invocation));
}

function getFailedToolInvocationMessage(toolInvocations) {
    const failures = toolInvocations.filter(invocation => invocation?.metadata?.error === true);
    if (!failures.length) {
        return null;
    }
    const descriptions = failures.map((invocation, index) => {
        const toolName = typeof invocation.name === 'string' && invocation.name.trim()
            ? invocation.name.trim()
            : `tool call ${index + 1}`;
        const metadata = invocation.metadata;
        const detail = typeof metadata.message === 'string' && metadata.message.trim()
            ? metadata.message.trim()
            : (typeof metadata.code === 'string' && metadata.code.trim()
                ? `error code ${metadata.code.trim()}`
                : 'the tool reported an error');
        return `${toolName}: ${detail}`;
    });
    return `Tiny-brain completion contains ${failures.length} failed tool invocation${failures.length === 1 ? '' : 's'}: ${descriptions.join('; ')}`;
}

function createTinyBrainContinuationState() {
    return {
        conversationMessages: [],
        toolInvocations: [],
        logFilePath: null
    };
}

function validateTinyBrainContinuationState(continuationState) {
    if (!continuationState || typeof continuationState !== 'object' || Array.isArray(continuationState)) {
        throw new Error('Tiny-brain continuation state must be an object.');
    }
    if (!Array.isArray(continuationState.conversationMessages)) {
        throw new Error('Tiny-brain continuation state conversationMessages must be an array.');
    }
    if (!Array.isArray(continuationState.toolInvocations)) {
        throw new Error('Tiny-brain continuation state toolInvocations must be an array.');
    }
    if (
        continuationState.logFilePath !== null
        && (typeof continuationState.logFilePath !== 'string' || !continuationState.logFilePath.trim())
    ) {
        throw new Error('Tiny-brain continuation state logFilePath must be null or a non-empty string.');
    }
}

function createTinyBrainRenderState() {
    const runId = randomUUID();
    return {
        runId,
        programStartMarker: `[[TINYBRAIN_PROGRAM_START:${runId}]]`,
        nextCheckpointIndex: 0,
        checkpoints: [],
        resultMarkers: [],
        completedCheckpoints: Object.create(null)
    };
}

class TinyBrainPromptExtension {
    constructor() {
        this.tags = ['llm_dummy_action', 'llmparse', 'llmresult'];
    }

    parse(parser, nodes) {
        const token = parser.nextToken();
        if (token.value === 'llm_dummy_action') {
            parser.advanceAfterBlockEnd(token.value);
            return new nodes.CallExtension(this, 'renderDummyCheckpoint');
        }

        if (token.value === 'llmresult') {
            const args = parser.parseSignature(null, false);
            parser.advanceAfterBlockEnd(token.value);
            return new nodes.CallExtension(this, 'renderResultMarker', args);
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

    renderResultMarker(context, builderName, ...extraArgs) {
        if (extraArgs.length) {
            throw new Error('llmresult accepts exactly one result-builder name.');
        }
        if (typeof builderName !== 'string' || !builderName.trim()) {
            throw new Error('llmresult requires a non-empty result-builder name.');
        }
        const state = typeof context?.lookup === 'function'
            ? context.lookup('__tinyBrainState')
            : context?.ctx?.__tinyBrainState;
        if (!state || typeof state !== 'object' || typeof state.runId !== 'string') {
            throw new Error('Tiny-brain result tags require a __tinyBrainState render context.');
        }
        if (!Array.isArray(state.resultMarkers)) {
            throw new Error('Tiny-brain prompt result-marker state is malformed.');
        }
        const marker = {
            index: state.resultMarkers.length,
            builderName: builderName.trim()
        };
        state.resultMarkers.push(marker);
        return `${RESULT_MARKER_PREFIX}${state.runId}:${marker.index}]]`;
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
        resultBuilders = {},
        finalParser = null,
        onParseFailure = null,
        logPrompt = LLMClient.logPrompt.bind(LLMClient),
        metadataLabel = 'player_action_tinybrain',
        logPrefix = 'player_action_tinybrain',
        progressGroupTargetLabel = null
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
        if (!resultBuilders || typeof resultBuilders !== 'object' || Array.isArray(resultBuilders)) {
            throw new Error('TinyBrainPromptRunner resultBuilders must be an object.');
        }
        for (const [name, builder] of Object.entries(resultBuilders)) {
            if (!name.trim() || typeof builder !== 'function') {
                throw new Error('TinyBrainPromptRunner resultBuilders must map non-empty names to functions.');
            }
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
        if (typeof metadataLabel !== 'string' || !metadataLabel.trim()) {
            throw new Error('TinyBrainPromptRunner metadataLabel must be a non-empty string.');
        }
        if (typeof logPrefix !== 'string' || !logPrefix.trim()) {
            throw new Error('TinyBrainPromptRunner logPrefix must be a non-empty string.');
        }
        if (
            progressGroupTargetLabel !== null
            && (typeof progressGroupTargetLabel !== 'string' || !progressGroupTargetLabel.trim())
        ) {
            throw new Error('TinyBrainPromptRunner progressGroupTargetLabel must be a non-empty string when provided.');
        }

        this.promptEnv = promptEnv;
        this.parseXMLTemplate = parseXMLTemplate;
        this.complete = complete;
        this.retryAttempts = retryAttempts;
        this.parsers = {
            accept_or_reject: parseAcceptOrReject,
            allowed_character_selection: parseAllowedCharacterSelection,
            exact_xml_root: parseExactXmlRoot,
            need_bar_characters: parseNeedBarCharactersResult,
            narrative_scope: parseNarrativeScope,
            outcome_acknowledgement: parseOutcomeAcknowledgement,
            player_action_destination: parsePlayerActionDestination,
            player_action_vehicle_destination: parsePlayerActionVehicleDestination,
            player_action_destination_changes: parsePlayerActionDestinationChanges,
            player_action_explicit_duration: parsePlayerActionExplicitDuration,
            player_action_duration: parsePlayerActionDuration,
            player_action_accompanying_characters: parsePlayerActionAccompanyingCharacters,
            player_action_hidden_notes: parsePlayerActionHiddenNotes,
            player_action_more_info_or_na: parsePlayerActionMoreInfoOrNa,
            player_action_movement: parsePlayerActionMovement,
            player_action_prose_scope: parsePlayerActionProseScope,
            player_action_required_prose: parsePlayerActionRequiredProse,
            player_action_time_reasoning: parsePlayerActionTimeReasoning,
            player_action_vehicle_decision: parsePlayerActionVehicleDecision,
            player_is_traveling: parsePlayerIsTraveling,
            response_or_na: parseResponseOrNa,
            revision_decision: parseRevisionDecision,
            scheduled_event_applicability: parseScheduledEventApplicability,
            scheduled_event_tool_plan: parseScheduledEventToolPlan,
            scheduled_event_tool_execution: parseScheduledEventToolExecution,
            scheduled_event_summary: parseScheduledEventSummary,
            while_away_arrival_updates: parseWhileAwayArrivalUpdates,
            while_away_character_update: parseWhileAwayCharacterUpdate,
            yes_no: parseYesNo,
            ...parsers
        };
        this.resultBuilders = { ...resultBuilders };
        this.finalParser = finalParser;
        this.onParseFailure = onParseFailure;
        this.logPrompt = logPrompt;
        this.metadataLabel = metadataLabel.trim();
        this.logPrefix = logPrefix.trim();
        this.progressGroupTargetLabel = progressGroupTargetLabel?.trim()
            || (this.metadataLabel.endsWith('_tinybrain')
                ? this.metadataLabel
                : `${this.metadataLabel}_tinybrain`);
    }

    static createRenderState() {
        return createTinyBrainRenderState();
    }

    async run({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName = '_includes/player-action.tinybrain.njk',
        continuationState = null,
        refreshContinuationBaseContext = false
    } = {}) {
        if (!renderState || typeof renderState !== 'object' || typeof renderState.runId !== 'string' || !renderState.runId.trim()) {
            throw new Error('TinyBrainPromptRunner requires its initial render state.');
        }
        if (continuationState !== null) {
            validateTinyBrainContinuationState(continuationState);
        }
        if (typeof refreshContinuationBaseContext !== 'boolean') {
            throw new Error('TinyBrainPromptRunner refreshContinuationBaseContext must be a boolean.');
        }
        const progressGroupId = renderState.runId.trim();
        const runWithReservation = async () => LLMClient.withPromptQueueReservation(async (queueReservation) => (
            LLMClient.withPromptProgressGroup({
                progressGroupId,
                progressGroupTargetLabel: this.progressGroupTargetLabel
            }, async () => {
                let recordOutputCharacters = false;
                try {
                    const result = await this.#runProgram({
                        initialRenderedTemplate,
                        templateContext,
                        renderState,
                        programTemplateName,
                        queueReservation,
                        progressGroupId,
                        continuationState,
                        refreshContinuationBaseContext
                    });
                    if (continuationState) {
                        continuationState.conversationMessages = result.conversationMessages.map(cloneMessage);
                        continuationState.toolInvocations = result.toolInvocations.map(cloneToolInvocation);
                        continuationState.logFilePath = result.logFilePath;
                    }
                    recordOutputCharacters = result.recordProgressOutput !== false;
                    return result;
                } finally {
                    LLMClient.clearPromptProgressGroup(progressGroupId, {
                        recordOutputCharacters
                    });
                }
            })
        ));
        if (LLMClient.isTinyBrainXmlRepetitionFixEnabled()) {
            return await LLMClient.withTinyBrainXmlRepetitionFix({
                metadataLabel: this.metadataLabel,
                maxContinuations: this.retryAttempts
            }, runWithReservation);
        }
        return await runWithReservation();
    }

    async #runProgram({
        initialRenderedTemplate,
        templateContext,
        renderState,
        programTemplateName,
        queueReservation,
        progressGroupId,
        continuationState,
        refreshContinuationBaseContext
    }) {
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

        let fixedGenerationPrefix = initialGenerationPrompt.slice(0, programStartIndex);
        let renderedProgram = initialGenerationPrompt.slice(
            programStartIndex + renderState.programStartMarker.length
        );
        let checkpoints = renderState.checkpoints.map(checkpoint => ({ ...checkpoint }));
        let resultMarkers = Array.isArray(renderState.resultMarkers)
            ? renderState.resultMarkers.map(marker => ({ ...marker }))
            : [];
        let completedCount = 0;
        const completedCheckpointDefinitions = [];
        let messages = continuationState?.conversationMessages?.length
            ? continuationState.conversationMessages.map(cloneMessage)
            : [{ role: 'system', content: systemPrompt }];
        if (
            messages[0]?.role !== 'system'
            || typeof messages[0]?.content !== 'string'
            || !messages[0].content.trim()
        ) {
            throw new Error('Tiny-brain continuation transcript must begin with a non-empty system message.');
        }
        if (messages[0].content.trim() !== systemPrompt) {
            throw new Error('Tiny-brain continuation system prompt changed between sequential runs.');
        }
        if (refreshContinuationBaseContext && continuationState?.conversationMessages?.length) {
            const refreshed = this.#refreshContinuationBaseContext({
                messages,
                fixedGenerationPrefix
            });
            messages = refreshed.messages;
            fixedGenerationPrefix = refreshed.fixedGenerationPrefix;
        }
        let logFilePath = continuationState?.logFilePath || null;
        const allToolInvocations = continuationState?.toolInvocations?.map(cloneToolInvocation) || [];

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
                    isFinal: false,
                    queueReservation,
                    progressGroupId,
                    priorToolInvocations: allToolInvocations
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
                        terminatedAtCheckpoint: completedCount,
                        recordProgressOutput: stepResult.parsed.recordProgressOutput !== false
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
                resultMarkers = rerendered.resultMarkers;
                this.#validateCompletedCheckpoints(checkpoints, completedCheckpointDefinitions);
                continue;
            }

            const finalPromptSegment = split.segments[split.segments.length - 1];
            if (resultMarkers.length) {
                return await this.#buildTerminalResult({
                    finalPromptSegment,
                    resultMarkers,
                    checkpoints,
                    renderState,
                    templateContext,
                    messages,
                    allToolInvocations,
                    logFilePath,
                    systemPrompt
                });
            }
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
                isFinal: true,
                queueReservation,
                progressGroupId,
                priorToolInvocations: allToolInvocations
            });
            allToolInvocations.push(...finalResult.toolInvocations);
            return {
                aiResponse: finalResult.aiResponse,
                conversationMessages: finalResult.messages,
                toolInvocations: allToolInvocations,
                logFilePath: finalResult.logFilePath,
                terminatedAtCheckpoint: null,
                recordProgressOutput: true
            };
        }
    }

    #refreshContinuationBaseContext({ messages, fixedGenerationPrefix }) {
        const marker = LLMClient.getBaseContextEndMarker();
        const freshParts = fixedGenerationPrefix.split(marker);
        if (freshParts.length !== 2 || !freshParts[0].trim()) {
            throw new Error(
                'A refreshed tiny-brain continuation requires exactly one non-empty base-context prefix.'
            );
        }

        let markerMessageIndex = -1;
        let markerCount = 0;
        for (let index = 0; index < messages.length; index += 1) {
            const content = messages[index]?.content;
            if (typeof content !== 'string' || !content.includes(marker)) {
                continue;
            }
            markerCount += content.split(marker).length - 1;
            markerMessageIndex = index;
        }
        if (markerCount !== 1 || markerMessageIndex < 0) {
            throw new Error(
                'A refreshed tiny-brain continuation transcript must contain exactly one base-context end marker.'
            );
        }

        const markerMessage = messages[markerMessageIndex];
        if (markerMessage?.role !== 'user') {
            throw new Error('A refreshed tiny-brain continuation base context must be in a user message.');
        }
        const priorParts = markerMessage.content.split(marker);
        if (priorParts.length !== 2 || !priorParts[0].trim() || !priorParts[1].trim()) {
            throw new Error(
                'A refreshed tiny-brain continuation marker requires non-empty base context and prompt content.'
            );
        }

        const refreshedMessages = messages.map(cloneMessage);
        refreshedMessages[markerMessageIndex] = {
            ...refreshedMessages[markerMessageIndex],
            content: `${freshParts[0]}${marker}${priorParts[1]}`
        };
        return {
            messages: refreshedMessages,
            fixedGenerationPrefix: freshParts[1]
        };
    }

    #renderProgram({ programTemplateName, templateContext, renderState }) {
        renderState.nextCheckpointIndex = 0;
        renderState.checkpoints = [];
        renderState.resultMarkers = [];
        const renderedProgram = this.promptEnv.render(programTemplateName, {
            ...templateContext,
            __tinyBrainState: renderState
        });
        return {
            renderedProgram,
            checkpoints: renderState.checkpoints.map(checkpoint => ({ ...checkpoint })),
            resultMarkers: renderState.resultMarkers.map(marker => ({ ...marker }))
        };
    }

    async #buildTerminalResult({
        finalPromptSegment,
        resultMarkers,
        checkpoints,
        renderState,
        templateContext,
        messages,
        allToolInvocations,
        logFilePath,
        systemPrompt
    }) {
        if (resultMarkers.length !== 1) {
            throw new Error(`Tiny-brain prompt requires exactly one terminal result marker; found ${resultMarkers.length}.`);
        }
        const marker = resultMarkers[0];
        const markerText = `${RESULT_MARKER_PREFIX}${renderState.runId}:${marker.index}]]`;
        if (typeof finalPromptSegment !== 'string' || finalPromptSegment.trim() !== markerText) {
            throw new Error('Tiny-brain terminal result marker must be the only content after the final checkpoint.');
        }
        const builder = this.resultBuilders[marker.builderName];
        if (typeof builder !== 'function') {
            throw new Error(`No tiny-brain result builder is registered for "${marker.builderName}".`);
        }

        const assignments = Object.create(null);
        const checkpointValues = [];
        for (const checkpoint of checkpoints) {
            const completed = renderState.completedCheckpoints?.[checkpoint.index];
            if (!completed || !Object.hasOwn(completed, 'value')) {
                throw new Error(`Tiny-brain checkpoint ${checkpoint.index + 1} has no completed value.`);
            }
            checkpointValues.push(Object.freeze({
                checkpoint: Object.freeze({ ...checkpoint }),
                value: completed.value
            }));
            if (!checkpoint.target) {
                continue;
            }
            if (Object.hasOwn(assignments, checkpoint.target)) {
                throw new Error(`Tiny-brain checkpoint target "${checkpoint.target}" is assigned more than once.`);
            }
            assignments[checkpoint.target] = completed.value;
        }

        const response = await builder({
            assignments: Object.freeze({ ...assignments }),
            checkpoints: Object.freeze(checkpoints.map(checkpoint => Object.freeze({ ...checkpoint }))),
            checkpointValues: Object.freeze(checkpointValues),
            templateContext: Object.freeze({ ...templateContext }),
            toolInvocations: Object.freeze(allToolInvocations.map(invocation => Object.freeze(cloneToolInvocation(invocation))))
        });
        if (typeof response !== 'string' || !response.trim()) {
            throw new Error(`Tiny-brain result builder "${marker.builderName}" must return a non-empty string.`);
        }
        const normalizedResponse = response.trim();
        let activeLogFilePath = logFilePath;
        const section = {
            title: 'Tiny-brain assembled final response',
            content: normalizedResponse
        };
        if (activeLogFilePath) {
            this.#appendLog({ logFilePath: activeLogFilePath, sections: [section] });
        } else {
            activeLogFilePath = this.logPrompt({
                prefix: this.logPrefix,
                metadataLabel: this.metadataLabel,
                systemPrompt,
                sections: [section],
                output: 'silent'
            });
            if (typeof activeLogFilePath !== 'string' || !activeLogFilePath.trim()) {
                throw new Error('Failed to create the tiny-brain prompt log for an assembled result.');
            }
        }
        return {
            aiResponse: normalizedResponse,
            conversationMessages: messages,
            toolInvocations: allToolInvocations,
            logFilePath: activeLogFilePath,
            terminatedAtCheckpoint: null,
            recordProgressOutput: true
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
            return (response, parseContext = {}) => {
                if (typeof response === 'string' && !response.trim()) {
                    const successfulToolInvocations = Array.isArray(parseContext.currentToolInvocations)
                        ? parseContext.currentToolInvocations.filter(invocation => (
                            invocation
                            && typeof invocation === 'object'
                            && invocation.metadata?.error !== true
                        ))
                        : [];
                    if (successfulToolInvocations.length) {
                        return { value: '' };
                    }
                }
                return {
                    value: requireNonWhitespaceResponse(response, `Tiny-brain checkpoint ${checkpoint.index + 1}`)
                };
            };
        }
        const parser = this.parsers[checkpoint.parserName]
            || (checkpoint.parserName.startsWith('mod_step_') ? parseModStep : null);
        if (typeof parser !== 'function') {
            throw new Error(`No tiny-brain parser is registered for "${checkpoint.parserName}".`);
        }
        return (response, parseContext) => parser(response, ...checkpoint.parserArgs, parseContext);
    }

    async #runCompletionStep({
        messages,
        promptSegment,
        checkpoint,
        parser,
        logFilePath,
        systemPrompt,
        isFinal,
        queueReservation,
        progressGroupId,
        priorToolInvocations = []
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
        const parserRetryState = Object.create(null);

        for (let attempt = 0; attempt <= this.retryAttempts; attempt += 1) {
            const promptTextForAttempt = attempt === 0
                ? trimmedPrompt
                : workingMessages[workingMessages.length - 1]?.content;
            currentLogPath = this.#logPromptSegment({
                logFilePath: currentLogPath,
                systemPrompt,
                promptText: promptTextForAttempt,
                checkpoint,
                attempt,
                isFinal
            });

            const appendLogSection = ({ title, content } = {}) => {
                if (typeof title !== 'string' || !title.trim()) {
                    throw new Error('Tiny-brain appended log sections require a non-empty title.');
                }
                if (content === undefined || content === null || !String(content).trim()) {
                    throw new Error('Tiny-brain appended log sections require non-empty content.');
                }
                this.#appendLog({
                    logFilePath: currentLogPath,
                    sections: [{ title: title.trim(), content: String(content) }]
                });
            };
            const completion = await LLMClient.withTinyBrainXmlRepetitionLogger(
                correction => appendLogSection({
                    title: `${isFinal ? 'final response' : `checkpoint ${checkpoint.index + 1}`} XML repetition continuation ${correction.continuationAttempt}`,
                    content: [
                        `Pattern: ${correction.pattern}`,
                        `Removed response offsets: ${correction.truncateOffset}-${correction.duplicateEndOffset}`,
                        `Recovery attempt: ${correction.continuationAttempt}/${correction.maxContinuations}`,
                        '',
                        '=== ACCEPTED ASSISTANT PREFIX ===',
                        correction.acceptedPrefix,
                        '',
                        '=== CONTINUATION USER PROMPT ===',
                        correction.continuationPrompt
                    ].join('\n')
                }),
                () => this.complete({
                    messages: workingMessages.map(cloneMessage),
                    checkpoint: { ...checkpoint },
                    attempt,
                    isFinal,
                    logFilePath: currentLogPath,
                    queueReservation,
                    appendLogSection
                })
            );
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
            const attemptToolInvocations = Array.isArray(completion.toolInvocations)
                ? completion.toolInvocations.map(cloneToolInvocation)
                : [];
            toolInvocations.push(...attemptToolInvocations.filter(
                invocation => invocation?.metadata?.error !== true
            ));

            this.#logResponse({
                logFilePath: currentLogPath,
                response: aiResponse,
                checkpoint,
                attempt,
                isFinal
            });

            try {
                const failedToolInvocationMessage = getFailedToolInvocationMessage(attemptToolInvocations);
                if (failedToolInvocationMessage) {
                    throw new Error(failedToolInvocationMessage);
                }
                const rawParsed = await parser(aiResponse, {
                    checkpoint: { ...checkpoint },
                    attempt,
                    isFinal,
                    retryState: parserRetryState,
                    currentToolInvocations: toolInvocations.map(invocation => ({ ...invocation })),
                    toolInvocations: [
                        ...(Array.isArray(priorToolInvocations) ? priorToolInvocations : []),
                        ...toolInvocations
                    ].map(invocation => ({ ...invocation }))
                });
                const parsed = rawParsed && typeof rawParsed === 'object' && !Array.isArray(rawParsed)
                    ? rawParsed
                    : { value: rawParsed };
                const acceptedResponse = typeof parsed.normalizedResponse === 'string'
                    && parsed.normalizedResponse.trim()
                    ? parsed.normalizedResponse.trim()
                    : aiResponse;
                return {
                    aiResponse: acceptedResponse,
                    parsed,
                    messages: conversationMessages,
                    toolInvocations,
                    logFilePath: currentLogPath
                };
            } catch (error) {
                LLMClient.recordPromptProgressGroupFailure(progressGroupId, aiResponse);
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
                workingMessages.push({
                    role: 'user',
                    content: buildParseRetryInstruction(error)
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
        this.#tryAppendLog({
            operation: 'append the LLM response to',
            filePath: logFilePath,
            response,
            responseLabel,
            markResponseBoundaries: true
        });
    }

    #appendLog({ logFilePath, sections }) {
        this.#tryAppendLog({
            operation: 'append a section to',
            filePath: logFilePath,
            sections
        });
    }

    #tryAppendLog({ operation, filePath, ...content }) {
        let result;
        try {
            result = this.logPrompt({
                ...content,
                filePath,
                append: true,
                output: 'silent',
                warnOnFailure: false
            });
        } catch (error) {
            this.#warnAboutLogAppendFailure(operation, filePath, error);
            return;
        }
        if (result !== filePath) {
            this.#warnAboutLogAppendFailure(operation, filePath);
        }
    }

    #warnAboutLogAppendFailure(operation, filePath, error = null) {
        const detail = error?.message ? `: ${error.message}` : '';
        console.warn(
            `Warning: failed to ${operation} the tiny-brain prompt log at ${filePath}${detail}. `
            + 'The running turn will continue without that log entry.'
        );
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
    createTinyBrainContinuationState,
    createTinyBrainRenderState,
    parseAcceptOrReject,
    parsePlayerIsTraveling,
    parseResponseOrNa,
    parseYesNo,
    requireNonWhitespaceResponse
};
