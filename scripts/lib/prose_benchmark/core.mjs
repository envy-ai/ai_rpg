import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { dump, load } from 'js-yaml';

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseBooleanOption(value, label = 'value') {
    if (typeof value === 'boolean') return value;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    throw new Error(`${label} must be true or false.`);
}

export function parsePositiveInteger(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
}

export function safeFilenameSegment(value, fallback = 'benchmark') {
    const normalized = String(value ?? '')
        .trim()
        .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
        .replaceAll(/^-+|-+$/g, '');
    return normalized || fallback;
}

async function readYamlObject(filename, { optional = false } = {}) {
    try {
        const parsed = load(await fs.readFile(filename, 'utf8'));
        if (parsed === undefined || parsed === null) return {};
        if (!isPlainObject(parsed)) throw new Error('file does not contain a YAML object');
        return parsed;
    } catch (error) {
        if (optional && error?.code === 'ENOENT') return {};
        throw new Error(`Failed to read YAML ${filename}: ${error.message}`);
    }
}

function mergeDeep(target, source) {
    if (!isPlainObject(source)) return target;
    const output = isPlainObject(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(source)) {
        output[key] = isPlainObject(value)
            ? mergeDeep(isPlainObject(output[key]) ? output[key] : {}, value)
            : value;
    }
    return output;
}

function collectOverrideNames(...configs) {
    const names = new Set();
    for (const config of configs) {
        if (!isPlainObject(config?.ai_model_overrides)) continue;
        for (const name of Object.keys(config.ai_model_overrides)) names.add(name);
    }
    return [...names].sort();
}

function applyPinnedModelSettings(config, {
    checkpoint,
    tinybrain,
    endpoint = null,
    overrideNames = []
}) {
    const output = mergeDeep({}, config);
    const configuredStartupScript = typeof output.ai?.local_startup_script_path === 'string'
        ? output.ai.local_startup_script_path.trim()
        : '';
    const usesConfiguredLocalRouter = !endpoint?.trim() && Boolean(configuredStartupScript);
    output.server = mergeDeep(output.server, { allowSelfRestart: false });
    output.imagegen = mergeDeep(output.imagegen, { enabled: false });
    output.ai = mergeDeep(output.ai, {
        model: checkpoint,
        tinybrain,
        local_startup_script_path: '',
        unload_during_image_generation: false,
        terminate_during_image_generation: false,
        record_outputs_file: '',
        force_outputs_file: ''
    });
    if (endpoint) output.ai.endpoint = endpoint;
    output.router_preload_model = usesConfiguredLocalRouter ? checkpoint : '';
    output.ai_model_overrides = isPlainObject(output.ai_model_overrides)
        ? { ...output.ai_model_overrides }
        : {};
    for (const name of overrideNames) {
        const existing = isPlainObject(output.ai_model_overrides[name])
            ? output.ai_model_overrides[name]
            : {};
        output.ai_model_overrides[name] = {
            ...existing,
            model: checkpoint
        };
        if (endpoint) output.ai_model_overrides[name].endpoint = endpoint;
    }
    return output;
}

async function atomicWriteText(filename, content) {
    await fs.mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, filename);
}

export async function writeProseBenchmarkConfig(root, {
    baseOverridePath,
    outputPath,
    checkpoint,
    tinybrain,
    endpoint = null
}) {
    const normalizedCheckpoint = String(checkpoint ?? '').trim();
    if (!normalizedCheckpoint) throw new Error('Benchmark checkpoint is required.');
    const absoluteOutput = path.resolve(root, outputPath);
    const benchmarkRoot = path.join(root, 'benchmarks', 'prose', 'runs');
    const relativeOutput = path.relative(benchmarkRoot, absoluteOutput);
    if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
        throw new Error('Prose benchmark configuration must be written under benchmarks/prose/runs/.');
    }
    const baseOverride = await readYamlObject(path.resolve(root, baseOverridePath));
    const defaultConfig = await readYamlObject(path.join(root, 'config.default.yaml'), { optional: true });
    const projectConfig = await readYamlObject(path.join(root, 'config.yaml'), { optional: true });
    const overrideNames = collectOverrideNames(defaultConfig, projectConfig, baseOverride);
    const generated = applyPinnedModelSettings(baseOverride, {
        checkpoint: normalizedCheckpoint,
        tinybrain,
        endpoint: endpoint?.trim() || null,
        overrideNames
    });
    await atomicWriteText(absoluteOutput, dump(generated, { noRefs: true, lineWidth: 120 }));
    return {
        outputPath: absoluteOutput,
        checkpoint: normalizedCheckpoint,
        tinybrain,
        endpoint: endpoint?.trim() || null,
        rewrittenOverrideProfiles: overrideNames
    };
}

async function readSaveMetadata(saveDirectory) {
    const metadataPath = path.join(saveDirectory, 'metadata.json');
    let metadata;
    try {
        metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    } catch (error) {
        throw new Error(`Save directory ${saveDirectory} has no valid metadata.json: ${error.message}`);
    }
    if (!isPlainObject(metadata)) {
        throw new Error(`Save metadata is not an object: ${metadataPath}`);
    }
    return metadata;
}

async function listManualSaves(root) {
    const savesRoot = path.join(root, 'saves');
    const names = await fs.readdir(savesRoot, { withFileTypes: true }).catch(error => {
        if (error?.code === 'ENOENT') return [];
        throw error;
    });
    const candidates = [];
    for (const entry of names) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(savesRoot, entry.name);
        try {
            const metadata = await readSaveMetadata(directory);
            const stat = await fs.stat(directory);
            const metadataTime = Date.parse(metadata.timestamp);
            candidates.push({
                directory,
                metadata,
                timestampMs: Number.isFinite(metadataTime) ? metadataTime : stat.mtimeMs
            });
        } catch {
            // A directory without valid save metadata is not a selectable manual save.
        }
    }
    return candidates.sort((left, right) => right.timestampMs - left.timestampMs);
}

export async function resolveSourceSave(root, requested = 'latest-manual') {
    const normalized = String(requested ?? '').trim() || 'latest-manual';
    let directory = null;
    let sourceType = null;
    if (normalized === 'latest-manual') {
        const candidates = await listManualSaves(root);
        if (!candidates.length) throw new Error('No valid manual saves were found under saves/.');
        directory = candidates[0].directory;
        sourceType = 'saves';
    } else {
        const direct = path.resolve(root, normalized);
        const namedCandidates = [
            { type: 'saves', directory: path.join(root, 'saves', normalized) },
            { type: 'autosaves', directory: path.join(root, 'autosaves', normalized) }
        ];
        const directStat = await fs.stat(direct).catch(() => null);
        if (directStat?.isDirectory()) {
            directory = direct;
        } else {
            const existing = [];
            for (const candidate of namedCandidates) {
                const stat = await fs.stat(candidate.directory).catch(() => null);
                if (stat?.isDirectory()) existing.push(candidate);
            }
            if (existing.length > 1) {
                throw new Error(`Save name ${normalized} exists under both saves/ and autosaves/; use a path.`);
            }
            if (existing.length === 1) {
                directory = existing[0].directory;
                sourceType = existing[0].type;
            }
        }
    }
    if (!directory) throw new Error(`Save not found: ${normalized}`);
    const metadata = await readSaveMetadata(directory);
    const relativeToSaves = path.relative(path.join(root, 'saves'), directory);
    const relativeToAutosaves = path.relative(path.join(root, 'autosaves'), directory);
    if (!sourceType && !relativeToSaves.startsWith('..') && !path.isAbsolute(relativeToSaves)) sourceType = 'saves';
    if (!sourceType && !relativeToAutosaves.startsWith('..') && !path.isAbsolute(relativeToAutosaves)) sourceType = 'autosaves';
    return {
        directory: path.resolve(directory),
        saveName: path.basename(directory),
        sourceType: sourceType || metadata.source || 'path',
        metadata
    };
}

async function walkFiles(directory, base = directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const absolute = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            throw new Error(`Save snapshots do not allow symbolic links: ${absolute}`);
        }
        if (entry.isDirectory()) files.push(...await walkFiles(absolute, base));
        else if (entry.isFile()) files.push({ absolute, relative: path.relative(base, absolute) });
        else throw new Error(`Unsupported save entry type: ${absolute}`);
    }
    return files;
}

export async function createDirectoryManifest(directory) {
    const files = await walkFiles(directory);
    const entries = [];
    for (const file of files) {
        const content = await fs.readFile(file.absolute);
        entries.push({
            path: file.relative.split(path.sep).join('/'),
            size: content.length,
            sha256: createHash('sha256').update(content).digest('hex')
        });
    }
    return {
        algorithm: 'sha256',
        fileCount: entries.length,
        totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
        files: entries
    };
}

export async function snapshotSourceSave(sourceDirectory, snapshotDirectory) {
    const sourceManifest = await createDirectoryManifest(sourceDirectory);
    const temporary = `${snapshotDirectory}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(snapshotDirectory), { recursive: true });
    await fs.cp(sourceDirectory, temporary, { recursive: true, errorOnExist: true, force: false });
    await fs.rename(temporary, snapshotDirectory);
    const snapshotManifest = await createDirectoryManifest(snapshotDirectory);
    if (JSON.stringify(sourceManifest.files) !== JSON.stringify(snapshotManifest.files)) {
        throw new Error('Retained source-save snapshot failed its integrity comparison.');
    }
    return snapshotManifest;
}

export async function prepareRuntimeSave(sourceSnapshotDirectory, runtimeDirectory, {
    checkpoint,
    tinybrain,
    endpoint = null,
    overrideNames = []
}) {
    await fs.cp(sourceSnapshotDirectory, runtimeDirectory, {
        recursive: true,
        errorOnExist: true,
        force: false
    });
    const overridePath = path.join(runtimeDirectory, 'gameConfigOverride.yaml');
    const savedOverride = await readYamlObject(overridePath, { optional: true });
    const pinned = applyPinnedModelSettings(savedOverride, {
        checkpoint,
        tinybrain,
        endpoint,
        overrideNames
    });
    await atomicWriteText(overridePath, dump(pinned, { noRefs: true, lineWidth: 120 }));
    return runtimeDirectory;
}

export function extractFinalProse(response) {
    const prose = response?.ok && typeof response?.payload?.response === 'string'
        ? response.payload.response.trim()
        : '';
    return prose || null;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

export function proseReportFilename(checkpoint, tinybrain) {
    return `airpg-prosebench-${safeFilenameSegment(checkpoint, 'model')}-${tinybrain ? 'tinybrain' : 'normal'}.html`;
}

export async function writeProseBenchmarkReports(runDirectory, state) {
    const results = Array.isArray(state.results) ? state.results : [];
    const captured = results.filter(result => result.finalProse).length;
    const rubricCriteria = Array.isArray(state.judging?.rubric?.criteria)
        ? state.judging.rubric.criteria
        : [];
    const judged = results.filter(result => result.judgment).length;
    const criterionVerdicts = Object.fromEntries(rubricCriteria.map(criterion => {
        const counts = { pass: 0, fail: 0, unclear: 0 };
        for (const result of results) {
            const judgment = result.judgment?.criteria?.find(candidate => candidate.id === criterion.id);
            if (judgment && Object.prototype.hasOwnProperty.call(counts, judgment.verdict)) {
                counts[judgment.verdict] += 1;
            }
        }
        return [criterion.id, counts];
    }));
    const aggregate = {
        ...state,
        summary: {
            requested: state.tries,
            completed: results.length,
            finalProseCaptured: captured,
            noFinalProse: results.length - captured,
            judged,
            criterionVerdicts
        }
    };
    await atomicWriteText(
        path.join(runDirectory, 'results.json'),
        `${JSON.stringify(aggregate, null, 2)}\n`
    );
    const dialogueLines = results.flatMap(result => [
        `## Attempt ${result.attempt}`,
        '',
        result.finalProse || `**NO FINAL PROSE:** ${result.failureReason || 'Unknown failure.'}`,
        ''
    ]);
    await atomicWriteText(path.join(runDirectory, 'all-final-dialogue.md'), `${dialogueLines.join('\n')}\n`);

    const percentage = state.tries ? Math.round((results.length / state.tries) * 100) : 0;
    const cards = results.map(result => {
        const success = Boolean(result.finalProse);
        const judgmentMarkup = !state.judging || !success
            ? ''
            : result.judgment
                ? `<section class="judgments">${rubricCriteria.map(criterion => {
                    const judgment = result.judgment.criteria?.find(candidate => candidate.id === criterion.id);
                    if (!judgment) {
                        return `<article class="judgment verdict-pending"><header><h3>${escapeHtml(criterion.title)}</h3><span>Pending</span></header></article>`;
                    }
                    return `<article class="judgment verdict-${escapeHtml(judgment.verdict)}">
                        <header><h3>${escapeHtml(criterion.title)}</h3><span>${escapeHtml(judgment.verdict)} · ${escapeHtml(judgment.confidence)} confidence</span></header>
                        <p>${escapeHtml(judgment.rationale)}</p>
                        ${judgment.evidence ? `<blockquote>${escapeHtml(judgment.evidence)}</blockquote>` : '<div class="no-evidence">No excerpt; the absence of evidence informed this judgment.</div>'}
                    </article>`;
                }).join('')}</section>`
                : `<section class="judgments"><article class="judgment verdict-pending"><header><h3>Codex judgment</h3><span>Pending</span></header></article></section>`;
        return `<article class="attempt ${success ? 'success' : 'failure'}">
            <header><div><span class="number">${result.attempt}</span><h2>Attempt ${result.attempt}</h2></div><span class="status">${success ? 'Prose captured' : 'No final prose'}</span></header>
            <div class="meta"><span>${escapeHtml(result.durationSeconds ?? 0)} seconds</span><span>HTTP ${escapeHtml(result.chatStatus ?? 'none')}</span>${result.finalSaveRelativePath ? `<a href="${escapeHtml(result.finalSaveRelativePath)}/">Final save</a>` : '<span>No final save</span>'}<a href="${escapeHtml(result.dialogueRelativePath)}">Dialogue file</a></div>
            <div class="prose">${escapeHtml(result.finalProse || result.failureReason || 'No final prose was produced.')}</div>
            ${judgmentMarkup}
        </article>`;
    }).join('\n');
    const rubricMarkup = state.judging
        ? `<section class="rubric"><header><div><div class="eyebrow">Independent semantic judgment</div><h2>${escapeHtml(state.judging.rubric?.title || 'Codex prose judge')}</h2></div><span class="judge-state judge-${escapeHtml(state.judging.status || 'pending')}">${escapeHtml(state.judging.status || 'pending')}</span></header>
            <p>${escapeHtml(state.judging.rubric?.context || '')}</p>
            <div class="rubric-grid">${rubricCriteria.map(criterion => {
                const counts = criterionVerdicts[criterion.id] || { pass: 0, fail: 0, unclear: 0 };
                return `<article><h3>${escapeHtml(criterion.title)}</h3><p>${escapeHtml(criterion.description)}</p><div class="count-row"><span class="pass-count">${counts.pass} pass</span><span class="fail-count">${counts.fail} fail</span><span class="unclear-count">${counts.unclear} unclear</span></div></article>`;
            }).join('')}</div>
            <div class="judge-meta">${judged} of ${captured} captured responses judged by ${escapeHtml(state.judging.model || 'Codex')}. Judgments are semantic review aids and do not change prose-capture success.${state.judging.error ? ` <strong>Error:</strong> ${escapeHtml(state.judging.error)}` : ''}</div>
        </section>`
        : '';
    const summaryText = state.judging
        ? `${percentage}% complete · ${judged} of ${captured} captured responses semantically judged; generation success remains independent.`
        : `${percentage}% complete · This report performs no prose grading.`;
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI RPG Prose Benchmark</title>
<style>
:root{color-scheme:dark;--bg:#0c1018;--panel:#151b27;--ink:#ecf1fa;--muted:#9aa8bd;--line:#2a3446;--accent:#7dd3fc;--good:#86efac;--bad:#fca5a5;--warn:#fde68a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#17233a 0,#0c1018 38rem);color:var(--ink);font:16px/1.65 Inter,ui-sans-serif,system-ui,sans-serif}main{width:min(1050px,calc(100% - 2rem));margin:3rem auto 8rem}.hero,.rubric{padding:2rem;border:1px solid var(--line);border-radius:22px;background:rgba(21,27,39,.92);box-shadow:0 22px 70px #0008}.eyebrow{color:var(--accent);font-weight:800;letter-spacing:.12em;text-transform:uppercase;font-size:.78rem}h1{font-size:clamp(2rem,5vw,3.6rem);line-height:1.08;margin:.35rem 0 1rem}.details{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.75rem;margin:1.5rem 0}.detail{padding:.85rem 1rem;background:#0d1320;border-radius:12px}.detail b{display:block;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.08em}.input{white-space:pre-wrap;padding:1.2rem;border-left:4px solid var(--accent);background:#0d1320;border-radius:0 12px 12px 0}.progress{height:12px;background:#080b11;border-radius:999px;overflow:hidden;margin:.75rem 0}.progress>div{height:100%;width:${percentage}%;background:linear-gradient(90deg,#38bdf8,#a78bfa)}.summary{color:var(--muted)}.rubric{margin-top:1.5rem}.rubric>header{display:flex;align-items:center;justify-content:space-between;gap:1rem}.rubric h2{margin:.15rem 0;font-size:1.5rem}.judge-state{text-transform:uppercase;font-weight:800;font-size:.75rem;letter-spacing:.08em;padding:.35rem .7rem;border:1px solid var(--line);border-radius:999px}.judge-completed{color:var(--good)}.judge-running,.judge-pending{color:var(--warn)}.judge-error{color:var(--bad)}.rubric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem;margin-top:1.25rem}.rubric-grid>article{background:#0d1320;border:1px solid var(--line);border-radius:14px;padding:1rem}.rubric-grid h3{margin:0}.rubric-grid p{color:var(--muted)}.count-row{display:flex;flex-wrap:wrap;gap:.7rem;font-weight:800;font-size:.85rem}.pass-count{color:var(--good)}.fail-count{color:var(--bad)}.unclear-count{color:var(--warn)}.judge-meta{margin-top:1rem;color:var(--muted)}.attempts{display:grid;gap:1.2rem;margin-top:1.5rem}.attempt{border:1px solid var(--line);border-radius:18px;overflow:hidden;background:rgba(21,27,39,.95)}.attempt>header{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1rem 1.25rem;border-bottom:1px solid var(--line)}.attempt>header>div{display:flex;align-items:center;gap:.75rem}.attempt h2{font-size:1.05rem;margin:0}.number{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:#263249;color:var(--accent);font-weight:800}.status{font-size:.82rem;font-weight:800;color:var(--good)}.failure .status{color:var(--bad)}.meta{display:flex;flex-wrap:wrap;gap:.65rem 1.2rem;padding:.7rem 1.25rem;color:var(--muted);font-size:.85rem;background:#101621}.meta a{color:var(--accent)}.prose{padding:1.4rem 1.5rem;white-space:pre-wrap;font-family:Georgia,'Times New Roman',serif;font-size:1.08rem;line-height:1.8}.judgments{display:grid;gap:.75rem;padding:0 1.25rem 1.25rem}.judgment{border:1px solid var(--line);border-left-width:4px;border-radius:12px;background:#0d1320;overflow:hidden}.judgment>header{display:flex;justify-content:space-between;gap:1rem;padding:.7rem 1rem;border-bottom:1px solid var(--line)}.judgment h3{margin:0;font-size:.95rem}.judgment header span{text-transform:uppercase;font-size:.72rem;font-weight:800;letter-spacing:.06em}.judgment p{margin:.8rem 1rem}.judgment blockquote,.no-evidence{margin:.8rem 1rem;padding:.65rem .8rem;background:#111a2a;border-left:3px solid var(--line);color:var(--muted)}.verdict-pass{border-left-color:var(--good)}.verdict-pass header span{color:var(--good)}.verdict-fail{border-left-color:var(--bad)}.verdict-fail header span{color:var(--bad)}.verdict-unclear,.verdict-pending{border-left-color:var(--warn)}.verdict-unclear header span,.verdict-pending header span{color:var(--warn)}
</style></head><body><main><section class="hero"><div class="eyebrow">AI RPG aggregate prose comparison</div><h1>${escapeHtml(state.checkpoint)}</h1><div class="details"><div class="detail"><b>Mode</b>${state.tinybrain ? 'TinyBrain' : 'Normal'}</div><div class="detail"><b>Turn boundary</b>${state.haltAfterPlayerAction ? 'Player action only' : 'Complete turn'}</div><div class="detail"><b>Source save</b>${escapeHtml(state.sourceSaveName)}</div><div class="detail"><b>Attempts</b>${results.length} / ${state.tries}</div><div class="detail"><b>Final prose</b>${captured} captured</div>${state.judging ? `<div class="detail"><b>Codex judgments</b>${judged} / ${captured}</div>` : ''}</div><b>Player input</b><div class="input">${escapeHtml(state.playerInput)}</div><div class="progress"><div></div></div><div class="summary">${summaryText}</div></section>${rubricMarkup}<section class="attempts">${cards || '<article class="attempt"><div class="prose">No attempts have completed yet.</div></article>'}</section></main></body></html>`;
    const filename = proseReportFilename(state.checkpoint, state.tinybrain);
    await atomicWriteText(path.join(runDirectory, filename), html);
    return { aggregate, reportPath: path.join(runDirectory, filename) };
}
