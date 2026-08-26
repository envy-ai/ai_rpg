#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ManagedBenchmarkServer } from './lib/model_benchmark/server.mjs';
import {
    createDirectoryManifest,
    extractFinalProse,
    parseBooleanOption,
    parsePositiveInteger,
    prepareRuntimeSave,
    proseReportFilename,
    resolveSourceSave,
    safeFilenameSegment,
    snapshotSourceSave,
    writeProseBenchmarkConfig,
    writeProseBenchmarkReports
} from './lib/prose_benchmark/core.mjs';
import {
    DEFAULT_CODEX_JUDGE_MODEL,
    judgeProseBenchmarkRun
} from './lib/prose_benchmark/judge.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!argument.startsWith('--')) throw new Error(`Unexpected positional argument ${argument}.`);
        const key = argument.slice(2);
        if (key === 'help') {
            options.help = true;
            continue;
        }
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) throw new Error(`Option --${key} requires a value.`);
        if (Object.prototype.hasOwnProperty.call(options, key)) throw new Error(`Option --${key} may only be supplied once.`);
        options[key] = value;
        index += 1;
    }
    return options;
}

function usage() {
    return [
        'Usage: npm run benchmark:prose -- --checkpoint <model-id> --input <text> [options]',
        '',
        'Options:',
        '  --checkpoint <model-id>  Exact local-router or remote model id (required)',
        '  --model <model-id>       Alias for --checkpoint',
        '  --save <path-or-name>    Source save (default: latest-manual)',
        '  --input <text>           Exact player input',
        '  --input-file <file>      Read exact player input from a UTF-8 file',
        '  --tries <number>         Number of independent attempts (default: 10)',
        '  --tinybrain <boolean>    Run TinyBrain or normal prompting (default: true)',
        '  --halt-after-player-action <boolean>',
        '                            Return after final player prose, before post-action systems (default: false)',
        '  --base-override <yaml>   Base configuration profile (default: config.yaml.qwen-combo-router)',
        '  --endpoint <url>         Override the AI endpoint for every prompt route',
        '  --port <number>          Managed game-server port (default: 7778)',
        '  --turn-timeout <seconds> Per-attempt chat timeout (default: 1800)',
        '  --run-id <id>            Stable run-directory id',
        '  --output <directory>     Output directory under benchmarks/prose/runs/',
        '  --judge-criteria <json>  After generation, judge captured prose with this rubric through Codex',
        `  --judge-model <model-id> Codex judge model (default: ${DEFAULT_CODEX_JUDGE_MODEL})`,
        '  --judge-batch-size <n>   Responses per Codex judge call (default: 10)',
        '  --judge-timeout <seconds> Codex judge call timeout (default: 600)',
        '  --judge-reasoning-effort <name> Codex judge effort (default: medium)',
        '  --judge-codex-home <path> Codex home (default: CODEX_HOME or ~/.codex)',
        '',
        'The runner snapshots the complete source save into the run directory, starts every',
        'attempt from a fresh disposable copy of that snapshot, retains every final game save,',
        'and writes final dialogue as individual text files plus an aggregate HTML report.'
    ].join('\n');
}

async function atomicJson(filename, value) {
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, filename);
}

async function fetchJson(baseUrl, method, route, body, timeoutMs) {
    const startedAt = Date.now();
    const response = await fetch(new URL(route, baseUrl), {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let payload;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = { rawText: text };
    }
    return {
        method,
        route,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        payload
    };
}

function requireRunId(value) {
    if (!/^[A-Za-z0-9._-]+$/.test(value)) {
        throw new Error('Run id may contain only letters, numbers, dots, underscores, and hyphens.');
    }
    return value;
}

async function readPlayerInput(options) {
    if (options.input !== undefined && options['input-file'] !== undefined) {
        throw new Error('--input and --input-file are mutually exclusive.');
    }
    const value = options['input-file'] !== undefined
        ? await fs.readFile(path.resolve(ROOT, options['input-file']), 'utf8')
        : options.input;
    if (typeof value !== 'string' || !value.trim()) throw new Error('--input or --input-file is required.');
    return value.trim();
}

async function copyFinalSave(root, response, targetDirectory) {
    const saveDir = typeof response?.payload?.saveDir === 'string'
        ? path.resolve(response.payload.saveDir)
        : null;
    if (!response?.ok || response?.payload?.success !== true || !saveDir) return null;
    const savesRoot = path.join(root, 'saves');
    const relative = path.relative(savesRoot, saveDir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Save API returned a directory outside saves/: ${saveDir}`);
    }
    await fs.cp(saveDir, targetDirectory, { recursive: true, errorOnExist: true, force: false });
    return {
        sourceDirectory: saveDir,
        saveName: response.payload.saveName || path.basename(saveDir),
        manifest: await createDirectoryManifest(targetDirectory)
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    const checkpointOption = options.checkpoint || options.model;
    if (options.checkpoint && options.model && options.checkpoint !== options.model) {
        throw new Error('--checkpoint and --model must match when both are supplied.');
    }
    const checkpoint = String(checkpointOption ?? '').trim();
    if (!checkpoint) throw new Error('--checkpoint is required.');
    const playerInput = await readPlayerInput(options);
    const tries = parsePositiveInteger(options.tries || 10, '--tries');
    const tinybrain = parseBooleanOption(options.tinybrain ?? true, '--tinybrain');
    const haltAfterPlayerAction = parseBooleanOption(
        options['halt-after-player-action'] ?? false,
        '--halt-after-player-action'
    );
    const port = parsePositiveInteger(options.port || 7778, '--port');
    if (port > 65535) throw new Error('--port must not exceed 65535.');
    const turnTimeoutSeconds = parsePositiveInteger(options['turn-timeout'] || 1800, '--turn-timeout');
    const baseOverride = options['base-override'] || 'config.yaml.qwen-combo-router';
    const endpoint = options.endpoint?.trim() || null;
    const judgeCriteriaPath = options['judge-criteria']?.trim() || null;
    if (!judgeCriteriaPath && (
        options['judge-model']
        || options['judge-batch-size']
        || options['judge-timeout']
        || options['judge-reasoning-effort']
        || options['judge-codex-home']
    )) {
        throw new Error('Codex judge options require --judge-criteria.');
    }
    const judgeModel = options['judge-model']?.trim() || DEFAULT_CODEX_JUDGE_MODEL;
    const judgeBatchSize = parsePositiveInteger(options['judge-batch-size'] || 10, '--judge-batch-size');
    const judgeTimeoutSeconds = parsePositiveInteger(options['judge-timeout'] || 600, '--judge-timeout');
    const judgeReasoningEffort = options['judge-reasoning-effort']?.trim() || 'medium';
    const judgeCodexHome = options['judge-codex-home']
        ? path.resolve(options['judge-codex-home'])
        : undefined;
    const source = await resolveSourceSave(ROOT, options.save || 'latest-manual');
    const defaultRunId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${safeFilenameSegment(checkpoint, 'model')}-${tinybrain ? 'tinybrain' : 'normal'}`;
    const runId = requireRunId(options['run-id'] || defaultRunId);
    const proseRunsRoot = path.join(ROOT, 'benchmarks', 'prose', 'runs');
    const runDirectory = path.resolve(ROOT, options.output || path.join('benchmarks', 'prose', 'runs', runId));
    const relativeOutput = path.relative(proseRunsRoot, runDirectory);
    if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
        throw new Error('Prose benchmark output must stay under benchmarks/prose/runs/.');
    }
    if (await fs.stat(runDirectory).catch(() => null)) {
        throw new Error(`Prose benchmark output already exists: ${runDirectory}`);
    }
    await fs.mkdir(path.join(runDirectory, 'attempts'), { recursive: true });
    await fs.mkdir(path.join(runDirectory, 'dialogue'), { recursive: true });
    await fs.mkdir(path.join(runDirectory, 'server-logs'), { recursive: true });

    const sourceSnapshotDirectory = path.join(runDirectory, 'source-save');
    console.log(`Snapshotting source save ${source.directory}`);
    const sourceManifest = await snapshotSourceSave(source.directory, sourceSnapshotDirectory);
    await atomicJson(path.join(runDirectory, 'source-save-manifest.json'), sourceManifest);
    const configResult = await writeProseBenchmarkConfig(ROOT, {
        baseOverridePath: baseOverride,
        outputPath: path.relative(ROOT, path.join(runDirectory, 'config.override.yaml')),
        checkpoint,
        tinybrain,
        endpoint
    });
    const state = {
        version: 1,
        runId,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        projectRoot: ROOT,
        checkpoint,
        tinybrain,
        haltAfterPlayerAction,
        playerInput,
        tries,
        port,
        endpoint,
        baseOverride,
        sourceSaveName: source.saveName,
        sourceSaveType: source.sourceType,
        sourceSaveOriginalPath: source.directory,
        sourceSaveSnapshotPath: 'source-save',
        sourceSaveMetadata: source.metadata,
        sourceSaveManifest: sourceManifest,
        reportFilename: proseReportFilename(checkpoint, tinybrain),
        results: []
    };
    await atomicJson(path.join(runDirectory, 'manifest.json'), state);
    await writeProseBenchmarkReports(runDirectory, state);

    let server = null;
    let interrupted = false;
    const stopServer = async () => {
        if (!server) return;
        await server.stop();
        server = null;
    };
    const handleSignal = () => {
        interrupted = true;
        console.warn('Interruption requested; stopping after the active operation.');
    };
    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);

    try {
        server = new ManagedBenchmarkServer({
            root: ROOT,
            port,
            configPath: configResult.outputPath,
            logPath: path.join(runDirectory, 'server-logs', 'game-server.log')
        });
        await server.start();
        const baseUrl = server.baseUrl;
        for (let attempt = 1; attempt <= tries && !interrupted; attempt += 1) {
            const attemptLabel = String(attempt).padStart(String(tries).length, '0');
            const attemptDirectory = path.join(runDirectory, 'attempts', `attempt-${attemptLabel}`);
            const dialoguePath = path.join(runDirectory, 'dialogue', `attempt-${attemptLabel}.txt`);
            const runtimeName = `prose-benchmark-${safeFilenameSegment(runId)}-${attemptLabel}`;
            const runtimeDirectory = path.join(ROOT, 'autosaves', runtimeName);
            await fs.mkdir(attemptDirectory, { recursive: false });
            const startedAt = Date.now();
            let loadResponse = null;
            let chatResponse = null;
            let saveResponse = null;
            let finalSave = null;
            let failureReason = null;
            let haltBoundaryConfirmed = !haltAfterPlayerAction;
            console.log(`[${attempt}/${tries}] Loading retained source snapshot...`);
            try {
                await prepareRuntimeSave(sourceSnapshotDirectory, runtimeDirectory, {
                    checkpoint,
                    tinybrain,
                    endpoint,
                    overrideNames: configResult.rewrittenOverrideProfiles
                });
                loadResponse = await fetchJson(baseUrl, 'POST', '/api/load', {
                    saveName: runtimeName,
                    saveType: 'autosaves',
                    modMismatchChoice: 'keep-current'
                }, 300_000);
                if (!loadResponse.ok || loadResponse.payload?.success !== true) {
                    throw new Error(`Source load failed: ${loadResponse.payload?.error || `HTTP ${loadResponse.status}`}`);
                }
                console.log(`[${attempt}/${tries}] Submitting player input...`);
                chatResponse = await fetchJson(baseUrl, 'POST', '/api/chat', {
                    messages: [{ role: 'user', content: playerInput }],
                    haltAfterPlayerAction
                }, turnTimeoutSeconds * 1000);
                haltBoundaryConfirmed = !haltAfterPlayerAction
                    || chatResponse.payload?.haltedAfterPlayerAction === true;
                if (!haltBoundaryConfirmed) {
                    throw new Error('Chat response did not confirm the requested halt-after-player-action boundary.');
                }
                if (!extractFinalProse(chatResponse)) {
                    failureReason = chatResponse.payload?.error
                        || `HTTP ${chatResponse.status} did not contain final prose.`;
                }
            } catch (error) {
                failureReason = error?.message || String(error);
            }
            try {
                if (loadResponse?.ok) {
                    saveResponse = await fetchJson(baseUrl, 'POST', '/api/save', undefined, 300_000);
                    finalSave = await copyFinalSave(ROOT, saveResponse, path.join(attemptDirectory, 'final-save'));
                }
            } catch (error) {
                failureReason = failureReason
                    ? `${failureReason} Final save also failed: ${error.message}`
                    : `Final save failed: ${error.message}`;
            }
            const finalProse = haltBoundaryConfirmed
                ? extractFinalProse(chatResponse)
                : null;
            const dialogueText = finalProse || `NO FINAL PROSE\n\n${failureReason || 'The response did not contain final prose.'}`;
            await fs.writeFile(dialoguePath, `${dialogueText}\n`, 'utf8');
            await atomicJson(path.join(attemptDirectory, 'request.json'), {
                messages: [{ role: 'user', content: playerInput }],
                haltAfterPlayerAction
            });
            await atomicJson(path.join(attemptDirectory, 'load-response.json'), loadResponse);
            await atomicJson(path.join(attemptDirectory, 'chat-response.json'), chatResponse);
            await atomicJson(path.join(attemptDirectory, 'save-response.json'), saveResponse);
            const result = {
                attempt,
                startedAt: new Date(startedAt).toISOString(),
                finishedAt: new Date().toISOString(),
                durationSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
                finalProse,
                failureReason: finalProse ? null : failureReason,
                loadStatus: loadResponse?.status ?? null,
                chatStatus: chatResponse?.status ?? null,
                haltedAfterPlayerAction: chatResponse?.payload?.haltedAfterPlayerAction === true,
                saveStatus: saveResponse?.status ?? null,
                dialogueRelativePath: path.relative(runDirectory, dialoguePath).split(path.sep).join('/'),
                finalSaveRelativePath: finalSave
                    ? path.relative(runDirectory, path.join(attemptDirectory, 'final-save')).split(path.sep).join('/')
                    : null,
                generatedSaveName: finalSave?.saveName || null,
                generatedSaveOriginalPath: finalSave?.sourceDirectory || null,
                finalSaveManifest: finalSave?.manifest || null
            };
            await atomicJson(path.join(attemptDirectory, 'result.json'), result);
            state.results.push(result);
            await writeProseBenchmarkReports(runDirectory, state);
            console.log(`[${attempt}/${tries}] ${finalProse ? 'Final prose captured' : `No final prose: ${failureReason}`}`);
            await fs.rm(runtimeDirectory, { recursive: true, force: true });
        }
    } finally {
        await stopServer();
        state.finishedAt = new Date().toISOString();
        state.interrupted = interrupted;
        const report = await writeProseBenchmarkReports(runDirectory, state);
        await atomicJson(path.join(runDirectory, 'manifest.json'), state);
        console.log(`Report: ${report.reportPath}`);
    }
    if (judgeCriteriaPath) {
        console.log(`Judging captured prose through the Codex bridge with ${judgeModel}...`);
        const judgedState = await judgeProseBenchmarkRun(ROOT, runDirectory, {
            criteriaPath: judgeCriteriaPath,
            model: judgeModel,
            home: judgeCodexHome,
            reasoningEffort: judgeReasoningEffort,
            timeoutMs: judgeTimeoutSeconds * 1000,
            batchSize: judgeBatchSize
        });
        console.log(`Judged ${judgedState.results.filter(result => result.judgment).length} captured responses.`);
        console.log(`Updated report: ${path.join(runDirectory, judgedState.reportFilename)}`);
    }
}

main().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
});
