const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const Globals = require('./Globals.js');

const BACKEND_OPENAI = 'openai_compatible';
const BACKEND_CODEX = 'codex_cli_bridge';
const CODEX_REASONING_EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const CODEX_APP_SERVER_TIMEOUT_MS = 15000;
const CODEX_APP_SERVER_THREAD_SOURCE_KINDS = Object.freeze([
    'cli',
    'vscode',
    'exec',
    'appServer',
    'unknown'
]);
const DEFAULT_CODEX_BRIDGE_CONFIG = Object.freeze({
    command: 'codex',
    home: './tmp/codex-bridge-home',
    session_mode: 'fresh',
    session_id: '',
    sandbox: 'read-only',
    skip_git_repo_check: true,
    reasoning_effort: '',
    profile: '',
    prompt_preamble: '',
    idle_timeout_ms: 30000
});

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureDirectory(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
        throw new Error('Directory path must be a non-empty string.');
    }
    fs.mkdirSync(targetPath, { recursive: true });
}

function buildNowTimestamp() {
    return Math.floor(Date.now() / 1000);
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
                            ? '[image omitted: data URL content is not supported by the Codex bridge]'
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
        const argumentLines = String(rawArguments || '{}').split('\n');
        argumentLines.forEach((line) => {
            lines.push(`    ${line}`);
        });
    });
    return lines.join('\n');
}

function renderConversation(messages = []) {
    if (!Array.isArray(messages) || !messages.length) {
        throw new Error('Codex bridge requires a non-empty messages array.');
    }

    const sections = [];
    messages.forEach((message, index) => {
        if (!message || typeof message !== 'object') {
            return;
        }
        const role = typeof message.role === 'string' && message.role.trim()
            ? message.role.trim().toLowerCase()
            : 'unknown';
        const header = `Message ${index + 1} (${role})`;
        const lines = [header];
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
        throw new Error('Codex bridge requires a non-empty messages array.');
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
        throw new Error('Codex bridge requires at least one non-system message.');
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
        throw new Error('Codex bridge tool definitions must be an array.');
    }
    if (!tools.length) {
        return '';
    }
    const lines = [];
    tools.forEach((tool, index) => {
        if (!tool || typeof tool !== 'object') {
            throw new Error(`Codex bridge tool definition at index ${index} must be an object.`);
        }
        if (tool.type !== 'function' || !isPlainObject(tool.function)) {
            throw new Error(`Codex bridge only supports function tools. Invalid tool at index ${index}.`);
        }
        const functionName = typeof tool.function.name === 'string' && tool.function.name.trim()
            ? tool.function.name.trim()
            : '';
        if (!functionName) {
            throw new Error(`Codex bridge tool definition at index ${index} is missing function.name.`);
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
Do not use shell commands, file access, web access, or any external tools beyond the application tools listed below.
Ignore unrelated prior Codex session context if any exists. Use only the conversation and tool results supplied in the user message.${systemSection}

Your JSON must contain exactly these keys:
{"content":"...","tool_calls":[...]}

Rules:
- Always include both keys: "content" and "tool_calls".
- When you can answer directly, put the full reply in "content" and set "tool_calls" to [].
- When you need one or more application tool calls, set "content" to "" and set "tool_calls" to an array of objects.
- Tool call names must exactly match one of the listed tools.
- Tool call arguments must be JSON strings that parse to JSON objects.
- If the conversation requires strict XML, JSON, or other formatting, put that exact text in "content".
- Do not wrap the JSON in markdown fences.
- metadata_label: ${metadataLabel || 'unknown'}

Available tools:
${toolText}

Now return the next assistant step as the required JSON object.`;
    }

    return `${preamble}You are acting as a completion bridge for an external application.

Return exactly one JSON object and nothing else.
Do not use shell commands, file access, web access, or any external tools.
Ignore unrelated prior Codex session context if any exists. Use only the conversation supplied in the user message.${systemSection}

Your JSON must be:
{"content":"..."}

Rules:
- Put the full next assistant message inside "content".
- If the conversation requires strict XML, JSON, or other formatting, preserve that exact text in "content".
- Do not wrap the JSON in markdown fences.
- metadata_label: ${metadataLabel || 'unknown'}

Now return the next assistant message as the required JSON object.`;
}

function buildUserPrompt({ messages }) {
    const conversationText = renderConversation(messages);
    return `Conversation:\n${conversationText}`;
}

function buildSchema({ allowToolCalls }) {
    if (!allowToolCalls) {
        return {
            type: 'object',
            additionalProperties: false,
            properties: {
                content: { type: 'string' }
            },
            required: ['content']
        };
    }

    return {
        type: 'object',
        additionalProperties: false,
        properties: {
            content: { type: 'string' },
            tool_calls: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        name: { type: 'string', minLength: 1 },
                        arguments: {
                            type: 'string'
                        }
                    },
                    required: ['name', 'arguments']
                }
            }
        },
        required: ['content', 'tool_calls']
    };
}

function extractJsonPayload(rawText) {
    const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
    if (!trimmed) {
        throw new Error('Codex bridge returned an empty message.');
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
            throw new Error(`Codex bridge tool call ${index + 1} arguments cannot be empty.`);
        }
        let parsed = null;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            throw new Error(`Codex bridge tool call ${index + 1} arguments are not valid JSON: ${error.message}`);
        }
        if (!isPlainObject(parsed)) {
            throw new Error(`Codex bridge tool call ${index + 1} arguments must parse to a JSON object.`);
        }
        return parsed;
    }
    throw new Error(`Codex bridge tool call ${index + 1} arguments must be a JSON object or JSON string.`);
}

function parseBridgeMessage(rawText, { allowToolCalls }) {
    const candidate = extractJsonPayload(rawText);
    let parsed = null;
    try {
        parsed = JSON.parse(candidate);
    } catch (error) {
        throw new Error(`Codex bridge response is not valid JSON: ${error.message}`);
    }
    if (!isPlainObject(parsed)) {
        throw new Error('Codex bridge response must be a JSON object.');
    }

    const hasContentKey = typeof parsed.content === 'string';
    const hasToolCallsKey = Array.isArray(parsed.tool_calls);

    if (!allowToolCalls) {
        if (!hasContentKey) {
            throw new Error('Codex bridge response must contain "content".');
        }
        if (hasToolCallsKey && parsed.tool_calls.length > 0) {
            throw new Error('Codex bridge returned tool calls for a prompt that does not allow them.');
        }
        return {
            content: parsed.content,
            toolCalls: [],
            raw: parsed
        };
    }

    if (!hasContentKey && !hasToolCallsKey) {
        throw new Error('Codex bridge response must contain "content" and/or "tool_calls".');
    }

    const contentValue = hasContentKey ? parsed.content : '';
    const toolCallList = hasToolCallsKey ? parsed.tool_calls : [];
    const hasNonEmptyContent = contentValue.length > 0;
    const hasAnyToolCalls = toolCallList.length > 0;

    if (hasNonEmptyContent && hasAnyToolCalls) {
        throw new Error('Codex bridge response cannot contain both non-empty "content" and non-empty "tool_calls".');
    }
    if (!hasNonEmptyContent && !hasAnyToolCalls) {
        throw new Error('Codex bridge response must contain either non-empty "content" or at least one tool call.');
    }

    if (hasAnyToolCalls) {
        const normalizedToolCalls = toolCallList.map((toolCall, index) => {
            if (!isPlainObject(toolCall)) {
                throw new Error(`Codex bridge tool call ${index + 1} must be an object.`);
            }
            const name = typeof toolCall.name === 'string' && toolCall.name.trim()
                ? toolCall.name.trim()
                : '';
            if (!name) {
                throw new Error(`Codex bridge tool call ${index + 1} is missing a non-empty name.`);
            }
            const argumentsObject = normalizeToolCallArguments(toolCall.arguments, index);
            return {
                id: `codex_call_${randomUUID()}`,
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

    return {
        content: contentValue,
        toolCalls: [],
        raw: parsed
    };
}

function normalizeCodexEventKey(value) {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    return trimmed
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[/.]+/g, '_')
        .replace(/[^a-zA-Z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}

function getCodexEventType(rawEvent) {
    if (!isPlainObject(rawEvent)) {
        return '';
    }
    if (typeof rawEvent.type === 'string' && rawEvent.type.trim()) {
        return rawEvent.type.trim();
    }
    if (typeof rawEvent.method === 'string' && rawEvent.method.trim()) {
        return rawEvent.method.trim();
    }
    return '';
}

function normalizeStdoutEvent(rawEvent) {
    if (!isPlainObject(rawEvent)) {
        return rawEvent;
    }
    const params = isPlainObject(rawEvent.params) ? rawEvent.params : null;
    const type = getCodexEventType(rawEvent);
    if (!params && !type) {
        return rawEvent;
    }
    const normalized = {
        ...(params || {}),
        ...rawEvent,
        type: type
            ? type.replace(/\//g, '.')
            : rawEvent.type
    };
    const threadId = extractThreadIdFromEvent(normalized);
    if (threadId && !(typeof normalized.thread_id === 'string' && normalized.thread_id.trim())) {
        normalized.thread_id = threadId;
    }
    return normalized;
}

function extractThreadIdFromEvent(event) {
    if (!isPlainObject(event)) {
        return '';
    }
    if (typeof event.thread_id === 'string' && event.thread_id.trim()) {
        return event.thread_id.trim();
    }
    if (typeof event.threadId === 'string' && event.threadId.trim()) {
        return event.threadId.trim();
    }
    if (isPlainObject(event.thread)) {
        if (typeof event.thread.id === 'string' && event.thread.id.trim()) {
            return event.thread.id.trim();
        }
    }
    if (isPlainObject(event.params)) {
        if (typeof event.params.thread_id === 'string' && event.params.thread_id.trim()) {
            return event.params.thread_id.trim();
        }
        if (typeof event.params.threadId === 'string' && event.params.threadId.trim()) {
            return event.params.threadId.trim();
        }
        if (isPlainObject(event.params.thread)) {
            if (typeof event.params.thread.id === 'string' && event.params.thread.id.trim()) {
                return event.params.thread.id.trim();
            }
        }
    }
    return '';
}

function parseJsonLines(rawText) {
    const text = typeof rawText === 'string' ? rawText : '';
    if (!text) {
        return [];
    }
    const parsed = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('{')) {
            continue;
        }
        try {
            parsed.push(normalizeStdoutEvent(JSON.parse(line)));
        } catch (_) {
            // Ignore malformed JSONL records; callers can decide if absence is an error.
        }
    }
    return parsed;
}

function normalizeUsage(rawUsage) {
    if (!rawUsage || typeof rawUsage !== 'object') {
        return null;
    }
    const inputTokens = Number(rawUsage.input_tokens ?? rawUsage.inputTokens);
    const cachedInputTokens = Number(rawUsage.cached_input_tokens ?? rawUsage.cachedInputTokens);
    const outputTokens = Number(rawUsage.output_tokens ?? rawUsage.outputTokens);
    const totalTokens = Number(rawUsage.total_tokens ?? rawUsage.totalTokens);
    const normalized = {};
    if (Number.isFinite(inputTokens) && inputTokens >= 0) {
        normalized.input_tokens = Math.trunc(inputTokens);
    }
    if (Number.isFinite(cachedInputTokens) && cachedInputTokens >= 0) {
        normalized.cached_input_tokens = Math.trunc(cachedInputTokens);
    }
    if (Number.isFinite(outputTokens) && outputTokens >= 0) {
        normalized.output_tokens = Math.trunc(outputTokens);
    }
    if (Object.keys(normalized).length === 0) {
        return null;
    }
    normalized.total_tokens = Number.isFinite(totalTokens) && totalTokens >= 0
        ? Math.trunc(totalTokens)
        : (normalized.input_tokens || 0) + (normalized.output_tokens || 0);
    return normalized;
}

function extractUsageFromStdout(rawText) {
    const events = parseJsonLines(rawText);
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        const eventKey = normalizeCodexEventKey(getCodexEventType(event));
        if (eventKey === 'turn_completed') {
            const usage = normalizeUsage(event.usage);
            if (usage) {
                return usage;
            }
        }
        if (eventKey === 'thread_token_usage_updated') {
            const usage = normalizeUsage(event.tokenUsage?.last || event.token_usage?.last || event.tokenUsage || event.token_usage);
            if (usage) {
                return usage;
            }
        }
    }
    return null;
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

function buildAppServerSandboxPolicy(sandboxMode, cwd) {
    switch (sandboxMode) {
        case 'danger-full-access':
            return { type: 'dangerFullAccess' };
        case 'workspace-write':
            return {
                type: 'workspaceWrite',
                writableRoots: [cwd],
                readOnlyAccess: { type: 'fullAccess' },
                networkAccess: false
            };
        case 'read-only':
        default:
            return {
                type: 'readOnly',
                access: { type: 'fullAccess' },
                networkAccess: false
            };
    }
}

function buildBridgePreviewUpdate(previewState, rawAssistantText, { final = false } = {}) {
    const extracted = extractBridgeContentPreview(rawAssistantText);
    const nextPreviewText = extracted.text;
    if (!final) {
        if (!nextPreviewText || nextPreviewText === previewState.previewText) {
            return null;
        }
        if (!nextPreviewText.startsWith(previewState.previewText)) {
            previewState.previewText = nextPreviewText;
            return {
                type: 'agent_message',
                text: nextPreviewText,
                replace: true
            };
        }
        const delta = nextPreviewText.slice(previewState.previewText.length);
        previewState.previewText = nextPreviewText;
        return delta
            ? {
                type: 'agent_message_delta',
                text: delta,
                replace: false
            }
            : null;
    }

    previewState.previewText = nextPreviewText;
    return {
        type: 'agent_message',
        text: nextPreviewText,
        replace: true
    };
}

function buildResponseData({ content, toolCalls, model, threadId, usage = null }) {
    const finishReason = Array.isArray(toolCalls) && toolCalls.length ? 'tool_calls' : 'stop';
    const response = {
        id: threadId || `codex-bridge-${randomUUID()}`,
        object: 'chat.completion',
        created: buildNowTimestamp(),
        model: typeof model === 'string' && model.trim() ? model.trim() : 'codex',
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
    const normalizedUsage = normalizeUsage(usage);
    if (normalizedUsage) {
        response.usage = normalizedUsage;
    }
    return response;
}

function readIfExists(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        return '';
    }
    return fs.readFileSync(filePath, 'utf8');
}

function cleanupFile(filePath) {
    if (!filePath) {
        return;
    }
    try {
        fs.rmSync(filePath, { force: true });
    } catch (_) {
        // Ignore cleanup failures for temporary bridge files.
    }
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
                title: 'Codex Stdout',
                content: commandStdout.trim()
            });
        }
        if (typeof commandStderr === 'string' && commandStderr.trim()) {
            sections.push({
                title: 'Codex Stderr',
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
        console.warn(`Failed to log Codex bridge prompt: ${loggingError?.message || loggingError}`);
    }
}

class CodexBridgeClient {
    static get backendName() {
        return BACKEND_CODEX;
    }

    static normalizeBackend(rawValue) {
        const normalized = typeof rawValue === 'string'
            ? rawValue.trim().toLowerCase()
            : '';
        if (!normalized || normalized === 'openai' || normalized === 'openai-compatible' || normalized === BACKEND_OPENAI) {
            return BACKEND_OPENAI;
        }
        if (normalized === 'codex' || normalized === 'codex-bridge' || normalized === 'codex_cli' || normalized === BACKEND_CODEX) {
            return BACKEND_CODEX;
        }
        throw new Error(`Unsupported AI backend "${rawValue}".`);
    }

    static isCodexBackend(aiConfig) {
        return CodexBridgeClient.normalizeBackend(aiConfig?.backend) === BACKEND_CODEX;
    }

    static getMaxConcurrent(aiConfig = Globals?.config?.ai) {
        const bridgeConfig = CodexBridgeClient.resolveBridgeConfig(aiConfig);
        if (bridgeConfig.session_mode !== 'fresh') {
            return 1;
        }
        const configured = Number(aiConfig?.max_concurrent_requests);
        return Number.isInteger(configured) && configured > 0 ? configured : 1;
    }

    static getSemaphoreKey(aiConfig = Globals?.config?.ai, model = '') {
        const bridgeConfig = CodexBridgeClient.resolveBridgeConfig(aiConfig);
        const normalizedModel = typeof model === 'string' && model.trim() ? model.trim() : 'no-model';
        if (bridgeConfig.session_mode === 'fresh') {
            return `${BACKEND_CODEX}::fresh::${normalizedModel}`;
        }

        const homePath = CodexBridgeClient.resolveHomePath(aiConfig) || '(default-home)';
        if (bridgeConfig.session_mode === 'resume_last') {
            return `${BACKEND_CODEX}::resume_last::${homePath}`;
        }

        return `${BACKEND_CODEX}::resume_id::${homePath}::${bridgeConfig.session_id}`;
    }

    static getConfigurationErrors(aiConfig) {
        if (!aiConfig || typeof aiConfig !== 'object') {
            return ['AI configuration missing'];
        }

        let backend = BACKEND_OPENAI;
        try {
            backend = CodexBridgeClient.normalizeBackend(aiConfig.backend);
        } catch (error) {
            return [error.message];
        }

        if (backend === BACKEND_OPENAI) {
            const errors = [];
            if (!aiConfig.endpoint) {
                errors.push('AI endpoint not specified');
            }
            const hasOAuthKey = typeof aiConfig['oauth-key'] === 'string' && aiConfig['oauth-key'].trim()
                || typeof aiConfig.oauthKey === 'string' && aiConfig.oauthKey.trim();
            const hasOAuthUrl = typeof aiConfig['oauth-url'] === 'string' && aiConfig['oauth-url'].trim()
                || typeof aiConfig.oauthUrl === 'string' && aiConfig.oauthUrl.trim();
            if (aiConfig['oauth-key'] !== undefined && typeof aiConfig['oauth-key'] !== 'string') {
                errors.push('AI oauth-key must be a string');
            }
            if (aiConfig.oauthKey !== undefined && typeof aiConfig.oauthKey !== 'string') {
                errors.push('AI oauthKey must be a string');
            }
            if (aiConfig['oauth-url'] !== undefined && typeof aiConfig['oauth-url'] !== 'string') {
                errors.push('AI oauth-url must be a string');
            }
            if (aiConfig.oauthUrl !== undefined && typeof aiConfig.oauthUrl !== 'string') {
                errors.push('AI oauthUrl must be a string');
            }
            if (aiConfig['oauth-client-id'] !== undefined && typeof aiConfig['oauth-client-id'] !== 'string') {
                errors.push('AI oauth-client-id must be a string');
            }
            if (aiConfig.oauthClientId !== undefined && typeof aiConfig.oauthClientId !== 'string') {
                errors.push('AI oauthClientId must be a string');
            }
            if (hasOAuthKey && !hasOAuthUrl) {
                errors.push('AI oauth-url not specified');
            }
            if (!aiConfig.apiKey && !hasOAuthKey) {
                errors.push('AI API key or oauth-key not specified');
            }
            if (!aiConfig.model) {
                errors.push('AI model not specified');
            }
            return errors;
        }

        const errors = [];
        if (!aiConfig.model) {
            errors.push('AI model not specified');
        }
        const bridgeConfig = aiConfig.codex_bridge;
        if (bridgeConfig !== undefined && bridgeConfig !== null && !isPlainObject(bridgeConfig)) {
            errors.push('ai.codex_bridge must be an object when provided');
            return errors;
        }
        const resolvedBridgeConfig = {
            ...DEFAULT_CODEX_BRIDGE_CONFIG,
            ...(isPlainObject(bridgeConfig) ? bridgeConfig : {})
        };
        const sessionMode = typeof resolvedBridgeConfig.session_mode === 'string'
            ? resolvedBridgeConfig.session_mode.trim().toLowerCase()
            : '';
        if (!['fresh', 'resume_last', 'resume_id'].includes(sessionMode)) {
            errors.push('ai.codex_bridge.session_mode must be one of: fresh, resume_last, resume_id');
        }
        if (sessionMode === 'resume_id') {
            const sessionId = typeof resolvedBridgeConfig.session_id === 'string'
                ? resolvedBridgeConfig.session_id.trim()
                : '';
            if (!sessionId) {
                errors.push('ai.codex_bridge.session_id is required when session_mode is resume_id');
            }
        }
        const command = typeof resolvedBridgeConfig.command === 'string'
            ? resolvedBridgeConfig.command.trim()
            : '';
        if (!command) {
            errors.push('ai.codex_bridge.command must be a non-empty string');
        }
        const sandbox = typeof resolvedBridgeConfig.sandbox === 'string'
            ? resolvedBridgeConfig.sandbox.trim().toLowerCase()
            : '';
        if (!['read-only', 'workspace-write', 'danger-full-access'].includes(sandbox)) {
            errors.push('ai.codex_bridge.sandbox must be one of: read-only, workspace-write, danger-full-access');
        }
        const reasoningEffort = typeof resolvedBridgeConfig.reasoning_effort === 'string'
            ? resolvedBridgeConfig.reasoning_effort.trim().toLowerCase()
            : '';
        if (reasoningEffort && !CODEX_REASONING_EFFORTS.includes(reasoningEffort)) {
            errors.push(`ai.codex_bridge.reasoning_effort must be one of: ${CODEX_REASONING_EFFORTS.join(', ')}`);
        }
        if (resolvedBridgeConfig.idle_timeout_ms !== undefined && resolvedBridgeConfig.idle_timeout_ms !== null) {
            const idleTimeoutMs = Number(resolvedBridgeConfig.idle_timeout_ms);
            if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0) {
                errors.push('ai.codex_bridge.idle_timeout_ms must be a positive number when provided');
            }
        }
        return errors;
    }

    static resolveBridgeConfig(aiConfig = Globals?.config?.ai) {
        const errors = CodexBridgeClient.getConfigurationErrors(aiConfig);
        if (errors.length) {
            throw new Error(errors.join('. '));
        }

        const bridgeConfig = isPlainObject(aiConfig?.codex_bridge) ? aiConfig.codex_bridge : {};
        const resolved = {
            ...DEFAULT_CODEX_BRIDGE_CONFIG,
            ...bridgeConfig
        };
        resolved.command = String(resolved.command).trim();
        resolved.session_mode = String(resolved.session_mode).trim().toLowerCase();
        resolved.session_id = typeof resolved.session_id === 'string' ? resolved.session_id.trim() : '';
        resolved.sandbox = String(resolved.sandbox).trim().toLowerCase();
        resolved.reasoning_effort = typeof resolved.reasoning_effort === 'string'
            ? resolved.reasoning_effort.trim().toLowerCase()
            : '';
        resolved.profile = typeof resolved.profile === 'string' ? resolved.profile.trim() : '';
        resolved.prompt_preamble = typeof resolved.prompt_preamble === 'string' ? resolved.prompt_preamble.trim() : '';
        resolved.skip_git_repo_check = resolved.skip_git_repo_check !== false;
        resolved.idle_timeout_ms = Number(resolved.idle_timeout_ms);
        return resolved;
    }

    static resolveBridgeIdleTimeoutMs(aiConfig = Globals?.config?.ai) {
        const bridgeConfig = CodexBridgeClient.resolveBridgeConfig(aiConfig);
        if (Number.isFinite(bridgeConfig.idle_timeout_ms) && bridgeConfig.idle_timeout_ms > 0) {
            return bridgeConfig.idle_timeout_ms;
        }
        const baseTimeoutSeconds = Number(aiConfig?.baseTimeoutSeconds);
        if (Number.isFinite(baseTimeoutSeconds) && baseTimeoutSeconds > 0) {
            return baseTimeoutSeconds * 1000;
        }
        return 30000;
    }

    static resolveHomePath(aiConfig = Globals?.config?.ai) {
        const bridgeConfig = CodexBridgeClient.resolveBridgeConfig(aiConfig);
        const configuredHome = typeof bridgeConfig.home === 'string' ? bridgeConfig.home.trim() : '';
        if (!configuredHome) {
            return '';
        }
        const baseDir = Globals?.baseDir || process.cwd();
        return path.isAbsolute(configuredHome)
            ? configuredHome
            : path.join(baseDir, configuredHome);
    }

    static ensureRuntimeFiles({ allowToolCalls, aiConfig }) {
        const baseDir = Globals?.baseDir || process.cwd();
        const runtimeDir = path.join(baseDir, 'tmp', 'codex-bridge-runtime');
        ensureDirectory(runtimeDir);

        const schemaPath = path.join(
            runtimeDir,
            allowToolCalls ? 'codex-bridge-tool-response.schema.json' : 'codex-bridge-response.schema.json'
        );
        const schemaContent = `${JSON.stringify(buildSchema({ allowToolCalls }), null, 2)}\n`;
        if (!fs.existsSync(schemaPath) || fs.readFileSync(schemaPath, 'utf8') !== schemaContent) {
            fs.writeFileSync(schemaPath, schemaContent, 'utf8');
        }

        const outputPath = path.join(runtimeDir, `codex-output-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.json`);

        const homePath = CodexBridgeClient.resolveHomePath(aiConfig);
        if (homePath) {
            ensureDirectory(homePath);
        }

        return {
            runtimeDir,
            schemaPath,
            outputPath,
            homePath
        };
    }

    static buildCommandArgs({
        bridgeConfig,
        outputPath,
        schemaPath,
        allowToolCalls,
        developerInstructions,
        model
    }) {
        const args = [];
        if (bridgeConfig.session_mode === 'fresh') {
            args.push('exec', '--json', '--ephemeral');
            if (bridgeConfig.profile) {
                args.push('-p', bridgeConfig.profile);
            }
            if (typeof developerInstructions === 'string' && developerInstructions.trim()) {
                args.push('-c', `developer_instructions=${JSON.stringify(developerInstructions)}`);
            }
            if (bridgeConfig.reasoning_effort) {
                args.push('-c', `model_reasoning_effort="${bridgeConfig.reasoning_effort}"`);
            }
            if (typeof model === 'string' && model.trim()) {
                args.push('-m', model.trim());
            }
            args.push('--sandbox', bridgeConfig.sandbox);
            if (bridgeConfig.skip_git_repo_check) {
                args.push('--skip-git-repo-check');
            }
            args.push('--output-schema', schemaPath);
            args.push('-o', outputPath);
            args.push('-');
            return args;
        }

        args.push('exec', 'resume', '--json');
        if (bridgeConfig.session_mode === 'resume_last') {
            args.push('--last');
        } else {
            args.push(bridgeConfig.session_id);
        }
        if (bridgeConfig.profile) {
            args.push('-p', bridgeConfig.profile);
        }
        if (typeof developerInstructions === 'string' && developerInstructions.trim()) {
            args.push('-c', `developer_instructions=${JSON.stringify(developerInstructions)}`);
        }
        if (bridgeConfig.reasoning_effort) {
            args.push('-c', `model_reasoning_effort="${bridgeConfig.reasoning_effort}"`);
        }
        if (typeof model === 'string' && model.trim()) {
            args.push('-m', model.trim());
        }
        if (bridgeConfig.skip_git_repo_check) {
            args.push('--skip-git-repo-check');
        }
        args.push('-o', outputPath);
        args.push('-');
        return args;
    }

    static buildAppServerArgs(bridgeConfig) {
        const args = [];
        if (bridgeConfig.profile) {
            args.push('-p', bridgeConfig.profile);
        }
        args.push('app-server', '--listen', 'stdio://');
        return args;
    }

    static extractUsageFromStdout(rawText) {
        return extractUsageFromStdout(rawText);
    }

    static async runCodexAppServer({
        aiConfig = Globals?.config?.ai,
        timeoutMs = CODEX_APP_SERVER_TIMEOUT_MS,
        signal = null,
        onStdoutChunk = null,
        onStdoutEvent = null,
        sessionHandler
    } = {}) {
        if (typeof sessionHandler !== 'function') {
            throw new Error('Codex app-server sessionHandler must be a function.');
        }
        const bridgeConfig = CodexBridgeClient.resolveBridgeConfig(aiConfig);
        const homePath = CodexBridgeClient.resolveHomePath(aiConfig);
        const env = { ...process.env };
        if (homePath) {
            ensureDirectory(homePath);
            env.CODEX_HOME = homePath;
        }
        return await new Promise((resolve, reject) => {
            if (signal?.aborted) {
                const reason = signal.reason instanceof Error
                    ? signal.reason.message
                    : 'Codex app-server request aborted before process start.';
                reject(new Error(reason));
                return;
            }

            const child = spawn(bridgeConfig.command, CodexBridgeClient.buildAppServerArgs(bridgeConfig), {
                cwd: Globals?.baseDir || process.cwd(),
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let settled = false;
            let stdout = '';
            let stderr = '';
            let stdoutBuffer = '';
            let timeoutHandle = null;
            let killEscalationHandle = null;
            let abortHandler = null;
            let nextRequestId = 1;
            const pending = new Map();

            const finishReject = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                if (killEscalationHandle) {
                    clearTimeout(killEscalationHandle);
                }
                if (signal && abortHandler) {
                    signal.removeEventListener('abort', abortHandler);
                }
                try {
                    child.kill('SIGTERM');
                } catch (_) {
                    // Ignore child termination failures during cleanup.
                }
                pending.forEach(({ reject: rejectPending }) => {
                    rejectPending(error);
                });
                pending.clear();
                reject(error);
            };

            const finishResolve = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                if (killEscalationHandle) {
                    clearTimeout(killEscalationHandle);
                }
                if (signal && abortHandler) {
                    signal.removeEventListener('abort', abortHandler);
                }
                try {
                    child.stdin.end();
                } catch (_) {
                    // Ignore stdin close failures during cleanup.
                }
                resolve({
                    result,
                    stdout,
                    stderr
                });
            };

            const request = (method, params) => new Promise((resolveRequest, rejectRequest) => {
                const id = nextRequestId;
                nextRequestId += 1;
                pending.set(id, { resolve: resolveRequest, reject: rejectRequest, method });
                const payload = JSON.stringify({
                    jsonrpc: '2.0',
                    id,
                    method,
                    params
                });
                child.stdin.write(`${payload}\n`, (error) => {
                    if (error) {
                        pending.delete(id);
                        rejectRequest(error);
                    }
                });
            });

            const resetIdleTimeout = () => {
                if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || settled) {
                    return;
                }
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                timeoutHandle = setTimeout(() => {
                    finishReject(new Error(`Codex app-server request timed out after ${timeoutMs} ms without streamed data.`));
                }, timeoutMs);
            };
            resetIdleTimeout();

            if (signal) {
                abortHandler = () => {
                    const reason = signal.reason instanceof Error
                        ? signal.reason.message
                        : 'Codex app-server request aborted.';
                    try {
                        child.kill('SIGTERM');
                    } catch (_) {
                        // Ignore SIGTERM failures during abort cleanup.
                    }
                    killEscalationHandle = setTimeout(() => {
                        try {
                            child.kill('SIGKILL');
                        } catch (_) {
                            // Ignore SIGKILL failures.
                        }
                    }, 1000);
                    finishReject(new Error(reason));
                };
                signal.addEventListener('abort', abortHandler, { once: true });
            }

            child.on('error', (error) => {
                finishReject(new Error(`Failed to start Codex app-server process: ${error.message}`));
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
                        finishReject(new Error(`Codex app-server stdout handler failed: ${error?.message || error}`));
                        return;
                    }
                }
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line.startsWith('{')) {
                        continue;
                    }
                    let parsed = null;
                    try {
                        parsed = JSON.parse(line);
                    } catch (_) {
                        continue;
                    }
                    const normalized = normalizeStdoutEvent(parsed);
                    const pendingRequest = pending.get(parsed.id);
                    if (!pendingRequest) {
                        if (typeof onStdoutEvent === 'function' && !Object.prototype.hasOwnProperty.call(parsed, 'id')) {
                            try {
                                onStdoutEvent(normalized);
                            } catch (error) {
                                finishReject(new Error(`Codex app-server event handler failed: ${error?.message || error}`));
                                return;
                            }
                        }
                        continue;
                    }
                    pending.delete(parsed.id);
                    if (parsed.error) {
                        const errorMessage = typeof parsed.error?.message === 'string' && parsed.error.message.trim()
                            ? parsed.error.message.trim()
                            : `Codex app-server request ${pendingRequest.method} failed.`;
                        pendingRequest.reject(new Error(errorMessage));
                        continue;
                    }
                    pendingRequest.resolve(parsed.result ?? null);
                }
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString('utf8');
            });

            child.on('close', (code, signal) => {
                if (settled) {
                    return;
                }
                const trailingEvents = parseJsonLines(stdoutBuffer);
                if (trailingEvents.length) {
                    for (const parsed of trailingEvents) {
                        const pendingRequest = pending.get(parsed.id);
                        if (!pendingRequest) {
                            if (typeof onStdoutEvent === 'function' && !Object.prototype.hasOwnProperty.call(parsed, 'id')) {
                                try {
                                    onStdoutEvent(parsed);
                                } catch (error) {
                                    finishReject(new Error(`Codex app-server event handler failed: ${error?.message || error}`));
                                    return;
                                }
                            }
                            continue;
                        }
                        pending.delete(parsed.id);
                        if (parsed.error) {
                            const errorMessage = typeof parsed.error?.message === 'string' && parsed.error.message.trim()
                                ? parsed.error.message.trim()
                                : `Codex app-server request ${pendingRequest.method} failed.`;
                            pendingRequest.reject(new Error(errorMessage));
                            continue;
                        }
                        pendingRequest.resolve(parsed.result ?? null);
                    }
                }
                const pendingEntries = Array.from(pending.values());
                pending.clear();
                if (pendingEntries.length) {
                    const details = [
                        `Codex app-server process exited with code ${code}${signal ? ` (signal: ${signal})` : ''} before all requests completed.`
                    ];
                    if (stderr.trim()) {
                        details.push(`stderr:\n${stderr.trim()}`);
                    }
                    if (stdout.trim()) {
                        details.push(`stdout:\n${stdout.trim()}`);
                    }
                    const error = new Error(details.join('\n\n'));
                    pendingEntries.forEach(({ reject: rejectPending }) => rejectPending(error));
                    finishReject(error);
                    return;
                }
                finishReject(new Error(
                    `Codex app-server process exited with code ${code}${signal ? ` (signal: ${signal})` : ''} before the session completed.`
                ));
            });

            (async () => {
                try {
                    await request('initialize', {
                        clientInfo: {
                            name: 'ai_rpg_codex_bridge',
                            version: '1.0.0'
                        }
                    });
                    const result = await sessionHandler({
                        request
                    });
                    finishResolve(result);
                } catch (error) {
                    const details = [];
                    if (error?.message) {
                        details.push(error.message);
                    }
                    if (stderr.trim()) {
                        details.push(`stderr:\n${stderr.trim()}`);
                    }
                    if (stdout.trim()) {
                        details.push(`stdout:\n${stdout.trim()}`);
                    }
                    finishReject(new Error(details.join('\n\n') || 'Codex app-server session failed.'));
                }
            })();
        });
    }

    static async readRateLimits({ aiConfig = Globals?.config?.ai, timeoutMs = CODEX_APP_SERVER_TIMEOUT_MS } = {}) {
        const { result } = await CodexBridgeClient.runCodexAppServer({
            aiConfig,
            timeoutMs,
            sessionHandler: async ({ request }) => {
                return await request('account/rateLimits/read', null);
            }
        });
        return result;
    }

    static async runCodexCommand({
        command,
        args,
        promptText,
        timeoutMs,
        cwd,
        env,
        signal = null,
        onStdoutChunk = null,
        onStdoutEvent = null
    }) {
        return await new Promise((resolve, reject) => {
            if (signal?.aborted) {
                const reason = signal.reason instanceof Error
                    ? signal.reason.message
                    : 'Codex bridge request aborted before process start.';
                reject(new Error(reason));
                return;
            }
            const child = spawn(command, args, {
                cwd,
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let stdoutBuffer = '';
            let threadId = '';
            let settled = false;
            let timeoutHandle = null;
            let killEscalationHandle = null;
            let abortHandler = null;

            const finalizeReject = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                if (killEscalationHandle) {
                    clearTimeout(killEscalationHandle);
                }
                if (signal && abortHandler) {
                    signal.removeEventListener('abort', abortHandler);
                }
                reject(error);
            };

            const finalizeResolve = (result) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                if (killEscalationHandle) {
                    clearTimeout(killEscalationHandle);
                }
                if (signal && abortHandler) {
                    signal.removeEventListener('abort', abortHandler);
                }
                resolve(result);
            };

            const terminateChild = (reason) => {
                if (child.killed) {
                    return;
                }
                try {
                    child.kill('SIGTERM');
                } catch (_) {
                    // Ignore SIGTERM failures and continue to SIGKILL fallback.
                }
                killEscalationHandle = setTimeout(() => {
                    try {
                        child.kill('SIGKILL');
                    } catch (_) {
                        // Ignore SIGKILL failures.
                    }
                }, 1000);
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
                    terminateChild(`Codex bridge request timed out after ${timeoutMs} ms without streamed data.`);
                }, timeoutMs);
            };
            resetIdleTimeout();

            if (signal) {
                abortHandler = () => {
                    const reason = signal.reason instanceof Error
                        ? signal.reason.message
                        : 'Codex bridge request aborted.';
                    terminateChild(reason);
                };
                signal.addEventListener('abort', abortHandler, { once: true });
            }

            child.on('error', (error) => {
                finalizeReject(new Error(`Failed to start Codex bridge process: ${error.message}`));
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
                        terminateChild(`Codex stdout progress handler failed: ${error?.message || error}`);
                        return;
                    }
                }
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';
                const captureEventFromLine = (rawLine) => {
                    const line = rawLine.trim();
                    if (!line.startsWith('{')) {
                        return null;
                    }
                    try {
                        const parsed = normalizeStdoutEvent(JSON.parse(line));
                        const nextThreadId = extractThreadIdFromEvent(parsed);
                        if (nextThreadId) {
                            threadId = nextThreadId;
                        }
                        return parsed;
                    } catch (_) {
                        // Ignore non-JSON or partial lines in the bridge event stream.
                        return null;
                    }
                };
                for (const rawLine of lines) {
                    const parsedEvent = captureEventFromLine(rawLine);
                    if (parsedEvent && typeof onStdoutEvent === 'function') {
                        try {
                            onStdoutEvent(parsedEvent);
                        } catch (error) {
                            terminateChild(`Codex stdout event handler failed: ${error?.message || error}`);
                            return;
                        }
                    }
                }
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString('utf8');
            });

            child.on('close', (code, signal) => {
                if (settled) {
                    return;
                }
                const trailingStdoutLine = stdoutBuffer.trim();
                if (trailingStdoutLine) {
                    try {
                        const parsed = normalizeStdoutEvent(JSON.parse(trailingStdoutLine));
                        const nextThreadId = extractThreadIdFromEvent(parsed);
                        if (nextThreadId) {
                            threadId = nextThreadId;
                        }
                        if (typeof onStdoutEvent === 'function') {
                            onStdoutEvent(parsed);
                        }
                    } catch (_) {
                        // Ignore non-JSON or partial trailing lines in the bridge event stream.
                    }
                }
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
                }
                if (killEscalationHandle) {
                    clearTimeout(killEscalationHandle);
                }
                if (code !== 0) {
                    const details = [
                        `Codex bridge process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}.`
                    ];
                    if (stderr.trim()) {
                        details.push(`stderr:\n${stderr.trim()}`);
                    }
                    if (stdout.trim()) {
                        details.push(`stdout:\n${stdout.trim()}`);
                    }
                    reject(new Error(details.join('\n\n')));
                    return;
                }
                resolve({ stdout, stderr, threadId });
            });

            child.stdin.on('error', (error) => {
                finalizeReject(new Error(`Failed to write Codex bridge prompt to stdin: ${error.message}`));
            });

            child.stdin.end(promptText, 'utf8');
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
        const bridgeConfig = CodexBridgeClient.resolveBridgeConfig(aiConfig);
        const allowedTools = Array.isArray(additionalPayload?.tools) ? additionalPayload.tools : [];
        const allowToolCalls = allowedTools.length > 0;
        const { systemMessages, conversationMessages } = splitBridgeMessages(messages);
        const developerInstructions = buildDeveloperInstructions({
            systemMessages,
            tools: allowedTools,
            metadataLabel,
            promptPreamble: bridgeConfig.prompt_preamble
        });
        const promptText = buildUserPrompt({
            messages: conversationMessages
        });
        const cwd = Globals?.baseDir || process.cwd();
        const outputSchema = buildSchema({ allowToolCalls });
        const previewState = {
            previewText: '',
            rawAssistantText: ''
        };
        const turnState = {
            threadId: '',
            assistantText: '',
            usage: null,
            resolveTurn: null,
            rejectTurn: null,
            completed: false
        };
        const requestPayload = {
            backend: BACKEND_CODEX,
            command: bridgeConfig.command,
            args: CodexBridgeClient.buildAppServerArgs(bridgeConfig),
            sessionMode: bridgeConfig.session_mode,
            developerInstructions,
            conversationMessages,
            messages,
            tools: allowedTools,
            outputSchema
        };
        let commandStdout = '';
        let commandStderr = '';
        const forwardBridgeEvent = (event) => {
            if (!event || typeof event !== 'object') {
                return;
            }
            const eventKey = normalizeCodexEventKey(getCodexEventType(event));
            const eventThreadId = extractThreadIdFromEvent(event);
            const threadMatches = !turnState.threadId || !eventThreadId || eventThreadId === turnState.threadId;

            if (threadMatches) {
                if (eventKey === 'item_agent_message_delta') {
                    const rawAssistantDelta = typeof event.delta === 'string' ? event.delta : '';
                    if (rawAssistantDelta) {
                        previewState.rawAssistantText += rawAssistantDelta;
                    }
                } else if (eventKey === 'item_completed') {
                    const itemTypeKey = normalizeCodexEventKey(event.item?.type);
                    if (itemTypeKey === 'agent_message' && typeof event.item?.text === 'string') {
                        previewState.rawAssistantText = event.item.text;
                        turnState.assistantText = event.item.text;
                    }
                } else if (eventKey === 'thread_token_usage_updated') {
                    turnState.usage = normalizeUsage(
                        event.tokenUsage?.last || event.token_usage?.last || event.tokenUsage || event.token_usage
                    ) || turnState.usage;
                } else if (eventKey === 'turn_completed') {
                    turnState.completed = true;
                    if (!turnState.assistantText && previewState.rawAssistantText) {
                        turnState.assistantText = previewState.rawAssistantText;
                    }
                    if (typeof turnState.resolveTurn === 'function') {
                        turnState.resolveTurn();
                    }
                } else if (eventKey === 'turn_failed' || eventKey === 'error') {
                    const errorMessage = typeof event.error?.message === 'string' && event.error.message.trim()
                        ? event.error.message.trim()
                        : typeof event.message === 'string' && event.message.trim()
                            ? event.message.trim()
                            : 'Codex app-server turn failed.';
                    if (typeof turnState.rejectTurn === 'function') {
                        turnState.rejectTurn(new Error(errorMessage));
                    }
                }
            }

            if (typeof onStdoutEvent !== 'function') {
                return;
            }
            if (eventKey === 'item_agent_message_delta') {
                const previewUpdate = buildBridgePreviewUpdate(previewState, previewState.rawAssistantText);
                if (previewUpdate) {
                    onStdoutEvent({
                        type: previewUpdate.type,
                        delta: previewUpdate.replace ? undefined : previewUpdate.text,
                        text: previewUpdate.replace ? previewUpdate.text : undefined
                    });
                }
                return;
            }
            if (eventKey === 'item_completed') {
                const itemTypeKey = normalizeCodexEventKey(event.item?.type);
                if (itemTypeKey === 'agent_message') {
                    const previewUpdate = buildBridgePreviewUpdate(previewState, previewState.rawAssistantText, { final: true });
                    if (previewUpdate) {
                        onStdoutEvent({
                            type: 'item.completed',
                            item: {
                                type: 'agent_message',
                                text: previewUpdate.text
                            }
                        });
                    }
                    return;
                }
            }
            onStdoutEvent(event);
        };

        try {
            const {
                result: {
                    threadId,
                    assistantText,
                    usage
                },
                stdout,
                stderr
            } = await CodexBridgeClient.runCodexAppServer({
                aiConfig,
                timeoutMs,
                signal,
                onStdoutChunk,
                onStdoutEvent: forwardBridgeEvent,
                sessionHandler: async ({ request }) => {
                    const threadParams = {
                        developerInstructions,
                        cwd,
                        model: typeof model === 'string' && model.trim() ? model.trim() : null,
                        approvalPolicy: 'never',
                        sandbox: bridgeConfig.sandbox
                    };
                    let threadResponse = null;
                    if (bridgeConfig.session_mode === 'fresh') {
                        threadResponse = await request('thread/start', {
                            ...threadParams,
                            ephemeral: true
                        });
                    } else if (bridgeConfig.session_mode === 'resume_last') {
                        const listedThreads = await request('thread/list', {
                            archived: false,
                            cwd,
                            limit: 1,
                            sortKey: 'updated_at',
                            sourceKinds: CODEX_APP_SERVER_THREAD_SOURCE_KINDS
                        });
                        const lastThreadId = Array.isArray(listedThreads?.data) && listedThreads.data.length
                            ? String(listedThreads.data[0]?.id || '').trim()
                            : '';
                        if (!lastThreadId) {
                            throw new Error('Codex bridge resume_last mode could not find a prior thread for the configured home directory.');
                        }
                        threadResponse = await request('thread/resume', {
                            ...threadParams,
                            threadId: lastThreadId
                        });
                    } else {
                        threadResponse = await request('thread/resume', {
                            ...threadParams,
                            threadId: bridgeConfig.session_id
                        });
                    }

                    const threadId = typeof threadResponse?.thread?.id === 'string' && threadResponse.thread.id.trim()
                        ? threadResponse.thread.id.trim()
                        : '';
                    if (!threadId) {
                        throw new Error('Codex app-server did not return a thread id.');
                    }
                    turnState.threadId = threadId;
                    turnState.assistantText = '';
                    turnState.usage = null;
                    turnState.completed = false;
                    previewState.rawAssistantText = '';
                    previewState.previewText = '';
                    let turnStartRequest = null;
                    await new Promise((resolveTurn, rejectTurn) => {
                        turnState.resolveTurn = resolveTurn;
                        turnState.rejectTurn = rejectTurn;
                        turnStartRequest = request('turn/start', {
                            approvalPolicy: 'never',
                            cwd,
                            effort: bridgeConfig.reasoning_effort || null,
                            input: [
                                {
                                    type: 'text',
                                    text: promptText
                                }
                            ],
                            model: typeof model === 'string' && model.trim() ? model.trim() : null,
                            outputSchema,
                            sandboxPolicy: buildAppServerSandboxPolicy(bridgeConfig.sandbox, cwd),
                            threadId
                        }).catch(rejectTurn);
                    });
                    if (turnStartRequest) {
                        await turnStartRequest;
                    }
                    turnState.resolveTurn = null;
                    turnState.rejectTurn = null;
                    if (!turnState.completed) {
                        throw new Error('Codex app-server turn did not complete.');
                    }
                    if (!turnState.assistantText) {
                        throw new Error('Codex app-server did not return a final assistant message.');
                    }
                    return {
                        threadId,
                        assistantText: turnState.assistantText,
                        usage: turnState.usage
                    };
                }
            });
            commandStdout = stdout;
            commandStderr = stderr;
            const parsed = parseBridgeMessage(assistantText, { allowToolCalls });
            const normalizedResponse = buildResponseData({
                content: parsed.content,
                toolCalls: parsed.toolCalls,
                model,
                threadId,
                usage
            });
            logBridgePrompt({
                metadataLabel,
                model,
                systemPrompt: developerInstructions,
                promptText,
                normalizedResponse,
                requestPayload,
                commandStdout,
                commandStderr
            });
            return {
                status: 200,
                statusText: 'OK',
                headers: {},
                config: {
                    backend: BACKEND_CODEX
                },
                data: normalizedResponse
            };
        } catch (error) {
            logBridgePrompt({
                metadataLabel,
                model,
                systemPrompt: developerInstructions,
                promptText,
                normalizedResponse: null,
                requestPayload,
                commandStdout,
                commandStderr,
                error
            });
            throw error;
        }
    }
}

module.exports = CodexBridgeClient;
