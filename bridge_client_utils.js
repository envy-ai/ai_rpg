const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Globals = require('./Globals.js');

// Shared helper layer for the CLI bridge clients (ClineBridgeClient,
// CodexBridgeClient, KimiBridgeClient). Per-backend wording is supplied by
// callers through a display label ('Cline' | 'Codex' | 'Kimi') or explicit
// option strings so error messages, log titles, and id prefixes stay
// byte-identical to the original per-backend copies.

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

function formatMessageContent(content, {
    label = null,
    trimPartType = true,
    dataUrlImagePlaceholder = null,
    missingImageUrlPlaceholder = null
} = {}) {
    const resolvedDataUrlPlaceholder = dataUrlImagePlaceholder ?? `[image omitted: data URL content is not supported by the ${label} bridge]`;
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
                const type = trimPartType
                    ? (typeof part.type === 'string' ? part.type.trim() : '')
                    : (part.type || '');
                if (type === 'text' && typeof part.text === 'string') {
                    if (part.text.trim()) {
                        parts.push(part.text);
                        continue;
                    }
                    if (!trimPartType) {
                        continue;
                    }
                }
                if (type === 'image_url') {
                    const imageUrl = part.image_url?.url;
                    const hasUsableUrl = trimPartType
                        ? (typeof imageUrl === 'string' && Boolean(imageUrl.trim()))
                        : Boolean(imageUrl || '');
                    if (hasUsableUrl) {
                        parts.push(imageUrl.startsWith('data:')
                            ? resolvedDataUrlPlaceholder
                            : `[image_url: ${imageUrl}]`);
                        continue;
                    }
                    if (!trimPartType) {
                        parts.push(missingImageUrlPlaceholder);
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
    if (!trimPartType && (content === null || typeof content !== 'object')) {
        return String(content);
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

function renderConversation(messages = [], label) {
    if (!Array.isArray(messages) || !messages.length) {
        throw new Error(`${label} bridge requires a non-empty messages array.`);
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
        const content = formatMessageContent(message.content, { label }).trim();
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

function splitBridgeMessages(messages = [], label) {
    if (!Array.isArray(messages) || !messages.length) {
        throw new Error(`${label} bridge requires a non-empty messages array.`);
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
        throw new Error(`${label} bridge requires at least one non-system message.`);
    }

    return {
        systemMessages,
        conversationMessages
    };
}

function renderSystemInstructionBlock(messages = [], label) {
    if (!Array.isArray(messages) || !messages.length) {
        return '';
    }

    const sections = ['External application system messages (preserve order and follow them as authoritative instructions):'];
    messages.forEach((message, index) => {
        const content = formatMessageContent(message?.content, { label }).trim();
        sections.push(`System Message ${index + 1}:`);
        if (content) {
            content.split('\n').forEach(line => sections.push(`  ${line}`));
        } else {
            sections.push('  (empty)');
        }
    });
    return sections.join('\n');
}

function renderToolDefinitions(tools = [], label) {
    if (!Array.isArray(tools)) {
        throw new Error(`${label} bridge tool definitions must be an array.`);
    }
    if (!tools.length) {
        return '';
    }
    const lines = [];
    tools.forEach((tool, index) => {
        if (!tool || typeof tool !== 'object') {
            throw new Error(`${label} bridge tool definition at index ${index} must be an object.`);
        }
        if (tool.type !== 'function' || !isPlainObject(tool.function)) {
            throw new Error(`${label} bridge only supports function tools. Invalid tool at index ${index}.`);
        }
        const functionName = typeof tool.function.name === 'string' && tool.function.name.trim()
            ? tool.function.name.trim()
            : '';
        if (!functionName) {
            throw new Error(`${label} bridge tool definition at index ${index} is missing function.name.`);
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

function buildUserPrompt({ messages, developerInstructions }, label) {
    const conversationText = renderConversation(messages, label);
    const instructionText = typeof developerInstructions === 'string' && developerInstructions.trim()
        ? developerInstructions.trim()
        : '';
    return instructionText
        ? `Bridge Instructions:\n${instructionText}\n\nConversation:\n${conversationText}\n\nReturn only the JSON object required by the Bridge Instructions.`
        : `Conversation:\n${conversationText}`;
}

function extractJsonPayload(rawText, emptyMessageError) {
    const trimmed = typeof rawText === 'string' ? rawText.trim() : '';
    if (!trimmed) {
        throw new Error(emptyMessageError);
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

function normalizeToolCallArguments(rawArguments, index, label) {
    if (isPlainObject(rawArguments)) {
        return rawArguments;
    }
    if (typeof rawArguments === 'string') {
        const trimmed = rawArguments.trim();
        if (!trimmed) {
            throw new Error(`${label} bridge tool call ${index + 1} arguments cannot be empty.`);
        }
        let parsed = null;
        try {
            parsed = JSON.parse(trimmed);
        } catch (error) {
            throw new Error(`${label} bridge tool call ${index + 1} arguments are not valid JSON: ${error.message}`);
        }
        if (!isPlainObject(parsed)) {
            throw new Error(`${label} bridge tool call ${index + 1} arguments must parse to a JSON object.`);
        }
        return parsed;
    }
    throw new Error(`${label} bridge tool call ${index + 1} arguments must be a JSON object or JSON string.`);
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

function buildResponseData({ content, toolCalls, model, threadId = '', usage = null, idPrefix, defaultModel }) {
    const finishReason = Array.isArray(toolCalls) && toolCalls.length ? 'tool_calls' : 'stop';
    const response = {
        id: threadId || `${idPrefix}-${randomUUID()}`,
        object: 'chat.completion',
        created: buildNowTimestamp(),
        model: typeof model === 'string' && model.trim() ? model.trim() : defaultModel,
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

function buildBridgePreviewUpdate(previewState, rawAssistantText, {
    final = false,
    includeType = true,
    fallbackToRawText = false
} = {}) {
    const extracted = extractBridgeContentPreview(rawAssistantText);
    const nextPreviewText = extracted.text || (
        fallbackToRawText && !looksLikeJsonResponseAttempt(rawAssistantText)
            ? (typeof rawAssistantText === 'string' ? rawAssistantText : '')
            : ''
    );
    if (!final) {
        if (!nextPreviewText || nextPreviewText === previewState.previewText) {
            return null;
        }
        if (!nextPreviewText.startsWith(previewState.previewText)) {
            previewState.previewText = nextPreviewText;
            return includeType
                ? {
                    type: 'agent_message',
                    text: nextPreviewText,
                    replace: true
                }
                : {
                    text: nextPreviewText,
                    replace: true
                };
        }
        const delta = nextPreviewText.slice(previewState.previewText.length);
        previewState.previewText = nextPreviewText;
        if (!delta) {
            return null;
        }
        return includeType
            ? {
                type: 'agent_message_delta',
                text: delta,
                replace: false
            }
            : {
                text: delta,
                replace: false
            };
    }

    previewState.previewText = nextPreviewText;
    return includeType
        ? {
            type: 'agent_message',
            text: nextPreviewText,
            replace: true
        }
        : {
            text: nextPreviewText,
            replace: true
        };
}

function parseJsonLines(rawText, transform = null) {
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
            const parsedLine = JSON.parse(line);
            parsed.push(typeof transform === 'function' ? transform(parsedLine) : parsedLine);
        } catch (_) {
            // Ignore malformed JSONL records; callers decide whether absence is an error.
        }
    }
    return parsed;
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
    label,
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
                title: `${label} Stdout`,
                content: commandStdout.trim()
            });
        }
        if (typeof commandStderr === 'string' && commandStderr.trim()) {
            sections.push({
                title: `${label} Stderr`,
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
        console.warn(`Failed to log ${label} bridge prompt: ${loggingError?.message || loggingError}`);
    }
}

function resolveMaxConcurrentRequests(aiConfig) {
    const configured = Number(aiConfig?.max_concurrent_requests);
    return Number.isInteger(configured) && configured > 0 ? configured : 1;
}

function resolveBridgeIdleTimeoutMs(aiConfig) {
    const baseTimeoutSeconds = Number(aiConfig?.baseTimeoutSeconds);
    if (Number.isFinite(baseTimeoutSeconds) && baseTimeoutSeconds > 0) {
        return baseTimeoutSeconds * 1000;
    }
    return 30000;
}

module.exports = {
    isPlainObject,
    buildNowTimestamp,
    resolveBaseDir,
    resolvePathFromBase,
    ensureDirectory,
    formatMessageContent,
    renderToolCallBlock,
    renderConversation,
    splitBridgeMessages,
    renderSystemInstructionBlock,
    renderToolDefinitions,
    buildUserPrompt,
    extractJsonPayload,
    looksLikeJsonResponseAttempt,
    normalizeToolCallArguments,
    normalizeUsage,
    buildResponseData,
    extractBridgeContentPreview,
    buildBridgePreviewUpdate,
    parseJsonLines,
    getBridgeLogResponseText,
    logBridgePrompt,
    resolveMaxConcurrentRequests,
    resolveBridgeIdleTimeoutMs
};
