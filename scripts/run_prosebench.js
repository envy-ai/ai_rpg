#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const yaml = require('js-yaml');
const Globals = require('../Globals.js');
const LLMClient = require('../LLMClient.js');

const ROOT = path.resolve(__dirname, '..');
const CRITIC_PREFIX = 'For the duration of this session, do not engage your writing/roleplaying experts. Instead, engage your writing critic experts.';
const AUTHOR_PREFIX = 'You are "award-winning" fanfiction author XxDankBongwater69xX. Although your grammar, spelling, and punctuation are correct, your writing seems bad on the surface. However, due to a strong understanding of people and humor, it works well despite itself.';
const VARIANTS = [{ id: 'baseline', prefix: '' }, { id: 'critic', prefix: CRITIC_PREFIX }, { id: 'author', prefix: AUTHOR_PREFIX }];
const USAGE = 'Usage: node scripts/run_prosebench.js --prepare-only [--config FILE] [--system-log FILE] [--generation FILE] [--output DIR] [--repeat N] [--variants JSON]\n       node scripts/run_prosebench.js --run DIR';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const relative = (directory, file) => path.relative(directory, file);
function writeJson(file, value) {
    const temporary = `${file}.writing`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
}
function readNonempty(file, label) {
    const bytes = fs.readFileSync(file);
    if (!bytes.toString('utf8').trim()) throw new Error(`${label} is empty: ${file}`);
    return bytes;
}
function parseArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (key === '--prepare-only') {
            if (options.prepareOnly) throw new Error('Duplicate --prepare-only.');
            options.prepareOnly = true;
        } else if (['--config', '--system-log', '--generation', '--output', '--repeat', '--variants', '--run'].includes(key)) {
            if (Object.hasOwn(options, key)) throw new Error(`Duplicate ${key}.`);
            const value = argv[++i];
            if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}. ${USAGE}`);
            options[key] = value;
        } else throw new Error(`Unknown argument ${key}. ${USAGE}`);
    }
    if (options['--run']) {
        if (options.prepareOnly || Object.keys(options).length !== 1) throw new Error('--run accepts only a prepared directory; its inputs/configuration cannot change.');
        return { runDirectory: path.resolve(options['--run']) };
    }
    if (!options.prepareOnly) throw new Error(USAGE);
    const repeat = options['--repeat'] === undefined ? 10 : Number(options['--repeat']);
    if (!Number.isSafeInteger(repeat) || repeat <= 0) throw new Error('--repeat must be a positive integer.');
    return {
        prepareOnly: true, repeat,
        variantsPath: options['--variants'] ? path.resolve(options['--variants']) : null,
        configPath: path.resolve(options['--config'] || path.join(ROOT, 'config.yaml.strata-davidau')),
        systemLogPath: path.resolve(options['--system-log'] || path.join(ROOT, 'logs/logs_prev/2026-11-12T19-26-23-978Z_event_checks_xml_event_checks.log')),
        generationPath: path.resolve(options['--generation'] || path.join(os.homedir(), 'prose_bench_scenario.txt')),
        runDirectory: path.resolve(options['--output'] || path.join(ROOT, 'prosebench', new Date().toISOString().replace(/[:.]/g, '-')))
    };
}
function extractSystemPrompt(log) {
    const start = '=== SYSTEM PROMPT ===\n';
    const stop = '\n=== GENERATION PROMPT ===';
    const index = log.indexOf(start);
    const end = log.indexOf(stop, index + start.length);
    if (index < 0 || end < 0 || log.indexOf(start, index + start.length) !== -1) throw new Error('Source log must contain exactly one SYSTEM PROMPT section followed by GENERATION PROMPT.');
    const system = log.slice(index + start.length, end).replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (!system.trim()) throw new Error('Source log SYSTEM PROMPT section is empty.');
    return system;
}
function loadConfiguration(file) {
    const bytes = readNonempty(file, 'Configuration');
    const value = yaml.load(bytes.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value.ai || typeof value.ai !== 'object' || Array.isArray(value.ai)) throw new Error('Benchmark configuration must contain an ai mapping.');
    if (LLMClient.resolveBackend(value.ai) !== 'openai_compatible') throw new Error('This prose benchmark requires an openai_compatible text endpoint.');
    return { bytes, value };
}
function makeBenchmarkConfig(source) {
    if (source.ai.custom_args !== undefined && source.ai.custom_args !== null && (typeof source.ai.custom_args !== 'object' || Array.isArray(source.ai.custom_args))) throw new TypeError('ai.custom_args must be an object or null.');
    // Copy text transport/generation settings only; unrelated image credentials,
    // game settings and prompt renderers never enter this isolated process.
    const fields = ['backend', 'endpoint', 'model', 'apiKey', 'headers', 'custom_args', 'temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty', 'maxTokens', 'stream', 'timeout', 'stream_start_timeout', 'stream_continue_timeout', 'increment_start_timeout', 'increment_continue_timeout', 'waitAfterError', 'waitAfterRateLimitError', 'waitAfterNetworkError', 'reasoning', 'reasoning_effort', 'thinking', 'lowTemperature', 'highTemperature'];
    const ai = {};
    for (const key of fields) if (Object.hasOwn(source.ai, key)) ai[key] = structuredClone(source.ai[key]);
    ai.custom_args = { ...(ai.custom_args || {}) };
    for (const key of ['messages', 'tools', 'functions', 'tool_choice', 'function_call', 'parallel_tool_calls', 'seed', 'strata_prefix']) delete ai.custom_args[key];
    // This known-compatible benchmark targets Strata/llama; retain genuine
    // prefill liveness without installing model-management/startup handlers.
    ai.custom_args.return_progress = true;
    Object.assign(ai, { max_concurrent_requests: 1, retryAttempts: 0, cachebuster: false, prefill: null, sysprompt_append: '', xml_closing_tag_guard: false, live_deslop: false, strata_runtime: null, image_generation_handoff: null, shared_prefix_cache: null, local_startup_script_path: '', terminate_during_image_generation: false, unload_during_image_generation: false, supress_seed: true });
    return { ai, ai_model_overrides: {}, ai_multimodal: { enabled: false }, max_concurrent_requests_all_models: 1, unload_model_on_switch: false, router_preload_model: '', systemPromptPrefix: '', system_prompt_prefix_by_prompt: [], prompt_progress: { character_targets: { 'prosebench_*': 5000 } } };
}
function redactConfig(config) {
    const result = structuredClone(config);
    if (result.ai.apiKey && result.ai.apiKey !== 'none') result.ai.apiKey = '[REDACTED: read original config at run time]';
    if (result.ai.headers) for (const key of Object.keys(result.ai.headers)) {
        if (!['user-agent', 'connection', 'content-type', 'accept'].includes(key.toLowerCase())) result.ai.headers[key] = '[REDACTED]';
    }
    return result;
}
function readVariants(file) {
    const bytes = file ? readNonempty(file, 'Variant definitions') : Buffer.from(`${JSON.stringify(VARIANTS, null, 2)}\n`);
    const definitions = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(definitions) || !definitions.length) throw new Error('variants must be a nonempty array of {id, prefix} objects.');
    const ids = new Set();
    for (const [index, variant] of definitions.entries()) {
        const field = `variants[${index}]`;
        if (!variant || typeof variant !== 'object' || Array.isArray(variant)) throw new TypeError(`${field} must be an object containing id and prefix.`);
        for (const key of Object.keys(variant)) if (!['id', 'prefix'].includes(key)) throw new Error(`${field}.${key} is unsupported; use only id and prefix.`);
        if (typeof variant.id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(variant.id)) throw new Error(`${field}.id must start with a lowercase letter and contain only lowercase letters, digits, underscores or hyphens.`);
        if (ids.has(variant.id)) throw new Error(`${field}.id duplicates ${variant.id}; give each variant a unique ID.`);
        if (typeof variant.prefix !== 'string') throw new TypeError(`${field}.prefix must be a string; use an empty string for an unprefixed baseline.`);
        ids.add(variant.id);
    }
    return { bytes, definitions };
}
function prepareRun(options) {
    const { bytes: configBytes, value: source } = loadConfiguration(options.configPath);
    const { bytes: variantsBytes, definitions: variantDefinitions } = readVariants(options.variantsPath);
    const runnerSource = fs.readFileSync(__filename);
    const sourceLog = readNonempty(options.systemLogPath, 'System prompt source log');
    const generation = readNonempty(options.generationPath, 'Generation prompt');
    const system = extractSystemPrompt(sourceLog.toString('utf8'));
    const benchmarkConfig = makeBenchmarkConfig(source);
    const configSnapshot = redactConfig(benchmarkConfig);
    const directory = options.runDirectory;
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.mkdirSync(directory, { mode: 0o700 });
    for (const child of ['originals', 'systems', 'responses', 'logs']) fs.mkdirSync(path.join(directory, child), { mode: 0o700 });
    fs.writeFileSync(path.join(directory, 'originals', 'generation.txt'), generation);
    fs.writeFileSync(path.join(directory, 'originals', 'system-source.log'), sourceLog);
    fs.writeFileSync(path.join(directory, 'originals', 'system.txt'), system);
    fs.writeFileSync(path.join(directory, 'originals', 'variants.json'), variantsBytes);
    fs.writeFileSync(path.join(directory, 'originals', 'run_prosebench.executed.js'), runnerSource);
    fs.writeFileSync(path.join(directory, 'originals', 'run_prosebench.executed.sha256'), `${hash(runnerSource)}  run_prosebench.executed.js\n`);
    writeJson(path.join(directory, 'config.runtime.redacted.json'), configSnapshot);
    const variants = variantDefinitions.map(variant => {
        const content = variant.prefix ? `${variant.prefix}\n\n${system}` : system;
        const file = `systems/${variant.id}.txt`;
        fs.writeFileSync(path.join(directory, file), content);
        return { ...variant, file, sha256: hash(content), bytes: Buffer.byteLength(content), targetAccepted: options.repeat, maxAttempts: options.repeat * 3 };
    });
    const manifest = {
        version: 1, createdAt: new Date().toISOString(), repeat: options.repeat,
        order: variants.map(variant => variant.id), oneInflight: true, runnerSha256: hash(runnerSource), runnerSource: 'originals/run_prosebench.executed.js',
        sources: { variants: { path: options.variantsPath || null, sha256: hash(variantsBytes), saved: 'originals/variants.json' }, config: { path: options.configPath, sha256: hash(configBytes) }, systemLog: { path: options.systemLogPath, sha256: hash(sourceLog), saved: 'originals/system-source.log' }, generation: { path: options.generationPath, sha256: hash(generation), bytes: generation.length, saved: 'originals/generation.txt' }, system: { sha256: hash(system), bytes: Buffer.byteLength(system), saved: 'originals/system.txt' } },
        configuration: { snapshot: 'config.runtime.redacted.json', sha256: hash(JSON.stringify(configSnapshot)), seedPolicy: 'seed omitted: independent provider sampling; no fixed repeated seed', automaticRetries: 0, neutralized: ['automatic system prefixes', 'sysprompt_append', 'assistant prefill', 'model overrides', 'tools', 'cachebuster', 'live deslop/XML corrections', 'forced outputs/cassettes', 'model lifecycle/startup/handoff'], preserved: ['endpoint/model', 'temperature/top_p/custom sampling arguments', 'configured maxTokens', 'stream and native transport timeouts'] },
        variants
    };
    writeJson(path.join(directory, 'manifest.json'), manifest);
    writeJson(path.join(directory, 'results.json'), { version: 1, updatedAt: manifest.createdAt, completedCounts: Object.fromEntries(variants.map(variant => [variant.id, 0])), attemptedCounts: Object.fromEntries(variants.map(variant => [variant.id, 0])), rejectedCounts: Object.fromEntries(variants.map(variant => [variant.id, 0])), variants: variants.map(variant => ({ id: variant.id, status: 'pending', attempts: [] })) });
    refreshIndex(directory, manifest, readJson(path.join(directory, 'results.json')));
    return directory;
}
function extractFinalProse(raw) {
    const openings = [...raw.matchAll(/<finalProse(?:\s[^>]*)?>/gi)];
    const closings = [...raw.matchAll(/<\/finalProse\s*>/gi)];
    if (!openings.length && !closings.length) return { status: 'missing', error: 'No <finalProse> element was returned.' };
    if (openings.length !== 1 || closings.length !== 1 || closings[0].index < openings[0].index) return { status: 'invalid', error: `Expected one ordered <finalProse>...</finalProse>; found ${openings.length} openings and ${closings.length} closings.` };
    const text = raw.slice(openings[0].index + openings[0][0].length, closings[0].index);
    return text.trim() ? { status: 'extracted', text } : { status: 'empty', error: '<finalProse> is empty; raw response is retained.' };
}
function errorRecord(error) {
    if (!(error instanceof Error)) return { name: 'Error', message: String(error) };
    return { name: error.name, message: error.message, stack: error.stack, ...(error.code ? { code: error.code } : {}), ...(error.cause ? { cause: errorRecord(error.cause) } : {}) };
}
function persistResults(directory, manifest, results) {
    results.updatedAt = new Date().toISOString();
    results.completedCounts = Object.fromEntries(results.variants.map(variant => [variant.id, variant.attempts.filter(attempt => attempt.status === 'accepted').length]));
    results.attemptedCounts = Object.fromEntries(results.variants.map(variant => [variant.id, variant.attempts.length]));
    results.rejectedCounts = Object.fromEntries(results.variants.map(variant => [variant.id, variant.attempts.filter(attempt => attempt.status === 'rejected').length]));
    writeJson(path.join(directory, 'results.json'), results);
    refreshIndex(directory, manifest, results);
}
function refreshIndex(directory, manifest, results) {
    const lines = ['# Prose benchmark', '', `Prepared: ${manifest.createdAt}`, '', `Order: ${manifest.order.join(', then ')}; one completion at a time. Only complete nonempty finalProse blocks enter the comparison; every rejected raw reply remains available.`, ''];
    for (const variant of results.variants) {
        const accepted = variant.attempts.filter(attempt => attempt.status === 'accepted');
        const settings = manifest.variants.find(item => item.id === variant.id);
        lines.push(`## ${variant.id}: ${variant.status} (${accepted.length}/${settings.targetAccepted} accepted, ${variant.attempts.length}/${settings.maxAttempts} attempts)`, '');
        if (variant.status === 'shortfall') lines.push(`SHORTFALL: only ${accepted.length} correctly formatted responses after the attempt limit.`, '');
        for (const [index, attempt] of accepted.entries()) {
            lines.push(`### Accepted ${index + 1} (attempt ${attempt.number})`, '', `[Raw response](${attempt.rawPath}) · [Extracted final prose](${attempt.finalProsePath})`, '', fs.readFileSync(path.join(directory, attempt.finalProsePath), 'utf8'), '');
        }
        const rejected = variant.attempts.filter(attempt => attempt.status !== 'accepted');
        if (rejected.length) lines.push('### Other attempts', '');
        for (const attempt of rejected) {
            lines.push(`- Attempt ${attempt.number}: ${attempt.status}. ${attempt.error?.message || attempt.extraction?.error || ''}${attempt.rawPath ? ` [Raw response](${attempt.rawPath})` : ''}`);
        }
        lines.push('');
    }
    fs.writeFileSync(path.join(directory, 'index.md'), `${lines.join('\n')}\n`);
}
function acquireLock(directory) {
    const file = path.join(directory, '.run.lock');
    if (fs.existsSync(file)) {
        const owner = readJson(file);
        if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) throw new Error('Benchmark lock has an invalid owner; inspect .run.lock before resuming.');
        try { process.kill(owner.pid, 0); throw new Error(`Benchmark is already owned by process ${owner.pid}; concurrent runs are forbidden.`); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
        fs.unlinkSync(file); // Only a verified dead owner's transient lock is removed.
    }
    fs.writeFileSync(file, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, { flag: 'wx', mode: 0o600 });
    return () => fs.unlinkSync(file);
}
async function runBenchmark(directory, { llmClient = LLMClient } = {}) {
    for (const key of ['LLM_FORCE_OUTPUTS_FILE', 'LLM_RECORD_OUTPUTS_FILE']) if (process.env[key]?.trim()) throw new Error(`${key} must be unset for a real-output prose benchmark.`);
    const release = acquireLock(directory);
    const controller = new AbortController();
    const interrupt = () => controller.abort(new Error('Benchmark interrupted; resume this prepared directory to continue.'));
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
        const manifest = readJson(path.join(directory, 'manifest.json'));
        const results = readJson(path.join(directory, 'results.json'));
        if (manifest.runnerSource && (hash(fs.readFileSync(__filename)) !== manifest.runnerSha256
            || hash(fs.readFileSync(path.join(directory, manifest.runnerSource))) !== manifest.runnerSha256)) {
            throw new Error('Runner source/archive no longer matches the prepared hash; prepare a new run instead of changing code during collection.');
        }
        if (manifest.version !== 1 || results.version !== 1 || results.variants.length !== manifest.variants.length) throw new Error('Prepared benchmark manifest/results version or variant count is invalid.');
        const { bytes, value } = loadConfiguration(manifest.sources.config.path);
        if (hash(bytes) !== manifest.sources.config.sha256) throw new Error('Source config changed since preparation; restore it or prepare a new benchmark instead of mixing settings.');
        const config = makeBenchmarkConfig(value);
        if (hash(JSON.stringify(redactConfig(config))) !== manifest.configuration.sha256) throw new Error('Effective benchmark configuration differs from the prepared snapshot.');
        const generation = fs.readFileSync(path.join(directory, manifest.sources.generation.saved), 'utf8');
        if (hash(generation) !== manifest.sources.generation.sha256) throw new Error('Prepared generation prompt hash changed.');
        const systems = new Map(manifest.variants.map(variant => {
            const text = fs.readFileSync(path.join(directory, variant.file), 'utf8');
            if (hash(text) !== variant.sha256) throw new Error(`Prepared ${variant.id} system prompt hash changed.`);
            return [variant.id, text];
        }));
        Globals.baseDir = directory;
        Globals.config = config;
        let earlierIncomplete = false;
        for (const [index, variant] of results.variants.entries()) {
            const settings = manifest.variants[index];
            if (variant.id !== settings.id || !Array.isArray(variant.attempts)) throw new Error(`results.variants[${index}] does not match the prepared variant.`);
            if (earlierIncomplete && variant.attempts.length) throw new Error('Variant attempts are interleaved; finish each variant before starting the next.');
            if (variant.attempts.filter(attempt => attempt.status === 'accepted').length < settings.targetAccepted && variant.attempts.length < settings.maxAttempts) earlierIncomplete = true;
        }
        let laterWorkForbidden = false;
        for (let variantIndex = 0; variantIndex < results.variants.length; variantIndex++) {
            const variant = results.variants[variantIndex];
            const settings = manifest.variants[variantIndex];
            if (variant.id !== settings.id || variant.attempts.length > settings.maxAttempts) throw new Error(`results.variants[${variantIndex}] no longer matches the prepared order/budget.`);
            if (laterWorkForbidden && variant.attempts.length) throw new Error('Variant attempts are interleaved; complete each variant before starting the next.');
            for (const [index, attempt] of variant.attempts.entries()) {
                if (attempt.number !== index + 1) throw new Error(`${variant.id} attempt numbering is not sequential.`);
                if (attempt.rawPath && hash(fs.readFileSync(path.join(directory, attempt.rawPath))) !== attempt.rawSha256) throw new Error(`${variant.id} attempt ${attempt.number} raw response changed.`);
                if (attempt.status === 'accepted' && (!attempt.rawPath || !attempt.finalProsePath)) throw new Error(`${variant.id} accepted attempt ${attempt.number} is missing its response artifacts.`);
            }
            const acceptedCount = () => variant.attempts.filter(attempt => attempt.status === 'accepted').length;
            if (acceptedCount() > settings.targetAccepted) throw new Error(`${variant.id} exceeds its accepted-response target.`);
            if (variant.attempts.at(-1)?.status === 'running') {
                const interrupted = variant.attempts.at(-1);
                interrupted.status = 'interrupted';
                interrupted.error = { name: 'InterruptedRun', message: 'Previous process ended before recording completion; partial artifacts are retained and this invocation consumes one attempt.' };
                interrupted.finishedAt = new Date().toISOString();
            }
            while (acceptedCount() < settings.targetAccepted && variant.attempts.length < settings.maxAttempts) {
                if (controller.signal.aborted) throw controller.signal.reason;
                variant.status = 'running';
                const attempt = { number: variant.attempts.length + 1, status: 'running', startedAt: new Date().toISOString() };
                variant.attempts.push(attempt);
                persistResults(directory, manifest, results);
                const stem = `${variant.id}.attempt-${String(attempt.number).padStart(2, '0')}`;
                const system = systems.get(variant.id);
                const messages = [{ role: 'system', content: system }, { role: 'user', content: generation }];
                let raw = null;
                let responsePayload = null;
                let failure = null;
                let requestCaptured = false;
                process.stderr.write(`${variant.id} attempt ${attempt.number} (${acceptedCount()}/${settings.targetAccepted} accepted)\n`);
                try {
                    await llmClient.chatCompletion({
                        messages, metadataLabel: `prosebench_${variant.id}`, output: 'stderr',
                        validateXML: false, xmlOutput: false, allowToolCalls: false, prefill: null,
                        retryAttempts: 0, throwOnError: true, maxConcurrent: 1, signal: controller.signal,
                        captureRequestPayload: payload => {
                            const exact = payload.messages?.length === 2 && payload.messages.every((message, i) => message.role === messages[i].role && message.content === messages[i].content);
                            if (!exact || payload.tools || payload.functions || Object.hasOwn(payload, 'seed')) throw new Error(`${variant.id}: native request differs from the exact prepared messages/tool-free seed-omission contract.`);
                            const file = path.join(directory, 'responses', `${stem}.request.json`);
                            writeJson(file, payload); attempt.requestPath = relative(directory, file);
                            attempt.requestMessagesSha256 = hash(JSON.stringify(payload.messages));
                            requestCaptured = true;
                        },
                        captureResponsePayload: payload => {
                            responsePayload = payload;
                            const content = payload?.choices?.[0]?.message?.content;
                            if (typeof content === 'string') raw = content;
                        }
                    });
                    if (!requestCaptured) throw new Error(`${variant.id}: native request capture did not run; no completion can be accepted without exact-input verification.`);
                    if (typeof raw !== 'string' || !raw.trim()) throw new Error(`${variant.id}: provider returned an empty assistant completion.`);
                } catch (error) {
                    failure = error;
                    if (raw === null && typeof error.partialResponse === 'string') raw = error.partialResponse;
                }
                if (typeof raw === 'string') {
                    attempt.rawPath = `responses/${stem}.raw.txt`;
                    fs.writeFileSync(path.join(directory, attempt.rawPath), raw);
                    attempt.rawSha256 = hash(raw);
                    attempt.rawBytes = Buffer.byteLength(raw);
                    attempt.extraction = extractFinalProse(raw);
                    if (attempt.extraction.status === 'extracted') {
                        attempt.finalProsePath = `responses/${stem}.finalProse.txt`;
                        fs.writeFileSync(path.join(directory, attempt.finalProsePath), attempt.extraction.text);
                        delete attempt.extraction.text;
                    }
                } else attempt.rawAvailable = false;
                if (responsePayload) writeJson(path.join(directory, 'responses', `${stem}.response.json`), responsePayload);
                const logPath = llmClient.logPrompt({ prefix: stem, metadataLabel: `prosebench_${variant.id}`, systemPrompt: system, generationPrompt: generation, response: typeof raw === 'string' ? raw : '', markResponseBoundaries: true, output: 'stderr' });
                if (!logPath) failure = failure || new Error(`${variant.id}: native prompt logging failed.`);
                else attempt.promptLog = relative(directory, logPath);
                attempt.finishedAt = new Date().toISOString();
                attempt.elapsedMs = Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt);
                attempt.status = failure ? 'failed' : attempt.extraction.status === 'extracted' ? 'accepted' : 'rejected';
                if (failure) attempt.error = errorRecord(failure);
                persistResults(directory, manifest, results);
                if (failure) throw new Error(`Benchmark stopped at ${variant.id} attempt ${attempt.number}; available raw output and errors were retained. Resume with --run ${directory}.`, { cause: failure });
            }
            variant.status = acceptedCount() === settings.targetAccepted ? 'completed' : 'shortfall';
            laterWorkForbidden = variant.status !== 'completed' && variant.status !== 'shortfall';
            persistResults(directory, manifest, results);
        }
        return results;
    } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
        release();
    }
}
async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.prepareOnly) console.log(prepareRun(options));
    else {
        const results = await runBenchmark(options.runDirectory);
        console.log(JSON.stringify({ directory: options.runDirectory, completedCounts: results.completedCounts }));
    }
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); if (error.cause) console.error('Cause:', error.cause.stack || error.cause); process.exitCode = 1; });
module.exports = { parseArgs, extractSystemPrompt, makeBenchmarkConfig, readVariants, prepareRun, extractFinalProse, runBenchmark, CRITIC_PREFIX, AUTHOR_PREFIX };
