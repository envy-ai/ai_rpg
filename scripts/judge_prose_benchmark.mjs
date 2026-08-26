#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { parseBooleanOption, parsePositiveInteger } from './lib/prose_benchmark/core.mjs';
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
        'Usage: npm run benchmark:prose:judge -- --run <run-id-or-directory> [options]',
        '',
        'Options:',
        '  --run <id-or-path>        Existing prose benchmark run (required)',
        '  --criteria <json>         Rubric (default: benchmarks/prose/lamia-shoes.criteria.json)',
        `  --model <model-id>         Codex judge model (default: ${DEFAULT_CODEX_JUDGE_MODEL})`,
        '  --batch-size <number>     Responses per Codex judgment call (default: 10)',
        '  --timeout <seconds>       Codex call timeout (default: 600)',
        '  --reasoning-effort <name> Codex effort (default: medium)',
        '  --codex-command <path>    Codex executable (default: codex)',
        '  --codex-home <path>       Codex home (default: CODEX_HOME or ~/.codex)',
        '  --force <boolean>         Replace prior judgments (default: false)',
        '',
        'The command preserves prose success/failure, semantically judges captured prose through',
        'fresh Codex bridge turns, and updates results.json plus the existing HTML dashboard.'
    ].join('\n');
}

async function resolveRunDirectory(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('--run is required.');
    const direct = path.resolve(ROOT, value.trim());
    const byId = path.join(ROOT, 'benchmarks', 'prose', 'runs', value.trim());
    for (const candidate of [direct, byId]) {
        const stat = await fs.stat(candidate).catch(() => null);
        if (stat?.isDirectory()) return candidate;
    }
    throw new Error(`Prose benchmark run not found: ${value}`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }
    const runDirectory = await resolveRunDirectory(options.run);
    const proseRunsRoot = path.join(ROOT, 'benchmarks', 'prose', 'runs');
    const relativeRun = path.relative(proseRunsRoot, runDirectory);
    if (relativeRun.startsWith('..') || path.isAbsolute(relativeRun)) {
        throw new Error('Judged prose benchmark runs must be under benchmarks/prose/runs/.');
    }
    const batchSize = parsePositiveInteger(options['batch-size'] || 10, '--batch-size');
    const timeoutSeconds = parsePositiveInteger(options.timeout || 600, '--timeout');
    console.log(`Judging prose benchmark ${runDirectory}`);
    const state = await judgeProseBenchmarkRun(ROOT, runDirectory, {
        criteriaPath: options.criteria || 'benchmarks/prose/lamia-shoes.criteria.json',
        model: options.model || DEFAULT_CODEX_JUDGE_MODEL,
        command: options['codex-command'] || 'codex',
        home: options['codex-home'] ? path.resolve(options['codex-home']) : undefined,
        reasoningEffort: options['reasoning-effort'] || 'medium',
        timeoutMs: timeoutSeconds * 1000,
        batchSize,
        force: parseBooleanOption(options.force ?? false, '--force')
    });
    const judged = state.results.filter(result => result.judgment).length;
    console.log(`Judged ${judged} captured responses with ${state.judging.model}.`);
    console.log(`Report: ${path.join(runDirectory, state.reportFilename)}`);
}

main().catch(error => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
});
