import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import CodexBridgeClient from '../../../CodexBridgeClient.js';
import Globals from '../../../Globals.js';
import { writeProseBenchmarkReports } from './core.mjs';

export const PROSE_JUDGE_PROMPT_VERSION = 1;
export const DEFAULT_CODEX_JUDGE_MODEL = 'gpt-5.6-terra';

const VERDICTS = new Set(['pass', 'fail', 'unclear']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireTrimmedString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${label} must be a non-empty string.`);
    }
    return value.trim();
}

function normalizeCriterion(value, index) {
    if (!isPlainObject(value)) {
        throw new Error(`Judge criterion ${index + 1} must be an object.`);
    }
    return {
        id: requireTrimmedString(value.id, `Judge criterion ${index + 1} id`),
        title: requireTrimmedString(value.title, `Judge criterion ${index + 1} title`),
        description: requireTrimmedString(value.description, `Judge criterion ${index + 1} description`),
        pass: requireTrimmedString(value.pass, `Judge criterion ${index + 1} pass guidance`),
        fail: requireTrimmedString(value.fail, `Judge criterion ${index + 1} fail guidance`),
        unclear: requireTrimmedString(value.unclear, `Judge criterion ${index + 1} unclear guidance`)
    };
}

export function normalizeJudgeCriteria(value) {
    if (!isPlainObject(value)) throw new Error('Judge criteria must be a JSON object.');
    if (!Array.isArray(value.criteria) || value.criteria.length === 0) {
        throw new Error('Judge criteria must contain at least one criterion.');
    }
    const criteria = value.criteria.map(normalizeCriterion);
    const ids = new Set();
    for (const criterion of criteria) {
        if (ids.has(criterion.id)) throw new Error(`Duplicate judge criterion id "${criterion.id}".`);
        ids.add(criterion.id);
    }
    return {
        id: requireTrimmedString(value.id, 'Judge criteria id'),
        title: requireTrimmedString(value.title, 'Judge criteria title'),
        context: requireTrimmedString(value.context, 'Judge criteria context'),
        instructions: typeof value.instructions === 'string' ? value.instructions.trim() : '',
        criteria
    };
}

export async function loadJudgeCriteria(filename) {
    let parsed;
    try {
        parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
        throw new Error(`Failed to read prose judge criteria ${filename}: ${error.message}`);
    }
    return normalizeJudgeCriteria(parsed);
}

export function hashJudgeCriteria(criteria) {
    return createHash('sha256').update(JSON.stringify(normalizeJudgeCriteria(criteria))).digest('hex');
}

export function buildProseJudgeMessages({ criteria, playerInput, attempts }) {
    const normalizedCriteria = normalizeJudgeCriteria(criteria);
    const normalizedInput = requireTrimmedString(playerInput, 'Benchmark player input');
    if (!Array.isArray(attempts) || attempts.length === 0) {
        throw new Error('Prose judge requires at least one attempt.');
    }
    const normalizedAttempts = attempts.map((attempt, index) => {
        if (!Number.isInteger(attempt?.attempt) || attempt.attempt < 1) {
            throw new Error(`Prose judge attempt ${index + 1} must have a positive integer attempt number.`);
        }
        return {
            attempt: attempt.attempt,
            prose: requireTrimmedString(attempt.finalProse, `Prose judge attempt ${attempt.attempt} prose`)
        };
    });
    const criterionLines = normalizedCriteria.criteria.flatMap(criterion => [
        `### ${criterion.id}: ${criterion.title}`,
        criterion.description,
        `PASS: ${criterion.pass}`,
        `FAIL: ${criterion.fail}`,
        `UNCLEAR: ${criterion.unclear}`,
        ''
    ]);
    const attemptLines = normalizedAttempts.flatMap(attempt => [
        `### Attempt ${attempt.attempt}`,
        '<prose>',
        attempt.prose,
        '</prose>',
        ''
    ]);
    const responseShape = {
        attempts: normalizedAttempts.map(attempt => ({
            attempt: attempt.attempt,
            criteria: normalizedCriteria.criteria.map(criterion => ({
                id: criterion.id,
                verdict: 'pass | fail | unclear',
                confidence: 'high | medium | low',
                evidence: 'short exact excerpt from the generated prose, or an empty string when absence is the evidence',
                rationale: 'brief explanation grounded only in the generated prose'
            }))
        }))
    };
    const system = [
        'You are an independent semantic judge for generated role-playing prose.',
        'Judge only the supplied generated prose against the supplied criteria.',
        'Do not rewrite the prose, reward particular wording, or use keyword-presence as a substitute for understanding.',
        'Allow implications, deadpan delivery, humor, physical behavior, and other natural indirect evidence.',
        'Do not count facts stated only in the player input as evidence that the generated response understood them.',
        'Treat unclear evidence as unclear rather than inventing an interpretation.',
        'Return exactly one JSON object and no Markdown.'
    ].join('\n');
    const user = [
        `# Evaluation: ${normalizedCriteria.title}`,
        '',
        '## Scenario facts',
        normalizedCriteria.context,
        '',
        '## Player input',
        normalizedInput,
        '',
        '## Criteria',
        ...criterionLines,
        ...(normalizedCriteria.instructions ? ['## Additional instructions', normalizedCriteria.instructions, ''] : []),
        '## Generated responses',
        ...attemptLines,
        '## Required response shape',
        JSON.stringify(responseShape, null, 2),
        '',
        'Return every requested attempt and every criterion exactly once, in the supplied order.'
    ].join('\n');
    return {
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ],
        attempts: normalizedAttempts,
        criteria: normalizedCriteria
    };
}

function parseJsonObject(rawText) {
    if (typeof rawText !== 'string' || !rawText.trim()) {
        throw new Error('Codex prose judge returned an empty response.');
    }
    let parsed;
    try {
        parsed = JSON.parse(rawText.trim());
    } catch (error) {
        throw new Error(`Codex prose judge response is not valid JSON: ${error.message}`);
    }
    if (!isPlainObject(parsed)) throw new Error('Codex prose judge response must be a JSON object.');
    return parsed;
}

export function parseProseJudgeResponse(rawText, { attempts, criteria }) {
    const parsed = parseJsonObject(rawText);
    const expectedAttempts = attempts.map(attempt => attempt.attempt);
    const expectedCriteria = normalizeJudgeCriteria(criteria).criteria.map(criterion => criterion.id);
    if (!Array.isArray(parsed.attempts)) {
        throw new Error('Codex prose judge response must contain an attempts array.');
    }
    if (parsed.attempts.length !== expectedAttempts.length) {
        throw new Error(`Codex prose judge returned ${parsed.attempts.length} attempts; expected ${expectedAttempts.length}.`);
    }
    return parsed.attempts.map((attemptResult, attemptIndex) => {
        if (!isPlainObject(attemptResult)) {
            throw new Error(`Codex prose judge attempt result ${attemptIndex + 1} must be an object.`);
        }
        const expectedAttempt = expectedAttempts[attemptIndex];
        if (attemptResult.attempt !== expectedAttempt) {
            throw new Error(`Codex prose judge attempt ${attemptIndex + 1} must identify attempt ${expectedAttempt}.`);
        }
        if (!Array.isArray(attemptResult.criteria) || attemptResult.criteria.length !== expectedCriteria.length) {
            throw new Error(`Codex prose judge attempt ${expectedAttempt} must return ${expectedCriteria.length} criteria.`);
        }
        return {
            attempt: expectedAttempt,
            criteria: attemptResult.criteria.map((criterionResult, criterionIndex) => {
                if (!isPlainObject(criterionResult)) {
                    throw new Error(`Codex prose judge attempt ${expectedAttempt} criterion ${criterionIndex + 1} must be an object.`);
                }
                const expectedId = expectedCriteria[criterionIndex];
                if (criterionResult.id !== expectedId) {
                    throw new Error(`Codex prose judge attempt ${expectedAttempt} criterion ${criterionIndex + 1} must have id "${expectedId}".`);
                }
                const verdict = typeof criterionResult.verdict === 'string'
                    ? criterionResult.verdict.trim().toLowerCase()
                    : '';
                if (!VERDICTS.has(verdict)) {
                    throw new Error(`Codex prose judge attempt ${expectedAttempt} criterion "${expectedId}" has invalid verdict "${criterionResult.verdict}".`);
                }
                const confidence = typeof criterionResult.confidence === 'string'
                    ? criterionResult.confidence.trim().toLowerCase()
                    : '';
                if (!CONFIDENCE_LEVELS.has(confidence)) {
                    throw new Error(`Codex prose judge attempt ${expectedAttempt} criterion "${expectedId}" has invalid confidence "${criterionResult.confidence}".`);
                }
                const evidence = typeof criterionResult.evidence === 'string'
                    ? criterionResult.evidence.trim()
                    : null;
                if (evidence === null) {
                    throw new Error(`Codex prose judge attempt ${expectedAttempt} criterion "${expectedId}" evidence must be a string.`);
                }
                return {
                    id: expectedId,
                    verdict,
                    confidence,
                    evidence,
                    rationale: requireTrimmedString(
                        criterionResult.rationale,
                        `Codex prose judge attempt ${expectedAttempt} criterion "${expectedId}" rationale`
                    )
                };
            })
        };
    });
}

export async function runCodexProseJudgeBatch({
    root,
    runDirectory,
    criteria,
    playerInput,
    attempts,
    model = DEFAULT_CODEX_JUDGE_MODEL,
    command = 'codex',
    home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    reasoningEffort = 'medium',
    timeoutMs = 600_000,
    metadataLabel = 'prose_benchmark_judge'
}) {
    const normalizedModel = requireTrimmedString(model, 'Codex judge model');
    const built = buildProseJudgeMessages({ criteria, playerInput, attempts });
    const judgeCwd = path.join(runDirectory, 'judging', 'codex-cwd');
    await fs.mkdir(judgeCwd, { recursive: true });
    const previousBaseDir = Globals.baseDir;
    Globals.baseDir = judgeCwd;
    try {
        const response = await CodexBridgeClient.chatCompletion({
            messages: built.messages,
            model: normalizedModel,
            timeoutMs,
            metadataLabel,
            aiConfig: {
                backend: 'codex_cli_bridge',
                model: normalizedModel,
                max_concurrent_requests: 1,
                baseTimeoutSeconds: Math.ceil(timeoutMs / 1000),
                codex_bridge: {
                    command,
                    home,
                    session_mode: 'fresh',
                    session_id: '',
                    sandbox: 'read-only',
                    skip_git_repo_check: true,
                    reasoning_effort: reasoningEffort,
                    profile: '',
                    prompt_preamble: '',
                    idle_timeout_ms: 120_000
                }
            }
        });
        const rawContent = response?.data?.choices?.[0]?.message?.content;
        return {
            judgments: parseProseJudgeResponse(rawContent, built),
            rawContent,
            usage: response?.data?.usage || null
        };
    } finally {
        Globals.baseDir = previousBaseDir;
    }
}

async function atomicJson(filename, value) {
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temporary, filename);
}

async function persistRunState(runDirectory, state) {
    delete state.summary;
    await writeProseBenchmarkReports(runDirectory, state);
    await atomicJson(path.join(runDirectory, 'manifest.json'), state);
}

export async function judgeProseBenchmarkRun(root, runDirectory, {
    criteriaPath,
    model = DEFAULT_CODEX_JUDGE_MODEL,
    command = 'codex',
    home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    reasoningEffort = 'medium',
    timeoutMs = 600_000,
    batchSize = 10,
    force = false,
    judgeBatch = runCodexProseJudgeBatch
} = {}) {
    if (!Number.isInteger(batchSize) || batchSize < 1) {
        throw new Error('Codex prose judge batch size must be a positive integer.');
    }
    const absoluteRunDirectory = path.resolve(runDirectory);
    const absoluteCriteriaPath = path.resolve(root, requireTrimmedString(criteriaPath, 'Judge criteria path'));
    const criteria = await loadJudgeCriteria(absoluteCriteriaPath);
    const criteriaHash = hashJudgeCriteria(criteria);
    const state = JSON.parse(await fs.readFile(path.join(absoluteRunDirectory, 'results.json'), 'utf8'));
    if (!Array.isArray(state.results)) throw new Error('Prose benchmark results.json has no results array.');
    const normalizedModel = requireTrimmedString(model, 'Codex judge model');
    const priorConfig = state.judging;
    const hasPriorJudgments = state.results.some(result => result?.judgment);
    const configChanged = priorConfig && (
        priorConfig.criteriaHash !== criteriaHash
        || priorConfig.model !== normalizedModel
        || priorConfig.promptVersion !== PROSE_JUDGE_PROMPT_VERSION
    );
    if (hasPriorJudgments && configChanged && !force) {
        throw new Error('This run already contains judgments from a different rubric, model, or judge prompt version; rerun with --force true to replace them.');
    }
    if (force) {
        for (const result of state.results) delete result.judgment;
    }
    state.judging = {
        backend: 'codex_cli_bridge',
        model: normalizedModel,
        reasoningEffort,
        promptVersion: PROSE_JUDGE_PROMPT_VERSION,
        criteriaPath: path.relative(root, absoluteCriteriaPath).split(path.sep).join('/'),
        criteriaHash,
        rubric: criteria,
        status: 'running',
        startedAt: priorConfig?.startedAt || new Date().toISOString(),
        finishedAt: null,
        error: null
    };
    const judgingDirectory = path.join(absoluteRunDirectory, 'judging');
    await fs.mkdir(judgingDirectory, { recursive: true });
    await atomicJson(path.join(judgingDirectory, 'criteria.json'), criteria);
    await persistRunState(absoluteRunDirectory, state);

    const pending = state.results.filter(result => result.finalProse && !result.judgment);
    try {
        for (let offset = 0; offset < pending.length; offset += batchSize) {
            const batch = pending.slice(offset, offset + batchSize);
            const batchNumber = Math.floor(offset / batchSize) + 1;
            const judged = await judgeBatch({
                root,
                runDirectory: absoluteRunDirectory,
                criteria,
                playerInput: state.playerInput,
                attempts: batch,
                model: normalizedModel,
                command,
                home,
                reasoningEffort,
                timeoutMs,
                metadataLabel: `prose_benchmark_judge_${state.runId || 'run'}_${batchNumber}`
            });
            await atomicJson(path.join(judgingDirectory, `batch-${String(batchNumber).padStart(2, '0')}.json`), {
                attempts: batch.map(result => result.attempt),
                rawContent: judged.rawContent,
                usage: judged.usage,
                judgments: judged.judgments
            });
            for (const attemptJudgment of judged.judgments) {
                const result = state.results.find(candidate => candidate.attempt === attemptJudgment.attempt);
                if (!result) throw new Error(`Codex prose judge returned unknown attempt ${attemptJudgment.attempt}.`);
                result.judgment = {
                    backend: 'codex_cli_bridge',
                    model: normalizedModel,
                    criteriaId: criteria.id,
                    criteriaHash,
                    promptVersion: PROSE_JUDGE_PROMPT_VERSION,
                    judgedAt: new Date().toISOString(),
                    criteria: attemptJudgment.criteria
                };
            }
            await persistRunState(absoluteRunDirectory, state);
        }
        state.judging.status = 'completed';
        state.judging.finishedAt = new Date().toISOString();
        await persistRunState(absoluteRunDirectory, state);
        return state;
    } catch (error) {
        state.judging.status = 'error';
        state.judging.error = error?.message || String(error);
        state.judging.finishedAt = new Date().toISOString();
        await persistRunState(absoluteRunDirectory, state);
        throw error;
    }
}
