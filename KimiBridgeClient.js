const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const Globals = require('./Globals.js');
const {
    isPlainObject,
    resolveBaseDir,
    resolvePathFromBase,
    ensureDirectory,
    renderToolDefinitions,
    renderSystemInstructionBlock,
    splitBridgeMessages,
    buildUserPrompt,
    extractJsonPayload,
    normalizeToolCallArguments,
    buildResponseData,
    buildBridgePreviewUpdate,
    logBridgePrompt,
    resolveMaxConcurrentRequests,
    resolveBridgeIdleTimeoutMs
} = require('./bridge_client_utils.js');

const BACKEND_KIMI = 'kimi_cli_bridge';
const BRIDGE_LABEL = 'Kimi';
const DEFAULT_KIMI_BRIDGE_CONFIG = Object.freeze({
    command: 'kimi',
    cwd: './tmp/kimi-bridge-cwd',
    model: '',
    thinking: '',
    prompt_preamble: ''
});
const KIMI_ACP_PROTOCOL_VERSION = 1;
const KIMI_ACP_CLIENT_INFO = Object.freeze({
    name: 'ai-rpg-kimi-bridge',
    title: 'AI RPG Kimi Bridge',
    version: '1.0.0'
});

function normalizeBackendAlias(rawValue) {
    const normalized = typeof rawValue === 'string'
        ? rawValue.trim().toLowerCase()
        : '';
    return normalized === 'kimi'
        || normalized === 'kimi_cli'
        || normalized === 'kimi-bridge'
        || normalized === BACKEND_KIMI
        ? BACKEND_KIMI
        : normalized;
}

function buildDeveloperInstructions({ systemMessages, tools, metadataLabel, promptPreamble }) {
    const toolText = renderToolDefinitions(tools, BRIDGE_LABEL);
    const preamble = typeof promptPreamble === 'string' && promptPreamble.trim()
        ? `${promptPreamble.trim()}\n\n`
        : '';
    const systemInstructionBlock = renderSystemInstructionBlock(systemMessages, BRIDGE_LABEL);
    const systemSection = systemInstructionBlock ? `\n\n${systemInstructionBlock}` : '';

    if (Array.isArray(tools) && tools.length > 0) {
        return `${preamble}You are acting as a completion bridge for an external application.

Return exactly one JSON object and nothing else.
Do not invoke Kimi tools, shell commands, file access, web access, browser access, MCP tools, subagents, or any external tools. The application tools below are descriptions for the JSON response only.${systemSection}

Your JSON must contain exactly these keys:
{"content":"...","tool_calls":[...]}

Rules:
- Always include both keys: "content" and "tool_calls".
- When you can answer directly, put the full reply in "content" and set "tool_calls" to [].
- When you need one or more application tool calls, set "content" to "" and set "tool_calls" to an array of objects.
- Tool call names must exactly match one of the listed tools.
- Tool call arguments must be JSON strings that parse to JSON objects.
- If the conversation requires strict XML, JSON, or other formatting, put that exact text in "content".
- Do not wrap the JSON in Markdown fences.
- metadata_label: ${metadataLabel || 'unknown'}

Available application tools:
${toolText}

Now return the next assistant step as the required JSON object.`;
    }

    return `${preamble}You are acting as a completion bridge for an external application.

Return exactly one JSON object and nothing else.
Do not invoke Kimi tools, shell commands, file access, web access, browser access, MCP tools, subagents, or any external tools.${systemSection}

Your JSON must be:
{"content":"..."}

Rules:
- Put the full next assistant message inside "content".
- If the conversation requires strict XML, JSON, or other formatting, preserve that exact text in "content".
- Do not wrap the JSON in Markdown fences.
- metadata_label: ${metadataLabel || 'unknown'}

Now return the next assistant message as the required JSON object.`;
}

function parseBridgeMessage(rawText, { allowToolCalls }) {
    const candidate = extractJsonPayload(rawText, 'Kimi bridge returned an empty assistant message.');
    let parsed = null;
    try {
        parsed = JSON.parse(candidate);
    } catch (error) {
        throw new Error(`Kimi bridge response is not valid JSON: ${error.message}`);
    }
    if (!isPlainObject(parsed)) {
        throw new Error('Kimi bridge response must be a JSON object.');
    }

    const hasContentKey = typeof parsed.content === 'string';
    const hasToolCallsKey = Array.isArray(parsed.tool_calls);

    if (!allowToolCalls) {
        if (!hasContentKey) {
            throw new Error('Kimi bridge response must contain "content".');
        }
        if (hasToolCallsKey && parsed.tool_calls.length > 0) {
            throw new Error('Kimi bridge returned tool calls for a prompt that does not allow them.');
        }
        return {
            content: parsed.content,
            toolCalls: [],
            raw: parsed
        };
    }

    if (!hasContentKey || !hasToolCallsKey) {
        throw new Error('Kimi bridge response must contain both "content" and "tool_calls".');
    }

    const hasNonEmptyContent = parsed.content.length > 0;
    const hasAnyToolCalls = parsed.tool_calls.length > 0;
    if (hasNonEmptyContent && hasAnyToolCalls) {
        throw new Error('Kimi bridge response cannot contain both non-empty "content" and non-empty "tool_calls".');
    }
    if (!hasNonEmptyContent && !hasAnyToolCalls) {
        throw new Error('Kimi bridge response must contain either non-empty "content" or at least one tool call.');
    }

    if (!hasAnyToolCalls) {
        return {
            content: parsed.content,
            toolCalls: [],
            raw: parsed
        };
    }

    const normalizedToolCalls = parsed.tool_calls.map((toolCall, index) => {
        if (!isPlainObject(toolCall)) {
            throw new Error(`Kimi bridge tool call ${index + 1} must be an object.`);
        }
        const name = typeof toolCall.name === 'string' && toolCall.name.trim()
            ? toolCall.name.trim()
            : '';
        if (!name) {
            throw new Error(`Kimi bridge tool call ${index + 1} is missing a non-empty name.`);
        }
        const argumentsObject = normalizeToolCallArguments(toolCall.arguments, index, BRIDGE_LABEL);
        return {
            id: `kimi_call_${randomUUID()}`,
            type: 'function',
            function: {
                name,
                arguments: JSON.stringify(argumentsObject)
            }
        };
    });

    return {
        content: '',
        toolCalls: normalizedToolCalls,
        raw: parsed
    };
}

function parseKimiJsonLine(rawLine) {
    const line = typeof rawLine === 'string' ? rawLine.trim() : '';
    if (!line) {
        return null;
    }
    try {
        return JSON.parse(line);
    } catch (error) {
        throw new Error(`Kimi bridge received malformed ACP JSON: ${error.message}`);
    }
}

function getKimiAcpAssistantChunk(message) {
    if (!isPlainObject(message) || message.method !== 'session/update') {
        return '';
    }
    const update = message.params?.update;
    if (!isPlainObject(update) || update.sessionUpdate !== 'agent_message_chunk') {
        return '';
    }
    const content = update.content;
    return isPlainObject(content) && content.type === 'text' && typeof content.text === 'string'
        ? content.text
        : '';
}

function formatAcpError(error, methodName) {
    const code = Number.isInteger(error?.code) ? ` (${error.code})` : '';
    const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Unknown ACP error';
    return `Kimi ACP ${methodName} failed${code}: ${message}`;
}

class KimiBridgeClient {
    static get backendName() {
        return BACKEND_KIMI;
    }

    static isKimiBackend(aiConfig) {
        return normalizeBackendAlias(aiConfig?.backend) === BACKEND_KIMI;
    }

    static getMaxConcurrent(aiConfig = Globals?.config?.ai) {
        return resolveMaxConcurrentRequests(aiConfig);
    }

    static getSemaphoreKey(aiConfig = Globals?.config?.ai) {
        const bridgeConfig = KimiBridgeClient.resolveBridgeConfig(aiConfig);
        return `${BACKEND_KIMI}::fresh::${bridgeConfig.model || 'configured-default'}`;
    }

    static getConfigurationErrors(aiConfig) {
        if (!aiConfig || typeof aiConfig !== 'object') {
            return ['AI configuration missing'];
        }

        const errors = [];
        if (
            aiConfig.prefill !== undefined
            && aiConfig.prefill !== null
            && typeof aiConfig.prefill !== 'string'
        ) {
            errors.push('AI prefill must be a string or null when provided');
        } else if (typeof aiConfig.prefill === 'string' && aiConfig.prefill.trim()) {
            errors.push('AI prefill is not supported with kimi_cli_bridge');
        }
        if (
            aiConfig.sysprompt_append !== undefined
            && aiConfig.sysprompt_append !== null
            && typeof aiConfig.sysprompt_append !== 'string'
        ) {
            errors.push('AI sysprompt_append must be a string or null when provided');
        }

        const bridgeConfig = aiConfig.kimi_bridge;
        if (bridgeConfig !== undefined && bridgeConfig !== null && !isPlainObject(bridgeConfig)) {
            errors.push('ai.kimi_bridge must be an object when provided');
            return errors;
        }
        const resolvedBridgeConfig = {
            ...DEFAULT_KIMI_BRIDGE_CONFIG,
            ...(isPlainObject(bridgeConfig) ? bridgeConfig : {})
        };
        const command = typeof resolvedBridgeConfig.command === 'string'
            ? resolvedBridgeConfig.command.trim()
            : '';
        if (!command) {
            errors.push('ai.kimi_bridge.command must be a non-empty string');
        }
        for (const field of ['cwd', 'model', 'thinking', 'prompt_preamble']) {
            if (typeof resolvedBridgeConfig[field] !== 'string') {
                errors.push(`ai.kimi_bridge.${field} must be a string when provided`);
            }
        }
        return errors;
    }

    static resolveBridgeConfig(aiConfig = Globals?.config?.ai) {
        const errors = KimiBridgeClient.getConfigurationErrors(aiConfig);
        if (errors.length) {
            throw new Error(errors.join('. '));
        }

        const bridgeConfig = isPlainObject(aiConfig?.kimi_bridge) ? aiConfig.kimi_bridge : {};
        const resolved = {
            ...DEFAULT_KIMI_BRIDGE_CONFIG,
            ...bridgeConfig
        };
        resolved.command = resolved.command.trim();
        resolved.cwd = resolved.cwd.trim();
        resolved.model = resolved.model.trim();
        resolved.thinking = resolved.thinking.trim();
        resolved.prompt_preamble = resolved.prompt_preamble.trim();
        return resolved;
    }

    static resolveResponseModel(aiConfig = Globals?.config?.ai) {
        return KimiBridgeClient.resolveBridgeConfig(aiConfig).model || 'kimi-default';
    }

    static resolveBridgeIdleTimeoutMs(aiConfig = Globals?.config?.ai) {
        return resolveBridgeIdleTimeoutMs(aiConfig);
    }

    static resolveCwdPath(aiConfig = Globals?.config?.ai) {
        const bridgeConfig = KimiBridgeClient.resolveBridgeConfig(aiConfig);
        if (!bridgeConfig.cwd) {
            return resolveBaseDir();
        }
        return resolvePathFromBase(bridgeConfig.cwd);
    }

    static buildCommandArgs() {
        return ['acp'];
    }

    static async runKimiCommand({
        aiConfig = Globals?.config?.ai,
        timeoutMs = KimiBridgeClient.resolveBridgeIdleTimeoutMs(aiConfig),
        signal = null,
        onStdoutChunk = null,
        onStdoutEvent = null,
        promptText
    } = {}) {
        if (typeof promptText !== 'string' || !promptText.trim()) {
            throw new Error('Kimi bridge prompt text must be a non-empty string.');
        }
        const bridgeConfig = KimiBridgeClient.resolveBridgeConfig(aiConfig);
        const cwd = KimiBridgeClient.resolveCwdPath(aiConfig);
        ensureDirectory(cwd);
        const args = KimiBridgeClient.buildCommandArgs();
        const useProcessGroup = process.platform !== 'win32';
        const childEnv = { ...process.env };
        if (bridgeConfig.thinking) {
            childEnv.KIMI_MODEL_THINKING_EFFORT = bridgeConfig.thinking;
        }

        return await new Promise((resolve, reject) => {
            if (signal?.aborted) {
                const reason = signal.reason instanceof Error
                    ? signal.reason.message
                    : 'Kimi bridge request aborted before process start.';
                reject(new Error(reason));
                return;
            }

            const child = spawn(bridgeConfig.command, args, {
                cwd,
                env: childEnv,
                detached: useProcessGroup,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let stdoutBuffer = '';
            let settled = false;
            let timeoutHandle = null;
            let killEscalationHandle = null;
            let abortHandler = null;
            let sessionId = '';
            let promptSent = false;
            const previewState = {
                previewText: ''
            };
            const events = [];
            const assistantMessageOrder = [];
            const assistantMessages = new Map();
            const internalToolCalls = [];
            const requestIds = Object.freeze({
                initialize: 1,
                newSession: 2,
                setModel: 3,
                prompt: 4
            });

            const cleanup = () => {
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                if (signal && abortHandler) {
                    signal.removeEventListener('abort', abortHandler);
                }
            };

            const signalChild = (signalName) => {
                try {
                    if (useProcessGroup && child.pid) {
                        process.kill(-child.pid, signalName);
                    } else {
                        child.kill(signalName);
                    }
                } catch (_) {
                    // The process may already have exited.
                }
            };

            const shutdownChild = () => {
                try {
                    child.stdin.end();
                } catch (_) {
                    // Continue with process termination if stdin is already closed.
                }
                if (child.exitCode !== null || child.signalCode !== null) {
                    return;
                }
                signalChild('SIGTERM');
                killEscalationHandle = setTimeout(() => {
                    signalChild('SIGKILL');
                }, 1000);
                if (typeof killEscalationHandle.unref === 'function') {
                    killEscalationHandle.unref();
                }
            };

            const finalizeReject = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                error.commandStdout = stdout;
                error.commandStderr = stderr;
                shutdownChild();
                reject(error);
            };

            const finalizeResolve = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                cleanup();
                shutdownChild();
                resolve(result);
            };

            const terminateChild = (reason) => {
                finalizeReject(new Error(reason));
            };

            const resetIdleTimeout = () => {
                if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || settled) {
                    return;
                }
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                timeoutHandle = setTimeout(() => {
                    terminateChild(`Kimi ACP bridge request timed out after ${timeoutMs} ms without streamed data.`);
                }, timeoutMs);
            };
            resetIdleTimeout();

            const writeRpcMessage = (message) => {
                if (settled) {
                    return;
                }
                let serialized = '';
                try {
                    serialized = `${JSON.stringify(message)}\n`;
                } catch (error) {
                    terminateChild(`Failed to serialize Kimi ACP message: ${error.message}`);
                    return;
                }
                child.stdin.write(serialized, 'utf8', (error) => {
                    if (error && !settled) {
                        terminateChild(`Failed to write Kimi ACP stdin: ${error.message}`);
                    }
                });
            };

            const sendPrompt = () => {
                promptSent = true;
                writeRpcMessage({
                    jsonrpc: '2.0',
                    id: requestIds.prompt,
                    method: 'session/prompt',
                    params: {
                        sessionId,
                        prompt: [
                            {
                                type: 'text',
                                text: promptText
                            }
                        ]
                    }
                });
            };

            if (signal) {
                abortHandler = () => {
                    const reason = signal.reason instanceof Error
                        ? signal.reason.message
                        : 'Kimi bridge request aborted.';
                    if (sessionId && promptSent) {
                        writeRpcMessage({
                            jsonrpc: '2.0',
                            method: 'session/cancel',
                            params: { sessionId }
                        });
                    }
                    terminateChild(reason);
                };
                signal.addEventListener('abort', abortHandler, { once: true });
            }

            const forwardFinalPreview = (finalText) => {
                if (typeof onStdoutEvent !== 'function') {
                    return;
                }
                const previewUpdate = buildBridgePreviewUpdate(previewState, finalText, {
                    final: true,
                    includeType: false
                });
                if (!previewUpdate.text) {
                    return;
                }
                onStdoutEvent({
                    type: 'item.completed',
                    item: {
                        type: 'agent_message',
                        text: previewUpdate.text
                    }
                });
            };

            const processSessionUpdate = (message) => {
                const update = message.params?.update;
                if (!isPlainObject(update)) {
                    return;
                }
                if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
                    internalToolCalls.push(update);
                    terminateChild('Kimi ACP bridge attempted to invoke an internal Kimi tool.');
                    return;
                }
                const chunk = getKimiAcpAssistantChunk(message);
                if (!chunk) {
                    return;
                }
                const messageId = typeof update.messageId === 'string' && update.messageId.trim()
                    ? update.messageId.trim()
                    : 'default-assistant-message';
                if (!assistantMessages.has(messageId)) {
                    assistantMessages.set(messageId, '');
                    assistantMessageOrder.push(messageId);
                }
                const accumulated = `${assistantMessages.get(messageId)}${chunk}`;
                assistantMessages.set(messageId, accumulated);
                if (typeof onStdoutEvent !== 'function') {
                    return;
                }
                const previewUpdate = buildBridgePreviewUpdate(previewState, accumulated, {
                    includeType: false
                });
                if (!previewUpdate) {
                    return;
                }
                if (previewUpdate.replace) {
                    onStdoutEvent({
                        type: 'item.completed',
                        item: {
                            type: 'agent_message',
                            text: previewUpdate.text
                        }
                    });
                    return;
                }
                onStdoutEvent({
                    type: 'agent_message_delta',
                    delta: previewUpdate.text
                });
            };

            const rejectReverseRequest = (message) => {
                writeRpcMessage({
                    jsonrpc: '2.0',
                    id: message.id,
                    error: {
                        code: -32601,
                        message: `Kimi ACP client method is not available: ${message.method}`
                    }
                });
                terminateChild(`Kimi ACP bridge received unsupported client request ${message.method}.`);
            };

            const processMessage = (message) => {
                if (!isPlainObject(message)) {
                    throw new Error('Kimi bridge received a non-object ACP message.');
                }
                events.push(message);

                if (typeof message.method === 'string') {
                    if (message.method === 'session/update') {
                        processSessionUpdate(message);
                        return;
                    }
                    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
                        if (message.method === 'session/request_permission') {
                            internalToolCalls.push(message.params?.toolCall || message.params || message);
                            writeRpcMessage({
                                jsonrpc: '2.0',
                                id: message.id,
                                result: {
                                    outcome: {
                                        outcome: 'cancelled'
                                    }
                                }
                            });
                            terminateChild('Kimi ACP bridge attempted to request permission for an internal tool.');
                            return;
                        }
                        rejectReverseRequest(message);
                    }
                    return;
                }

                if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
                    return;
                }
                if (message.error) {
                    const methodNames = {
                        [requestIds.initialize]: 'initialize',
                        [requestIds.newSession]: 'session/new',
                        [requestIds.setModel]: 'session/set_config_option',
                        [requestIds.prompt]: 'session/prompt'
                    };
                    throw new Error(formatAcpError(message.error, methodNames[message.id] || 'request'));
                }

                if (message.id === requestIds.initialize) {
                    const protocolVersion = Number(message.result?.protocolVersion);
                    if (protocolVersion !== KIMI_ACP_PROTOCOL_VERSION) {
                        throw new Error(
                            `Kimi ACP protocol version mismatch: expected ${KIMI_ACP_PROTOCOL_VERSION}, received ${message.result?.protocolVersion}.`
                        );
                    }
                    writeRpcMessage({
                        jsonrpc: '2.0',
                        id: requestIds.newSession,
                        method: 'session/new',
                        params: {
                            cwd,
                            mcpServers: []
                        }
                    });
                    return;
                }

                if (message.id === requestIds.newSession) {
                    sessionId = typeof message.result?.sessionId === 'string'
                        ? message.result.sessionId.trim()
                        : '';
                    if (!sessionId) {
                        throw new Error('Kimi ACP session/new did not return a sessionId.');
                    }
                    if (!bridgeConfig.model) {
                        sendPrompt();
                        return;
                    }
                    const modelOption = Array.isArray(message.result?.configOptions)
                        ? message.result.configOptions.find(option => option?.id === 'model')
                        : null;
                    if (modelOption?.currentValue === bridgeConfig.model) {
                        sendPrompt();
                        return;
                    }
                    writeRpcMessage({
                        jsonrpc: '2.0',
                        id: requestIds.setModel,
                        method: 'session/set_config_option',
                        params: {
                            sessionId,
                            configId: 'model',
                            value: bridgeConfig.model
                        }
                    });
                    return;
                }

                if (message.id === requestIds.setModel) {
                    const modelOption = Array.isArray(message.result?.configOptions)
                        ? message.result.configOptions.find(option => option?.id === 'model')
                        : null;
                    if (modelOption?.currentValue !== bridgeConfig.model) {
                        throw new Error(
                            `Kimi ACP did not apply configured model ${JSON.stringify(bridgeConfig.model)}.`
                        );
                    }
                    sendPrompt();
                    return;
                }

                if (message.id !== requestIds.prompt) {
                    return;
                }
                if (internalToolCalls.length) {
                    throw new Error('Kimi ACP bridge attempted to invoke an internal Kimi tool.');
                }
                const finalMessageId = assistantMessageOrder.at(-1) || '';
                const finalText = finalMessageId ? assistantMessages.get(finalMessageId) || '' : '';
                if (!finalText) {
                    throw new Error('Kimi ACP bridge did not return a final assistant message.');
                }
                forwardFinalPreview(finalText);
                finalizeResolve({
                    stdout,
                    stderr,
                    events,
                    finalText,
                    args,
                    sessionId,
                    stopReason: message.result?.stopReason || ''
                });
            };

            child.on('error', (error) => {
                finalizeReject(new Error(`Failed to start Kimi bridge process: ${error.message}`));
            });

            child.stdin.on('error', (error) => {
                if (!settled) {
                    terminateChild(`Kimi ACP stdin failed: ${error.message}`);
                }
            });

            child.stdout.on('data', (chunk) => {
                resetIdleTimeout();
                const text = chunk.toString('utf8');
                stdout += text;
                stdoutBuffer += text;
                if (typeof onStdoutChunk === 'function') {
                    try {
                        onStdoutChunk(text);
                    } catch (error) {
                        terminateChild(`Kimi stdout progress handler failed: ${error?.message || error}`);
                        return;
                    }
                }

                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';
                for (const line of lines) {
                    try {
                        const message = parseKimiJsonLine(line);
                        if (message) {
                            processMessage(message);
                        }
                    } catch (error) {
                        terminateChild(error.message);
                        return;
                    }
                }
            });

            child.stderr.on('data', (chunk) => {
                resetIdleTimeout();
                stderr += chunk.toString('utf8');
            });

            child.on('close', (code, signalName) => {
                if (killEscalationHandle) {
                    clearTimeout(killEscalationHandle);
                    killEscalationHandle = null;
                }
                if (settled) {
                    return;
                }
                const trailingLine = stdoutBuffer.trim();
                if (trailingLine) {
                    try {
                        const message = parseKimiJsonLine(trailingLine);
                        if (message) {
                            processMessage(message);
                        }
                    } catch (error) {
                        finalizeReject(error);
                        return;
                    }
                }
                const details = [
                    code === 0
                        ? 'Kimi ACP bridge process exited before completing session/prompt.'
                        : `Kimi ACP bridge process exited with code ${code}${signalName ? ` (signal: ${signalName})` : ''}.`
                ];
                if (stderr.trim()) {
                    details.push(`stderr:\n${stderr.trim()}`);
                }
                if (stdout.trim()) {
                    details.push(`stdout:\n${stdout.trim()}`);
                }
                finalizeReject(new Error(details.join('\n\n')));
            });

            child.once('spawn', () => {
                setImmediate(() => {
                    writeRpcMessage({
                        jsonrpc: '2.0',
                        id: requestIds.initialize,
                        method: 'initialize',
                        params: {
                            protocolVersion: KIMI_ACP_PROTOCOL_VERSION,
                            clientCapabilities: {},
                            clientInfo: KIMI_ACP_CLIENT_INFO
                        }
                    });
                });
            });
        });
    }

    static async chatCompletion({
        messages,
        model,
        timeoutMs,
        metadataLabel = '',
        additionalPayload = {},
        aiConfig = Globals?.config?.ai,
        signal = null,
        onStdoutChunk = null,
        onStdoutEvent = null
    } = {}) {
        const bridgeConfig = KimiBridgeClient.resolveBridgeConfig(aiConfig);
        const { systemMessages, conversationMessages } = splitBridgeMessages(messages, BRIDGE_LABEL);
        const tools = Array.isArray(additionalPayload?.tools) ? additionalPayload.tools : [];
        const developerInstructions = buildDeveloperInstructions({
            systemMessages,
            tools,
            metadataLabel,
            promptPreamble: bridgeConfig.prompt_preamble
        });
        const promptText = buildUserPrompt({
            messages: conversationMessages,
            developerInstructions
        }, BRIDGE_LABEL);
        const responseModel = bridgeConfig.model || model || 'kimi-default';
        const requestPayload = {
            backend: BACKEND_KIMI,
            command: bridgeConfig.command,
            cwd: KimiBridgeClient.resolveCwdPath(aiConfig),
            model: bridgeConfig.model || null,
            thinking: bridgeConfig.thinking || null,
            transport: 'acp-stdio',
            protocol_version: KIMI_ACP_PROTOCOL_VERSION,
            client_capabilities: {},
            mcp_servers: [],
            prompt: '[logged as generation prompt]',
            additionalPayload
        };

        let execution = null;
        try {
            execution = await KimiBridgeClient.runKimiCommand({
                aiConfig,
                timeoutMs,
                signal,
                onStdoutChunk,
                onStdoutEvent,
                promptText
            });
            const parsed = parseBridgeMessage(execution.finalText, {
                allowToolCalls: tools.length > 0
            });
            const normalizedResponse = buildResponseData({
                content: parsed.content,
                toolCalls: parsed.toolCalls,
                model: responseModel,
                idPrefix: 'kimi-bridge',
                defaultModel: 'kimi-default'
            });

            logBridgePrompt({
                label: BRIDGE_LABEL,
                metadataLabel,
                model: responseModel,
                systemPrompt: developerInstructions,
                promptText,
                normalizedResponse,
                requestPayload,
                commandStdout: execution.stdout,
                commandStderr: execution.stderr
            });

            return {
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {
                    backend: BACKEND_KIMI
                },
                data: normalizedResponse
            };
        } catch (error) {
            logBridgePrompt({
                label: BRIDGE_LABEL,
                metadataLabel,
                model: responseModel,
                systemPrompt: developerInstructions,
                promptText,
                normalizedResponse: null,
                requestPayload,
                commandStdout: execution?.stdout || error?.commandStdout || '',
                commandStderr: execution?.stderr || error?.commandStderr || '',
                error
            });
            throw error;
        }
    }
}

module.exports = KimiBridgeClient;
