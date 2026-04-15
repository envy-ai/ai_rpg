const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');
const Globals = require('./Globals.js');

const BACKEND_OPENAI = 'openai_compatible';
const BACKEND_CODEX = 'codex_cli_bridge';
const CODEX_REASONING_EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const CODEX_APP_SERVER_TIMEOUT_MS = 15000;
const DEFAULT_CODEX_BRIDGE_CONFIG = Object.freeze({
    command: 'codex',
    home: './tmp/codex-bridge-home',
    session_mode: 'fresh',
    session_id: '',
    sandbox: 'read-only',
    skip_git_repo_check: true,
    reasoning_effort: '',
    profile: '',
    prompt_preamble: ''
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
            // Ignore malformed JSONL records; callers can decide if absence is an error.
        }
    }
    return parsed;
}

function normalizeUsage(rawUsage) {
    if (!rawUsage || typeof rawUsage !== 'object') {
        return null;
    }
    const inputTokens = Number(rawUsage.input_tokens);
    const cachedInputTokens = Number(rawUsage.cached_input_tokens);
    const outputTokens = Number(rawUsage.output_tokens);
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
    normalized.total_tokens = (normalized.input_tokens || 0) + (normalized.output_tokens || 0);
    return normalized;
}

function extractUsageFromStdout(rawText) {
    const events = parseJsonLines(rawText);
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (event?.type === 'turn.completed') {
            const usage = normalizeUsage(event.usage);
            if (usage) {
                return usage;
            }
        }
    }
    return null;
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
                : JSON.stringify(normalizedResponse ?? {}, null, 2),
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
            if (!aiConfig.apiKey) {
                errors.push('AI API key not specified');
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
        return resolved;
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

    static extractUsageFromStdout(rawText) {
        return extractUsageFromStdout(rawText);
    }

    static async readRateLimits({ aiConfig = Globals?.config?.ai, timeoutMs = CODEX_APP_SERVER_TIMEOUT_MS } = {}) {
        const bridgeConfig = CodexBridgeClient.resolveBridgeConfig(aiConfig);
        const homePath = CodexBridgeClient.resolveHomePath(aiConfig);
        const env = { ...process.env };
        if (homePath) {
            env.CODEX_HOME = homePath;
        }
        return await new Promise((resolve, reject) => {
            const child = spawn(bridgeConfig.command, ['app-server', '--listen', 'stdio://'], {
                cwd: Globals?.baseDir || process.cwd(),
                env,
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let settled = false;
            let stdout = '';
            let stderr = '';
            let stdoutBuffer = '';
            let timeoutHandle = null;
            const pending = new Map();

            const finishReject = (error) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeoutHandle) {
                    clearTimeout(timeoutHandle);
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
                try {
                    child.stdin.end();
                } catch (_) {
                    // Ignore stdin close failures during cleanup.
                }
                resolve(result);
            };

            const request = (id, method, params) => new Promise((resolveRequest, rejectRequest) => {
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

            if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
                timeoutHandle = setTimeout(() => {
                    finishReject(new Error(`Codex rate limit query timed out after ${timeoutMs} ms.`));
                }, timeoutMs);
            }

            child.on('error', (error) => {
                finishReject(new Error(`Failed to start Codex app-server process: ${error.message}`));
            });

            child.stdout.on('data', (chunk) => {
                const text = chunk.toString('utf8');
                stdout += text;
                stdoutBuffer += text;
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
                    const pendingRequest = pending.get(parsed.id);
                    if (!pendingRequest) {
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
            });

            (async () => {
                try {
                    await request(1, 'initialize', {
                        clientInfo: {
                            name: 'ai_rpg_codex_bridge',
                            version: '1.0.0'
                        }
                    });
                    const rateLimits = await request(2, 'account/rateLimits/read', null);
                    finishResolve(rateLimits);
                } catch (error) {
                    const details = [];
                    if (error?.message) {
                        details.push(error.message);
                    }
                    if (stderr.trim()) {
                        details.push(`stderr:\n${stderr.trim()}`);
                    }
                    finishReject(new Error(details.join('\n\n') || 'Failed to query Codex rate limits.'));
                }
            })();
        });
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

            if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
                timeoutHandle = setTimeout(() => {
                    terminateChild(`Codex bridge request timed out after ${timeoutMs} ms.`);
                }, timeoutMs);
            }

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
                        const parsed = JSON.parse(line);
                        if (parsed?.type === 'thread.started' && typeof parsed.thread_id === 'string' && parsed.thread_id.trim()) {
                            threadId = parsed.thread_id.trim();
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
                        const parsed = JSON.parse(trailingStdoutLine);
                        if (parsed?.type === 'thread.started' && typeof parsed.thread_id === 'string' && parsed.thread_id.trim()) {
                            threadId = parsed.thread_id.trim();
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

        const { schemaPath, outputPath, homePath } = CodexBridgeClient.ensureRuntimeFiles({
            allowToolCalls,
            aiConfig
        });
        const args = CodexBridgeClient.buildCommandArgs({
            bridgeConfig,
            outputPath,
            schemaPath,
            allowToolCalls,
            developerInstructions,
            model
        });

        const env = { ...process.env };
        if (homePath) {
            env.CODEX_HOME = homePath;
        }
        const requestPayload = {
            backend: BACKEND_CODEX,
            command: bridgeConfig.command,
            args,
            developerInstructions,
            conversationMessages,
            messages,
            tools: allowedTools
        };
        let commandStdout = '';
        let commandStderr = '';

        try {
            const { threadId, stdout, stderr } = await CodexBridgeClient.runCodexCommand({
                command: bridgeConfig.command,
                args,
                promptText,
                timeoutMs,
                cwd: Globals?.baseDir || process.cwd(),
                env,
                signal,
                onStdoutChunk,
                onStdoutEvent
            });
            commandStdout = stdout;
            commandStderr = stderr;
            const usage = CodexBridgeClient.extractUsageFromStdout(stdout);

            const rawOutput = readIfExists(outputPath).trim();
            if (!rawOutput) {
                throw new Error('Codex bridge did not write a final message file.');
            }
            const parsed = parseBridgeMessage(rawOutput, { allowToolCalls });
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
        } finally {
            cleanupFile(outputPath);
        }
    }
}

module.exports = CodexBridgeClient;
