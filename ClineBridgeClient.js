const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const Globals = require('./Globals.js');

const BACKEND_CLINE = 'cline_cli_bridge';
const CLINE_THINKING_LEVELS = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh']);
const CLINE_COMPACTION_MODES = Object.freeze(['agentic', 'basic', 'off']);
const CLINE_BRIDGE_SYSTEM_PROMPT = [
    'You are acting as a completion bridge for an external application.',
    'Read the complete bridge instructions and conversation from stdin.',
    'Return only the JSON object requested there.',
    'Do not use shell commands, file access, web access, browser access, MCP tools, Cline tools, or any external tools.'
].join(' ');
const CLINE_STDIN_PROMPT_ARGUMENT = 'Use the piped stdin as the complete prompt and follow it exactly.';
const DEFAULT_CLINE_BRIDGE_CONFIG = Object.freeze({
    command: 'cline',
    provider: '',
    cwd: './tmp/cline-bridge-cwd',
    thinking: '',
    compaction: 'basic',
    timeout_seconds: 0,
    config: '',
    data_dir: '',
    prompt_preamble: ''
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

function resolvePathFromBase(configuredPath) {
    const trimmed = typeof configuredPath === 'string' ? configuredPath.trim() : '';
    if (!trimmed) {
        return '';
    }
    return path.isAbsolute(trimmed) ? trimmed : path.join(resolveBaseDir(), trimmed);
}

function ensureDirectory(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
        throw new Error('Directory path must be a non-empty string.');
    }
    fs.mkdirSync(targetPath, { recursive: true });
}

function writePromptTempFile(promptText) {
    const promptDir = path.join(resolveBaseDir(), 'tmp', 'cline-bridge-prompts');
    ensureDirectory(promptDir);
    const promptPath = path.join(promptDir, `${Date.now()}-${randomUUID()}.txt`);
    fs.writeFileSync(promptPath, typeof promptText === 'string' ? promptText : '', {
        encoding: 'utf8',
        mode: 0o600
    });
    return promptPath;
}

function removePromptTempFile(promptPath) {
    if (!promptPath) {
        return;
    }
    try {
        fs.rmSync(promptPath, { force: true });
    } catch (_) {
        // Temp prompt cleanup should not mask the completion result.
    }
}

function formatSeconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return '';
    }
    return Number.isInteger(numeric) ? String(numeric) : String(numeric);
}

function normalizeBackendAlias(rawValue) {
    const normalized = typeof rawValue === 'string'
        ? rawValue.trim().toLowerCase()
        : '';
    return normalized === 'cline'
        || normalized === 'cline_cli'
        || normalized === 'cline-bridge'
        || normalized === BACKEND_CLINE
        ? BACKEND_CLINE
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
                            ? '[image omitted: data URL content is not supported by the Cline bridge]'
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
        throw new Error('Cline bridge requires a non-empty messages array.');
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
        throw new Error('Cline bridge requires a non-empty messages array.');
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
        throw new Error('Cline bridge requires at least one non-system message.');
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
        throw new Error('Cline bridge tool definitions must be an array.');
    }
    if (!tools.length) {
        return '';
    }
    const lines = [];
    tools.forEach((tool, index) => {
        if (!tool || typeof tool !== 'object') {
            throw new Error(`Cline bridge tool definition at index ${index} must be an object.`);
        }
        if (tool.type !== 'function' || !isPlainObject(tool.function)) {
            throw new Error(`Cline bridge only supports function tools. Invalid tool at index ${index}.`);
        }
        const functionName = typeof tool.function.name === 'string' && tool.function.name.trim()
            ? tool.function.name.trim()
            : '';
        if (!functionName) {
            throw new Error(`Cline bridge tool definition at index ${index} is missing function.name.`);
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
Do not use shell commands, file access, web access, browser access, MCP tools, Cline tools, or any external tools beyond the application tools listed below.
Ignore unrelated prior Cline session context if any exists. Use only the conversation and tool results supplied in the user prompt.${systemSection}

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
Do not use shell commands, file access, web access, browser access, MCP tools, Cline tools, or any external tools.
Ignore unrelated prior Cline session context if any exists. Use only the conversation supplied in the user prompt.${systemSection}

Your JSON must be:
{"content":"..."}

Rules:
- Put the full next assistant message inside "content".
- If the conversation requires strict XML, JSON, or other formatting, preserve that exact text in "content".
- Do not wrap the JSON in markdown fences.
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
        throw new Error('Cline bridge returned an empty message.');
    }

    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function looksLikeJsonResponseAttempt(rawText) {
    const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
    if (!trimmed) {
        return false;
    }
    if (/^```json\b/i.test(trimmed)) {
        return true;
    }
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
    return candidate.startsWith('{') || candidate.startsWith('[');
}

function findBalancedJsonObject(text, startIndex) {
    if (typeof text !== 'string' || text[startIndex] !== '{') {
        return '';
    }

    let depth = 0;
    let inString = false;
    let escaping = false;
    for (let index = startIndex; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaping) {
                escaping = false;
            } else if (char === '\\') {
                escaping = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{') {
            depth += 1;
            continue;
        }
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return text.slice(startIndex, index + 1);
            }
        }
    }

    return '';
}

function hasBridgeMessageKey(parsed) {
    return isPlainObject(parsed) && (
        Object.prototype.hasOwnProperty.call(parsed, 'content')
        || Object.prototype.hasOwnProperty.call(parsed, 'tool_calls')
    );
}

function parseEmbeddedBridgeJson(candidate) {
    const text = typeof candidate === 'string' ? candidate : '';
    const objectStartIndexes = [];
    for (let index = text.indexOf('{'); index >= 0; index = text.indexOf('{', index + 1)) {
        objectStartIndexes.push(index);
    }

    for (let index = objectStartIndexes.length - 1; index >= 0; index -= 1) {
        const objectText = findBalancedJsonObject(text, objectStartIndexes[index]);
        if (!objectText) {
            continue;
        }
        try {
            const parsed = JSON.parse(objectText);
            if (hasBridgeMessageKey(parsed)) {
                return parsed;
            }
        } catch (_) {
            // Keep scanning earlier objects; malformed candidates are ignored unless no valid bridge JSON is found.
        }
    }

    return null;
}

function normalizeToolCallArguments(rawArguments, index) {
    if (isPlainObject(rawArguments)) {
        return rawArguments;
    }
    if (typeof rawArguments === 'string') {
        const trimmed = rawArguments.trim();
        if (!trimmed) {
            throw new Error(`Cline bridge tool call ${index + 1} arguments cannot be empty.`);
        }
        let parsed = null;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            throw new Error(`Cline bridge tool call ${index + 1} arguments are not valid JSON: ${error.message}`);
        }
        if (!isPlainObject(parsed)) {
            throw new Error(`Cline bridge tool call ${index + 1} arguments must parse to a JSON object.`);
        }
        return parsed;
    }
    throw new Error(`Cline bridge tool call ${index + 1} arguments must be a JSON object or JSON string.`);
}

function parseBridgeMessage(rawText, { allowToolCalls }) {
    const candidate = extractJsonPayload(rawText);
    let parsed = null;
    try {
        parsed = JSON.parse(candidate);
    } catch (error) {
        const embeddedBridgeJson = parseEmbeddedBridgeJson(candidate);
        if (embeddedBridgeJson) {
            parsed = embeddedBridgeJson;
        } else if (!looksLikeJsonResponseAttempt(rawText)) {
            return {
                content: typeof rawText === 'string' ? rawText : String(rawText ?? ''),
                toolCalls: [],
                raw: rawText
            };
        } else {
            throw new Error(`Cline bridge response is not valid JSON: ${error.message}`);
        }
    }
    if (!isPlainObject(parsed)) {
        throw new Error('Cline bridge response must be a JSON object.');
    }

    const hasContentKey = typeof parsed.content === 'string';
    const hasToolCallsKey = Array.isArray(parsed.tool_calls);

    if (!allowToolCalls) {
        if (!hasContentKey) {
            throw new Error('Cline bridge response must contain "content".');
        }
        if (hasToolCallsKey && parsed.tool_calls.length > 0) {
            throw new Error('Cline bridge returned tool calls for a prompt that does not allow them.');
        }
        return {
            content: parsed.content,
            toolCalls: [],
            raw: parsed
        };
    }

    if (!hasContentKey && !hasToolCallsKey) {
        throw new Error('Cline bridge response must contain "content" and/or "tool_calls".');
    }

    const contentValue = hasContentKey ? parsed.content : '';
    const toolCallList = hasToolCallsKey ? parsed.tool_calls : [];
    const hasNonEmptyContent = contentValue.length > 0;
    const hasAnyToolCalls = toolCallList.length > 0;

    if (hasNonEmptyContent && hasAnyToolCalls) {
        throw new Error('Cline bridge response cannot contain both non-empty "content" and non-empty "tool_calls".');
    }
    if (!hasNonEmptyContent && !hasAnyToolCalls) {
        throw new Error('Cline bridge response must contain either non-empty "content" or at least one tool call.');
    }

    if (hasAnyToolCalls) {
        const normalizedToolCalls = toolCallList.map((toolCall, index) => {
            if (!isPlainObject(toolCall)) {
                throw new Error(`Cline bridge tool call ${index + 1} must be an object.`);
            }
            const name = typeof toolCall.name === 'string' && toolCall.name.trim()
                ? toolCall.name.trim()
                : '';
            if (!name) {
                throw new Error(`Cline bridge tool call ${index + 1} is missing a non-empty name.`);
            }
            const argumentsObject = normalizeToolCallArguments(toolCall.arguments, index);
            return {
                id: `cline_call_${randomUUID()}`,
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

function buildResponseData({ content, toolCalls, model, usage = null }) {
    const finishReason = Array.isArray(toolCalls) && toolCalls.length ? 'tool_calls' : 'stop';
    const response = {
        id: `cline-bridge-${randomUUID()}`,
        object: 'chat.completion',
        created: buildNowTimestamp(),
        model: typeof model === 'string' && model.trim() ? model.trim() : 'cline',
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
    const extracted = extractBridgeContentPreview(rawAssistantText);
    const nextPreviewText = extracted.text || (
        looksLikeJsonResponseAttempt(rawAssistantText)
            ? ''
            : (typeof rawAssistantText === 'string' ? rawAssistantText : '')
    );
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
            parsed.push(JSON.parse(line));
        } catch (_) {
            // Ignore malformed JSONL records; callers fail if no final assistant text is found.
        }
    }
    return parsed;
}

function extractTextFromClineEvent(event) {
    if (!isPlainObject(event)) {
        return '';
    }
    if (typeof event.event?.text === 'string') {
        return event.event.text;
    }
    if (typeof event.text === 'string') {
        return event.text;
    }
    if (typeof event.message === 'string') {
        return event.message;
    }
    return '';
}

function looksLikeBridgeJson(rawText) {
    const candidate = typeof rawText === 'string' ? rawText.trim() : '';
    if (!candidate) {
        return false;
    }
    try {
        const parsed = JSON.parse(extractJsonPayload(candidate));
        return isPlainObject(parsed) && (
            typeof parsed.content === 'string'
            || Array.isArray(parsed.tool_calls)
        );
    } catch (_) {
        return false;
    }
}

function resolveFinalAssistantText({ candidates, stdout }) {
    const ordered = [];
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            ordered.push(candidate);
        }
    }
    const stdoutEvents = parseJsonLines(stdout);
    for (let index = stdoutEvents.length - 1; index >= 0; index -= 1) {
        const text = extractTextFromClineEvent(stdoutEvents[index]);
        if (text.trim()) {
            ordered.push(text);
        }
    }
    for (const candidate of ordered) {
        if (looksLikeBridgeJson(candidate)) {
            return candidate;
        }
    }
    const fallback = ordered.find(candidate => candidate.trim());
    return fallback || '';
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
                title: 'Cline Stdout',
                content: commandStdout.trim()
            });
        }
        if (typeof commandStderr === 'string' && commandStderr.trim()) {
            sections.push({
                title: 'Cline Stderr',
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
        console.warn(`Failed to log Cline bridge prompt: ${loggingError?.message || loggingError}`);
    }
}

class ClineBridgeClient {
    static get backendName() {
        return BACKEND_CLINE;
    }

    static isClineBackend(aiConfig) {
        return normalizeBackendAlias(aiConfig?.backend) === BACKEND_CLINE;
    }

    static getMaxConcurrent(aiConfig = Globals?.config?.ai) {
        const configured = Number(aiConfig?.max_concurrent_requests);
        return Number.isInteger(configured) && configured > 0 ? configured : 1;
    }

    static getSemaphoreKey(_aiConfig = Globals?.config?.ai, model = '') {
        const normalizedModel = typeof model === 'string' && model.trim() ? model.trim() : 'no-model';
        return `${BACKEND_CLINE}::fresh::${normalizedModel}`;
    }

    static getConfigurationErrors(aiConfig) {
        if (!aiConfig || typeof aiConfig !== 'object') {
            return ['AI configuration missing'];
        }

        const errors = [];
        if (!aiConfig.model) {
            errors.push('AI model not specified');
        }
        if (
            aiConfig.prefill !== undefined
            && aiConfig.prefill !== null
            && typeof aiConfig.prefill !== 'string'
        ) {
            errors.push('AI prefill must be a string or null when provided');
        } else if (typeof aiConfig.prefill === 'string' && aiConfig.prefill.trim()) {
            errors.push('AI prefill is not supported with cline_cli_bridge');
        }
        if (
            aiConfig.sysprompt_append !== undefined
            && aiConfig.sysprompt_append !== null
            && typeof aiConfig.sysprompt_append !== 'string'
        ) {
            errors.push('AI sysprompt_append must be a string or null when provided');
        }
        const bridgeConfig = aiConfig.cline_bridge;
        if (bridgeConfig !== undefined && bridgeConfig !== null && !isPlainObject(bridgeConfig)) {
            errors.push('ai.cline_bridge must be an object when provided');
            return errors;
        }
        const resolvedBridgeConfig = {
            ...DEFAULT_CLINE_BRIDGE_CONFIG,
            ...(isPlainObject(bridgeConfig) ? bridgeConfig : {})
        };
        const command = typeof resolvedBridgeConfig.command === 'string'
            ? resolvedBridgeConfig.command.trim()
            : '';
        if (!command) {
            errors.push('ai.cline_bridge.command must be a non-empty string');
        }
        const thinking = typeof resolvedBridgeConfig.thinking === 'string'
            ? resolvedBridgeConfig.thinking.trim().toLowerCase()
            : '';
        if (thinking && !CLINE_THINKING_LEVELS.includes(thinking)) {
            errors.push(`ai.cline_bridge.thinking must be one of: ${CLINE_THINKING_LEVELS.join(', ')}`);
        }
        const compaction = typeof resolvedBridgeConfig.compaction === 'string'
            ? resolvedBridgeConfig.compaction.trim().toLowerCase()
            : '';
        if (compaction && !CLINE_COMPACTION_MODES.includes(compaction)) {
            errors.push(`ai.cline_bridge.compaction must be one of: ${CLINE_COMPACTION_MODES.join(', ')}`);
        }
        const timeoutSeconds = Number(resolvedBridgeConfig.timeout_seconds);
        if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0) {
            errors.push('ai.cline_bridge.timeout_seconds must be a non-negative number when provided');
        }
        return errors;
    }

    static resolveBridgeConfig(aiConfig = Globals?.config?.ai) {
        const errors = ClineBridgeClient.getConfigurationErrors(aiConfig);
        if (errors.length) {
            throw new Error(errors.join('. '));
        }

        const bridgeConfig = isPlainObject(aiConfig?.cline_bridge) ? aiConfig.cline_bridge : {};
        const resolved = {
            ...DEFAULT_CLINE_BRIDGE_CONFIG,
            ...bridgeConfig
        };
        resolved.command = String(resolved.command).trim();
        resolved.provider = typeof resolved.provider === 'string' ? resolved.provider.trim() : '';
        resolved.cwd = typeof resolved.cwd === 'string' ? resolved.cwd.trim() : '';
        resolved.thinking = typeof resolved.thinking === 'string'
            ? resolved.thinking.trim().toLowerCase()
            : '';
        resolved.compaction = typeof resolved.compaction === 'string'
            ? resolved.compaction.trim().toLowerCase()
            : '';
        resolved.timeout_seconds = Number(resolved.timeout_seconds);
        resolved.config = typeof resolved.config === 'string' ? resolved.config.trim() : '';
        resolved.data_dir = typeof resolved.data_dir === 'string' ? resolved.data_dir.trim() : '';
        resolved.prompt_preamble = typeof resolved.prompt_preamble === 'string' ? resolved.prompt_preamble.trim() : '';
        return resolved;
    }

    static resolveBridgeIdleTimeoutMs(aiConfig = Globals?.config?.ai) {
        const baseTimeoutSeconds = Number(aiConfig?.baseTimeoutSeconds);
        if (Number.isFinite(baseTimeoutSeconds) && baseTimeoutSeconds > 0) {
            return baseTimeoutSeconds * 1000;
        }
        return 30000;
    }

    static resolveCwdPath(aiConfig = Globals?.config?.ai) {
        const bridgeConfig = ClineBridgeClient.resolveBridgeConfig(aiConfig);
        const configuredCwd = typeof bridgeConfig.cwd === 'string' ? bridgeConfig.cwd.trim() : '';
        if (!configuredCwd) {
            return resolveBaseDir();
        }
        return path.isAbsolute(configuredCwd)
            ? configuredCwd
            : path.join(resolveBaseDir(), configuredCwd);
    }

    static buildCommandArgs({
        bridgeConfig,
        developerInstructions,
        promptText,
        model,
        cwd
    }) {
        const args = ['--json', '--auto-approve', 'false'];
        if (cwd) {
            args.push('--cwd', cwd);
        }
        args.push('--system', CLINE_BRIDGE_SYSTEM_PROMPT);
        if (bridgeConfig.provider) {
            args.push('--provider', bridgeConfig.provider);
        }
        if (typeof model === 'string' && model.trim()) {
            args.push('--model', model.trim());
        }
        if (bridgeConfig.thinking) {
            args.push('--thinking', bridgeConfig.thinking);
        }
        if (bridgeConfig.compaction) {
            args.push('--compaction', bridgeConfig.compaction);
        }
        if (Number.isFinite(bridgeConfig.timeout_seconds) && bridgeConfig.timeout_seconds > 0) {
            args.push('--timeout', formatSeconds(bridgeConfig.timeout_seconds));
        }
        const configPath = resolvePathFromBase(bridgeConfig.config);
        if (configPath) {
            args.push('--config', configPath);
        }
        const dataDir = resolvePathFromBase(bridgeConfig.data_dir);
        if (dataDir) {
            args.push('--data-dir', dataDir);
        }
        args.push(CLINE_STDIN_PROMPT_ARGUMENT);
        return args;
    }

    static async runClineCommand({
        aiConfig = Globals?.config?.ai,
        timeoutMs = ClineBridgeClient.resolveBridgeIdleTimeoutMs(aiConfig),
        signal = null,
        onStdoutChunk = null,
        onStdoutEvent = null,
        promptText,
        developerInstructions = '',
        model
    } = {}) {
        const bridgeConfig = ClineBridgeClient.resolveBridgeConfig(aiConfig);
        const cwd = ClineBridgeClient.resolveCwdPath(aiConfig);
        ensureDirectory(cwd);
        const args = ClineBridgeClient.buildCommandArgs({
            bridgeConfig,
            developerInstructions,
            promptText,
            model,
            cwd
        });
        const promptFilePath = writePromptTempFile(promptText);
        const launcherCommand = 'bash';
        const launcherArgs = [
            '-lc',
            'set -o pipefail; cat "$1" | "$2" "${@:3}"',
            'cline-bridge-stdin',
            promptFilePath,
            bridgeConfig.command,
            ...args
        ];
        const useProcessGroup = process.platform !== 'win32';
        return await new Promise((resolve, reject) => {
            if (signal?.aborted) {
                removePromptTempFile(promptFilePath);
                const reason = signal.reason instanceof Error
                    ? signal.reason.message
                    : 'Cline bridge request aborted before process start.';
                reject(new Error(reason));
                return;
            }

            const child = spawn(launcherCommand, launcherArgs, {
                cwd,
                env: { ...process.env },
                detached: useProcessGroup,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';
            let stdoutBuffer = '';
            let settled = false;
            let timeoutHandle = null;
            let killEscalationHandle = null;
            let abortHandler = null;
            const parsedEvents = [];
            const textCandidates = [];
            const streamState = {
                rawAssistantText: '',
                latestText: '',
                accumulatedText: '',
                previewText: ''
            };

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
                removePromptTempFile(promptFilePath);
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
                removePromptTempFile(promptFilePath);
                resolve(result);
            };

            const terminateChild = (reason) => {
                if (!child.killed) {
                    try {
                        if (useProcessGroup && child.pid) {
                            process.kill(-child.pid, 'SIGTERM');
                        } else {
                            child.kill('SIGTERM');
                        }
                    } catch (_) {
                        // Ignore SIGTERM failures and continue to SIGKILL fallback.
                    }
                    killEscalationHandle = setTimeout(() => {
                        try {
                            if (useProcessGroup && child.pid) {
                                process.kill(-child.pid, 'SIGKILL');
                            } else {
                                child.kill('SIGKILL');
                            }
                        } catch (_) {
                            // Ignore SIGKILL failures.
                        }
                    }, 1000);
                }
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
                    terminateChild(`Cline bridge request timed out after ${timeoutMs} ms without streamed data.`);
                }, timeoutMs);
            };
            resetIdleTimeout();

            if (signal) {
                abortHandler = () => {
                    const reason = signal.reason instanceof Error
                        ? signal.reason.message
                        : 'Cline bridge request aborted.';
                    terminateChild(reason);
                };
                signal.addEventListener('abort', abortHandler, { once: true });
            }

            const forwardPreviewText = (rawText) => {
                if (typeof rawText !== 'string' || !rawText) {
                    return;
                }
                streamState.latestText = rawText;
                streamState.accumulatedText += rawText;
                if (!streamState.rawAssistantText) {
                    streamState.rawAssistantText = rawText;
                } else if (rawText.startsWith(streamState.rawAssistantText)) {
                    streamState.rawAssistantText = rawText;
                } else {
                    streamState.rawAssistantText += rawText;
                }
                textCandidates.unshift(rawText, streamState.rawAssistantText, streamState.accumulatedText);

                if (typeof onStdoutEvent !== 'function') {
                    return;
                }
                const previewUpdate = buildBridgePreviewUpdate(streamState, streamState.rawAssistantText);
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

            const processParsedEvent = (parsed) => {
                parsedEvents.push(parsed);
                const text = extractTextFromClineEvent(parsed);
                if (text) {
                    forwardPreviewText(text);
                } else if (typeof onStdoutEvent === 'function') {
                    onStdoutEvent(parsed);
                }
            };

            child.on('error', (error) => {
                finalizeReject(new Error(`Failed to start Cline bridge process: ${error.message}`));
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
                        terminateChild(`Cline stdout progress handler failed: ${error?.message || error}`);
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
                    try {
                        processParsedEvent(JSON.parse(line));
                    } catch (_) {
                        // Ignore partial or non-Cline JSONL lines.
                    }
                }
            });

            child.stderr.on('data', (chunk) => {
                stderr += chunk.toString('utf8');
            });

            child.on('close', (code, signalName) => {
                if (settled) {
                    return;
                }
                const trailingStdoutLine = stdoutBuffer.trim();
                if (trailingStdoutLine.startsWith('{')) {
                    try {
                        processParsedEvent(JSON.parse(trailingStdoutLine));
                    } catch (_) {
                        // Ignore non-JSON trailing data.
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
                        `Cline bridge process exited with code ${code}${signalName ? ` (signal: ${signalName})` : ''}.`
                    ];
                    if (stderr.trim()) {
                        details.push(`stderr:\n${stderr.trim()}`);
                    }
                    if (stdout.trim()) {
                        details.push(`stdout:\n${stdout.trim()}`);
                    }
                    finalizeReject(new Error(details.join('\n\n')));
                    return;
                }
                const finalText = resolveFinalAssistantText({
                    candidates: textCandidates,
                    stdout
                });
                if (!finalText) {
                    const details = ['Cline bridge did not return a final assistant message.'];
                    if (stderr.trim()) {
                        details.push(`stderr:\n${stderr.trim()}`);
                    }
                    if (stdout.trim()) {
                        details.push(`stdout:\n${stdout.trim()}`);
                    }
                    finalizeReject(new Error(details.join('\n\n')));
                    return;
                }
                finalizeResolve({
                    stdout,
                    stderr,
                    events: parsedEvents,
                    assistantText: finalText,
                    args,
                    cwd
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
        const bridgeConfig = ClineBridgeClient.resolveBridgeConfig(aiConfig);
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
            messages: conversationMessages,
            developerInstructions
        });
        const requestPayload = {
            backend: BACKEND_CLINE,
            command: bridgeConfig.command,
            args: ClineBridgeClient.buildCommandArgs({
                bridgeConfig,
                developerInstructions,
                promptText,
                model,
                cwd: ClineBridgeClient.resolveCwdPath(aiConfig)
            }),
            conversationMessages,
            messages,
            tools: allowedTools
        };
        let commandStdout = '';
        let commandStderr = '';

        try {
            const result = await ClineBridgeClient.runClineCommand({
                aiConfig,
                timeoutMs,
                signal,
                onStdoutChunk,
                onStdoutEvent,
                promptText,
                developerInstructions,
                model
            });
            commandStdout = result.stdout;
            commandStderr = result.stderr;
            const parsed = parseBridgeMessage(result.assistantText, { allowToolCalls });
            const normalizedResponse = buildResponseData({
                content: parsed.content,
                toolCalls: parsed.toolCalls,
                model
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
                    backend: BACKEND_CLINE
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

module.exports = ClineBridgeClient;
