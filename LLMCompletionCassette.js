const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CASSETTE_VERSION = 2;
const REQUEST_FINGERPRINT_VERSION = 1;
const ROUTING_SECRET_KEYS = new Set([
    'apikey',
    'authorization',
    'clientsecret',
    'connection',
    'cookie',
    'headers',
    'oauthrefreshtoken',
    'password',
    'refreshtoken',
    'accesstoken'
]);
const VOLATILE_TOOL_RESULT_KEYS = new Set([
    'cachebuster',
    'clientid',
    'createdat',
    'lastupdated',
    'requestid'
]);

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function sha256Text(value) {
    return `sha256:${crypto.createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function normalizeForCanonicalJson(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        if (typeof value === 'string' && /^data:[^,]*,/i.test(value)) {
            return `[data-url ${sha256Text(value)}]`;
        }
        return value;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error('Completion cassette fingerprints do not allow non-finite numbers.');
        }
        return value;
    }
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (typeof value === 'function' || typeof value === 'symbol') {
        throw new Error(`Completion cassette fingerprints do not allow ${typeof value} values.`);
    }
    if (seen.has(value)) {
        throw new Error('Completion cassette fingerprints do not allow circular values.');
    }
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map(entry => {
                const normalized = normalizeForCanonicalJson(entry, seen);
                return normalized === undefined ? null : normalized;
            });
        }
        if (value instanceof RegExp) {
            return value.toString();
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (!isPlainObject(value)) {
            throw new Error(
                `Completion cassette fingerprints require JSON-compatible objects; received ${value.constructor?.name || 'object'}.`
            );
        }
        const normalized = {};
        for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
            const entry = normalizeForCanonicalJson(value[key], seen);
            if (entry !== undefined) {
                normalized[key] = entry;
            }
        }
        return normalized;
    } finally {
        seen.delete(value);
    }
}

function canonicalJson(value) {
    return JSON.stringify(normalizeForCanonicalJson(value));
}

function sanitizeRoutingConfig(value) {
    if (Array.isArray(value)) {
        return value.map(entry => sanitizeRoutingConfig(entry));
    }
    if (!isPlainObject(value)) {
        return value;
    }
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (ROUTING_SECRET_KEYS.has(normalizedKey)) {
            continue;
        }
        sanitized[key] = sanitizeRoutingConfig(entry);
    }
    return sanitized;
}

function sanitizeStructuredToolResult(value) {
    if (Array.isArray(value)) {
        return value.map(entry => sanitizeStructuredToolResult(entry));
    }
    if (!isPlainObject(value)) {
        return value;
    }
    const sanitized = {};
    for (const [key, entry] of Object.entries(value)) {
        const normalizedKey = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (VOLATILE_TOOL_RESULT_KEYS.has(normalizedKey)) {
            continue;
        }
        sanitized[key] = sanitizeStructuredToolResult(entry);
    }
    return sanitized;
}

function normalizeMessagesForFingerprint(messages) {
    return messages.map(message => {
        const cloned = cloneJsonValue(message, 'Completion cassette message');
        if (cloned?.role !== 'tool' || typeof cloned.content !== 'string') {
            return cloned;
        }
        let parsed;
        try {
            parsed = JSON.parse(cloned.content);
        } catch (_) {
            return cloned;
        }
        if (!Array.isArray(parsed) && !isPlainObject(parsed)) {
            return cloned;
        }
        cloned.content = canonicalJson(sanitizeStructuredToolResult(parsed));
        return cloned;
    });
}

function normalizeMetadataLabel(value) {
    if (typeof value !== 'string') {
        return 'unknown';
    }
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || 'unknown';
}

function requireNonEmptyText(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value.trim();
}

function resolveFilePath(sourcePath, baseDir) {
    const source = requireNonEmptyText(sourcePath, 'Completion cassette path');
    const root = typeof baseDir === 'string' && baseDir.trim()
        ? path.resolve(baseDir)
        : process.cwd();
    return path.isAbsolute(source) ? path.normalize(source) : path.join(root, source);
}

function cloneJsonValue(value, label) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        throw new Error(`${label} must be JSON-compatible: ${error.message}`);
    }
}

function writeJsonAtomic(filename, value) {
    const directory = path.dirname(filename);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = path.join(
        directory,
        `.${path.basename(filename)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    const body = `${JSON.stringify(value, null, 2)}\n`;
    try {
        fs.writeFileSync(tempPath, body, 'utf8');
        fs.renameSync(tempPath, filename);
    } catch (error) {
        try {
            if (fs.existsSync(tempPath)) {
                fs.rmSync(tempPath, { force: true });
            }
        } catch (_) {
            // Preserve the original write/rename error.
        }
        throw error;
    }
}

function collectToolNames(additionalPayload) {
    const names = [];
    const tools = Array.isArray(additionalPayload?.tools) ? additionalPayload.tools : [];
    for (const tool of tools) {
        const name = typeof tool?.function?.name === 'string'
            ? tool.function.name.trim()
            : '';
        if (name) {
            names.push(name);
        }
    }
    const functions = Array.isArray(additionalPayload?.functions) ? additionalPayload.functions : [];
    for (const functionDefinition of functions) {
        const name = typeof functionDefinition?.name === 'string'
            ? functionDefinition.name.trim()
            : '';
        if (name) {
            names.push(name);
        }
    }
    return names;
}

function recordReplayFailure(fixture, error) {
    if (!fixture || typeof fixture !== 'object') {
        return;
    }
    if (!Array.isArray(fixture.failures)) {
        fixture.failures = [];
    }
    const failure = {
        code: typeof error?.code === 'string' && error.code.trim()
            ? error.code.trim()
            : 'LLM_COMPLETION_CASSETTE_REPLAY_FAILURE',
        message: error?.message || String(error),
        ordinal: Number.isInteger(error?.expected?.ordinal)
            ? error.expected.ordinal
            : fixture.consumed + 1
    };
    if (isPlainObject(error?.expected)) {
        failure.expected = cloneJsonValue(error.expected, 'Completion cassette replay failure expected data');
    }
    if (isPlainObject(error?.actual)) {
        failure.actual = cloneJsonValue(error.actual, 'Completion cassette replay failure actual data');
    }
    fixture.failures.push(failure);
}

class LLMCompletionCassette {
    static #recordingStates = new Map();

    static get version() {
        return CASSETTE_VERSION;
    }

    static isVersion2Document(value) {
        return Boolean(value)
            && typeof value === 'object'
            && !Array.isArray(value)
            && Number(value.version) === CASSETTE_VERSION;
    }

    static createRequestDescriptor({
        metadataLabel,
        messages,
        additionalPayload = {},
        requestedModel = null,
        configuredModel = null,
        configuredBackend = null,
        modelRoutingFingerprint = null,
        prefill = null,
        assistantResponseSeed = null,
        systemPromptAppend = null,
        maxTokens = null,
        temperature = null,
        topP = null,
        frequencyPenalty = null,
        presencePenalty = null,
        multimodal = false,
        validateXML = true,
        validateXMLStrict = false,
        expectedXmlRootTag = null,
        requiredTags = [],
        requiredRegex = null
    } = {}) {
        if (!Array.isArray(messages) || !messages.length) {
            throw new Error('Completion cassette request descriptors require at least one message.');
        }
        if (!isPlainObject(additionalPayload)) {
            throw new Error('Completion cassette request descriptors require an object additionalPayload.');
        }
        const descriptor = {
            fingerprintVersion: REQUEST_FINGERPRINT_VERSION,
            metadataLabel: normalizeMetadataLabel(metadataLabel),
            messages: normalizeMessagesForFingerprint(messages),
            additionalPayload: cloneJsonValue(additionalPayload, 'Completion cassette additionalPayload'),
            routing: {
                requestedModel: typeof requestedModel === 'string' && requestedModel.trim()
                    ? requestedModel.trim()
                    : null,
                configuredModel: typeof configuredModel === 'string' && configuredModel.trim()
                    ? configuredModel.trim()
                    : null,
                configuredBackend: typeof configuredBackend === 'string' && configuredBackend.trim()
                    ? configuredBackend.trim()
                    : null,
                modelRoutingFingerprint: typeof modelRoutingFingerprint === 'string' && modelRoutingFingerprint.trim()
                    ? modelRoutingFingerprint.trim()
                    : null
            },
            promptControls: {
                prefill: typeof prefill === 'string' ? prefill : null,
                assistantResponseSeed: typeof assistantResponseSeed === 'string' ? assistantResponseSeed : null,
                systemPromptAppend: typeof systemPromptAppend === 'string' ? systemPromptAppend : null,
                maxTokens: Number.isFinite(maxTokens) ? maxTokens : null,
                temperature: Number.isFinite(temperature) ? temperature : null,
                topP: Number.isFinite(topP) ? topP : null,
                frequencyPenalty: Number.isFinite(frequencyPenalty) ? frequencyPenalty : null,
                presencePenalty: Number.isFinite(presencePenalty) ? presencePenalty : null,
                multimodal: multimodal === true
            },
            validation: {
                validateXML: validateXML !== false,
                validateXMLStrict: validateXMLStrict === true,
                requiredTags: Array.isArray(requiredTags) ? requiredTags.map(String) : [],
                requiredRegex: requiredRegex instanceof RegExp
                    ? requiredRegex.toString()
                    : (requiredRegex === null || requiredRegex === undefined ? null : String(requiredRegex))
            }
        };
        if (typeof expectedXmlRootTag === 'string' && expectedXmlRootTag.trim()) {
            descriptor.validation.expectedXmlRootTag = expectedXmlRootTag.trim();
        }
        return Object.freeze(descriptor);
    }

    static fingerprintValue(value) {
        return sha256Text(canonicalJson(value));
    }

    static sanitizeRoutingConfigForFingerprint(value) {
        return sanitizeRoutingConfig(value);
    }

    static fingerprintRequest(descriptor) {
        if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
            throw new Error('Completion cassette request fingerprinting requires a descriptor object.');
        }
        return LLMCompletionCassette.fingerprintValue(descriptor);
    }

    static summarizeRequest(descriptor) {
        const messages = Array.isArray(descriptor?.messages) ? descriptor.messages : [];
        return {
            messageRoles: messages.map(message => (
                typeof message?.role === 'string' && message.role.trim()
                    ? message.role.trim()
                    : 'unknown'
            )),
            messageCharacters: messages.reduce((total, message) => {
                const content = typeof message?.content === 'string'
                    ? message.content
                    : JSON.stringify(message?.content ?? '');
                return total + content.length;
            }, 0),
            toolNames: collectToolNames(descriptor?.additionalPayload),
            model: descriptor?.routing?.requestedModel || descriptor?.routing?.configuredModel || null,
            backend: descriptor?.routing?.configuredBackend || null
        };
    }

    static parseReplayDocument(parsed, { sourcePath, resolvedPath } = {}) {
        if (!LLMCompletionCassette.isVersion2Document(parsed)) {
            throw new Error('Completion cassette replay document must use version 2.');
        }
        const resolved = requireNonEmptyText(resolvedPath, 'Resolved completion cassette path');
        if (parsed.strict !== true) {
            throw new Error(`Version 2 completion cassette must set strict=true: ${resolved}`);
        }
        if (parsed.complete !== true) {
            throw new Error(`Version 2 completion cassette is incomplete and cannot be replayed: ${resolved}`);
        }
        if (!Array.isArray(parsed.entries) || !parsed.entries.length) {
            throw new Error(`Version 2 completion cassette must contain at least one entry: ${resolved}`);
        }
        const entries = parsed.entries.map((rawEntry, index) => {
            if (!isPlainObject(rawEntry)) {
                throw new Error(`Completion cassette entry ${index + 1} must be an object: ${resolved}`);
            }
            const ordinal = Number(rawEntry.ordinal);
            if (!Number.isInteger(ordinal) || ordinal !== index + 1) {
                throw new Error(
                    `Completion cassette entry ${index + 1} must have ordinal ${index + 1}: ${resolved}`
                );
            }
            const metadataLabel = normalizeMetadataLabel(rawEntry.metadataLabel);
            const requestFingerprint = requireNonEmptyText(
                rawEntry.requestFingerprint,
                `Completion cassette entry ${ordinal} requestFingerprint`
            );
            if (!/^sha256:[a-f0-9]{64}$/i.test(requestFingerprint)) {
                throw new Error(`Completion cassette entry ${ordinal} has an invalid SHA-256 fingerprint.`);
            }
            const response = rawEntry.response;
            if (!isPlainObject(response)) {
                throw new Error(`Completion cassette entry ${ordinal} response must be a normalized response object.`);
            }
            return {
                ordinal,
                metadataLabel,
                requestFingerprint,
                requestSummary: isPlainObject(rawEntry.requestSummary)
                    ? cloneJsonValue(rawEntry.requestSummary, `Completion cassette entry ${ordinal} requestSummary`)
                    : {},
                response: cloneJsonValue(response, `Completion cassette entry ${ordinal} response`)
            };
        });
        return {
            version: CASSETTE_VERSION,
            sourcePath: typeof sourcePath === 'string' ? sourcePath : resolved,
            resolvedPath: resolved,
            strict: true,
            complete: true,
            description: typeof parsed.description === 'string' ? parsed.description : '',
            entries,
            consumed: 0,
            active: false,
            failures: []
        };
    }

    static beginReplay(fixture, descriptor) {
        if (!fixture || fixture.version !== CASSETTE_VERSION || !Array.isArray(fixture.entries)) {
            throw new Error('beginReplay requires a loaded version 2 completion cassette.');
        }
        if (fixture.active) {
            const error = new Error(
                `Version 2 completion cassette does not allow concurrent logical completions: ${fixture.resolvedPath}`
            );
            error.code = 'LLM_COMPLETION_CASSETTE_CONCURRENCY';
            recordReplayFailure(fixture, error);
            throw error;
        }
        const entry = fixture.entries[fixture.consumed];
        if (!entry) {
            const error = new Error(
                `Completion cassette is exhausted at ordinal ${fixture.consumed + 1} `
                + `(total=${fixture.entries.length}): ${fixture.resolvedPath}`
            );
            error.code = 'LLM_COMPLETION_CASSETTE_EXHAUSTED';
            recordReplayFailure(fixture, error);
            throw error;
        }
        const actualLabel = normalizeMetadataLabel(descriptor?.metadataLabel);
        const actualFingerprint = LLMCompletionCassette.fingerprintRequest(descriptor);
        if (entry.metadataLabel !== actualLabel || entry.requestFingerprint !== actualFingerprint) {
            const error = new Error(
                `Completion cassette mismatch at ordinal ${entry.ordinal}: `
                + `expected label=${JSON.stringify(entry.metadataLabel)} fingerprint=${entry.requestFingerprint}; `
                + `received label=${JSON.stringify(actualLabel)} fingerprint=${actualFingerprint}.`
            );
            error.code = 'LLM_COMPLETION_CASSETTE_MISMATCH';
            error.expected = {
                ordinal: entry.ordinal,
                metadataLabel: entry.metadataLabel,
                requestFingerprint: entry.requestFingerprint,
                requestSummary: entry.requestSummary
            };
            error.actual = {
                metadataLabel: actualLabel,
                requestFingerprint: actualFingerprint,
                requestSummary: LLMCompletionCassette.summarizeRequest(descriptor)
            };
            recordReplayFailure(fixture, error);
            throw error;
        }
        fixture.active = true;
        fixture.consumed += 1;
        return {
            fixture,
            ordinal: entry.ordinal,
            response: cloneJsonValue(entry.response, `Completion cassette entry ${entry.ordinal} response`),
            released: false
        };
    }

    static endReplay(lease) {
        if (!lease || lease.released) {
            return;
        }
        lease.released = true;
        if (lease.fixture) {
            lease.fixture.active = false;
        }
    }

    static getReplayStatus(fixture) {
        if (!fixture || fixture.version !== CASSETTE_VERSION || !Array.isArray(fixture.entries)) {
            return { active: false, version: null };
        }
        const total = fixture.entries.length;
        const consumed = fixture.consumed;
        const failures = Array.isArray(fixture.failures) ? fixture.failures : [];
        return {
            active: true,
            version: CASSETTE_VERSION,
            sourcePath: fixture.sourcePath,
            resolvedPath: fixture.resolvedPath,
            strict: fixture.strict === true,
            complete: fixture.complete === true,
            total,
            consumed,
            remaining: total - consumed,
            allConsumed: consumed === total,
            completionActive: fixture.active === true,
            failureCount: failures.length,
            failed: failures.length > 0,
            lastFailure: failures.length
                ? cloneJsonValue(failures[failures.length - 1], 'Completion cassette replay failure status')
                : null
        };
    }

    static resolveRecordingSource(config = null) {
        const envPath = typeof process.env.LLM_RECORD_OUTPUTS_FILE === 'string'
            ? process.env.LLM_RECORD_OUTPUTS_FILE.trim()
            : '';
        if (envPath) {
            return envPath;
        }
        const configPath = typeof config?.ai?.record_outputs_file === 'string'
            ? config.ai.record_outputs_file.trim()
            : '';
        return configPath || '';
    }

    static beginRecording({ sourcePath, baseDir, description = '' } = {}) {
        const resolvedPath = resolveFilePath(sourcePath, baseDir);
        let state = LLMCompletionCassette.#recordingStates.get(resolvedPath);
        if (!state) {
            let reusableEmptyDocument = false;
            if (fs.existsSync(resolvedPath)) {
                let existingData;
                try {
                    existingData = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
                } catch (error) {
                    throw new Error(
                        `Completion cassette recording destination already exists and is invalid JSON (${resolvedPath}): ${error.message}`
                    );
                }
                reusableEmptyDocument = LLMCompletionCassette.isVersion2Document(existingData)
                    && existingData.strict === true
                    && existingData.complete === false
                    && Array.isArray(existingData.entries)
                    && existingData.entries.length === 0;
                if (!reusableEmptyDocument) {
                    throw new Error(
                        `Completion cassette recording destination already exists; use a new attempt path: ${resolvedPath}`
                    );
                }
            }
            state = {
                sourcePath,
                resolvedPath,
                data: {
                    version: CASSETTE_VERSION,
                    strict: true,
                    complete: false,
                    description: typeof description === 'string' ? description : '',
                    recordedAt: new Date().toISOString(),
                    entries: []
                },
                active: false
            };
            writeJsonAtomic(resolvedPath, state.data);
            LLMCompletionCassette.#recordingStates.set(resolvedPath, state);
        }
        if (state.data.complete) {
            throw new Error(`Completion cassette recording is already complete: ${resolvedPath}`);
        }
        if (state.active) {
            throw new Error(
                `Completion cassette recording does not allow concurrent logical completions: ${resolvedPath}`
            );
        }
        state.active = true;
        return { state, released: false, recorded: false };
    }

    static recordCompletion(lease, { descriptor, response } = {}) {
        if (!lease || lease.released || !lease.state?.active) {
            throw new Error('Completion cassette recording lease is not active.');
        }
        if (lease.recorded) {
            throw new Error('Completion cassette recording lease already recorded a response.');
        }
        const normalizedResponse = cloneJsonValue(response, 'Completion cassette response');
        if (!isPlainObject(normalizedResponse)) {
            throw new Error('Completion cassette recorded responses must use the normalized response object shape.');
        }
        const ordinal = lease.state.data.entries.length + 1;
        lease.state.data.entries.push({
            ordinal,
            metadataLabel: normalizeMetadataLabel(descriptor?.metadataLabel),
            requestFingerprint: LLMCompletionCassette.fingerprintRequest(descriptor),
            requestSummary: LLMCompletionCassette.summarizeRequest(descriptor),
            response: normalizedResponse
        });
        writeJsonAtomic(lease.state.resolvedPath, lease.state.data);
        lease.recorded = true;
        return ordinal;
    }

    static endRecording(lease) {
        if (!lease || lease.released) {
            return;
        }
        lease.released = true;
        if (lease.state) {
            lease.state.active = false;
        }
    }

    static completeRecording({ sourcePath, baseDir, description = undefined } = {}) {
        const resolvedPath = resolveFilePath(sourcePath, baseDir);
        const state = LLMCompletionCassette.#recordingStates.get(resolvedPath);
        if (state?.active) {
            throw new Error(`Cannot complete a cassette while a logical completion is active: ${resolvedPath}`);
        }
        let data = state?.data || null;
        if (!data) {
            if (!fs.existsSync(resolvedPath)) {
                throw new Error(`Completion cassette recording file not found: ${resolvedPath}`);
            }
            try {
                data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
            } catch (error) {
                throw new Error(`Completion cassette recording JSON is invalid (${resolvedPath}): ${error.message}`);
            }
        }
        if (!LLMCompletionCassette.isVersion2Document(data)) {
            throw new Error(`Completion cassette recording must use version 2: ${resolvedPath}`);
        }
        if (!Array.isArray(data.entries) || !data.entries.length) {
            throw new Error(`Cannot complete an empty completion cassette recording: ${resolvedPath}`);
        }
        if (typeof description === 'string') {
            data.description = description;
        }
        data.complete = true;
        data.completedAt = new Date().toISOString();
        writeJsonAtomic(resolvedPath, data);
        if (state) {
            state.data = data;
        }
        return {
            active: true,
            version: CASSETTE_VERSION,
            sourcePath,
            resolvedPath,
            complete: true,
            total: data.entries.length
        };
    }

    static resetIncompleteRecording({ sourcePath, baseDir, description = undefined } = {}) {
        const resolvedPath = resolveFilePath(sourcePath, baseDir);
        const state = LLMCompletionCassette.#recordingStates.get(resolvedPath);
        if (state?.active) {
            throw new Error(`Cannot reset a cassette while a logical completion is active: ${resolvedPath}`);
        }

        let previousData = state?.data || null;
        if (!previousData && fs.existsSync(resolvedPath)) {
            try {
                previousData = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
            } catch (error) {
                throw new Error(`Completion cassette recording JSON is invalid (${resolvedPath}): ${error.message}`);
            }
        }
        if (previousData && !LLMCompletionCassette.isVersion2Document(previousData)) {
            throw new Error(`Completion cassette recording must use version 2: ${resolvedPath}`);
        }
        if (previousData?.complete === true) {
            throw new Error(`Cannot reset a completed completion cassette recording: ${resolvedPath}`);
        }

        const discardedTotal = Array.isArray(previousData?.entries)
            ? previousData.entries.length
            : 0;
        const data = {
            version: CASSETTE_VERSION,
            strict: true,
            complete: false,
            description: typeof description === 'string'
                ? description
                : (typeof previousData?.description === 'string' ? previousData.description : ''),
            recordedAt: new Date().toISOString(),
            entries: []
        };
        writeJsonAtomic(resolvedPath, data);
        LLMCompletionCassette.#recordingStates.set(resolvedPath, {
            sourcePath,
            resolvedPath,
            data,
            active: false
        });
        return {
            active: true,
            version: CASSETTE_VERSION,
            sourcePath,
            resolvedPath,
            complete: false,
            total: 0,
            discardedTotal
        };
    }

    static getRecordingStatus({ sourcePath, baseDir } = {}) {
        if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
            return { active: false, version: null };
        }
        const resolvedPath = resolveFilePath(sourcePath, baseDir);
        const state = LLMCompletionCassette.#recordingStates.get(resolvedPath);
        if (state) {
            return {
                active: true,
                version: CASSETTE_VERSION,
                sourcePath: state.sourcePath,
                resolvedPath,
                complete: state.data.complete === true,
                total: state.data.entries.length,
                completionActive: state.active === true
            };
        }
        if (!fs.existsSync(resolvedPath)) {
            return {
                active: true,
                version: CASSETTE_VERSION,
                sourcePath,
                resolvedPath,
                complete: false,
                total: 0,
                completionActive: false
            };
        }
        let parsed;
        try {
            parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        } catch (error) {
            return {
                active: true,
                version: null,
                sourcePath,
                resolvedPath,
                complete: false,
                error: error.message
            };
        }
        return {
            active: true,
            version: Number(parsed?.version) || null,
            sourcePath,
            resolvedPath,
            complete: parsed?.complete === true,
            total: Array.isArray(parsed?.entries) ? parsed.entries.length : 0,
            completionActive: false
        };
    }

    static resetRuntimeState() {
        LLMCompletionCassette.#recordingStates = new Map();
    }
}

module.exports = LLMCompletionCassette;
