const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const Globals = require('./Globals.js');

const BACKEND_KIMI = 'kimi_cli_bridge';
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

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildNowTimestamp() {
    return Math.floor(Date.now() / 1000);
}

function resolveBaseDir() {
    return Globals?.baseDir || process.cwd();
}

function ensureDirectory(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
        throw new Error('Directory path must be a non-empty string.');
    }
    fs.mkdirSync(targetPath, { recursive: true });
}

function resolvePathFromBase(configuredPath) {
    const trimmed = typeof configuredPath === 'string' ? configuredPath.trim() : '';
    if (!trimmed) {
        return '';
    }
    return path.isAbsolute(trimmed) ? trimmed : path.join(resolveBaseDir(), trimmed);
}

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

function formatMessageContent(content) {
    if (content === null || content === undefined) {
        return '';
    }
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        const parts = [];
        for (const part of content) {
            if (part === null || part === undefined) {
                continue;
            }
            if (typeof part === 'string') {
                if (part.trim()) {
                    parts.push(part);
                }
                continue;
            }
            if (isPlainObject(part)) {
                const type = typeof part.type === 'string' ? part.type.trim() : '';
                if (type === 'text' && typeof part.text === 'string' && part.text.trim()) {
                    parts.push(part.text);
                    continue;
                }
                if (type === 'image_url') {
                    const imageUrl = part.image_url?.url;
                    if (typeof imageUrl === 'string' && imageUrl.trim()) {
                        parts.push(imageUrl.startsWith('data:')
                            ? '[image omitted: data URL content is not supported by the Kimi bridge]'
                            : `[image_url: ${imageUrl}]`);
                        continue;
                    }
                }
                if (typeof part.text === 'string' && part.text.trim()) {
                    parts.push(part.text);
                    continue;
                }
            }
            const fallback = String(part);
            if (fallback && fallback !== '[object Object]') {
                parts.push(fallback);
            }
        }
        return parts.join('\n').trim();
    }
    if (isPlainObject(content) && typeof content.text === 'string') {
        return content.text;
    }
    const serialized = JSON.stringify(content, null, 2);
    return typeof serialized === 'string' ? serialized : String(content);
}

function renderToolCallBlock(toolCalls) {
    if (!Array.isArray(toolCalls) || !toolCalls.length) {
        return '';
    }
    const lines = ['tool_calls:'];
    toolCalls.forEach((toolCall, index) => {
        const id = typeof toolCall?.id === 'string' && toolCall.id.trim()
            ? toolCall.id.trim()
            : `(generated-${index + 1})`;
        const functionName = typeof toolCall?.function?.name === 'string' && toolCall.function.name.trim()
            ? toolCall.function.name.trim()
            : '(missing)';
        const rawArguments = typeof toolCall?.function?.arguments === 'string'
            ? toolCall.function.arguments
            : JSON.stringify(toolCall?.function?.arguments ?? {}, null, 2);
        lines.push(`- id: ${id}`);
        lines.push(`  name: ${functionName}`);
        lines.push('  arguments:');
        String(rawArguments || '{}').split('\n').forEach((line) => {
            lines.push(`    ${line}`);
        });
    });
    return lines.join('\n');
}

function renderConversation(messages = []) {
    if (!Array.isArray(messages) || !messages.length) {
        throw new Error('Kimi bridge requires a non-empty messages array.');
    }

    const sections = [];
    messages.forEach((message, index) => {
        if (!message || typeof message !== 'object') {
            return;
        }
        const role = typeof message.role === 'string' && message.role.trim()
            ? message.role.trim().toLowerCase()
            : 'unknown';
        const lines = [`Message ${index + 1} (${role})`];
        if (role === 'tool') {
            if (typeof message.name === 'string' && message.name.trim()) {
                lines.push(`tool_name: ${message.name.trim()}`);
            }
            if (typeof message.tool_call_id === 'string' && message.tool_call_id.trim()) {
                lines.push(`tool_call_id: ${message.tool_call_id.trim()}`);
            }
        }
        const content = formatMessageContent(message.content).trim();
        lines.push('content:');
        if (content) {
            content.split('\n').forEach(line => lines.push(`  ${line}`));
        } else {
            lines.push('  (empty)');
        }
        const toolCallBlock = renderToolCallBlock(message.tool_calls);
        if (toolCallBlock) {
            lines.push(toolCallBlock);
        }
        sections.push(lines.join('\n'));
    });
    return sections.join('\n\n');
}

function splitBridgeMessages(messages = []) {
    if (!Array.isArray(messages) || !messages.length) {
        throw new Error('Kimi bridge requires a non-empty messages array.');
    }

    const systemMessages = [];
    const conversationMessages = [];
    messages.forEach((message) => {
        if (!message || typeof message !== 'object') {
            return;
        }
        const role = typeof message.role === 'string' && message.role.trim()
            ? message.role.trim().toLowerCase()
            : 'unknown';
        if (role === 'system') {
            systemMessages.push(message);
            return;
        }
        conversationMessages.push(message);
    });

    if (!conversationMessages.length) {
        throw new Error('Kimi bridge requires at least one non-system message.');
    }

    return {
        systemMessages,
        conversationMessages
    };
}

function renderSystemInstructionBlock(messages = []) {
    if (!Array.isArray(messages) || !messages.length) {
        return '';
    }

    const sections = ['External application system messages (preserve order and follow them as authoritative instructions):'];
    messages.forEach((message, index) => {
        const content = formatMessageContent(message?.content).trim();
        sections.push(`System Message ${index + 1}:`);
        if (content) {
            content.split('\n').forEach(line => sections.push(`  ${line}`));
        } else {
            sections.push('  (empty)');
        }
    });
    return sections.join('\n');
}

function renderToolDefinitions(tools = []) {
    if (!Array.isArray(tools)) {
        throw new Error('Kimi bridge tool definitions must be an array.');
    }
    if (!tools.length) {
        return '';
    }
    const lines = [];
    tools.forEach((tool, index) => {
        if (!tool || typeof tool !== 'object') {
            throw new Error(`Kimi bridge tool definition at index ${index} must be an object.`);
        }
        if (tool.type !== 'function' || !isPlainObject(tool.function)) {
            throw new Error(`Kimi bridge only supports function tools. Invalid tool at index ${index}.`);
        }
        const functionName = typeof tool.function.name === 'string' && tool.function.name.trim()
            ? tool.function.name.trim()
            : '';
        if (!functionName) {
            throw new Error(`Kimi bridge tool definition at index ${index} is missing function.name.`);
        }
        lines.push(`${index + 1}. ${functionName}`);
        if (typeof tool.function.description === 'string' && tool.function.description.trim()) {
            lines.push(`   description: ${tool.function.description.trim()}`);
        }
        const parameters = tool.function.parameters === undefined
            ? {}
            : tool.function.parameters;
        lines.push('   parameters JSON schema:');
        JSON.stringify(parameters, null, 2).split('\n').forEach(line => {
            lines.push(`     ${line}`);
        });
    });
    return lines.join('\n');
}

function buildDeveloperInstructions({ systemMessages, tools, metadataLabel, promptPreamble }) {
    const toolText = renderToolDefinitions(tools);
    const preamble = typeof promptPreamble === 'string' && promptPreamble.trim()
        ? `${promptPreamble.trim()}\n\n`
        : '';
    const systemInstructionBlock = renderSystemInstructionBlock(systemMessages);
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

function buildUserPrompt({ messages, developerInstructions }) {
    const conversationText = renderConversation(messages);
    const instructionText = typeof developerInstructions === 'string' && developerInstructions.trim()
        ? developerInstructions.trim()
        : '';
    return instructionText
        ? `Bridge Instructions:\n${instructionText}\n\nConversation:\n${conversationText}\n\nReturn only the JSON object required by the Bridge Instructions.`
        : `Conversation:\n${conversationText}`;
}

function extractJsonPayload(rawText) {
    const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
    if (!trimmed) {
        throw new Error('Kimi bridge returned an empty assistant message.');
    }
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function normalizeToolCallArguments(rawArguments, index) {
    if (isPlainObject(rawArguments)) {
        return rawArguments;
    }
    if (typeof rawArguments === 'string') {
        const trimmed = rawArguments.trim();
        if (!trimmed) {
            throw new Error(`Kimi bridge tool call ${index + 1} arguments cannot be empty.`);
        }
        let parsed = null;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            throw new Error(`Kimi bridge tool call ${index + 1} arguments are not valid JSON: ${error.message}`);
        }
        if (!isPlainObject(parsed)) {
            throw new Error(`Kimi bridge tool call ${index + 1} arguments must parse to a JSON object.`);
        }
        return parsed;
    }
    throw new Error(`Kimi bridge tool call ${index + 1} arguments must be a JSON object or JSON string.`);
}

function parseBridgeMessage(rawText, { allowToolCalls }) {
    const candidate = extractJsonPayload(rawText);
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
        const argumentsObject = normalizeToolCallArguments(toolCall.arguments, index);
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

function buildResponseData({ content, toolCalls, model }) {
    const finishReason = Array.isArray(toolCalls) && toolCalls.length ? 'tool_calls' : 'stop';
    return {
        id: `kimi-bridge-${randomUUID()}`,
        object: 'chat.completion',
        created: buildNowTimestamp(),
        model: typeof model === 'string' && model.trim() ? model.trim() : 'kimi-default',
        choices: [
            {
                index: 0,
                finish_reason: finishReason,
                message: {
                    role: 'assistant',
                    content: typeof content === 'string' ? content : '',
                    tool_calls: Array.isArray(toolCalls) && toolCalls.length ? toolCalls : undefined
                }
            }
        ]
    };
}

function extractBridgeContentPreview(rawText) {
    const candidate = typeof rawText === 'string' ? rawText : '';
    if (!candidate) {
        return {
            text: '',
            complete: false
        };
    }

    const contentKeyMatch = /"content"\s*:\s*"/.exec(candidate);
    if (!contentKeyMatch) {
        return {
            text: '',
            complete: false
        };
    }

    let text = '';
    let index = contentKeyMatch.index + contentKeyMatch[0].length;
    let escaping = false;
    while (index < candidate.length) {
        const char = candidate[index];
        if (escaping) {
            switch (char) {
                case '"':
                case '\\':
                case '/':
                    text += char;
                    break;
                case 'b':
                    text += '\b';
                    break;
                case 'f':
                    text += '\f';
                    break;
                case 'n':
                    text += '\n';
                    break;
                case 'r':
                    text += '\r';
                    break;
                case 't':
                    text += '\t';
                    break;
                case 'u': {
                    const unicodeValue = candidate.slice(index + 1, index + 5);
                    if (!/^[0-9a-fA-F]{4}$/.test(unicodeValue)) {
                        return {
                            text,
                            complete: false
                        };
                    }
                    text += String.fromCharCode(Number.parseInt(unicodeValue, 16));
                    index += 4;
                    break;
                }
                default:
                    text += char;
                    break;
            }
            escaping = false;
            index += 1;
            continue;
        }
        if (char === '\\') {
            escaping = true;
            index += 1;
            continue;
        }
        if (char === '"') {
            return {
                text,
                complete: true
            };
        }
        text += char;
        index += 1;
    }

    return {
        text,
        complete: false
    };
}

function buildBridgePreviewUpdate(previewState, rawAssistantText, { final = false } = {}) {
    const nextPreviewText = extractBridgeContentPreview(rawAssistantText).text;
    if (!final) {
        if (!nextPreviewText || nextPreviewText === previewState.previewText) {
            return null;
        }
        if (!nextPreviewText.startsWith(previewState.previewText)) {
            previewState.previewText = nextPreviewText;
            return {
                text: nextPreviewText,
                replace: true
            };
        }
        const delta = nextPreviewText.slice(previewState.previewText.length);
        previewState.previewText = nextPreviewText;
        return delta
            ? {
                text: delta,
                replace: false
            }
            : null;
    }

    previewState.previewText = nextPreviewText;
    return {
        text: nextPreviewText,
        replace: true
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

function getBridgeLogResponseText(normalizedResponse) {
    if (!normalizedResponse || typeof normalizedResponse !== 'object') {
        return JSON.stringify(normalizedResponse ?? {}, null, 2);
    }

    const message = normalizedResponse?.choices?.[0]?.message;
    const content = typeof message?.content === 'string'
        ? message.content
        : '';
    if (content) {
        return content;
    }

    const toolCalls = Array.isArray(message?.tool_calls)
        ? message.tool_calls
        : [];
    if (toolCalls.length) {
        return JSON.stringify({ tool_calls: toolCalls }, null, 2);
    }

    return JSON.stringify(normalizedResponse, null, 2);
}

function logBridgePrompt({
    metadataLabel,
    model,
    systemPrompt = '',
    promptText,
    normalizedResponse,
    requestPayload,
    commandStdout = '',
    commandStderr = '',
    error = null
}) {
    try {
        const LLMClient = require('./LLMClient.js');
        const sections = [];
        if (typeof commandStdout === 'string' && commandStdout.trim()) {
            sections.push({
                title: 'Kimi Stdout',
                content: commandStdout.trim()
            });
        }
        if (typeof commandStderr === 'string' && commandStderr.trim()) {
            sections.push({
                title: 'Kimi Stderr',
                content: commandStderr.trim()
            });
        }
        if (error) {
            sections.push({
                title: 'Bridge Error',
                content: error?.stack || error?.message || String(error)
            });
        }
        LLMClient.logPrompt({
            prefix: 'prompt',
            metadataLabel,
            model,
            systemPrompt,
            generationPrompt: promptText,
            response: error
                ? (error?.stack || error?.message || String(error))
                : getBridgeLogResponseText(normalizedResponse),
            requestPayload,
            responsePayload: normalizedResponse ?? null,
            sections,
            output: 'silent'
        });
    } catch (loggingError) {
        console.warn(`Failed to log Kimi bridge prompt: ${loggingError?.message || loggingError}`);
    }
}

class KimiBridgeClient {
    static get backendName() {
        return BACKEND_KIMI;
    }

    static isKimiBackend(aiConfig) {
        return normalizeBackendAlias(aiConfig?.backend) === BACKEND_KIMI;
    }

    static getMaxConcurrent(aiConfig = Globals?.config?.ai) {
        const configured = Number(aiConfig?.max_concurrent_requests);
        return Number.isInteger(configured) && configured > 0 ? configured : 1;
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
        const baseTimeoutSeconds = Number(aiConfig?.baseTimeoutSeconds);
        if (Number.isFinite(baseTimeoutSeconds) && baseTimeoutSeconds > 0) {
            return baseTimeoutSeconds * 1000;
        }
        return 30000;
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
                const previewUpdate = buildBridgePreviewUpdate(previewState, finalText, { final: true });
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
                const previewUpdate = buildBridgePreviewUpdate(previewState, accumulated);
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
        const { systemMessages, conversationMessages } = splitBridgeMessages(messages);
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
        });
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
                model: responseModel
            });

            logBridgePrompt({
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
