#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { runScenario } from './lib/followup_api_playtest/scenario.mjs';
import { writeBenchmarkConfig } from './lib/model_benchmark/config.mjs';
import {
    filterBenchmarkScenarios,
    loadBenchmarkManifest
} from './lib/model_benchmark/manifest.mjs';
import {
    benchmarkReportFilename,
    collectScenarioResult,
    summarizeBenchmark,
    writeBenchmarkReports
} from './lib/model_benchmark/report.mjs';
import {
    materializeStoredSelection,
    mergeScenarioSelections,
    orderScenarioResults,
    replaceScenarioResult,
    scenarioMutatesRuntimeConfig,
    selectUnfinishedScenarios
} from './lib/model_benchmark/resume.mjs';
import { ManagedBenchmarkServer } from './lib/model_benchmark/server.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
    const options = { family: [], case: [] };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!argument.startsWith('--')) throw new Error(`Unexpected positional argument ${argument}.`);
        const key = argument.slice(2);
        if (['help', 'list', 'no-router-preload'].includes(key)) {
            options[key] = true;
            continue;
        }
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) throw new Error(`Option --${key} requires a value.`);
        index += 1;
        if (['family', 'case'].includes(key)) {
            options[key].push(...value.split(',').map(entry => entry.trim()).filter(Boolean));
        } else {
            options[key] = value;
        }
    }
    return options;
}

function safeRunId(value) {
    const runId = value || new Date().toISOString().replaceAll(/[:.]/g, '-');
    if (!/^[A-Za-z0-9._-]+$/.test(runId)) {
        throw new Error('Benchmark run id may contain only letters, numbers, dots, underscores, and hyphens.');
    }
    return runId;
}

async function atomicJson(filename, value) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, filename);
}

function groupByProfile(entries) {
    const groups = new Map();
    for (const entry of entries) {
        if (!groups.has(entry.profile)) groups.set(entry.profile, []);
        groups.get(entry.profile).push(entry);
    }
    return groups;
}

function usage() {
    return [
        'Usage: npm run benchmark:model -- (--model <model-id> | --resume <run-id>) [options]',
        '',
        'Options:',
        '  --base-override <yaml>   Base router config (default: config.yaml.qwen-combo-router)',
        '  --endpoint <url>         Override every benchmark AI endpoint',
        '  --manifest <json>        Benchmark manifest path',
        '  --port <number>          Managed game-server port (default: 7777)',
        '  --output <directory>     Output directory under benchmarks/model/',
        '  --run-id <id>            Stable report/localStorage id',
        '  --resume <run-id>         Continue an existing benchmarks/model session',
        '  --family <PREFIX,...>    Limit families; repeatable',
        '  --case <PREFIX-N,...>    Limit cases or exact scenario case names; repeatable',
        '  --no-router-preload      Leave router_preload_model blank unless the profile owns it',
        '  --list                   Validate and list coverage without starting a server',
        '',
        'On --resume, filters rerun and replace only those cases. Without filters,',
        'the runner continues only scenario variants that have no saved result.'
    ].join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    if (options.resume && options.list) throw new Error('--resume cannot be combined with --list.');
    if (options.resume && (options.output || options['run-id'])) {
        throw new Error('--resume uses the saved session directory and cannot be combined with --output or --run-id.');
    }
    const resumeId = options.resume ? safeRunId(options.resume) : null;
    const newRunId = resumeId ? null : safeRunId(options['run-id']);
    const outputDirectory = resumeId
        ? path.join(ROOT, 'benchmarks', 'model', resumeId)
        : path.resolve(ROOT, options.output || path.join('benchmarks', 'model', newRunId));
    const relativeOutput = path.relative(path.join(ROOT, 'benchmarks', 'model'), outputDirectory);
    if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
        throw new Error('Benchmark output must stay under benchmarks/model/.');
    }
    let savedState = null;
    let savedManifest = null;
    if (resumeId) {
        const outputStat = await fs.stat(outputDirectory).catch(() => null);
        if (!outputStat?.isDirectory()) throw new Error(`Benchmark session does not exist: ${resumeId}`);
        try {
            savedState = JSON.parse(await fs.readFile(path.join(outputDirectory, 'progress.json'), 'utf8'));
            savedManifest = JSON.parse(await fs.readFile(path.join(outputDirectory, 'manifest.json'), 'utf8'));
        } catch (error) {
            throw new Error(`Failed to read benchmark session ${resumeId}: ${error.message}`);
        }
        if (savedState.runId !== resumeId) {
            throw new Error(`Benchmark session id mismatch: expected ${resumeId}, found ${savedState.runId}.`);
        }
        if (options.manifest && options.manifest !== savedState.manifestPath) {
            throw new Error(`--manifest must match the resumed session manifest ${savedState.manifestPath}.`);
        }
    }
    const inventory = await loadBenchmarkManifest(
        ROOT,
        savedState?.manifestPath || options.manifest || 'tests/followup_api_playtest/model_benchmark_manifest.json'
    );
    const hasFilters = options.case.length > 0 || options.family.length > 0;
    const filtered = filterBenchmarkScenarios(inventory, {
        caseFilters: options.case,
        familyFilters: options.family
    });
    if (options.list) {
        console.log(JSON.stringify({
            manifest: inventory.manifestPath,
            expectedLogicalCases: inventory.expectedCases.length,
            runnableLogicalCases: inventory.runnableCaseIds.length,
            scenarioVariants: inventory.scenarios.length,
            setupScenarios: inventory.setupScenarios.length,
            missingCaseIds: inventory.missingCaseIds,
            selected: filtered.map(entry => ({ caseId: entry.caseId, case: entry.definition.case, file: entry.file }))
        }, null, 2));
        return;
    }
    const requestedModel = options.model?.trim() || null;
    if (savedState && requestedModel && requestedModel !== savedState.model) {
        throw new Error(`--model must match the resumed session model ${savedState.model}.`);
    }
    const model = savedState?.model || requestedModel;
    if (!model) throw new Error('--model is required for a new benchmark session.');
    if (savedState && options.endpoint && options.endpoint !== savedState.endpoint) {
        throw new Error(`--endpoint must match the resumed session endpoint ${savedState.endpoint || '(default)'}.`);
    }
    if (savedState && options['base-override'] && options['base-override'] !== savedState.baseOverride) {
        throw new Error(`--base-override must match the resumed session base override ${savedState.baseOverride}.`);
    }
    const port = Number(options.port || 7777);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 through 65535.');
    const runId = resumeId || newRunId;
    if (!resumeId) {
        const outputExists = await fs.stat(outputDirectory).catch(() => null);
        if (outputExists) throw new Error(`Benchmark output directory already exists: ${outputDirectory}`);
        await fs.mkdir(outputDirectory, { recursive: true });
    }
    const knownFailures = inventory.manifest.knownAuditedModelFailures;
    let selected;
    let reportSelection;
    let state;
    if (savedState) {
        const storedSelection = materializeStoredSelection(inventory, savedState.selectedScenarios);
        selected = hasFilters ? filtered : selectUnfinishedScenarios(storedSelection, savedState.results);
        if (!selected.length) {
            throw new Error('The resumed session has no unfinished scenarios. Supply --case or --family to rerun selected tests.');
        }
        reportSelection = mergeScenarioSelections(storedSelection, selected);
        state = {
            ...savedState,
            projectRoot: ROOT,
            model,
            endpoint: savedState.endpoint || null,
            baseOverride: savedState.baseOverride || 'config.yaml.qwen-combo-router',
            manifestPath: inventory.manifestPath,
            finishedAt: null,
            interrupted: false,
            resumeHistory: [
                ...(Array.isArray(savedState.resumeHistory) ? savedState.resumeHistory : []),
                {
                    startedAt: new Date().toISOString(),
                    previousFinishedAt: savedState.finishedAt || null,
                    caseFilters: options.case,
                    familyFilters: options.family,
                    selectedScenarioFiles: selected.map(entry => entry.file)
                }
            ]
        };
    } else {
        selected = filtered;
        reportSelection = selected;
        state = {
            version: 1,
            runId,
            projectRoot: ROOT,
            model,
            endpoint: options.endpoint || null,
            baseOverride: options['base-override'] || 'config.yaml.qwen-combo-router',
            manifestPath: inventory.manifestPath,
            startedAt: new Date().toISOString(),
            finishedAt: null,
            interrupted: false,
            resumeHistory: [],
            results: [],
            summary: null
        };
    }
    for (const entry of reportSelection) entry.knownAuditedModelFailure = knownFailures[entry.caseId] || null;
    state.coverage = {
        expectedCases: inventory.expectedCases,
        runnableCaseIds: inventory.runnableCaseIds,
        missingCaseIds: inventory.missingCaseIds,
        fixtureManifests: inventory.fixtureManifests
    };
    state.selectedScenarios = reportSelection.map(entry => ({
            file: entry.file,
            caseId: entry.caseId,
            case: entry.definition.case,
            profile: entry.profile
        }));
    state.results = orderScenarioResults(state.results || [], reportSelection);
    const refreshReports = async () => {
        const selectedVariantCounts = new Map();
        const executedVariantCounts = new Map();
        for (const entry of reportSelection) {
            selectedVariantCounts.set(entry.caseId, (selectedVariantCounts.get(entry.caseId) || 0) + 1);
        }
        for (const result of state.results) {
            executedVariantCounts.set(result.caseId, (executedVariantCounts.get(result.caseId) || 0) + 1);
        }
        state.notRunCaseIds = inventory.expectedCases.filter(caseId => (
            !selectedVariantCounts.has(caseId)
            || (executedVariantCounts.get(caseId) || 0) < selectedVariantCounts.get(caseId)
        ));
        state.summary = summarizeBenchmark({
            expectedCases: inventory.expectedCases,
            selectedScenarioEntries: reportSelection,
            results: state.results,
            interrupted: state.interrupted
        });
        await writeBenchmarkReports(outputDirectory, state);
    };
    await atomicJson(path.join(outputDirectory, 'manifest.json'), {
        version: 1,
        runId,
        model,
        options: savedManifest?.options || options,
        resumeHistory: state.resumeHistory,
        manifest: inventory.manifest,
        expectedCases: inventory.expectedCases,
        selectedScenarios: state.selectedScenarios,
        missingCaseIds: inventory.missingCaseIds,
        fixtureManifests: inventory.fixtureManifests
    });
    await refreshReports();

    let activeServer = null;
    let stopRequested = false;
    const requestStop = signal => {
        stopRequested = true;
        state.interrupted = true;
        process.stderr.write(`\nReceived ${signal}; stopping after the current safe boundary.\n`);
        activeServer?.stop().catch(error => process.stderr.write(`Server stop failed: ${error.message}\n`));
    };
    process.once('SIGINT', () => requestStop('SIGINT'));
    process.once('SIGTERM', () => requestStop('SIGTERM'));

    const routerPreload = options['no-router-preload'] !== true
        && savedManifest?.options?.['no-router-preload'] !== true;
    let executedThisInvocation = 0;
    try {
        for (const [profileName, entries] of groupByProfile(selected)) {
            if (stopRequested) break;
            const safeProfile = profileName.replaceAll(/[^A-Za-z0-9._-]/g, '_');
            const configPath = path.join(outputDirectory, 'configs', `${safeProfile}.yaml`);
            const logPath = path.join(outputDirectory, 'server-logs', `${safeProfile}.log`);
            await writeBenchmarkConfig(ROOT, {
                profileName,
                model,
                baseOverridePath: state.baseOverride,
                outputPath: configPath,
                endpoint: state.endpoint,
                routerPreload
            });
            activeServer = new ManagedBenchmarkServer({ root: ROOT, port, configPath, logPath });
            await activeServer.start();
            for (const entry of entries) {
                if (stopRequested) break;
                if (!activeServer?.running) {
                    await activeServer?.stop();
                    activeServer = new ManagedBenchmarkServer({ root: ROOT, port, configPath, logPath });
                    await activeServer.start();
                }
                process.stdout.write(`[${executedThisInvocation + 1}/${selected.length}] ${entry.definition.case}\n`);
                const caseStarted = Date.now();
                let outcome = null;
                let error = null;
                try {
                    outcome = await runScenario({
                        root: ROOT,
                        definition: entry.definition,
                        mode: 'live-verify',
                        baseUrl: activeServer.baseUrl,
                        wsUrl: activeServer.wsUrl
                    });
                } catch (caught) {
                    error = caught;
                }
                const attemptDir = outcome?.attemptDir || error?.attemptDir || null;
                const result = await collectScenarioResult(ROOT, {
                    entry,
                    attemptDir,
                    requestedModel: model,
                    error,
                    durationMs: Date.now() - caseStarted
                });
                state.results = orderScenarioResults(
                    replaceScenarioResult(state.results, result),
                    reportSelection
                );
                executedThisInvocation += 1;
                await refreshReports();
                if (scenarioMutatesRuntimeConfig(entry.definition)) {
                    await activeServer.stop();
                    activeServer = null;
                }
            }
            await activeServer?.stop();
            activeServer = null;
        }
    } finally {
        if (activeServer) await activeServer.stop().catch(() => {});
        state.finishedAt = new Date().toISOString();
        await refreshReports();
    }
    console.log(JSON.stringify({
        runId,
        model,
        outputDirectory: path.relative(ROOT, outputDirectory),
        report: path.relative(ROOT, path.join(outputDirectory, benchmarkReportFilename(model))),
        summary: state.summary
    }, null, 2));
    if (state.results.some(result => result.status !== 'passed')) process.exitCode = 1;
    if (state.interrupted) process.exitCode = 130;
}

main().catch(error => {
    console.error(`${error.message}\n\n${usage()}`);
    process.exitCode = 1;
});
